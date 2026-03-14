import { RepairDecision, RepairStrategy } from '../types';
import { normalizeRelativeImportSpecifiers } from './utils';

const action = {
  id: 'normalize-relative-import-paths',
  kind: 'import-adjustment',
  description: 'Normalize malformed relative import paths',
  deterministic: true,
  safeToPromote: true,
} as const;

export const importPathNormalizationStrategy: RepairStrategy = {
  id: 'import-path-normalization',
  categories: ['bad-import-resolution'],
  priority: 80,
  action,
  apply(context): RepairDecision | null {
    const updatedContent = normalizeRelativeImportSpecifiers(context.testContent);
    if (updatedContent === context.testContent) {
      return null;
    }

    return {
      applied: true,
      action,
      reason: 'Normalized malformed relative import paths.',
      updatedContent,
      confidence: 0.84,
      explanation: 'The failure matches malformed local import paths, so normalizing duplicate separators is the least invasive direct fix.',
      strategyId: 'import-path-normalization',
    };
  },
};
