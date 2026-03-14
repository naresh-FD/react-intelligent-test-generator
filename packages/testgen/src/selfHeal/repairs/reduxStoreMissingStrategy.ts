import { RepairDecision, RepairPatchOperation, RepairStrategy } from '../types';
import { insertSetupSnippet, insertStatementAfterImports, wrapFirstRenderArgument } from './utils';

const action = {
  id: 'wrap-redux-provider',
  kind: 'wrap',
  description: 'Wrap render output with the Redux Provider',
  deterministic: true,
  safeToPromote: true,
} as const;

export const reduxStoreMissingStrategy: RepairStrategy = {
  id: 'redux-store-missing',
  categories: ['redux-store-missing'],
  priority: 92,
  action,
  apply(context): RepairDecision | null {
    const providerImport =
      context.componentTraits?.reduxProviderImportStatement ?? `import { Provider } from 'react-redux';`;
    const storeIdentifier = context.componentTraits?.reduxStoreIdentifier ?? 'store';
    const storeFactorySnippet = context.componentTraits?.reduxStoreFactorySnippet;

    if (!storeFactorySnippet) {
      const generatorPatch: RepairPatchOperation[] = [
        {
          type: 'regenerate-with-hint',
          description: 'Regenerate the test with a deterministic Redux store factory snippet.',
          metadata: {
            action: 'inject-redux-store-factory',
            storeIdentifier,
          },
        },
        {
          type: 'wrap-render',
          description: 'Wrap the first render call with the Redux Provider.',
          after: `<Provider store={${storeIdentifier}}>{ui}</Provider>`,
        },
      ];

      return {
        applied: true,
        action,
        reason: 'Generated a deterministic generator patch for the missing Redux store wrapper.',
        confidence: 0.74,
        explanation: 'The failure requires a Redux Provider, but the current traits do not provide a concrete store factory snippet for a safe direct rewrite.',
        strategyId: 'redux-store-missing',
        generatorPatch,
      };
    }

    let updatedContent = insertStatementAfterImports(context.testContent, providerImport);
    updatedContent = insertSetupSnippet(updatedContent, storeFactorySnippet);
    const wrappedContent = wrapFirstRenderArgument(updatedContent, [
      {
        opening: `<Provider store={${storeIdentifier}}>`,
        closing: '</Provider>',
      },
    ]);

    if (!wrappedContent || wrappedContent === context.testContent) {
      return null;
    }

    return {
      applied: true,
      action,
      reason: 'Added Redux Provider setup and wrapped render with the store provider.',
      updatedContent: wrappedContent,
      confidence: 0.95,
      explanation: 'Redux context failures are fixed by creating a deterministic test store and rendering under a Provider.',
      strategyId: 'redux-store-missing',
    };
  },
};
