import path from 'node:path';
import { Project, SourceFile, TypeChecker } from 'ts-morph';
import { ComponentInfo, ContextUsage } from '../analyzer';
import type { RepairPlan } from '../healer/knowledge-base';
import type { ReferenceObjectShape, ReferencePatternSummary } from '../repoPatterns';
import { mockGlobalName } from '../utils/framework';
import { relativeImport, resolveRenderHelper } from '../utils/path';
import { generateContextMockValue } from './contextValues';
import { EnvironmentPlan, planEnvironment, EnvironmentRequirement } from './environment';
import { MockModulePlan, SourceImportUsage, collectSourceImports, flattenHookMockPlans, planMockModules } from './mockRegistry';
import { buildDefaultProps } from './mocks';
import { buildComponentTestContext } from '../analysis/componentTestContext';
import type { ComponentTestContext } from '../types';

export interface ResolvedImportSymbol {
  modulePath: string;
  importKind: 'named' | 'default' | 'namespace' | 'side-effect';
  symbolName?: string;
  alias?: string;
}

export interface ProviderDescriptor {
  key: string;
  wrapperExpression: string;
  importModulePath?: string;
  importKind?: 'named' | 'default';
  importName?: string;
  importAlias?: string;
  valueExpression?: string;
  propsExpression?: string;
  validated: boolean;
  source: 'context' | 'framework' | 'repair';
}

export interface HookScenarioPlan {
  title: string;
  body: string[];
  isAsync?: boolean;
}

export interface RenderStrategyPlan {
  mode: 'render' | 'custom-render';
  functionName: string;
  optionsExpression?: string;
}

export interface ComponentSemanticPlan {
  component: ComponentInfo;
  renderStrategy: RenderStrategyPlan;
  providers: ProviderDescriptor[];
  topLevelDeclarations: string[];
  beforeEachLines: string[];
  mockPlans: MockModulePlan[];
  scenarioPlans: HookScenarioPlan[];
  defaultPropsBlock?: string;
}

export interface SemanticTestPlan {
  imports: ResolvedImportSymbol[];
  usesUserEvent: boolean;
  needsScreen: boolean;
  usesBeforeEach: boolean;
  topLevelBlocks: string[];
  globalBeforeEachLines: string[];
  environmentRequirements: EnvironmentRequirement[];
  componentPlans: ComponentSemanticPlan[];
  /** Canonical analysis contexts — one per component, used for traceability */
  componentTestContexts: ComponentTestContext[];
}

export interface SemanticPlanOptions {
  sourceFilePath: string;
  testFilePath: string;
  components: ComponentInfo[];
  project?: Project;
  checker?: TypeChecker;
  sourceFile?: SourceFile | null;
  repairPlan?: RepairPlan;
  referencePatterns?: ReferencePatternSummary | null;
}

