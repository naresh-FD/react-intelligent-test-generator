import { RepairDecision, RepairStrategy } from '../types';
import { applyStringReplacements } from './utils';

const action = {
  id: 'strengthen-selector',
  kind: 'assertion-adjustment',
  description: 'Replace weak selectors with stronger deterministic queries',
  deterministic: true,
  safeToPromote: true,
} as const;

export const selectorStrategy: RepairStrategy = {
  id: 'selector-strengthening',
  categories: ['selector-too-weak'],
  priority: 84,
  action,
  apply(context): RepairDecision | null {
    const replacements = context.componentTraits?.selectorReplacements;
    if (!replacements || replacements.length === 0) {
      return null;
    }

    const result = applyStringReplacements(
      context.testContent,
      replacements.map((replacement) => ({
        from: replacement.from,
        to: replacement.to,
      })),
    );
    if (!result.applied) {
      return null;
    }

    return {
      applied: true,
      action,
      reason: 'Replaced weak selectors with explicit deterministic queries.',
      updatedContent: result.content,
      confidence: 0.87,
      explanation: 'The component traits provide stronger selectors, so the repair replaces the brittle query rather than broadening assertions.',
      strategyId: 'selector-strengthening',
      generatorPatch: result.operations,
    };
  },
};
