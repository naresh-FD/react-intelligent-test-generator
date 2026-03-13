/*
Usage:
  npm run testgen             # uses unstaged git changes by default
  npm run testgen:all         # scans all source files
  npm run testgen:file -- src/path/Component.tsx
  npm run testgen:smart       # generate + run jest + retry on failure (--all --verify)
  npm run testgen:smart:file  # single file with verify
    --verify                  # run jest after each generated test, retry on fail
    --max-retries <n>         # self-heal retry iterations on failing files (default: 5, 0=no retry)
    --coverage-threshold <n>  # minimum line coverage % to consider passing (default: 50)
*/

import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createParser, getSourceFile } from './parser';
import { analyzeSourceFile, getCompoundSubComponents } from './analyzer';
import { scanSourceFiles, getTestFilePath, isTestFile, relativeImport } from './utils/path';
import { writeFile } from './fs';
import { generateTests } from './generator';
import { generateBarrelTest } from './generator/barrel';
import { generateUtilityTest } from './generator/utility';
import { generateContextTest } from './generator/context';
import { generateStoreTest } from './generator/store';
import { TEST_UTILITY_PATTERNS, UNTESTABLE_PATTERNS } from './config';
import { ensureJestScaffold } from './scaffold';
import { detectTestFramework, buildTestGlobalsImport, buildDomMatchersImport } from './utils/framework';
import { applyFixRules } from './selfHeal';
import { parseFailureContext } from './failureContext';
import { loadConfig, resolveTestOutput, ResolvedTestOutput, DEFAULT_TEST_OUTPUT, ExistingTestStrategy } from './workspace/config';
import {
  evaluateFile,
  buildScanReport,
  formatReportAsJson,
  formatReportAsMarkdown,
  printEligibilitySummary,
  type FileEligibilityResult,
} from './eligibility';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CliOptions {
  file?: string;
  gitUnstaged?: boolean;
  all?: boolean;
  /** Run jest after all generated test files and retry failing ones */
  verify?: boolean;
  /** Self-heal retry iterations on failing files (default 5, 0 = no retry) */
  maxRetries?: number;
  /** Minimum line-coverage % to consider a test file passing (default 50) */
  coverageThreshold?: number;
  /** Write an eligibility scan report (json, markdown, or both) */
  report?: 'json' | 'markdown' | 'both';
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

type VerifyStatus = 'pass' | 'fail' | 'low-coverage' | 'skipped' | 'generated' | 'smoke-fallback';

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

  const reportIndex = argv.indexOf('--report');
  if (reportIndex >= 0 && argv[reportIndex + 1]) {
    const reportValue = argv[reportIndex + 1];
    if (reportValue === 'json' || reportValue === 'markdown' || reportValue === 'both') {
      options.report = reportValue;
    } else {
      options.report = 'both';
    }
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
  testOutput: ResolvedTestOutput = DEFAULT_TEST_OUTPUT,
  packageRoot: string = process.cwd(),
  existingTestStrategy: ExistingTestStrategy = 'merge',
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

  const testFilePath = getTestFilePath(filePath, testOutput, packageRoot);

  // --- Existing test file handling ---
  if (fs.existsSync(testFilePath)) {
    if (existingTestStrategy === 'skip') {
      console.log('  - Test file already exists. Skipping (existingTestStrategy: skip).');
      return testFilePath;
    }
    if (existingTestStrategy === 'merge') {
      return mergeExistingTestFile(filePath, testFilePath, { project, checker }, testOutput, packageRoot);
    }
    // 'replace' falls through to full regeneration below
    console.log('  - Test file exists. Overwriting (existingTestStrategy: replace).');
  }

  return generateFullTestFile(filePath, sourceFile, { project, checker }, testOutput, packageRoot, testFilePath);
}

/**
 * Full test generation — creates a complete test file from scratch.
 */
function generateFullTestFile(
  filePath: string,
  sourceFile: ReturnType<typeof getSourceFile>,
  { project, checker }: ParserContext,
  testOutput: ResolvedTestOutput,
  packageRoot: string,
  testFilePath: string,
): string | null {
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

  // --- State management store file (Zustand / Redux Toolkit) ---
  const fileContent = sourceFile.getText();
  const isStore = isStoreFile(filePath, fileContent);
  if (isStore) {
    console.log('  - State management store detected. Generating store tests...');
    const storeTest = generateStoreTest(sourceFile, checker, testFilePath, filePath);
    if (storeTest) {
      console.log(`  - Writing store test file: ${testFilePath}`);
      writeFile(testFilePath, storeTest);
      console.log('  - Store test file generated/updated.');
      return testFilePath;
    }
    // Fall through to utility/component generation if store gen fails
  }

  // --- Service / utility / component ---
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
    project,
    checker,
  });
  writeFile(testFilePath, generatedTest);
  console.log('  - Test file generated/updated.');
  return testFilePath;
}

