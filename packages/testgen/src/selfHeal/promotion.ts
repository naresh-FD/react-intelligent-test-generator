import { chooseRepairStrategy } from './repairEngine';
import { HealingMemoryState, PersistedHealingMemoryEntry } from './healingMemory';
import { ComponentTraits, RepairDecision } from './types';

export interface PromotionCriteria {
  minSuccesses: number;
  minAttempts: number;
  minSuccessRate: number;
  maxFailures: number;
  minSignatureConfidence: number;
}

export interface PromotedGenerationRepair {
  entry: PersistedHealingMemoryEntry;
  trigger: 'component-pattern' | 'trait';
  decision: RepairDecision;
}

export const DEFAULT_PROMOTION_CRITERIA: PromotionCriteria = {
  minSuccesses: 2,
  minAttempts: 2,
  minSuccessRate: 0.9,
  maxFailures: 0,
  minSignatureConfidence: 0.9,
};

export function shouldPromoteRepairEntry(
  entry: PersistedHealingMemoryEntry,
  criteria: PromotionCriteria = DEFAULT_PROMOTION_CRITERIA,
): boolean {
  if (!entry.action.safeToPromote || !entry.action.deterministic) {
    return false;
  }
  if (entry.signature.confidence < criteria.minSignatureConfidence) {
    return false;
  }
  if (entry.successes < criteria.minSuccesses || entry.attempts < criteria.minAttempts) {
    return false;
  }
  if (entry.failures > criteria.maxFailures) {
    return false;
  }
  return entry.successRate >= criteria.minSuccessRate;
}

export function refreshPromotedEntries(
  state: HealingMemoryState,
  criteria: PromotionCriteria = DEFAULT_PROMOTION_CRITERIA,
): HealingMemoryState {
  const entries = Object.fromEntries(
    Object.entries(state.entries).map(([key, entry]) => [
      key,
      {
        ...entry,
        promoted: shouldPromoteRepairEntry(entry, criteria),
      },
    ]),
  );
  return {
    ...state,
    entries,
  };
}

export function getPromotedRepairsForGeneration(params: {
  state: HealingMemoryState;
  testContent: string;
  componentTraits?: ComponentTraits;
  componentPattern?: string;
  sourceFilePath?: string;
  testFilePath?: string;
  criteria?: PromotionCriteria;
}): PromotedGenerationRepair[] {
  const promotedEntries = Object.values(params.state.entries)
    .filter((entry) => shouldPromoteRepairEntry(entry, params.criteria))
    .sort(comparePromotedEntries);

  const repairs: PromotedGenerationRepair[] = [];
  let currentContent = params.testContent;

  for (const entry of promotedEntries) {
    const trigger = getPromotionTrigger(entry, params.componentPattern, params.componentTraits, currentContent);
    if (!trigger) {
      continue;
    }

    const decision = chooseRepairStrategy({
      testContent: currentContent,
      failure: entry.signature,
      componentTraits: params.componentTraits,
      sourceFilePath: params.sourceFilePath,
      testFilePath: params.testFilePath,
      generationMetadata: {
        promotedActionId: entry.action.id,
        promotionTrigger: trigger,
      },
    });
    if (!decision.applied || (!decision.updatedContent && !decision.generatorPatch)) {
      continue;
    }

    if (decision.updatedContent) {
      currentContent = decision.updatedContent;
    }
    repairs.push({ entry, trigger, decision });
  }

  return repairs;
}

function comparePromotedEntries(
  left: PersistedHealingMemoryEntry,
  right: PersistedHealingMemoryEntry,
): number {
  if (right.successes !== left.successes) {
    return right.successes - left.successes;
  }
  if (right.successRate !== left.successRate) {
    return right.successRate - left.successRate;
  }
  return left.action.id.localeCompare(right.action.id);
}

function getPromotionTrigger(
  entry: PersistedHealingMemoryEntry,
  componentPattern: string | undefined,
  componentTraits: ComponentTraits | undefined,
  testContent: string,
): PromotedGenerationRepair['trigger'] | null {
  if (componentPattern && entry.componentPattern && componentPattern === entry.componentPattern) {
    return 'component-pattern';
  }

  if (!componentTraits) {
    return null;
  }

  switch (entry.action.id) {
    case 'wrap-required-providers':
      return componentTraits.requiredProviders && componentTraits.requiredProviders.length > 0 ? 'trait' : null;
    case 'wrap-memory-router':
      return componentTraits.usesRouter && !testContent.includes('MemoryRouter') ? 'trait' : null;
    case 'wrap-query-client-provider':
      return componentTraits.usesReactQuery && !testContent.includes('QueryClientProvider') ? 'trait' : null;
    case 'wrap-redux-provider':
      return componentTraits.usesRedux && !testContent.includes('ReduxProvider') ? 'trait' : null;
    case 'upgrade-query-to-async':
      return componentTraits.usesAsyncData && /\.getBy[A-Z]/.test(testContent) ? 'trait' : null;
    case 'strengthen-selector':
      return componentTraits.selectorReplacements && componentTraits.selectorReplacements.length > 0 ? 'trait' : null;
    case 'add-jest-dom-import':
      return /to(BeInTheDocument|BeVisible|HaveTextContent)\(/.test(testContent) ? 'trait' : null;
    default:
      return null;
  }
}
