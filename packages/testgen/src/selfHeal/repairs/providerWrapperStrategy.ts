import { RepairDecision, RepairStrategy } from '../types';
import { createWrapperSnippets, insertStatementAfterImports, wrapFirstRenderArgument } from './utils';

const action = {
  id: 'wrap-required-providers',
  kind: 'wrap',
  description: 'Wrap render output in required providers from component traits',
  deterministic: true,
  safeToPromote: true,
} as const;

export const providerWrapperStrategy: RepairStrategy = {
  id: 'provider-wrapper',
  categories: ['missing-provider-wrapper'],
  priority: 80,
  action,
  apply(context): RepairDecision | null {
    const providers = context.componentTraits?.requiredProviders;
    if (!providers || providers.length === 0) {
      return null;
    }

    let updatedContent = context.testContent;
    for (const provider of providers) {
      updatedContent = insertStatementAfterImports(updatedContent, provider.importStatement);
    }

    const wrappedContent = wrapFirstRenderArgument(updatedContent, createWrapperSnippets(providers));
    if (!wrappedContent || wrappedContent === context.testContent) {
      return null;
    }

    return {
      applied: true,
      action,
      reason: 'Wrapped the rendered UI with the provider stack defined by component traits.',
      updatedContent: wrappedContent,
      confidence: 0.9,
      explanation: 'The failure indicates missing provider context, and the component traits supply the exact providers to wrap around render.',
      strategyId: 'provider-wrapper',
    };
  },
};
