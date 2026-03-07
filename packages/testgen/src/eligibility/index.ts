// ---------------------------------------------------------------------------
// Eligibility Engine — Public API
// ---------------------------------------------------------------------------

export type {
    FileKind,
    EligibilityAction,
    FileSignals,
    FileEligibilityResult,
    EligibilityScanReport,
    SkipEntry,
    ManualReviewEntry,
} from './types';

export { extractSignals } from './signals';
export { classifyFileKind } from './classifier';
export { computeTestabilityScore, computeComplexityScore, computeConfidence } from './scoring';
export { evaluateFile, evaluateFiles } from './engine';
export {
    buildScanReport,
    formatReportAsJson,
    formatReportAsMarkdown,
    printEligibilitySummary,
} from './reporter';
