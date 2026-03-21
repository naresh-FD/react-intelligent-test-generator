/**
 * Fix outcome tracker — tracks whether a repair attempt actually resolved
 * the issue it targeted.
 *
 * After a repair is applied and jest is re-run, this module compares
 * the before/after classified issues to determine if the fix worked.
 */

import type { IssueType } from '../types';
import type { ClassifiedIssue } from '../validation/issueClassifier';
import type { HealingAttemptRecord } from '../execution/healingLoop';

export interface FixOutcome {
  issueType: IssueType;
  fingerprint: string;
  strategyId: string;
  resolved: boolean;
  newIssuesIntroduced: IssueType[];
}

/**
 * Compare before/after classified issues to determine fix outcomes.
 */
export function trackFixOutcomes(
  beforeIssues: ClassifiedIssue[],
  afterIssues: ClassifiedIssue[],
  attempts: HealingAttemptRecord[],
): FixOutcome[] {
  const afterFingerprints = new Set(afterIssues.map((i) => i.fingerprint));
  const beforeFingerprints = new Set(beforeIssues.map((i) => i.fingerprint));

  const outcomes: FixOutcome[] = [];

  for (const attempt of attempts) {
    if (!attempt.applied) continue;

    const resolved = !afterFingerprints.has(attempt.fingerprint);

    // Find any new issues that appeared after the fix
    const newIssues = afterIssues
      .filter((i) => !beforeFingerprints.has(i.fingerprint))
      .map((i) => i.issueType);

    outcomes.push({
      issueType: attempt.issueType,
      fingerprint: attempt.fingerprint,
      strategyId: attempt.strategyId,
      resolved,
      newIssuesIntroduced: newIssues,
    });
  }

  return outcomes;
}

/**
 * Compute fix success rate for a given strategy across outcomes.
 */
export function computeStrategySuccessRate(
  outcomes: FixOutcome[],
  strategyId: string,
): { total: number; resolved: number; rate: number } {
  const relevant = outcomes.filter((o) => o.strategyId === strategyId);
  const resolved = relevant.filter((o) => o.resolved).length;
  return {
    total: relevant.length,
    resolved,
    rate: relevant.length > 0 ? resolved / relevant.length : 0,
  };
}
