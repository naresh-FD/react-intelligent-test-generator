import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildTraceabilityChain, generateTraceabilityReport } from '../traceability/chain';
import type { FrozenTestRecord } from '../greenPhase/types';
import type { GreenPhaseResult } from '../greenPhase/types';

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function writeFrozen(root: string, ticketId: string): void {
  const redDir = path.join(root, '.testgen-results', 'red');
  fs.mkdirSync(redDir, { recursive: true });
  const record: FrozenTestRecord = {
    schemaVersion: 1,
    ticketId,
    rtcHash: sha256('rtc-content'),
    testFile: path.join(redDir, `${ticketId}.rtc.test.ts`),
    testFileHash: sha256('test-content'),
    redTaxonomy: 'EXPECTED_RED_ASSERTION',
    failCount: 2,
    passCount: 0,
    generatedAt: '2026-08-01T10:00:00Z',
  };
  fs.writeFileSync(path.join(redDir, `${ticketId}.frozen.json`), JSON.stringify(record), 'utf8');
  // Write a test file with rtc-requirement comments
  const testContent = `// @rtc-requirement ${ticketId}-AC-01\nit('test', () => { expect(1).toBe(2); });`;
  fs.writeFileSync(record.testFile, testContent, 'utf8');
}

function writeMutation(root: string, ticketId: string, effectiveScore = 85): void {
  const mutDir = path.join(root, '.testgen-results', 'mutation', ticketId);
  fs.mkdirSync(mutDir, { recursive: true });
  const result = {
    schemaVersion: 1,
    ticketId,
    rtcHash: sha256('rtc-content'),
    gateMode: 'block-on-threshold',
    mutatedFiles: ['src/feature.ts'],
    testFile: path.join(root, '.testgen-results', 'red', `${ticketId}.rtc.test.ts`),
    totalMutants: 10,
    killedMutants: Math.round(10 * effectiveScore / 100),
    survivedMutants: 10 - Math.round(10 * effectiveScore / 100),
    noCoverageMutants: 0,
    mutationScore: effectiveScore,
    mutants: [],
    waivedMutantIds: [],
    effectiveScore,
    generatedAt: '2026-08-01T12:00:00Z',
    strykerAvailable: true,
  };
  fs.writeFileSync(path.join(mutDir, 'mutation-result.json'), JSON.stringify(result), 'utf8');
}

function writeRegressionSuite(root: string, ticketId: string, testCount = 5): void {
  const regDir = path.join(root, '.testgen-results', 'regression', ticketId);
  fs.mkdirSync(regDir, { recursive: true });
  const record = {
    ticketId,
    suiteFile: `regression/${ticketId}.regression.test.ts`,
    testCount,
    generatedAt: '2026-08-01T13:00:00Z',
  };
  fs.writeFileSync(path.join(regDir, 'regression-suite.json'), JSON.stringify(record), 'utf8');
}

function writeGreen(root: string, ticketId: string, verdict: GreenPhaseResult['verdict'] = 'GREEN'): void {
  const greenDir = path.join(root, '.testgen-results', 'green', ticketId);
  fs.mkdirSync(greenDir, { recursive: true });
  const result: GreenPhaseResult = {
    ticketId,
    rtcHash: sha256('rtc-content'),
    testFile: path.join(root, '.testgen-results', 'red', `${ticketId}.rtc.test.ts`),
    verdict,
    frozenHash: sha256('test-content'),
    currentHash: sha256('test-content'),
    hashMatch: true,
    passCount: verdict === 'GREEN' ? 2 : 0,
    failCount: verdict === 'GREEN' ? 0 : 2,
    requirementResults: [{ requirementId: `${ticketId}-AC-01`, verdict: verdict === 'GREEN' ? 'GREEN' : 'STILL_RED' }],
    assertionWeakeningDetected: false,
    weakenedAssertions: [],
    generatedAt: '2026-08-01T11:00:00Z',
  };
  fs.writeFileSync(path.join(greenDir, 'green-result.json'), JSON.stringify(result), 'utf8');
}