export function buildSemanticTestPlan(options: SemanticPlanOptions): SemanticTestPlan {
  const sourceFile = options.sourceFile ?? options.project?.getSourceFile(options.sourceFilePath) ?? null;
  const sourceImports = collectSourceImports(sourceFile);
  const sourceText = sourceFile?.getFullText() ?? '';
  const componentImportSymbols = buildComponentImportSymbols(options.components, options.sourceFilePath, options.testFilePath);

  // Build canonical ComponentTestContexts for traceability
  const componentTestContexts = options.components.map((component) =>
    buildComponentTestContext(component, options.sourceFilePath),
  );

  const environmentPlan = planEnvironment(options.components, {
    sourceFilePath: options.sourceFilePath,
    sourceText,
    sourceImports,
  });

  const componentPlans = options.components.map((component) =>
    buildComponentPlan(component, {
      ...options,
      sourceFile,
      sourceImports,
      environmentPlan,
    }),
  );

  const usesUserEvent = options.components.some((component) =>
    component.buttons.length > 0
    || component.inputs.length > 0
    || component.selects.length > 0
    || component.links.length > 0,
  );

  const needsScreen = usesUserEvent
    || componentPlans.some((componentPlan) => componentPlan.scenarioPlans.length > 0)
    || options.components.some((component) =>
      component.buttons.length > 0
      || component.inputs.length > 0
      || component.selects.length > 0
      || component.links.length > 0
      || component.conditionalElements.length > 0
      || component.forms.length > 0
      || component.props.some((prop) =>
        /^(is)?(loading|pending|fetching|submitting|processing|busy|error|failed|invalid|disabled|readOnly|locked|readonly)/i.test(prop.name),
      ),
    );

  const usesBeforeEach = environmentPlan.beforeEachLines.length > 0
    || componentPlans.some((componentPlan) => componentPlan.beforeEachLines.length > 0);

  const imports = buildImportPlan({
    ...options,
    componentImportSymbols,
    componentPlans,
    environmentPlan,
    usesUserEvent,
    needsScreen,
    usesBeforeEach,
  });

  const topLevelBlocks = [
    ...environmentPlan.topLevelSnippets,
    ...dedupeSnippets(componentPlans.flatMap((componentPlan) => [
      ...componentPlan.mockPlans.flatMap((plan) => plan.declarations),
      ...componentPlan.mockPlans.map((plan) => plan.statement),
    ])),
  ];

  return {
    imports,
    usesUserEvent,
    needsScreen,
    usesBeforeEach,
    topLevelBlocks: dedupeSnippets(topLevelBlocks),
    globalBeforeEachLines: dedupeSnippets(environmentPlan.beforeEachLines),
    environmentRequirements: environmentPlan.requirements,
    componentPlans,
    componentTestContexts,
  };
}

interface BuildComponentPlanContext extends SemanticPlanOptions {
  sourceFile: SourceFile | null;
  sourceImports: SourceImportUsage[];
  environmentPlan: EnvironmentPlan;
}

function buildComponentPlan(
  component: ComponentInfo,
  context: BuildComponentPlanContext,
): ComponentSemanticPlan {
  const renderHelper = resolveRenderHelper(context.sourceFilePath);
  const contextState = buildContextProviderState(component.contexts, context);
  const mockPlans = planMockModules(component, {
    sourceFilePath: context.sourceFilePath,
    testFilePath: context.testFilePath,
    sourceFile: context.sourceFile,
    referencePatterns: context.referencePatterns,
    repairPlan: context.repairPlan,
  });

  const providers = resolveProviders(component, context, contextState.providers);
  const renderStrategy = resolveRenderStrategy(component, providers, renderHelper, context.repairPlan);
  const scenarioPlans = buildScenarioPlans(component, mockPlans, context.referencePatterns);
  const beforeEachLines = [
    ...contextState.beforeEachLines,
    ...mockPlans.flatMap((plan) => plan.beforeEachLines),
  ];

  return {
    component,
    renderStrategy,
    providers,
    topLevelDeclarations: dedupeSnippets(contextState.declarations),
    beforeEachLines: dedupeSnippets(beforeEachLines),
    mockPlans,
    scenarioPlans,
    defaultPropsBlock: component.props.length > 0 ? buildDefaultPropsBlock(component) : undefined,
  };
}

