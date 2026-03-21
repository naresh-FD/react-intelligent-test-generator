/**
 * Maps canonical IssueType to deterministic repair strategies.
 *
 * Each repair either:
 * - Directly modifies the test file content (string manipulation)
 * - Returns a generator patch hint for regeneration
 *
 * Strategies are deterministic — given the same issue + test content,
 * they produce the same repair.
 */

import type { IssueType } from '../types';
import type { ClassifiedIssue } from '../validation/issueClassifier';
import {
  insertStatementAfterImports,
  insertSetupSnippet,
  wrapFirstRenderArgument,
  normalizeRelativeImportSpecifiers,
  upgradeFirstScreenQueryToFindBy,
  ensureAsyncTestCallback,
} from '../selfHeal/repairs/utils';

export interface RepairAttemptResult {
  applied: boolean;
  strategyId: string;
  reason: string;
  updatedContent?: string;
}

type RepairFn = (issue: ClassifiedIssue, testContent: string, sourceFilePath: string) => RepairAttemptResult;

const REPAIR_STRATEGIES: Record<IssueType, RepairFn> = {
  MISSING_PROVIDER: repairMissingProvider,
  INVALID_PROVIDER_ORDER: repairInvalidProviderOrder,
  BROKEN_IMPORT: repairBrokenImport,
  MISSING_EXPORT: repairMissingExport,
  INVALID_COMPONENT_SYMBOL: repairInvalidComponentSymbol,
  MOCK_MODULE_NOT_FOUND: repairMockModuleNotFound,
  MOCK_EXPORT_MISMATCH: repairMockExportMismatch,
  SERVICE_NOT_MOCKED: repairServiceNotMocked,
  JEST_DOM_MISSING: repairJestDomMissing,
  TYPE_ASSERTION_MISMATCH: repairTypeAssertionMismatch,
  ASYNC_QUERY_MISMATCH: repairAsyncQueryMismatch,
  ACT_WARNING_PATTERN: repairActWarning,
  UNSAFE_UNDEFINED_ACCESS: repairUnsafeUndefinedAccess,
  OVER_SKIPPED_TEST: noRepair,
  EARLY_LOOP_TERMINATION: noRepair,
  UNKNOWN: noRepair,
};

/**
 * Map a classified issue to a repair strategy and attempt to apply it.
 */
export function mapIssueToRepairStrategy(
  issue: ClassifiedIssue,
  testContent: string,
  sourceFilePath: string,
): RepairAttemptResult {
  const strategy = REPAIR_STRATEGIES[issue.issueType];
  return strategy(issue, testContent, sourceFilePath);
}

// ---------------------------------------------------------------------------
// Individual repair strategies
// ---------------------------------------------------------------------------

