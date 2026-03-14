import { RepairDecision, RepairStrategy } from '../types';
import { insertStatementAfterImports, wrapFirstRenderArgument } from './utils';

const action = {
  id: 'wrap-memory-router',
  kind: 'wrap',
  description: 'Wrap render output with MemoryRouter',
  deterministic: true,
  safeToPromote: true,
} as const;

export const routerMissingStrategy: RepairStrategy = {
  id: 'router-missing',
  categories: ['router-missing'],
  priority: 95,
  action,
  apply(context): RepairDecision | null {
    const importStatement = `import { MemoryRouter } from 'react-router-dom';`;
    const withImport = insertStatementAfterImports(context.testContent, importStatement);
    const wrappedContent = wrapFirstRenderArgument(withImport, [
      { opening: '<MemoryRouter>', closing: '</MemoryRouter>' },
    ]);

    if (!wrappedContent || wrappedContent === context.testContent) {
      return null;
    }

    return {
      applied: true,
      action,
      reason: 'Wrapped the rendered UI with MemoryRouter.',
      updatedContent: wrappedContent,
      confidence: 0.99,
      explanation: 'Router context errors are fixed by rendering the component under a React Router provider.',
      strategyId: 'router-missing',
    };
  },
};
