/**
 * Issue normalizer — converts raw classified issues into normalized
 * dataset records suitable for JSONL persistence and later training.
 *
 * This module bridges the gap between the classifier's output
 * (ClassifiedIssue) and the dataset writer's input (IssueDatasetRecord).
 */

import type { IssueType } from '../types';
import type { ClassifiedIssue } from '../validation/issueClassifier';
import type { IssueDatasetRecord } from './issueDatasetWriter';
import type { HealingAttemptRecord } from '../execution/healingLoop';
import { extractErrorSignature, extractErrorType, extractInvolvedSymbol } from './errorSignatureExtractor';

export interface NormalizationInput {
  issue: ClassifiedIssue;
  componentPath: string;
  testPath: string;
  attempt?: HealingAttemptRecord;
  jestPassed?: boolean;
  retryCount?: number;
  testsRun?: number;
  testsFailed?: number;
  coverage?: number;
}

let _seqId = 0;

/**
 * Normalize a classified issue + repair context into a dataset record.
 */
export function normalizeIssue(input: NormalizationInput): IssueDatasetRecord {
  _seqId += 1;
  const id = `issue_${String(_seqId).padStart(6, '0')}`;

  const errorSig = extractErrorSignature(input.issue.rawErrorExcerpt);
  const errorType = extractErrorType(input.issue.rawErrorExcerpt);
  const involvedSymbol = extractInvolvedSymbol(input.issue.rawErrorExcerpt);

  const detectionSignals: string[] = [`issue_type:${input.issue.issueType}`];
  if (errorType) detectionSignals.push(`error_type:${errorType}`);
  if (involvedSymbol) detectionSignals.push(`symbol:${involvedSymbol}`);
  if (input.issue.confidence > 0.9) detectionSignals.push('high_confidence');
  if (input.issue.evidence.includes('Provider')) detectionSignals.push('provider_related');
  if (input.issue.evidence.includes('mock')) detectionSignals.push('mock_related');
  if (/use[A-Z]/.test(input.issue.evidence)) detectionSignals.push('hook_related');

  return {
    id,
    timestamp: new Date().toISOString(),
    component_path: input.componentPath,
    test_path: input.testPath,
    phase: inferPhase(input.issue.issueType),
    issue_type: input.issue.issueType,
    severity: inferSeverity(input.issue.issueType),
    error_signature: errorSig,
    raw_error_excerpt: input.issue.rawErrorExcerpt.substring(0, 500),
    root_cause: input.issue.evidence,
    detection_signals: detectionSignals,
    analysis_context: {
      confidence: input.issue.confidence,
      error_type: errorType,
      involved_symbol: involvedSymbol,
    },
    fix_strategy: input.attempt?.strategyId ?? 'none',
    fix_actions: input.attempt ? [input.attempt.reason] : [],
    verification: {
      jest_passed: input.jestPassed ?? false,
      retry_count: input.retryCount ?? 0,
      tests_run: input.testsRun,
      tests_failed: input.testsFailed,
      coverage: input.coverage,
    },
    generalizable_rule: inferRule(input.issue.issueType),
  };
}

function inferPhase(issueType: IssueType): IssueDatasetRecord['phase'] {
  switch (issueType) {
    case 'BROKEN_IMPORT':
    case 'MISSING_EXPORT':
    case 'MOCK_MODULE_NOT_FOUND':
      return 'typecheck';
    case 'MISSING_PROVIDER':
    case 'INVALID_PROVIDER_ORDER':
    case 'INVALID_COMPONENT_SYMBOL':
    case 'MOCK_EXPORT_MISMATCH':
    case 'SERVICE_NOT_MOCKED':
    case 'UNSAFE_UNDEFINED_ACCESS':
    case 'ACT_WARNING_PATTERN':
      return 'runtime';
    case 'TYPE_ASSERTION_MISMATCH':
    case 'ASYNC_QUERY_MISMATCH':
    case 'JEST_DOM_MISSING':
      return 'assertion';
    case 'OVER_SKIPPED_TEST':
    case 'EARLY_LOOP_TERMINATION':
      return 'generation';
    default:
      return 'runtime';
  }
}

function inferSeverity(issueType: IssueType): IssueDatasetRecord['severity'] {
  switch (issueType) {
    case 'BROKEN_IMPORT':
    case 'MISSING_EXPORT':
    case 'INVALID_COMPONENT_SYMBOL':
    case 'MOCK_MODULE_NOT_FOUND':
      return 'critical';
    case 'MISSING_PROVIDER':
    case 'INVALID_PROVIDER_ORDER':
    case 'MOCK_EXPORT_MISMATCH':
    case 'SERVICE_NOT_MOCKED':
      return 'high';
    case 'JEST_DOM_MISSING':
    case 'TYPE_ASSERTION_MISMATCH':
    case 'ASYNC_QUERY_MISMATCH':
    case 'ACT_WARNING_PATTERN':
    case 'UNSAFE_UNDEFINED_ACCESS':
      return 'medium';
    default:
      return 'low';
  }
}

function inferRule(issueType: IssueType): string {
  const rules: Record<string, string> = {
    MISSING_PROVIDER: 'If a hook requires a provider, the generator must include that provider in the wrapper plan before emitting JSX.',
    INVALID_PROVIDER_ORDER: 'Providers must be nested according to their dependency graph.',
    BROKEN_IMPORT: 'Every import path emitted must be verified to resolve before emission.',
    MISSING_EXPORT: 'Import symbols must match the actual exports of the target module.',
    INVALID_COMPONENT_SYMBOL: 'JSX must only reference symbols that are verified to be in scope and renderable.',
    MOCK_MODULE_NOT_FOUND: 'jest.mock() module paths must resolve to existing modules.',
    MOCK_EXPORT_MISMATCH: 'Mock factories must not reference variables outside their scope. Use inline values or arrow wrappers.',
    SERVICE_NOT_MOCKED: 'Service dependencies detected by the analyzer must have corresponding mock plans.',
    JEST_DOM_MISSING: 'Always include jest-dom setup import when generating DOM matchers.',
    TYPE_ASSERTION_MISMATCH: 'Assertions must match the actual API surface and return types.',
    ASYNC_QUERY_MISMATCH: 'Use findBy/waitFor for async content, not getBy.',
    ACT_WARNING_PATTERN: 'Wrap state-changing operations in act() or use async queries.',
    UNSAFE_UNDEFINED_ACCESS: 'Mock return values must include all properties the component accesses.',
    OVER_SKIPPED_TEST: 'Never skip or delete tests as a repair strategy — fix the underlying issue.',
    EARLY_LOOP_TERMINATION: 'The healing loop must continue while failures remain.',
    UNKNOWN: 'Unclassified failures should be investigated and a new issue type added if the pattern recurs.',
  };
  return rules[issueType] ?? 'No generalizable rule available.';
}