function buildImportPlan(input: {
  sourceFilePath: string;
  testFilePath: string;
  components: ComponentInfo[];
  componentImportSymbols: ResolvedImportSymbol[];
  componentPlans: ComponentSemanticPlan[];
  environmentPlan: EnvironmentPlan;
  repairPlan?: RepairPlan;
  usesUserEvent: boolean;
  needsScreen: boolean;
  usesBeforeEach: boolean;
}): ResolvedImportSymbol[] {
  const imports: ResolvedImportSymbol[] = [];

  const globalsModule = getGlobalsModule();
  const globals = ['describe', 'it', 'expect'];
  if (input.usesBeforeEach) globals.push('beforeEach');
  if (
    input.componentPlans.some((componentPlan) =>
      componentPlan.mockPlans.some((mockPlan) => mockPlan.beforeEachLines.length > 0 || mockPlan.declarations.length > 0),
    )
  ) {
    globals.push(mockGlobalName());
  }

  // Only emit globals import when @jest/globals or vitest is actually available.
  // In traditional Jest, describe/it/expect/jest are automatic globals.
  if (globalsModule) {
    globals.forEach((symbolName) => {
      imports.push({
        modulePath: globalsModule,
        importKind: 'named',
        symbolName,
      });
    });
  }

  imports.push({
    modulePath: getDomMatchersModule(),
    importKind: 'side-effect',
  });

  const usesPlainRender = input.componentPlans.some((componentPlan) => componentPlan.renderStrategy.mode === 'render');
  const usesCustomRender = input.componentPlans.some((componentPlan) => componentPlan.renderStrategy.mode === 'custom-render');
  const renderHelper = resolveRenderHelper(input.sourceFilePath);

  if (usesPlainRender) {
    const rtlImports = ['render', input.needsScreen ? 'screen' : null].filter((value): value is string => Boolean(value));
    input.repairPlan?.actions.forEach((action) => {
      if (action.kind === 'add-async-handling') {
        if (action.strategy === 'waitFor' && !rtlImports.includes('waitFor')) rtlImports.push('waitFor');
        if (action.strategy === 'act' && !rtlImports.includes('act')) rtlImports.push('act');
      }
    });
    rtlImports.forEach((symbolName) => {
      imports.push({
        modulePath: '@testing-library/react',
        importKind: 'named',
        symbolName,
      });
    });
  }

  if (usesCustomRender && renderHelper) {
    imports.push({
      modulePath: relativeImport(input.testFilePath, renderHelper.path),
      importKind: 'named',
      symbolName: renderHelper.exportName,
    });
    if (!usesPlainRender && input.needsScreen) {
      imports.push({
        modulePath: relativeImport(input.testFilePath, renderHelper.path),
        importKind: 'named',
        symbolName: 'screen',
      });
    }
  }

  if (input.usesUserEvent) {
    imports.push({
      modulePath: '@testing-library/user-event',
      importKind: 'default',
      symbolName: 'userEvent',
    });
  }

  input.componentPlans.forEach((componentPlan) => {
    componentPlan.providers.forEach((provider) => {
      if (!provider.validated || !provider.importModulePath || !provider.importKind || !provider.importName) return;
      imports.push({
        modulePath: provider.importModulePath,
        importKind: provider.importKind,
        symbolName: provider.importName,
        alias: provider.importAlias,
      });
      if (provider.key === 'react-query-provider') {
        imports.push({
          modulePath: provider.importModulePath,
          importKind: 'named',
          symbolName: 'QueryClient',
        });
      }
    });
  });

  input.repairPlan?.actions.forEach((action) => {
    if (action.kind === 'ensure-import' && action.module !== 'unknown') {
      if (action.symbol) {
        imports.push({
          modulePath: action.module,
          importKind: 'named',
          symbolName: action.symbol,
        });
      } else {
        imports.push({
          modulePath: action.module,
          importKind: 'side-effect',
        });
      }
    }
  });

  imports.push(...input.componentImportSymbols);

  return dedupeImports(imports);
}

function buildComponentImportSymbols(
  components: ComponentInfo[],
  sourceFilePath: string,
  testFilePath: string,
): ResolvedImportSymbol[] {
  const componentImport = relativeImport(testFilePath, sourceFilePath);
  const imports: ResolvedImportSymbol[] = [];

  const defaultComponent = components.find((component) => component.exportType === 'default');
  if (defaultComponent) {
    imports.push({
      modulePath: componentImport,
      importKind: 'default',
      symbolName: defaultComponent.name,
    });
  }

  components
    .filter((component) => component.exportType === 'named')
    .forEach((component) => {
      imports.push({
        modulePath: componentImport,
        importKind: 'named',
        symbolName: component.name,
      });
    });

  return imports;
}

