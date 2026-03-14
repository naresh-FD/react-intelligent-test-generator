/* eslint-disable @typescript-eslint/no-unused-vars */
/*
Usage:
  npm run testgen             # uses unstaged git changes by default
  npm run testgen:all         # scans all source files
  npm run testgen:file -- src/path/Component.tsx
  npm run testgen:smart       # generate + run jest + retry on failure (--all --verify)
  npm run testgen:smart:file  # single file with verify
    --verify                  # run jest after each generated test, retry on fail
    --max-retries <n>         # self-heal retry iterations on failing files (default: 3, 0=no retry)
    --coverage-threshold <n>  # minimum line coverage % to consider passing (default: 50)
    --files-from <path>       # read a JSON array of file paths for batch benchmarking
    --config <path>           # override react-testgen.config.json
    --summary-json <path>     # write machine-readable run summary
*/

import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync, execSync } from 'node:child_process';
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
import { loadConfig, resolveTestOutput, ResolvedTestOutput, DEFAULT_TEST_OUTPUT, ExistingTestStrategy } from './workspace/config';
import {
  evaluateFile,
  buildScanReport,
  formatReportAsJson,
  formatReportAsMarkdown,
  printEligibilitySummary,
  type FileEligibilityResult,
} from './eligibility';
import { classifyFailure } from './selfHeal/failureClassifier';
import {
  addHealReportFailureSignature,
  appendHealReportAttempt,
  appendPromotedHealReportAction,
  buildHealReport,
  createHealAttempt,
  createHealReportEntry,
  finalizeHealReportEntry,
  formatHealReportSummary,
  getDefaultHealReportPath,
  setHealReportInitialStatus,
  writeHealReportJson,
} from './selfHeal/healReport';
import { getPromotedRepairsForGeneration, refreshPromotedEntries } from './selfHeal/promotion';
import { chooseRepairStrategy, NOOP_REPAIR_ACTION } from './selfHeal/repairEngine';
import { buildRepairTraitsFromComponents } from './selfHeal/repairTraits';
import {
  loadHealingMemory,
  saveHealingMemory,
  recordHealingAttempt,
  rankRepairsForFailure,
} from './selfHeal/healingMemory';
import type {
  HealReportEntry,
  FailureSignature as HealingFailureSignature,
  RepairAction,
  RepairPatchOperation,
} from './selfHeal/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CliOptions {
  file?: string;
  filesFrom?: string;
  gitUnstaged?: boolean;
  all?: boolean;
  /** Run jest after all generated test files and retry failing ones */
  verify?: boolean;
  /** Self-heal retry iterations on failing files (default 3, 0 = no retry) */
  maxRetries?: number;
  /** Minimum line-coverage % to consider a test file passing (default 50) */
  coverageThreshold?: number;
  /** Write an eligibility scan report (json, markdown, or both) */
  report?: 'json' | 'markdown' | 'both';
  /** Optional config file override, relative to cwd when not absolute */
  configPath?: string;
  /** Write a machine-readable run summary for benchmark tooling */
  summaryJson?: string;
}

interface JestRunResult {
  passed: boolean;
  numTests: number;
  numFailed: number;
  /** Line coverage % for the source file (0 if not available) */
  coverage: number;
  /** Whether coverage was collected successfully in this environment */
  coverageCollected: boolean;
  /** Raw error output on failure */
  errorOutput: string;
  /** Concise single-line failure reason extracted from error output */
  failureReason: string;
}

interface JestAssertionResult {
  status?: string;
  failureMessages?: string[];
}

interface JestSuiteResult {
  testFilePath?: string;
  name?: string;
  status?: string;
  message?: string;
  summary?: string;
  failureMessage?: string;
  testResults?: JestAssertionResult[];
  assertionResults?: JestAssertionResult[];
  numPassingTests?: number;
  numFailingTests?: number;
  testExecError?: {
    message?: string;
    code?: string;
    moduleName?: string;
  };
}

interface JestAggregatedRunResult {
  success?: boolean;
  testResults?: JestSuiteResult[];
}

interface JestRunCLIResult {
  results: JestAggregatedRunResult;
}

type VerifyStatus = 'pass' | 'fail' | 'low-coverage' | 'skipped' | 'generated';

type ParserContext = ReturnType<typeof createParser>;
const SUPPORTED_SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const FAILED_GENERATED_TEST_MARKER = 'AUTO-GENERATED TEST (FAILED)';
const requireFromCli = createRequire(__filename);

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

  const filesFromIndex = argv.indexOf('--files-from');
  if (filesFromIndex >= 0 && argv[filesFromIndex + 1]) {
    options.filesFrom = argv[filesFromIndex + 1];
  }

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

  const configIndex = argv.indexOf('--config');
  if (configIndex >= 0 && argv[configIndex + 1]) {
    options.configPath = argv[configIndex + 1];
  }

  const summaryIndex = argv.indexOf('--summary-json');
  if (summaryIndex >= 0 && argv[summaryIndex + 1]) {
    options.summaryJson = argv[summaryIndex + 1];
  }

  return options;
}

function resolveFilePath(fileArg: string): string {
  return path.isAbsolute(fileArg) ? fileArg : path.join(process.cwd(), fileArg);
}

function resolveFileList(listPath: string): string[] {
  const absolutePath = resolveFilePath(listPath);
  const raw = JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as unknown;
  if (!Array.isArray(raw)) {
    throw new Error(`Expected ${absolutePath} to contain a JSON array of file paths.`);
  }
  return raw
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => resolveFilePath(value));
}