describe('buildTraceabilityChain', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testgen-trace-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns an incomplete chain when only RED phase exists', () => {
    const ticketId = 'AB-1001';
    writeFrozen(tmpDir, ticketId);

    const chain = buildTraceabilityChain({ ticketId, repoRoot: tmpDir });

    expect(chain.ticketId).toBe(ticketId);
    expect(chain.links.redResult.hash).not.toBe('PENDING');
    expect(chain.links.greenResult).toBeUndefined();
    expect(chain.chainComplete).toBe(false);
  });

  it('returns an incomplete chain when only RED and GREEN exist (no mutation or regression)', () => {
    const ticketId = 'AB-1002';
    writeFrozen(tmpDir, ticketId);
    writeGreen(tmpDir, ticketId, 'GREEN');

    const chain = buildTraceabilityChain({ ticketId, repoRoot: tmpDir });

    // GREEN and RED are present but mutation + regression links are missing
    expect(chain.chainComplete).toBe(false);
    expect(chain.links.redResult.hash).toBe('EXPECTED_RED_ASSERTION');
    expect(chain.links.greenResult?.hash).toBe('GREEN');
    expect(chain.links.mutationResult).toBeUndefined();
    expect(chain.links.regressionSuite).toBeUndefined();
  });

  it('chainComplete is true only when RED, GREEN (verdict=GREEN), mutation, and regression all exist', () => {
    const ticketId = 'AB-1002b';
    writeFrozen(tmpDir, ticketId);
    writeGreen(tmpDir, ticketId, 'GREEN');
    writeMutation(tmpDir, ticketId, 90);
    writeRegressionSuite(tmpDir, ticketId, 7);

    const chain = buildTraceabilityChain({ ticketId, repoRoot: tmpDir });

    expect(chain.chainComplete).toBe(true);
    expect(chain.links.greenResult?.hash).toBe('GREEN');
    expect(chain.links.mutationResult?.hash).toBe('90');
    expect(chain.links.regressionSuite?.hash).toBe('regression/AB-1002b.regression.test.ts');
  });

  it('chainComplete is false when GREEN verdict is STILL_RED even with mutation and regression', () => {
    const ticketId = 'AB-1003';
    writeFrozen(tmpDir, ticketId);
    writeGreen(tmpDir, ticketId, 'STILL_RED');
    writeMutation(tmpDir, ticketId, 85);
    writeRegressionSuite(tmpDir, ticketId, 3);

    const chain = buildTraceabilityChain({ ticketId, repoRoot: tmpDir });

    // GREEN verdict is not 'GREEN', so chain is not complete
    expect(chain.chainComplete).toBe(false);
    expect(chain.links.greenResult?.hash).toBe('STILL_RED');
    // Relevance proof gates will not be VALIDATED
    const proof = chain.relevanceProofs[0];
    expect(proof?.overallStatus).not.toBe('VALIDATED');
  });

  it('generates relevance proofs from frozen test file comments', () => {
    const ticketId = 'AB-1004';
    writeFrozen(tmpDir, ticketId);
    writeGreen(tmpDir, ticketId, 'GREEN');

    const chain = buildTraceabilityChain({ ticketId, repoRoot: tmpDir });

    expect(chain.relevanceProofs.length).toBeGreaterThan(0);
    const proof = chain.relevanceProofs[0];
    expect(proof.gates.requirementProvenance.status).toBe('PASS');
  });

  it('writes chain file to disk', () => {
    const ticketId = 'AB-1005';
    writeFrozen(tmpDir, ticketId);

    const chain = buildTraceabilityChain({ ticketId, repoRoot: tmpDir });

    expect(fs.existsSync(chain.reportPath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(chain.reportPath, 'utf8'));
    expect(written.ticketId).toBe(ticketId);
  });
});

describe('generateTraceabilityReport', () => {
  it('renders a markdown report with gate status', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testgen-trace-report-'));
    const ticketId = 'AB-1006';
    writeFrozen(tmpDir, ticketId);
    writeGreen(tmpDir, ticketId, 'GREEN');

    const chain = buildTraceabilityChain({ ticketId, repoRoot: tmpDir });
    const report = generateTraceabilityReport(chain);

    expect(report).toContain(`# Traceability Chain — ${ticketId}`);
    expect(report).toContain('EXPECTED_RED_ASSERTION');
    expect(report).toContain('GREEN');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
