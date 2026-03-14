import { RepairDecision, RepairStrategy } from '../types';
import { ensureAsyncTestCallback, upgradeFirstScreenQueryToFindBy } from './utils';

const action = {
  id: 'upgrade-query-to-async',
  kind: 'assertion-adjustment',
  description: 'Upgrade synchronous Testing Library queries to async queries',
  deterministic: true,
  safeToPromote: true,
} as const;

export const asyncQueryStrategy: RepairStrategy = {
  id: 'async-query-upgrade',
  categories: ['async-query-mismatch'],
  priority: 85,
  action,
  apply(context): RepairDecision | null {
    const upgradedQueryContent = upgradeFirstScreenQueryToFindBy(context.testContent);
    if (!upgradedQueryContent) {
      return null;
    }

    const updatedContent = ensureAsyncTestCallback(upgradedQueryContent);
    return {
      applied: true,
      action,
      reason: 'Converted the first synchronous query to an awaited async query.',
      updatedContent,
      confidence: 0.88,
      explanation: 'The failure indicates the DOM update is asynchronous, so the query should wait rather than assert immediately.',
      strategyId: 'async-query-upgrade',
    };
  },
};
