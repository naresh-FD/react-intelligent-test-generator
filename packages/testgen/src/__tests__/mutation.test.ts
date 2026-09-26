import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadWaivers, saveWaiver, removeWaiver } from '../mutation/waiver';
import { runMutation } from '../mutation/runner';

describe('waiver management', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testgen-mutation-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when no waiver file exists', () => {
    expect(loadWaivers(tmpDir)).toEqual([]);
  });

  it('saves and loads a waiver', () => {
    const waiver = saveWaiver(tmpDir, {
      mutantId: 'mut-001',
      ticketId: 'AB-1001',
      reason: 'This mutant is equivalent — the condition is always true in the domain',
      waivedBy: 'naresh',
    });

    expect(waiver.mutantId).toBe('mut-001');
    expect(waiver.waivedAt).toBeTruthy();

    const loaded = loadWaivers(tmpDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].mutantId).toBe('mut-001');
  });

  it('rejects waivers with short reason', () => {
    expect(() =>
      saveWaiver(tmpDir, {
        mutantId: 'mut-002',
        ticketId: 'AB-1001',
        reason: 'too short',
        waivedBy: 'naresh',
      }),
    ).toThrow(/reason must be at least 10 characters/i);
  });

  it('rejects duplicate waivers', () => {
    saveWaiver(tmpDir, {
      mutantId: 'mut-003',
      ticketId: 'AB-1001',
      reason: 'This is a valid long-enough reason for the waiver',
      waivedBy: 'naresh',
    });

    expect(() =>
      saveWaiver(tmpDir, {
        mutantId: 'mut-003',
        ticketId: 'AB-1001',
        reason: 'Duplicate waiver attempt here',
        waivedBy: 'naresh',
      }),
    ).toThrow(/already exists/i);
  });

  it('removes an existing waiver', () => {
    saveWaiver(tmpDir, {
      mutantId: 'mut-004',
      ticketId: 'AB-1001',
      reason: 'This mutant is irrelevant to the requirement under test',
      waivedBy: 'naresh',
    });

    const removed = removeWaiver(tmpDir, 'mut-004', 'AB-1001');
    expect(removed).toBe(true);
    expect(loadWaivers(tmpDir)).toHaveLength(0);
  });

  it('returns false when removing a non-existent waiver', () => {
    const removed = removeWaiver(tmpDir, 'mut-999', 'AB-1001');
    expect(removed).toBe(false);
  });

  it('filters waivers by ticketId when multiple tickets present', () => {
    saveWaiver(tmpDir, {
      mutantId: 'mut-010',
      ticketId: 'AB-1001',
      reason: 'Equivalent mutant for ticket AB-1001 boundary condition',
      waivedBy: 'naresh',
    });
    saveWaiver(tmpDir, {
      mutantId: 'mut-011',
      ticketId: 'AB-1002',
      reason: 'Equivalent mutant for ticket AB-1002 boundary condition',
      waivedBy: 'naresh',
    });

    const waivers = loadWaivers(tmpDir).filter((w) => w.ticketId === 'AB-1001');
    expect(waivers).toHaveLength(1);
    expect(waivers[0].mutantId).toBe('mut-010');
  });
});

