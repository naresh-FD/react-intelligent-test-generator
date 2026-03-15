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

import path from 'node:path';
import fs from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { createParser, getSourceFile } from './parser';
import { analyzeSourceFile } from './analyzer';
import { scanSourceFiles, getTestFilePath, isTestFile } from './utils/path';
import { writeFile } from './fs';
import { generateTests } from './generator';
import { generateBarrelTest } from './generator/barrel';
import { generateUtilityTest } from './generator/utility';
import { generateContextTest } from './generator/context';
import { TEST_UTILITY_PATTERNS, UNTESTABLE_PATTERNS } from './config';
import { detectTestFramework, type TestFramework } from './utils/framework';
import {
  classifyFailure,
  loadMemory,
  saveMemory,
  recordOutcome,
  promotableStrategies,
  selectAndApply,
  resolveStrategyName,
  createSessionReport,
  addFileReport,
  printHealReport,
} from './heal';
import type {
  ClassifiedFailure,
  HealMemoryData,
  HealAttempt,
  HealFileReport,
  HealSessionReport,
} from './heal';

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
  /** Classified failure information */
  classified: ClassifiedFailure;
}

type VerifyStatus = 'pass' | 'fail' | 'low-coverage' | 'skipped' | 'generated';

interface VerifyResult {
  status: VerifyStatus;
  coverage: number;
  attempts: number;
  numTests: number;
  /** Concise reason why the test failed (first error line) */
  failureReason?: string;
  /** Heal file report for this file */
  healReport?: HealFileReport;
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
    const parsed = Number.parseInt(argv[retriesIndex + 1], 10);
    options.maxRetries = Number.isNaN(parsed) ? 2 : parsed;
  }

  const thresholdIndex = argv.indexOf('--coverage-threshold');
  if (thresholdIndex >= 0 && argv[thresholdIndex + 1]) {
    const parsed = Number.parseInt(argv[thresholdIndex + 1], 10);
    options.coverageThreshold = Number.isNaN(parsed) ? 50 : parsed;
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

function normalizeSlashes(value: string): string {
  return value.split('\\').join('/');
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

function runJestOnTestFile(testFilePath: string, sourceFilePath: string): JestRunResult {
  const cwd = process.cwd();
  const relTest = normalizeSlashes(path.relative(cwd, testFilePath));
  const relSrc = normalizeSlashes(path.relative(cwd, sourceFilePath));
  const framework = detectTestFramework(cwd);
  const resultFile = path.join(cwd, VERIFY_DIR, `${framework}-result.json`);
  const coverageDir = path.join(cwd, VERIFY_DIR, 'coverage');

  // Ensure output dir exists; clean stale result
  fs.mkdirSync(path.join(cwd, VERIFY_DIR), { recursive: true });
  if (fs.existsSync(resultFile)) fs.unlinkSync(resultFile);

  // Escape the path for use as a jest regex pattern
  const pathPattern = escapeRegex(relTest);
  const command = process.execPath;
  let runnerArgs: string[];
  try {
    runnerArgs = buildVerifyRunnerArgs(framework, cwd, relTest, relSrc, pathPattern, resultFile, coverageDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to resolve test runner.';
    return {
      passed: false,
      numTests: 0,
      numFailed: 0,
      coverage: 0,
      errorOutput: message,
      classified: {
        failureClass: 'unknown',
        reason: message,
        rawOutput: message,
      },
    };
  }

  let errorOutput = '';
  try {
    execFileSync(command, runnerArgs, { cwd, encoding: 'utf8', stdio: 'pipe' });
  } catch (e: unknown) {
    const err = e as {
      stdout?: unknown;
      stderr?: unknown;
      output?: unknown;
      stack?: string;
      message?: string;
    };
    errorOutput =
      normalizeProcessText(err.stderr) ||
      normalizeProcessText(err.stdout) ||
      normalizeProcessText(err.output) ||
      err.stack ||
      err.message ||
      'Unknown test runner error';
  }

  // --- Parse jest JSON output ---
  let passed = false;
  let numTests = 0;
  let numFailed = 0;
  let firstFailureOutput = '';
  let suiteFailureOutput = '';

  try {
    if (fs.existsSync(resultFile)) {
      const jestOut = JSON.parse(fs.readFileSync(resultFile, 'utf8')) as {
        success?: boolean;
        numTotalTests?: number;
        numFailedTests?: number;
        numFailedTestSuites?: number;
        numRuntimeErrorTestSuites?: number;
        message?: string;
        testResults?: Array<{
          message?: string;
          testExecError?: { message?: string };
          testResults?: Array<{
            status?: string;
            fullName?: string;
            failureMessages?: string[];
          }>;
        }>;
      };
      numTests = jestOut.numTotalTests ?? 0;
      numFailed = jestOut.numFailedTests ?? 0;
      const failedSuites =
        (jestOut.numFailedTestSuites ?? 0) + (jestOut.numRuntimeErrorTestSuites ?? 0);
      // A verify run only passes when the runner itself reports success, no suite/test failures
      // are present, and at least one test actually executed.
      passed = jestOut.success === true && numFailed === 0 && failedSuites === 0 && numTests > 0;

      // Extract first failure message from JSON for precise error reporting
      if (jestOut.testResults) {
        for (const suite of jestOut.testResults) {
          if (!suiteFailureOutput) {
            suiteFailureOutput =
              suite.testExecError?.message?.trim() || suite.message?.trim() || suiteFailureOutput;
          }
          for (const test of suite.testResults ?? []) {
            if (test.status === 'failed' && test.failureMessages?.length) {
              firstFailureOutput = test.failureMessages[0];
              break;
            }
          }
          if (firstFailureOutput) break;
        }
      }
      if (!suiteFailureOutput) {
        suiteFailureOutput = jestOut.message?.trim() ?? '';
      }
    }
  } catch {
    /* result file missing or malformed — keep defaults */
  }

  // Use the best available runner output for classification. Zero executed tests should never
  // be treated as a coverage problem.
  const noTestsReason =
    !passed && numTests === 0
      ? 'No tests were executed for this generated file. The test runner reported zero executed tests or a suite-level setup error.'
      : '';
  const classificationInput = firstFailureOutput || suiteFailureOutput || errorOutput || noTestsReason;
  const classified = classifyFailure(classificationInput);

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
        (k) => k.endsWith(basename) || normalizeSlashes(k).endsWith(relSrc)
      );
      const entry = matchKey ? cov[matchKey] : cov['total'];
      coverage = normalizeCoverageValue(entry?.lines?.pct ?? entry?.statements?.pct ?? 0);
    }
  } catch {
    /* ignore coverage parse errors */
  }

  return { passed, numTests, numFailed, coverage, errorOutput, classified };
}

