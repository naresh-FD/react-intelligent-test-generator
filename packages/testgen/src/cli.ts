/*
Usage:
  npm run testgen             # uses unstaged git changes by default
  npm run testgen:all         # scans all source files
  npm run testgen:file -- src/path/Component.tsx
  npm run testgen:smart       # generate + run jest + retry on failure (--all --verify)
  npm run testgen:smart:file  # single file with verify
  npm run testgen:heal        # generate + self-healing loop (--all --heal)
  npm run testgen:heal:file   # single file with heal
    --verify                  # run jest after each generated test, retry on fail
    --heal                    # self-healing mode: analyze failures, teach generator, regenerate
    --max-retries <n>         # how many times to retry a failing test (default: 2)
    --max-heal-attempts <n>   # max heal iterations per file (default: 3)
    --coverage-threshold <n>  # minimum line coverage % to consider passing (default: 50)
*/

import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createParser, getSourceFile } from './parser';
import { analyzeSourceFile } from './analyzer';
import { scanSourceFiles, getTestFilePath, isTestFile } from './utils/path';
import { writeFile } from './fs';
import { generateTests } from './generator';
import { generateBarrelTest } from './generator/barrel';
import { generateUtilityTest } from './generator/utility';
import { generateContextTest } from './generator/context';
import { TEST_UTILITY_PATTERNS, UNTESTABLE_PATTERNS } from './config';
import {
  heal,
  recordHealOutcome,
  isDuplicateHealAttempt,
  DEFAULT_MAX_HEAL_ATTEMPTS,
} from './healer';
import type { FailureDetail, RepairPlan, RepairAction } from './healer';
import { getActiveFramework, detectTestFramework, setActiveFramework } from './utils/framework';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CliOptions {
  file?: string;
  gitUnstaged?: boolean;
  all?: boolean;
  /** Run jest after each generated test file and retry on failure */
  verify?: boolean;
  /** Self-healing mode: analyze failures, teach generator, regenerate */
  healMode?: boolean;
  /** How many regeneration retries per file (default 2) */
  maxRetries?: number;
  /** Max heal iterations per file (default 3) */
  maxHealAttempts?: number;
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
  /** Structured failure details for each failing test */
  failureDetails: FailureDetail[];
}

type VerifyStatus = 'pass' | 'fail' | 'low-coverage' | 'skipped' | 'generated' | 'healed';

interface VerifyResult {
  status: VerifyStatus;
  coverage: number;
  attempts: number;
  numTests: number;
  /** Concise reason why the test failed (first error line) */
  failureReason?: string;
  /** Description of the healing action applied */
  healDescription?: string;
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
  if (argv.includes('--heal')) options.healMode = true;

  const retriesIndex = argv.indexOf('--max-retries');
  if (retriesIndex >= 0 && argv[retriesIndex + 1]) {
    options.maxRetries = Number.parseInt(argv[retriesIndex + 1], 10) || 2;
  }

  const healAttemptsIndex = argv.indexOf('--max-heal-attempts');
  if (healAttemptsIndex >= 0 && argv[healAttemptsIndex + 1]) {
    options.maxHealAttempts = Number.parseInt(argv[healAttemptsIndex + 1], 10) || DEFAULT_MAX_HEAL_ATTEMPTS;
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
// Per-file test generation  (extracted so verify/heal can re-call on retry)
// ---------------------------------------------------------------------------

/**
 * Generates (or regenerates) a test file for the given source file.
 * Returns the absolute path of the written test file, or null if skipped.
 */
function generateTestForFile(
  filePath: string,
  { project, checker }: ParserContext,
  repairPlan?: RepairPlan
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
    repairPlan,
  });
  writeFile(testFilePath, generatedTest);
  if (repairPlan) {
    console.log(`  - Test file regenerated with repair plan: ${repairPlan.description}`);
  } else {
    console.log('  - Test file generated/updated.');
  }
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
      /Expected .+ (to |not )/.test(trimmed)
    ) {
      return trimmed.length > 150 ? `${trimmed.substring(0, 147)}...` : trimmed;
    }
  }

  return '';
}