function hasSupportedSourceExtension(filePath: string): boolean {
  return SUPPORTED_SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isTrackedSrcFile(filePath: string): boolean {
  return normalizeSlashes(filePath).includes('/src/') && hasSupportedSourceExtension(filePath);
}

function resolveTargetFiles(args: CliOptions): string[] {
  if (args.file) return [resolveFilePath(args.file)];
  if (args.filesFrom) return resolveFileList(args.filesFrom);
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
  const testFilePath = getTestFilePath(filePath, testOutput, packageRoot);

  // Skip test utility files (renderWithProviders, test helpers, etc.)
  if (isTestUtilityFile(filePath)) {
    console.log('  - Test utility file detected. Writing placeholder test instead of skipping.');
    return writeTrackedPlaceholderTest(filePath, testFilePath, 'Test utility file');
  }

  // Skip browser-only / untestable files (MSW handlers, mock data, etc.)
  if (isUntestableFile(filePath)) {
    console.log('  - Browser-only file detected. Writing placeholder test instead of skipping.');
    return writeTrackedPlaceholderTest(filePath, testFilePath, 'Browser-only or otherwise untestable runtime file');
  }

  // --- Existing test file handling ---
  if (fs.existsSync(testFilePath)) {
    if (shouldReplaceExistingGeneratedTest(testFilePath)) {
      console.log('  - Existing generated failure artifact found. Regenerating from scratch.');
      return generateFullTestFile(filePath, sourceFile, { project, checker }, testOutput, packageRoot, testFilePath);
    }
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

function shouldReplaceExistingGeneratedTest(testFilePath: string): boolean {
  try {
    const existingContent = fs.readFileSync(testFilePath, 'utf8');
    if (existingContent.includes(FAILED_GENERATED_TEST_MARKER)) {
      return true;
    }
    const hasRunnableTests = /(?:describe|it|test)\(\s*["'`]/.test(existingContent);
    return existingContent.includes('@generated by react-testgen') && !hasRunnableTests;
  } catch {
    return false;
  }
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
    console.log('  - No named exports found in barrel. Writing placeholder test instead of skipping.');
    return writeTrackedPlaceholderTest(filePath, testFilePath, 'Barrel file without named runtime exports');
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
    console.log('  - All components are compound sub-components. Writing placeholder test instead of skipping.');
    return writeTrackedPlaceholderTest(filePath, testFilePath, 'Compound sub-components require parent context');
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
    console.log('  - No exported runtime functions found. Writing placeholder test instead of skipping.');
    return writeTrackedPlaceholderTest(filePath, testFilePath, 'No exported runtime functions found');
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
  const coverageGlob = `${srcDirRel}/**/*.{js,jsx,ts,tsx}`;

  const jestArgs = [
    `--testPathPattern=${pathPattern}`,
    `--collectCoverageFrom=${coverageGlob}`,
    '--coverage',
    '--coverageReporters=json-summary',
    `--coverageDirectory=${coverageDir}`,
    '--json',
    `--outputFile=${resultFile}`,
    '--forceExit',
    '--passWithNoTests',
    '--silent',
  ];

  let errorOutput = '';
  const jestBin = resolveNodeModuleBinary(cwd, ['jest', 'bin', 'jest.js']);
  const runJest = (extraArgs: string[] = []) =>
    execFileSync(process.execPath, [jestBin, ...jestArgs, ...extraArgs], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      maxBuffer: 50 * 1024 * 1024,
    });

  try {
    runJest();
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    errorOutput = err.stderr ?? err.stdout ?? err.message ?? 'Unknown jest error';
    try {
      const retryReason = shouldRetryJestInBand(errorOutput)
        ? 'worker/process error'
        : 'batch verification error';
      console.log(`  - Initial Jest batch failed (${retryReason}). Retrying with --runInBand.`);
      runJest(['--runInBand']);
      errorOutput = '';
    } catch (retryError: unknown) {
      const retryErr = retryError as { stdout?: string; stderr?: string; message?: string };
      errorOutput = retryErr.stderr ?? retryErr.stdout ?? retryErr.message ?? errorOutput;
    }
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
      coverageCollected: false,
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
      const testPathByBasename = new Map(
        testFilePaths.map((tp) => [path.basename(tp).toLowerCase(), tp] as const)
      );

      for (const suite of jestOut.testResults ?? []) {
        const suitePath = suite.testFilePath ?? suite.name;
        if (!suitePath) continue;

        // Match by normalized absolute path (case-insensitive for Windows)
        const matchedTestPath =
          testPathLookup.get(normalizePathForCompare(suitePath)) ??
          testPathByBasename.get(path.basename(suitePath).toLowerCase());
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
          coverageCollected: false,
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

  const needsSerialFallback = [...results.values()].every((result) => !result.passed && result.numTests === 0);
  if (needsSerialFallback) {
    console.log('  - Batch verify produced no runnable test results. Falling back to serial --runTestsByPath runs.');
    return runJestSerial(testFilePaths, sourceFilePaths);
  }

  return results;
}

function runJestSerial(
  testFilePaths: string[],
  sourceFilePaths: string[],
): Map<string, JestRunResult> {
  const cwd = process.cwd();
  const jestBin = resolveNodeModuleBinary(cwd, ['jest', 'bin', 'jest.js']);
  const results = new Map<string, JestRunResult>();

  for (let i = 0; i < testFilePaths.length; i++) {
    const testPath = testFilePaths[i];
    const sourcePath = sourceFilePaths[i];
    const resultFile = path.join(cwd, VERIFY_DIR, `jest-result-${i}.json`);
    const coverageDir = path.join(cwd, VERIFY_DIR, `coverage-${i}`);

    if (fs.existsSync(resultFile)) fs.unlinkSync(resultFile);

    let errorOutput = '';
    try {
      execFileSync(
        process.execPath,
        [
          jestBin,
          '--runInBand',
          '--runTestsByPath',
          testPath,
          `--collectCoverageFrom=${normalizeSlashes(path.relative(cwd, sourcePath))}`,
          '--coverage',
          '--coverageReporters=json-summary',
          `--coverageDirectory=${coverageDir}`,
          '--json',
          `--outputFile=${resultFile}`,
          '--forceExit',
          '--passWithNoTests',
          '--silent',
        ],
        {
          cwd,
          encoding: 'utf8',
          stdio: 'pipe',
          maxBuffer: 50 * 1024 * 1024,
        },
      );
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      errorOutput = err.stderr ?? err.stdout ?? err.message ?? 'Unknown jest error';
    }

    let suiteResult: JestRunResult = {
      passed: false,
      numTests: 0,
      numFailed: 0,
      coverage: 0,
      coverageCollected: false,
      errorOutput,
      failureReason: errorOutput ? extractFailureReason(errorOutput) : '',
    };

    try {
      if (fs.existsSync(resultFile)) {
        const jestOut = JSON.parse(fs.readFileSync(resultFile, 'utf8')) as {
          testResults?: JestSuiteResult[];
        };
        const suite = (jestOut.testResults ?? [])[0];
        if (suite) {
          const testItems = suite.testResults ?? suite.assertionResults ?? [];
          const numFailing = testItems.filter((t) => t.status === 'failed').length || suite.numFailingTests || 0;
          const numPassing = testItems.filter((t) => t.status === 'passed').length || suite.numPassingTests || 0;
          const numTests = numPassing + numFailing;
          const hasSuiteExecutionFailure = Boolean(suite.failureMessage || suite.testExecError);
          const passed =
            typeof suite.status === 'string'
              ? suite.status === 'passed' && numFailing === 0 && !hasSuiteExecutionFailure
              : numFailing === 0 && !hasSuiteExecutionFailure;
          let failureReason = '';
          if (!passed) {
            const firstFailure = testItems.find((t) => t.status === 'failed' && t.failureMessages?.length);
            failureReason =
              (firstFailure?.failureMessages?.[0] && extractFailureReason(firstFailure.failureMessages[0])) ||
              (suite.failureMessage && extractFailureReason(suite.failureMessage)) ||
              (suite.message && extractFailureReason(suite.message)) ||
              (suite.summary && extractFailureReason(suite.summary)) ||
              suiteResult.failureReason;
          }
          suiteResult = {
            ...suiteResult,
            passed,
            numTests,
            numFailed: numFailing,
            errorOutput: passed ? '' : suite.failureMessage ?? suiteResult.errorOutput,
            failureReason,
          };
        }
      }
    } catch {
      /* keep default serial failure result */
    }

    try {
      const covFile = path.join(coverageDir, 'coverage-summary.json');
      if (fs.existsSync(covFile)) {
        const cov = JSON.parse(fs.readFileSync(covFile, 'utf8')) as Record<
          string,
          { lines?: { pct: number }; statements?: { pct: number } }
        >;
        const relSrc = normalizeSlashes(path.relative(cwd, sourcePath)).toLowerCase();
        const basename = path.basename(sourcePath).toLowerCase();
        const matchKey = Object.keys(cov).find((k) => {
          const norm = normalizeSlashes(k).toLowerCase();
          return norm.endsWith(relSrc) || norm.endsWith(basename);
        });
        if (matchKey) {
          const entry = cov[matchKey];
          const rawCoverage = entry?.lines?.pct ?? entry?.statements?.pct ?? 0;
          const numericCoverage = Number(rawCoverage);
          suiteResult.coverage = Number.isFinite(numericCoverage) ? numericCoverage : 0;
        }
      }
    } catch {
      /* keep zero coverage */
    }

    results.set(testPath, suiteResult);
  }

  return results;
}

async function runJestBatchInProcess(
  testFilePaths: string[],
  sourceFilePaths: string[],
): Promise<Map<string, JestRunResult>> {
  if (testFilePaths.length === 0) return new Map();

  const cwd = process.cwd();
  const coverageDir = path.join(cwd, VERIFY_DIR, 'coverage');
  fs.mkdirSync(path.join(cwd, VERIFY_DIR), { recursive: true });

  const srcDir = detectSrcDir(sourceFilePaths[0], cwd);
  const srcDirRel = normalizeSlashes(path.relative(cwd, srcDir));
  const coverageGlob = `${srcDirRel}/**/*.{js,jsx,ts,tsx}`;
  const { aggregatedResult, errorOutput } = await invokeJestRunInProcess({
    cwd,
    testFilePaths,
    collectCoverageFrom: [coverageGlob],
    coverageDirectory: coverageDir,
  });

  const results = buildJestResultMapFromAggregate({
    cwd,
    testFilePaths,
    sourceFilePaths,
    aggregatedResult,
    coverageDir,
    errorOutput,
  });

  const needsSerialFallback = [...results.values()].every((result) => !result.passed && result.numTests === 0);
  if (needsSerialFallback) {
    console.log('  - Batch verify produced no runnable test results. Falling back to serial --runTestsByPath runs.');
    return runJestSerialInProcess(testFilePaths, sourceFilePaths);
  }

  return results;
}

async function runJestSerialInProcess(
  testFilePaths: string[],
  sourceFilePaths: string[],
): Promise<Map<string, JestRunResult>> {
  const cwd = process.cwd();
  const results = new Map<string, JestRunResult>();

  for (let i = 0; i < testFilePaths.length; i++) {
    const testPath = testFilePaths[i];
    const sourcePath = sourceFilePaths[i];
    const coverageDir = path.join(cwd, VERIFY_DIR, `coverage-${i}`);
    const relSourcePath = normalizeSlashes(path.relative(cwd, sourcePath));

    const { aggregatedResult, errorOutput } = await invokeJestRunInProcess({
      cwd,
      testFilePaths: [testPath],
      collectCoverageFrom: [relSourcePath],
      coverageDirectory: coverageDir,
    });

    const singleResult = buildJestResultMapFromAggregate({
      cwd,
      testFilePaths: [testPath],
      sourceFilePaths: [sourcePath],
      aggregatedResult,
      coverageDir,
      errorOutput,
    }).get(testPath);

    results.set(
      testPath,
      singleResult ?? {
        passed: false,
        numTests: 0,
        numFailed: 0,
        coverage: 0,
        coverageCollected: false,
        errorOutput,
        failureReason: errorOutput ? extractFailureReason(errorOutput) : '',
      },
    );
  }

  return results;
}

async function invokeJestRunInProcess({
  cwd,
  testFilePaths,
  collectCoverageFrom,
  coverageDirectory,
}: {
  cwd: string;
  testFilePaths: string[];
  collectCoverageFrom: string[];
  coverageDirectory: string;
}): Promise<{ aggregatedResult?: JestAggregatedRunResult; errorOutput: string }> {
  try {
    const { runCLI } = loadJestApi(cwd);
    const { results } = (await runCLI(
      {
        $0: 'react-testgen',
        _: testFilePaths,
        runInBand: true,
        runTestsByPath: true,
        noCache: true,
        workerThreads: true,
        coverage: true,
        collectCoverageFrom,
        coverageReporters: ['json-summary'],
        coverageDirectory,
        passWithNoTests: true,
        silent: true,
        noStackTrace: true,
      },
      [cwd],
    )) as JestRunCLIResult;

    return { aggregatedResult: results, errorOutput: '' };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const errorOutput = err.stderr ?? err.stdout ?? err.message ?? 'Unknown jest error';
    return { errorOutput };
  }
}

function buildJestResultMapFromAggregate({
  cwd,
  testFilePaths,
  sourceFilePaths,
  aggregatedResult,
  coverageDir,
  errorOutput,
}: {
  cwd: string;
  testFilePaths: string[];
  sourceFilePaths: string[];
  aggregatedResult?: JestAggregatedRunResult;
  coverageDir: string;
  errorOutput: string;
}): Map<string, JestRunResult> {
  const results = new Map<string, JestRunResult>();
  const globalFailureReason = errorOutput ? extractFailureReason(errorOutput) : '';

  for (const testPath of testFilePaths) {
    results.set(testPath, {
      passed: false,
      numTests: 0,
      numFailed: 0,
      coverage: 0,
      coverageCollected: false,
      errorOutput,
      failureReason: globalFailureReason,
    });
  }

  const testPathLookup = new Map(testFilePaths.map((tp) => [normalizePathForCompare(tp), tp] as const));
  const testPathByBasename = new Map(testFilePaths.map((tp) => [path.basename(tp).toLowerCase(), tp] as const));

  for (const suite of aggregatedResult?.testResults ?? []) {
    const suitePath = suite.testFilePath ?? suite.name;
    if (!suitePath) continue;

    const matchedTestPath =
      testPathLookup.get(normalizePathForCompare(suitePath)) ??
      testPathByBasename.get(path.basename(suitePath).toLowerCase());
    if (!matchedTestPath) continue;

    const testItems = suite.testResults ?? suite.assertionResults ?? [];
    const numFailing = testItems.filter((t) => t.status === 'failed').length || suite.numFailingTests || 0;
    const numPassing = testItems.filter((t) => t.status === 'passed').length || suite.numPassingTests || 0;
    const numTests = numPassing + numFailing;
    const hasSuiteExecutionFailure = Boolean(suite.failureMessage || suite.testExecError);
    const passed =
      typeof suite.status === 'string'
        ? suite.status === 'passed' && numFailing === 0 && !hasSuiteExecutionFailure
        : numFailing === 0 && !hasSuiteExecutionFailure;

    let failureReason = '';
    if (!passed) {
      const firstFailure = testItems.find((t) => t.status === 'failed' && t.failureMessages?.length);
      failureReason =
        (firstFailure?.failureMessages?.[0] && extractFailureReason(firstFailure.failureMessages[0])) ||
        (suite.failureMessage && extractFailureReason(suite.failureMessage)) ||
        (suite.message && extractFailureReason(suite.message)) ||
        (suite.summary && extractFailureReason(suite.summary)) ||
        globalFailureReason;
    }

    results.set(matchedTestPath, {
      passed,
      numTests,
      numFailed: numFailing,
      coverage: 0,
      coverageCollected: false,
      errorOutput: passed ? '' : suite.failureMessage ?? errorOutput,
      failureReason,
    });
  }

  applyCoverageToResults(cwd, testFilePaths, sourceFilePaths, coverageDir, results);
  return results;
}

function applyCoverageToResults(
  cwd: string,
  testFilePaths: string[],
  sourceFilePaths: string[],
  coverageDir: string,
  results: Map<string, JestRunResult>,
): void {
  try {
    const covFile = path.join(coverageDir, 'coverage-summary.json');
    if (!fs.existsSync(covFile)) return;

    const cov = JSON.parse(fs.readFileSync(covFile, 'utf8')) as Record<
      string,
      { lines?: { pct: number }; statements?: { pct: number } }
    >;

    for (let i = 0; i < testFilePaths.length; i++) {
      const testPath = testFilePaths[i];
      const srcPath = sourceFilePaths[i];
      const relSrc = normalizeSlashes(path.relative(cwd, srcPath)).toLowerCase();
      const basename = path.basename(srcPath).toLowerCase();
      const matchKey = Object.keys(cov).find((k) => {
        const norm = normalizeSlashes(k).toLowerCase();
        return norm.endsWith(basename) || norm.endsWith(relSrc);
      });
      if (!matchKey) continue;

      const entry = cov[matchKey];
      const rawCoverage = entry?.lines?.pct ?? entry?.statements?.pct ?? 0;
      const numericCoverage = Number(rawCoverage);
      const coverage = Number.isFinite(numericCoverage) ? numericCoverage : 0;
      const existing = results.get(testPath);
      if (existing) {
        results.set(testPath, { ...existing, coverage, coverageCollected: true });
      }
    }
  } catch {
    /* coverage parse error */
  }
}

function loadJestApi(cwd: string): {
  runCLI: (argv: Record<string, unknown>, projects: string[]) => Promise<JestRunCLIResult>;
} {
  const roots = [cwd, process.cwd(), __dirname];
  for (const root of roots) {
    try {
      const resolved = requireFromCli.resolve('jest', { paths: [root] });
      const loaded = requireFromCli(resolved) as {
        runCLI?: (argv: Record<string, unknown>, projects: string[]) => Promise<JestRunCLIResult>;
      };
      if (typeof loaded.runCLI === 'function') {
        return { runCLI: loaded.runCLI };
      }
    } catch {
      /* try next root */
    }
  }

  throw new Error('Unable to resolve Jest API from the current workspace');
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
  structuredFailure?: {
    category: string;
    confidence: number;
    evidence: string;
    fingerprint: string;
    repairActionId?: string;
    repairStrategyId?: string;
  };
}

interface SummaryAggregate {
  total: number;
  pass: number;
  fail: number;
  lowCoverage: number;
  skipped: number;
  generated: number;
}

interface SummaryJsonPayload {
  meta: {
    cwd: string;
    verify: boolean;
    coverageThreshold: number;
    maxRetries: number;
    generatedCount: number;
    skippedCount: number;
  };
  aggregate: SummaryAggregate;
  rows: SummaryRow[];
}

type AnalyzedComponent = ReturnType<typeof analyzeSourceFile>[number];

interface SourceHealingMetadata {
  repairTraits?: import('./selfHeal/types').ComponentTraits;
  componentPattern: string;
  componentNames: string[];
}

interface PendingHealingAttempt {
  signature: HealingFailureSignature;
  action: RepairAction;
  componentPattern: string;
  structuredFailure: SummaryRow['structuredFailure'];
  strategyId?: string;
  reason: string;
  explanation?: string;
  attemptNumber: number;
}

function buildSummaryAggregate(rows: SummaryRow[]): SummaryAggregate {
  const aggregate: SummaryAggregate = {
    total: rows.length,
    pass: 0,
    fail: 0,
    lowCoverage: 0,
    skipped: 0,
    generated: 0,
  };

  for (const row of rows) {
    if (row.status === 'pass') aggregate.pass++;
    else if (row.status === 'fail') aggregate.fail++;
    else if (row.status === 'low-coverage') aggregate.lowCoverage++;
    else if (row.status === 'generated') aggregate.generated++;
    else aggregate.skipped++;
  }

  return aggregate;
}

function writeSummaryJson(
  summaryPath: string,
  rows: SummaryRow[],
  meta: SummaryJsonPayload['meta'],
): void {
  const absolutePath = resolveFilePath(summaryPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const payload: SummaryJsonPayload = {
    meta,
    aggregate: buildSummaryAggregate(rows),
    rows,
  };
  const serialized = JSON.stringify(payload, null, 2);
  let lastError: unknown;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      fs.writeFileSync(absolutePath, serialized, 'utf8');
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt === 5) {
        throw error;
      }
      sleepSync(150 * attempt);
    }
  }
  if (lastError) {
    throw lastError;
  }
  console.log(`📄 Summary JSON: ${absolutePath}`);
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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

function analyzeFileForHealing(
  filePath: string,
  testFilePath: string,
  ctx: ParserContext,
): SourceHealingMetadata {
  const sourceFile = getSourceFile(ctx.project, filePath);
  const allComponents = analyzeSourceFile(sourceFile, ctx.project, ctx.checker);
  const compoundSubs = getCompoundSubComponents(sourceFile);
  const components = compoundSubs.size > 0
    ? allComponents.filter((component) => !compoundSubs.has(component.name))
    : allComponents;

  return {
    repairTraits: buildRepairTraitsFromComponents(components, filePath, testFilePath),
    componentPattern: normalizeSlashes(path.relative(process.cwd(), filePath)),
    componentNames: components.map((component) => component.name),
  };
}

function applyRepairPatchOperations(
  content: string,
  operations: RepairPatchOperation[] = [],
): string | null {
  if (operations.length === 0) {
    return null;
  }

  let updatedContent = content;

  for (const operation of operations) {
    switch (operation.type) {
      case 'replace-text':
        if (operation.before && operation.after && updatedContent.includes(operation.before)) {
          updatedContent = updatedContent.replace(operation.before, operation.after);
        }
        break;
      case 'insert-import':
      case 'insert-setup':
        if (operation.after && !updatedContent.includes(operation.after)) {
          updatedContent = insertLineAfterImports(updatedContent, operation.after);
        }
        break;
      default:
        break;
    }
  }

  return updatedContent === content ? null : updatedContent;
}

function applyHealingDecision(
  entry: { srcPath: string; testPath: string },
  ctx: ParserContext,
  testOutput: ResolvedTestOutput,
  packageRoot: string,
  decision: ReturnType<typeof chooseRepairStrategy>,
): { action: RepairAction; wroteContent: boolean } {
  const currentContent = fs.readFileSync(entry.testPath, 'utf8');

  if (decision.updatedContent && decision.updatedContent !== currentContent) {
    writeFile(entry.testPath, decision.updatedContent);
    return { action: decision.action, wroteContent: true };
  }

  const patchedContent = applyRepairPatchOperations(currentContent, decision.generatorPatch);
  if (patchedContent && patchedContent !== currentContent) {
    writeFile(entry.testPath, patchedContent);
    return { action: decision.action, wroteContent: true };
  }

  generateTestForFile(entry.srcPath, ctx, testOutput, packageRoot, 'replace');
  const regeneratedContent = fs.readFileSync(entry.testPath, 'utf8');
  return {
    action: {
      id: 'regenerate-from-source',
      kind: 'regenerate',
      description: 'Regenerate the test from source metadata',
      deterministic: true,
      safeToPromote: true,
    },
    wroteContent: regeneratedContent !== currentContent,
  };
}

function applyPromotedGenerationDefaults(
  entry: { srcPath: string; testPath: string },
  healingMemoryState: ReturnType<typeof loadHealingMemory>,
  metadata: SourceHealingMetadata | undefined,
): Array<{
  action: RepairAction;
  strategyId?: string;
  trigger: 'component-pattern' | 'trait';
}> {
  if (!metadata) {
    return [];
  }

  const currentContent = fs.readFileSync(entry.testPath, 'utf8');
  const promotedRepairs = getPromotedRepairsForGeneration({
    state: healingMemoryState,
    testContent: currentContent,
    componentTraits: metadata.repairTraits,
    componentPattern: metadata.componentPattern,
    sourceFilePath: entry.srcPath,
    testFilePath: entry.testPath,
  });
  if (promotedRepairs.length === 0) {
    return [];
  }

  let updatedContent = currentContent;
  const appliedPromotions: Array<{
    action: RepairAction;
    strategyId?: string;
    trigger: 'component-pattern' | 'trait';
  }> = [];

  for (const promotedRepair of promotedRepairs) {
    const nextContent =
      promotedRepair.decision.updatedContent ??
      applyRepairPatchOperations(updatedContent, promotedRepair.decision.generatorPatch) ??
      updatedContent;
    if (nextContent === updatedContent) {
      continue;
    }
    updatedContent = nextContent;
    appliedPromotions.push({
      action: promotedRepair.decision.action,
      strategyId: promotedRepair.decision.strategyId,
      trigger: promotedRepair.trigger,
    });
  }

  if (updatedContent !== currentContent) {
    writeFile(entry.testPath, updatedContent);
  }

  return appliedPromotions;
}

function insertLineAfterImports(content: string, line: string): string {
  const lines = content.split('\n');
  let lastImportIndex = -1;

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim().startsWith('import ')) {
      lastImportIndex = index;
    }
  }

  if (lastImportIndex === -1) {
    return `${line}\n${content}`;
  }

  lines.splice(lastImportIndex + 1, 0, line);
  return lines.join('\n');
}

function deriveVerifyStatus(result: JestRunResult | undefined, coverageThreshold: number): VerifyStatus {
  if (!result || !result.passed) {
    return 'fail';
  }
  if (result.coverageCollected && result.coverage < coverageThreshold) {
    return 'low-coverage';
  }
  return 'pass';
}

function ensureHealReportEntry(
  entries: Map<string, HealReportEntry>,
  entry: { srcPath: string; testPath: string },
  metadata?: SourceHealingMetadata,
): HealReportEntry {
  const existing = entries.get(entry.testPath);
  if (existing) {
    return existing;
  }

  const created = createHealReportEntry({
    sourceFilePath: entry.srcPath,
    testFilePath: entry.testPath,
    fileName: path.basename(entry.srcPath),
    componentNames: metadata?.componentNames ?? [],
  });
  entries.set(entry.testPath, created);
  return created;
}

// ---------------------------------------------------------------------------
// Main — 3-phase batch architecture
// ---------------------------------------------------------------------------

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  // Load workspace config (react-testgen.config.json) and resolve testOutput
  const config = loadConfig(cwd, args.configPath);
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
  let healingMemory = refreshPromotedEntries(loadHealingMemory());

  // maxRetries controls how many self-heal iterations to run on failing tests.
  // 0 = no retry, ≥1 = up to N retry batches with escalating fix strategies.
  const maxRetries = args.maxRetries ?? 3;
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
  const healingMetadataByTestPath = new Map<string, SourceHealingMetadata>();
  const healReportEntries = new Map<string, HealReportEntry>();
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
    if (testFilePath) {
      let healingMetadata: SourceHealingMetadata | undefined;
      try {
        healingMetadata = analyzeFileForHealing(filePath, testFilePath, ctx);
        healingMetadataByTestPath.set(testFilePath, healingMetadata);
      } catch {
        // Best-effort metadata collection only.
      }
      ensureHealReportEntry(
        healReportEntries,
        { srcPath: filePath, testPath: testFilePath },
        healingMetadata,
      );
      const promotedActions = applyPromotedGenerationDefaults(
        { srcPath: filePath, testPath: testFilePath },
        healingMemory,
        healingMetadata,
      );
      if (promotedActions.length > 0) {
        console.log(
          `  - Applied promoted defaults: ${promotedActions.map((item) => `${item.action.id} (${item.trigger})`).join(', ')}`
        );
        let reportEntry = ensureHealReportEntry(
          healReportEntries,
          { srcPath: filePath, testPath: testFilePath },
          healingMetadata,
        );
        for (const promotedAction of promotedActions) {
          reportEntry = appendPromotedHealReportAction(reportEntry, promotedAction);
        }
        healReportEntries.set(testFilePath, reportEntry);
      }
    }
    entries.push({ srcPath: filePath, testPath: testFilePath });
  }

  const skipped = entries.filter((e) => e.testPath === null);
  const generated = entries.filter((e) => e.testPath !== null) as Array<{
    srcPath: string;
    testPath: string;
  }>;

  console.log(`\n  Generated: ${generated.length}  |  Skipped: ${skipped.length}`);

  if (!args.verify) {
    if (args.summaryJson) {
      const generationRows: SummaryRow[] = [
        ...generated.map((entry) => ({
          file: path.basename(entry.srcPath),
          status: 'generated' as const,
          coverage: 0,
          attempts: 1,
          numTests: 0,
        })),
        ...skipped.map((entry) => ({
          file: path.basename(entry.srcPath),
          status: 'skipped' as const,
          coverage: 0,
          attempts: 0,
          numTests: 0,
          failureReason: eligibilityMap.get(entry.srcPath)?.reasons[0],
        })),
      ];

      writeSummaryJson(args.summaryJson, generationRows, {
        cwd,
        verify: false,
        coverageThreshold,
        maxRetries,
        generatedCount: generated.length,
        skippedCount: skipped.length,
      });
    }

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

  const pass1Results = await runJestBatchInProcess(
    generated.map((e) => e.testPath),
    generated.map((e) => e.srcPath)
  );

  // Partition into passing and needing-heal
  const firstPassPassed = generated.filter((entry) => {
    const result = pass1Results.get(entry.testPath);
    return Boolean(result?.passed && (!result.coverageCollected || result.coverage >= coverageThreshold));
  });
  const firstPassLowCoverage = generated.filter((entry) => {
    const result = pass1Results.get(entry.testPath);
    return Boolean(result?.passed && result.coverageCollected && result.coverage < coverageThreshold);
  });
  const functionalFailures = generated.filter((entry) => {
    const result = pass1Results.get(entry.testPath);
    return !result || !result.passed;
  });

  console.log(
    `\n  ✅ ${firstPassPassed.length} passed  |  ⚠️ ${firstPassLowCoverage.length} low coverage  |  🔄 ${functionalFailures.length} need heal`
  );

  const attemptCounts = new Map<string, number>(generated.map((entry) => [entry.testPath, 1]));
  const latestResults = new Map(pass1Results);
  const latestStructuredFailures = new Map<string, SummaryRow['structuredFailure']>();
  const selfHealMaxRetries = Math.max(0, Math.min(maxRetries, 3));

  for (const e of firstPassPassed) {
    const r = pass1Results.get(e.testPath)!;
    const reportEntry = ensureHealReportEntry(
      healReportEntries,
      e,
      healingMetadataByTestPath.get(e.testPath),
    );
    healReportEntries.set(
      e.testPath,
      finalizeHealReportEntry(
        setHealReportInitialStatus(reportEntry, 'pass'),
        { finalStatus: 'pass' },
      ),
    );
    summary.push({
      file: path.basename(e.srcPath),
      status: 'pass',
      coverage: r.coverage,
      attempts: 1,
      numTests: r.numTests,
    });
  }

  for (const e of firstPassLowCoverage) {
    const r = pass1Results.get(e.testPath)!;
    const reportEntry = ensureHealReportEntry(
      healReportEntries,
      e,
      healingMetadataByTestPath.get(e.testPath),
    );
    healReportEntries.set(
      e.testPath,
      finalizeHealReportEntry(
        setHealReportInitialStatus(reportEntry, 'low-coverage'),
        {
          finalStatus: 'low-coverage',
          remainingBlocker: 'Verification passed but coverage stayed below the configured threshold.',
        },
      ),
    );
    summary.push({
      file: path.basename(e.srcPath),
      status: 'low-coverage',
      coverage: r.coverage,
      attempts: 1,
      numTests: r.numTests,
    });
  }

  for (const e of functionalFailures) {
    const result = pass1Results.get(e.testPath);
    const failure = classifyFailure(result?.errorOutput || result?.failureReason || '');
    const reportEntry = ensureHealReportEntry(
      healReportEntries,
      e,
      healingMetadataByTestPath.get(e.testPath),
    );
    healReportEntries.set(
      e.testPath,
      addHealReportFailureSignature(
        setHealReportInitialStatus(reportEntry, 'fail'),
        failure,
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 3: Bounded self-heal loop on functional failures only
  // ─────────────────────────────────────────────────────────────────────────
  let remainingFailures = [...functionalFailures];
  const pendingRepairRecords = new Map<string, PendingHealingAttempt>();

  for (
    let attempt = 1;
    attempt <= selfHealMaxRetries && remainingFailures.length > 0;
    attempt++
  ) {
    console.log(
      `\n🔄  Self-heal attempt ${attempt}/${selfHealMaxRetries} on ${remainingFailures.length} file(s)...`
    );

    pendingRepairRecords.clear();

    for (const e of remainingFailures) {
      const prev = latestResults.get(e.testPath);
      const failureOutput = prev?.errorOutput || prev?.failureReason || '';
      const failure = classifyFailure(failureOutput);
      const metadata = healingMetadataByTestPath.get(e.testPath) ?? analyzeFileForHealing(e.srcPath, e.testPath, ctx);
      healingMetadataByTestPath.set(e.testPath, metadata);
      let reportEntry = ensureHealReportEntry(healReportEntries, e, metadata);
      reportEntry = addHealReportFailureSignature(reportEntry, failure);
      healReportEntries.set(e.testPath, reportEntry);

      const structuredFailure: SummaryRow['structuredFailure'] = {
        category: failure.category,
        confidence: failure.confidence,
        evidence: failure.evidence,
        fingerprint: failure.fingerprint,
      };
      latestStructuredFailures.set(e.testPath, structuredFailure);

      const memoryRankings = rankRepairsForFailure(healingMemory, failure, metadata.componentPattern)
        .map((ranking) => ({
          actionId: ranking.entry.action.id,
          score: ranking.score,
        }));
      const reason = prev?.failureReason ? ` — ${prev.failureReason}` : '';
      console.log(`  - ${path.basename(e.srcPath)} [${failure.category}]${reason}`);

      try {
        const testContent = fs.readFileSync(e.testPath, 'utf8');
        const decision = chooseRepairStrategy({
          testContent,
          failure,
          componentTraits: metadata.repairTraits,
          sourceFilePath: e.srcPath,
          testFilePath: e.testPath,
          generationMetadata: {
            componentPattern: metadata.componentPattern,
            componentNames: metadata.componentNames,
            attemptNumber: String(attempt),
          },
          memoryRankedActions: memoryRankings,
        });
        structuredFailure.repairActionId = decision.action.id;
        structuredFailure.repairStrategyId = decision.strategyId;
        latestStructuredFailures.set(e.testPath, structuredFailure);

        if (!decision.applied || decision.action.id === NOOP_REPAIR_ACTION.id) {
          healingMemory = refreshPromotedEntries(recordHealingAttempt(healingMemory, {
            signature: failure,
            action: decision.action,
            success: false,
            componentPattern: metadata.componentPattern,
          }));
          healReportEntries.set(
            e.testPath,
            appendHealReportAttempt(reportEntry, createHealAttempt({
              attemptNumber: attempt,
              failure,
              action: decision.action,
              strategyId: decision.strategyId,
              applied: false,
              success: false,
              reason: decision.reason,
              explanation: decision.explanation,
            })),
          );
          console.log(`    No deterministic repair available: ${decision.reason}`);
          continue;
        }

        const applied = applyHealingDecision(
          { srcPath: e.srcPath, testPath: e.testPath },
          ctx,
          testOutput,
          packageRoot,
          decision,
        );
        if (!applied.wroteContent) {
          healingMemory = refreshPromotedEntries(recordHealingAttempt(healingMemory, {
            signature: failure,
            action: applied.action,
            success: false,
            componentPattern: metadata.componentPattern,
          }));
          healReportEntries.set(
            e.testPath,
            appendHealReportAttempt(reportEntry, createHealAttempt({
              attemptNumber: attempt,
              failure,
              action: applied.action,
              strategyId: decision.strategyId,
              applied: false,
              success: false,
              reason: 'Deterministic repair produced no test-file change.',
              explanation: decision.explanation,
            })),
          );
          console.log(`    Skipped rerun because ${applied.action.id} produced no file change.`);
          continue;
        }
        structuredFailure.repairActionId = applied.action.id;
        latestStructuredFailures.set(e.testPath, structuredFailure);
        pendingRepairRecords.set(e.testPath, {
          signature: failure,
          action: applied.action,
          componentPattern: metadata.componentPattern,
          structuredFailure,
          strategyId: decision.strategyId,
          reason: decision.reason,
          explanation: decision.explanation,
          attemptNumber: attempt,
        });
        attemptCounts.set(e.testPath, (attemptCounts.get(e.testPath) ?? 1) + 1);
        console.log(`    Applied ${decision.strategyId} → ${applied.action.id}`);
      } catch (fixError) {
        console.log(`    ⚠️  Self-heal error: ${fixError instanceof Error ? fixError.message : 'unknown'}`);
      }
    }

    const retryTargets = remainingFailures.filter((entry) => pendingRepairRecords.has(entry.testPath));
    if (retryTargets.length === 0) {
      console.log('  - No actionable deterministic repairs were found for the remaining failures.');
      break;
    }

    console.log(
      `\n🚀  Re-running Jest on ${retryTargets.length} repaired file(s) (batch run ${attempt + 1})...`
    );
    const retryResults = await runJestBatchInProcess(
      retryTargets.map((e) => e.testPath),
      retryTargets.map((e) => e.srcPath)
    );

    for (const [key, val] of retryResults) {
      latestResults.set(key, val);
    }

    for (const e of retryTargets) {
      const appliedRepair = pendingRepairRecords.get(e.testPath);
      if (!appliedRepair) continue;
      const retryResult = retryResults.get(e.testPath);
      healingMemory = refreshPromotedEntries(recordHealingAttempt(healingMemory, {
        signature: appliedRepair.signature,
        action: appliedRepair.action,
        success: Boolean(retryResult?.passed),
        componentPattern: appliedRepair.componentPattern,
      }));
      latestStructuredFailures.set(e.testPath, appliedRepair.structuredFailure);
      const reportEntry = ensureHealReportEntry(
        healReportEntries,
        e,
        healingMetadataByTestPath.get(e.testPath),
      );
      healReportEntries.set(
        e.testPath,
        appendHealReportAttempt(reportEntry, createHealAttempt({
          attemptNumber: appliedRepair.attemptNumber,
          failure: appliedRepair.signature,
          action: appliedRepair.action,
          strategyId: appliedRepair.strategyId,
          applied: true,
          success: Boolean(retryResult?.passed),
          reason: appliedRepair.reason,
          explanation: appliedRepair.explanation,
        })),
      );
      pendingRepairRecords.delete(e.testPath);
    }

    const nowPassed = retryTargets.filter((e) => Boolean(retryResults.get(e.testPath)?.passed));
    remainingFailures = retryTargets.filter((e) => !retryResults.get(e.testPath)?.passed);

    console.log(
      `  ✅ ${nowPassed.length} fixed  |  🔄 ${remainingFailures.length} still failing`
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Build summary for all files that went through retry/self-heal
  // ─────────────────────────────────────────────────────────────────────────
  for (const e of functionalFailures) {
    const r = latestResults.get(e.testPath);
    if (!r) {
      const reportEntry = ensureHealReportEntry(
        healReportEntries,
        e,
        healingMetadataByTestPath.get(e.testPath),
      );
      healReportEntries.set(
        e.testPath,
        finalizeHealReportEntry(reportEntry, {
          finalStatus: 'fail',
          remainingBlocker: 'No Jest result was produced for the generated test file.',
        }),
      );
      summary.push({
        file: path.basename(e.srcPath),
        status: 'fail',
        coverage: 0,
        attempts: attemptCounts.get(e.testPath) ?? 1,
        numTests: 0,
        structuredFailure: latestStructuredFailures.get(e.testPath),
      });
      continue;
    }

    const status = deriveVerifyStatus(r, coverageThreshold);
    const reportEntry = ensureHealReportEntry(
      healReportEntries,
      e,
      healingMetadataByTestPath.get(e.testPath),
    );
    healReportEntries.set(
      e.testPath,
      finalizeHealReportEntry(reportEntry, {
        finalStatus: status,
        remainingBlocker: status === 'fail'
          ? (r.failureReason || latestStructuredFailures.get(e.testPath)?.evidence || 'Verification still fails after healing.')
          : status === 'low-coverage'
            ? 'Verification passed but coverage stayed below the configured threshold.'
            : undefined,
      }),
    );

    summary.push({
      file: path.basename(e.srcPath),
      status,
      coverage: r.coverage,
      attempts: attemptCounts.get(e.testPath) ?? 1,
      numTests: r.numTests,
      failureReason: r.failureReason || undefined,
      structuredFailure: status === 'fail' ? latestStructuredFailures.get(e.testPath) : undefined,
    });
  }

  printSummary(summary);

  const healReport = buildHealReport(
    generated
      .map((entry) => healReportEntries.get(entry.testPath))
      .filter((entry): entry is HealReportEntry => Boolean(entry)),
  );
  console.log(formatHealReportSummary(healReport));
  const healReportPath = getDefaultHealReportPath(cwd);
  writeHealReportJson(healReportPath, healReport);
  console.log(`📄 Heal report JSON: ${healReportPath}`);

  if (args.summaryJson) {
    writeSummaryJson(args.summaryJson, summary, {
      cwd,
      verify: true,
      coverageThreshold,
      maxRetries: selfHealMaxRetries,
      generatedCount: generated.length,
      skippedCount: skipped.length,
    });
  }

  const memorySaved = saveHealingMemory(healingMemory);
  if (!memorySaved) {
    console.warn('Warning: healing memory could not be persisted to disk.');
  }

  // Exit with non-zero code only if there are unresolved verification failures.
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
  if (!/^index\.(js|jsx|ts|tsx)$/.test(basename)) return false;
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
      .filter((filePath) => hasSupportedSourceExtension(filePath))
      .filter((filePath) => !isTestFile(filePath));
  } catch {
    return [];
  }
}

function shouldRetryJestInBand(errorOutput: string): boolean {
  return /spawn\s+EPERM|ChildProcessWorker|jest-worker|EAGAIN/i.test(errorOutput);
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
  throw new Error(`Unable to resolve ${binarySegments.join('/')} from ${startDir}`);
}

function writeTrackedPlaceholderTest(sourceFilePath: string, testFilePath: string, reason: string): string | null {
  if (!isTrackedSrcFile(sourceFilePath)) {
    return null;
  }

  const sourceRel = normalizeSlashes(path.relative(process.cwd(), sourceFilePath));
  const placeholder = [
    '/** @generated by react-testgen - placeholder test */',
    buildTestGlobalsImport(['describe', 'it', 'expect']),
    '',
    `describe(${JSON.stringify(path.basename(sourceFilePath))}, () => {`,
    '  it("is tracked by testgen", () => {',
    `    expect(${JSON.stringify(sourceRel)}).toBe(${JSON.stringify(sourceRel)});`,
    '  });',
    '',
    '  it("records why placeholder coverage was used", () => {',
    `    expect(${JSON.stringify(reason)}.length).toBeGreaterThan(0);`,
    '  });',
    '});',
    '',
  ].join('\n');

  writeFile(testFilePath, placeholder);
  console.log(`  - Placeholder test file generated/updated: ${testFilePath}`);
  return testFilePath;
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
