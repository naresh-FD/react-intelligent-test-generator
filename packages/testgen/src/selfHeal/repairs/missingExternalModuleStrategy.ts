import { RepairDecision, RepairStrategy } from '../types';
import { insertStatementAfterImports } from './utils';

const action = {
  id: 'mock-missing-external-module',
  kind: 'mock',
  description: 'Add a deterministic mock for a missing external module',
  deterministic: true,
  safeToPromote: true,
} as const;

function extractMissingModuleSpecifier(evidence: string, normalizedText: string): string | null {
  const source = evidence || normalizedText;
  const match = source.match(/Cannot find module ['"]([^'"]+)['"]/i);
  if (!match) {
    return null;
  }

  const moduleSpecifier = match[1];
  if (moduleSpecifier.startsWith('.') || moduleSpecifier.startsWith('/')) {
    return null;
  }

  return moduleSpecifier;
}

export const missingExternalModuleStrategy: RepairStrategy = {
  id: 'missing-external-module',
  categories: ['bad-import-resolution'],
  priority: 90,
  action,
  apply(context): RepairDecision | null {
    const moduleSpecifier = extractMissingModuleSpecifier(
      context.failure.evidence,
      context.failure.normalizedText,
    );
    if (!moduleSpecifier) {
      return null;
    }

    const usesVitest = /from "vitest"|from 'vitest'/.test(context.testContent);
    const mockFunction = usesVitest ? 'vi.mock' : 'jest.mock';
    const mockLine = usesVitest
      ? `${mockFunction}("${moduleSpecifier}", () => ({ __esModule: true, default: () => null }));`
      : `${mockFunction}("${moduleSpecifier}", () => ({ __esModule: true, default: () => null }), { virtual: true });`;
    const updatedContent = insertStatementAfterImports(context.testContent, mockLine);
    if (updatedContent === context.testContent) {
      return null;
    }

    return {
      applied: true,
      action,
      reason: 'Inserted a deterministic stub for the missing external module.',
      updatedContent,
      confidence: 0.93,
      explanation: 'The failure is a missing external module import, so adding a stable module stub is safer than weakening assertions or skipping the file.',
      strategyId: 'missing-external-module',
    };
  },
};
