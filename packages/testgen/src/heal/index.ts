/**
 * Self-healing module barrel — re-exports all heal subsystems.
 */

export { classifyFailure } from './classifier';
export type { FailureClass, ClassifiedFailure } from './classifier';

export { loadMemory, saveMemory, recordOutcome, promotableStrategies, winRate, rankedStrategies } from './memory';
export type { HealMemoryData, MemoryEntry } from './memory';

export { selectAndApply, resolveStrategyName } from './repair';
export type { RepairResult } from './repair';

export {
  createSessionReport,
  addFileReport,
  printHealReport,
} from './report';
export type {
  HealAttempt,
  HealFileReport,
  HealSessionReport,
} from './report';
