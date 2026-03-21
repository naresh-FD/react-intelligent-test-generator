import path from 'node:path';
import { SourceFile } from 'ts-morph';
import { ComponentInfo } from '../analyzer';
import type { RepairPlan } from '../healer/knowledge-base';
import type { ReferenceObjectShape, ReferencePatternSummary, ReferenceShapeProperty } from '../repoPatterns';
import { mockFn, mockGlobalName, mockModuleFn } from '../utils/framework';

export type MockExportStyle = 'named' | 'default' | 'mixed' | 'partial' | 'bare';

export interface SourceImportUsage {
  modulePath: string;
  defaultImport?: string;
  namedImports: Array<{ name: string; alias?: string }>;
  namespaceImport?: string;
}

export interface HookMockPlan {
  modulePath: string;
  exportName: string;
  mockVariableName: string;
  factoryName: string;
  returnShape?: ReferenceObjectShape;
  supportsScenarios: boolean;
}

export interface MockModulePlan {
  modulePath: string;
  exportStyle: MockExportStyle;
  source: 'registry' | 'repair';
  declarations: string[];
  statement: string;
  beforeEachLines: string[];
  hookPlans: HookMockPlan[];
}

export interface MockRegistryOptions {
  sourceFilePath?: string;
  testFilePath?: string;
  sourceFile?: SourceFile | null;
  referencePatterns?: ReferencePatternSummary | null;
  repairPlan?: RepairPlan;
  skipHookMocks?: string[];
}

interface HookFactoryShape {
  shape: ReferenceObjectShape | undefined;
  mockVariableName: string;
  factoryName: string;
}

const QUERY_CLIENT_STUB = '{ data: {}, status: 200, statusText: "OK", headers: {}, config: {} }';

export function collectSourceImports(sourceFile: SourceFile | null | undefined): SourceImportUsage[] {
  if (!sourceFile) return [];

  return sourceFile.getImportDeclarations().map((declaration) => ({
    modulePath: declaration.getModuleSpecifierValue(),
    defaultImport: declaration.getDefaultImport()?.getText(),
    namedImports: declaration.getNamedImports().map((namedImport) => ({
      name: namedImport.getName(),
      alias: namedImport.getAliasNode()?.getText(),
    })),
    namespaceImport: declaration.getNamespaceImport()?.getText(),
  }));
}

export function planMockModules(
  component: ComponentInfo,
  options: MockRegistryOptions = {},
): MockModulePlan[] {
  const sourceImports = collectSourceImports(options.sourceFile);
  const plans: MockModulePlan[] = [];
  const seenModules = new Set<string>();
  const skippedHooks = new Set(options.skipHookMocks ?? []);

  const pushPlan = (plan: MockModulePlan | null): void => {
    if (!plan || seenModules.has(plan.modulePath)) return;
    seenModules.add(plan.modulePath);
    plans.push(plan);
  };

  if (component.usesFramerMotion) {
    pushPlan(buildFramerMotionPlan());
  }

  if (component.usesRecharts) {
    pushPlan(buildRechartsPlan());
  }

  if (component.thirdPartyImports.includes('axios')) {
    pushPlan(buildAxiosPlan());
  }

  buildRelativeHookMockPlans(component, sourceImports, options.referencePatterns, options, skippedHooks).forEach(pushPlan);

  for (const serviceImport of component.serviceImports) {
    pushPlan(buildServiceImportPlan(serviceImport, sourceImports, options));
  }

  if (options.repairPlan) {
    for (const action of options.repairPlan.actions) {
      if (action.kind === 'mock-hook') {
        pushPlan(buildRepairHookPlan(action.hookName, sourceImports, options.referencePatterns, options));
      }
      if (action.kind === 'fix-mock-return') {
        pushPlan(buildRepairShapePlan(action.target, action.shapeKind, sourceImports, options.referencePatterns, options));
      }
    }
  }

  return plans;
}

export function emitMockPlans(plans: MockModulePlan[]): string[] {
  const output: string[] = [];
  for (const plan of plans) {
    output.push(...plan.declarations);
    output.push(plan.statement);
  }
  return dedupeSnippets(output);
}

