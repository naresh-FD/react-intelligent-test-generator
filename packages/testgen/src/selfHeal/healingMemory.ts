import fs from 'node:fs';
import path from 'node:path';
import { FailureCategory, FailureSignature, HealingMemoryEntry, RepairAction } from './types';

export interface HealingAttemptRecord {
  success: boolean;
  timestamp: string;
  componentPattern?: string;
}

export interface PersistedHealingMemoryEntry extends HealingMemoryEntry {
  category: FailureCategory;
  componentPattern?: string;
  lastOutcome: 'success' | 'failure' | 'unknown';
  successRate: number;
  updatedAt: string;
  history: HealingAttemptRecord[];
}

export interface HealingMemoryState {
  version: 1;
  entries: Record<string, PersistedHealingMemoryEntry>;
}

export interface RecordHealingAttemptInput {
  signature: FailureSignature;
  action: RepairAction;
  success: boolean;
  componentPattern?: string;
  timestamp?: string;
}

export interface RankedRepair {
  entry: PersistedHealingMemoryEntry;
  score: number;
}

const HEALING_MEMORY_VERSION = 1 as const;
const DEFAULT_HEALING_MEMORY_PATH = path.resolve(__dirname, '..', '..', '.testgen-healing-memory.json');
const MAX_HISTORY_ITEMS = 10;

export function getDefaultHealingMemoryPath(): string {
  return DEFAULT_HEALING_MEMORY_PATH;
}

export function createHealingMemoryState(): HealingMemoryState {
  return {
    version: HEALING_MEMORY_VERSION,
    entries: {},
  };
}

export function buildHealingMemoryKey(
  signatureFingerprint: string,
  actionId: string,
): string {
  return `${signatureFingerprint}::${actionId}`;
}

export function createHealingMemoryEntry(
  params: {
    signature: FailureSignature;
    action: RepairAction;
    attempts?: number;
    successes?: number;
    failures?: number;
    promoted?: boolean;
    lastAppliedAt?: string;
    componentPattern?: string;
    history?: HealingAttemptRecord[];
    lastOutcome?: PersistedHealingMemoryEntry['lastOutcome'];
  },
): PersistedHealingMemoryEntry {
  const attempts = params.attempts ?? 0;
  const successes = params.successes ?? 0;
  const failures = params.failures ?? 0;
  const updatedAt = params.lastAppliedAt ?? new Date(0).toISOString();
  return {
    signature: params.signature,
    action: params.action,
    attempts,
    successes,
    failures,
    promoted: params.promoted ?? false,
    lastAppliedAt: updatedAt,
    category: params.signature.category,
    componentPattern: params.componentPattern,
    lastOutcome: params.lastOutcome ?? 'unknown',
    successRate: calculateSuccessRate(successes, failures),
    updatedAt,
    history: [...(params.history ?? [])].slice(-MAX_HISTORY_ITEMS),
  };
}

export function upsertHealingMemoryEntry(
  state: HealingMemoryState,
  entry: PersistedHealingMemoryEntry,
): HealingMemoryState {
  const key = buildHealingMemoryKey(entry.signature.fingerprint, entry.action.id);
  return {
    ...state,
    entries: {
      ...state.entries,
      [key]: createHealingMemoryEntry({
        signature: entry.signature,
        action: entry.action,
        attempts: entry.attempts,
        successes: entry.successes,
        failures: entry.failures,
        promoted: entry.promoted,
        lastAppliedAt: entry.updatedAt,
        componentPattern: entry.componentPattern,
        history: entry.history,
        lastOutcome: entry.lastOutcome,
      }),
    },
  };
}

