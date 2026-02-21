/*
Usage:
  npm run testgen             # uses unstaged git changes by default
  npm run testgen:all         # scans all source files
  npm run testgen:file -- src/path/Component.tsx
  npm run testgen:smart       # generate + run jest + retry on failure (--all --verify)
  npm run testgen:smart:file  # single file with verify
    --verify                  # run jest after each generated test, retry on fail
    --max-retries <n>         # how many times to retry a failing test (default: 2)
    --coverage-threshold <n>  # minimum line coverage % to consider passing (default: 50)
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CliOptions {
    file?: string;
    gitUnstaged?: boolean;
    all?: boolean;
    /** Run jest after each generated test file and retry on failure */
    verify?: boolean;
    /** How many regeneration retries per file (default 2) */
    maxRetries?: number;
    /** Minimum line-coverage % to consider a test file passing (default 50) */
    coverageThreshold?: number;
}

interface JestRunResult {
    passed: boolean;
    numTests: number;
    numFailed: number;
    /** Line coverage % for the source file (0 if not available) */
    coverage: number;
    /** Raw error output on failure */
    errorOutput: string;
}

type VerifyStatus = 'pass' | 'fail' | 'low-coverage' | 'skipped' | 'generated';

interface VerifyResult {
    status: VerifyStatus;
    coverage: number;
    attempts: number;
    numTests: number;
}

type ParserContext = ReturnType<typeof createParser>;

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): CliOptions {
    const options: CliOptions = {};

    const fileIndex = argv.indexOf('--file');
    if (fileIndex >= 0 && argv[fileIndex + 1]) {
        options.file = argv[fileIndex + 1];
    }
    if (argv.includes('--git-unstaged')) options.gitUnstaged = true;
    if (argv.includes('--all')) options.all = true;
    if (argv.includes('--verify')) options.verify = true;

    const retriesIndex = argv.indexOf('--max-retries');
    if (retriesIndex >= 0 && argv[retriesIndex + 1]) {
        options.maxRetries = parseInt(argv[retriesIndex + 1], 10) || 2;
    }

    const thresholdIndex = argv.indexOf('--coverage-threshold');
    if (thresholdIndex >= 0 && argv[thresholdIndex + 1]) {
        options.coverageThreshold = parseInt(argv[thresholdIndex + 1], 10) || 50;
    }

    return options;
}

function resolveFilePath(fileArg: string): string {
    return path.isAbsolute(fileArg) ? fileArg : path.join(process.cwd(), fileArg);
}

function resolveTargetFiles(args: CliOptions): string[] {
    if (args.file) return [resolveFilePath(args.file)];
    if (args.all) return scanSourceFiles();

    const unstagedFiles = getGitUnstagedFiles();
    if (unstagedFiles.length > 0) return unstagedFiles;
    if (args.gitUnstaged) return [];

    return scanSourceFiles();
}

// ---------------------------------------------------------------------------
// Per-file test generation  (extracted so verify can re-call on retry)
// ---------------------------------------------------------------------------

/**
 * Generates (or regenerates) a test file for the given source file.
 * Returns the absolute path of the written test file, or null if skipped.
 */
