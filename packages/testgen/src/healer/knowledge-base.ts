// ---------------------------------------------------------------------------
// Knowledge Base — categorized fix rules with semantic RepairPlan output
// ---------------------------------------------------------------------------

import { FailureAnalysis, FailureCategory } from './analyzer';

// ---------------------------------------------------------------------------
// Repair Action types (Phase 1 — auto-apply safe actions only)
// ---------------------------------------------------------------------------

export type RepairAction =
  | { kind: 'add-wrapper'; wrapper: string; importFrom: string }
  | { kind: 'require-provider'; provider: string; importFrom: string; exportName: string; alias?: string }
  | { kind: 'use-render-helper'; helper: 'renderWithProviders' }
  | { kind: 'ensure-import'; module: string; symbol?: string }
  | { kind: 'switch-query'; from: string; to: string }
  | { kind: 'add-async-handling'; strategy: 'findBy' | 'waitFor' | 'act' }
  | { kind: 'fix-mock-return'; target: string; shapeKind: 'array' | 'function' | 'object' | 'promise' }
  | { kind: 'mock-hook'; hookName: string; valueKind: 'object' | 'function'; preset?: string };

export interface RepairPlan {
  actions: RepairAction[];
  confidence: 'high' | 'medium' | 'low';
  source: 'memory' | 'kb' | 'web';
  category: FailureCategory;
  description: string;
}

// ---------------------------------------------------------------------------
// Rule interface
// ---------------------------------------------------------------------------

interface KBRule {
  id: string;
  category: FailureCategory;
  /** Check if this rule applies to the failure. */
  match(analysis: FailureAnalysis): boolean;
  /** Produce repair actions for this failure. */
  plan(analysis: FailureAnalysis): { actions: RepairAction[]; confidence: 'high' | 'medium' | 'low'; description: string };
}

// ---------------------------------------------------------------------------
// MISSING_PROVIDER rules
// ---------------------------------------------------------------------------

const routerProviderRule: KBRule = {
  id: 'missing-router-provider',
  category: FailureCategory.MISSING_PROVIDER,
  match: (a) =>
    a.category === FailureCategory.MISSING_PROVIDER &&
    (a.providerName === 'MemoryRouter' || /router/i.test(a.errorMessage)),
  plan: () => ({
    actions: [{ kind: 'require-provider', provider: 'MemoryRouter', importFrom: 'react-router-dom', exportName: 'MemoryRouter' }],
    confidence: 'high',
    description: 'Add MemoryRouter wrapper — component uses Router hooks',
  }),
};

const queryClientProviderRule: KBRule = {
  id: 'missing-queryclient-provider',
  category: FailureCategory.MISSING_PROVIDER,
  match: (a) =>
    a.category === FailureCategory.MISSING_PROVIDER &&
    (a.providerName === 'QueryClientProvider' || /QueryClient/i.test(a.errorMessage)),
  plan: () => ({
    actions: [
      { kind: 'require-provider', provider: 'QueryClientProvider', importFrom: '@tanstack/react-query', exportName: 'QueryClientProvider' },
    ],
    confidence: 'high',
    description: 'Add QueryClientProvider wrapper — component uses React Query hooks',
  }),
};

const reduxProviderRule: KBRule = {
  id: 'missing-redux-provider',
  category: FailureCategory.MISSING_PROVIDER,
  match: (a) =>
    a.category === FailureCategory.MISSING_PROVIDER &&
    (a.providerName === 'ReduxProvider' || /store/i.test(a.errorMessage)),
  plan: () => ({
    actions: [{ kind: 'require-provider', provider: 'ReduxProvider', importFrom: 'react-redux', exportName: 'Provider', alias: 'ReduxProvider' }],
    confidence: 'medium',
    description: 'Add Redux Provider wrapper — component uses Redux hooks',
  }),
};

// ---------------------------------------------------------------------------
// HOOK_CONTEXT_MISSING rules
//
// Fix ordering: prefer provider wrapper → render helper → mock hook (last resort)
// ---------------------------------------------------------------------------

