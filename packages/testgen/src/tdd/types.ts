import type { TestRunResult } from '../repairRuntime';
import type { RedTaxonomyVerdict } from '../greenPhase/types';

export type { RedTaxonomyVerdict };
export type TddPhase = 'red' | 'green' | 'refactor';
export type TddGateStatus = 'RED_PROVEN' | 'GREEN_PROVEN' | 'REFACTOR_PROVEN' | 'REJECTED';

export interface TddReceipt {
  version: 1;
  testFilePath: string;
  testHash: string;
  phase: TddPhase;
  redTaxonomy: RedTaxonomyVerdict;
  redProvenAt: string;
  greenProvenAt?: string;
  refactorProvenAt?: string;
  refactorCount: number;
}

export interface TddGateResult {
  status: TddGateStatus;
  phase: TddPhase;
  reason: string;
  run: TestRunResult;
  receipt?: TddReceipt;
}

export interface TddRunner {
  (testFilePath: string): Promise<TestRunResult>;
}