function generateTestForFile(
    filePath: string,
    { project, checker }: ParserContext,
): string | null {
    const sourceFile = getSourceFile(project, filePath);

    // Skip test utility files (renderWithProviders, test helpers, etc.)
    if (isTestUtilityFile(filePath)) {
        console.log('  - Test utility file detected. Skipping (not a file to generate tests for).');
        return null;
    }

    // Skip browser-only / untestable files (MSW handlers, mock data, etc.)
    if (isUntestableFile(filePath)) {
        console.log('  - Browser-only file detected. Skipping (cannot run in Node.js/Jest).');
        return null;
    }

    const testFilePath = getTestFilePath(filePath);

    // --- Barrel / index file ---
    const isBarrel = isBarrelFile(filePath, sourceFile.getText());
    if (isBarrel) {
        console.log(`  - Barrel file detected. Writing test: ${testFilePath}`);
        const barrelTest = generateBarrelTest(sourceFile, testFilePath, filePath);
        if (barrelTest) {
            writeFile(testFilePath, barrelTest);
            console.log('  - Barrel test file generated/updated.');
            return testFilePath;
        }
        console.log('  - No named exports found in barrel. Skipping.');
        return null;
    }

    // --- Context provider file ---
    const isContextFile = isContextProviderFile(filePath, sourceFile.getText());
    if (isContextFile) {
        console.log('  - Context provider file detected. Generating context tests...');
        const contextTest = generateContextTest(sourceFile, checker, testFilePath, filePath);
        if (contextTest) {
            console.log(`  - Writing context test file: ${testFilePath}`);
            writeFile(testFilePath, contextTest);
            console.log('  - Context test file generated/updated.');
            return testFilePath;
        }
        // Fall through to component/utility generation if context gen fails
    }

    // --- Service / utility / component ---
    const fileContent = sourceFile.getText();
    const isService = isServiceFile(filePath, fileContent);
    const components = analyzeSourceFile(sourceFile, project, checker);

    if (components.length === 0) {
        const fileType = isService ? ('service' as const) : ('utility' as const);
        console.log(`  - No React components found. Generating ${fileType} tests...`);
        const utilityTest = generateUtilityTest(sourceFile, checker, testFilePath, filePath, fileType);
        if (utilityTest) {
            console.log(`  - Writing ${fileType} test file: ${testFilePath}`);
            writeFile(testFilePath, utilityTest);
            console.log(`  - ${fileType} test file generated/updated.`);
            return testFilePath;
        }
        console.log('  - No exported functions found. Skipping.');
        return null;
    }

    console.log(`  - Writing test file: ${testFilePath}`);
    const generatedTest = generateTests(components, {
        pass: 2,
        testFilePath,
        sourceFilePath: filePath,
    });
    writeFile(testFilePath, generatedTest);
    console.log('  - Test file generated/updated.');
    return testFilePath;
}

// ---------------------------------------------------------------------------
// Jest runner
// ---------------------------------------------------------------------------

/** Temporary output directory (relative to expense-manager cwd) */
const VERIFY_DIR = '.testgen-results';

function runJestOnTestFile(testFilePath: string, sourceFilePath: string): JestRunResult {
    const cwd = process.cwd();
    const relTest = path.relative(cwd, testFilePath).replace(/\\/g, '/');
    const relSrc = path.relative(cwd, sourceFilePath).replace(/\\/g, '/');
    const resultFile = path.join(cwd, VERIFY_DIR, 'jest-result.json');
    const coverageDir = path.join(cwd, VERIFY_DIR, 'coverage');

    // Ensure output dir exists; clean stale result
    fs.mkdirSync(path.join(cwd, VERIFY_DIR), { recursive: true });
    if (fs.existsSync(resultFile)) fs.unlinkSync(resultFile);

    // Escape the path for use as a jest regex pattern
    const pathPattern = relTest.replace(/\./g, '\\.').replace(/[\[\]()^$*+?{}|]/g, '\\$&');

    const jestArgs = [
        `--testPathPattern="${pathPattern}"`,
        `--collectCoverageFrom="${relSrc}"`,
        '--coverage',
        '--coverageReporters=json-summary',
        `--coverageDirectory="${coverageDir}"`,
        '--json',
        `--outputFile="${resultFile}"`,
        '--forceExit',
        '--passWithNoTests',
        '--silent',
    ].join(' ');

    let errorOutput = '';
    try {
        execSync(`npx jest ${jestArgs}`, { cwd, encoding: 'utf8', stdio: 'pipe' });
    } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string; message?: string };
        errorOutput = err.stderr ?? err.stdout ?? err.message ?? 'Unknown jest error';
    }

    // --- Parse jest JSON output ---
    let passed = false;
    let numTests = 0;
    let numFailed = 0;

    try {
        if (fs.existsSync(resultFile)) {
            const jestOut = JSON.parse(fs.readFileSync(resultFile, 'utf8')) as {
                success?: boolean;
                numTotalTests?: number;
                numFailedTests?: number;
            };
            numTests = jestOut.numTotalTests ?? 0;
            numFailed = jestOut.numFailedTests ?? 0;
            // Consider passing when all tests pass (including 0 tests = nothing to fail)
            passed = numFailed === 0;
        }
    } catch {
        /* result file missing or malformed — keep defaults */
    }

    // --- Parse coverage for the specific source file ---
    let coverage = 0;
    try {
        const covFile = path.join(coverageDir, 'coverage-summary.json');
        if (fs.existsSync(covFile)) {
            const cov = JSON.parse(fs.readFileSync(covFile, 'utf8')) as Record<
                string,
                { lines?: { pct: number }; statements?: { pct: number } }
            >;
            // Match by filename (coverage keys are absolute paths on most OS)
            const basename = path.basename(sourceFilePath);
            const matchKey = Object.keys(cov).find(
                (k) => k.endsWith(basename) || k.replace(/\\/g, '/').endsWith(relSrc),
            );
            const entry = matchKey ? cov[matchKey] : cov['total'];
            coverage = entry?.lines?.pct ?? entry?.statements?.pct ?? 0;
        }
    } catch {
        /* ignore coverage parse errors */
    }

    return { passed, numTests, numFailed, coverage, errorOutput };
}

