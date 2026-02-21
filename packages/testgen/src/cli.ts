/*
Usage:
  npm run testgen             # uses unstaged git changes by default
  npm run testgen:all         # scans all source files
  npm run testgen:file -- src/path/Component.tsx
*/

import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { createParser, getSourceFile } from './parser';
import { analyzeSourceFile } from './analyzer';
import { scanSourceFiles, getTestFilePath, isTestFile } from './utils/path';
import { writeFile } from './fs';
import { generateTests } from './generator';
import { generateBarrelTest } from './generator/barrel';
import { generateUtilityTest } from './generator/utility';
import { generateContextTest } from './generator/context';
import { TEST_UTILITY_PATTERNS, UNTESTABLE_PATTERNS } from './config';

interface CliOptions {
    file?: string;
    gitUnstaged?: boolean;
    all?: boolean;
}

function parseArgs(argv: string[]): CliOptions {
    const options: CliOptions = {};
    const fileIndex = argv.indexOf('--file');
    if (fileIndex >= 0 && argv[fileIndex + 1]) {
        options.file = argv[fileIndex + 1];
    }
    if (argv.includes('--git-unstaged')) {
        options.gitUnstaged = true;
    }
    if (argv.includes('--all')) {
        options.all = true;
    }
    return options;
}

function resolveFilePath(fileArg: string): string {
    return path.isAbsolute(fileArg) ? fileArg : path.join(process.cwd(), fileArg);
}

function resolveTargetFiles(args: CliOptions): string[] {
    if (args.file) {
        return [resolveFilePath(args.file)];
    }

    if (args.all) {
        return scanSourceFiles();
    }

    const unstagedFiles = getGitUnstagedFiles();

    if (unstagedFiles.length > 0) {
        return unstagedFiles;
    }

    if (args.gitUnstaged) {
        return [];
    }

    return scanSourceFiles();
}

async function run() {
    const args = parseArgs(process.argv.slice(2));
    const { project, checker } = createParser();
    const files = resolveTargetFiles(args);

    console.log(`Found ${files.length} file(s) to process.`);

    if (files.length === 0) {
        console.log('No matching source files found.');
        return;
    }

    for (const [index, filePath] of files.entries()) {
        console.log(`\n[${index + 1}/${files.length}] Processing ${filePath}`);
        const sourceFile = getSourceFile(project, filePath);

        // Skip test utility files (renderWithProviders, test helpers, etc.)
        if (isTestUtilityFile(filePath)) {
            console.log('  - Test utility file detected. Skipping (not a file to generate tests for).');
            continue;
        }

        // Skip browser-only / untestable files (MSW handlers, mock data, etc.)
        if (isUntestableFile(filePath)) {
            console.log('  - Browser-only file detected. Skipping (cannot run in Node.js/Jest).');
            continue;
        }

        // Check if this is a barrel/index file (only re-exports, no components)
        const isBarrel = isBarrelFile(filePath, sourceFile.getText());
        if (isBarrel) {
            const testFilePath = getTestFilePath(filePath);
            console.log(`  - Barrel file detected. Writing test: ${testFilePath}`);
            const barrelTest = generateBarrelTest(sourceFile, testFilePath, filePath);
            if (barrelTest) {
                writeFile(testFilePath, barrelTest);
                console.log('  - Barrel test file generated/updated.');
            } else {
                console.log('  - No named exports found in barrel. Skipping.');
            }
            continue;
        }

        const testFilePath = getTestFilePath(filePath);

        // Context files get special handling (Provider + hook testing)
        const isContextFile = isContextProviderFile(filePath, sourceFile.getText());
        if (isContextFile) {
            console.log('  - Context provider file detected. Generating context tests...');
            const contextTest = generateContextTest(sourceFile, checker, testFilePath, filePath);
            if (contextTest) {
                console.log(`  - Writing context test file: ${testFilePath}`);
                writeFile(testFilePath, contextTest);
                console.log('  - Context test file generated/updated.');
                continue;
            }
        }

        // Detect service/API files for enhanced mock injection
        const fileContent = sourceFile.getText();
        const isService = isServiceFile(filePath, fileContent);

        const components = analyzeSourceFile(sourceFile, project, checker);

        if (components.length === 0) {
            // Try utility/function test generation for non-component files
            const fileType = isService ? 'service' as const : 'utility' as const;
            console.log(`  - No React components found. Generating ${fileType} tests...`);
            const utilityTest = generateUtilityTest(sourceFile, checker, testFilePath, filePath, fileType);
            if (utilityTest) {
                console.log(`  - Writing ${fileType} test file: ${testFilePath}`);
                writeFile(testFilePath, utilityTest);
                console.log(`  - ${fileType} test file generated/updated.`);
            } else {
                console.log('  - No exported functions found. Skipping.');
            }
            continue;
        }

        console.log(`  - Writing test file: ${testFilePath}`);

        const generatedTest = generateTests(components, {
            pass: 2,
            testFilePath,
            sourceFilePath: filePath,
        });

        writeFile(testFilePath, generatedTest);
        console.log('  - Test file generated/updated.');
    }
}