function buildContextProviderState(
  contexts: ContextUsage[],
  context: BuildComponentPlanContext,
): {
  providers: ProviderDescriptor[];
  declarations: string[];
  beforeEachLines: string[];
} {
  const providers: ProviderDescriptor[] = [];
  const declarations: string[] = [];
  const beforeEachLines: string[] = [];

  if (!context.project || !context.checker) {
    return { providers, declarations, beforeEachLines };
  }

  for (const usage of contexts) {
    const referenceShape = resolveReferenceContextShape(usage, context.referencePatterns);
    if (referenceShape) {
      declarations.push(buildReferenceObjectFactory(referenceShape));
      beforeEachLines.push(`${referenceShape.name} = create${capitalize(referenceShape.name)}();`);
      providers.push({
        key: `context:${usage.contextName}`,
        wrapperExpression: `${usage.contextName}.Provider`,
        importModulePath: resolveContextImportPath(usage.importPath ?? usage.hookImportPath ?? '', context.sourceFilePath, context.testFilePath),
        importKind: 'named',
        importName: usage.contextName,
        valueExpression: referenceShape.name,
        validated: Boolean(usage.importPath || usage.hookImportPath),
        source: 'context',
      });
      continue;
    }

    const mockValue = generateContextMockValue(usage, context.project, context.checker);
    if (!mockValue) continue;
    declarations.push(mockValue.mockDeclaration);
    providers.push({
      key: `context:${usage.contextName}`,
      wrapperExpression: `${mockValue.importName}.Provider`,
      importModulePath: resolveContextImportPath(mockValue.importPath, context.sourceFilePath, context.testFilePath),
      importKind: 'named',
      importName: mockValue.importName,
      valueExpression: mockValue.mockVarName,
      validated: true,
      source: 'context',
    });
  }

  return { providers, declarations: dedupeSnippets(declarations), beforeEachLines: dedupeSnippets(beforeEachLines) };
}

function resolveProviders(
  component: ComponentInfo,
  context: BuildComponentPlanContext,
  contextProviders: ProviderDescriptor[],
): ProviderDescriptor[] {
  const providers: ProviderDescriptor[] = [...contextProviders.filter((provider) => provider.validated)];
  const requiredProviderKeys = new Set<string>();

  if (component.usesRouter || hasRepairProvider(context.repairPlan, 'MemoryRouter')) {
    requiredProviderKeys.add('MemoryRouter');
  }
  if (component.usesReactQuery || hasRepairProvider(context.repairPlan, 'QueryClientProvider')) {
    requiredProviderKeys.add('QueryClientProvider');
  }
  if (component.usesRedux || hasRepairProvider(context.repairPlan, 'Provider') || hasRepairProvider(context.repairPlan, 'ReduxProvider')) {
    requiredProviderKeys.add('ReduxProvider');
  }

  for (const key of requiredProviderKeys) {
    const provider = buildFrameworkProvider(key);
    if (provider) providers.push(provider);
  }

  return dedupeProviders(providers);
}

function resolveRenderStrategy(
  component: ComponentInfo,
  providers: ProviderDescriptor[],
  renderHelper: { path: string; exportName: string } | null,
  repairPlan?: RepairPlan,
): RenderStrategyPlan {
  const repairWantsHelper = repairPlan?.actions.some((action) => action.kind === 'use-render-helper' && action.helper === 'renderWithProviders');
  const validatedProviderCount = providers.filter((provider) => provider.validated).length;

  if (renderHelper && (repairWantsHelper || validatedProviderCount === 0) && !component.usesRouter) {
    return {
      mode: 'custom-render',
      functionName: renderHelper.exportName,
      optionsExpression: component.usesAuthHook ? `{ withAuthProvider: false, authState: ${deriveAuthState(component)} }` : undefined,
    };
  }

  return {
    mode: 'render',
    functionName: 'render',
  };
}