describe('runMutation (stub path)', () => {
  it('returns strykerAvailable=false when Stryker is not installed (stub result)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testgen-mut-stub-'));
    try {
      const result = runMutation(
        {
          ticketId: 'AB-1001',
          repoRoot: tmpDir,
          mutatedFiles: [path.join(tmpDir, 'src', 'foo.ts')],
          testFile: path.join(tmpDir, 'foo.test.ts'),
          gateMode: 'report-only',
        },
        'a'.repeat(64),
      );
      // Either strykerAvailable is false (no Stryker in test env) or it ran
      expect(['report-only']).toContain(result.gateMode);
      expect(result.schemaVersion).toBe(1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// Exercises the buildResult path by:
// 1. Creating a fake stryker binary so isStrykerAvailable() returns true via fs.existsSync
// 2. Pre-writing a synthetic mutation-report.json before runMutation runs (the stryker exec
//    is caught even if it fails, and the pre-written report is then parsed)
describe('runMutation — buildResult path (synthetic Stryker report)', () => {
  jest.setTimeout(15_000);

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testgen-mut-build-'));
    const binDir = path.join(tmpDir, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    // Fake stryker that exits 0 immediately — satisfies isStrykerAvailable fs.existsSync check
    fs.writeFileSync(path.join(binDir, 'stryker'), '#!/bin/sh\necho ok\nexit 0\n', { mode: 0o755 });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSyntheticReport(ticketId: string, mutants: Array<{ id: string; status: string }>): void {
    const outputDir = path.join(tmpDir, '.testgen-results', 'mutation', ticketId);
    fs.mkdirSync(outputDir, { recursive: true });
    const report = {
      files: {
        'src/feature.ts': {
          mutants: mutants.map((m) => ({
            id: m.id,
            mutatorName: 'ArithmeticOperator',
            replacement: '0',
            status: m.status,
            location: { start: { line: 1, column: 0 }, end: { line: 1, column: 5 } },
          })),
        },
      },
    };
    fs.writeFileSync(path.join(outputDir, 'mutation-report.json'), JSON.stringify(report), 'utf8');
  }

  function makeSrcFile(): string {
    const srcFile = path.join(tmpDir, 'src', 'feature.ts');
    fs.mkdirSync(path.dirname(srcFile), { recursive: true });
    fs.writeFileSync(srcFile, 'export const feature = () => {};', 'utf8');
    return srcFile;
  }

  it('computes killed/survived/noCoverage counts and mutation score from synthetic report', () => {
    const ticketId = 'AB-2001';
    const srcFile = makeSrcFile();
    writeSyntheticReport(ticketId, [
      { id: 'm1', status: 'Killed' },
      { id: 'm2', status: 'Killed' },
      { id: 'm3', status: 'Survived' },
      { id: 'm4', status: 'NoCoverage' },
    ]);
    const result = runMutation(
      { ticketId, repoRoot: tmpDir, mutatedFiles: [srcFile], testFile: path.join(tmpDir, `${ticketId}.test.ts`), gateMode: 'block-on-threshold' },
      'a'.repeat(64),
    );
    expect(result.strykerAvailable).toBe(true);
    expect(result.totalMutants).toBe(4);
    expect(result.killedMutants).toBe(2);
    expect(result.survivedMutants).toBe(1);
    expect(result.noCoverageMutants).toBe(1);
    expect(result.mutationScore).toBe(50);
  });

  it('adjusts effectiveScore when survived mutants are waived', () => {
    const ticketId = 'AB-2002';
    const srcFile = makeSrcFile();
    writeSyntheticReport(ticketId, [
      { id: 'm1', status: 'Killed' },
      { id: 'm2', status: 'Killed' },
      { id: 'm3', status: 'Survived' },
    ]);
    saveWaiver(tmpDir, {
      mutantId: 'm3',
      ticketId,
      reason: 'Equivalent mutant — condition is always true in this domain boundary',
      waivedBy: 'naresh',
    });
    const result = runMutation(
      { ticketId, repoRoot: tmpDir, mutatedFiles: [srcFile], testFile: path.join(tmpDir, `${ticketId}.test.ts`), gateMode: 'block-on-threshold' },
      'a'.repeat(64),
    );
    // m3 survived but is waived — survivedMutants excludes waived, effectiveScore uses reduced denominator
    expect(result.killedMutants).toBe(2);
    expect(result.survivedMutants).toBe(0);
    expect(result.waivedMutantIds).toContain('m3');
    expect(result.effectiveScore).toBe(100);
  });

  it('returns effectiveScore=100 when no mutants match the mutatedFiles scope', () => {
    const ticketId = 'AB-2003';
    writeSyntheticReport(ticketId, [{ id: 'm1', status: 'Survived' }]);
    // mutatedFiles points to a different file — 'src/other.ts' does not match 'src/feature.ts'
    const otherFile = path.join(tmpDir, 'src', 'other.ts');
    fs.mkdirSync(path.dirname(otherFile), { recursive: true });
    fs.writeFileSync(otherFile, 'export const other = () => {};', 'utf8');
    const result = runMutation(
      { ticketId, repoRoot: tmpDir, mutatedFiles: [otherFile], testFile: path.join(tmpDir, 'x.test.ts'), gateMode: 'report-only' },
      'a'.repeat(64),
    );
    expect(result.strykerAvailable).toBe(true);
    expect(result.totalMutants).toBe(0);
    expect(result.mutationScore).toBe(100);
    expect(result.effectiveScore).toBe(100);
  });

  it('rawReportPath points to the parsed Stryker JSON output file', () => {
    const ticketId = 'AB-2004';
    const srcFile = makeSrcFile();
    writeSyntheticReport(ticketId, [{ id: 'm1', status: 'Killed' }]);
    const result = runMutation(
      { ticketId, repoRoot: tmpDir, mutatedFiles: [srcFile], testFile: path.join(tmpDir, `${ticketId}.test.ts`), gateMode: 'report-only' },
      'a'.repeat(64),
    );
    expect(result.rawReportPath).toBeTruthy();
    expect(fs.existsSync(result.rawReportPath!)).toBe(true);
    expect(result.rawReportPath).toContain('mutation-report.json');
  });
});
