import { RepairDecision, RepairStrategy } from '../types';
import { applyStringReplacements } from './utils';

const action = {
  id: 'apply-import-resolution-hints',
  kind: 'import-adjustment',
  description: 'Apply deterministic import resolution hints to broken module specifiers',
  deterministic: true,
  safeToPromote: true,
} as const;

export const importResolutionHintsStrategy: RepairStrategy = {
  id: 'import-resolution-hints',
  categories: ['bad-import-resolution'],
  priority: 95,
  action,
  apply(context): RepairDecision | null {
    const hints = context.componentTraits?.importResolutionHints;
    if (!hints || hints.length === 0) {
      return null;
    }

    const result = applyStringReplacements(
      context.testContent,
      hints.map((hint) => ({ from: hint.from, to: hint.to })),
    );
    if (!result.applied) {
      return null;
    }

    return {
      applied: true,
      action,
      reason: 'Rewrote broken import specifiers using deterministic resolution hints.',
      updatedContent: result.content,
      confidence: 0.96,
      explanation: 'Import resolution hints provide exact replacement paths, which is safer than guessing module aliases.',
      strategyId: 'import-resolution-hints',
      generatorPatch: result.operations,
    };
  },
};