function buildScenarioPlans(
  component: ComponentInfo,
  mockPlans: MockModulePlan[],
  referencePatterns?: ReferencePatternSummary | null,
): HookScenarioPlan[] {
  const hookPlans = flattenHookMockPlans(mockPlans);
  if (!referencePatterns || hookPlans.length === 0) return [];

  const primaryHook = [...hookPlans].sort((left, right) =>
    scoreHookPlan(right, referencePatterns) - scoreHookPlan(left, referencePatterns),
  )[0];
  if (!primaryHook) return [];

  const tests: HookScenarioPlan[] = [];
  const arrayKey = findFirstProperty(primaryHook.returnShape, ['array']);
  const loadingKey = findPreferredKey(primaryHook.returnShape, ['isLoading', 'loading', 'pending', 'fetching']);
  const errorKey = findPreferredKey(primaryHook.returnShape, ['errorMessage', 'error', 'failureReason']);
  const actionKey = findPreferredActionKey(primaryHook.returnShape);

  if (referencePatterns.scenarios.loading && loadingKey) {
    tests.push({
      title: 'renders loading state',
      body: [
        `${primaryHook.mockVariableName}.mockReturnValue(${primaryHook.factoryName}({ ${loadingKey}: true }));`,
        'renderUI();',
        'expect(screen.queryByText(/loading|please wait/i) ?? screen.queryByRole("status") ?? screen.queryByRole("progressbar")).toBeInTheDocument();',
      ],
    });
  }

  if (referencePatterns.scenarios.empty && arrayKey) {
    tests.push({
      title: 'renders empty state',
      body: [
        `${primaryHook.mockVariableName}.mockReturnValue(${primaryHook.factoryName}({ ${arrayKey}: [] }));`,
        'renderUI();',
        'expect(screen.queryByText(/no .*records|no .*results|no .*transfers|empty/i) ?? screen.queryByText(/no data/i)).toBeInTheDocument();',
      ],
    });
  }

  if (referencePatterns.scenarios.error && errorKey) {
    tests.push({
      title: 'renders error state',
      body: [
        `${primaryHook.mockVariableName}.mockReturnValue(${primaryHook.factoryName}({ ${errorKey}: "Service unavailable" }));`,
        'renderUI();',
        'expect(screen.queryByText(/error|failed|service unavailable|unable/i)).toBeInTheDocument();',
      ],
    });
  }

  if (referencePatterns.scenarios.data && arrayKey) {
    tests.push({
      title: 'renders data state',
      body: [
        `${primaryHook.mockVariableName}.mockReturnValue(${primaryHook.factoryName}({ ${arrayKey}: [${buildSampleArrayEntry(primaryHook.returnShape, component.name)}] }));`,
        'renderUI();',
        `expect(screen.queryByText(/${escapeForRegex(/transfers?/i.test(component.name) ? 'Scheduled Transfer' : `${component.name} Row`)}/i) ?? screen.queryByRole("table") ?? screen.queryByRole("list")).toBeInTheDocument();`,
      ],
    });
  }

  if (referencePatterns.scenarios.modal && actionKey && component.buttons.length > 0) {
    tests.push({
      title: 'triggers modal action when requested',
      isAsync: true,
      body: [
        'const user = userEvent.setup();',
        `const state = ${primaryHook.factoryName}();`,
        `${primaryHook.mockVariableName}.mockReturnValue(state);`,
        'renderUI();',
        'await user.click(screen.getAllByRole("button")[0]);',
        `expect(state.${actionKey}).toHaveBeenCalled();`,
      ],
    });
  }

  return tests;
}

function buildDefaultPropsBlock(component: ComponentInfo): string {
  return buildDefaultProps(component);
}

function buildReferenceObjectFactory(shape: ReferenceObjectShape): string {
  const body = shape.properties.map((property) => `  ${property.key}: ${property.kind === 'fn' ? `${mockGlobalName()}.fn()` : property.literal},`);
  return [
    `const create${capitalize(shape.name)} = (overrides: Record<string, unknown> = {}) => ({`,
    ...body,
    '  ...overrides,',
    '});',
    `let ${shape.name} = create${capitalize(shape.name)}();`,
  ].join('\n');
}