const hookContextUseRenderHelperRule: KBRule = {
  id: 'hook-context-use-render-helper',
  category: FailureCategory.HOOK_CONTEXT_MISSING,
  match: (a) => a.category === FailureCategory.HOOK_CONTEXT_MISSING,
  plan: (a) => {
    const hookName = a.hookName || 'unknown';
    const actions: RepairAction[] = [
      { kind: 'use-render-helper', helper: 'renderWithProviders' },
    ];

    // Also add specific wrapper actions as fallback when renderWithProviders is unavailable
    if (/navigate|location|params|route|search.*params/i.test(hookName) || /router/i.test(a.errorMessage)) {
      actions.push({ kind: 'require-provider', provider: 'MemoryRouter', importFrom: 'react-router-dom', exportName: 'MemoryRouter' });
    }
    if (/query|mutation|queryClient/i.test(hookName) || /QueryClient/i.test(a.errorMessage)) {
      actions.push({ kind: 'require-provider', provider: 'QueryClientProvider', importFrom: '@tanstack/react-query', exportName: 'QueryClientProvider' });
    }

    return {
      actions,
      confidence: 'medium',
      description: `Use renderWithProviders or add provider wrapper — hook ${hookName} needs provider context`,
    };
  },
};

// ---------------------------------------------------------------------------
// BAD_MODULE_RESOLUTION rules
// ---------------------------------------------------------------------------

const badModuleResolutionRule: KBRule = {
  id: 'bad-module-resolution',
  category: FailureCategory.BAD_MODULE_RESOLUTION,
  match: (a) => a.category === FailureCategory.BAD_MODULE_RESOLUTION && !!a.missingModule,
  plan: (a) => {
    const mod = a.missingModule!;
    // If it looks like an alias (@/..., ~/...), hint to fix the import path
    if (mod.startsWith('@/') || mod.startsWith('~/')) {
      return {
        actions: [{ kind: 'ensure-import', module: mod, symbol: undefined }],
        confidence: 'medium',
        description: `Fix module resolution for alias "${mod}" — may need tsconfig paths or relative path`,
      };
    }
    // If it looks like a relative path, the generated path is likely wrong
    if (mod.startsWith('.')) {
      return {
        actions: [{ kind: 'ensure-import', module: mod }],
        confidence: 'medium',
        description: `Fix relative import path "${mod}"`,
      };
    }
    // External package — likely missing from deps or wrong package name
    return {
      actions: [{ kind: 'ensure-import', module: mod }],
      confidence: 'low',
      description: `Module "${mod}" not found — may need npm install or import path fix`,
    };
  },
};

// ---------------------------------------------------------------------------
// MISSING_SYMBOL_IMPORT rules
// ---------------------------------------------------------------------------

const missingSymbolRule: KBRule = {
  id: 'missing-symbol-import',
  category: FailureCategory.MISSING_SYMBOL_IMPORT,
  match: (a) => a.category === FailureCategory.MISSING_SYMBOL_IMPORT && !!a.missingIdentifier,
  plan: (a) => {
    const id = a.missingIdentifier!;

    // Common testing library symbols
    const testingLibSymbols: Record<string, string> = {
      screen: '@testing-library/react',
      render: '@testing-library/react',
      fireEvent: '@testing-library/react',
      waitFor: '@testing-library/react',
      act: '@testing-library/react',
      userEvent: '@testing-library/user-event',
    };

    if (testingLibSymbols[id]) {
      return {
        actions: [{ kind: 'ensure-import', module: testingLibSymbols[id], symbol: id }],
        confidence: 'high',
        description: `Add missing import for "${id}" from ${testingLibSymbols[id]}`,
      };
    }

    return {
      actions: [{ kind: 'ensure-import', module: 'unknown', symbol: id }],
      confidence: 'low',
      description: `"${id}" is not defined — needs import`,
    };
  },
};

// ---------------------------------------------------------------------------
// MOCK_SHAPE_MISMATCH rules
// ---------------------------------------------------------------------------

const mockNotFunctionRule: KBRule = {
  id: 'mock-not-function',
  category: FailureCategory.MOCK_SHAPE_MISMATCH,
  match: (a) => a.category === FailureCategory.MOCK_SHAPE_MISMATCH && a.shapeIssue === 'not-function',
  plan: (a) => ({
    actions: [{ kind: 'fix-mock-return', target: a.mockTarget || 'unknown', shapeKind: 'function' }],
    confidence: 'high',
    description: `Fix mock — "${a.mockTarget}" should return a function`,
  }),
};

