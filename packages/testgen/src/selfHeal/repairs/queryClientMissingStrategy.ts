import { RepairDecision, RepairStrategy } from '../types';
import { insertSetupSnippet, insertStatementAfterImports, wrapFirstRenderArgument } from './utils';

const action = {
  id: 'wrap-query-client-provider',
  kind: 'wrap',
  description: 'Wrap render output with QueryClientProvider',
  deterministic: true,
  safeToPromote: true,
} as const;

export const queryClientMissingStrategy: RepairStrategy = {
  id: 'query-client-missing',
  categories: ['query-client-missing'],
  priority: 95,
  action,
  apply(context): RepairDecision | null {
    const importStatement =
      context.componentTraits?.queryClientImportStatement ??
      `import { QueryClient, QueryClientProvider } from '@tanstack/react-query';`;
    const queryClientIdentifier = context.componentTraits?.queryClientIdentifier ?? 'queryClient';
    const setupStatement =
      context.componentTraits?.queryClientSetupStatement ??
      `const ${queryClientIdentifier} = new QueryClient();`;

    let updatedContent = insertStatementAfterImports(context.testContent, importStatement);
    updatedContent = insertSetupSnippet(updatedContent, setupStatement);
    const wrappedContent = wrapFirstRenderArgument(updatedContent, [
      {
        opening: `<QueryClientProvider client={${queryClientIdentifier}}>`,
        closing: '</QueryClientProvider>',
      },
    ]);

    if (!wrappedContent || wrappedContent === context.testContent) {
      return null;
    }

    return {
      applied: true,
      action,
      reason: 'Added QueryClient setup and wrapped render with QueryClientProvider.',
      updatedContent: wrappedContent,
      confidence: 0.98,
      explanation: 'React Query failures are fixed by creating a test QueryClient and providing it to the rendered tree.',
      strategyId: 'query-client-missing',
    };
  },
};
