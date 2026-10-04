import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { TddGateResult, TddReceipt, TddRunner } from './types';
import { classifyRedFromTestRun, isProvenRed } from './gate';

export interface TddSessionOptions {
  projectRoot: string;
  runner: TddRunner;
  outputRoot?: string;
  now?: () => Date;
}

export class TddSession {
  private readonly outputRoot: string;
  private readonly now: () => Date;

  constructor(private readonly options: TddSessionOptions) {
    this.outputRoot = options.outputRoot ?? path.join(options.projectRoot, '.testgen-results', 'tdd');
    this.now = options.now ?? (() => new Date());
  }

  async proveRed(testFilePath: string): Promise<TddGateResult> {
    const resolved = this.assertTestPath(testFilePath);
    const run = await this.options.runner(resolved);

    if (!run.snapshot.parseable) {
      return this.rejected('red', run, 'RED rejected: test runner output is not trustworthy/parseable.');
    }

    const taxonomy = classifyRedFromTestRun(run);
    if (!isProvenRed(taxonomy)) {
      const noBehavioralFailure = !run.testCases.some((tc) => tc.status === 'failed');
      const reason = noBehavioralFailure
        ? 'RED rejected: no failing test case was observed. Compile, import, setup, or empty-suite failures do not count as TDD RED.'
        : `RED rejected: taxonomy is "${taxonomy}". Only EXPECTED_RED_ASSERTION or EXPECTED_RED_MISSING_REQUIRED_API count as proven RED.`;
      return this.rejected('red', run, reason);
    }

    const receipt: TddReceipt = {
      version: 1,
      testFilePath: resolved,
      testHash: fileHash(resolved),
      phase: 'red',
      redTaxonomy: taxonomy,
      redProvenAt: this.now().toISOString(),
      refactorCount: 0,
    };
    this.writeReceipt(receipt);
    return {
      status: 'RED_PROVEN',
      phase: 'red',
      reason: `RED proven: ${taxonomy} with ${run.snapshot.failing} failing test(s).`,
      run,
      receipt,
    };
  }

  async proveGreen(testFilePath: string): Promise<TddGateResult> {
    const resolved = this.assertTestPath(testFilePath);
    const receipt = this.readReceipt(resolved);
    const run = await this.options.runner(resolved);

    if (!receipt) {
      return this.rejected('green', run, 'GREEN rejected: no prior RED receipt exists for this test file.');
    }
    if (receipt.testHash !== fileHash(resolved)) {
      return this.rejected(
        'green',
        run,
        'GREEN rejected: the test changed after RED. Re-run RED so the implementation cannot pass by weakening the test.',
      );
    }
    if (!isCleanPass(run)) {
      return this.rejected('green', run, 'GREEN rejected: the exact RED-proven test is not fully passing.');
    }

    const next: TddReceipt = {
      ...receipt,
      phase: 'green',
      greenProvenAt: this.now().toISOString(),
    };
    this.writeReceipt(next);
    return {
      status: 'GREEN_PROVEN',
      phase: 'green',
      reason: `GREEN proven with ${run.snapshot.passing} passing test(s) and zero failures.`,
      run,
      receipt: next,
    };
  }

  async proveRefactor(testFilePath: string): Promise<TddGateResult> {
    const resolved = this.assertTestPath(testFilePath);
    const receipt = this.readReceipt(resolved);
    const run = await this.options.runner(resolved);

    if (!receipt?.greenProvenAt) {
      return this.rejected('refactor', run, 'REFACTOR rejected: GREEN must be proven before refactoring.');
    }
    if (receipt.testHash !== fileHash(resolved)) {
      return this.rejected(
        'refactor',
        run,
        'REFACTOR rejected: the behavior test changed. Start a new RED cycle for changed behavior.',
      );
    }
    if (!isCleanPass(run)) {
      return this.rejected('refactor', run, 'REFACTOR rejected: refactoring broke the GREEN contract.');
    }

    const next: TddReceipt = {
      ...receipt,
      phase: 'refactor',
      refactorProvenAt: this.now().toISOString(),
      refactorCount: receipt.refactorCount + 1,
    };
    this.writeReceipt(next);
    return {
      status: 'REFACTOR_PROVEN',
      phase: 'refactor',
      reason: `REFACTOR proven; behavior remains green (${run.snapshot.passing} passing test(s)).`,
      run,
      receipt: next,
    };
  }

  status(testFilePath: string): TddReceipt | undefined {
    return this.readReceipt(this.assertTestPath(testFilePath));
  }

  private rejected(phase: 'red' | 'green' | 'refactor', run: TddGateResult['run'], reason: string): TddGateResult {
    return { status: 'REJECTED', phase, reason, run };
  }

  private receiptPath(testFilePath: string): string {
    const id = createHash('sha256').update(path.resolve(testFilePath)).digest('hex').slice(0, 24);
    return path.join(this.outputRoot, `${id}.json`);
  }

  private readReceipt(testFilePath: string): TddReceipt | undefined {
    const file = this.receiptPath(testFilePath);
    if (!fs.existsSync(file)) return undefined;
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8')) as TddReceipt;
      return value.version === 1 && value.testFilePath === path.resolve(testFilePath) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  private writeReceipt(receipt: TddReceipt): void {
    fs.mkdirSync(this.outputRoot, { recursive: true });
    const target = this.receiptPath(receipt.testFilePath);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporary, target);
  }

  private assertTestPath(testFilePath: string): string {
    const resolved = path.resolve(testFilePath);
    const relative = path.relative(path.resolve(this.options.projectRoot), resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`TDD test path is outside project root: ${testFilePath}`);
    }
    if (!fs.existsSync(resolved)) throw new Error(`TDD test file does not exist: ${testFilePath}`);
    return resolved;
  }
}

function fileHash(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function isCleanPass(run: TddGateResult['run']): boolean {
  return run.snapshot.parseable && run.snapshot.exitCode === 0 && run.snapshot.failing === 0 && run.snapshot.passing > 0;
}
