import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import type {
  FrozenTestRecord,
  GreenPhaseInput,
  GreenPhaseResult,
  GreenVerdict,
  RedTaxonomyVerdict,
  RequirementGreenResult,
} from './types';
import type { TestFramework } from '../redPhase/types';
import { PROVEN_RED_TAXONOMIES } from '../tdd/gate';

export function runGreenPhase(input: GreenPhaseInput): GreenPhaseResult {
  const { ticketId, repoRoot, redResultDir, framework } = input;
  const absRedDir = path.resolve(repoRoot, redResultDir);

  let frozenRecord: FrozenTestRecord;
  try {
    frozenRecord = loadFrozenRecord(ticketId, absRedDir);
  } catch (err) {
    return {
      ticketId, rtcHash: '', testFile: '', verdict: 'ERROR',
      frozenHash: '', currentHash: '', hashMatch: false,
      passCount: 0, failCount: 0, requirementResults: [],
      assertionWeakeningDetected: false, weakenedAssertions: [],
      errorOutput: err instanceof Error ? err.message : String(err),
      generatedAt: new Date().toISOString(),
    };
  }

  if (!PROVEN_RED_TAXONOMIES.has(frozenRecord.redTaxonomy)) {
    return {
      ticketId,
      rtcHash: frozenRecord.rtcHash,
      testFile: frozenRecord.testFile,
      verdict: 'UNPROVEN_RED',
      frozenHash: frozenRecord.testFileHash,
      currentHash: '',
      hashMatch: false,
      passCount: 0,
      failCount: 0,
      requirementResults: [],
      assertionWeakeningDetected: false,
      weakenedAssertions: [],
      errorOutput:
        `Frozen RED record has taxonomy "${frozenRecord.redTaxonomy}" — not a proven RED state. ` +
        `Re-run "testgen red --rtc <path>" to produce a verified RED state before running GREEN.`,
      generatedAt: new Date().toISOString(),
    };
  }

  const testFilePath = path.resolve(repoRoot, frozenRecord.testFile);

  if (!fs.existsSync(testFilePath)) {
    return errorResult(ticketId, frozenRecord, `Test file not found: ${testFilePath}. Was the RED phase run?`);
  }

  const currentContent = fs.readFileSync(testFilePath, 'utf8');
  const currentHash = sha256(currentContent);
  const hashMatch = currentHash === frozenRecord.testFileHash;

  if (!hashMatch) {
    const weakened = detectAssertionWeakening(currentContent);
    return {
      ticketId,
      rtcHash: frozenRecord.rtcHash,
      testFile: frozenRecord.testFile,
      verdict: weakened.length > 0 ? 'ASSERTION_WEAKENED' : 'HASH_MISMATCH',
      frozenHash: frozenRecord.testFileHash,
      currentHash,
      hashMatch: false,
      passCount: 0,
      failCount: 0,
      requirementResults: [],
      assertionWeakeningDetected: weakened.length > 0,
      weakenedAssertions: weakened,
      errorOutput:
        `Test file hash changed since RED phase without an explicit RTC re-approval. ` +
        `Frozen: ${frozenRecord.testFileHash.slice(0, 12)}… Current: ${currentHash.slice(0, 12)}…`,
      generatedAt: new Date().toISOString(),
    };
  }

  const runResult = runTests(testFilePath, framework);

  let verdict: GreenVerdict;
  if (runResult.error && runResult.failCount === 0 && runResult.passCount === 0) {
    verdict = 'ERROR';
  } else if (runResult.failCount === 0 && runResult.passCount > 0) {
    verdict = 'GREEN';
  } else {
    verdict = 'STILL_RED';
  }

  const requirementResults = parseRequirementResults(runResult.output);

  return {
    ticketId,
    rtcHash: frozenRecord.rtcHash,
    testFile: frozenRecord.testFile,
    verdict,
    frozenHash: frozenRecord.testFileHash,
    currentHash,
    hashMatch: true,
    passCount: runResult.passCount,
    failCount: runResult.failCount,
    requirementResults,
    assertionWeakeningDetected: false,
    weakenedAssertions: [],
    errorOutput: runResult.error,
    generatedAt: new Date().toISOString(),
  };
}

export function classifyRedTaxonomy(
  output: string,
  failCount: number,
  passCount: number,
): RedTaxonomyVerdict {
  if (failCount === 0 && passCount > 0) return 'BASELINE_ALREADY_GREEN';
  if (/cannot find module|SyntaxError|is not a constructor/i.test(output)) return 'INVALID_RED_COMPILE';
  if (/ECONNREFUSED|ENOENT.*fixture|jest-environment/i.test(output)) return 'INVALID_RED_FIXTURE';
  if (/Expected[\s\S]*Received|expect\(\S.*\)\./i.test(output) && failCount > 0) return 'EXPECTED_RED_ASSERTION';
  if (/is not a function|undefined.*is not|Cannot read prop/i.test(output)) return 'EXPECTED_RED_MISSING_REQUIRED_API';
  if (failCount > 0) return 'AMBIGUOUS_RED_UNRELATED_FAILURE';
  return 'INVALID_RED_ENVIRONMENT';
}