// ---------------------------------------------------------------------------
// Verify-and-retry orchestrator
// ---------------------------------------------------------------------------

function verifyAndRetry(
    filePath: string,
    testFilePath: string,
    ctx: ParserContext,
    maxRetries: number,
    coverageThreshold: number,
): VerifyResult {
    let lastResult: JestRunResult = { passed: false, numTests: 0, numFailed: 0, coverage: 0, errorOutput: '' };

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        // On subsequent attempts, regenerate the test file first
        if (attempt > 1) {
            console.log(`  🔄 Retry ${attempt - 1}/${maxRetries} — regenerating test file...`);
            generateTestForFile(filePath, ctx);
        }

        console.log(`  ▶  Running jest (attempt ${attempt}/${maxRetries + 1})...`);
        lastResult = runJestOnTestFile(testFilePath, filePath);

        const { passed, numTests, numFailed, coverage } = lastResult;

        if (!passed) {
            console.log(`  ❌ ${numFailed}/${numTests} test(s) failed`);
            if (attempt < maxRetries + 1) continue; // will retry
        } else if (coverage < coverageThreshold) {
            console.log(
                `  ⚠️  Tests pass (${numTests}) but coverage ${coverage.toFixed(1)}% < ${coverageThreshold}% threshold`,
            );
            if (attempt < maxRetries + 1) continue; // will retry for more coverage
        } else {
            console.log(
                `  ✅ All ${numTests} test(s) pass | Coverage: ${coverage.toFixed(1)}%`,
            );
            return { status: 'pass', coverage, attempts: attempt, numTests };
        }
    }

    // All attempts exhausted
    const finalStatus: VerifyStatus = lastResult.passed ? 'low-coverage' : 'fail';
    const msg =
        finalStatus === 'fail'
            ? `Tests still failing after ${maxRetries} retries`
            : `Coverage ${lastResult.coverage.toFixed(1)}% still below ${coverageThreshold}% after ${maxRetries} retries`;
    console.log(`  ⛔ ${msg}`);

    return {
        status: finalStatus,
        coverage: lastResult.coverage,
        attempts: maxRetries + 1,
        numTests: lastResult.numTests,
    };
}

// ---------------------------------------------------------------------------
// Summary printer
// ---------------------------------------------------------------------------

const STATUS_ICON: Record<VerifyStatus, string> = {
    pass: '✅',
    fail: '❌',
    'low-coverage': '⚠️ ',
    skipped: '⏭️ ',
    generated: '📝',
};

interface SummaryRow {
    file: string;
    status: VerifyStatus;
    coverage: number;
    attempts: number;
    numTests: number;
}