function normalizeCoverageValue(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeProcessText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeProcessText(item))
      .filter((item) => item.trim().length > 0)
      .join('\n');
  }
  return '';
}

function isNonRetriableVerifyFailure(result: JestRunResult): boolean {
  const text = `${result.classified.reason}\n${result.errorOutput}\n${result.classified.rawOutput}`;
  return (
    /Install the workspace test runner before using --verify\./.test(text) ||
    /failed to load config/i.test(text) ||
    /spawn EPERM/i.test(text)
  );
}

function buildVerifyRunnerArgs(
  framework: TestFramework,
  cwd: string,
  relTest: string,
  relSrc: string,
  jestPathPattern: string,
  resultFile: string,
  coverageDir: string,
): string[] {
  if (framework === 'vitest') {
    const vitestEntry = resolveNodeModuleBinary(cwd, ['vitest', 'vitest.mjs']);
    return [
      vitestEntry,
      'run',
      relTest,
      '--reporter=json',
      `--outputFile=${resultFile}`,
      '--coverage.enabled',
      '--coverage.reporter=json-summary',
      `--coverage.reportsDirectory=${coverageDir}`,
      '--passWithNoTests',
      '--silent',
    ];
  }

  const jestEntry = resolveNodeModuleBinary(cwd, ['jest', 'bin', 'jest.js']);
  return [
    jestEntry,
    `--testPathPattern=${jestPathPattern}`,
    `--collectCoverageFrom=${relSrc}`,
    '--coverage',
    '--coverageReporters=json-summary',
    `--coverageDirectory=${coverageDir}`,
    '--json',
    `--outputFile=${resultFile}`,
    '--forceExit',
    '--passWithNoTests',
    '--silent',
  ];
}