function resolveReferenceContextShape(
  usage: ContextUsage,
  referencePatterns?: ReferencePatternSummary | null,
): ReferenceObjectShape | undefined {
  if (!referencePatterns) return undefined;

  const wrapper = referencePatterns.providerWrappers.find((entry) =>
    entry.name.toLowerCase() === `${usage.contextName.toLowerCase()}.provider`
    || entry.name.toLowerCase() === `${usage.providerName?.toLowerCase() ?? ''}`
    || entry.name.toLowerCase().includes(usage.contextName.toLowerCase().replace(/context$/, '')),
  );
  if (!wrapper?.valueObjectName) return undefined;
  return referencePatterns.objectShapes.find((shape) => shape.name === wrapper.valueObjectName);
}

function buildFrameworkProvider(providerKey: string): ProviderDescriptor | null {
  switch (providerKey) {
    case 'MemoryRouter':
      return {
        key: 'router-provider',
        wrapperExpression: 'MemoryRouter',
        importModulePath: 'react-router-dom',
        importKind: 'named',
        importName: 'MemoryRouter',
        validated: true,
        source: 'framework',
      };
    case 'QueryClientProvider':
      return {
        key: 'react-query-provider',
        wrapperExpression: 'QueryClientProvider',
        importModulePath: '@tanstack/react-query',
        importKind: 'named',
        importName: 'QueryClientProvider',
        propsExpression: 'client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}',
        validated: true,
        source: 'framework',
      };
    case 'ReduxProvider':
    case 'Provider':
      return {
        key: 'redux-provider',
        wrapperExpression: 'ReduxProvider',
        importModulePath: 'react-redux',
        importKind: 'named',
        importName: 'Provider',
        importAlias: 'ReduxProvider',
        propsExpression: 'store={{ getState: () => ({}), subscribe: () => () => undefined, dispatch: () => undefined }}',
        validated: true,
        source: 'framework',
      };
    default:
      return null;
  }
}

function hasRepairProvider(repairPlan: RepairPlan | undefined, providerName: string): boolean {
  if (!repairPlan) return false;
  return repairPlan.actions.some((action) =>
    (action.kind === 'require-provider' && action.provider === providerName)
    || (action.kind === 'add-wrapper' && action.wrapper === providerName),
  );
}

function resolveContextImportPath(importPath: string, sourceFilePath: string, testFilePath: string): string {
  if (!importPath.startsWith('.')) return importPath;

  const sourceDir = path.dirname(sourceFilePath);
  const absoluteTarget = path.resolve(sourceDir, importPath);
  const testDir = path.dirname(testFilePath);
  let relativePath = path.relative(testDir, absoluteTarget).split('\\').join('/');
  if (!relativePath.startsWith('.')) {
    relativePath = `./${relativePath}`;
  }
  return relativePath.replace(/\.(tsx?|jsx?)$/, '');
}

function deriveAuthState(component: ComponentInfo): string {
  const name = component.name;
  if (/public|login|register|signup/i.test(name)) {
    return '{ isAuthenticated: false, isLoading: false }';
  }
  if (/protected|private|auth|dashboard/i.test(name)) {
    return '{ isAuthenticated: true, isLoading: false }';
  }
  return '{ isAuthenticated: false, isLoading: false }';
}

function dedupeImports(imports: ResolvedImportSymbol[]): ResolvedImportSymbol[] {
  const deduped: ResolvedImportSymbol[] = [];
  const seen = new Set<string>();

  for (const entry of imports) {
    const key = `${entry.modulePath}::${entry.importKind}::${entry.symbolName ?? ''}::${entry.alias ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }

  return deduped;
}

function dedupeProviders(providers: ProviderDescriptor[]): ProviderDescriptor[] {
  const deduped: ProviderDescriptor[] = [];
  const seen = new Set<string>();

  for (const provider of providers) {
    const key = `${provider.key}::${provider.wrapperExpression}::${provider.valueExpression ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(provider);
  }

  return deduped;
}

function dedupeSnippets(snippets: string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const snippet of snippets) {
    const trimmed = snippet.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    deduped.push(trimmed);
  }

  return deduped;
}

