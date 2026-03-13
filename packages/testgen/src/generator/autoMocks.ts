/**
 * Auto-mocking system for third-party libraries.
 *
 * Generates jest.mock() calls based on detected component dependencies.
 * These mocks are placed between imports and describe blocks in generated tests.
 * Each mock provides a minimal working stub that prevents crashes.
 */
import { ComponentInfo } from '../analyzer';

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
    mocks.push(`jest.mock("${svcImport}");`);
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
      mocks.push(`jest.mock("${hook.importSource}", () => ({
  ...jest.requireActual("${hook.importSource}"),
  ${hook.name}: jest.fn(() => (${mockReturn})),
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
    return `{ data: [], ${resourceLower}: [], loading: false, isLoading: false, error: null, isError: false, refetch: jest.fn(), isFetching: false }`;
  }

  // Context consumer hooks (useAuth, useTheme, useNotification, etc.)
  if (/^useAuth/i.test(hookName)) {
    return `{ user: { id: "1", name: "Test User" }, isAuthenticated: true, login: jest.fn(), logout: jest.fn(), token: "mock-token" }`;
  }
  if (/^use(Theme|Style)/i.test(hookName)) {
    return `{ theme: "light", toggleTheme: jest.fn() }`;
  }
  if (/^use(Notification|Toast|Alert|Snackbar)/i.test(hookName)) {
    return `{ show: jest.fn(), hide: jest.fn(), notifications: [] }`;
  }

  // Navigation/routing hooks
  if (/^use(Navigate|Navigation|Router|History)/i.test(hookName)) {
    return `jest.fn()`;
  }

  // Media query / responsive hooks
  if (/^use(Mobile|Tablet|iPad|Desktop|MediaQuery|Responsive|Breakpoint|FirstRender)/i.test(hookName)) {
    return `false`;
  }

  // Search hooks
  if (/^useSearch/i.test(hookName)) {
    return `{ query: "", results: [], search: jest.fn(), clear: jest.fn(), loading: false }`;
  }

  // Feature/flag hooks
  if (/^use(Feature|Flag|Toggle|Dated)/i.test(hookName)) {
    return `{ enabled: false, value: null }`;
  }

  // MDP/API call hooks (from the intrafi project)
  if (/^use(MDP|API|Http)/i.test(hookName)) {
    return `{ data: null, loading: false, error: null, execute: jest.fn(), refetch: jest.fn() }`;
  }

  // Generic hook — return safe object with common properties
  return `{ data: [], ${resourceLower}: [], loading: false, isLoading: false, error: null, value: null, setValue: jest.fn(), refetch: jest.fn() }`;
}

// ---------------------------------------------------------------------------
// Individual mock builders
// ---------------------------------------------------------------------------

function buildFramerMotionMock(): string {
  return `jest.mock("framer-motion", () => {
  const React = require("react");
  const motion = new Proxy({}, {
    get: (_target, tag) => {
      const comp = React.forwardRef((props, ref) => {
        const { initial, animate, exit, transition, whileHover, whileTap, whileFocus,
                whileInView, variants, layout, layoutId, drag, dragConstraints,
                onDragEnd, onAnimationComplete, ...rest } = props;
        return React.createElement(String(tag), { ...rest, ref });
      });
      comp.displayName = \`motion.\${String(tag)}\`;
      return comp;
    }
  });
  return {
    __esModule: true,
    motion,
    AnimatePresence: ({ children }) => React.createElement(React.Fragment, null, children),
    useAnimation: () => ({ start: jest.fn(), stop: jest.fn(), set: jest.fn() }),
    useMotionValue: (init) => ({ get: () => init, set: jest.fn(), onChange: jest.fn() }),
    useTransform: () => ({ get: () => 0, set: jest.fn() }),
    useInView: () => true,
    useScroll: () => ({ scrollY: { get: () => 0 }, scrollX: { get: () => 0 } }),
    useSpring: (val) => ({ get: () => (typeof val === "number" ? val : 0), set: jest.fn() }),
    useReducedMotion: () => false,
  };
});`;
}

function buildRechartsMock(): string {
  return `jest.mock("recharts", () => {
  const React = require("react");
  const MockChart = ({ children, ...props }) => React.createElement("div", { "data-testid": "mock-chart", ...props }, children);
  const MockElement = (props) => React.createElement("div", props);
  return {
    __esModule: true,
    ResponsiveContainer: ({ children }) => React.createElement("div", { style: { width: 500, height: 300 } }, typeof children === "function" ? children(500, 300) : children),
    PieChart: MockChart, AreaChart: MockChart, BarChart: MockChart, LineChart: MockChart,
    ComposedChart: MockChart, RadarChart: MockChart, RadialBarChart: MockChart, ScatterChart: MockChart,
    Treemap: MockChart, Sankey: MockChart, FunnelChart: MockChart,
    Pie: MockElement, Area: MockElement, Bar: MockElement, Line: MockElement,
    XAxis: MockElement, YAxis: MockElement, ZAxis: MockElement,
    CartesianGrid: MockElement, Tooltip: MockElement, Legend: MockElement,
    Cell: MockElement, Label: MockElement, LabelList: MockElement,
    Brush: MockElement, ReferenceLine: MockElement, ReferenceArea: MockElement,
    Radar: MockElement, RadialBar: MockElement, Scatter: MockElement, Funnel: MockElement,
  };
});`;
}

function buildAxiosMock(): string {
  return `jest.mock("axios", () => {
  const mockResponse = { data: {}, status: 200, statusText: "OK", headers: {}, config: {} };
  const mockInstance = {
    get: jest.fn().mockResolvedValue(mockResponse),
    post: jest.fn().mockResolvedValue(mockResponse),
    put: jest.fn().mockResolvedValue(mockResponse),
    delete: jest.fn().mockResolvedValue(mockResponse),
    patch: jest.fn().mockResolvedValue(mockResponse),
    request: jest.fn().mockResolvedValue(mockResponse),
    interceptors: { request: { use: jest.fn(), eject: jest.fn() }, response: { use: jest.fn(), eject: jest.fn() } },
    defaults: { headers: { common: {} } },
  };
  return {
    __esModule: true,
    default: { ...mockInstance, create: jest.fn(() => ({ ...mockInstance })) },
    ...mockInstance,
    create: jest.fn(() => ({ ...mockInstance })),
  };
});`;
}
