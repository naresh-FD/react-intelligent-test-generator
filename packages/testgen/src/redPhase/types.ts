import type { MappingDecision, MappingResult, SymbolKind } from '../mapping/types';
import type { RequirementCriterion, RequirementTestContract } from '../requirements/types';

export type TestFramework = 'jest' | 'vitest';
export type RedVerdict = 'red' | 'green' | 'error' | 'skipped';

export interface RedPhaseConfig {
  framework: TestFramework;
  outputDir: string;
  dryRun: boolean;
}

export interface SymbolTarget {
  path: string;
  symbol: string;
  kind: SymbolKind;
  line: number;
}

export interface RequirementTestCase {
  requirementId: string;
  title: string;
  arrangeLines: string[];
  actLines: string[];
  assertLines: string[];
  asyncMode: 'sync' | 'async';
  skipped: boolean;
  skipReason?: string;
}

export interface GeneratedTestSuite {
  ticketId: string;
  ticketTitle: string;
  fileName: string;
  imports: GeneratedImport[];
  testCases: RequirementTestCase[];
  source: string;
  target?: SymbolTarget;
}

export interface GeneratedImport {
  modulePath: string;
  namedImports: string[];
  defaultImport?: string;
}

export interface RedVerification {
  testFile: string;
  verdict: RedVerdict;
  failCount: number;
  passCount: number;
  errorOutput?: string;
}

export interface RedPhaseResult {
  ticketId: string;
  rtcHash: string;
  suites: GeneratedTestSuite[];
  verifications: RedVerification[];
  generatedAt: string;
  summary: {
    totalRequirements: number;
    testsGenerated: number;
    testsSkipped: number;
    redConfirmed: number;
    errors: number;
  };
}

export interface RedPhaseInput {
  rtc: RequirementTestContract;
  mapping: MappingResult;
  config: RedPhaseConfig;
  repoRoot: string;
}