export function flattenHookMockPlans(plans: MockModulePlan[]): HookMockPlan[] {
  return plans.flatMap((plan) => plan.hookPlans);
}

export function buildFallbackHookMockReturnValue(hookName: string): string {
  const nameMatch = hookName.match(/^use(?:Get|Fetch|Load|Query)?([A-Z]\w*)/);
  const resource = nameMatch ? nameMatch[1] : '';
  const resourceLower = resource ? resource.charAt(0).toLowerCase() + resource.slice(1) : 'data';

  if (/^use(Get|Fetch|Load|Query)/i.test(hookName)) {
    return `{ data: [], ${resourceLower}: [], loading: false, isLoading: false, error: null, isError: false, refetch: ${mockFn()}, isFetching: false }`;
  }
  if (/^useAuth/i.test(hookName)) {
    return `{ user: { id: "1", name: "Test User" }, isAuthenticated: true, login: ${mockFn()}, logout: ${mockFn()}, token: "mock-token" }`;
  }
  if (/^use(Theme|Style)/i.test(hookName)) {
    return `{ theme: "light", toggleTheme: ${mockFn()} }`;
  }
  if (/^use(Notification|Toast|Alert|Snackbar)/i.test(hookName)) {
    return `{ show: ${mockFn()}, hide: ${mockFn()}, notifications: [] }`;
  }
  if (/^use(Navigate|Navigation|Router|History)/i.test(hookName)) {
    return mockFn();
  }
  if (/^use(Mobile|Tablet|iPad|Desktop|MediaQuery|Responsive|Breakpoint|FirstRender)/i.test(hookName)) {
    return 'false';
  }
  if (/^useSearch/i.test(hookName)) {
    return `{ query: "", results: [], search: ${mockFn()}, clear: ${mockFn()}, loading: false }`;
  }
  if (/^use(Feature|Flag|Toggle|Dated)/i.test(hookName)) {
    return `{ enabled: false, value: null }`;
  }
  if (/^use(MDP|API|Http)/i.test(hookName)) {
    return `{ data: null, loading: false, error: null, execute: ${mockFn()}, refetch: ${mockFn()} }`;
  }
  return `{ data: [], ${resourceLower}: [], loading: false, isLoading: false, error: null, value: null, setValue: ${mockFn()}, refetch: ${mockFn()} }`;
}

function buildFramerMotionPlan(): MockModulePlan {
  return {
    modulePath: 'framer-motion',
    exportStyle: 'mixed',
    source: 'registry',
    declarations: [],
    beforeEachLines: [],
    hookPlans: [],
    statement: `${mockModuleFn()}("framer-motion", () => ({
  __esModule: true,
  motion: new Proxy({}, {
    get: () => (props: Record<string, unknown>) => {
      const { children, ...rest } = props;
      return ({ type: "div", props: { ...rest, children } } as unknown);
    },
  }),
  AnimatePresence: ({ children }: { children: unknown }) => children,
  useAnimation: () => ({ start: ${mockFn()}, stop: ${mockFn()}, set: ${mockFn()} }),
  useMotionValue: (init: unknown) => ({ get: () => init, set: ${mockFn()}, onChange: ${mockFn()} }),
  useTransform: () => ({ get: () => 0, set: ${mockFn()} }),
  useInView: () => true,
  useScroll: () => ({ scrollY: { get: () => 0 }, scrollX: { get: () => 0 } }),
  useSpring: (val: unknown) => ({ get: () => (typeof val === "number" ? val : 0), set: ${mockFn()} }),
  useReducedMotion: () => false,
}));`,
  };
}