function isServiceFile(filePath: string, content: string): boolean {
    const basename = path.basename(filePath).toLowerCase();
    // Detect by file name patterns
    if (/service|api|client|repository|gateway|adapter/i.test(basename)) return true;
    // Detect by content patterns: axios/fetch imports + async methods
    const hasHttpClient = content.includes('axios') || content.includes('fetch(') || content.includes('ky.') || content.includes('got.');
    const hasAsyncMethods = (content.match(/async\s/g) || []).length >= 2;
    return hasHttpClient && hasAsyncMethods;
}

function isContextProviderFile(filePath: string, content: string): boolean {
    const basename = path.basename(filePath).toLowerCase();
    // Detect context files by name or content patterns
    if (basename.includes('context')) return true;
    // Check for createContext usage and Provider export
    return content.includes('createContext') && (
        content.includes('Provider') || content.includes('useContext')
    );
}

function isTestUtilityFile(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    // Check directory patterns from config
    for (const dir of TEST_UTILITY_PATTERNS.directories) {
        if (normalized.includes(dir)) return true;
    }
    // Also check legacy directory names not in the centralised config
    if (normalized.includes('/testUtils/') || normalized.includes('/testHelpers/') ||
        normalized.includes('/testing/')) {
        return true;
    }
    const basename = path.basename(filePath, path.extname(filePath));
    // Check filename patterns from config
    for (const pattern of TEST_UTILITY_PATTERNS.filenamePatterns) {
        if (pattern.test(basename)) return true;
    }
    // Also check additional legacy patterns
    if (/^(setup-?tests?|jest-?setup|vitest-?setup|test-?wrapper)/i.test(basename)) {
        return true;
    }
    return false;
}

function isUntestableFile(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    for (const dir of UNTESTABLE_PATTERNS.directories) {
        if (normalized.includes(dir)) return true;
    }
    return false;
}

function isBarrelFile(filePath: string, content: string): boolean {
    const basename = path.basename(filePath);
    // index.ts or index.tsx files that primarily re-export
    if (!/^index\.(ts|tsx)$/.test(basename)) return false;

    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length === 0) return false;

    // Check if most lines are export/import statements
    const exportLines = lines.filter(
        (l) => /^\s*(export\s|import\s)/.test(l)
    );
    return exportLines.length >= lines.length * 0.7;
}

function getGitUnstagedFiles(): string[] {
    try {
        const output = execSync('git diff --name-only --diff-filter=ACMTU', {
            cwd: process.cwd(),
            encoding: 'utf8',
        });

        return output
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .map((line) => (path.isAbsolute(line) ? line : path.join(process.cwd(), line)))
            .filter((filePath) => fs.existsSync(filePath))
            .filter((filePath) => filePath.endsWith('.tsx') || filePath.endsWith('.ts'))
            .filter((filePath) => !isTestFile(filePath));
    } catch {
        return [];
    }
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
