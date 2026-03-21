/**
 * Issue dataset writer — persists normalized issue/fix records to JSONL.
 *
 * Records are written during the healing loop so every classified failure
 * and repair outcome is captured for later analysis or LLM training.
 *
 * Output: packages/testgen/data/learning/issue-dataset.jsonl
 */

import fs from 'node:fs';
import path from 'node:path';
import type { IssueType } from '../types';
import type { ClassifiedIssue } from '../validation/issueClassifier';
import type { HealingAttemptRecord } from '../execution/healingLoop';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export interface IssueDatasetRecord {
  id: string;
  timestamp: string;
  component_path: string;
  test_path: string;
  phase: 'typecheck' | 'runtime' | 'assertion' | 'generation';
  issue_type: IssueType;
  severity: 'critical' | 'high' | 'medium' | 'low';
  error_signature: string;
  raw_error_excerpt: string;
  root_cause: string;
  detection_signals: string[];
  analysis_context: Record<string, unknown>;
  failed_output_pattern?: string;
  fix_strategy: string;
  fix_actions: string[];
  patched_output_pattern?: string;
  verification: {
    tsc_passed?: boolean;
    jest_passed: boolean;
    retry_count: number;
    tests_run?: number;
    tests_failed?: number;
    coverage?: number;
  };
  generalizable_rule: string;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const DATA_DIR = path.resolve(__dirname, '../../data/learning');
const DATASET_PATH = path.join(DATA_DIR, 'issue-dataset.jsonl');
const HEAL_HISTORY_PATH = path.join(DATA_DIR, 'heal-history.jsonl');
const STATS_PATH = path.join(DATA_DIR, 'issue-stats.json');

let _nextId = 0;

function generateId(): string {
  _nextId += 1;
  return `issue_${String(_nextId).padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Append a normalized issue record to the JSONL dataset.
 */
export function writeIssueRecord(record: IssueDatasetRecord): void {
  ensureDataDir();
  const line = JSON.stringify(record) + '\n';
  fs.appendFileSync(DATASET_PATH, line, 'utf8');
}

/**
 * Build and write an issue record from healing loop data.
 */
export function recordHealingOutcome(params: {
  componentPath: string;
  testPath: string;
  issue: ClassifiedIssue;
  attempt: HealingAttemptRecord;
  jestPassed: boolean;
  retryCount: number;
  testsRun?: number;
  testsFailed?: number;
  coverage?: number;
}): void {
  const record: IssueDatasetRecord = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    component_path: params.componentPath,
    test_path: params.testPath,
    phase: inferPhase(params.issue.issueType),
    issue_type: params.issue.issueType,
    severity: inferSeverity(params.issue.issueType),
    error_signature: params.issue.fingerprint,
    raw_error_excerpt: params.issue.rawErrorExcerpt.substring(0, 500),
    root_cause: inferRootCause(params.issue),
    detection_signals: extractDetectionSignals(params.issue),
    analysis_context: {
      confidence: params.issue.confidence,
      evidence: params.issue.evidence,
    },
    fix_strategy: params.attempt.strategyId,
    fix_actions: [params.attempt.reason],
    verification: {
      jest_passed: params.jestPassed,
      retry_count: params.retryCount,
      tests_run: params.testsRun,
      tests_failed: params.testsFailed,
      coverage: params.coverage,
    },
    generalizable_rule: inferGeneralizableRule(params.issue.issueType),
  };

  writeIssueRecord(record);
}

/**
 * Write a heal history entry (lightweight, for tracking session outcomes).
 */
export function writeHealHistoryEntry(entry: {
  componentPath: string;
  testPath: string;
  status: string;
  attempts: number;
  issueTypes: IssueType[];
  coverage: number;
}): void {
  ensureDataDir();
  const line = JSON.stringify({
    ...entry,
    timestamp: new Date().toISOString(),
  }) + '\n';
  fs.appendFileSync(HEAL_HISTORY_PATH, line, 'utf8');
}

/**
 * Update issue type statistics.
 */
export function updateIssueStats(issueTypes: IssueType[]): void {
  ensureDataDir();

  let stats: Record<string, number> = {};
  try {
    if (fs.existsSync(STATS_PATH)) {
      stats = JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
    }
  } catch {
    // start fresh
  }

  for (const issueType of issueTypes) {
    stats[issueType] = (stats[issueType] ?? 0) + 1;
  }

  fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Reader (for future retrieval)
// ---------------------------------------------------------------------------

export function readIssueDataset(): IssueDatasetRecord[] {
  if (!fs.existsSync(DATASET_PATH)) return [];

  const content = fs.readFileSync(DATASET_PATH, 'utf8');
  return content
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as IssueDatasetRecord;
      } catch {
        return null;
      }
    })
    .filter((record): record is IssueDatasetRecord => record !== null);
}

// ---------------------------------------------------------------------------
// Inference helpers
// ---------------------------------------------------------------------------

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

function inferRootCause(issue: ClassifiedIssue): string {
  const causes: Record<IssueType, string> = {
    MISSING_PROVIDER: 'Component uses a hook/context that requires a provider wrapper not present in the render tree',
    INVALID_PROVIDER_ORDER: 'Provider nesting order is incorrect — a dependency provider is nested inside its dependent',
    BROKEN_IMPORT: 'Import path does not resolve to an existing module',
    MISSING_EXPORT: 'The module resolves but the requested export does not exist',
    INVALID_COMPONENT_SYMBOL: 'JSX references a symbol that is undefined or not a valid React component',
    MOCK_MODULE_NOT_FOUND: 'jest.mock() references a module path that does not resolve',
    MOCK_EXPORT_MISMATCH: 'Mock factory references variables outside its scope or has wrong export shape',
    SERVICE_NOT_MOCKED: 'A service dependency is called but no mock is configured for it',
    JEST_DOM_MISSING: 'Test uses jest-dom matchers but the setup import is missing',
    TYPE_ASSERTION_MISMATCH: 'Assertion uses incorrect matcher or expected value type',
    ASYNC_QUERY_MISMATCH: 'Async content is queried with synchronous getBy instead of findBy/waitFor',
    ACT_WARNING_PATTERN: 'State update happens outside act() wrapper',
    UNSAFE_UNDEFINED_ACCESS: 'Property access on undefined/null due to incomplete mock data',
    OVER_SKIPPED_TEST: 'System attempted to skip/delete tests instead of fixing the root cause',
    EARLY_LOOP_TERMINATION: 'Retry loop stopped while failures still existed',
    UNKNOWN: 'Failure could not be classified into a known issue type',
  };
  return causes[issue.issueType] ?? 'Unknown root cause';
}

function extractDetectionSignals(issue: ClassifiedIssue): string[] {
  const signals: string[] = [`issue_type:${issue.issueType}`];

  if (issue.confidence > 0.9) signals.push('high_confidence');
  if (issue.evidence.includes('Provider')) signals.push('provider_related');
  if (issue.evidence.includes('mock')) signals.push('mock_related');
  if (issue.evidence.includes('import')) signals.push('import_related');
  if (/use[A-Z]/.test(issue.evidence)) signals.push('hook_related');

  return signals;
}

function inferGeneralizableRule(issueType: IssueType): string {
  const rules: Record<IssueType, string> = {
    MISSING_PROVIDER: 'If a hook requires a provider, the generator must include that provider in the wrapper plan before emitting JSX.',
    INVALID_PROVIDER_ORDER: 'Providers must be nested according to their dependency graph — inner providers that depend on outer ones must be nested inside them.',
    BROKEN_IMPORT: 'Every import path emitted must be verified to resolve before emission.',
    MISSING_EXPORT: 'Import symbols must match the actual exports of the target module.',
    INVALID_COMPONENT_SYMBOL: 'JSX must only reference symbols that are verified to be in scope and renderable.',
    MOCK_MODULE_NOT_FOUND: 'jest.mock() module paths must resolve to existing modules.',
    MOCK_EXPORT_MISMATCH: 'Mock factories must not reference variables outside their scope when using @jest/globals. Use inline values or arrow wrappers.',
    SERVICE_NOT_MOCKED: 'Service dependencies detected by the analyzer must have corresponding mock plans.',
    JEST_DOM_MISSING: 'Always include jest-dom setup import when generating DOM matchers.',
    TYPE_ASSERTION_MISMATCH: 'Assertions must match the actual API surface and return types of the component under test.',
    ASYNC_QUERY_MISMATCH: 'Use findBy/waitFor for content that appears asynchronously, not getBy.',
    ACT_WARNING_PATTERN: 'Wrap state-changing operations in act() or use async queries that handle act internally.',
    UNSAFE_UNDEFINED_ACCESS: 'Mock return values must include all properties that the component accesses.',
    OVER_SKIPPED_TEST: 'Never skip or delete tests as a repair strategy — fix the underlying generator issue.',
    EARLY_LOOP_TERMINATION: 'The healing loop must continue while any failures remain, stopping only when budget is exhausted with explicit reason.',
    UNKNOWN: 'Unclassified failures should be investigated and a new issue type added if the pattern recurs.',
  };
  return rules[issueType] ?? 'No generalizable rule available.';
}