function buildRechartsPlan(): MockModulePlan {
  return {
    modulePath: 'recharts',
    exportStyle: 'mixed',
    source: 'registry',
    declarations: [],
    beforeEachLines: [],
    hookPlans: [],
    statement: `${mockModuleFn()}("recharts", () => ({
  __esModule: true,
  ResponsiveContainer: ({ children }: { children: unknown }) => children,
  PieChart: ({ children }: { children: unknown }) => children,
  AreaChart: ({ children }: { children: unknown }) => children,
  BarChart: ({ children }: { children: unknown }) => children,
  LineChart: ({ children }: { children: unknown }) => children,
  ComposedChart: ({ children }: { children: unknown }) => children,
  RadarChart: ({ children }: { children: unknown }) => children,
  RadialBarChart: ({ children }: { children: unknown }) => children,
  ScatterChart: ({ children }: { children: unknown }) => children,
  Treemap: ({ children }: { children: unknown }) => children,
  Sankey: ({ children }: { children: unknown }) => children,
  FunnelChart: ({ children }: { children: unknown }) => children,
  Pie: "div", Area: "div", Bar: "div", Line: "div",
  XAxis: "div", YAxis: "div", ZAxis: "div",
  CartesianGrid: "div", Tooltip: "div", Legend: "div",
  Cell: "div", Label: "div", LabelList: "div",
  Brush: "div", ReferenceLine: "div", ReferenceArea: "div",
  Radar: "div", RadialBar: "div", Scatter: "div", Funnel: "div",
}));`,
  };
}

function buildAxiosPlan(): MockModulePlan {
  return {
    modulePath: 'axios',
    exportStyle: 'mixed',
    source: 'registry',
    declarations: [],
    beforeEachLines: [],
    hookPlans: [],
    statement: `${mockModuleFn()}("axios", () => {
  const mockResponse = ${QUERY_CLIENT_STUB};
  const mockInstance = {
    get: ${mockFn()}.mockResolvedValue(mockResponse),
    post: ${mockFn()}.mockResolvedValue(mockResponse),
    put: ${mockFn()}.mockResolvedValue(mockResponse),
    delete: ${mockFn()}.mockResolvedValue(mockResponse),
    patch: ${mockFn()}.mockResolvedValue(mockResponse),
    request: ${mockFn()}.mockResolvedValue(mockResponse),
    interceptors: { request: { use: ${mockFn()}, eject: ${mockFn()} }, response: { use: ${mockFn()}, eject: ${mockFn()} } },
    defaults: { headers: { common: {} } },
  };
  return {
    __esModule: true,
    default: { ...mockInstance, create: ${mockGlobalName()}.fn(() => ({ ...mockInstance })) },
    ...mockInstance,
    create: ${mockGlobalName()}.fn(() => ({ ...mockInstance })),
  };
});`,
  };
}

function buildRelativeHookMockPlans(
  component: ComponentInfo,
  sourceImports: SourceImportUsage[],
  referencePatterns: ReferencePatternSummary | null | undefined,
  options: MockRegistryOptions,
  skippedHooks: Set<string>,
): MockModulePlan[] {
  const hookGroups = new Map<string, typeof component.hooks>();

  for (const hook of component.hooks) {
    if (!hook.importSource || skippedHooks.has(hook.name)) continue;
    if (hook.importSource === 'react' || hook.importSource.includes('@testing-library')) continue;
    if (hook.importSource.includes('react-router')) continue;
    if (hook.importSource.includes('@tanstack/react-query')) continue;
    if (hook.importSource.includes('react-redux')) continue;
    if (!isLocalModule(hook.importSource)) continue;

    const existing = hookGroups.get(hook.importSource) ?? [];
    existing.push(hook);
    hookGroups.set(hook.importSource, existing);
  }

  const plans: MockModulePlan[] = [];

  for (const [modulePath, hooks] of hookGroups.entries()) {
    if (!modulePath || hooks.length === 0) continue;

    const rebasedModulePath = rebaseRelativeImport(modulePath, options.sourceFilePath, options.testFilePath);
    const declarations: string[] = [];
    const beforeEachLines: string[] = [`${mockGlobalName()}.clearAllMocks();`];
    const hookPlans: HookMockPlan[] = [];
    const mockAssignments: string[] = [];

    for (const hook of hooks) {
      const shape = resolveHookFactoryShape(hook.name, referencePatterns);
      hookPlans.push({
        modulePath: rebasedModulePath,
        exportName: hook.name,
        mockVariableName: shape.mockVariableName,
        factoryName: shape.factoryName,
        returnShape: shape.shape,
        supportsScenarios: true,
      });
      declarations.push(buildHookFactoryDeclaration(shape.factoryName, shape.shape, shape.mockVariableName));
      beforeEachLines.push(`${shape.mockVariableName}.mockReset();`);
      beforeEachLines.push(`${shape.mockVariableName}.mockReturnValue(${shape.factoryName}());`);
      mockAssignments.push(`  ${hook.name}: ${shape.mockVariableName},`);
    }

    const actualSpread = shouldPreserveActual(rebasedModulePath, sourceImports) ? `  ...${mockGlobalName()}.requireActual("${rebasedModulePath}"),\n` : '';
    plans.push({
      modulePath: rebasedModulePath,
      exportStyle: actualSpread ? 'partial' : 'named',
      source: 'registry',
      declarations: dedupeSnippets(declarations),
      beforeEachLines: dedupeSnippets(beforeEachLines),
      hookPlans,
      statement: `${mockModuleFn()}("${rebasedModulePath}", () => ({
${actualSpread}${mockAssignments.join('\n')}
}));`,
    });
  }

  return plans;
}

