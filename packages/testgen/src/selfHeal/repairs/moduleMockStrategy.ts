import { RepairDecision, RepairPatchOperation, RepairStrategy } from '../types';

const action = {
  id: 'rewrite-module-mock-factory',
  kind: 'mock',
  description: 'Rewrite module mocks to use inline deterministic factories',
  deterministic: true,
  safeToPromote: true,
} as const;

export const moduleMockStrategy: RepairStrategy = {
  id: 'module-mock-rewrite',
  categories: ['bad-module-mock'],
  priority: 88,
  action,
  apply(context): RepairDecision | null {
    if (!/(jest|vi)\.mock\(/.test(context.testContent)) {
      return null;
    }

    const generatorPatch: RepairPatchOperation[] = [
      {
        type: 'rewrite-mock',
        description: 'Rewrite the module mock factory so it creates mocks inline without closing over outer variables.',
        metadata: {
          rule: 'inline-mock-factory',
          framework: context.testContent.includes('vi.mock(') ? 'vitest' : 'jest',
        },
      },
    ];

    return {
      applied: true,
      action,
      reason: 'Generated a deterministic patch to rewrite the module mock factory.',
      confidence: 0.86,
      explanation: 'Out-of-scope mock factory failures are repaired most safely by regenerating the mock factory inline instead of mutating assertions.',
      strategyId: 'module-mock-rewrite',
      generatorPatch,
    };
  },
};
