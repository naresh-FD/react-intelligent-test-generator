/*
Usage:
  npm run testgen
  npm run testgen:file -- src/path/Component.tsx
*/

import path from 'path';
import { createParser, getSourceFile } from './parser';
import { analyzeSourceFile } from './analyzer';
import { scanSourceFiles, getTestFilePath } from './utils/path';
import { writeFile } from './fs';
import { generateTests } from './generator';
import { runJestCoverage } from './coverage/runner';
import { readLineCoverage } from './coverage/reader';

interface CliOptions {
    file?: string;
}

function parseArgs(argv: string[]): CliOptions {
    const options: CliOptions = {};
    const fileIndex = argv.indexOf('--file');
    if (fileIndex >= 0 && argv[fileIndex + 1]) {
        options.file = argv[fileIndex + 1];
    }
    return options;
}

function resolveFilePath(fileArg: string): string {
    return path.isAbsolute(fileArg) ? fileArg : path.join(process.cwd(), fileArg);
}

async function run() {
    const args = parseArgs(process.argv.slice(2));
    const { project, checker } = createParser();

    const files = args.file ? [resolveFilePath(args.file)] : scanSourceFiles();

    for (const filePath of files) {
        const sourceFile = getSourceFile(project, filePath);
        const components = analyzeSourceFile(sourceFile, project, checker);

        if (components.length === 0) continue;

        const testFilePath = getTestFilePath(filePath);

        const pass1 = generateTests(components, {
            pass: 1,
            testFilePath,
            sourceFilePath: filePath,
        });

        writeFile(testFilePath, pass1);

        const coverageResult = runJestCoverage(testFilePath);
        const lineCoverage = readLineCoverage(filePath);

        if (coverageResult.code !== 0 || lineCoverage === null) {
            continue;
        }

        if (lineCoverage < 50) {
            const pass2 = generateTests(components, {
                pass: 2,
                testFilePath,
                sourceFilePath: filePath,
            });

            writeFile(testFilePath, pass2);
            runJestCoverage(testFilePath);
        }
    }
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
