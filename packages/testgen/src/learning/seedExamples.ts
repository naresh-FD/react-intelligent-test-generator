/**
 * Seed examples — hand-written baseline dataset records for the
 * 10 most common issue classes.
 *
 * These provide initial training data before any real runs have
 * accumulated records, and serve as reference for the expected
 * record structure.
 */

import type { IssueDatasetRecord } from './issueDatasetWriter';

export function getSeedExamples(): IssueDatasetRecord[] {
  return [
    // 1. Missing provider
    {
      id: 'seed_000001',
      timestamp: '2026-03-21T00:00:00Z',
      component_path: 'src/components/Dashboard/index.tsx',
      test_path: 'src/components/Dashboard/__tests__/index.test.tsx',
      phase: 'runtime',
      issue_type: 'MISSING_PROVIDER',
      severity: 'high',
      error_signature: 'useAuth must be used within AuthProvider',
      raw_error_excerpt: 'Error: useAuth must be used within an AuthProvider. Wrap your component tree with <AuthProvider>.',
      root_cause: 'Component uses useAuth hook but generated render tree omitted AuthProvider',
      detection_signals: ['issue_type:MISSING_PROVIDER', 'hook_related', 'provider_related', 'high_confidence'],
      analysis_context: { used_hooks: ['useAuth', 'useNavigate'], required_providers: ['MemoryRouter', 'AuthProvider'], existing_wrappers: ['MemoryRouter'] },
      fix_strategy: 'ADD_REQUIRED_PROVIDER',
      fix_actions: ['add AuthProvider import', 'wrap component with AuthProvider in render helper'],
      verification: { jest_passed: true, retry_count: 1, tests_run: 5, tests_failed: 0, coverage: 72 },
      generalizable_rule: 'If a hook requires a provider, the generator must include that provider in the wrapper plan before emitting JSX.',
    },

    // 2. Invalid provider order
    {
      id: 'seed_000002',
      timestamp: '2026-03-21T00:00:00Z',
      component_path: 'src/components/Settings/index.tsx',
      test_path: 'src/components/Settings/__tests__/index.test.tsx',
      phase: 'runtime',
      issue_type: 'INVALID_PROVIDER_ORDER',
      severity: 'high',
      error_signature: 'useTheme must be used within ThemeProvider',
      raw_error_excerpt: 'Error: useTheme must be used within ThemeProvider. ThemeProvider was present but nested inside a component that depends on it.',
      root_cause: 'ThemeProvider nested inside NotificationProvider which depends on theme context',
      detection_signals: ['issue_type:INVALID_PROVIDER_ORDER', 'provider_related', 'high_confidence'],
      analysis_context: { provider_order: ['NotificationProvider', 'ThemeProvider'], correct_order: ['ThemeProvider', 'NotificationProvider'] },
      fix_strategy: 'REORDER_PROVIDERS',
      fix_actions: ['reorder provider nesting: ThemeProvider → NotificationProvider → Component'],
      verification: { jest_passed: true, retry_count: 1, tests_run: 4, tests_failed: 0, coverage: 65 },
      generalizable_rule: 'Providers must be nested according to their dependency graph.',
    },

    // 3. Broken import (skipped import still emitted in JSX)
    {
      id: 'seed_000003',
      timestamp: '2026-03-21T00:00:00Z',
      component_path: 'src/components/Chart/index.tsx',
      test_path: 'src/components/Chart/__tests__/index.test.tsx',
      phase: 'typecheck',
      issue_type: 'BROKEN_IMPORT',
      severity: 'critical',
      error_signature: "Cannot find module '@/utils/chartHelpers'",
      raw_error_excerpt: "Cannot find module '@/utils/chartHelpers' from 'src/components/Chart/__tests__/index.test.tsx'",
      root_cause: 'Import path uses alias that does not resolve in test context',
      detection_signals: ['issue_type:BROKEN_IMPORT', 'import_related', 'high_confidence'],
      analysis_context: { import_path: '@/utils/chartHelpers', resolved: false },
      fix_strategy: 'NORMALIZE_IMPORT_PATH',
      fix_actions: ['replace alias with relative path', 'verify module resolves'],
      verification: { jest_passed: true, retry_count: 1, tests_run: 3, tests_failed: 0, coverage: 58 },
      generalizable_rule: 'Every import path emitted must be verified to resolve before emission.',
    },

    // 4. Missing export (default vs named import mismatch)
    {
      id: 'seed_000004',
      timestamp: '2026-03-21T00:00:00Z',
      component_path: 'src/components/UserProfile/index.tsx',
      test_path: 'src/components/UserProfile/__tests__/index.test.tsx',
      phase: 'typecheck',
      issue_type: 'MISSING_EXPORT',
      severity: 'critical',
      error_signature: "'UserProfile' is not exported from '../UserProfile'",
      raw_error_excerpt: "SyntaxError: The requested module '../UserProfile' does not provide an export named 'UserProfile'. It only has a default export.",
      root_cause: 'Generator used named import but component uses default export',
      detection_signals: ['issue_type:MISSING_EXPORT', 'import_related', 'high_confidence'],
      analysis_context: { expected_export: 'named', actual_export: 'default' },
      fix_strategy: 'FIX_IMPORT_STYLE',
      fix_actions: ['change from named to default import'],
      verification: { jest_passed: true, retry_count: 1, tests_run: 6, tests_failed: 0, coverage: 70 },
      generalizable_rule: 'Import symbols must match the actual exports of the target module.',
    },

    // 5. Module not found in mock
    {
      id: 'seed_000005',
      timestamp: '2026-03-21T00:00:00Z',
      component_path: 'src/components/PaymentForm/index.tsx',
      test_path: 'src/components/PaymentForm/__tests__/index.test.tsx',
      phase: 'typecheck',
      issue_type: 'MOCK_MODULE_NOT_FOUND',
      severity: 'critical',
      error_signature: "Cannot find module '@/services/paymentApi'",
      raw_error_excerpt: "Cannot find module '@/services/paymentApi' from 'src/components/PaymentForm/__tests__/index.test.tsx'. jest.mock('@/services/paymentApi') references a non-existent module.",
      root_cause: 'jest.mock() uses alias path that does not resolve',
      detection_signals: ['issue_type:MOCK_MODULE_NOT_FOUND', 'mock_related', 'high_confidence'],
      analysis_context: { mock_path: '@/services/paymentApi', resolved: false },
      fix_strategy: 'FIX_MOCK_MODULE_PATH',
      fix_actions: ['replace alias with relative path in jest.mock()'],
      verification: { jest_passed: true, retry_count: 1, tests_run: 4, tests_failed: 0, coverage: 62 },
      generalizable_rule: 'jest.mock() module paths must resolve to existing modules.',
    },

    // 6. Mock export shape mismatch
    {
      id: 'seed_000006',
      timestamp: '2026-03-21T00:00:00Z',
      component_path: 'src/components/Header/index.tsx',
      test_path: 'src/components/Header/__tests__/index.test.tsx',
      phase: 'runtime',
      issue_type: 'MOCK_EXPORT_MISMATCH',
      severity: 'high',
      error_signature: "Cannot access 'mockUseAuth' before initialization",
      raw_error_excerpt: "ReferenceError: Cannot access 'mockUseAuth' before initialization. The mock factory references a variable declared after jest.mock() which is hoisted.",
      root_cause: 'jest.mock() factory references a const variable that is in the temporal dead zone when the factory runs',
      detection_signals: ['issue_type:MOCK_EXPORT_MISMATCH', 'mock_related', 'high_confidence'],
      analysis_context: { variable: 'mockUseAuth', hoisting_issue: true },
      fix_strategy: 'FIX_MOCK_HOISTING',
      fix_actions: ['use arrow wrapper in mock factory to defer variable access'],
      verification: { jest_passed: true, retry_count: 1, tests_run: 8, tests_failed: 0, coverage: 75 },
      generalizable_rule: 'Mock factories must not reference variables outside their scope. Use inline values or arrow wrappers.',
    },

    // 7. Missing jest-dom
    {
      id: 'seed_000007',
      timestamp: '2026-03-21T00:00:00Z',
      component_path: 'src/components/Button/index.tsx',
      test_path: 'src/components/Button/__tests__/index.test.tsx',
      phase: 'assertion',
      issue_type: 'JEST_DOM_MISSING',
      severity: 'medium',
      error_signature: 'toBeInTheDocument is not a function',
      raw_error_excerpt: "TypeError: expect(...).toBeInTheDocument is not a function. The jest-dom matchers are not available because the setup import is missing.",
      root_cause: 'Test uses jest-dom matchers but @testing-library/jest-dom setup import is missing',
      detection_signals: ['issue_type:JEST_DOM_MISSING', 'high_confidence'],
      analysis_context: { missing_import: '@testing-library/jest-dom' },
      fix_strategy: 'ADD_JEST_DOM_IMPORT',
      fix_actions: ['add import "@testing-library/jest-dom" at top of test file'],
      verification: { jest_passed: true, retry_count: 1, tests_run: 3, tests_failed: 0, coverage: 80 },
      generalizable_rule: 'Always include jest-dom setup import when generating DOM matchers.',
    },

    // 8. Async query mismatch
    {
      id: 'seed_000008',
      timestamp: '2026-03-21T00:00:00Z',
      component_path: 'src/components/DataTable/index.tsx',
      test_path: 'src/components/DataTable/__tests__/index.test.tsx',
      phase: 'assertion',
      issue_type: 'ASYNC_QUERY_MISMATCH',
      severity: 'medium',
      error_signature: 'Unable to find an element with the text: Loading',
      raw_error_excerpt: 'TestingLibraryElementError: Unable to find an element with the text: Loading. The content appears asynchronously but getByText was used instead of findByText.',
      root_cause: 'Async content queried with synchronous getBy instead of findBy',
      detection_signals: ['issue_type:ASYNC_QUERY_MISMATCH', 'high_confidence'],
      analysis_context: { query_used: 'getByText', should_use: 'findByText' },
      fix_strategy: 'REPLACE_WITH_ASYNC_QUERY',
      fix_actions: ['replace getByText with findByText', 'add await to query call'],
      verification: { jest_passed: true, retry_count: 1, tests_run: 5, tests_failed: 0, coverage: 68 },
      generalizable_rule: 'Use findBy/waitFor for async content, not getBy.',
    },

    // 9. Unsafe undefined access from incomplete mock
    {
      id: 'seed_000009',
      timestamp: '2026-03-21T00:00:00Z',
      component_path: 'src/components/ExpenseList/index.tsx',
      test_path: 'src/components/ExpenseList/__tests__/index.test.tsx',
      phase: 'runtime',
      issue_type: 'UNSAFE_UNDEFINED_ACCESS',
      severity: 'medium',
      error_signature: "Cannot read properties of undefined (reading 'map')",
      raw_error_excerpt: "TypeError: Cannot read properties of undefined (reading 'map'). Component calls data.expenses.map() but mock returned { data: {} } without expenses array.",
      root_cause: 'Mock return value missing nested property that component accesses',
      detection_signals: ['issue_type:UNSAFE_UNDEFINED_ACCESS', 'mock_related', 'high_confidence'],
      analysis_context: { property_chain: 'data.expenses.map', mock_shape: { data: {} } },
      fix_strategy: 'ADD_MISSING_MOCK_PROPERTY',
      fix_actions: ['add expenses: [] to mock return value'],
      verification: { jest_passed: true, retry_count: 1, tests_run: 4, tests_failed: 0, coverage: 60 },
      generalizable_rule: 'Mock return values must include all properties the component accesses.',
    },

    // 10. Early loop termination
    {
      id: 'seed_000010',
      timestamp: '2026-03-21T00:00:00Z',
      component_path: 'src/components/Analytics/index.tsx',
      test_path: 'src/components/Analytics/__tests__/index.test.tsx',
      phase: 'generation',
      issue_type: 'EARLY_LOOP_TERMINATION',
      severity: 'low',
      error_signature: 'Retry loop stopped with 2 failures remaining',
      raw_error_excerpt: 'Healing loop terminated after 1 retry with 2/5 tests still failing. Budget was not exhausted.',
      root_cause: 'Loop exited prematurely while failures remained and retry budget was available',
      detection_signals: ['issue_type:EARLY_LOOP_TERMINATION'],
      analysis_context: { retries_used: 1, retries_available: 3, failures_remaining: 2 },
      fix_strategy: 'CONTINUE_LOOP',
      fix_actions: ['ensure loop continues while failures > 0 and budget > 0'],
      verification: { jest_passed: false, retry_count: 1, tests_run: 5, tests_failed: 2 },
      generalizable_rule: 'The healing loop must continue while failures remain.',
    },
  ];
}

/**
 * Write seed examples to the dataset file if it doesn't exist or is empty.
 */
export function writeSeedExamplesIfNeeded(): boolean {
  const fs = require('node:fs');
  const path = require('node:path');
  const dataDir = path.resolve(__dirname, '../../data/learning');
  const datasetPath = path.join(dataDir, 'issue-dataset.jsonl');

  // Only seed if the dataset doesn't exist or is empty
  if (fs.existsSync(datasetPath)) {
    const content = fs.readFileSync(datasetPath, 'utf8').trim();
    if (content.length > 0) return false;
  }

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const seeds = getSeedExamples();
  const lines = seeds.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(datasetPath, lines, 'utf8');
  return true;
}
