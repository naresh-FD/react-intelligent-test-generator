/**
 * Self-healing execution loop.
 *
 * Replaces the dumb verifyAndRetry with a deterministic loop that:
 * 1. Runs jest
 * 2. Classifies failures using the canonical IssueType taxonomy
 * 3. Selects deterministic repair strategies
 * 4. Applies fixes (either direct test file patching or regeneration with hints)
 * 5. Tracks healing memory to avoid repeating failed strategies
 * 6. Does NOT stop while failures remain and budget is not exhausted
 */

import fs from 'node:fs';
import path from 'node:path';
import type { IssueType } from '../types';
import type { ClassifiedIssue } from '../validation/issueClassifier';
import { classifyIssue, classifyIssues } from '../validation/issueClassifier';
import { mapIssueToRepairStrategy, type RepairAttemptResult } from './issueToStrategy';
import { recordHealingOutcome, writeHealHistoryEntry, updateIssueStats } from '../learning/issueDatasetWriter';

export interface HealingLoopOptions {
  /** Maximum repair attempts before giving up */
  maxRetries: number;
  /** Minimum line coverage % */
  coverageThreshold: number;
  /** Function to run jest on a test file */
  runJest: (testFilePath: string, sourceFilePath: string) => JestResult;
  /** Function to regenerate the test file (called when direct repair is insufficient) */
  regenerateTestFile: (sourceFilePath: string) => string | null;
  /** Function to read the test file content */
  readTestFile: (testFilePath: string) => string;
  /** Function to write the test file content */
  writeTestFile: (testFilePath: string, content: string) => void;
}

export interface JestResult {
  passed: boolean;
  numTests: number;
  numFailed: number;
  coverage: number;
  errorOutput: string;
  failureReason: string;
  /** Per-test failure messages for fine-grained classification */
  failureMessages?: string[];
}

export interface HealingAttemptRecord {
  attemptNumber: number;
  issueType: IssueType;
  fingerprint: string;
  strategyId: string;
  applied: boolean;
  succeeded: boolean;
  reason: string;
}

export type HealingLoopStatus = 'pass' | 'fail' | 'low-coverage' | 'exhausted';

export interface HealingLoopResult {
  status: HealingLoopStatus;
  coverage: number;
  attempts: number;
  numTests: number;
  failureReason?: string;
  healingAttempts: HealingAttemptRecord[];
  classifiedIssues: ClassifiedIssue[];
  exhaustionReason?: string;
}

/**
 * Run the self-healing loop.
 *
 * The loop does NOT stop while:
 * - failedTests > 0
 * - failedSuites > 0
 * - relevant errors exist
 *
 * It stops when:
 * - All tests pass AND coverage >= threshold → 'pass'
 * - All tests pass but coverage < threshold → 'low-coverage'
 * - Retry budget is exhausted → 'exhausted' (with explicit reason)
 * - Same fingerprint fails 3+ times in a row → stop (avoid infinite loop)
 */