function runJestOnTestFile(testFilePath: string, sourceFilePath: string): JestRunResult {
  const cwd = process.cwd();
  const relTest = normalizeSlashes(path.relative(cwd, testFilePath));
  const relSrc = normalizeSlashes(path.relative(cwd, sourceFilePath));
  const resultFile = path.join(cwd, VERIFY_DIR, 'jest-result.json');
  const coverageDir = path.join(cwd, VERIFY_DIR, 'coverage');

  // Ensure output dir exists; clean stale result
  fs.mkdirSync(path.join(cwd, VERIFY_DIR), { recursive: true });
  if (fs.existsSync(resultFile)) fs.unlinkSync(resultFile);

  const framework = getActiveFramework();
  let errorOutput = '';

  if (framework === 'vitest') {
    // --- Vitest mode ---
    const vitestArgs = [
      'run',
      `"${relTest}"`,
      '--reporter=json',
      `--outputFile="${resultFile}"`,
      '--coverage',
      '--coverage.reporter=json-summary',
      `--coverage.reportsDirectory="${coverageDir}"`,
      `--coverage.include="${relSrc}"`,
      '--passWithNoTests',
      '--silent',
    ].join(' ');

    try {
      execSync(`npx vitest ${vitestArgs}`, { cwd, encoding: 'utf8', stdio: 'pipe' });
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      errorOutput = err.stderr ?? err.stdout ?? err.message ?? 'Unknown vitest error';
    }
  } else {
    // --- Jest mode ---
    const pathPattern = escapeRegex(relTest);

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

    try {
      execSync(`npx jest ${jestArgs}`, { cwd, encoding: 'utf8', stdio: 'pipe' });
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      errorOutput = err.stderr ?? err.stdout ?? err.message ?? 'Unknown jest error';
    }
  }

  // --- Parse jest JSON output ---
  let passed = false;
  let numTests = 0;
  let numFailed = 0;
  let failureReason = '';
  const failureDetails: FailureDetail[] = [];

  try {
    if (fs.existsSync(resultFile)) {
      const jestOut = JSON.parse(fs.readFileSync(resultFile, 'utf8')) as {
        success?: boolean;
        numTotalTests?: number;
        numFailedTests?: number;
        testResults?: Array<{
          // Jest uses testResults[], Vitest uses assertionResults[]
          testResults?: Array<{
            status?: string;
            fullName?: string;
            failureMessages?: string[];
          }>;
          assertionResults?: Array<{
            status?: string;
            fullName?: string;
            failureMessages?: string[];
          }>;
          // Suite-level error (vitest: env validation, import errors, etc.)
          message?: string;
        }>;
      };
      numTests = jestOut.numTotalTests ?? 0;
      numFailed = jestOut.numFailedTests ?? 0;
      // Consider passing when all tests pass (including 0 tests = nothing to fail)
      passed = numFailed === 0 && (jestOut.success !== false || numTests === 0);

      // Extract ALL failure messages for the healer (not just the first one)
      if (!passed && jestOut.testResults) {
        for (const suite of jestOut.testResults) {
          // Handle both jest format (testResults) and vitest format (assertionResults)
          const tests = suite.testResults ?? suite.assertionResults ?? [];
          for (const test of tests) {
            if (test.status === 'failed' && test.failureMessages?.length) {
              // First failure message becomes the concise reason
              if (!failureReason) {
                failureReason = extractFailureReason(test.failureMessages[0]);
              }
              // All failures go into failureDetails for the healer
              failureDetails.push({
                testName: test.fullName || 'unknown test',
                errorMessage: stripAnsi(test.failureMessages.join('\n')),
                stackTrace: stripAnsi(test.failureMessages.join('\n')),
              });
            }
          }
          // Handle suite-level errors (vitest reports env errors here)
          if (tests.length === 0 && suite.message) {
            if (!failureReason) {
              failureReason = extractFailureReason(suite.message);
            }
            failureDetails.push({
              testName: 'suite-error',
              errorMessage: stripAnsi(suite.message),
              stackTrace: stripAnsi(suite.message),
            });
          }
        }
      }
    }
  } catch {
    /* result file missing or malformed — keep defaults */
  }

  // Fall back to raw error output if JSON didn't provide a reason
  if (!failureReason && errorOutput) {
    failureReason = extractFailureReason(errorOutput);
  }

  // If we have error output but no structured failure details, create one
  if (failureDetails.length === 0 && errorOutput) {
    failureDetails.push({
      testName: 'unknown',
      errorMessage: stripAnsi(errorOutput),
      stackTrace: stripAnsi(errorOutput),
    });
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
        (k) => k.endsWith(basename) || normalizeSlashes(k).endsWith(relSrc)
      );
      const entry = matchKey ? cov[matchKey] : cov['total'];
      coverage = entry?.lines?.pct ?? entry?.statements?.pct ?? 0;
    }
  } catch {
    /* ignore coverage parse errors */
  }

  return { passed, numTests, numFailed, coverage, errorOutput, failureReason, failureDetails };
}

// ---------------------------------------------------------------------------
// Verify-and-retry orchestrator (legacy --verify mode)
// ---------------------------------------------------------------------------