export function loadHealingMemory(
  memoryPath: string = DEFAULT_HEALING_MEMORY_PATH,
): HealingMemoryState {
  try {
    if (!fs.existsSync(memoryPath)) {
      return createHealingMemoryState();
    }

    const raw = fs.readFileSync(memoryPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<HealingMemoryState>;
    if (parsed.version !== HEALING_MEMORY_VERSION || typeof parsed.entries !== 'object' || !parsed.entries) {
      return createHealingMemoryState();
    }

    const entries = Object.fromEntries(
      Object.entries(parsed.entries)
        .map(([key, value]) => [key, normalizePersistedEntry(value)])
        .filter((entry): entry is [string, PersistedHealingMemoryEntry] => Boolean(entry[1])),
    );

    return {
      version: HEALING_MEMORY_VERSION,
      entries,
    };
  } catch {
    return createHealingMemoryState();
  }
}

export function saveHealingMemory(
  state: HealingMemoryState,
  memoryPath: string = DEFAULT_HEALING_MEMORY_PATH,
): boolean {
  try {
    fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
    const tempPath = `${memoryPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tempPath, memoryPath);
    return true;
  } catch {
    try {
      const tempPath = `${memoryPath}.tmp`;
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // Best-effort cleanup only.
    }
    return false;
  }
}

export function recordHealingAttempt(
  state: HealingMemoryState,
  input: RecordHealingAttemptInput,
): HealingMemoryState {
  const key = buildHealingMemoryKey(input.signature.fingerprint, input.action.id);
  const existing = state.entries[key];
  const timestamp = input.timestamp ?? new Date().toISOString();
  const attempts = (existing?.attempts ?? 0) + 1;
  const successes = (existing?.successes ?? 0) + (input.success ? 1 : 0);
  const failures = (existing?.failures ?? 0) + (input.success ? 0 : 1);
  const history = [...(existing?.history ?? []), {
    success: input.success,
    timestamp,
    componentPattern: input.componentPattern,
  }].slice(-MAX_HISTORY_ITEMS);

  const updatedEntry = createHealingMemoryEntry({
    signature: input.signature,
    action: input.action,
    attempts,
    successes,
    failures,
    promoted: existing?.promoted ?? false,
    lastAppliedAt: timestamp,
    componentPattern: input.componentPattern ?? existing?.componentPattern,
    history,
    lastOutcome: input.success ? 'success' : 'failure',
  });

  return upsertHealingMemoryEntry(state, updatedEntry);
}

export function getRepairHistoryForSignature(
  state: HealingMemoryState,
  signature: FailureSignature,
): PersistedHealingMemoryEntry[] {
  return Object.values(state.entries)
    .filter((entry) => entry.signature.fingerprint === signature.fingerprint)
    .sort(compareEntriesByRecencyAndStability);
}

export function rankRepairsForFailure(
  state: HealingMemoryState,
  signature: FailureSignature,
  componentPattern?: string,
): RankedRepair[] {
  const exactMatches = getRepairHistoryForSignature(state, signature);
  const categoryMatches = Object.values(state.entries).filter(
    (entry) =>
      entry.signature.fingerprint !== signature.fingerprint &&
      entry.category === signature.category,
  );

  const seen = new Set<string>();
  return [...exactMatches, ...categoryMatches]
    .filter((entry) => {
      const key = buildHealingMemoryKey(entry.signature.fingerprint, entry.action.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((entry) => ({
      entry,
      score: calculateRepairRank(entry, signature, componentPattern),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.entry.action.id.localeCompare(right.entry.action.id);
    });
}

function normalizePersistedEntry(value: unknown): PersistedHealingMemoryEntry | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<PersistedHealingMemoryEntry>;
  const signature = candidate.signature;
  const action = candidate.action;
  if (!signature || typeof signature !== 'object' || !action || typeof action !== 'object') {
    return null;
  }
  if (typeof signature.fingerprint !== 'string' || typeof signature.category !== 'string') {
    return null;
  }
  if (typeof action.id !== 'string' || typeof action.kind !== 'string' || typeof action.description !== 'string') {
    return null;
  }

  return createHealingMemoryEntry({
    signature: {
      category: signature.category,
      fingerprint: signature.fingerprint,
      normalizedText: typeof signature.normalizedText === 'string' ? signature.normalizedText : '',
      summary: typeof signature.summary === 'string' ? signature.summary : '',
      confidence: typeof signature.confidence === 'number' ? signature.confidence : 0,
      evidence: typeof signature.evidence === 'string' ? signature.evidence : '',
    },
    action: {
      id: action.id,
      kind: action.kind,
      description: action.description,
      deterministic: Boolean(action.deterministic),
      safeToPromote: Boolean(action.safeToPromote),
    },
    attempts: toNonNegativeInteger(candidate.attempts),
    successes: toNonNegativeInteger(candidate.successes),
    failures: toNonNegativeInteger(candidate.failures),
    promoted: Boolean(candidate.promoted),
    lastAppliedAt: typeof candidate.lastAppliedAt === 'string' ? candidate.lastAppliedAt : undefined,
    componentPattern: typeof candidate.componentPattern === 'string' ? candidate.componentPattern : undefined,
    history: Array.isArray(candidate.history)
      ? candidate.history
          .filter(isHealingAttemptRecord)
          .slice(-MAX_HISTORY_ITEMS)
      : [],
    lastOutcome:
      candidate.lastOutcome === 'success' || candidate.lastOutcome === 'failure' || candidate.lastOutcome === 'unknown'
        ? candidate.lastOutcome
        : 'unknown',
  });
}

function isHealingAttemptRecord(value: unknown): value is HealingAttemptRecord {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<HealingAttemptRecord>;
  return typeof candidate.success === 'boolean' && typeof candidate.timestamp === 'string';
}

function calculateRepairRank(
  entry: PersistedHealingMemoryEntry,
  signature: FailureSignature,
  componentPattern?: string,
): number {
  const exactSignatureBoost = entry.signature.fingerprint === signature.fingerprint ? 1000 : 200;
  const successBoost = entry.successes > 0 ? 500 : 0;
  const componentBoost =
    componentPattern && entry.componentPattern && entry.componentPattern === componentPattern ? 50 : 0;
  const stabilityScore = Math.round(entry.successRate * 100);
  return exactSignatureBoost + successBoost + componentBoost + stabilityScore + (entry.successes * 5) - (entry.failures * 3);
}

function compareEntriesByRecencyAndStability(
  left: PersistedHealingMemoryEntry,
  right: PersistedHealingMemoryEntry,
): number {
  if (right.successRate !== left.successRate) {
    return right.successRate - left.successRate;
  }
  if (right.successes !== left.successes) {
    return right.successes - left.successes;
  }
  return right.updatedAt.localeCompare(left.updatedAt);
}

function calculateSuccessRate(successes: number, failures: number): number {
  const total = successes + failures;
  if (total === 0) return 0;
  return Number((successes / total).toFixed(4));
}

function toNonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}
