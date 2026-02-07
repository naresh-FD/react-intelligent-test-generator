/*
Usage:
  npm run testgen
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
import { runJestCoverage } from './coverage/runner';
import { readLineCoverage } from './coverage/reader';
import { printCoverageTable } from './coverage/report';

interface CliOptions {
    file?: string;
    gitUnstaged?: boolean;
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
    return options;
}

function resolveFilePath(fileArg: string): string {
    return path.isAbsolute(fileArg) ? fileArg : path.join(process.cwd(), fileArg);
}

async function run() {
    const args = parseArgs(process.argv.slice(2));
    const { project, checker } = createParser();

    const files = args.file
        ? [resolveFilePath(args.file)]
        : args.gitUnstaged
            ? getGitUnstagedFiles()
            : scanSourceFiles();

    console.log(`Found ${files.length} file(s) to process.`);

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

        const pass1 = generateTests(components, {
            pass: 1,
            testFilePath,
            sourceFilePath: filePath,
        });

        writeFile(testFilePath, pass1);

        console.log('  - Running coverage (pass 1)...');
        const coverageResult = runJestCoverage(testFilePath);
        const lineCoverage = readLineCoverage(filePath);

        if (coverageResult.code !== 0 || lineCoverage === null) {
            console.log('  - Coverage run failed or missing summary. Skipping pass 2.');
            continue;
        }

        console.log(`  - Line coverage: ${lineCoverage}%`);

        if (lineCoverage < 50) {
            console.log('  - Coverage < 50%, generating pass 2...');
            const pass2 = generateTests(components, {
                pass: 2,
                testFilePath,
                sourceFilePath: filePath,
            });

            writeFile(testFilePath, pass2);
            console.log('  - Running coverage (pass 2)...');
            runJestCoverage(testFilePath);
        } else {
            console.log('  - Coverage >= 50%, pass 2 not needed.');
        }
    }

    printCoverageTable();
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
