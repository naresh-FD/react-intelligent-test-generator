/*
Usage:
  npm run testgen             # uses unstaged git changes by default
  npm run testgen:all         # scans all source files
  npm run testgen:file -- src/path/Component.tsx
  npm run testgen:smart       # generate + run jest + retry on failure (--all --verify)
  npm run testgen:smart:file  # single file with verify
    --verify                  # run jest after each generated test, retry on fail
    --max-retries <n>         # whether to do a retry batch on failing files (default: 1, 0=no retry)
    --coverage-threshold <n>  # minimum line coverage % to consider passing (default: 50)
*/

import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createParser, getSourceFile } from './parser';
import { analyzeSourceFile, getCompoundSubComponents } from './analyzer';
import { scanSourceFiles, getTestFilePath, isTestFile } from './utils/path';
import { writeFile } from './fs';
import { generateTests } from './generator';
import { generateBarrelTest } from './generator/barrel';
import { generateUtilityTest } from './generator/utility';
import { generateContextTest } from './generator/context';
import { TEST_UTILITY_PATTERNS, UNTESTABLE_PATTERNS } from './config';
import { ensureJestScaffold } from './scaffold';
import { detectTestFramework } from './utils/framework';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CliOptions {
  file?: string;
  gitUnstaged?: boolean;
  all?: boolean;
  /** Run jest after all generated test files and retry failing ones */
  verify?: boolean;
  /** Whether to do a second-pass batch retry on failing files (default 1 = yes, 0 = no) */
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
  /** Concise single-line failure reason extracted from error output */
  failureReason: string;
}

type VerifyStatus = 'pass' | 'fail' | 'low-coverage' | 'skipped' | 'generated';