function printSummary(rows: SummaryRow[]): void {
    if (rows.length === 0) return;

    const fileW = Math.max(...rows.map((r) => r.file.length), 32);
    const divider = '─'.repeat(fileW + 40);
    const header = '═'.repeat(fileW + 40);

    console.log(`\n${header}`);
    console.log(' TESTGEN SMART — VERIFY SUMMARY');
    console.log(header);
    console.log(
        `${'File'.padEnd(fileW)}  Status        Coverage  Tests  Tries`,
    );
    console.log(divider);

    let pass = 0, fail = 0, lowCov = 0, skipped = 0;

    for (const r of rows) {
        const icon = STATUS_ICON[r.status];
        const cov = r.coverage > 0 ? `${r.coverage.toFixed(1)}%`.padStart(7) : '      -';
        const tests = r.numTests > 0 ? String(r.numTests).padStart(5) : '    -';
        const tries = r.attempts > 0 ? String(r.attempts).padStart(5) : '    -';
        console.log(`${r.file.padEnd(fileW)}  ${icon} ${r.status.padEnd(12)} ${cov}  ${tests}  ${tries}`);

        if (r.status === 'pass') pass++;
        else if (r.status === 'fail') fail++;
        else if (r.status === 'low-coverage') lowCov++;
        else skipped++;
    }

    console.log(divider);
    console.log(
        ` Total: ${rows.length}  |  ✅ Pass: ${pass}  |  ❌ Fail: ${fail}  |  ⚠️  Low coverage: ${lowCov}  |  ⏭️  Skipped: ${skipped}`,
    );
    console.log(header);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
    const args = parseArgs(process.argv.slice(2));
    const ctx = createParser();
    const files = resolveTargetFiles(args);

    const maxRetries = args.maxRetries ?? 2;
    const coverageThreshold = args.coverageThreshold ?? 50;

    console.log(`Found ${files.length} file(s) to process.`);
    if (args.verify) {
        console.log(
            `Verify mode ON  —  max retries: ${maxRetries}  |  coverage threshold: ${coverageThreshold}%`,
        );
    }

    if (files.length === 0) {
        console.log('No matching source files found.');
        return;
    }

    const summary: SummaryRow[] = [];

    for (const [index, filePath] of files.entries()) {
        console.log(`\n[${index + 1}/${files.length}] ${path.basename(filePath)}`);

        const testFilePath = generateTestForFile(filePath, ctx);

        if (!testFilePath) {
            summary.push({ file: path.basename(filePath), status: 'skipped', coverage: 0, attempts: 0, numTests: 0 });
            continue;
        }

        if (!args.verify) {
            summary.push({ file: path.basename(filePath), status: 'generated', coverage: 0, attempts: 0, numTests: 0 });
            continue;
        }

        // --- Verify mode: run jest + check coverage + retry ---
        const result = verifyAndRetry(filePath, testFilePath, ctx, maxRetries, coverageThreshold);
        summary.push({ file: path.basename(filePath), ...result });
    }

    // Always print summary in verify mode
    if (args.verify) {
        printSummary(summary);

        // Exit with non-zero code if any test file is still failing
        const hasFailures = summary.some((r) => r.status === 'fail');
        if (hasFailures) process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// File classifier helpers
// ---------------------------------------------------------------------------

function isServiceFile(filePath: string, content: string): boolean {
    const basename = path.basename(filePath).toLowerCase();
    if (/service|api|client|repository|gateway|adapter/i.test(basename)) return true;
    const hasHttpClient =
        content.includes('axios') ||
        content.includes('fetch(') ||
        content.includes('ky.') ||
        content.includes('got.');
    const hasAsyncMethods = (content.match(/async\s/g) || []).length >= 2;
    return hasHttpClient && hasAsyncMethods;
}

function isContextProviderFile(filePath: string, content: string): boolean {
    const basename = path.basename(filePath).toLowerCase();
    if (basename.includes('context')) return true;
    return (
        content.includes('createContext') &&
        (content.includes('Provider') || content.includes('useContext'))
    );
}

function isTestUtilityFile(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    for (const dir of TEST_UTILITY_PATTERNS.directories) {
        if (normalized.includes(dir)) return true;
    }
    if (
        normalized.includes('/testUtils/') ||
        normalized.includes('/testHelpers/') ||
        normalized.includes('/testing/')
    ) {
        return true;
    }
    const basename = path.basename(filePath, path.extname(filePath));
    for (const pattern of TEST_UTILITY_PATTERNS.filenamePatterns) {
        if (pattern.test(basename)) return true;
    }
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
    if (!/^index\.(ts|tsx)$/.test(basename)) return false;
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length === 0) return false;
    const exportLines = lines.filter((l) => /^\s*(export\s|import\s)/.test(l));
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