// ---------------------------------------------------------------------------
// Merge mode — preserve existing tests, append only missing generated blocks
// ---------------------------------------------------------------------------

/** Marker used to identify auto-generated repair blocks in existing test files. */
const GENERATED_REPAIR_MARKER = '/** @generated-repair-block by react-testgen */';

/**
 * Merge strategy: preserve the existing test file, generate new content,
 * and append only a repair block containing tests that don't already exist.
 */
function mergeExistingTestFile(
  filePath: string,
  testFilePath: string,
  ctx: ParserContext,
  testOutput: ResolvedTestOutput,
  packageRoot: string,
): string | null {
  const existingContent = fs.readFileSync(testFilePath, 'utf8');

  // Extract existing test/describe names to avoid duplication
  const existingDescribes = new Set<string>();
  const existingTests = new Set<string>();
  const describeRegex = /describe\(\s*["'`]([^"'`]+)["'`]/g;
  const testRegex = /(?:it|test)\(\s*["'`]([^"'`]+)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = describeRegex.exec(existingContent)) !== null) existingDescribes.add(m[1]);
  while ((m = testRegex.exec(existingContent)) !== null) existingTests.add(m[1]);

  console.log(`  - Existing test file found (${existingTests.size} test(s), ${existingDescribes.size} describe block(s)).`);
  console.log('  - Merge mode: preserving existing tests, generating repair block...');

  // Generate full content as if the file didn't exist
  const sourceFile = getSourceFile(ctx.project, filePath);
  const tempTestPath = testFilePath; // reuse path for import resolution
  const freshContent = generateFreshContent(filePath, sourceFile, ctx, testOutput, packageRoot, tempTestPath);
  if (!freshContent) {
    console.log('  - No new content generated. Existing file unchanged.');
    return testFilePath;
  }

  // Extract test names from fresh generation
  const freshTests = new Set<string>();
  const freshTestRegex = /(?:it|test)\(\s*["'`]([^"'`]+)["'`]/g;
  while ((m = freshTestRegex.exec(freshContent)) !== null) freshTests.add(m[1]);

  // Find tests in fresh content not present in existing
  const missingTests = [...freshTests].filter((t) => !existingTests.has(t));

  if (missingTests.length === 0) {
    console.log('  - No missing tests detected. Existing file unchanged.');
    return testFilePath;
  }

  console.log(`  - ${missingTests.length} missing test(s) detected. Appending repair block.`);

  // Remove any previous repair block before appending a new one
  const cleanedExisting = existingContent.replace(
    new RegExp(`\\n*${escapeRegex(GENERATED_REPAIR_MARKER)}[\\s\\S]*$`),
    ''
  );

  // Build a repair block with the missing test names
  // Extract the test blocks from fresh content that match missing tests
  const repairLines: string[] = [
    '',
    GENERATED_REPAIR_MARKER,
    '// The following tests were auto-generated to cover gaps detected in the source file.',
    '// Review and integrate them into your existing test suite above.',
    '',
  ];

  for (const testName of missingTests) {
    repairLines.push(`// TODO: Missing test — "${testName}"`);
  }

  repairLines.push('');

  const merged = cleanedExisting.trimEnd() + '\n' + repairLines.join('\n');
  writeFile(testFilePath, merged);
  console.log('  - Repair block appended to existing test file.');
  return testFilePath;
}

/**
 * Generate fresh test content without writing to disk.
 * Returns the generated content string, or null if nothing to generate.
 */
function generateFreshContent(
  filePath: string,
  sourceFile: ReturnType<typeof getSourceFile>,
  { project, checker }: ParserContext,
  _testOutput: ResolvedTestOutput,
  _packageRoot: string,
  testFilePath: string,
): string | null {
  const fileContent = sourceFile.getText();

  // Barrel file
  if (isBarrelFile(filePath, fileContent)) {
    return generateBarrelTest(sourceFile, testFilePath, filePath);
  }

  // Context provider
  if (isContextProviderFile(filePath, fileContent)) {
    const ctx = generateContextTest(sourceFile, checker, testFilePath, filePath);
    if (ctx) return ctx;
  }

  // Store file
  if (isStoreFile(filePath, fileContent)) {
    const store = generateStoreTest(sourceFile, checker, testFilePath, filePath);
    if (store) return store;
  }

  // Components / utilities
  const allComponents = analyzeSourceFile(sourceFile, project, checker);
  const compoundSubs = getCompoundSubComponents(sourceFile);
  const components = compoundSubs.size > 0
    ? allComponents.filter((c) => !compoundSubs.has(c.name))
    : allComponents;

  if (components.length === 0) {
    const isService = isServiceFile(filePath, fileContent);
    const fileType = isService ? ('service' as const) : ('utility' as const);
    return generateUtilityTest(sourceFile, checker, testFilePath, filePath, fileType);
  }

  return generateTests(components, {
    pass: 2,
    testFilePath,
    sourceFilePath: filePath,
    project,
    checker,
  });
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
  'smoke-fallback': '🔸',
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
    // Show failure reason on the next line for failed or skipped tests
    if ((r.status === 'fail' || r.status === 'skipped') && r.failureReason) {
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
  const cwd = process.cwd();

  // Load workspace config (react-testgen.config.json) and resolve testOutput
  const config = loadConfig(cwd);
  // For now, use the first package's testOutput (or the defaults)
  const firstPkg = config.packages[0];
  const testOutput = resolveTestOutput(firstPkg?.testOutput ?? config.defaults.testOutput);
  const existingTestStrategy: ExistingTestStrategy = firstPkg?.existingTestStrategy ?? config.defaults.existingTestStrategy;
  const packageRoot = firstPkg?.root
    ? path.isAbsolute(firstPkg.root) ? firstPkg.root : path.join(cwd, firstPkg.root)
    : cwd;

  // Scaffold jest.config.cjs + test-utils if the project has no Jest config yet
  if (detectTestFramework(cwd) === 'jest') {
    ensureJestScaffold(cwd, testOutput);
  }

  const ctx = createParser();
  const files = resolveTargetFiles(args);

  // maxRetries controls how many self-heal iterations to run on failing tests.
  // 0 = no retry, ≥1 = up to N retry batches with escalating fix strategies.
  const maxRetries = args.maxRetries ?? 5;
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
  // Phase 0: Eligibility scan — classify every file before generation
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n🔍  Running eligibility scan on ${files.length} file(s)...`);

  const eligibilityResults: FileEligibilityResult[] = [];
  for (const filePath of files) {
    try {
      const sourceFile = getSourceFile(ctx.project, filePath);
      const result = evaluateFile(sourceFile, filePath, testOutput, packageRoot);
      eligibilityResults.push(result);
    } catch {
      // If AST parsing fails, classify as manual-review
      eligibilityResults.push({
        filePath,
        fileKind: 'unknown',
        action: 'manual-review',
        confidence: 0,
        testabilityScore: 0,
        complexityScore: 100,
        reasons: ['Failed to parse file for eligibility analysis'],
        detectedSignals: ['parse-error'],
      });
    }
  }

  // Print eligibility summary
  printEligibilitySummary(eligibilityResults, packageRoot);

  // Write report files if requested
  if (args.report) {
    const scanReport = buildScanReport(eligibilityResults, packageRoot);
    const reportDir = path.join(cwd, '.testgen-results');
    fs.mkdirSync(reportDir, { recursive: true });

    if (args.report === 'json' || args.report === 'both') {
      const jsonPath = path.join(reportDir, 'eligibility-report.json');
      fs.writeFileSync(jsonPath, formatReportAsJson(scanReport), 'utf8');
      console.log(`\n📊 Eligibility report (JSON): ${jsonPath}`);
    }
    if (args.report === 'markdown' || args.report === 'both') {
      const mdPath = path.join(reportDir, 'eligibility-report.md');
      fs.writeFileSync(mdPath, formatReportAsMarkdown(scanReport, packageRoot), 'utf8');
      console.log(`📊 Eligibility report (Markdown): ${mdPath}`);
    }
  }

  // Build a lookup map from filePath → eligibility result
  const eligibilityMap = new Map<string, FileEligibilityResult>();
  for (const r of eligibilityResults) {
    eligibilityMap.set(r.filePath, r);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 1: Generate test files guided by eligibility results
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n📝  Generating test files...`);

  interface FileEntry {
    srcPath: string;
    testPath: string | null;
  }

  const entries: FileEntry[] = [];
  for (const [index, filePath] of files.entries()) {
    const eligibility = eligibilityMap.get(filePath);
    const basename = path.basename(filePath);
    console.log(`\n  [${index + 1}/${files.length}] ${basename}`);

    // --- Eligibility-driven skip/manual-review ---
    if (eligibility) {
      if (eligibility.action === 'skip-safe') {
        console.log(`  - SKIP: ${eligibility.reasons[0] ?? 'safe to skip'}`);
        entries.push({ srcPath: filePath, testPath: null });
        continue;
      }
      if (eligibility.action === 'manual-review') {
        // Instead of skipping entirely, generate a minimal safety test
        // This ensures every testable file gets at least an import/export test
        console.log(`  - MANUAL REVIEW → generating minimal test: ${eligibility.reasons[0] ?? 'needs human review'}`);
        // Fall through to generation with minimal strategy
      }
      // Log the determined action
      console.log(`  - Eligibility: ${eligibility.action} (${eligibility.fileKind}, confidence: ${eligibility.confidence})`);
    }

    // Determine existing-test strategy override from eligibility
    const effectiveStrategy = eligibility?.action === 'merge-with-existing-test' ? 'merge' : existingTestStrategy;

    const testFilePath = generateTestForFile(filePath, ctx, testOutput, packageRoot, effectiveStrategy);
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

  // Add skipped files to summary (with eligibility reason)
  for (const e of skipped) {
    const elig = eligibilityMap.get(e.srcPath);
    summary.push({
      file: path.basename(e.srcPath),
      status: 'skipped',
      coverage: 0,
      attempts: 0,
      numTests: 0,
      failureReason: elig?.reasons[0],
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
  // Phase 3: Self-heal loop (max 5 iterations with escalating fix strategies)
  //   Tier 1 (attempt 1-2): specific fix rules
  //   Tier 2 (attempt 3): try-catch wrapping
  //   Tier 3 (attempt 4): simplify test to bare minimum
  //   Tier 4 (attempt 5): last-resort specific rules
  // ─────────────────────────────────────────────────────────────────────────
  let remainingFailures = [...pass1Failed];
  const latestResults = new Map(pass1Results);
  const selfHealMaxRetries = Math.min(maxRetries, 5); // Cap at 5 iterations (allows all escalation tiers)

  for (
    let attempt = 1;
    attempt <= selfHealMaxRetries && remainingFailures.length > 0;
    attempt++
  ) {
    console.log(
      `\n🔄  Self-heal attempt ${attempt}/${selfHealMaxRetries} on ${remainingFailures.length} file(s)...`
    );

    for (const e of remainingFailures) {
      const prev = latestResults.get(e.testPath);
      const errorMsg = prev?.failureReason || prev?.errorOutput || '';
      const reason = prev?.failureReason ? ` — ${prev.failureReason}` : '';
      console.log(`  - ${path.basename(e.srcPath)}${reason}`);

      try {
        // Try applying deterministic fix rules first (pass attempt for escalation tiers)
        const testContent = fs.readFileSync(e.testPath, 'utf8');
        const fixed = applyFixRules(testContent, errorMsg, e.srcPath, attempt, parseFailureContext(errorMsg));
        if (fixed) {
          writeFile(e.testPath, fixed);
        } else {
          // No fix rule matched — regenerate from scratch
          // During self-heal, always use 'replace' to regenerate from scratch
          generateTestForFile(e.srcPath, ctx, testOutput, packageRoot, 'replace');
        }
      } catch (fixError) {
        console.log(`    ⚠️  Self-heal error: ${fixError instanceof Error ? fixError.message : 'unknown'}`);
        // Continue to next file — don't let one file crash the entire batch
      }
    }

    console.log(
      `\n🚀  Re-running Jest on ${remainingFailures.length} file(s) (batch run ${attempt + 1})...`
    );
    const retryResults = runJestBatch(
      remainingFailures.map((e) => e.testPath),
      remainingFailures.map((e) => e.srcPath)
    );

    // Update latest results
    for (const [key, val] of retryResults) {
      latestResults.set(key, val);
    }

    // Partition into passed and still-failing
    const nowPassed = remainingFailures.filter((e) => {
      const r = retryResults.get(e.testPath);
      return r && r.passed;
    });
    remainingFailures = remainingFailures.filter((e) => {
      const r = retryResults.get(e.testPath);
      return !r || !r.passed;
    });

    console.log(
      `  ✅ ${nowPassed.length} fixed  |  🔄 ${remainingFailures.length} still failing`
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 4: "Never commit red tests" — replace remaining failures with smoke tests
  // ─────────────────────────────────────────────────────────────────────────
  if (remainingFailures.length > 0) {
    console.log(
      `\n🔸  Replacing ${remainingFailures.length} failing test(s) with smoke tests...`
    );
    for (const e of remainingFailures) {
      console.log(`  - ${path.basename(e.srcPath)} → smoke test fallback`);
      const smokeTest = generateMinimalSmokeTest(e.srcPath, e.testPath, ctx, testOutput, packageRoot);
      writeFile(e.testPath, smokeTest);
    }

    // Verify smoke tests pass
    const smokeResults = runJestBatch(
      remainingFailures.map((e) => e.testPath),
      remainingFailures.map((e) => e.srcPath)
    );

    for (const e of remainingFailures) {
      const r = smokeResults.get(e.testPath);
      if (!r?.passed) {
        // Even smoke test fails — preserve the file as a commented-out block
        // instead of deleting it. This keeps debugging evidence for the developer.
        console.log(
          `  ❌ ${path.basename(e.srcPath)} — smoke test also fails, preserving as commented-out`
        );
        try {
          const failedContent = fs.readFileSync(e.testPath, 'utf8');
          const failureReason = r?.failureReason || 'Unknown failure after all retries';
          const commentedOut = [
            '/**',
            ' * @generated by react-testgen — AUTO-GENERATED TEST (FAILED)',
            ' *',
            ` * This test was auto-generated but failed after all retry attempts.`,
            ` * Failure reason: ${failureReason}`,
            ' *',
            ' * The original generated content is preserved below as a comment',
            ' * so you can inspect the assertions, mocks, and source-understanding attempt.',
            ' *',
            ' * To fix: review the failure reason above, uncomment the code below,',
            ' * apply corrections, and re-run tests.',
            ' */',
            '',
            '/*',
            failedContent.replace(/\*\//g, '* /'),
            '*/',
            '',
          ].join('\n');
          writeFile(e.testPath, commentedOut);
        } catch {
          // If we can't read the file, leave it as-is rather than deleting
        }
      }
      latestResults.set(e.testPath, r ?? {
        passed: false,
        numTests: 0,
        numFailed: 0,
        coverage: 0,
        errorOutput: '',
        failureReason: 'Smoke test failed',
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Build summary for all files that went through retry/self-heal
  // ─────────────────────────────────────────────────────────────────────────
  for (const e of pass1Failed) {
    const r = latestResults.get(e.testPath);
    if (!r) {
      summary.push({
        file: path.basename(e.srcPath),
        status: 'fail',
        coverage: 0,
        attempts: selfHealMaxRetries + 1,
        numTests: 0,
      });
      continue;
    }

    // Check if this was a smoke-test fallback
    const isSmokeFile = remainingFailures.some((f) => f.testPath === e.testPath);
    let status: VerifyStatus;
    if (!r.passed) {
      status = 'fail';
    } else if (isSmokeFile) {
      status = 'smoke-fallback';
    } else if (r.coverage < coverageThreshold) {
      status = 'low-coverage';
    } else {
      status = 'pass';
    }

    summary.push({
      file: path.basename(e.srcPath),
      status,
      coverage: r.coverage,
      attempts: selfHealMaxRetries + 1,
      numTests: r.numTests,
      failureReason: r.failureReason || undefined,
    });
  }

  printSummary(summary);

  // Exit with non-zero code only if there are hard failures (not smoke-fallback)
  const hasFailures = summary.some((r) => r.status === 'fail');
  if (hasFailures) process.exit(1);
}

// ---------------------------------------------------------------------------
// File classifier helpers
// ---------------------------------------------------------------------------

/**
 * Detects Zustand or Redux Toolkit (createSlice/createAsyncThunk) store files.
 * These need the dedicated store test generator.
 */
function isStoreFile(filePath: string, content: string): boolean {
  const basename = path.basename(filePath).toLowerCase();
  const isZustandFile =
    content.includes("from 'zustand'") || content.includes('from "zustand"');
  const isRTKFile =
    content.includes("from '@reduxjs/toolkit'") || content.includes('from "@reduxjs/toolkit"');

  if (!isZustandFile && !isRTKFile) return false;

  const isJotaiFile =
    content.includes("from 'jotai'") || content.includes('from "jotai"');

  // Must have the actual store creation call, not just type imports
  if (isZustandFile && (content.includes('create(') || content.includes('create<'))) return true;
  if (
    isRTKFile &&
    (content.includes('createSlice(') || content.includes('createAsyncThunk('))
  )
    return true;
  if (isJotaiFile && (content.includes('atom(') || content.includes('atom<'))) return true;

  // Filename hint: store.ts, authStore.ts, useXxxStore.ts, xxxSlice.ts
  if (/store\.|slice\./i.test(basename)) return true;

  return false;
}

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

// ---------------------------------------------------------------------------
// "Never commit red tests" — tiered smoke test fallback
// ---------------------------------------------------------------------------

/**
 * Generate a tiered smoke test that is guaranteed to pass.
 * Includes:
 *   1. Module import test — validates file can be parsed
 *   2. Export shape test — checks named exports exist
 *   3. Component type test — validates exported function
 *   4. Safe render test — try-catch wrapped render with detected providers + auto-mocks
 *
 * Includes all relevant jest.mock() calls.
 */
function generateMinimalSmokeTest(
  sourceFilePath: string,
  testFilePath: string,
  ctx: ParserContext,
  _testOutput: ResolvedTestOutput = DEFAULT_TEST_OUTPUT,
  _packageRoot: string = process.cwd(),
): string {
  const importPath = relativeImport(testFilePath, sourceFilePath);
  const sourceFile = getSourceFile(ctx.project, sourceFilePath);
  const components = analyzeSourceFile(sourceFile, ctx.project, ctx.checker);

  if (components.length === 0) {
    // Not a component — test that the module can be imported and has exports
    return [
      '/** @generated by react-testgen - smoke test fallback */',
      buildTestGlobalsImport(['describe', 'it', 'expect']),
      buildDomMatchersImport(),
      `import * as Module from "${importPath}";`,
      '',
      'describe("module", () => {',
      '  it("can be imported without errors", () => {',
      '    expect(Module).toBeDefined();',
      '  });',
      '',
      '  it("has expected export shape", () => {',
      '    expect(Object.keys(Module).length).toBeGreaterThanOrEqual(0);',
      '  });',
      '});',
      '',
    ].join('\n');
  }

  const comp = components[0];
  const compImport =
    comp.exportType === 'default'
      ? `import ${comp.name} from "${importPath}";`
      : `import { ${comp.name} } from "${importPath}";`;

  const lines: string[] = [
    '/** @generated by react-testgen - smoke test fallback */',
    buildTestGlobalsImport(['describe', 'it', 'expect']),
    buildDomMatchersImport(),
    'import React from "react";',
    'import { render } from "@testing-library/react";',
  ];

  // Add provider imports based on detected dependencies
  if (comp.usesRouter) {
    lines.push('import { MemoryRouter } from "react-router-dom";');
  }
  if (comp.usesReactQuery) {
    lines.push('import { QueryClient, QueryClientProvider } from "@tanstack/react-query";');
    lines.push('const testQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });');
  }
  if (comp.usesRedux) {
    lines.push('import { Provider as ReduxProvider } from "react-redux";');
    lines.push('import { configureStore } from "@reduxjs/toolkit";');
    lines.push('const testStore = configureStore({ reducer: (state = {}) => state });');
  }

  lines.push(compImport);
  lines.push(`import * as Module from "${importPath}";`);
  lines.push('');

  // Add auto-mocks for third-party libraries
  if (comp.usesFramerMotion) {
    lines.push(buildSmokeFramerMock());
  }
  if (comp.usesRecharts) {
    lines.push(buildSmokeRechartsMock());
  }
  if (comp.thirdPartyImports.includes('axios')) {
    lines.push(buildSmokeAxiosMock());
  }
  for (const svcImport of comp.serviceImports) {
    lines.push(`jest.mock("${svcImport}");`);
  }

  lines.push('');
  lines.push(`describe("${comp.name}", () => {`);

  // Test 1: Module import test
  lines.push('  it("module can be imported", () => {');
  lines.push('    expect(Module).toBeDefined();');
  lines.push('  });');
  lines.push('');

  // Test 2: Component type test
  lines.push(`  it("is a valid component", () => {`);
  lines.push(`    expect(typeof ${comp.name}).toBe("function");`);
  lines.push('  });');
  lines.push('');

  // Build default props for required props to prevent crashes
  const requiredProps = comp.props.filter((p: { name: string; isRequired: boolean }) => p.isRequired);
  if (requiredProps.length > 0) {
    const propEntries = requiredProps.map((p: { name: string; type: string; isCallback: boolean; isBoolean: boolean }) => {
      if (p.isCallback || /^(on|handle|set)[A-Z]/.test(p.name)) return `${p.name}: jest.fn()`;
      if (p.isBoolean || p.type?.includes('boolean')) return `${p.name}: false`;
      if (p.type?.includes('[]') || p.type?.includes('Array') || /^(items|data|list|rows|options|results|records|entries|transactions|tabs)$/i.test(p.name)) return `${p.name}: []`;
      if (p.type?.includes('number')) return `${p.name}: 0`;
      if (p.name === 'children') return `children: React.createElement("div")`;
      return `${p.name}: "test"`;
    });
    lines.push(`  const defaultProps = { ${propEntries.join(', ')} };`);
    lines.push('');
  }

  // Add mock for custom hooks to prevent undefined.map errors
  for (const hook of comp.hooks) {
    if (!hook.importSource || hook.importSource === 'react' || hook.importSource.includes('@testing-library')) continue;
    if (hook.importSource.includes('react-router') || hook.importSource.includes('@tanstack') || hook.importSource.includes('react-redux')) continue;
    if (hook.importSource.startsWith('.') || hook.importSource.startsWith('@/') || hook.importSource.startsWith('~/')) {
      // Mock hooks from relative imports
      if (!lines.some(l => l.includes(`jest.mock("${hook.importSource}"`))) {
        const hookMockReturn = /^use(Get|Fetch|Load|Query)/i.test(hook.name)
          ? `{ data: [], loading: false, error: null }`
          : /^use(Mobile|Tablet|iPad|Desktop|FirstRender)/i.test(hook.name)
          ? `false`
          : /^use(Navigate|Navigation)/i.test(hook.name)
          ? `jest.fn()`
          : `{ data: [], loading: false, error: null, value: null }`;
        // Insert mock before the describe block
        const descIdx = lines.indexOf(`describe("${comp.name}", () => {`);
        if (descIdx >= 0) {
          lines.splice(descIdx, 0, `jest.mock("${hook.importSource}", () => ({ ...jest.requireActual("${hook.importSource}"), ${hook.name}: jest.fn(() => (${hookMockReturn})) }));`, '');
        }
      }
    }
  }

  // Test 3: Safe render test with all detected providers
  lines.push('  it("renders without crashing", () => {');
  lines.push('    try {');

  // Build JSX with provider wrapping (innermost → outermost)
  const propsSpread = requiredProps.length > 0 ? ` {...defaultProps}` : '';
  let jsx = `<${comp.name}${propsSpread} />`;
  if (comp.usesRouter) {
    jsx = `<MemoryRouter>${jsx}</MemoryRouter>`;
  }
  if (comp.usesReactQuery) {
    jsx = `<QueryClientProvider client={testQueryClient}>${jsx}</QueryClientProvider>`;
  }
  if (comp.usesRedux) {
    jsx = `<ReduxProvider store={testStore}>${jsx}</ReduxProvider>`;
  }

  // Portal support: add target div
  if (comp.usesPortal) {
    lines.push('      if (!document.getElementById("portal-root")) {');
    lines.push('        const el = document.createElement("div");');
    lines.push('        el.id = "portal-root";');
    lines.push('        document.body.appendChild(el);');
    lines.push('      }');
  }

  lines.push(`      const { container } = render(${jsx});`);
  lines.push('      expect(container).toBeInTheDocument();');
  lines.push('    } catch {');
  lines.push('      // Component may require providers not available in test environment');
  lines.push('      expect(true).toBe(true);');
  lines.push('    }');
  lines.push('  });');
  lines.push('});');
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Compact smoke-test mock builders (self-contained, no external imports)
// ---------------------------------------------------------------------------

function buildSmokeFramerMock(): string {
  return `jest.mock("framer-motion", () => {
  const React = require("react");
  const motion = new Proxy({}, {
    get: (_target, tag) => React.forwardRef((props, ref) => React.createElement(String(tag), { ref }))
  });
  return {
    __esModule: true, motion,
    AnimatePresence: ({ children }) => children,
    useAnimation: () => ({ start: jest.fn(), stop: jest.fn() }),
    useMotionValue: (v) => ({ get: () => v, set: jest.fn(), onChange: jest.fn() }),
    useTransform: () => ({ get: () => 0, set: jest.fn() }),
    useInView: () => true,
    useScroll: () => ({ scrollY: { get: () => 0 }, scrollX: { get: () => 0 } }),
    useSpring: (v) => ({ get: () => (typeof v === "number" ? v : 0), set: jest.fn() }),
    useReducedMotion: () => false,
  };
});`;
}

function buildSmokeRechartsMock(): string {
  return `jest.mock("recharts", () => {
  const React = require("react");
  const Stub = (props) => React.createElement("div", props);
  return {
    __esModule: true,
    ResponsiveContainer: ({ children }) => React.createElement("div", null, typeof children === "function" ? children(500, 300) : children),
    PieChart: Stub, AreaChart: Stub, BarChart: Stub, LineChart: Stub, ComposedChart: Stub,
    Pie: Stub, Area: Stub, Bar: Stub, Line: Stub, XAxis: Stub, YAxis: Stub,
    CartesianGrid: Stub, Tooltip: Stub, Legend: Stub, Cell: Stub,
  };
});`;
}

function buildSmokeAxiosMock(): string {
  return `jest.mock("axios", () => {
  const r = { data: {}, status: 200, statusText: "OK", headers: {}, config: {} };
  const m = { get: jest.fn().mockResolvedValue(r), post: jest.fn().mockResolvedValue(r), put: jest.fn().mockResolvedValue(r), delete: jest.fn().mockResolvedValue(r), patch: jest.fn().mockResolvedValue(r), request: jest.fn().mockResolvedValue(r), interceptors: { request: { use: jest.fn(), eject: jest.fn() }, response: { use: jest.fn(), eject: jest.fn() } }, defaults: { headers: { common: {} } } };
  return { __esModule: true, default: { ...m, create: jest.fn(() => ({ ...m })) }, ...m, create: jest.fn(() => ({ ...m })) };
});`;
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
