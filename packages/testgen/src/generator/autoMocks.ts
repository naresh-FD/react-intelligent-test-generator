/**
 * Auto-mocking system for third-party libraries.
 *
 * Generates jest.mock() calls based on detected component dependencies.
 * These mocks are placed between imports and describe blocks in generated tests.
 * Each mock provides a minimal working stub that prevents crashes.
 */
import { ComponentInfo } from '../analyzer';
import { mockFn, mockGlobalName, mockModuleFn } from '../utils/framework';

/**
 * Generate jest.mock() calls for third-party libraries detected in the component.
 * Mocks are deterministic and prevent side effects (API calls, animations, canvas).
 */
export function buildAutoMocks(component: ComponentInfo): string[] {
  const mocks: string[] = [];

  // Mock framer-motion (Proxy-based: motion.div, motion.span, etc.)
  if (component.usesFramerMotion) {
    mocks.push(buildFramerMotionMock());
  }

  // Mock recharts (all chart components → div stubs)
  if (component.usesRecharts) {
    mocks.push(buildRechartsMock());
  }

  // Mock axios if imported
  if (component.thirdPartyImports.includes('axios')) {
    mocks.push(buildAxiosMock());
  }

  // Mock service/API imports with smart return values
  for (const svcImport of component.serviceImports) {
    mocks.push(`${mockModuleFn()}("${svcImport}");`);
  }

  // Mock custom hooks that consume context/data to return safe defaults
  // This prevents "Cannot read properties of undefined (reading 'map')" errors
  const mockedSources = new Set<string>();
  for (const hook of component.hooks) {
    if (!hook.importSource) continue;
    // Skip React internals, testing-library, and already-mocked third-party
    if (hook.importSource === 'react' || hook.importSource.includes('@testing-library')) continue;
    if (hook.importSource.includes('react-router')) continue;
    if (hook.importSource.includes('@tanstack/react-query')) continue;
    if (hook.importSource.includes('react-redux')) continue;
    // Skip if the import source is already mocked by service imports
    if (component.serviceImports.includes(hook.importSource)) continue;
    // Skip if we already mocked this source
    if (mockedSources.has(hook.importSource)) continue;

    // Only mock hooks from relative imports (project-internal hooks)
    if (hook.importSource.startsWith('.') || hook.importSource.startsWith('@/') || hook.importSource.startsWith('~/')) {
      const mockReturn = buildHookMockReturnValue(hook.name);
      mocks.push(`${mockModuleFn()}("${hook.importSource}", () => ({
  ${hook.name}: ${mockGlobalName()}.fn(() => (${mockReturn})),
}));`);
      mockedSources.add(hook.importSource);
    }
  }

  return mocks;
}

// ---------------------------------------------------------------------------
// Hook mock return value builder
// ---------------------------------------------------------------------------

/**
 * Build a smart mock return value for a custom hook based on naming conventions.
 * Prevents "Cannot read properties of undefined" errors by returning safe defaults.
 */
function buildHookMockReturnValue(hookName: string): string {
  // Extract the resource name from the hook (e.g., useGetTransactions → Transactions)
  const nameMatch = hookName.match(/^use(?:Get|Fetch|Load|Query)?([A-Z]\w*)/);
  const resource = nameMatch ? nameMatch[1] : '';
  const resourceLower = resource ? resource.charAt(0).toLowerCase() + resource.slice(1) : 'data';

  // Data-fetching hooks
  if (/^use(Get|Fetch|Load|Query)/i.test(hookName)) {
    return `{ data: [], ${resourceLower}: [], loading: false, isLoading: false, error: null, isError: false, refetch: ${mockFn()}, isFetching: false }`;
  }

  // Context consumer hooks (useAuth, useTheme, useNotification, etc.)
  if (/^useAuth/i.test(hookName)) {
    return `{ user: { id: "1", name: "Test User" }, isAuthenticated: true, login: ${mockFn()}, logout: ${mockFn()}, token: "mock-token" }`;
  }
  if (/^use(Theme|Style)/i.test(hookName)) {
    return `{ theme: "light", toggleTheme: ${mockFn()} }`;
  }
  if (/^use(Notification|Toast|Alert|Snackbar)/i.test(hookName)) {
    return `{ show: ${mockFn()}, hide: ${mockFn()}, notifications: [] }`;
  }

  // Navigation/routing hooks
  if (/^use(Navigate|Navigation|Router|History)/i.test(hookName)) {
    return `${mockFn()}`;
  }

  // Media query / responsive hooks
  if (/^use(Mobile|Tablet|iPad|Desktop|MediaQuery|Responsive|Breakpoint|FirstRender)/i.test(hookName)) {
    return `false`;
  }

  // Search hooks
  if (/^useSearch/i.test(hookName)) {
    return `{ query: "", results: [], search: ${mockFn()}, clear: ${mockFn()}, loading: false }`;
  }

  // Feature/flag hooks
  if (/^use(Feature|Flag|Toggle|Dated)/i.test(hookName)) {
    return `{ enabled: false, value: null }`;
  }

  // MDP/API call hooks (from the intrafi project)
  if (/^use(MDP|API|Http)/i.test(hookName)) {
    return `{ data: null, loading: false, error: null, execute: ${mockFn()}, refetch: ${mockFn()} }`;
  }

  // Generic hook — return safe object with common properties
  return `{ data: [], ${resourceLower}: [], loading: false, isLoading: false, error: null, value: null, setValue: ${mockFn()}, refetch: ${mockFn()} }`;
}

// ---------------------------------------------------------------------------
// Individual mock builders
// ---------------------------------------------------------------------------

function buildFramerMotionMock(): string {
  return `${mockModuleFn()}("framer-motion", () => ({
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
}));`;
}

function buildRechartsMock(): string {
  return `${mockModuleFn()}("recharts", () => ({
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
}));`;
}

function buildAxiosMock(): string {
  return `${mockModuleFn()}("axios", () => {
  const mockResponse = { data: {}, status: 200, statusText: "OK", headers: {}, config: {} };
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
});`;
}
