import "@testing-library/jest-dom";

// Mock window.matchMedia for components that use media queries
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Mock ResizeObserver
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

// Mock IntersectionObserver
global.IntersectionObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

// Suppress console errors/warnings in tests (optional, can be removed if you want to see them)
const originalError = console.error;
const originalWarn = console.warn;

beforeAll(() => {
  console.error = (...args: Parameters<typeof console.error>) => {
    // Filter out known React warnings that are not relevant for tests
    const message = args[0]?.toString() || "";
    if (
      message.includes("Warning: ReactDOM.render") ||
      message.includes("Warning: An update to") ||
      message.includes("act(...)") ||
      message.includes("Not implemented: HTMLFormElement.prototype.submit")
    ) {
      return;
    }
    originalError.apply(console, args);
  };

  console.warn = (...args: Parameters<typeof console.warn>) => {
    const message = args[0]?.toString() || "";
    if (
      message.includes("componentWillReceiveProps has been renamed") ||
      message.includes("React Router Future Flag Warning") ||
      message.includes("width(0) and height(0) of chart") ||
      message.includes("width(-1) and height(-1) of chart")
    ) {
      return;
    }
    originalWarn.apply(console, args);
  };
});

afterAll(() => {
  console.error = originalError;
  console.warn = originalWarn;
});

// Clean up any pending timers after each test
afterEach(() => {
  jest.clearAllTimers();
});

// Use fake timers to prevent Jest from hanging on setTimeout/setInterval
beforeAll(() => {
  jest.useFakeTimers({ advanceTimers: true });
});

afterAll(() => {
  jest.useRealTimers();
});
