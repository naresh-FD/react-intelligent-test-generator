import type { TestFramework } from '../redPhase/types';

export type { TestFramework };

export type GreenVerdict = 'GREEN' | 'STILL_RED' | 'HASH_MISMATCH' | 'ASSERTION_WEAKENED' | 'ERROR' | 'UNPROVEN_RED';

export type RedTaxonomyVerdict =
  | 'EXPECTED_RED_ASSERTION'
  | 'EXPECTED_RED_MISSING_REQUIRED_API'
  | 'BASELINE_ALREADY_GREEN'
  | 'INVALID_RED_COMPILE'
  | 'INVALID_RED_ENVIRONMENT'
  | 'INVALID_RED_FIXTURE'
  | 'AMBIGUOUS_RED_UNRELATED_FAILURE';

export interface FrozenTestRecord {
  schemaVersion: 1;
  ticketId: string;
  rtcHash: string;
  testFile: string;
  testFileHash: string;
  redTaxonomy: RedTaxonomyVerdict;
  failCount: number;
  passCount: number;
  generatedAt: string;
}

export interface GreenPhaseInput {
  ticketId: string;
  repoRoot: string;
  redResultDir: string;
  framework: TestFramework;
}

export interface RequirementGreenResult {
  requirementId: string;
  verdict: 'GREEN' | 'STILL_RED' | 'UNKNOWN';
}

export interface GreenPhaseResult {
  ticketId: string;
  rtcHash: string;
  testFile: string;
  verdict: GreenVerdict;
  frozenHash: string;
  currentHash: string;
  hashMatch: boolean;
  passCount: number;
  failCount: number;
  requirementResults: RequirementGreenResult[];
  assertionWeakeningDetected: boolean;
  weakenedAssertions: string[];
  errorOutput?: string;
  generatedAt: string;
}

export interface CopilotHandoffDocument {
  ticketId: string;
  filePath: string;
  content: string;
}
