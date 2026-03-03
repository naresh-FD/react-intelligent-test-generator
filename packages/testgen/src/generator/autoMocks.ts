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

  // Mock service/API imports
  for (const svcImport of component.serviceImports) {
    mocks.push(`jest.mock("${svcImport}");`);
  }

  return mocks;
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