function verifyAndRetry(
  filePath: string,
  testFilePath: string,
  ctx: ParserContext,
  maxRetries: number,
  coverageThreshold: number
): VerifyResult {
  let lastResult: JestRunResult = {
    passed: false,
    numTests: 0,
    numFailed: 0,
    coverage: 0,
    errorOutput: '',
    failureReason: '',
    failureDetails: [],
  };

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    // On subsequent attempts, regenerate the test file first
    if (attempt > 1) {
      console.log(`  🔄 Retry ${attempt - 1}/${maxRetries} — regenerating test file...`);
      generateTestForFile(filePath, ctx);
    }

    console.log(`  ▶  Running tests (attempt ${attempt}/${maxRetries + 1})...`);
    lastResult = runJestOnTestFile(testFilePath, filePath);

    const { passed, numTests, numFailed, coverage, failureReason } = lastResult;

    if (!passed) {
      console.log(`  ❌ ${numFailed}/${numTests} test(s) failed`);
      if (failureReason) {
        console.log(`     Reason: ${failureReason}`);
      }
      if (attempt < maxRetries + 1) continue; // will retry
    } else if (coverage < coverageThreshold) {
      console.log(
        `  ⚠️  Tests pass (${numTests}) but coverage ${coverage.toFixed(1)}% < ${coverageThreshold}% threshold`
      );
      if (attempt < maxRetries + 1) continue; // will retry for more coverage
    } else {
      console.log(`  ✅ All ${numTests} test(s) pass | Coverage: ${coverage.toFixed(1)}%`);
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
    failureReason: lastResult.failureReason || undefined,
  };
}

// ---------------------------------------------------------------------------
// Self-healing orchestrator (--heal mode)
// ---------------------------------------------------------------------------