function resolveNodeModuleBinary(startDir: string, binarySegments: string[]): string {
  let current = startDir;
  while (true) {
    const candidate = path.join(current, 'node_modules', ...binarySegments);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  throw new Error(
    `Unable to resolve ${binarySegments.join('/')} from ${startDir}. Install the workspace test runner before using --verify.`,
  );
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
  memory: HealMemoryData
): VerifyResult {
  const healAttempts: HealAttempt[] = [];
  let lastResult: JestRunResult = {
    passed: false,
    numTests: 0,
    numFailed: 0,
    coverage: 0,
    errorOutput: '',
    classified: { failureClass: 'unknown', reason: '', rawOutput: '' },
  };

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    // On subsequent attempts, try targeted repair first, then fall back to regeneration
    if (attempt > 1) {
      const failure = lastResult.classified;
      const strategyName = resolveStrategyName(failure, memory);

      console.log(
        `  🔄 Retry ${attempt - 1}/${maxRetries} — [${failure.failureClass}] → ${strategyName}`
      );

      // Try targeted repair
      const repair = selectAndApply(failure, testFilePath, filePath, memory);
      if (repair) {
        // Write repaired content
        fs.writeFileSync(testFilePath, repair.content, 'utf8');
        console.log(`     Applied repair: ${repair.strategyName}`);
      } else {
        // No targeted repair available — full regeneration
        console.log(`     Full regeneration (no targeted repair available)`);
        generateTestForFile(filePath, ctx);
      }
    }

    const framework = detectTestFramework(process.cwd());
    console.log(`  ▶  Running ${framework} (attempt ${attempt}/${maxRetries + 1})...`);
    lastResult = runJestOnTestFile(testFilePath, filePath);

    const { passed, numTests, numFailed, classified } = lastResult;
    const coverage = normalizeCoverageValue(lastResult.coverage);
    lastResult = { ...lastResult, coverage };

    if (!passed) {
      console.log(`  ❌ ${numFailed}/${numTests} test(s) failed  [${classified.failureClass}]`);
      if (classified.reason) {
        console.log(`     Reason: ${classified.reason}`);
      }

      // Record the failed attempt for memory + reporting
      const strategyUsed = attempt === 1 ? 'initial_generation' : resolveStrategyName(classified, memory);
      healAttempts.push({
        attempt,
        failureClass: classified.failureClass,
        reason: classified.reason,
        strategyApplied: strategyUsed,
        succeeded: false,
      });
      if (attempt > 1) {
        recordOutcome(memory, classified.failureClass, strategyUsed, false);
      }

      if (attempt < maxRetries + 1) {
        if (!isNonRetriableVerifyFailure(lastResult)) {
          continue; // will retry
        }
        break;
      }
    } else if (coverage < coverageThreshold) {
      console.log(
        `  ⚠️  Tests pass (${numTests}) but coverage ${coverage.toFixed(1)}% < ${coverageThreshold}% threshold`
      );
      if (attempt < maxRetries + 1) continue; // will retry for more coverage
    } else {
      console.log(`  ✅ All ${numTests} test(s) pass | Coverage: ${coverage.toFixed(1)}%`);

      // Record success in memory
      if (attempt > 1) {
        const strategyUsed = resolveStrategyName(lastResult.classified, memory);
        recordOutcome(memory, lastResult.classified.failureClass, strategyUsed, true);
        healAttempts.push({
          attempt,
          failureClass: lastResult.classified.failureClass,
          reason: '',
          strategyApplied: strategyUsed,
          succeeded: true,
        });
      }

      const healReport: HealFileReport = {
        file: path.basename(filePath),
        testFile: path.basename(testFilePath),
        status: attempt === 1 ? 'passed_first_try' : 'healed',
        attempts: healAttempts,
        finalCoverage: coverage,
        totalAttempts: attempt,
      };

      return { status: 'pass', coverage, attempts: attempt, numTests, healReport };
    }
  }

  // All attempts exhausted
  const finalStatus: VerifyStatus = lastResult.passed ? 'low-coverage' : 'fail';
  const finalCoverage = normalizeCoverageValue(lastResult.coverage);
  const attemptsUsed = healAttempts.length > 0 ? healAttempts.length : maxRetries + 1;
  const retriesUsed = Math.max(0, attemptsUsed - 1);
  const msg =
    finalStatus === 'fail'
      ? `Tests still failing after ${retriesUsed} retries`
      : `Coverage ${finalCoverage.toFixed(1)}% still below ${coverageThreshold}% after ${retriesUsed} retries`;
  console.log(`  ⛔ ${msg}`);

  const healReport: HealFileReport = {
    file: path.basename(filePath),
    testFile: path.basename(testFilePath),
    status: 'failed',
    attempts: healAttempts,
    finalCoverage: finalCoverage,
    totalAttempts: attemptsUsed,
  };

  return {
    status: finalStatus,
    coverage: finalCoverage,
    attempts: attemptsUsed,
    numTests: lastResult.numTests,
    failureReason: lastResult.classified.reason || undefined,
    healReport,
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
    const coverage = normalizeCoverageValue(r.coverage);
    const cov = coverage > 0 ? `${coverage.toFixed(1)}%`.padStart(7) : '      -';
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
      `Verify mode ON  —  max retries: ${maxRetries}  |  coverage threshold: ${coverageThreshold}%`
    );
  }

  if (files.length === 0) {
    console.log('No matching source files found.');
    return;
  }

  // Load persistent healing memory
  const memory = args.verify ? loadMemory() : {};
  const healSession = args.verify ? createSessionReport() : null;

  const summary: SummaryRow[] = [];

  for (const [index, filePath] of files.entries()) {
    console.log(`\n[${index + 1}/${files.length}] ${path.basename(filePath)}`);

    const testFilePath = generateTestForFile(filePath, ctx);

    if (!testFilePath) {
      summary.push({
        file: path.basename(filePath),
        status: 'skipped',
        coverage: 0,
        attempts: 0,
        numTests: 0,
      });
      if (healSession) {
        addFileReport(healSession, {
          file: path.basename(filePath),
          testFile: '',
          status: 'skipped',
          attempts: [],
          finalCoverage: 0,
          totalAttempts: 0,
        });
      }
      continue;
    }

    if (!args.verify) {
      summary.push({
        file: path.basename(filePath),
        status: 'generated',
        coverage: 0,
        attempts: 0,
        numTests: 0,
      });
      continue;
    }

    // --- Verify mode: run jest + check coverage + retry with self-healing ---
    const result = verifyAndRetry(
      filePath,
      testFilePath,
      ctx,
      maxRetries,
      coverageThreshold,
      memory
    );
    summary.push({ file: path.basename(filePath), ...result });

    if (healSession && result.healReport) {
      addFileReport(healSession, result.healReport);
    }
  }

  // Always print summary in verify mode
  if (args.verify) {
    printSummary(summary);

    // Save healing memory
    saveMemory(memory);

    // Check for promotable strategies and attach to session report
    if (healSession) {
      healSession.promotions = promotableStrategies(memory);
      printHealReport(healSession);
    }

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