type ParserContext = ReturnType<typeof createParser>;

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};

  const fileIndex = argv.indexOf('--file');
  if (fileIndex >= 0) {
    const directValue = argv[fileIndex + 1];
    if (directValue && !directValue.startsWith('--')) {
      options.file = directValue;
    } else {
      const nextNonFlagValue = argv.slice(fileIndex + 1).find((arg) => !arg.startsWith('--'));
      if (nextNonFlagValue) {
        options.file = nextNonFlagValue;
      }
    }
  }
  if (argv.includes('--git-unstaged')) options.gitUnstaged = true;
  if (argv.includes('--all')) options.all = true;
  if (argv.includes('--verify')) options.verify = true;

  const retriesIndex = argv.indexOf('--max-retries');
  if (retriesIndex >= 0 && argv[retriesIndex + 1]) {
    options.maxRetries = Number.parseInt(argv[retriesIndex + 1], 10) || 0;
  }

  const thresholdIndex = argv.indexOf('--coverage-threshold');
  if (thresholdIndex >= 0 && argv[thresholdIndex + 1]) {
    options.coverageThreshold = Number.parseInt(argv[thresholdIndex + 1], 10) || 50;
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
function generateTestForFile(filePath: string, { project, checker }: ParserContext): string | null {
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
  const allComponents = analyzeSourceFile(sourceFile, project, checker);

  // Filter out compound UI sub-components (Radix UI, cmdk, vaul, etc.) that
  // require a parent context and crash when rendered in isolation.
  const compoundSubs = getCompoundSubComponents(sourceFile);
  const components = compoundSubs.size > 0
    ? allComponents.filter((c) => !compoundSubs.has(c.name))
    : allComponents;

  if (compoundSubs.size > 0 && allComponents.length !== components.length) {
    const skipped = allComponents.filter((c) => compoundSubs.has(c.name)).map((c) => c.name);
    console.log(`  - Skipping compound sub-components (need parent context): ${skipped.join(', ')}`);
  }

  // If compound detection filtered ALL components, skip the entire file.
  // Do NOT fall through to utility test generation — the exported functions
  // are React components, not utility functions, and would crash.
  if (compoundSubs.size > 0 && components.length === 0) {
    console.log('  - All components are compound sub-components. Skipping file.');
    return null;
  }

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
// Batch Jest runner
// ---------------------------------------------------------------------------

/** Temporary output directory (relative to cwd) */
const VERIFY_DIR = '.testgen-results';

function normalizeSlashes(value: string): string {
  return value.split('\\').join('/');
}

function normalizePathForCompare(value: string): string {
  return normalizeSlashes(path.resolve(value)).toLowerCase();
}

function escapeRegex(value: string): string {
  const regexChars = new Set([
    '\\',
    '^',
    '$',
    '*',
    '+',
    '?',
    '.',
    '(',
    ')',
    '|',
    '{',
    '}',
    '[',
    ']',
  ]);
  let escaped = '';
  for (const char of value) {
    escaped += regexChars.has(char) ? `\\${char}` : char;
  }
  return escaped;
}

/**
 * Strip ANSI escape codes from a string.
 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Extract a concise, single-line failure reason from jest error output.
 * Looks for common error patterns (ReferenceError, TypeError, etc.)
 * and returns the first match, truncated to 150 chars.
 */
function extractFailureReason(rawOutput: string): string {
  const text = stripAnsi(rawOutput);
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Match common JS/TS error patterns
    if (
      /^(ReferenceError|TypeError|SyntaxError|Error|Cannot find module|expect\()/i.test(trimmed) ||
      /Test suite failed to run/i.test(trimmed) ||
      /Jest worker encountered/i.test(trimmed) ||
      /Jest encountered an unexpected token/i.test(trimmed) ||
      /Expected .+ (to |not )/.test(trimmed)
    ) {
      return trimmed.length > 150 ? `${trimmed.substring(0, 147)}...` : trimmed;
    }
  }

  return '';
}

/**
 * Detect the "src" directory for a given source file path.
 * Walks up from the file until it finds a directory named "src" within cwd,
 * then falls back to cwd/src or cwd itself.
 */
function detectSrcDir(srcFilePath: string, cwd: string): string {
  let dir = path.dirname(srcFilePath);
  while (dir !== cwd && dir !== path.dirname(dir)) {
    if (path.basename(dir) === 'src') return dir;
    dir = path.dirname(dir);
  }
  const cwdSrc = path.join(cwd, 'src');
  return fs.existsSync(cwdSrc) ? cwdSrc : cwd;
}

/**
 * Run Jest on multiple test files in a SINGLE invocation.
 * Returns a Map from absolute testFilePath → JestRunResult.
 *
 * This is the core performance fix: instead of launching Jest N×3 times
 * (once per file, up to 3 retries), we launch it at most TWICE total
 * (once for all files, once for files that still need fixing).
 */
function runJestBatch(
  testFilePaths: string[],
  sourceFilePaths: string[],
): Map<string, JestRunResult> {
  if (testFilePaths.length === 0) return new Map();

  const cwd = process.cwd();
  const resultFile = path.join(cwd, VERIFY_DIR, 'jest-result.json');
  const coverageDir = path.join(cwd, VERIFY_DIR, 'coverage');

  fs.mkdirSync(path.join(cwd, VERIFY_DIR), { recursive: true });
  if (fs.existsSync(resultFile)) fs.unlinkSync(resultFile);

  // Build a combined regex pattern matching all test file paths
  const relTestPaths = testFilePaths.map((p) => normalizeSlashes(path.relative(cwd, p)));
  const pathPattern =
    testFilePaths.length === 1
      ? escapeRegex(relTestPaths[0])
      : `(${relTestPaths.map(escapeRegex).join('|')})`;

  // Use a broad glob for coverage collection — avoids N separate --collectCoverageFrom flags
  const srcDir = detectSrcDir(sourceFilePaths[0], cwd);
  const srcDirRel = normalizeSlashes(path.relative(cwd, srcDir));
  const coverageGlob = `${srcDirRel}/**/*.{ts,tsx}`;

  const jestArgs = [
    `--testPathPattern="${pathPattern}"`,
    `--collectCoverageFrom="${coverageGlob}"`,
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
    execSync(`npx jest ${jestArgs}`, {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    errorOutput = err.stderr ?? err.stdout ?? err.message ?? 'Unknown jest error';
  }

  // Initialize results map — all files start as "failed" until we parse the JSON
  const results = new Map<string, JestRunResult>();
  const globalFailureReason = errorOutput ? extractFailureReason(errorOutput) : '';
  for (const testPath of testFilePaths) {
    results.set(testPath, {
      passed: false,
      numTests: 0,
      numFailed: 0,
      coverage: 0,
      errorOutput,
      failureReason: globalFailureReason,
    });
  }

  // --- Parse Jest JSON output — per-suite results ---
  try {
    if (fs.existsSync(resultFile)) {
      const jestOut = JSON.parse(fs.readFileSync(resultFile, 'utf8')) as {
        testResults?: Array<{
          // Jest JSON schema differs across versions:
          // - Older: testFilePath + testResults
          // - Newer: name + assertionResults
          testFilePath?: string;
          name?: string;
          status?: string;
          message?: string;
          summary?: string;
          testResults?: Array<{
            status?: string;
            failureMessages?: string[];
          }>;
          assertionResults?: Array<{
            status?: string;
            failureMessages?: string[];
          }>;
        }>;
      };

      const testPathLookup = new Map(
        testFilePaths.map((tp) => [normalizePathForCompare(tp), tp] as const)
      );

      for (const suite of jestOut.testResults ?? []) {
        const suitePath = suite.testFilePath ?? suite.name;
        if (!suitePath) continue;

        // Match by normalized absolute path (case-insensitive for Windows)
        const matchedTestPath = testPathLookup.get(normalizePathForCompare(suitePath));
        if (!matchedTestPath) continue;

        const testItems = suite.testResults ?? suite.assertionResults ?? [];
        const numFailing = testItems.filter((t) => t.status === 'failed').length;
        const numPassing = testItems.filter((t) => t.status === 'passed').length;
        const numTests = numPassing + numFailing;
        const passed =
          typeof suite.status === 'string' ? suite.status === 'passed' && numFailing === 0 : numFailing === 0;

        let failureReason = '';
        if (!passed) {
          for (const test of testItems) {
            if (test.status === 'failed' && test.failureMessages?.length) {
              failureReason = extractFailureReason(test.failureMessages[0]);
              break;
            }
          }
          if (!failureReason && suite.message) failureReason = extractFailureReason(suite.message);
          if (!failureReason && suite.summary) failureReason = extractFailureReason(suite.summary);
          if (!failureReason) failureReason = globalFailureReason;
        }

        results.set(matchedTestPath, {
          passed,
          numTests,
          numFailed: numFailing,
          coverage: 0, // filled below from coverage report
          errorOutput: passed ? '' : errorOutput,
          failureReason,
        });
      }
    }
  } catch {
    /* JSON parse error — keep defaults */
  }

  // --- Parse per-file coverage from coverage-summary.json ---
  try {
    const covFile = path.join(coverageDir, 'coverage-summary.json');
    if (fs.existsSync(covFile)) {
      const cov = JSON.parse(fs.readFileSync(covFile, 'utf8')) as Record<
        string,
        { lines?: { pct: number }; statements?: { pct: number } }
      >;

      for (let i = 0; i < testFilePaths.length; i++) {
        const testPath = testFilePaths[i];
        const srcPath = sourceFilePaths[i];
        const relSrc = normalizeSlashes(path.relative(cwd, srcPath)).toLowerCase();
        const basename = path.basename(srcPath).toLowerCase();

        const matchKey = Object.keys(cov).find(
          (k) => {
            const norm = normalizeSlashes(k).toLowerCase();
            return norm.endsWith(basename) || norm.endsWith(relSrc);
          }
        );
        if (!matchKey) continue;

        const entry = cov[matchKey];
        const rawCoverage = entry?.lines?.pct ?? entry?.statements?.pct ?? 0;
        const numericCoverage = Number(rawCoverage);
        const coverage = Number.isFinite(numericCoverage) ? numericCoverage : 0;

        const existing = results.get(testPath);
        if (existing) {
          results.set(testPath, { ...existing, coverage });
        }
      }
    }
  } catch {
    /* coverage parse error */
  }

  return results;
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
  failureReason?: string;
}

function printSummary(rows: SummaryRow[]): void {
  if (rows.length === 0) return;

  const fileW = Math.max(...rows.map((r) => r.file.length), 32);
  const divider = '─'.repeat(fileW + 40);
  const header = '═'.repeat(fileW + 40);

  console.log(`\n${header}`);
  console.log(' TESTGEN SMART — VERIFY SUMMARY');
  console.log(header);
  console.log(`${'File'.padEnd(fileW)}  Status        Coverage  Tests  Tries`);
  console.log(divider);

  let pass = 0,
    fail = 0,
    lowCov = 0,
    skipped = 0;

  for (const r of rows) {
    const icon = STATUS_ICON[r.status];
    const cov = r.coverage > 0 ? `${r.coverage.toFixed(1)}%`.padStart(7) : '      -';
    const tests = r.numTests > 0 ? String(r.numTests).padStart(5) : '    -';
    const tries = r.attempts > 0 ? String(r.attempts).padStart(5) : '    -';
    console.log(
      `${r.file.padEnd(fileW)}  ${icon} ${r.status.padEnd(12)} ${cov}  ${tests}  ${tries}`
    );
    // Show failure reason on the next line for failed tests
    if (r.status === 'fail' && r.failureReason) {
      console.log(`${''.padEnd(fileW)}     └─ ${r.failureReason}`);
    }

    if (r.status === 'pass') pass++;
    else if (r.status === 'fail') fail++;
    else if (r.status === 'low-coverage') lowCov++;
    else skipped++;
  }

  console.log(divider);
  console.log(
    ` Total: ${rows.length}  |  ✅ Pass: ${pass}  |  ❌ Fail: ${fail}  |  ⚠️  Low coverage: ${lowCov}  |  ⏭️  Skipped: ${skipped}`
  );
  console.log(header);
}

// ---------------------------------------------------------------------------
// Main — 3-phase batch architecture
// ---------------------------------------------------------------------------

async function run() {
  const args = parseArgs(process.argv.slice(2));

  // Scaffold jest.config.cjs + test-utils if the project has no Jest config yet
  if (detectTestFramework(process.cwd()) === 'jest') {
    ensureJestScaffold(process.cwd());
  }

  const ctx = createParser();
  const files = resolveTargetFiles(args);

  // In batch mode maxRetries controls whether a second-pass retry batch runs.
  // 0 = no retry (one Jest run total), ≥1 = do one retry batch (two Jest runs total).
  const maxRetries = args.maxRetries ?? 1;
  const coverageThreshold = args.coverageThreshold ?? 50;

  console.log(`Found ${files.length} file(s) to process.`);
  if (args.verify) {
    console.log(
      `Verify mode ON  —  coverage threshold: ${coverageThreshold}%  |  retry batch: ${maxRetries > 0 ? 'yes' : 'no'}`
    );
  }

  if (files.length === 0) {
    console.log('No matching source files found.');
    return;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 1: Generate ALL test files (fast — no Jest launches here)
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n📝  Generating test files...`);

  interface FileEntry {
    srcPath: string;
    testPath: string | null;
  }

  const entries: FileEntry[] = [];
  for (const [index, filePath] of files.entries()) {
    console.log(`\n  [${index + 1}/${files.length}] ${path.basename(filePath)}`);
    const testFilePath = generateTestForFile(filePath, ctx);
    entries.push({ srcPath: filePath, testPath: testFilePath });
  }

  const skipped = entries.filter((e) => e.testPath === null);
  const generated = entries.filter((e) => e.testPath !== null) as Array<{
    srcPath: string;
    testPath: string;
  }>;

  console.log(`\n  Generated: ${generated.length}  |  Skipped: ${skipped.length}`);

  if (!args.verify) {
    // Non-verify mode: generation only, no Jest
    return;
  }

  if (generated.length === 0) {
    console.log('No test files generated — nothing to verify.');
    return;
  }

  const summary: SummaryRow[] = [];

  // Add skipped files to summary
  for (const e of skipped) {
    summary.push({
      file: path.basename(e.srcPath),
      status: 'skipped',
      coverage: 0,
      attempts: 0,
      numTests: 0,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 2: Run Jest ONCE on ALL generated test files (single batch run)
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n🚀  Running Jest on all ${generated.length} test file(s) (batch run 1/2)...`);

  const pass1Results = runJestBatch(
    generated.map((e) => e.testPath),
    generated.map((e) => e.srcPath)
  );

  // Partition into passing and needing-retry
  const pass1Passed = generated.filter((e) => {
    const r = pass1Results.get(e.testPath);
    return r && r.passed && r.coverage >= coverageThreshold;
  });
  const pass1Failed = generated.filter((e) => {
    const r = pass1Results.get(e.testPath);
    return !r || !r.passed || r.coverage < coverageThreshold;
  });

  console.log(`\n  ✅ ${pass1Passed.length} passed  |  🔄 ${pass1Failed.length} need retry`);

  // Add first-pass passing files to summary
  for (const e of pass1Passed) {
    const r = pass1Results.get(e.testPath)!;
    summary.push({
      file: path.basename(e.srcPath),
      status: 'pass',
      coverage: r.coverage,
      attempts: 1,
      numTests: r.numTests,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 3: Regenerate failing files + ONE more batch run (optional)
  // ─────────────────────────────────────────────────────────────────────────
  if (pass1Failed.length > 0 && maxRetries > 0) {
    console.log(`\n🔄  Regenerating ${pass1Failed.length} file(s)...`);
    for (const e of pass1Failed) {
      const prev = pass1Results.get(e.testPath);
      const reason = prev?.failureReason ? ` — ${prev.failureReason}` : '';
      console.log(`  - ${path.basename(e.srcPath)}${reason}`);
      generateTestForFile(e.srcPath, ctx);
    }

    console.log(
      `\n🚀  Re-running Jest on ${pass1Failed.length} file(s) (batch run 2/2)...`
    );
    const pass2Results = runJestBatch(
      pass1Failed.map((e) => e.testPath),
      pass1Failed.map((e) => e.srcPath)
    );

    for (const e of pass1Failed) {
      // Prefer pass2 result; fall back to pass1 result if pass2 has no entry
      const r = pass2Results.get(e.testPath) ?? pass1Results.get(e.testPath);
      if (!r) {
        summary.push({
          file: path.basename(e.srcPath),
          status: 'fail',
          coverage: 0,
          attempts: 2,
          numTests: 0,
        });
        continue;
      }
      const status: VerifyStatus =
        r.passed && r.coverage >= coverageThreshold
          ? 'pass'
          : r.passed
            ? 'low-coverage'
            : 'fail';
      summary.push({
        file: path.basename(e.srcPath),
        status,
        coverage: r.coverage,
        attempts: 2,
        numTests: r.numTests,
        failureReason: r.failureReason || undefined,
      });
    }
  } else {
    // No retry requested (maxRetries=0) or nothing failed — add pass1Failed directly
    for (const e of pass1Failed) {
      const r = pass1Results.get(e.testPath);
      if (!r) {
        summary.push({
          file: path.basename(e.srcPath),
          status: 'fail',
          coverage: 0,
          attempts: 1,
          numTests: 0,
        });
        continue;
      }
      const status: VerifyStatus =
        r.passed && r.coverage >= coverageThreshold
          ? 'pass'
          : r.passed
            ? 'low-coverage'
            : 'fail';
      summary.push({
        file: path.basename(e.srcPath),
        status,
        coverage: r.coverage,
        attempts: 1,
        numTests: r.numTests,
        failureReason: r.failureReason || undefined,
      });
    }
  }

  printSummary(summary);

  // Exit with non-zero code if any test file is still failing
  const hasFailures = summary.some((r) => r.status === 'fail');
  if (hasFailures) process.exit(1);
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
  const normalized = normalizeSlashes(filePath).toLowerCase();
  const basename = path.basename(filePath).toLowerCase();

  // Strong indicators: file is in a /context/ directory with Context in name
  const isInContextDir = normalized.includes('/context/');
  const hasContextInName = basename.includes('context');

  // If it's in a context directory OR has Context in the filename, likely a context file
  if (isInContextDir || hasContextInName) {
    return (
      content.includes('createContext') &&
      (content.includes('Provider') || content.includes('useContext'))
    );
  }

  // For files NOT in context directories or without Context in name,
  // require stronger evidence: must export a Provider component
  if (content.includes('createContext')) {
    const exportMatch = content.match(/export\s+(?:const|function|class)\s+\w*Provider/i);
    const exportedProvider = content.match(/export\s*{\s*[^}]*Provider[^}]*}/i);
    return !!(exportMatch || exportedProvider);
  }

  return false;
}

function isTestUtilityFile(filePath: string): boolean {
  const normalized = normalizeSlashes(filePath);
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
  const normalized = normalizeSlashes(filePath);
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

async function main(): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

void main(); // NOSONAR - top-level await may not be compatible with current Node16/CommonJS runtime setup