function scoreHookPlan(hookPlan: ReturnType<typeof flattenHookMockPlans>[number], referencePatterns: ReferencePatternSummary): number {
  const match = referencePatterns.moduleMocks.find((entry) => entry.exportName === hookPlan.exportName);
  if (!match?.returnShape) return 0;
  return match.returnShape.properties.reduce((score, property) => {
    if (property.kind === 'array') return score + 4;
    if (property.kind === 'fn') return score + 2;
    if (/loading|error|message|failure/i.test(property.key)) return score + 5;
    return score + 1;
  }, 0);
}

function findPreferredKey(shape: ReferenceObjectShape | undefined, preferredKeys: string[]): string | null {
  if (!shape) return null;
  const propertyNames = new Set(shape.properties.map((property) => property.key));
  return preferredKeys.find((key) => propertyNames.has(key)) ?? null;
}

function findFirstProperty(
  shape: ReferenceObjectShape | undefined,
  kinds: Array<ReferenceObjectShape['properties'][number]['kind']>,
): string | null {
  if (!shape) return null;
  return shape.properties.find((property) => kinds.includes(property.kind))?.key ?? null;
}

function findPreferredActionKey(shape: ReferenceObjectShape | undefined): string | null {
  if (!shape) return null;
  return shape.properties.find((property) =>
    property.kind === 'fn' && /open|show|toggle|handle|set|dispatch/i.test(property.key),
  )?.key ?? null;
}

function buildSampleArrayEntry(shape: ReferenceObjectShape | undefined, componentName: string): string {
  const properties = shape?.properties ?? [];
  if (properties.length === 0) {
    return `{ id: "1", name: "${componentName} Row" }`;
  }

  const mapped = properties
    .filter((property) => property.kind !== 'array')
    .slice(0, 4)
    .map((property) => {
      if (/name|title|label|description/i.test(property.key)) return `${property.key}: "Scheduled Transfer"`;
      if (property.kind === 'fn') return `${property.key}: ${mockGlobalName()}.fn()`;
      if (property.kind === 'number') return `${property.key}: 1`;
      if (property.kind === 'boolean') return `${property.key}: false`;
      if (property.kind === 'null') return `${property.key}: null`;
      if (property.kind === 'object') return `${property.key}: { id: "1" }`;
      return `${property.key}: "Scheduled Transfer"`;
    });

  if (!mapped.some((entry) => entry.startsWith('id:'))) mapped.unshift('id: "1"');
  if (!mapped.some((entry) => /name:|title:|label:|description:/.test(entry))) mapped.push('name: "Scheduled Transfer"');
  return `{ ${mapped.join(', ')} }`;
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Returns the module path for test globals.
 * If @jest/globals is not installed (traditional Jest globals mode),
 * returns null — globals are provided by Jest automatically.
 */
function getGlobalsModule(): string | null {
  if (mockGlobalName() === 'vi') return 'vitest';
  // Check if @jest/globals is actually available
  if (isPackageExplicitDependency('@jest/globals')) return '@jest/globals';
  // Traditional Jest — globals are automatic, no import needed
  return null;
}

function getDomMatchersModule(): string {
  if (mockGlobalName() === 'vi') return '@testing-library/jest-dom/vitest';
  if (isPackageExplicitDependency('@jest/globals')) return '@testing-library/jest-dom/jest-globals';
  return '@testing-library/jest-dom';
}

/**
 * Check if a package is explicitly listed as a dependency (not just transitively available).
 * For @jest/globals: it comes bundled with jest but should only be used when the project
 * explicitly imports it. We check the target project's package.json.
 */
function isPackageExplicitDependency(packageName: string): boolean {
  const fs = require('node:fs');
  const nodePath = require('node:path');
  const cwd = process.cwd();

  // Walk up from cwd looking for package.json that lists this dependency
  let dir = cwd;
  for (let i = 0; i < 5; i++) {
    const pkgPath = nodePath.join(dir, 'package.json');
    try {
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
        };
        if (allDeps[packageName]) return true;
      }
    } catch {
      // ignore
    }
    const parent = nodePath.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}