export function runHealingLoop(
  sourceFilePath: string,
  testFilePath: string,
  options: HealingLoopOptions,
): HealingLoopResult {
  const healingAttempts: HealingAttemptRecord[] = [];
  const fingerprintFailCount = new Map<string, number>();
  const maxFingerprintRetries = 3;
  let lastResult: JestResult = {
    passed: false,
    numTests: 0,
    numFailed: 0,
    coverage: 0,
    errorOutput: '',
    failureReason: '',
  };
  let allClassifiedIssues: ClassifiedIssue[] = [];

  for (let attempt = 1; attempt <= options.maxRetries + 1; attempt++) {
    // On retries after first attempt, we've already applied a repair or regenerated
    if (attempt > 1) {
      console.log(`  🔄 Heal attempt ${attempt - 1}/${options.maxRetries}...`);
    }

    // Run jest
    console.log(`  ▶  Running jest (attempt ${attempt}/${options.maxRetries + 1})...`);
    lastResult = options.runJest(testFilePath, sourceFilePath);

    // Check for success
    if (lastResult.passed && lastResult.numTests > 0) {
      if (lastResult.coverage >= options.coverageThreshold) {
        console.log(`  ✅ All ${lastResult.numTests} test(s) pass | Coverage: ${lastResult.coverage.toFixed(1)}%`);
        // Persist learning data on success
        persistLearningData(sourceFilePath, testFilePath, 'pass', attempt, allClassifiedIssues, lastResult.coverage);
        return {
          status: 'pass',
          coverage: lastResult.coverage,
          attempts: attempt,
          numTests: lastResult.numTests,
          healingAttempts,
          classifiedIssues: allClassifiedIssues,
        };
      }
      console.log(`  ⚠️  Tests pass (${lastResult.numTests}) but coverage ${lastResult.coverage.toFixed(1)}% < ${options.coverageThreshold}%`);
    }

    // Tests failed or 0 tests — classify and heal
    if (!lastResult.passed || lastResult.numTests === 0) {
      const errorSources = collectErrorSources(lastResult);
      const issues = classifyIssues(errorSources);
      allClassifiedIssues = issues;

      if (issues.length === 0 && lastResult.numTests === 0) {
        // No tests found — likely a path matching issue, regenerate
        console.log(`  ⚠️  No tests found — regenerating...`);
        const regenerated = options.regenerateTestFile(sourceFilePath);
        if (!regenerated) {
          return {
            status: 'fail',
            coverage: 0,
            attempts: attempt,
            numTests: 0,
            failureReason: 'Test generation returned null',
            healingAttempts,
            classifiedIssues: allClassifiedIssues,
            exhaustionReason: 'Generator produced no output',
          };
        }
        continue;
      }

      if (lastResult.numFailed > 0) {
        console.log(`  ❌ ${lastResult.numFailed}/${lastResult.numTests} test(s) failed`);
      }

      for (const issue of issues) {
        console.log(`    [${issue.issueType}] ${issue.evidence.substring(0, 100)}`);
      }

      // Check if we've already exhausted retries
      if (attempt > options.maxRetries) {
        break;
      }

      // Try to heal each issue
      let anyRepairApplied = false;
      let currentTestContent = options.readTestFile(testFilePath);

      for (const issue of issues) {
        // Check fingerprint retry limit
        const count = fingerprintFailCount.get(issue.fingerprint) ?? 0;
        if (count >= maxFingerprintRetries) {
          console.log(`    ⏩ Skipping ${issue.issueType} — same failure seen ${count} times, repair strategy exhausted`);
          healingAttempts.push({
            attemptNumber: attempt,
            issueType: issue.issueType,
            fingerprint: issue.fingerprint,
            strategyId: 'skipped-exhausted',
            applied: false,
            succeeded: false,
            reason: `Fingerprint exhausted after ${count} attempts`,
          });
          continue;
        }

        // Apply repair strategy
        const repairResult = mapIssueToRepairStrategy(issue, currentTestContent, sourceFilePath);

        healingAttempts.push({
          attemptNumber: attempt,
          issueType: issue.issueType,
          fingerprint: issue.fingerprint,
          strategyId: repairResult.strategyId,
          applied: repairResult.applied,
          succeeded: false, // We'll know after the next jest run
          reason: repairResult.reason,
        });

        if (repairResult.applied && repairResult.updatedContent) {
          currentTestContent = repairResult.updatedContent;
          anyRepairApplied = true;
          console.log(`    🔧 Applied: ${repairResult.strategyId} — ${repairResult.reason}`);
        } else {
          fingerprintFailCount.set(issue.fingerprint, count + 1);
          console.log(`    ⚠️  No repair available for ${issue.issueType}: ${repairResult.reason}`);
        }

        // Record learning data for this repair attempt
        try {
          recordHealingOutcome({
            componentPath: sourceFilePath,
            testPath: testFilePath,
            issue,
            attempt: healingAttempts[healingAttempts.length - 1],
            jestPassed: false, // Haven't re-run yet
            retryCount: attempt,
            testsRun: lastResult.numTests,
            testsFailed: lastResult.numFailed,
            coverage: lastResult.coverage,
          });
        } catch {
          // Dataset write failure should not break the healing loop
        }
      }

      if (anyRepairApplied) {
        // Write the healed test file
        options.writeTestFile(testFilePath, currentTestContent);
      } else {
        // No repairs were applicable — try regenerating from scratch
        console.log(`  🔄 No targeted repairs applied — regenerating test file...`);
        const regenerated = options.regenerateTestFile(sourceFilePath);
        if (!regenerated) {
          // Update fingerprint counts for all issues since regeneration didn't help
          for (const issue of issues) {
            const count = fingerprintFailCount.get(issue.fingerprint) ?? 0;
            fingerprintFailCount.set(issue.fingerprint, count + 1);
          }
        }
      }
    } else {
      // Tests pass but coverage is low — regenerate for better coverage
      if (attempt > options.maxRetries) break;
      console.log(`  🔄 Regenerating for better coverage...`);
      options.regenerateTestFile(sourceFilePath);
    }
  }

  // Budget exhausted
  const isPassingButLowCoverage = lastResult.passed && lastResult.numTests > 0;
  const status: HealingLoopStatus = isPassingButLowCoverage ? 'low-coverage' : 'exhausted';

  const exhaustionReasons: string[] = [];
  if (allClassifiedIssues.length > 0) {
    const issueTypeCounts = new Map<IssueType, number>();
    for (const issue of allClassifiedIssues) {
      issueTypeCounts.set(issue.issueType, (issueTypeCounts.get(issue.issueType) ?? 0) + 1);
    }
    for (const [type, count] of issueTypeCounts) {
      exhaustionReasons.push(`${type} x${count}`);
    }
  }

  const exhaustionReason = exhaustionReasons.length > 0
    ? `Retry budget exhausted with remaining issues: ${exhaustionReasons.join(', ')}`
    : isPassingButLowCoverage
      ? `Coverage ${lastResult.coverage.toFixed(1)}% below ${options.coverageThreshold}% after ${options.maxRetries} retries`
      : `Tests still failing after ${options.maxRetries} retries`;

  console.log(`  ⛔ ${exhaustionReason}`);

  // Persist learning data on exhaustion/failure
  persistLearningData(sourceFilePath, testFilePath, status, options.maxRetries + 1, allClassifiedIssues, lastResult.coverage);

  return {
    status,
    coverage: lastResult.coverage,
    attempts: options.maxRetries + 1,
    numTests: lastResult.numTests,
    failureReason: lastResult.failureReason || undefined,
    healingAttempts,
    classifiedIssues: allClassifiedIssues,
    exhaustionReason,
  };
}