function loadFrozenRecord(ticketId: string, redResultDir: string): FrozenTestRecord {
  const frozenPath = path.join(redResultDir, `${ticketId}.frozen.json`);
  if (!fs.existsSync(frozenPath)) {
    throw new Error(
      `No frozen test record found at ${frozenPath}. ` +
      `Run "testgen red --rtc <path>" first to generate and freeze the RED phase tests.`,
    );
  }
  return JSON.parse(fs.readFileSync(frozenPath, 'utf8')) as FrozenTestRecord;
}

function runTests(testFile: string, framework: TestFramework): {
  passCount: number;
  failCount: number;
  output: string;
  error?: string;
} {
  const runner = framework === 'vitest' ? 'npx vitest run' : 'npx jest';
  // Use the basename without extension as the pattern — works cross-platform and avoids
  // backslash/space issues when passing absolute Windows paths as a Jest regex filter.
  const testPattern = path.basename(testFile, path.extname(testFile));
  const cmd = `${runner} --no-coverage "${testPattern}" 2>&1`;
  try {
    const output = execSync(cmd, { encoding: 'utf8', timeout: 120_000, stdio: ['pipe', 'pipe', 'pipe'] });
    const { pass, fail } = parseTestCounts(output);
    return { passCount: pass, failCount: fail, output };
  } catch (err: unknown) {
    const output = (err as { stdout?: string }).stdout ?? (err as { stderr?: string }).stderr ?? '';
    const { pass, fail } = parseTestCounts(typeof output === 'string' ? output : '');
    if (fail > 0) return { passCount: pass, failCount: fail, output: typeof output === 'string' ? output : '' };
    return {
      passCount: 0,
      failCount: 0,
      output: typeof output === 'string' ? output : '',
      error: typeof output === 'string' ? output.slice(0, 2000) : 'Runner failed with no output.',
    };
  }
}

function parseTestCounts(output: string): { pass: number; fail: number } {
  // Scope to the "Tests:" summary line so "Test Suites: 1 passed" doesn't shadow "Tests: 3 passed"
  const testsLine = output.match(/^Tests:\s*(.+)$/im);
  const searchIn = testsLine ? testsLine[1] : output;
  const passMatch = searchIn.match(/(\d+)\s+pass(?:ed|ing)?/i);
  const failMatch = searchIn.match(/(\d+)\s+fail(?:ed|ing)?/i);
  return {
    pass: passMatch ? parseInt(passMatch[1], 10) : 0,
    fail: failMatch ? parseInt(failMatch[1], 10) : 0,
  };
}

function parseRequirementResults(output: string): RequirementGreenResult[] {
  const results: RequirementGreenResult[] = [];
  const passPattern = /✓|✔|PASS.*@rtc-requirement\s+([\w-]+)/g;
  const failPattern = /✗|✘|FAIL.*@rtc-requirement\s+([\w-]+)|×.*?([\w]+-\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = passPattern.exec(output)) !== null) {
    if (m[1]) results.push({ requirementId: m[1], verdict: 'GREEN' });
  }
  while ((m = failPattern.exec(output)) !== null) {
    const id = m[1] ?? m[2];
    if (id) results.push({ requirementId: id, verdict: 'STILL_RED' });
  }
  return results;
}

// Detect patterns that weaken assertion strength, e.g. replacing specific matchers with generic ones.
function detectAssertionWeakening(currentContent: string): string[] {
  const weakPatterns: Array<[RegExp, string]> = [
    [/\.toBeDefined\(\)/, 'toBeDefined() — replaces a specific value assertion'],
    [/\.toBeTruthy\(\)/, 'toBeTruthy() — replaces a specific value assertion'],
    [/expect\(true\)\.toBe\(true\)/, 'expect(true).toBe(true) — vacuous assertion'],
    [/expect\(.*\)\.not\.toThrow\(\)/, 'not.toThrow() — may mask unimplemented behavior'],
  ];
  return weakPatterns
    .filter(([pattern]) => pattern.test(currentContent))
    .map(([, description]) => description);
}

function errorResult(
  ticketId: string,
  frozenRecord: FrozenTestRecord,
  errorOutput: string,
): GreenPhaseResult {
  return {
    ticketId,
    rtcHash: frozenRecord.rtcHash,
    testFile: frozenRecord.testFile,
    verdict: 'ERROR',
    frozenHash: frozenRecord.testFileHash,
    currentHash: '',
    hashMatch: false,
    passCount: 0,
    failCount: 0,
    requirementResults: [],
    assertionWeakeningDetected: false,
    weakenedAssertions: [],
    errorOutput,
    generatedAt: new Date().toISOString(),
  };
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