function healAndRetry(
  filePath: string,
  testFilePath: string,
  ctx: ParserContext,
  maxHealAttempts: number
): VerifyResult {
  // Step 1: Run jest on the initially generated test
  console.log(`  ▶  Running tests (initial run)...`);
  let lastResult = runJestOnTestFile(testFilePath, filePath);

  if (lastResult.passed) {
    console.log(`  ✅ All ${lastResult.numTests} test(s) pass | Coverage: ${lastResult.coverage.toFixed(1)}%`);
    return {
      status: 'pass',
      coverage: lastResult.coverage,
      attempts: 1,
      numTests: lastResult.numTests,
    };
  }

  console.log(`  ❌ ${lastResult.numFailed}/${lastResult.numTests} test(s) failed`);
  if (lastResult.failureReason) {
    console.log(`     Reason: ${lastResult.failureReason}`);
  }

  // Step 2: Heal loop — analyze, get repair plan, regenerate, rerun
  const previousAttempts: Array<{ fingerprint: string; actionKinds: string[] }> = [];
  // Accumulate repair actions across attempts so previous fixes aren't lost on regeneration
  const accumulatedActions: RepairAction[] = [];

  for (let attempt = 1; attempt <= maxHealAttempts; attempt++) {
    console.log(`\n  🔬 Heal attempt ${attempt}/${maxHealAttempts} — analyzing failures...`);

    // Analyze failures and get repair plan
    const healResult = heal(lastResult.failureDetails);

    if (!healResult.repairPlan) {
      console.log(`  ⚠️  ${healResult.description}`);
      console.log(`  ⛔ No safe auto-repair available — stopping heal loop`);
      break;
    }

    // Check for duplicate heal attempts (same fingerprint = same fix already tried)
    if (healResult.fingerprint && isDuplicateHealAttempt(healResult.fingerprint, previousAttempts)) {
      console.log(`  ⚠️  Same failure fingerprint seen before — stopping to prevent loop`);
      break;
    }

    // Track this attempt
    if (healResult.fingerprint) {
      previousAttempts.push({
        fingerprint: healResult.fingerprint,
        actionKinds: healResult.repairPlan.actions.map((a) => a.kind),
      });
    }

    console.log(`  🩹 Healing: ${healResult.description}`);
    console.log(`     Source: ${healResult.source} | Confidence: ${healResult.repairPlan.confidence}`);
    if (healResult.category) {
      console.log(`     Category: ${healResult.category}`);
    }

    // Accumulate new actions (deduplicate by kind+key)
    for (const action of healResult.repairPlan.actions) {
      const actionKey = JSON.stringify(action);
      if (!accumulatedActions.some((a) => JSON.stringify(a) === actionKey)) {
        accumulatedActions.push(action);
      }
    }

    // Build combined repair plan with all accumulated actions
    const combinedPlan: RepairPlan = {
      ...healResult.repairPlan,
      actions: [...accumulatedActions],
    };

    // Regenerate with combined repair plan
    console.log(`  🔄 Regenerating test with repair plan...`);
    generateTestForFile(filePath, ctx, combinedPlan);

    // Re-run jest
    console.log(`  ▶  Running tests (after heal)...`);
    lastResult = runJestOnTestFile(testFilePath, filePath);

    // Record outcome in memory
    recordHealOutcome(healResult, lastResult.passed);

    if (lastResult.passed) {
      console.log(`  ✅ Healed! All ${lastResult.numTests} test(s) pass | Coverage: ${lastResult.coverage.toFixed(1)}%`);
      return {
        status: 'healed',
        coverage: lastResult.coverage,
        attempts: attempt + 1, // +1 for initial run
        numTests: lastResult.numTests,
        healDescription: healResult.description,
      };
    }

    console.log(`  ❌ Still failing: ${lastResult.numFailed}/${lastResult.numTests} test(s) failed`);
    if (lastResult.failureReason) {
      console.log(`     Reason: ${lastResult.failureReason}`);
    }
  }

  // All heal attempts exhausted
  console.log(`  ⛔ Tests still failing after ${maxHealAttempts} heal attempts`);

  return {
    status: 'fail',
    coverage: lastResult.coverage,
    attempts: maxHealAttempts + 1,
    numTests: lastResult.numTests,
    failureReason: lastResult.failureReason || undefined,
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
  healed: '🩹',
};

interface SummaryRow {
  file: string;
  status: VerifyStatus;
  coverage: number;
  attempts: number;
  numTests: number;
  failureReason?: string;
  healDescription?: string;
}

function printSummary(rows: SummaryRow[], mode: 'verify' | 'heal'): void {
  if (rows.length === 0) return;

  const modeLabel = mode === 'heal' ? 'HEAL' : 'VERIFY';
  const fileW = Math.max(...rows.map((r) => r.file.length), 32);
  const divider = '─'.repeat(fileW + 40);
  const header = '═'.repeat(fileW + 40);

  console.log(`\n${header}`);
  console.log(` TESTGEN SMART — ${modeLabel} SUMMARY`);
  console.log(header);
  console.log(`${'File'.padEnd(fileW)}  Status        Coverage  Tests  Tries`);
  console.log(divider);

  let pass = 0,
    fail = 0,
    lowCov = 0,
    skipped = 0,
    healed = 0;

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
    // Show heal description for healed tests
    if (r.status === 'healed' && r.healDescription) {
      console.log(`${''.padEnd(fileW)}     └─ 🩹 ${r.healDescription}`);
    }

    if (r.status === 'pass') pass++;
    else if (r.status === 'fail') fail++;
    else if (r.status === 'low-coverage') lowCov++;
    else if (r.status === 'healed') healed++;
    else skipped++;
  }

  console.log(divider);
  const parts = [
    `Total: ${rows.length}`,
    `✅ Pass: ${pass}`,
  ];
  if (healed > 0) parts.push(`🩹 Healed: ${healed}`);
  parts.push(`❌ Fail: ${fail}`);
  if (lowCov > 0) parts.push(`⚠️  Low coverage: ${lowCov}`);
  if (skipped > 0) parts.push(`⏭️  Skipped: ${skipped}`);
  console.log(` ${parts.join('  |  ')}`);
  console.log(header);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  const args = parseArgs(process.argv.slice(2));

  // Detect and set the active test framework (jest vs vitest) based on cwd
  const detectedFramework = detectTestFramework();
  setActiveFramework(detectedFramework);
  console.log(`Test framework: ${detectedFramework}`);

  const ctx = createParser();
  const files = resolveTargetFiles(args);

  const maxRetries = args.maxRetries ?? 2;
  const maxHealAttempts = args.maxHealAttempts ?? DEFAULT_MAX_HEAL_ATTEMPTS;
  const coverageThreshold = args.coverageThreshold ?? 50;

  console.log(`Found ${files.length} file(s) to process.`);
  if (args.healMode) {
    console.log(
      `Heal mode ON  —  max heal attempts: ${maxHealAttempts}  |  coverage threshold: ${coverageThreshold}%`
    );
  } else if (args.verify) {
    console.log(
      `Verify mode ON  —  max retries: ${maxRetries}  |  coverage threshold: ${coverageThreshold}%`
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
      summary.push({
        file: path.basename(filePath),
        status: 'skipped',
        coverage: 0,
        attempts: 0,
        numTests: 0,
      });
      continue;
    }

    if (!args.verify && !args.healMode) {
      summary.push({
        file: path.basename(filePath),
        status: 'generated',
        coverage: 0,
        attempts: 0,
        numTests: 0,
      });
      continue;
    }

    if (args.healMode) {
      // --- Heal mode: analyze failures → teach generator → regenerate ---
      const result = healAndRetry(filePath, testFilePath, ctx, maxHealAttempts);
      summary.push({ file: path.basename(filePath), ...result });
    } else {
      // --- Verify mode: run jest + check coverage + blind retry ---
      const result = verifyAndRetry(filePath, testFilePath, ctx, maxRetries, coverageThreshold);
      summary.push({ file: path.basename(filePath), ...result });
    }
  }

  // Always print summary in verify/heal mode
  if (args.verify || args.healMode) {
    printSummary(summary, args.healMode ? 'heal' : 'verify');

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
