import { RepairAction, RepairContext, RepairDecision, RepairResult, RepairStrategy } from './types';
import {
  asyncQueryStrategy,
  importPathNormalizationStrategy,
  importResolutionHintsStrategy,
  jestDomMatcherStrategy,
  missingExternalModuleStrategy,
  moduleMockStrategy,
  providerWrapperStrategy,
  queryClientMissingStrategy,
  reduxStoreMissingStrategy,
  routerMissingStrategy,
  selectorStrategy,
} from './repairs';

export const NOOP_REPAIR_ACTION: RepairAction = {
  id: 'noop',
  kind: 'defer',
  description: 'No repair action selected',
  deterministic: true,
  safeToPromote: false,
};

export function createRepairResult(
  action: RepairAction,
  options: {
    applied: boolean;
    reason: string;
    updatedContent?: string;
    confidence?: number;
    explanation?: string;
    strategyId?: string;
    generatorPatch?: RepairDecision['generatorPatch'];
  },
): RepairResult {
  return {
    applied: options.applied,
    action,
    reason: options.reason,
    updatedContent: options.updatedContent,
    confidence: options.confidence,
    explanation: options.explanation,
    strategyId: options.strategyId,
    generatorPatch: options.generatorPatch,
  };
}

export function isPromotableRepair(action: RepairAction): boolean {
  return action.deterministic && action.safeToPromote;
}

const REPAIR_STRATEGIES: RepairStrategy[] = [
  jestDomMatcherStrategy,
  providerWrapperStrategy,
  routerMissingStrategy,
  queryClientMissingStrategy,
  reduxStoreMissingStrategy,
  importResolutionHintsStrategy,
  missingExternalModuleStrategy,
  importPathNormalizationStrategy,
  moduleMockStrategy,
  asyncQueryStrategy,
  selectorStrategy,
];

export function getAvailableRepairStrategies(): RepairStrategy[] {
  return [...REPAIR_STRATEGIES];
}

export function chooseRepairStrategy(context: RepairContext): RepairDecision {
  const candidates = REPAIR_STRATEGIES
    .filter((strategy) => strategy.categories.includes(context.failure.category))
    .map((strategy) => {
      const decision = strategy.apply(context);
      if (!decision) {
        return null;
      }

      return {
        strategy,
        decision,
        score: scoreRepairDecision(strategy, decision, context),
      };
    })
    .filter((candidate): candidate is { strategy: RepairStrategy; decision: RepairDecision; score: number } => Boolean(candidate))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (right.strategy.priority !== left.strategy.priority) {
        return right.strategy.priority - left.strategy.priority;
      }
      return left.strategy.id.localeCompare(right.strategy.id);
    });

  if (candidates.length === 0) {
    return {
      applied: false,
      action: NOOP_REPAIR_ACTION,
      reason: `No deterministic repair strategy matched ${context.failure.category}.`,
      confidence: 0,
      explanation: 'No available strategy could apply a safe targeted repair for this classified failure.',
      strategyId: 'noop',
    };
  }

  return candidates[0].decision;
}

function scoreRepairDecision(
  strategy: RepairStrategy,
  decision: RepairDecision,
  context: RepairContext,
): number {
  const memoryBoost = getMemoryBoost(strategy, context);
  const confidenceScore = Math.round(decision.confidence * 100);
  const directEditBoost = decision.updatedContent ? 15 : 0;
  return (strategy.priority * 100) + memoryBoost + confidenceScore + directEditBoost;
}

function getMemoryBoost(strategy: RepairStrategy, context: RepairContext): number {
  const matchingHint = context.memoryRankedActions?.find((hint) => hint.actionId === strategy.action.id);
  if (!matchingHint) {
    return 0;
  }

  return 1000 + Math.round(matchingHint.score);
}