function repairMissingProvider(issue: ClassifiedIssue, testContent: string, _sourceFilePath: string): RepairAttemptResult {
  const evidence = issue.evidence.toLowerCase();

  // Router missing
  if (/router|usenavigate|uselocation|usehref|useroutes|useparams/i.test(evidence)) {
    const importStatement = `import { MemoryRouter } from 'react-router-dom';`;
    let updated = insertStatementAfterImports(testContent, importStatement);
    const wrapped = wrapFirstRenderArgument(updated, [
      { opening: '<MemoryRouter>', closing: '</MemoryRouter>' },
    ]);
    if (wrapped && wrapped !== testContent) {
      return { applied: true, strategyId: 'fix-missing-router', reason: 'Added MemoryRouter wrapper', updatedContent: wrapped };
    }
  }

  // QueryClient missing
  if (/queryclient|react-query|usequery|usemutation/i.test(evidence)) {
    const importStatement = `import { QueryClient, QueryClientProvider } from '@tanstack/react-query';`;
    let updated = insertStatementAfterImports(testContent, importStatement);
    updated = insertSetupSnippet(updated, `const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });`);
    const wrapped = wrapFirstRenderArgument(updated, [
      { opening: '<QueryClientProvider client={queryClient}>', closing: '</QueryClientProvider>' },
    ]);
    if (wrapped && wrapped !== testContent) {
      return { applied: true, strategyId: 'fix-missing-query-client', reason: 'Added QueryClientProvider wrapper', updatedContent: wrapped };
    }
  }

  // Redux store missing
  if (/redux|useSelector|useDispatch|store/i.test(evidence)) {
    const importStatement = `import { Provider as ReduxProvider } from 'react-redux';`;
    let updated = insertStatementAfterImports(testContent, importStatement);
    updated = insertSetupSnippet(updated, `const mockStore = { getState: () => ({}), subscribe: () => () => undefined, dispatch: () => undefined };`);
    const wrapped = wrapFirstRenderArgument(updated, [
      { opening: '<ReduxProvider store={mockStore as any}>', closing: '</ReduxProvider>' },
    ]);
    if (wrapped && wrapped !== testContent) {
      return { applied: true, strategyId: 'fix-missing-redux', reason: 'Added Redux Provider wrapper', updatedContent: wrapped };
    }
  }

  // Generic context provider missing — extract provider name from error
  const providerMatch = issue.evidence.match(/must be used within (?:a |an )?<?(\w+Provider?)>?/i)
    ?? issue.evidence.match(/use(\w+)\(\) must be used within/i);
  if (providerMatch) {
    const hookOrProvider = providerMatch[1];
    // Can't do a deterministic fix without knowing the import path
    return { applied: false, strategyId: 'fix-missing-context-provider', reason: `Context provider "${hookOrProvider}" needed but import path unknown — requires regeneration` };
  }

  return { applied: false, strategyId: 'fix-missing-provider', reason: 'Could not determine which provider is missing' };
}

function repairInvalidProviderOrder(_issue: ClassifiedIssue, _testContent: string, _sourceFilePath: string): RepairAttemptResult {
  // Provider order issues typically require regeneration with the correct order
  return { applied: false, strategyId: 'fix-provider-order', reason: 'Provider order issues require regeneration with correct nesting' };
}

function repairBrokenImport(issue: ClassifiedIssue, testContent: string, _sourceFilePath: string): RepairAttemptResult {
  // First try normalizing relative import paths
  const normalized = normalizeRelativeImportSpecifiers(testContent);
  if (normalized !== testContent) {
    return { applied: true, strategyId: 'fix-import-normalization', reason: 'Normalized relative import paths', updatedContent: normalized };
  }

  // Extract the broken module path
  const moduleMatch = issue.evidence.match(/Cannot find module ['"]([^'"]+)['"]/i)
    ?? issue.evidence.match(/Module not found.*['"]([^'"]+)['"]/i);
  if (moduleMatch) {
    const brokenModule = moduleMatch[1];
    // Remove the broken import line
    const importPattern = new RegExp(`^import .*['"]${escapeRegex(brokenModule)}['"];?\n?`, 'gm');
    const cleaned = testContent.replace(importPattern, '');
    // Also remove any jest.mock referencing it
    const mockPattern = new RegExp(`(?:jest|vi)\\.mock\\(['"]${escapeRegex(brokenModule)}['"][\\s\\S]*?\\);?\n?`, 'g');
    const fullyClean = cleaned.replace(mockPattern, '');
    if (fullyClean !== testContent) {
      return { applied: true, strategyId: 'fix-broken-import-removal', reason: `Removed unresolvable import "${brokenModule}"`, updatedContent: fullyClean };
    }
  }

  return { applied: false, strategyId: 'fix-broken-import', reason: 'Could not identify or fix the broken import' };
}

