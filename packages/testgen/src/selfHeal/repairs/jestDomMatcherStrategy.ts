import { RepairDecision, RepairStrategy } from '../types';
import { insertStatementAfterImports } from './utils';

const action = {
  id: 'add-jest-dom-import',
  kind: 'import-adjustment',
  description: 'Add @testing-library/jest-dom matcher import',
  deterministic: true,
  safeToPromote: true,
} as const;

export const jestDomMatcherStrategy: RepairStrategy = {
  id: 'jest-dom-matcher-import',
  categories: ['missing-jest-dom-matcher'],
  priority: 90,
  action,
  apply(context): RepairDecision | null {
    const importStatement = `import '@testing-library/jest-dom';`;
    const updatedContent = insertStatementAfterImports(context.testContent, importStatement);
    if (updatedContent === context.testContent) {
      return null;
    }

    return {
      applied: true,
      action,
      reason: 'Added the missing jest-dom matcher import.',
      updatedContent,
      confidence: 0.99,
      explanation: 'The failure matches a missing jest-dom matcher; importing the matcher setup is the direct fix.',
      strategyId: 'jest-dom-matcher-import',
    };
  },
};