/**
 * Persist learning data (heal history + issue stats) at end of loop.
 */
function persistLearningData(
  sourceFilePath: string,
  testFilePath: string,
  status: string,
  attempts: number,
  issues: ClassifiedIssue[],
  coverage: number,
): void {
  try {
    writeHealHistoryEntry({
      componentPath: sourceFilePath,
      testPath: testFilePath,
      status,
      attempts,
      issueTypes: issues.map((i) => i.issueType),
      coverage,
    });
    if (issues.length > 0) {
      updateIssueStats(issues.map((i) => i.issueType));
    }
  } catch {
    // Learning persistence failure should not break the pipeline
  }
}

/**
 * Collect all error sources from a jest result for classification.
 * Filters out Node.js warnings that are not actual test failures.
 */
function collectErrorSources(result: JestResult): string[] {
  const sources: string[] = [];

  if (result.failureMessages && result.failureMessages.length > 0) {
    sources.push(...result.failureMessages.map(stripNodeWarnings).filter((s) => s.trim().length > 0));
  }

  if (result.errorOutput && sources.length === 0) {
    const cleaned = stripNodeWarnings(result.errorOutput);
    if (cleaned.trim().length > 0) {
      sources.push(cleaned);
    }
  }

  if (result.failureReason && sources.length === 0) {
    const cleaned = stripNodeWarnings(result.failureReason);
    if (cleaned.trim().length > 0) {
      sources.push(cleaned);
    }
  }

  return sources;
}

/**
 * Strip Node.js diagnostic warnings that are not actual test failures.
 * These commonly appear in stderr and get misclassified as UNKNOWN errors.
 */
function stripNodeWarnings(text: string): string {
  return text
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      // Node.js warnings: (node:1234) [SOME_CODE] Warning: ...
      if (/^\(node:\d+\)\s*\[/.test(trimmed)) return false;
      // Node.js trace hint lines
      if (/^Use `node --trace-warnings/.test(trimmed)) return false;
      if (/^\(Use `node --trace-/.test(trimmed)) return false;
      // V8/Node module system diagnostics
      if (/^Reparsing as ES module because module syntax was detected/i.test(trimmed)) return false;
      if (/^Module type of file:/i.test(trimmed)) return false;
      return true;
    })
    .join('\n');
}
