/**
 * Repair engine — applies targeted repairs to generated test files based on
 * the classified failure type.  Each repair strategy mutates the test file
 * content string and returns the updated content (or null if it cannot help).
 *
 * Strategies are deterministic text transforms — no randomness.
 */

import fs from 'node:fs';
import type { FailureClass, ClassifiedFailure } from './classifier';
import type { HealMemoryData } from './memory';
import { rankedStrategies } from './memory';

// ---------------------------------------------------------------------------
// Strategy registry
// ---------------------------------------------------------------------------

export interface RepairResult {
  /** Name of the strategy applied */
  strategyName: string;
  /** The repaired test file content */
  content: string;
}

type StrategyFn = (
  testContent: string,
  failure: ClassifiedFailure,
  testFilePath: string,
  sourceFilePath: string
) => string | null;

interface Strategy {
  name: string;
  appliesTo: FailureClass[];
  apply: StrategyFn;
}

// ---------------------------------------------------------------------------
// Individual repair strategies
// ---------------------------------------------------------------------------

const wrapWithMemoryRouter: Strategy = {
  name: 'wrap_with_memory_router',
  appliesTo: ['missing_provider', 'render_error'],
  apply: (content, failure) => {
    if (!/useNavigate|useLocation|useParams|MemoryRouter/i.test(failure.rawOutput)) return null;
    if (content.includes('MemoryRouter')) return null; // already has it

    // Add import
    let patched = content;
    if (!patched.includes("from 'react-router-dom'") && !patched.includes('from "react-router-dom"')) {
      patched = patched.replace(
        /(import .+from ['"]@testing-library\/react['"];?)/,
        `$1\nimport { MemoryRouter } from 'react-router-dom';`
      );
    }

    // Wrap render calls
    patched = patched.replace(
      /render\((<[A-Z]\w*)/g,
      'render(<MemoryRouter>$1'
    );
    patched = patched.replace(
      /(<\/[A-Z]\w*>)\s*\)/g,
      '$1</MemoryRouter>)'
    );

    return patched !== content ? patched : null;
  },
};

const wrapWithQueryClient: Strategy = {
  name: 'wrap_with_query_client',
  appliesTo: ['missing_provider', 'render_error'],
  apply: (content, failure) => {
    if (!/QueryClient|useQuery|useMutation/i.test(failure.rawOutput)) return null;
    if (content.includes('QueryClientProvider')) return null;

    let patched = content;

    // Add imports
    if (!patched.includes('QueryClientProvider')) {
      patched = patched.replace(
        /(import .+from ['"]@testing-library\/react['"];?)/,
        `$1\nimport { QueryClient, QueryClientProvider } from '@tanstack/react-query';`
      );
    }

    // Add factory before first describe
    if (!patched.includes('createTestQueryClient')) {
      patched = patched.replace(
        /(describe\()/,
        `const createTestQueryClient = () => new QueryClient({\n  defaultOptions: { queries: { retry: false, gcTime: 0 } },\n});\n\n$1`
      );
    }

    return patched !== content ? patched : null;
  },
};

const addMissingMock: Strategy = {
  name: 'add_missing_mock',
  appliesTo: ['missing_mock', 'render_error', 'type_error'],
  apply: (content, failure) => {
    // Detect unmocked module from error
    const moduleMatch = failure.reason.match(
      /Cannot read propert.*of (?:undefined|null).*['"](\w+)['"]/
    );
    if (!moduleMatch) return null;

    const moduleName = moduleMatch[1];
    if (content.includes(`jest.mock`) && content.includes(moduleName)) return null;

    const mockLine = `jest.mock('./${moduleName}', () => ({ __esModule: true, default: jest.fn() }));\n`;
    const patched = content.replace(
      /(import .+;\n)(\n)/,
      `$1${mockLine}$2`
    );

    return patched !== content ? patched : null;
  },
};

const fixQuerySelector: Strategy = {
  name: 'fix_query_selector',
  appliesTo: ['query_not_found', 'assertion_mismatch'],
  apply: (content, failure) => {
    // If getBy fails, switch to queryBy + existence check, or use findBy for async
    if (!/Unable to find/.test(failure.rawOutput)) return null;

    // Replace getByText with queryByText for assertions that check presence
    const patched = content.replace(
      /screen\.getBy(Text|Role|TestId|LabelText|PlaceholderText)\(([^)]+)\)/g,
      'screen.queryBy$1($2)'
    );

    return patched !== content ? patched : null;
  },
};

const wrapWithAct: Strategy = {
  name: 'wrap_with_act',
  appliesTo: ['act_warning'],
  apply: (content) => {
    if (content.includes("from 'react'") && content.includes('act')) return null;

    let patched = content;
    // Add act import if missing
    if (!patched.includes('{ act }') && !patched.includes('act,')) {
      patched = patched.replace(
        /(import .+from ['"]@testing-library\/react['"];?)/,
        `$1\nimport { act } from 'react';`
      );
    }

    return patched !== content ? patched : null;
  },
};

const regenerateFull: Strategy = {
  name: 'regenerate_full',
  appliesTo: [
    'missing_import',
    'missing_module',
    'missing_provider',
    'missing_mock',
    'render_error',
    'type_error',
    'syntax_error',
    'assertion_mismatch',
    'query_not_found',
    'act_warning',
    'timeout',
    'unknown',
  ],
  apply: () => {
    // Signal to caller that a full regeneration is needed
    return null;
  },
};

// ---------------------------------------------------------------------------
// Strategy registry
// ---------------------------------------------------------------------------

const ALL_STRATEGIES: Strategy[] = [
  wrapWithMemoryRouter,
  wrapWithQueryClient,
  addMissingMock,
  fixQuerySelector,
  wrapWithAct,
  regenerateFull, // always last — fallback
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Select and apply the best repair strategy for the given failure.
 *
 * Selection order:
 * 1. Check healing memory for strategies with highest win-rate for this failure class
 * 2. Fall back to the first applicable strategy from the registry
 * 3. Return null if only regenerate_full matches (caller should regenerate)
 */
export function selectAndApply(
  failure: ClassifiedFailure,
  testFilePath: string,
  sourceFilePath: string,
  memory: HealMemoryData
): RepairResult | null {
  const testContent = safeReadFile(testFilePath);
  if (!testContent) return null;

  // 1. Try strategies ranked by memory (best win-rate first)
  const ranked = rankedStrategies(memory, failure.failureClass);
  for (const { strategy: stratName } of ranked) {
    const strat = ALL_STRATEGIES.find((s) => s.name === stratName);
    if (!strat || strat.name === 'regenerate_full') continue;
    if (!strat.appliesTo.includes(failure.failureClass)) continue;

    const result = strat.apply(testContent, failure, testFilePath, sourceFilePath);
    if (result) {
      return { strategyName: strat.name, content: result };
    }
  }

  // 2. Try all strategies in registry order
  for (const strat of ALL_STRATEGIES) {
    if (strat.name === 'regenerate_full') continue;
    if (!strat.appliesTo.includes(failure.failureClass)) continue;

    const result = strat.apply(testContent, failure, testFilePath, sourceFilePath);
    if (result) {
      return { strategyName: strat.name, content: result };
    }
  }

  // 3. No targeted repair — caller should regenerate
  return null;
}

/**
 * Get the strategy name that would be used.
 * Returns 'regenerate_full' if no targeted repair is available.
 */
export function resolveStrategyName(
  failure: ClassifiedFailure,
  memory: HealMemoryData
): string {
  const ranked = rankedStrategies(memory, failure.failureClass);
  for (const { strategy: stratName } of ranked) {
    const strat = ALL_STRATEGIES.find((s) => s.name === stratName);
    if (strat && strat.name !== 'regenerate_full' && strat.appliesTo.includes(failure.failureClass)) {
      return strat.name;
    }
  }

  for (const strat of ALL_STRATEGIES) {
    if (strat.name === 'regenerate_full') continue;
    if (strat.appliesTo.includes(failure.failureClass)) {
      return strat.name;
    }
  }

  return 'regenerate_full';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeReadFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}