function buildServiceImportPlan(
  serviceImport: string,
  sourceImports: SourceImportUsage[],
  options: MockRegistryOptions,
): MockModulePlan | null {
  const modulePath = rebaseRelativeImport(serviceImport, options.sourceFilePath, options.testFilePath);
  const usage = findImportUsage(sourceImports, serviceImport) ?? findImportUsage(sourceImports, modulePath);
  if (!usage) {
    return {
      modulePath,
      exportStyle: 'bare',
      source: 'registry',
      declarations: [],
      beforeEachLines: [],
      hookPlans: [],
      statement: `${mockModuleFn()}("${modulePath}");`,
    };
  }

  const namedEntries = usage.namedImports.map((entry) => {
    const exportedName = entry.alias ?? entry.name;
    if (/^[A-Z]/.test(exportedName)) {
      return `${entry.name}: () => null`;
    }
    return `${entry.name}: ${mockFn()}`;
  });

  const defaultEntry = usage.defaultImport
    ? `default: ${buildDefaultModuleStub(usage.defaultImport)}`
    : null;
  const moduleBody = [
    '__esModule: true',
    ...(defaultEntry ? [defaultEntry] : []),
    ...namedEntries,
  ];

  return {
    modulePath,
    exportStyle: usage.defaultImport && usage.namedImports.length > 0
      ? 'mixed'
      : usage.defaultImport
        ? 'default'
        : 'named',
    source: 'registry',
    declarations: [],
    beforeEachLines: [],
    hookPlans: [],
    statement: `${mockModuleFn()}("${modulePath}", () => ({
  ${moduleBody.join(',\n  ')}
}));`,
  };
}

function buildRepairHookPlan(
  hookName: string,
  sourceImports: SourceImportUsage[],
  referencePatterns: ReferencePatternSummary | null | undefined,
  options: MockRegistryOptions,
): MockModulePlan | null {
  const importUsage = sourceImports.find((entry) =>
    entry.namedImports.some((namedImport) => namedImport.name === hookName)
    || entry.defaultImport === hookName,
  );

  const modulePath = importUsage?.modulePath ?? resolveWellKnownHookModule(hookName);
  if (!modulePath) return null;

  const rebasedModulePath = rebaseRelativeImport(modulePath, options.sourceFilePath, options.testFilePath);
  const shape = resolveHookFactoryShape(hookName, referencePatterns);

  return {
    modulePath: rebasedModulePath,
    exportStyle: 'partial',
    source: 'repair',
    declarations: [buildHookFactoryDeclaration(shape.factoryName, shape.shape, shape.mockVariableName)],
    beforeEachLines: [
      `${mockGlobalName()}.clearAllMocks();`,
      `${shape.mockVariableName}.mockReset();`,
      `${shape.mockVariableName}.mockReturnValue(${shape.factoryName}());`,
    ],
    hookPlans: [{
      modulePath: rebasedModulePath,
      exportName: hookName,
      mockVariableName: shape.mockVariableName,
      factoryName: shape.factoryName,
      returnShape: shape.shape,
      supportsScenarios: true,
    }],
    statement: `${mockModuleFn()}("${rebasedModulePath}", () => ({
  ...${mockGlobalName()}.requireActual("${rebasedModulePath}"),
  ${hookName}: ${shape.mockVariableName},
}));`,
  };
}

