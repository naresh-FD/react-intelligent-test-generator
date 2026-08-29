import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyRedTaxonomy } from '../greenPhase/runner';
import { classifyRedFromTestRun, isProvenRed } from '../tdd/gate';
import type { TestRunResult } from '../repairRuntime';

// Resolve Jest binary from the monorepo root — hoisted, not in packages/testgen/node_modules.
const JEST_BIN: string = (() => {
  try { return require.resolve('jest/bin/jest'); } catch { return ''; }
})();

function spawnJest(testFile: string, tempDir: string): { output: string; pass: number; fail: number } {
  let raw = '';
  if (!JEST_BIN) return { output: '', pass: 0, fail: 0 };
  try {
    // Runs with cwd=tempDir so Jest picks up the local jest.config.js (no outer config leakage).
    raw = execSync(
      `node "${JEST_BIN}" --no-coverage "${testFile}" 2>&1`,
      { encoding: 'utf8', timeout: 25_000, cwd: tempDir },
    );
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    raw = typeof e.stdout === 'string' ? e.stdout : typeof e.stderr === 'string' ? e.stderr : '';
  }
  const testsLine = raw.match(/^Tests:\s*(.+)$/im);
  const searchIn = testsLine ? testsLine[1] : raw;
  const passMatch = searchIn.match(/(\d+)\s+pass(?:ed|ing)?/i);
  const failMatch = searchIn.match(/(\d+)\s+fail(?:ed|ing)?/i);
  return {
    output: raw,
    pass: passMatch ? parseInt(passMatch[1], 10) : 0,
    fail: failMatch ? parseInt(failMatch[1], 10) : 0,
  };
}

// Suites that spawn real Jest subprocesses get a generous timeout — each
// subprocess can take 5-15 s on first run.
describe('classifyRedTaxonomy — real Jest subprocess output', () => {
  jest.setTimeout(60_000);

  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testgen-gate-cli-'));
    // Minimal jest config so the subprocess uses its own rootDir and no transform.
    fs.writeFileSync(
      path.join(tempDir, 'jest.config.js'),
      'module.exports = { testEnvironment: "node", transform: {} };\n',
      'utf8',
    );
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns EXPECTED_RED_ASSERTION when a test has a failing assertion', () => {
    const testFile = path.join(tempDir, 'failing-assertion.test.js');
    fs.writeFileSync(testFile, "test('value', () => { expect(1).toBe(2); });\n", 'utf8');
    const { output, pass, fail } = spawnJest(testFile, tempDir);
    expect(fail).toBeGreaterThanOrEqual(1);
    const verdict = classifyRedTaxonomy(output, fail, pass);
    expect(verdict).toBe('EXPECTED_RED_ASSERTION');
    expect(isProvenRed(verdict)).toBe(true);
  });

  it('returns EXPECTED_RED_MISSING_REQUIRED_API when a required function is undefined', () => {
    const testFile = path.join(tempDir, 'missing-api.test.js');
    fs.writeFileSync(
      testFile,
      "test('calls undefined fn', () => { undefinedFunction(); });\n",
      'utf8',
    );
    const { output, pass, fail } = spawnJest(testFile, tempDir);
    expect(fail).toBeGreaterThanOrEqual(1);
    const verdict = classifyRedTaxonomy(output, fail, pass);
    expect(verdict).toBe('EXPECTED_RED_MISSING_REQUIRED_API');
    expect(isProvenRed(verdict)).toBe(true);
  });

  it('returns INVALID_RED_COMPILE when the test requires a nonexistent module', () => {
    const testFile = path.join(tempDir, 'missing-module.test.js');
    fs.writeFileSync(
      testFile,
      "const x = require('./totally-nonexistent-module-xyz');\ntest('uses x', () => { expect(x).toBeTruthy(); });\n",
      'utf8',
    );
    const { output, pass, fail } = spawnJest(testFile, tempDir);
    const verdict = classifyRedTaxonomy(output, fail, pass);
    expect(verdict).toBe('INVALID_RED_COMPILE');
    expect(isProvenRed(verdict)).toBe(false);
  });

  it('returns BASELINE_ALREADY_GREEN when all tests pass', () => {
    const testFile = path.join(tempDir, 'passing.test.js');
    fs.writeFileSync(testFile, "test('passes', () => { expect(1).toBe(1); });\n", 'utf8');
    const { output, pass, fail } = spawnJest(testFile, tempDir);
    expect(pass).toBeGreaterThanOrEqual(1);
    const verdict = classifyRedTaxonomy(output, fail, pass);
    expect(verdict).toBe('BASELINE_ALREADY_GREEN');
    expect(isProvenRed(verdict)).toBe(false);
  });
});

