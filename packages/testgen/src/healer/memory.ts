// ---------------------------------------------------------------------------
// Fix Memory — persistent semantic fix storage with exact + ranked lookup
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { FailureCategory, FailureAnalysis } from './analyzer';
import { RepairAction, RepairPlan } from './knowledge-base';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FixMemoryEntry {
  fingerprint: string;
  category: FailureCategory;
  actions: RepairAction[];
  description: string;
  successCount: number;
  failureCount: number;
  lastSuccess: string; // ISO date
}

interface FixMemoryFile {
  version: number;
  fixes: Record<string, FixMemoryEntry>;
}

// ---------------------------------------------------------------------------
// File path
// ---------------------------------------------------------------------------

const MEMORY_FILENAME = '.testgen-fixes.json';

function getMemoryPath(): string {
  return path.join(process.cwd(), MEMORY_FILENAME);
}

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------

export function loadMemory(): FixMemoryFile {
  const filePath = getMemoryPath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw) as FixMemoryFile;
      if (data.version === 1 && data.fixes) {
        return data;
      }
    }
  } catch {
    // Corrupted file — start fresh
  }
  return { version: 1, fixes: {} };
}

export function saveMemory(memory: FixMemoryFile): void {
  const filePath = getMemoryPath();
  fs.writeFileSync(filePath, JSON.stringify(memory, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Exact lookup
// ---------------------------------------------------------------------------

/**
 * Look up a fix by exact fingerprint match.
 * Only returns entries with a positive success record (successCount > failureCount).
 */
export function lookupExact(fingerprint: string): FixMemoryEntry | null {
  const memory = loadMemory();
  const entry = memory.fixes[fingerprint];
  if (!entry) return null;

  // Only trust entries with positive track record
  if (entry.successCount <= entry.failureCount) return null;

  return entry;
}

// ---------------------------------------------------------------------------
// Ranked fallback lookup
// ---------------------------------------------------------------------------

/**
 * When exact fingerprint doesn't match, find the best-matching fix
 * by category and similar traits. Returns null if nothing good enough.
 */
export function lookupRanked(analysis: FailureAnalysis): FixMemoryEntry | null {
  const memory = loadMemory();
  const candidates: Array<{ entry: FixMemoryEntry; score: number }> = [];

  for (const entry of Object.values(memory.fixes)) {
    // Must be same category
    if (entry.category !== analysis.category) continue;

    // Must have positive track record
    if (entry.successCount <= entry.failureCount) continue;

    let score = 0;

    // Score by success rate
    const total = entry.successCount + entry.failureCount;
    const successRate = total > 0 ? entry.successCount / total : 0;
    score += successRate * 50;

    // Score by volume (more uses = more trusted)
    score += Math.min(entry.successCount, 10) * 2;

    // Bonus for matching action kinds that seem relevant
    for (const action of entry.actions) {
      if ((action.kind === 'add-wrapper' || action.kind === 'require-provider') && analysis.providerName) {
        const wrapperName = action.kind === 'require-provider' ? action.provider : action.wrapper;
        if (wrapperName.toLowerCase().includes(analysis.providerName.toLowerCase())) {
          score += 30;
        }
      }
      if (action.kind === 'mock-hook' && analysis.hookName) {
        if (action.hookName.toLowerCase().includes(analysis.hookName.toLowerCase())) {
          score += 30;
        }
      }
      if (action.kind === 'ensure-import' && analysis.missingModule) {
        if (action.module.toLowerCase().includes(analysis.missingModule.toLowerCase())) {
          score += 30;
        }
      }
    }

    if (score > 20) {
      candidates.push({ entry, score });
    }
  }

  if (candidates.length === 0) return null;

  // Return highest-scoring candidate
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].entry;
}

// ---------------------------------------------------------------------------
// Record outcomes
// ---------------------------------------------------------------------------

/**
 * Record a successful fix in memory. Creates or updates the entry.
 */
export function recordSuccess(
  fingerprint: string,
  category: FailureCategory,
  actions: RepairAction[],
  description: string
): void {
  const memory = loadMemory();
  const existing = memory.fixes[fingerprint];

  if (existing) {
    existing.successCount += 1;
    existing.lastSuccess = new Date().toISOString();
    // Update actions if they changed (latest successful version)
    existing.actions = actions;
    existing.description = description;
  } else {
    memory.fixes[fingerprint] = {
      fingerprint,
      category,
      actions,
      description,
      successCount: 1,
      failureCount: 0,
      lastSuccess: new Date().toISOString(),
    };
  }

  saveMemory(memory);
}

/**
 * Record a failed fix attempt. Increments failure count so
 * future lookups deprioritize unreliable fixes.
 */
export function recordFailure(fingerprint: string): void {
  const memory = loadMemory();
  const existing = memory.fixes[fingerprint];

  if (existing) {
    existing.failureCount += 1;
    saveMemory(memory);
  }
}

// ---------------------------------------------------------------------------
// Convert memory entry to RepairPlan
// ---------------------------------------------------------------------------

export function memoryEntryToPlan(entry: FixMemoryEntry): RepairPlan {
  return {
    actions: entry.actions,
    confidence: entry.successCount >= 3 ? 'high' : 'medium',
    source: 'memory',
    category: entry.category,
    description: `${entry.description} (memory: ${entry.successCount} successes)`,
  };
}
