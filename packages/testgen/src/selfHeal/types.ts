export const FAILURE_CATEGORIES = [
  'missing-jest-dom-matcher',
  'missing-provider-wrapper',
  'bad-import-resolution',
  'bad-module-mock',
  'non-existent-export-mock',
  'async-query-mismatch',
  'selector-too-weak',
  'multiple-elements-found',
  'element-not-found',
  'event-simulation-mismatch',
  'hook-context-missing',
  'service-mock-missing',
  'router-missing',
  'query-client-missing',
  'redux-store-missing',
  'unknown',
] as const;

export type FailureCategory = typeof FAILURE_CATEGORIES[number];

export interface FailureSignature {
  category: FailureCategory;
  fingerprint: string;
  normalizedText: string;
  summary: string;
  confidence: number;
  evidence: string;
}

export const REPAIR_ACTION_KINDS = [
  'regenerate',
  'rewrite',
  'wrap',
  'mock',
  'import-adjustment',
  'assertion-adjustment',
  'defer',
] as const;

export type RepairActionKind = typeof REPAIR_ACTION_KINDS[number];

export interface RepairAction {
  id: string;
  kind: RepairActionKind;
  description: string;
  deterministic: boolean;
  safeToPromote: boolean;
}

export const REPAIR_PATCH_OPERATION_TYPES = [
  'insert-import',
  'insert-setup',
  'wrap-render',
  'replace-text',
  'rewrite-mock',
  'regenerate-with-hint',
] as const;

export type RepairPatchOperationType = typeof REPAIR_PATCH_OPERATION_TYPES[number];

export interface RepairPatchOperation {
  type: RepairPatchOperationType;
  description: string;
  before?: string;
  after?: string;
  metadata?: Record<string, string>;
}

export interface RepairResult {
  applied: boolean;
  action: RepairAction;
  reason: string;
  updatedContent?: string;
  confidence?: number;
  explanation?: string;
  strategyId?: string;
  generatorPatch?: RepairPatchOperation[];
}

export interface HealingAttempt {
  attemptNumber: number;
  signature: FailureSignature;
  action: RepairAction;
  result: RepairResult;
  startedAt: string;
  finishedAt?: string;
}

export interface HealingMemoryEntry {
  signature: FailureSignature;
  action: RepairAction;
  attempts: number;
  successes: number;
  failures: number;
  promoted: boolean;
  lastAppliedAt: string;
}

export type HealReportStatus = 'generated' | 'pass' | 'fail' | 'low-coverage' | 'skipped';

export interface HealReportAttempt {
  attemptNumber: number;
  failure: FailureSignature;
  action: RepairAction;
  strategyId?: string;
  applied: boolean;
  success: boolean;
  reason: string;
  explanation?: string;
}

export interface HealReportSuccessfulRepair {
  attemptNumber: number;
  action: RepairAction;
  strategyId?: string;
}

export interface HealReportPromotedAction {
  action: RepairAction;
  strategyId?: string;
  trigger: 'component-pattern' | 'trait';
}

export interface HealReportEntry {
  sourceFilePath: string;
  testFilePath: string;
  fileName: string;
  componentNames: string[];
  initialStatus: HealReportStatus;
  failureSignatures: FailureSignature[];
  promotedDefaultsApplied: HealReportPromotedAction[];
  repairActionsAttempted: HealReportAttempt[];
  successfulRepair?: HealReportSuccessfulRepair;
  retriesUsed: number;
  finalStatus: HealReportStatus;
  remainingBlocker?: string;
}

export interface HealReportCategoryCount {
  category: FailureCategory;
  count: number;
}

export interface HealReportAggregate {
  totalEntries: number;
  initiallyFailing: number;
  fixed: number;
  unresolved: number;
  lowCoverage: number;
  passWithoutHealing: number;
  retriesUsed: number;
  repeatedFailureCategories: HealReportCategoryCount[];
}

export interface HealReportPayload {
  generatedAt: string;
  aggregate: HealReportAggregate;
  entries: HealReportEntry[];
}

export interface ProviderWrapperDescriptor {
  importStatement: string;
  wrapperName: string;
  wrapperProps?: string;
}

export interface ImportResolutionHint {
  from: string;
  to: string;
}

export interface SelectorReplacement {
  from: string;
  to: string;
  description?: string;
}

export interface ComponentTraits {
  requiredProviders?: ProviderWrapperDescriptor[];
  importResolutionHints?: ImportResolutionHint[];
  selectorReplacements?: SelectorReplacement[];
  usesRouter?: boolean;
  usesAsyncData?: boolean;
  usesReactQuery?: boolean;
  usesRedux?: boolean;
  queryClientImportStatement?: string;
  queryClientSetupStatement?: string;
  queryClientIdentifier?: string;
  reduxProviderImportStatement?: string;
  reduxStoreFactorySnippet?: string;
  reduxStoreIdentifier?: string;
}

export interface RepairMemoryRankHint {
  actionId: string;
  score: number;
}

export interface RepairContext {
  testContent: string;
  failure: FailureSignature;
  componentTraits?: ComponentTraits;
  sourceFilePath?: string;
  testFilePath?: string;
  generationMetadata?: Record<string, string | boolean | string[]>;
  memoryRankedActions?: RepairMemoryRankHint[];
}

export interface RepairDecision extends RepairResult {
  confidence: number;
  explanation: string;
  strategyId: string;
}

export interface RepairStrategy {
  id: string;
  categories: FailureCategory[];
  priority: number;
  action: RepairAction;
  apply(context: RepairContext): RepairDecision | null;
}
