import { classifyRedTaxonomy } from '../greenPhase/runner';
import type { RedTaxonomyVerdict } from '../greenPhase/types';

export { classifyRedTaxonomy };
export type { RedTaxonomyVerdict };

export const PROVEN_RED_TAXONOMIES: ReadonlySet<RedTaxonomyVerdict> = new Set([
  'EXPECTED_RED_ASSERTION',
  'EXPECTED_RED_MISSING_REQUIRED_API',
]);

export function isProvenRed(taxonomy: RedTaxonomyVerdict): boolean {
  return PROVEN_RED_TAXONOMIES.has(taxonomy);
}

/**
 * Classify the RED taxonomy from a structured TddRunner result.
 * Uses structured test-case status as the primary signal (more reliable than
 * regex matching on raw output), then falls back to classifyRedTaxonomy for
 * compile/fixture/missing-API detection when no behavioral failure is present.
 */
export function classifyRedFromTestRun(run: {
  snapshot: { rawOutput: string; failing: number; passing: number; parseable: boolean };
  testCases: ReadonlyArray<{ status: string }>;
}): RedTaxonomyVerdict {
  if (!run.snapshot.parseable) return 'INVALID_RED_ENVIRONMENT';
  if (run.snapshot.failing === 0 && run.snapshot.passing > 0) return 'BASELINE_ALREADY_GREEN';
  // Behavioral failure: a test case itself reported status=failed
  if (run.testCases.some((tc) => tc.status === 'failed')) return 'EXPECTED_RED_ASSERTION';
  // No behavioral failure (compile, fixture, environment) — use raw-output heuristics
  return classifyRedTaxonomy(run.snapshot.rawOutput, run.snapshot.failing, run.snapshot.passing);
}
