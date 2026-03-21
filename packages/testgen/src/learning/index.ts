/**
 * Learning module — normalized dataset, signal extraction, and outcome tracking.
 */

export { writeIssueRecord, recordHealingOutcome, writeHealHistoryEntry, updateIssueStats } from './issueDatasetWriter';
export type { IssueDatasetRecord } from './issueDatasetWriter';

export { readAllRecords, queryByIssueType, queryByComponent, queryByPhase, getSuccessfulFixes, getFailedFixes, readIssueStats, getTopIssueTypes } from './issueDatasetReader';

export { extractErrorSignature, extractErrorType, extractInvolvedSymbol } from './errorSignatureExtractor';

export { normalizeIssue } from './issueNormalizer';
export type { NormalizationInput } from './issueNormalizer';

export { trackFixOutcomes, computeStrategySuccessRate } from './fixOutcomeTracker';
export type { FixOutcome } from './fixOutcomeTracker';

export { getSeedExamples, writeSeedExamplesIfNeeded } from './seedExamples';