const mockNotArrayRule: KBRule = {
  id: 'mock-not-array',
  category: FailureCategory.MOCK_SHAPE_MISMATCH,
  match: (a) => a.category === FailureCategory.MOCK_SHAPE_MISMATCH && a.shapeIssue === 'not-array',
  plan: (a) => ({
    actions: [{ kind: 'fix-mock-return', target: a.mockTarget || 'unknown', shapeKind: 'array' }],
    confidence: 'high',
    description: `Fix mock — "${a.mockTarget}" should return an array`,
  }),
};

const mockUndefinedPropertyRule: KBRule = {
  id: 'mock-undefined-property',
  category: FailureCategory.MOCK_SHAPE_MISMATCH,
  match: (a) => a.category === FailureCategory.MOCK_SHAPE_MISMATCH && a.shapeIssue === 'undefined-property',
  plan: (a) => ({
    actions: [{ kind: 'fix-mock-return', target: a.missingIdentifier || 'unknown', shapeKind: 'object' }],
    confidence: 'medium',
    description: `Fix mock — property "${a.missingIdentifier}" is being read from undefined/null`,
  }),
};

// ---------------------------------------------------------------------------
// ASYNC_NOT_AWAITED rules
// ---------------------------------------------------------------------------

const asyncActRule: KBRule = {
  id: 'async-act-wrapping',
  category: FailureCategory.ASYNC_NOT_AWAITED,
  match: (a) => a.category === FailureCategory.ASYNC_NOT_AWAITED,
  plan: () => ({
    actions: [{ kind: 'add-async-handling', strategy: 'act' }],
    confidence: 'high',
    description: 'Add act() wrapping for async state updates',
  }),
};

// ---------------------------------------------------------------------------
// BAD_QUERY_SELECTOR rules
// ---------------------------------------------------------------------------

const badQuerySwitchToFindByRule: KBRule = {
  id: 'bad-query-switch-findby',
  category: FailureCategory.BAD_QUERY_SELECTOR,
  match: (a) =>
    a.category === FailureCategory.BAD_QUERY_SELECTOR &&
    !!a.queryMethod &&
    a.queryMethod.startsWith('getBy'),
  plan: (a) => ({
    actions: [{ kind: 'switch-query', from: a.queryMethod || 'getByText', to: a.queryMethod?.replace('getBy', 'findBy') || 'findByText' }],
    confidence: 'medium',
    description: `Switch ${a.queryMethod} → findBy* (element may render asynchronously)`,
  }),
};

// ---------------------------------------------------------------------------
// All rules, ordered by category priority
// ---------------------------------------------------------------------------

const ALL_RULES: KBRule[] = [
  // Priority 2 — BAD_MODULE_RESOLUTION
  badModuleResolutionRule,
  // Priority 3 — MISSING_SYMBOL_IMPORT
  missingSymbolRule,
  // Priority 4 — MISSING_PROVIDER
  routerProviderRule,
  queryClientProviderRule,
  reduxProviderRule,
  // Priority 5 — HOOK_CONTEXT_MISSING (prefer provider → render helper → mock hook)
  hookContextUseRenderHelperRule,
  // Priority 6 — MOCK_SHAPE_MISMATCH
  mockNotFunctionRule,
  mockNotArrayRule,
  mockUndefinedPropertyRule,
  // Priority 7 — ASYNC_NOT_AWAITED
  asyncActRule,
  // Priority 8 — BAD_QUERY_SELECTOR
  badQuerySwitchToFindByRule,
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Find the first matching KB rule for a failure analysis.
 * Returns a RepairPlan or null if no safe rule applies.
 *
 * Categories ASSERTION_MISMATCH, SYNTAX_ERROR, and UNKNOWN are report-only —
 * no auto-fix is attempted.
 */
export function findRepairPlan(analysis: FailureAnalysis): RepairPlan | null {
  // Report-only categories — do not auto-fix
  const reportOnly: FailureCategory[] = [
    FailureCategory.ASSERTION_MISMATCH,
    FailureCategory.SYNTAX_ERROR,
    FailureCategory.UNKNOWN,
  ];
  if (reportOnly.includes(analysis.category)) {
    return null;
  }

  for (const rule of ALL_RULES) {
    if (rule.match(analysis)) {
      const { actions, confidence, description } = rule.plan(analysis);
      return {
        actions,
        confidence,
        source: 'kb',
        category: analysis.category,
        description,
      };
    }
  }

  return null;
}

/**
 * Get all KB rule IDs (useful for debugging/logging).
 */
export function listRuleIds(): string[] {
  return ALL_RULES.map((r) => r.id);
}