function buildRepairShapePlan(
  target: string,
  shapeKind: 'array' | 'function' | 'object' | 'promise',
  sourceImports: SourceImportUsage[],
  referencePatterns: ReferencePatternSummary | null | undefined,
  options: MockRegistryOptions,
): MockModulePlan | null {
  const importUsage = sourceImports.find((entry) =>
    entry.namedImports.some((namedImport) => namedImport.name === target)
    || entry.defaultImport === target,
  );
  if (!importUsage) return null;

  const rebasedModulePath = rebaseRelativeImport(importUsage.modulePath, options.sourceFilePath, options.testFilePath);
  const referenceShape = referencePatterns?.moduleMocks.find((entry) => entry.exportName === target)?.returnShape;
  const fallbackShape = referenceShape ?? {
    name: `${target}Value`,
    properties: [{
      key: inferFallbackKey(shapeKind),
      kind: inferPropertyKind(shapeKind),
      literal: inferShapeLiteral(shapeKind),
    }],
  };
  const mockVariableName = `mock${target.charAt(0).toUpperCase()}${target.slice(1)}`;
  const factoryName = `create${target.charAt(0).toUpperCase()}${target.slice(1)}`;

  return {
    modulePath: rebasedModulePath,
    exportStyle: 'partial',
    source: 'repair',
    declarations: [buildHookFactoryDeclaration(factoryName, fallbackShape, mockVariableName)],
    beforeEachLines: [
      `${mockGlobalName()}.clearAllMocks();`,
      `${mockVariableName}.mockReset();`,
      `${mockVariableName}.mockReturnValue(${factoryName}());`,
    ],
    hookPlans: [{
      modulePath: rebasedModulePath,
      exportName: target,
      mockVariableName,
      factoryName,
      returnShape: fallbackShape,
      supportsScenarios: true,
    }],
    statement: `${mockModuleFn()}("${rebasedModulePath}", () => ({
  ...${mockGlobalName()}.requireActual("${rebasedModulePath}"),
  ${target}: ${mockVariableName},
}));`,
  };
}

function buildHookFactoryDeclaration(
  factoryName: string,
  shape: ReferenceObjectShape | undefined,
  mockVariableName: string,
): string {
  const body = shape && shape.properties.length > 0
    ? shape.properties.map((property) => `  ${property.key}: ${normalizeLiteral(property)},`)
    : buildFallbackHookFactoryBody(mockVariableName);

  return [
    `const ${factoryName} = (overrides: Record<string, unknown> = {}) => ({`,
    ...body,
    '  ...overrides,',
    '});',
    `const ${mockVariableName} = ${mockGlobalName()}.fn(() => ${factoryName}());`,
  ].join('\n');
}

function buildFallbackHookFactoryBody(mockVariableName: string): string[] {
  const hookName = mockVariableName.replace(/^mock/, '');
  const normalized = hookName.length > 0
    ? hookName.charAt(0).toLowerCase() + hookName.slice(1)
    : 'hook';
  const fallback = buildFallbackHookMockReturnValue(normalized);
  const inner = fallback.trim().replace(/^\{/, '').replace(/\}$/, '').trim();
  if (!inner) return ['  data: [],'];
  return splitTopLevel(inner).map((segment) => `  ${segment.trim()},`);
}

function resolveHookFactoryShape(
  hookName: string,
  referencePatterns: ReferencePatternSummary | null | undefined,
): HookFactoryShape {
  const referenceModule = referencePatterns?.moduleMocks.find((entry) => entry.exportName === hookName);
  const mockVariableName = referenceModule?.mockVariableName ?? `mock${hookName.charAt(0).toUpperCase()}${hookName.slice(1)}`;
  return {
    shape: referenceModule?.returnShape,
    mockVariableName,
    factoryName: `create${mockVariableName.charAt(0).toUpperCase()}${mockVariableName.slice(1)}`,
  };
}

