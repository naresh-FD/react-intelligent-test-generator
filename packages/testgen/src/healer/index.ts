// ---------------------------------------------------------------------------
// Self-Healing Orchestrator
//
// Coordinates: analyzer → memory → knowledge base → RepairPlan
// One root-cause fix per iteration. No post-hoc file patching.
// ---------------------------------------------------------------------------

import { FailureDetail, FailureAnalysis, FailureCategory, pickRootCause, analyzeFailures } from './analyzer';
import { RepairPlan, findRepairPlan } from './knowledge-base';
import { lookupExact, lookupRanked, memoryEntryToPlan, recordSuccess, recordFailure } from './memory';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HealResult {
  repairPlan: RepairPlan | null;
  source: 'memory' | 'kb' | 'none';
  description: string;
  fingerprint?: string;
  category?: FailureCategory;
  /** All analyzed failures (for logging/diagnostics) */
  allAnalyses?: FailureAnalysis[];
}

/** Maximum heal attempts before giving up (prevents infinite loops). */
export const DEFAULT_MAX_HEAL_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Main healing function
// ---------------------------------------------------------------------------

/**
 * Analyze test failures and produce a RepairPlan for the generator.
 *
 * Strategy:
 * 1. Analyze all failures, pick the highest-priority root cause
 * 2. Check memory (exact fingerprint match)
 * 3. Check memory (ranked category fallback)
 * 4. Check knowledge base rules
 * 5. If no safe repair found → return null (report-only)
 *
 * The caller (CLI) feeds the RepairPlan into the generator for regeneration.
 */
export function heal(failureDetails: FailureDetail[]): HealResult {
  if (failureDetails.length === 0) {
    return { repairPlan: null, source: 'none', description: 'No failures to analyze' };
  }

  // Analyze all failures
  const allAnalyses = analyzeFailures(failureDetails);

  // Pick highest-priority root cause
  const rootCause = allAnalyses[0];
  if (!rootCause) {
    return { repairPlan: null, source: 'none', description: 'No failures analyzed' };
  }

  // Report-only categories — no auto-fix
  if (rootCause.category === FailureCategory.ASSERTION_MISMATCH ||
      rootCause.category === FailureCategory.SYNTAX_ERROR ||
      rootCause.category === FailureCategory.UNKNOWN) {
    return {
      repairPlan: null,
      source: 'none',
      description: `${rootCause.category}: ${rootCause.errorMessage.substring(0, 100)} (report-only, no safe auto-fix)`,
      fingerprint: rootCause.fingerprint,
      category: rootCause.category,
      allAnalyses,
    };
  }

  // 1. Check memory — exact fingerprint match
  const exactMatch = lookupExact(rootCause.fingerprint);
  if (exactMatch) {
    const plan = memoryEntryToPlan(exactMatch);
    console.log(`  🧠 Memory hit (exact): ${plan.description}`);
    return {
      repairPlan: plan,
      source: 'memory',
      description: plan.description,
      fingerprint: rootCause.fingerprint,
      category: rootCause.category,
      allAnalyses,
    };
  }

  // 2. Check memory — ranked fallback (same category, similar traits)
  const rankedMatch = lookupRanked(rootCause);
  if (rankedMatch) {
    const plan = memoryEntryToPlan(rankedMatch);
    console.log(`  🧠 Memory hit (ranked): ${plan.description}`);
    return {
      repairPlan: plan,
      source: 'memory',
      description: plan.description,
      fingerprint: rootCause.fingerprint,
      category: rootCause.category,
      allAnalyses,
    };
  }

  // 3. Check knowledge base rules
  const kbPlan = findRepairPlan(rootCause);
  if (kbPlan) {
    console.log(`  📚 KB match: ${kbPlan.description}`);
    return {
      repairPlan: kbPlan,
      source: 'kb',
      description: kbPlan.description,
      fingerprint: rootCause.fingerprint,
      category: rootCause.category,
      allAnalyses,
    };
  }

  // 4. No safe repair found
  return {
    repairPlan: null,
    source: 'none',
    description: `${rootCause.category}: ${rootCause.errorMessage.substring(0, 100)} — no applicable safe repair`,
    fingerprint: rootCause.fingerprint,
    category: rootCause.category,
    allAnalyses,
  };
}

// ---------------------------------------------------------------------------
// Post-run feedback — update memory based on heal outcome
// ---------------------------------------------------------------------------

/**
 * Call after a heal + regenerate + re-run cycle.
 * Records success or failure so memory learns over time.
 */
export function recordHealOutcome(
  healResult: HealResult,
  testsPassed: boolean
): void {
  if (!healResult.repairPlan || !healResult.fingerprint || !healResult.category) {
    return; // Nothing to record
  }

  if (testsPassed) {
    recordSuccess(
      healResult.fingerprint,
      healResult.category,
      healResult.repairPlan.actions,
      healResult.repairPlan.description
    );
  } else {
    recordFailure(healResult.fingerprint);
  }
}

/**
 * Check if the same fingerprint failed with the same action before in this session.
 * Prevents retrying the exact same fix that already failed.
 */
export function isDuplicateHealAttempt(
  fingerprint: string,
  previousAttempts: Array<{ fingerprint: string; actionKinds: string[] }>
): boolean {
  return previousAttempts.some((prev) => prev.fingerprint === fingerprint);
}

// Re-export types for convenience
export type { FailureDetail, FailureAnalysis } from './analyzer';
export type { RepairPlan, RepairAction } from './knowledge-base';
export { FailureCategory } from './analyzer';
