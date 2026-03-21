/**
 * Canonical types for the testgen pipeline.
 *
 * Architecture: analyze → plan → validate → emit → run → classify → heal → retry → learn
 *
 * Single source of truth:
 * - ComponentTestContext is the canonical analysis output
 * - TestPlan is the canonical validated plan consumed by emitters
 * - IssueType is the canonical failure taxonomy
 *
 * Emitters are dumb renderers — they consume validated plans and never invent
 * wrappers, imports, or mocks on their own.
 */

import type { ComponentInfo, ContextUsage, HookUsage } from './analyzer';

// ---------------------------------------------------------------------------
// Issue taxonomy — normalized failure classes
// ---------------------------------------------------------------------------

export const ISSUE_TYPES = [
  'MISSING_PROVIDER',
  'INVALID_PROVIDER_ORDER',
  'BROKEN_IMPORT',
  'MISSING_EXPORT',
  'INVALID_COMPONENT_SYMBOL',
  'MOCK_MODULE_NOT_FOUND',
  'MOCK_EXPORT_MISMATCH',
  'SERVICE_NOT_MOCKED',
  'JEST_DOM_MISSING',
  'TYPE_ASSERTION_MISMATCH',
  'ASYNC_QUERY_MISMATCH',
  'ACT_WARNING_PATTERN',
  'UNSAFE_UNDEFINED_ACCESS',
  'OVER_SKIPPED_TEST',
  'EARLY_LOOP_TERMINATION',
  'UNKNOWN',
] as const;

export type IssueType = typeof ISSUE_TYPES[number];

// ---------------------------------------------------------------------------
// Analysis output — canonical context for test generation
// ---------------------------------------------------------------------------

export interface ImportedSymbol {
  modulePath: string;
  symbolName: string;
  importKind: 'named' | 'default' | 'namespace';
  isResolvable: boolean;
}

export interface ProviderRequirement {
  providerName: string;
  importModulePath: string;
  importName: string;
  importKind: 'named' | 'default';
  source: 'hook-analysis' | 'context-usage' | 'framework-detection' | 'repair';
  valueExpression?: string;
  propsExpression?: string;
}

export interface ServiceDependency {
  modulePath: string;
  importedNames: string[];
  needsMock: boolean;
}

export interface PropsModel {
  required: Array<{ name: string; type: string; isCallback: boolean; isBoolean: boolean }>;
  optional: Array<{ name: string; type: string; isCallback: boolean; isBoolean: boolean }>;
}

/**
 * ComponentTestContext is the canonical analysis output.
 * It bridges the analyzer's ComponentInfo with the planning layer.
 * All planning decisions must derive from this context — no ad-hoc inference.
 */
export interface ComponentTestContext {
  componentPath: string;
  componentName: string;
  exportType: 'default' | 'named';
  importedSymbols: ImportedSymbol[];
  usedHooks: HookUsage[];
  requiredProviders: ProviderRequirement[];
  serviceDependencies: ServiceDependency[];
  contexts: ContextUsage[];
  propsModel: PropsModel;
  stateRiskFlags: string[];
  asyncRiskFlags: string[];
  componentInfo: ComponentInfo;
}

// ---------------------------------------------------------------------------
// Validated plan — consumed by emitters
// ---------------------------------------------------------------------------

export interface ValidatedImport {
  modulePath: string;
  importKind: 'named' | 'default' | 'namespace' | 'side-effect';
  symbolName?: string;
  alias?: string;
  /** True only after pre-emit validation confirmed this import is needed and consistent */
  validated: boolean;
}

export interface ValidatedProvider {
  key: string;
  wrapperExpression: string;
  importModulePath: string;
  importKind: 'named' | 'default';
  importName: string;
  importAlias?: string;
  valueExpression?: string;
  propsExpression?: string;
  source: 'context' | 'framework' | 'repair';
  /** True only when the import for this provider exists in the validated import plan */
  importVerified: boolean;
}

export interface ValidatedMock {
  modulePath: string;
  declarations: string[];
  statement: string;
  beforeEachLines: string[];
  /** True only when the mock module path is resolvable */
  verified: boolean;
}

/**
 * ValidationResult captures what the pre-emit validator found.
 * Providers/imports that failed validation are stripped from the plan.
 */
export interface ValidationResult {
  valid: boolean;
  strippedProviders: Array<{ key: string; reason: string }>;
  strippedImports: Array<{ symbolName: string; reason: string }>;
  strippedMocks: Array<{ modulePath: string; reason: string }>;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Learning dataset record
// ---------------------------------------------------------------------------

export interface LearningRecord {
  issue_type: IssueType;
  error_signature: string;
  raw_error_excerpt: string;
  root_cause: string;
  detection_signals: string[];
  analysis_context: Record<string, unknown>;
  fix_strategy: string;
  fix_actions: string[];
  verification: { passed: boolean; tests_run: number; tests_failed: number };
  generalizable_rule: string;
  timestamp: string;
}