// Fast unit tests — no subprocess, just realistic TestRunResult shapes.
describe('classifyRedFromTestRun — realistic TestRunResult scenarios', () => {
  function makeRun(opts: {
    failing?: number;
    passing?: number;
    parseable?: boolean;
    rawOutput?: string;
    failedStatuses?: number;
  }): TestRunResult {
    const failing = opts.failing ?? 0;
    const passing = opts.passing ?? 0;
    const parseable = opts.parseable ?? true;
    const failedStatuses = opts.failedStatuses ?? failing;
    return {
      snapshot: {
        failing,
        passing,
        skipped: 0,
        exitCode: failing > 0 ? 1 : 0,
        rawOutput: opts.rawOutput ?? '',
        parseable,
      },
      failures: [],
      testCases: [
        ...Array.from({ length: passing }, (_, i) => ({
          testName: `pass-${i}`,
          status: 'passed' as const,
          failureMessages: [],
        })),
        ...Array.from({ length: failedStatuses }, (_, i) => ({
          testName: `fail-${i}`,
          status: 'failed' as const,
          failureMessages: [`Expected: ${i + 2}\nReceived: ${i}`],
        })),
      ],
      verificationScope: 'file',
    };
  }

  it('classifies EXPECTED_RED_ASSERTION from testCases.status=failed', () => {
    const run = makeRun({ failing: 2, failedStatuses: 2 });
    expect(classifyRedFromTestRun(run)).toBe('EXPECTED_RED_ASSERTION');
    expect(isProvenRed('EXPECTED_RED_ASSERTION')).toBe(true);
  });

  it('classifies BASELINE_ALREADY_GREEN when all tests pass', () => {
    expect(classifyRedFromTestRun(makeRun({ passing: 3, failing: 0 }))).toBe('BASELINE_ALREADY_GREEN');
  });

  it('classifies INVALID_RED_ENVIRONMENT when snapshot is not parseable', () => {
    expect(classifyRedFromTestRun(makeRun({ parseable: false, failing: 1 }))).toBe('INVALID_RED_ENVIRONMENT');
  });

  it('falls back to rawOutput heuristics for compile errors (no testCase.status=failed)', () => {
    const run = makeRun({ failing: 0, passing: 0, rawOutput: 'Cannot find module ./nonExistent', failedStatuses: 0 });
    expect(classifyRedFromTestRun(run)).toBe('INVALID_RED_COMPILE');
  });

  it('falls back to EXPECTED_RED_MISSING_REQUIRED_API when rawOutput names missing API', () => {
    const run = makeRun({
      failing: 1,
      passing: 0,
      rawOutput: 'TypeError: validateTransfer is not a function',
      failedStatuses: 0,
    });
    expect(classifyRedFromTestRun(run)).toBe('EXPECTED_RED_MISSING_REQUIRED_API');
    expect(isProvenRed('EXPECTED_RED_MISSING_REQUIRED_API')).toBe(true);
  });

  it('returns AMBIGUOUS_RED_UNRELATED_FAILURE when rawOutput has no known pattern', () => {
    const run = makeRun({ failing: 1, passing: 0, rawOutput: 'some random test failure', failedStatuses: 0 });
    expect(classifyRedFromTestRun(run)).toBe('AMBIGUOUS_RED_UNRELATED_FAILURE');
    expect(isProvenRed('AMBIGUOUS_RED_UNRELATED_FAILURE')).toBe(false);
  });

  it('isProvenRed returns true only for the two proven taxonomies', () => {
    expect(isProvenRed('EXPECTED_RED_ASSERTION')).toBe(true);
    expect(isProvenRed('EXPECTED_RED_MISSING_REQUIRED_API')).toBe(true);
    expect(isProvenRed('BASELINE_ALREADY_GREEN')).toBe(false);
    expect(isProvenRed('INVALID_RED_COMPILE')).toBe(false);
    expect(isProvenRed('INVALID_RED_FIXTURE')).toBe(false);
    expect(isProvenRed('AMBIGUOUS_RED_UNRELATED_FAILURE')).toBe(false);
    expect(isProvenRed('INVALID_RED_ENVIRONMENT')).toBe(false);
  });
});
