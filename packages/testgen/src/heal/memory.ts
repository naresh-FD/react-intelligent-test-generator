/**
 * Healing memory — persistent JSON store that tracks which repair strategies
 * succeeded or failed for each failure class.  Enables deterministic strategy
 * selection based on past outcomes.
 *
 * File format (.testgen-heal-memory.json):
 * {
 *   "missing_provider::wrap_with_provider": { successes: 5, failures: 1, lastUsed: "..." },
 *   ...
 * }
 */

import fs from 'node:fs';
import path from 'node:path';
import type { FailureClass } from './classifier';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  successes: number;
  failures: number;
  lastUsed: string; // ISO timestamp
}

/** strategy records keyed by "failureClass::strategyName" */
export type HealMemoryData = Record<string, MemoryEntry>;

// ---------------------------------------------------------------------------
// File path
// ---------------------------------------------------------------------------

const MEMORY_FILENAME = '.testgen-heal-memory.json';

function memoryFilePath(): string {
  return path.join(process.cwd(), MEMORY_FILENAME);
}

// ---------------------------------------------------------------------------
// Load / save with safe fallbacks
// ---------------------------------------------------------------------------

export function loadMemory(): HealMemoryData {
  const filePath = memoryFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as HealMemoryData;
      }
    }
  } catch {
    // Corrupted file — start fresh
  }
  return {};
}

export function saveMemory(data: HealMemoryData): void {
  const filePath = memoryFilePath();
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch {
    // Non-critical — healing continues without persistence
  }
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

function makeKey(failureClass: FailureClass, strategy: string): string {
  return `${failureClass}::${strategy}`;
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/**
 * Return the win-rate (0..1) for a given failure class + strategy.
 * Returns -1 if there is no data for this combination.
 */
export function winRate(
  data: HealMemoryData,
  failureClass: FailureClass,
  strategy: string
): number {
  const entry = data[makeKey(failureClass, strategy)];
  if (!entry || (entry.successes === 0 && entry.failures === 0)) return -1;
  return entry.successes / (entry.successes + entry.failures);
}

/**
 * Return all strategies that have been tried for a given failure class,
 * sorted by win-rate descending (best first).
 */
export function rankedStrategies(
  data: HealMemoryData,
  failureClass: FailureClass
): Array<{ strategy: string; rate: number }> {
  const prefix = `${failureClass}::`;
  const results: Array<{ strategy: string; rate: number }> = [];

  for (const key of Object.keys(data)) {
    if (key.startsWith(prefix)) {
      const strategy = key.slice(prefix.length);
      const entry = data[key];
      const total = entry.successes + entry.failures;
      if (total > 0) {
        results.push({ strategy, rate: entry.successes / total });
      }
    }
  }

  results.sort((a, b) => b.rate - a.rate);
  return results;
}

// ---------------------------------------------------------------------------
// Record outcome
// ---------------------------------------------------------------------------

export function recordOutcome(
  data: HealMemoryData,
  failureClass: FailureClass,
  strategy: string,
  succeeded: boolean
): void {
  const key = makeKey(failureClass, strategy);
  if (!data[key]) {
    data[key] = { successes: 0, failures: 0, lastUsed: new Date().toISOString() };
  }
  if (succeeded) {
    data[key].successes++;
  } else {
    data[key].failures++;
  }
  data[key].lastUsed = new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Promotion query
// ---------------------------------------------------------------------------

/** Minimum total uses before a strategy can be promoted */
const PROMOTION_MIN_USES = 3;
/** Minimum win-rate to qualify for promotion */
const PROMOTION_MIN_RATE = 0.8;

/**
 * Return strategies that should be promoted into the core generator.
 * A strategy qualifies when it has been used >= PROMOTION_MIN_USES times
 * and has a win-rate >= PROMOTION_MIN_RATE.
 */
export function promotableStrategies(
  data: HealMemoryData
): Array<{ failureClass: string; strategy: string; rate: number; uses: number }> {
  const results: Array<{ failureClass: string; strategy: string; rate: number; uses: number }> = [];

  for (const [key, entry] of Object.entries(data)) {
    const separatorIndex = key.indexOf('::');
    if (separatorIndex === -1) continue;
    const failureClass = key.slice(0, separatorIndex);
    const strategy = key.slice(separatorIndex + 2);
    const total = entry.successes + entry.failures;
    if (total >= PROMOTION_MIN_USES) {
      const rate = entry.successes / total;
      if (rate >= PROMOTION_MIN_RATE) {
        results.push({ failureClass, strategy, rate, uses: total });
      }
    }
  }

  return results;
}
