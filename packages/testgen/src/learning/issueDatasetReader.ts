/**
 * Issue dataset reader — retrieves and queries normalized records
 * from the JSONL dataset.
 *
 * Supports filtering by issue type, component, phase, and date range.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { IssueType } from '../types';
import type { IssueDatasetRecord } from './issueDatasetWriter';

const DATA_DIR = path.resolve(__dirname, '../../data/learning');
const DATASET_PATH = path.join(DATA_DIR, 'issue-dataset.jsonl');
const STATS_PATH = path.join(DATA_DIR, 'issue-stats.json');

/**
 * Read all records from the dataset.
 */
export function readAllRecords(): IssueDatasetRecord[] {
  if (!fs.existsSync(DATASET_PATH)) return [];

  return fs.readFileSync(DATASET_PATH, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try { return JSON.parse(line) as IssueDatasetRecord; }
      catch { return null; }
    })
    .filter((r): r is IssueDatasetRecord => r !== null);
}

/**
 * Query records by issue type.
 */
export function queryByIssueType(issueType: IssueType): IssueDatasetRecord[] {
  return readAllRecords().filter((r) => r.issue_type === issueType);
}

/**
 * Query records by component path (substring match).
 */
export function queryByComponent(componentPathSubstring: string): IssueDatasetRecord[] {
  return readAllRecords().filter((r) =>
    r.component_path.includes(componentPathSubstring),
  );
}

/**
 * Query records by phase.
 */
export function queryByPhase(phase: IssueDatasetRecord['phase']): IssueDatasetRecord[] {
  return readAllRecords().filter((r) => r.phase === phase);
}

/**
 * Get records where the fix succeeded (jest passed).
 */
export function getSuccessfulFixes(): IssueDatasetRecord[] {
  return readAllRecords().filter((r) => r.verification.jest_passed);
}

/**
 * Get records where the fix failed.
 */
export function getFailedFixes(): IssueDatasetRecord[] {
  return readAllRecords().filter((r) => !r.verification.jest_passed);
}

/**
 * Read issue stats (frequency counts by type).
 */
export function readIssueStats(): Record<string, number> {
  if (!fs.existsSync(STATS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Get the top N most frequent issue types from stats.
 */
export function getTopIssueTypes(n: number = 5): Array<{ issueType: string; count: number }> {
  const stats = readIssueStats();
  return Object.entries(stats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([issueType, count]) => ({ issueType, count }));
}
