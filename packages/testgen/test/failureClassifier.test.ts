import assert from 'node:assert/strict';
import {
  classifyFailure,
  detectFailureCategory,
  normalizeFailureText,
} from '../src/selfHeal/index';

function run(): void {
  const ansiPrefix = String.fromCharCode(27);
  const normalized = normalizeFailureText(
    '\u001b[31mError:\u001b[39m file:///Users/test/project/src/foo.test.ts:42:13\n' +
    'at C:\\repo\\packages\\app\\src\\foo.tsx:10:2   Unable   to   find role "button"'
  );
  assert.doesNotMatch(normalized, new RegExp(`${ansiPrefix}\\[`));
  assert.doesNotMatch(normalized, /file:\/\//i);
  assert.doesNotMatch(normalized, /C:\\repo/i);
  assert.doesNotMatch(normalized, /:42:13\b/);
  assert.match(normalized, /<path>/);
  assert.match(normalized, /:#:#/);

  const cases = [
    {
      name: 'missing jest-dom matcher',
      input: 'TypeError: expect(...).toBeInTheDocument is not a function',
      category: 'missing-jest-dom-matcher',
      evidence: /toBeInTheDocument is not a function/i,
    },
    {
      name: 'router missing',
      input: 'Error: useNavigate() may be used only in the context of a <Router> component.',
      category: 'router-missing',
      evidence: /useNavigate\(\) may be used only in the context of a <Router> component/i,
    },
    {
      name: 'query client missing',
      input: 'Error: No QueryClient set, use QueryClientProvider to set one',
      category: 'query-client-missing',
      evidence: /No QueryClient set/i,
    },
    {
      name: 'redux store missing',
      input: 'could not find react-redux context value; please ensure the component is wrapped in a <Provider>',
      category: 'redux-store-missing',
      evidence: /react-redux context value/i,
    },
    {
      name: 'generic provider missing',
      input: 'Error: useTheme must be used within ThemeProvider',
      category: 'missing-provider-wrapper',
      evidence: /must be used within ThemeProvider/i,
    },
    {
      name: 'hook context missing',
      input: "TypeError: Cannot destructure property 'user' of 'useAuth()' as it is undefined.",
      category: 'hook-context-missing',
      evidence: /Cannot destructure property 'user'/i,
    },
    {
      name: 'bad import resolution',
      input: "Cannot find module '../components/MissingWidget' from '<path>/Widget.test.tsx'",
      category: 'bad-import-resolution',
      evidence: /Cannot find module '\.\.\/components\/MissingWidget'/i,
    },
    {
      name: 'bad module mock',
      input: 'The module factory of `jest.mock()` is not allowed to reference any out-of-scope variables.',
      category: 'bad-module-mock',
      evidence: /module factory of `jest\.mock\(\)` is not allowed/i,
    },
    {
      name: 'non-existent export mock',
      input: '[vitest] No "useAuth" export is defined on the "../auth/useAuth" mock.',
      category: 'non-existent-export-mock',
      evidence: /No "useAuth" export is defined/i,
    },
    {
      name: 'async query mismatch',
      input: 'Timed out in waitFor after 1000ms.',
      category: 'async-query-mismatch',
      evidence: /Timed out in waitFor/i,
    },
    {
      name: 'selector too weak',
      input: 'If this is intentional, then use the *AllBy* variant of the query (like queryAllByText, getAllByText, or findAllByText).',
      category: 'selector-too-weak',
      evidence: /use the \*AllBy\* variant/i,
    },
    {
      name: 'multiple elements found',
      input: 'Found multiple elements with the role "button"',
      category: 'multiple-elements-found',
      evidence: /Found multiple elements with the role "button"/i,
    },
    {
      name: 'element not found',
      input: 'Unable to find an element with the text: Save changes.',
      category: 'element-not-found',
      evidence: /Unable to find an element with the text/i,
    },
    {
      name: 'event simulation mismatch',
      input: 'Unable to fire a "change" event - please provide a DOM element.',
      category: 'event-simulation-mismatch',
      evidence: /Unable to fire a "change" event/i,
    },
    {
      name: 'service mock missing',
      input: 'TypeError: apiClient.get.mockResolvedValue is not a function',
      category: 'service-mock-missing',
      evidence: /mockResolvedValue is not a function/i,
    },
    {
      name: 'unknown fallback',
      input: 'Something unexpected happened during test execution.',
      category: 'unknown',
      evidence: /Something unexpected happened during test execution/i,
    },
  ] as const;

  for (const testCase of cases) {
    const result = classifyFailure(testCase.input);
    assert.equal(result.category, testCase.category, testCase.name);
    assert.match(result.evidence, testCase.evidence, `${testCase.name} evidence`);
    if (testCase.category === 'unknown') {
      assert.equal(result.confidence, 0, `${testCase.name} confidence`);
    } else {
      assert.ok(result.confidence > 0.8, `${testCase.name} confidence`);
    }
    assert.match(result.fingerprint, new RegExp(`^${testCase.category}:`), `${testCase.name} fingerprint`);
  }

  assert.equal(
    detectFailureCategory('No QueryClient set, use QueryClientProvider to set one'),
    'query-client-missing',
  );

  console.log('Failure classifier checks passed');
}

run();
