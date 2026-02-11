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
        const components = analyzeSourceFile(sourceFile, project, checker);

        if (components.length === 0) {
            console.log('  - No exported components found. Skipping.');
            continue;
        }

        const testFilePath = getTestFilePath(filePath);
        console.log(`  - Writing test file: ${testFilePath}`);

        const generatedTest = generateTests(components, {
            pass: 1,
            testFilePath,
            sourceFilePath: filePath,
        });

        writeFile(testFilePath, generatedTest);
        console.log('  - Test file generated/updated.');
    }
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
            .filter((filePath) => filePath.endsWith('.tsx'))
            .filter((filePath) => !isTestFile(filePath));
    } catch {
        return [];
    }
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
