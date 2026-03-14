import fs from 'node:fs';
import path from 'node:path';
import type { FailureContext } from './failureContext';

export interface RepairMemoryEntry {
  signature: string;
  actionId: string;
  failureKind: FailureContext['kind'];
  attempts: number;
  successes: number;
  failures: number;
  promoted: boolean;
  lastOutcome: 'success' | 'failure';
  updatedAt: string;
}

export interface RepairActionStats {
  actionId: string;
  attempts: number;
  successes: number;
  failures: number;
  promoted: boolean;
  updatedAt: string;
}

export interface RepairMemory {
  version: 1;
  entries: Record<string, RepairMemoryEntry>;
  actionStats: Record<string, RepairActionStats>;
}

export interface RepairOutcomeRecord {
  signature: string;
  actionId: string;
  failureKind: FailureContext['kind'];
  success: boolean;
}

const REPAIR_MEMORY_VERSION = 1 as const;
const PROMOTION_SUCCESS_THRESHOLD = 3;
const DEFAULT_REPAIR_MEMORY_PATH = path.resolve(__dirname, '..', '.repair-memory.json');

function createEmptyMemory(): RepairMemory {
  return {
    version: REPAIR_MEMORY_VERSION,
    entries: {},
    actionStats: {},
  };
}

export function getRepairMemoryPath(): string {
  return DEFAULT_REPAIR_MEMORY_PATH;
}

export function loadRepairMemory(memoryPath: string = DEFAULT_REPAIR_MEMORY_PATH): RepairMemory {
  try {
    if (!fs.existsSync(memoryPath)) {
      return createEmptyMemory();
    }
    const parsed = JSON.parse(fs.readFileSync(memoryPath, 'utf8')) as Partial<RepairMemory>;
    if (parsed.version !== REPAIR_MEMORY_VERSION) {
      return createEmptyMemory();
    }
    return {
      version: REPAIR_MEMORY_VERSION,
      entries: parsed.entries ?? {},
      actionStats: parsed.actionStats ?? {},
    };
  } catch {
    return createEmptyMemory();
  }
}

export function saveRepairMemory(
  memory: RepairMemory,
  memoryPath: string = DEFAULT_REPAIR_MEMORY_PATH,
): void {
  fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
  fs.writeFileSync(memoryPath, JSON.stringify(memory, null, 2), 'utf8');
}

export function getPreferredRepairAction(
  memory: RepairMemory,
  signature: string,
): string | null {
  const candidates = Object.values(memory.entries)
    .filter((entry) => entry.signature === signature && entry.successes > 0)
    .sort((left, right) => {
      if (right.successes !== left.successes) return right.successes - left.successes;
      if (left.failures !== right.failures) return left.failures - right.failures;
      return left.actionId.localeCompare(right.actionId);
    });

  return candidates[0]?.actionId ?? null;
}

export function getPromotedActionIds(memory: RepairMemory): string[] {
  return Object.values(memory.actionStats)
    .filter((stats) => stats.promoted)
    .sort((left, right) => left.actionId.localeCompare(right.actionId))
    .map((stats) => stats.actionId);
}

export function recordRepairOutcome(
  memory: RepairMemory,
  outcome: RepairOutcomeRecord,
): void {
  const now = new Date().toISOString();
  const entryKey = `${outcome.signature}::${outcome.actionId}`;
  const existingEntry = memory.entries[entryKey];
  const updatedEntry: RepairMemoryEntry = {
    signature: outcome.signature,
    actionId: outcome.actionId,
    failureKind: outcome.failureKind,
    attempts: (existingEntry?.attempts ?? 0) + 1,
    successes: (existingEntry?.successes ?? 0) + (outcome.success ? 1 : 0),
    failures: (existingEntry?.failures ?? 0) + (outcome.success ? 0 : 1),
    promoted: false,
    lastOutcome: outcome.success ? 'success' : 'failure',
    updatedAt: now,
  };
  updatedEntry.promoted =
    updatedEntry.successes >= PROMOTION_SUCCESS_THRESHOLD &&
    updatedEntry.successes >= updatedEntry.failures;
  memory.entries[entryKey] = updatedEntry;

  const existingStats = memory.actionStats[outcome.actionId];
  const updatedStats: RepairActionStats = {
    actionId: outcome.actionId,
    attempts: (existingStats?.attempts ?? 0) + 1,
    successes: (existingStats?.successes ?? 0) + (outcome.success ? 1 : 0),
    failures: (existingStats?.failures ?? 0) + (outcome.success ? 0 : 1),
    promoted: false,
    updatedAt: now,
  };
  updatedStats.promoted =
    updatedStats.successes >= PROMOTION_SUCCESS_THRESHOLD &&
    updatedStats.successes >= updatedStats.failures;
  memory.actionStats[outcome.actionId] = updatedStats;
}