function repairMissingExport(issue: ClassifiedIssue, testContent: string, _sourceFilePath: string): RepairAttemptResult {
  // Extract the missing export name
  const exportMatch = issue.evidence.match(/No ['"](\w+)['"] export/i)
    ?? issue.evidence.match(/does not provide an export named ['"](\w+)['"]/i)
    ?? issue.evidence.match(/['"](\w+)['"] is not exported from/i);

  if (exportMatch) {
    const exportName = exportMatch[1];
    // Remove references to this export from import lines
    const importPattern = new RegExp(`(import\\s*\\{[^}]*)\\b${escapeRegex(exportName)}\\b,?\\s*([^}]*\\})`, 'g');
    let updated = testContent.replace(importPattern, (_match, before: string, after: string) => {
      const cleaned = `${before}${after}`.replace(/,\s*,/g, ',').replace(/{\s*,/g, '{').replace(/,\s*}/g, '}').replace(/{\s*}/g, '{ }');
      return cleaned;
    });
    if (updated !== testContent) {
      return { applied: true, strategyId: 'fix-missing-export', reason: `Removed non-existent export "${exportName}" from import`, updatedContent: updated };
    }
  }

  return { applied: false, strategyId: 'fix-missing-export', reason: 'Could not identify the missing export' };
}

function repairInvalidComponentSymbol(issue: ClassifiedIssue, testContent: string, sourceFilePath: string): RepairAttemptResult {
  // Extract the undefined symbol from ReferenceError
  const symbolMatch = issue.evidence.match(/ReferenceError:\s*(\w+)\s*is not defined/i);
  if (symbolMatch) {
    const symbol = symbolMatch[1];
    const jsxPattern = new RegExp(`<${escapeRegex(symbol)}[^>]*(?:/>|>[\\s\\S]*?</${escapeRegex(symbol)}>)`, 'g');
    const updated = testContent.replace(jsxPattern, '<div />');
    if (updated !== testContent) {
      return { applied: true, strategyId: 'fix-invalid-symbol', reason: `Replaced undefined symbol "${symbol}" with placeholder`, updatedContent: updated };
    }
  }

  // Handle "Objects are not valid as a React child" — usually a broken framer-motion mock
  if (/Objects are not valid as a React child/i.test(issue.rawErrorExcerpt)) {
    // Fix: replace the motion proxy mock that returns plain objects with one that returns React elements
    const brokenMotionPattern = /motion:\s*new Proxy\(\{\},\s*\{[\s\S]*?\}\s*\)/;
    if (brokenMotionPattern.test(testContent)) {
      // Replace with a simpler forward-ref approach using React.createElement
      const fixedMotion = `motion: new Proxy({}, {
    get: (_target: unknown, prop: string) => {
      const Component = require("react").forwardRef((props: Record<string, unknown>, ref: unknown) => {
        const { children, ...rest } = props;
        return require("react").createElement(prop, { ...rest, ref }, children);
      });
      Component.displayName = \`motion.\${prop}\`;
      return Component;
    },
  })`;
      const updated = testContent.replace(brokenMotionPattern, fixedMotion);
      if (updated !== testContent) {
        return { applied: true, strategyId: 'fix-framer-motion-mock', reason: 'Fixed framer-motion mock to return React elements instead of plain objects', updatedContent: updated };
      }
    }
  }

  // Handle "Element type is invalid" — likely a default vs named export mismatch
  if (/Element type is invalid.*expected a string.*but got.*undefined/i.test(issue.rawErrorExcerpt)) {
    const fs = require('node:fs');
    const path = require('node:path');
    // Check if the source component uses default export
    let sourceContent = '';
    try { sourceContent = fs.readFileSync(sourceFilePath, 'utf8'); } catch { /* skip */ }

    const hasDefaultExport = /export default\b/.test(sourceContent);
    const componentName = path.basename(sourceFilePath, path.extname(sourceFilePath));

    if (hasDefaultExport) {
      // Fix: convert named import to default import
      const namedImportPattern = new RegExp(
        `import\\s*\\{\\s*${escapeRegex(componentName)}\\s*\\}\\s*from\\s*(['"][^'"]+['"])`,
      );
      if (namedImportPattern.test(testContent)) {
        const updated = testContent.replace(namedImportPattern, `import ${componentName} from $1`);
        return { applied: true, strategyId: 'fix-invalid-symbol-default-export', reason: `Changed named import to default import for "${componentName}"`, updatedContent: updated };
      }
    } else {
      // Source uses named export — fix default import to named import
      const defaultImportPattern = new RegExp(
        `import\\s+${escapeRegex(componentName)}\\s+from\\s*(['"][^'"]+['"])`,
      );
      if (defaultImportPattern.test(testContent)) {
        const updated = testContent.replace(defaultImportPattern, `import { ${componentName} } from $1`);
        return { applied: true, strategyId: 'fix-invalid-symbol-named-export', reason: `Changed default import to named import for "${componentName}"`, updatedContent: updated };
      }
    }
  }

  return { applied: false, strategyId: 'fix-invalid-symbol', reason: 'Could not identify the invalid component symbol' };
}

function repairMockModuleNotFound(issue: ClassifiedIssue, testContent: string, _sourceFilePath: string): RepairAttemptResult {
  // Extract the module path
  const moduleMatch = issue.evidence.match(/Cannot find module ['"]([^'"]+)['"]/i);
  if (moduleMatch) {
    const modulePath = moduleMatch[1];
    // Remove the jest.mock for this module
    const mockPattern = new RegExp(`(?:jest|vi)\\.mock\\(['"]${escapeRegex(modulePath)}['"][\\s\\S]*?\\);?\n?`, 'g');
    const updated = testContent.replace(mockPattern, '');
    if (updated !== testContent) {
      return { applied: true, strategyId: 'fix-mock-module-not-found', reason: `Removed mock for unresolvable module "${modulePath}"`, updatedContent: updated };
    }
  }

  return { applied: false, strategyId: 'fix-mock-module-not-found', reason: 'Could not identify the mock module' };
}

function repairMockExportMismatch(issue: ClassifiedIssue, testContent: string, _sourceFilePath: string): RepairAttemptResult {
  // "Cannot access 'X' before initialization" — the mock variable isn't hoisted
  // Jest only hoists variables starting with "mock" or "spy"
  const accessMatch = issue.evidence.match(/Cannot access ['"](\w+)['"] before initialization/i);
  if (accessMatch) {
    const varName = accessMatch[1];
    // If the variable doesn't start with 'mock', it won't be hoisted by jest
    if (!varName.startsWith('mock') && !varName.startsWith('spy')) {
      const newName = `mock${varName.charAt(0).toUpperCase()}${varName.slice(1)}`;
      const updated = testContent.replace(new RegExp(`\\b${escapeRegex(varName)}\\b`, 'g'), newName);
      if (updated !== testContent) {
        return { applied: true, strategyId: 'fix-mock-hoist', reason: `Renamed "${varName}" to "${newName}" for jest hoisting`, updatedContent: updated };
      }
    }
    // Variable already starts with 'mock' but still not hoisted — move declaration above jest.mock
    // This is a generator-level fix: the mock variable should be declared with jest.fn() before jest.mock
    return { applied: false, strategyId: 'fix-mock-export-mismatch', reason: `Variable "${varName}" is referenced before initialization in jest.mock factory — requires regeneration` };
  }

  // Out-of-scope variable in mock factory
  const scopeMatch = issue.evidence.match(/out-of-scope/i);
  if (scopeMatch) {
    return { applied: false, strategyId: 'fix-mock-scope', reason: 'Out-of-scope variable in jest.mock factory — requires regeneration with inline factories' };
  }

  return { applied: false, strategyId: 'fix-mock-export-mismatch', reason: 'Mock export shape mismatch requires regeneration with correct factory' };
}

function repairServiceNotMocked(issue: ClassifiedIssue, testContent: string, _sourceFilePath: string): RepairAttemptResult {
  // Extract the unmocked function name
  const fnMatch = issue.evidence.match(/(\w+)\.mock(?:Resolved|Rejected|Implementation|Return)Value/i)
    ?? issue.evidence.match(/Cannot read.*\(reading ['"]mock(?:Resolved|Rejected|Implementation|Return)Value.*['"].*(\w+)/i);

  if (fnMatch) {
    // Can't mock without knowing the module — needs regeneration
    return { applied: false, strategyId: 'fix-service-not-mocked', reason: `Service function "${fnMatch[1]}" needs mocking — requires regeneration` };
  }

  return { applied: false, strategyId: 'fix-service-not-mocked', reason: 'Service mock needed but function unknown' };
}

function repairJestDomMissing(_issue: ClassifiedIssue, testContent: string, _sourceFilePath: string): RepairAttemptResult {
  // Check if any jest-dom import exists
  if (testContent.includes('@testing-library/jest-dom')) {
    // Import exists but maybe wrong format
    return { applied: false, strategyId: 'fix-jest-dom', reason: 'jest-dom import exists but matchers not loading — may need setup file' };
  }

  const importStatement = `import '@testing-library/jest-dom';`;
  const updated = insertStatementAfterImports(testContent, importStatement);
  if (updated !== testContent) {
    return { applied: true, strategyId: 'fix-jest-dom-import', reason: 'Added jest-dom import', updatedContent: updated };
  }

  return { applied: false, strategyId: 'fix-jest-dom', reason: 'Could not add jest-dom import' };
}

function repairTypeAssertionMismatch(_issue: ClassifiedIssue, _testContent: string, _sourceFilePath: string): RepairAttemptResult {
  // Assertion mismatches are usually about logic, not fixable deterministically
  return { applied: false, strategyId: 'fix-type-assertion', reason: 'Assertion mismatch requires understanding expected behavior — needs regeneration' };
}

function repairAsyncQueryMismatch(_issue: ClassifiedIssue, testContent: string, _sourceFilePath: string): RepairAttemptResult {
  // Upgrade getBy to findBy
  const upgraded = upgradeFirstScreenQueryToFindBy(testContent);
  if (upgraded) {
    const withAsync = ensureAsyncTestCallback(upgraded);
    return { applied: true, strategyId: 'fix-async-query', reason: 'Upgraded getBy to findBy with async', updatedContent: withAsync };
  }

  return { applied: false, strategyId: 'fix-async-query', reason: 'No getBy query found to upgrade' };
}

function repairActWarning(_issue: ClassifiedIssue, testContent: string, _sourceFilePath: string): RepairAttemptResult {
  // Add waitFor import and wrap assertions
  if (!testContent.includes('waitFor')) {
    const importStatement = testContent.includes('@testing-library/react')
      ? null // Need to modify existing import
      : `import { waitFor } from '@testing-library/react';`;

    if (importStatement) {
      const updated = insertStatementAfterImports(testContent, importStatement);
      if (updated !== testContent) {
        return { applied: true, strategyId: 'fix-act-warning', reason: 'Added waitFor import for act warning', updatedContent: updated };
      }
    }

    // Add waitFor to existing RTL import
    const updated = testContent.replace(
      /import\s*\{([^}]*)\}\s*from\s*['"]@testing-library\/react['"]/,
      (match, imports: string) => {
        if (imports.includes('waitFor')) return match;
        return match.replace(imports, `${imports.trim()}, waitFor`);
      },
    );
    if (updated !== testContent) {
      return { applied: true, strategyId: 'fix-act-warning-import', reason: 'Added waitFor to RTL import', updatedContent: updated };
    }
  }

  return { applied: false, strategyId: 'fix-act-warning', reason: 'waitFor already imported — act warning may need structural fix' };
}

function repairUnsafeUndefinedAccess(issue: ClassifiedIssue, testContent: string, _sourceFilePath: string): RepairAttemptResult {
  // Extract the property being accessed on undefined
  const propMatch = issue.evidence.match(/Cannot read propert(?:y|ies) of (?:undefined|null) \(reading ['"](\w+)['"]\)/i);
  if (propMatch) {
    const property = propMatch[1];
    // Look for mock return values that might be missing this property
    // Add a defensive default to hook factory if found
    const factoryPattern = /const create\w+ = \(overrides.*?\) => \(\{([\s\S]*?)\n\}\);/g;
    let updated = testContent;
    let match;
    while ((match = factoryPattern.exec(testContent)) !== null) {
      const factoryBody = match[1];
      if (!factoryBody.includes(property)) {
        // Add the missing property to the factory
        const newProperty = `  ${property}: undefined,`;
        const insertion = factoryBody.trimEnd() + '\n' + newProperty;
        updated = updated.replace(factoryBody, insertion);
      }
    }
    if (updated !== testContent) {
      return { applied: true, strategyId: 'fix-unsafe-access', reason: `Added missing property "${property}" to mock factory`, updatedContent: updated };
    }
  }

  return { applied: false, strategyId: 'fix-unsafe-access', reason: 'Could not identify the property causing undefined access' };
}

function noRepair(issue: ClassifiedIssue, _testContent: string, _sourceFilePath: string): RepairAttemptResult {
  return { applied: false, strategyId: 'no-repair', reason: `No deterministic repair for ${issue.issueType}` };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