function normalizeLiteral(property: ReferenceShapeProperty): string {
  return property.kind === 'fn' ? mockFn() : property.literal;
}

function buildDefaultModuleStub(importName: string): string {
  if (/^[A-Z]/.test(importName)) {
    return '() => null';
  }
  return `{
    get: ${mockFn()},
    post: ${mockFn()},
    put: ${mockFn()},
    delete: ${mockFn()},
    patch: ${mockFn()},
  }`;
}

function shouldPreserveActual(modulePath: string, sourceImports: SourceImportUsage[]): boolean {
  return isLocalModule(modulePath) && sourceImports.some((entry) => entry.modulePath === modulePath || normalizePath(entry.modulePath) === normalizePath(modulePath));
}

function inferFallbackKey(shapeKind: 'array' | 'function' | 'object' | 'promise'): string {
  switch (shapeKind) {
    case 'array':
      return 'data';
    case 'function':
      return 'execute';
    case 'promise':
      return 'promise';
    case 'object':
    default:
      return 'value';
  }
}

function inferShapeLiteral(shapeKind: 'array' | 'function' | 'object' | 'promise'): string {
  switch (shapeKind) {
    case 'array':
      return '[]';
    case 'function':
      return mockFn();
    case 'promise':
      return 'Promise.resolve({})';
    case 'object':
    default:
      return '{}';
  }
}

function inferPropertyKind(shapeKind: 'array' | 'function' | 'object' | 'promise'): ReferenceShapeProperty['kind'] {
  switch (shapeKind) {
    case 'array':
      return 'array';
    case 'function':
      return 'fn';
    case 'promise':
    case 'object':
    default:
      return 'object';
  }
}

function findImportUsage(sourceImports: SourceImportUsage[], modulePath: string): SourceImportUsage | undefined {
  return sourceImports.find((entry) =>
    entry.modulePath === modulePath
    || normalizePath(entry.modulePath) === normalizePath(modulePath)
    || normalizePath(rebaseRelativeImport(entry.modulePath, undefined, undefined)) === normalizePath(modulePath),
  );
}

function resolveWellKnownHookModule(hookName: string): string | null {
  const wellKnown: Record<string, string> = {
    useNavigate: 'react-router-dom',
    useLocation: 'react-router-dom',
    useParams: 'react-router-dom',
    useSearchParams: 'react-router-dom',
    useQuery: '@tanstack/react-query',
    useMutation: '@tanstack/react-query',
    useQueryClient: '@tanstack/react-query',
    useSelector: 'react-redux',
    useDispatch: 'react-redux',
  };
  return wellKnown[hookName] ?? null;
}

function rebaseRelativeImport(
  importSource: string,
  sourceFilePath?: string,
  testFilePath?: string,
): string {
  if (!importSource.startsWith('.') || !sourceFilePath || !testFilePath) return importSource;

  const sourceDir = path.dirname(sourceFilePath);
  const testDir = path.dirname(testFilePath);
  const absoluteTarget = path.resolve(sourceDir, importSource);
  let rebased = path.relative(testDir, absoluteTarget).split('\\').join('/');
  if (!rebased.startsWith('.')) rebased = `./${rebased}`;
  return rebased.replace(/\.(tsx?|jsx?)$/, '');
}

function isLocalModule(modulePath: string): boolean {
  return modulePath.startsWith('.') || modulePath.startsWith('@/') || modulePath.startsWith('~/');
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\.(tsx?|jsx?)$/, '');
}

function splitTopLevel(value: string): string[] {
  const segments: string[] = [];
  let current = '';
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const prev = value[index - 1];

    if (quote) {
      current += char;
      if (char === quote && prev !== '\\') {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      current += char;
      continue;
    }

    if (char === '{' || char === '[' || char === '(') depth += 1;
    if (char === '}' || char === ']' || char === ')') depth -= 1;

    if (char === ',' && depth === 0) {
      if (current.trim().length > 0) segments.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim().length > 0) {
    segments.push(current.trim());
  }

  return segments;
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
