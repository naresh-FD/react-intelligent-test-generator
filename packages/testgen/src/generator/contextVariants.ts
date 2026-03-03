/**
 * Context-driven variant test generation.
 *
 * Generates tests that toggle context values to cover branches:
 * - Boolean toggles: isAuthenticated true/false
 * - Null toggles: user null vs mock object
 * - Array toggles: items [] vs [{ id: "1" }]
 *
 * Only generates variants for keys that are actually consumed by the component.
 */
import { ComponentInfo } from '../analyzer';
import { ContextMockValue } from './contextValues';

export interface ContextVariantTest {
  title: string;
  body: string[];
}

/**
 * Generate test cases that toggle context values to cover branches.
 * Each test renders the component with a modified context value.
 */
export function buildContextVariantTests(
  component: ComponentInfo,
  contextMocks: ContextMockValue[]
): ContextVariantTest[] {
  const tests: ContextVariantTest[] = [];

  for (const ctx of component.contexts) {
    const mock = contextMocks.find((m) => m.importName === ctx.contextName);
    if (!mock) continue;

    // Generate variants for each consumed key
    for (const key of ctx.consumedKeys) {
      const variants = generateKeyVariants(key, ctx.contextName, mock.mockVarName);
      tests.push(...variants);
    }

    // If no consumed keys are known, generate a generic "renders with context" test
    if (ctx.consumedKeys.length === 0) {
      tests.push({
        title: `renders with ${ctx.contextName} context`,
        body: [
          'const { container } = renderUI();',
          'expect(container).toBeInTheDocument();',
        ],
      });
    }
  }

  return tests;
}

/**
 * Generate variant tests for a specific context key.
 * Returns 0-2 tests depending on the inferred type of the key.
 */
function generateKeyVariants(
  key: string,
  contextName: string,
  mockVarName: string
): ContextVariantTest[] {
  const tests: ContextVariantTest[] = [];
  const contextBase = contextName.replace(/Context$/, '');

  // Boolean-like keys: generate true/false variants
  if (isBooleanLikeKey(key)) {
    tests.push({
      title: `renders when ${key} is true`,
      body: buildContextOverrideTest(contextName, mockVarName, key, 'true'),
    });
    tests.push({
      title: `renders when ${key} is false`,
      body: buildContextOverrideTest(contextName, mockVarName, key, 'false'),
    });
    return tests;
  }

  // Nullable-like keys (user, session, profile, error, token)
  if (isNullableLikeKey(key)) {
    tests.push({
      title: `renders when ${key} is null`,
      body: buildContextOverrideTest(contextName, mockVarName, key, 'null'),
    });
    tests.push({
      title: `renders when ${key} is provided`,
      body: buildContextOverrideTest(contextName, mockVarName, key, getMockValueForKey(key)),
    });
    return tests;
  }

  // Array-like keys (items, expenses, notifications, etc.)
  if (isArrayLikeKey(key)) {
    tests.push({
      title: `renders with empty ${key}`,
      body: buildContextOverrideTest(contextName, mockVarName, key, '[]'),
    });
    tests.push({
      title: `renders with ${key} data`,
      body: buildContextOverrideTest(contextName, mockVarName, key, getArrayMockForKey(key)),
    });
    return tests;
  }

  // Function-like keys: verify the function was called or can be invoked
  if (isFunctionLikeKey(key)) {
    tests.push({
      title: `provides ${key} function via context`,
      body: [
        'const { container } = renderUI();',
        'expect(container).toBeInTheDocument();',
        `// ${key} is provided via ${contextBase} context`,
      ],
    });
    return tests;
  }

  return tests;
}

function buildContextOverrideTest(
  _contextName: string,
  mockVarName: string,
  key: string,
  value: string
): string[] {
  // Override the mock value before rendering. renderUI() references the mock variable
  // by name, so we mutate it temporarily and restore after.
  return [
    `const original_${key} = ${mockVarName}.${key};`,
    `${mockVarName}.${key} = ${value};`,
    'try {',
    '  const { container } = renderUI();',
    '  expect(container).toBeInTheDocument();',
    '} finally {',
    `  ${mockVarName}.${key} = original_${key};`,
    '}',
  ];
}

function isBooleanLikeKey(key: string): boolean {
  return (
    /^(is|has|show|can|should|was|did|will|needs)[A-Z]/.test(key) ||
    /^(loading|pending|fetching|submitting|processing|busy|disabled|readonly|active|open|visible|checked|selected|expanded|hidden|authenticated|error|failed|invalid|locked|enabled|ready|connected|initialized|mounted|dirty|pristine|touched|valid)$/i.test(key)
  );
}

function isNullableLikeKey(key: string): boolean {
  return /^(user|currentUser|profile|session|token|account|error|errorMessage|data|result|response|theme|config|settings)$/i.test(key);
}

function isArrayLikeKey(key: string): boolean {
  const matchesKnownArrayName = /^(items|data|list|rows|results|records|entries|expenses|budgets|categories|transactions|notifications|messages|users|options|columns|tabs|filters)$/i.test(key);
  if (matchesKnownArrayName) return true;
  // Plural names that aren't boolean/function/nullable are likely arrays
  return key.endsWith('s') && !isBooleanLikeKey(key) && !isFunctionLikeKey(key) && !isNullableLikeKey(key);
}

function isFunctionLikeKey(key: string): boolean {
  return (
    /^(on|handle|set|update|change|toggle|add|remove|delete|clear|fetch|load|save|login|logout|register|create|edit|submit|dispatch|notify|reset|get|post|put|patch|send|emit|trigger|fire)[A-Z]/.test(key)
  );
}

function getMockValueForKey(key: string): string {
  if (/user|currentUser|profile|account/i.test(key)) {
    return '{ id: "1", name: "Test User", email: "test@example.com" }';
  }
  if (/session|token/i.test(key)) return '"test-token"';
  if (/error|errorMessage/i.test(key)) return '{ message: "Test error" }';
  if (/theme/i.test(key)) return '"light"';
  if (/config|settings/i.test(key)) return '{}';
  if (/data|result|response/i.test(key)) return '{}';
  return '"test-value"';
}

function getArrayMockForKey(key: string): string {
  if (/expense/i.test(key)) {
    return '[{ id: "1", description: "Test Expense", amount: 100, date: "2024-01-01" }]';
  }
  if (/budget/i.test(key)) {
    return '[{ id: "1", categoryId: "cat-1", amount: 1000, spent: 0 }]';
  }
  if (/categor/i.test(key)) {
    return '[{ id: "cat-1", name: "Food", color: "#000" }]';
  }
  if (/transaction/i.test(key)) {
    return '[{ id: "1", description: "Test", amount: 100, date: "2024-01-01" }]';
  }
  if (/notification|message/i.test(key)) {
    return '[{ id: "1", message: "Test notification", type: "info" }]';
  }
  if (/user/i.test(key)) {
    return '[{ id: "1", name: "Test User", email: "test@example.com" }]';
  }
  return '[{ id: "1" }]';
}
