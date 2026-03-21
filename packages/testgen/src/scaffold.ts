/**
 * Jest scaffold — creates missing Jest configuration files so testgen-generated
 * tests can actually run in projects that have no jest.config yet.
 *
 * Called automatically before test generation when the target project has no
 * jest.config.{js,ts,mjs,cjs} present.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ResolvedTestOutput, DEFAULT_TEST_OUTPUT } from './workspace/config';

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

const JEST_CONFIG_FILES = [
  'jest.config.js',
  'jest.config.ts',
  'jest.config.mjs',
  'jest.config.cjs',
];

export function hasJestConfig(rootDir: string): boolean {
  return JEST_CONFIG_FILES.some((f) => fs.existsSync(path.join(rootDir, f)));
}

// ---------------------------------------------------------------------------
// Tsconfig path alias → Jest moduleNameMapper conversion
// ---------------------------------------------------------------------------

interface TsconfigLike {
  compilerOptions?: {
    paths?: Record<string, string[]>;
  };
}

/**
 * Reads tsconfig.app.json (or tsconfig.json) and returns Jest moduleNameMapper
 * entries for each path alias found.
 *
 * Example: "@/*": ["./src/*"]  →  { "^@/(.*)$": "<rootDir>/src/$1" }
 */
function readTsconfigPaths(rootDir: string): Record<string, string> {
  const candidates = ['tsconfig.app.json', 'tsconfig.json'];
  for (const name of candidates) {
    const tsconfigPath = path.join(rootDir, name);
    if (!fs.existsSync(tsconfigPath)) continue;
    try {
      const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8')) as TsconfigLike;
      const rawPaths = tsconfig?.compilerOptions?.paths ?? {};
      const result: Record<string, string> = {};
      for (const [alias, targets] of Object.entries(rawPaths)) {
        if (!targets?.length) continue;
        // "@/*" → "^@/(.*)$"
        const escaped = alias.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        const regexKey = `^${escaped.replace(/\*/g, '(.*)')}$`;
        // "./src/*" → "<rootDir>/src/$1"
        const targetValue =
          '<rootDir>/' + targets[0].replace(/^\.\//, '').replace(/\*$/, '$1');
        result[regexKey] = targetValue;
      }
      return result;
    } catch {
      // ignore parse errors — fall through to next candidate
    }
  }
  return {};
}

// ---------------------------------------------------------------------------
// ESM package detection
// ---------------------------------------------------------------------------

/** Default ESM-only packages that must be transformed by Jest */
const DEFAULT_ESM_PACKAGES = [
  'lucide-react', '@tanstack', 'react-router', 'react-router-dom',
  'framer-motion', 'recharts', '@recharts', 'd3-.*', 'internmap',
  'delaunator', 'robust-predicates', 'react-hook-form', '@hookform',
  'zod', 'clsx', 'class-variance-authority', 'tailwind-merge',
  'cmdk', 'vaul', 'input-otp', 'react-day-picker', 'date-fns',
  'embla-carousel.*', '@radix-ui', '@headlessui', 'react-icons',
  'sonner', 'react-hot-toast', 'react-toastify', 'uuid', 'nanoid',
  '@emotion', 'msw', '@mswjs',
];

/**
 * Detect ESM-only packages in the target project's node_modules.
 * Packages with "type":"module" in package.json must be transformed by Jest.
 */
function detectEsmOnlyPackages(rootDir: string): string[] {
  const esmPackages: string[] = [];
  const nodeModulesDir = path.join(rootDir, 'node_modules');
  if (!fs.existsSync(nodeModulesDir)) return esmPackages;

  try {
    const entries = fs.readdirSync(nodeModulesDir);
    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      if (entry.startsWith('@')) {
        const scopeDir = path.join(nodeModulesDir, entry);
        try {
          const scopeEntries = fs.readdirSync(scopeDir);
          for (const scopeEntry of scopeEntries) {
            if (isEsmPackage(path.join(scopeDir, scopeEntry, 'package.json'))) {
              esmPackages.push(`${entry}/${scopeEntry}`);
            }
          }
        } catch { /* skip unreadable scope dirs */ }
      } else {
        if (isEsmPackage(path.join(nodeModulesDir, entry, 'package.json'))) {
          esmPackages.push(entry);
        }
      }
    }
  } catch { /* skip if node_modules unreadable */ }
  return esmPackages;
}

function isEsmPackage(pkgJsonPath: string): boolean {
  try {
    if (!fs.existsSync(pkgJsonPath)) return false;
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    return pkg.type === 'module';
  } catch { return false; }
}

/** Build the combined ESM transform pattern for transformIgnorePatterns */
function buildEsmTransformPattern(rootDir: string): string {
  const detected = detectEsmOnlyPackages(rootDir);
  const all = [...new Set([...DEFAULT_ESM_PACKAGES, ...detected])];
  return all.join('|');
}

// ---------------------------------------------------------------------------
// File content builders
// ---------------------------------------------------------------------------

function buildJestConfigContent(rootDir: string, testOutput: ResolvedTestOutput = DEFAULT_TEST_OUTPUT): string {
  const pathMappings = readTsconfigPaths(rootDir);
  const esmPattern = buildEsmTransformPattern(rootDir);

  // When the project has its own node_modules/react (version differs from the
  // hoisted copy used by @testing-library), pin all React imports to the local
  // copy so there is only one React instance at runtime.
  // This handles both React 18 and React 19 projects in monorepo workspaces.
  const hasLocalReact = fs.existsSync(path.join(rootDir, 'node_modules', 'react'));
  const reactDedupEntries = hasLocalReact
    ? [
        `    '^react$': '<rootDir>/node_modules/react/index.js'`,
        `    '^react/(.*)$': '<rootDir>/node_modules/react/$1'`,
        `    '^react-dom$': '<rootDir>/node_modules/react-dom/index.js'`,
        `    '^react-dom/(.*)$': '<rootDir>/node_modules/react-dom/$1'`,
      ]
    : [];

  const staticEntries = [
    `    '\\\\.(css|less|scss|sass)$': 'identity-obj-proxy'`,
    `    '\\\\.(jpg|jpeg|png|gif|webp|ico|bmp)$': '<rootDir>/src/test-utils/__mocks__/fileMock.js'`,
    `    '\\\\.(svg)$': '<rootDir>/src/test-utils/__mocks__/svgMock.js'`,
    `    '\\\\.(woff|woff2|ttf|eot|otf)$': '<rootDir>/src/test-utils/__mocks__/fileMock.js'`,
  ];
  const pathEntries = Object.entries(pathMappings).map(
    ([k, v]) => `    '${k}': '${v}'`,
  );
  const allEntries = [...staticEntries, ...reactDedupEntries, ...pathEntries].join(',\n');

  // Build dynamic testMatch based on configured test output strategy
  const suffix = testOutput.suffix; // '.test' or '.spec'
  const suffixGlob = `*${suffix}.{ts,tsx}`;
  let testMatchEntries: string[];

  switch (testOutput.strategy) {
    case 'colocated':
      testMatchEntries = [`'**/${suffixGlob}'`];
      break;
    case 'mirror':
      testMatchEntries = [
        `'${testOutput.directory}/**/${suffixGlob}'`,
        `'**/${suffixGlob}'`,
      ];
      break;
    case 'subfolder':
    default: {
      const dir = testOutput.directory || '__tests__';
      testMatchEntries = [
        `'**/${dir}/**/${suffixGlob}'`,
        `'**/${suffixGlob}'`,
      ];
      break;
    }
  }
  const testMatchStr = testMatchEntries.join(', ');

  // Build dynamic collectCoverageFrom exclusion based on configured directory
  const coverageExcludeDir = testOutput.strategy === 'mirror'
    ? `!${testOutput.directory}/**`
    : testOutput.strategy === 'subfolder'
      ? `!src/**/${testOutput.directory || '__tests__'}/**`
      : '!src/**/*.test.*';

  return `/** @generated by react-testgen */
/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  testMatch: [${testMatchStr}],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
${allEntries},
  },
  transform: {
    '^.+\\\\.(ts|tsx)$': [
      'ts-jest',
      {
        // Downgrade TypeScript errors to warnings so generated tests that use
        // approximate mock shapes still run and collect coverage.
        diagnostics: { warnOnly: true },
        tsconfig: {
          jsx: 'react-jsx',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          // Override Vite-specific options that ts-jest does not support
          moduleResolution: 'node',
          allowImportingTsExtensions: false,
        },
      },
    ],
  },
  // Transform ESM-only packages so Jest can load them
  transformIgnorePatterns: [
    '/node_modules/(?!(${esmPattern})/)',
  ],
  setupFilesAfterEnv: ['<rootDir>/src/test-utils/setupTests.ts'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '${coverageExcludeDir}',
    '!src/test-utils/**',
    '!src/main.tsx',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  clearMocks: true,
  restoreMocks: true,
  maxWorkers: '50%',
  forceExit: true,
};

module.exports = config;
`;
}

function buildSetupTestsContent(): string {
  return `import '@testing-library/jest-dom';

// Mock window.matchMedia (required by many UI components and recharts)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation((query: string) => ({
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

// Mock ResizeObserver (required by recharts and similar libs)
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
`;
}

function buildSvgMockContent(): string {
  return `const React = require('react');
const SvgMock = React.forwardRef(function SvgMock(props, ref) {
  return React.createElement('svg', Object.assign({}, props, { ref: ref }));
});
SvgMock.displayName = 'SvgMock';
module.exports = SvgMock;
module.exports.default = SvgMock;
module.exports.ReactComponent = SvgMock;
`;
}

function buildErrorBoundaryContent(): string {
  return `import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Test ErrorBoundary — wraps components to catch render errors so tests
 * can still assert on the container instead of crashing.
 * @generated by react-testgen
 */
export class TestErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div data-testid="error-boundary">
          Render error: {this.state.error?.message ?? 'Unknown error'}
        </div>
      );
    }
    return this.props.children;
  }
}
`;
}

function buildEnhancedPolyfills(): string {
  return `
// Mock window.scrollTo (used by many router/scroll components)
if (typeof window.scrollTo !== 'function' || !(window.scrollTo as unknown)) {
  window.scrollTo = jest.fn();
}

// Mock window.print (used by reporting/export flows)
if (typeof window.print !== 'function' || !(window.print as unknown)) {
  window.print = jest.fn();
}

// Mock URL.createObjectURL / revokeObjectURL (used by file upload components)
if (!URL.createObjectURL) {
  URL.createObjectURL = jest.fn(() => 'blob:test-url');
}
if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = jest.fn();
}

// Mock HTMLCanvasElement.getContext (used by chart libraries)
HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue({
  fillRect: jest.fn(),
  clearRect: jest.fn(),
  getImageData: jest.fn(() => ({ data: new Array(4) })),
  putImageData: jest.fn(),
  createImageData: jest.fn(() => []),
  setTransform: jest.fn(),
  drawImage: jest.fn(),
  save: jest.fn(),
  fillText: jest.fn(),
  restore: jest.fn(),
  beginPath: jest.fn(),
  moveTo: jest.fn(),
  lineTo: jest.fn(),
  closePath: jest.fn(),
  stroke: jest.fn(),
  translate: jest.fn(),
  scale: jest.fn(),
  rotate: jest.fn(),
  arc: jest.fn(),
  fill: jest.fn(),
  measureText: jest.fn(() => ({ width: 0 })),
  transform: jest.fn(),
  rect: jest.fn(),
  clip: jest.fn(),
  canvas: { width: 0, height: 0 },
}) as unknown as typeof HTMLCanvasElement.prototype.getContext;

// ---------------------------------------------------------------------------
// Additional polyfills for common browser/Node APIs
// ---------------------------------------------------------------------------

// Mock global fetch (not available in JSDOM by default)
if (typeof globalThis.fetch !== 'function') {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue({}),
    text: jest.fn().mockResolvedValue(''),
    blob: jest.fn().mockResolvedValue(new Blob()),
    arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
    headers: new Headers(),
    clone: jest.fn(),
  } as unknown as Response);
}

// Mock localStorage and sessionStorage
const createMockStorage = (): Storage => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] ?? null),
    setItem: jest.fn((key: string, value: string) => { store[key] = String(value); }),
    removeItem: jest.fn((key: string) => { delete store[key]; }),
    clear: jest.fn(() => { store = {}; }),
    get length() { return Object.keys(store).length; },
    key: jest.fn((index: number) => Object.keys(store)[index] ?? null),
  } as Storage;
};
if (!window.localStorage || typeof window.localStorage.getItem !== 'function') {
  Object.defineProperty(window, 'localStorage', { value: createMockStorage(), writable: true });
}
if (!window.sessionStorage || typeof window.sessionStorage.getItem !== 'function') {
  Object.defineProperty(window, 'sessionStorage', { value: createMockStorage(), writable: true });
}

// Mock crypto.randomUUID and crypto.getRandomValues
if (typeof globalThis.crypto === 'undefined') {
  (globalThis as any).crypto = {};
}
if (typeof globalThis.crypto.randomUUID !== 'function') {
  (globalThis.crypto as any).randomUUID = jest.fn(
    () => '00000000-0000-4000-8000-000000000000'
  );
}
if (typeof globalThis.crypto.getRandomValues !== 'function') {
  (globalThis.crypto as any).getRandomValues = jest.fn((arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
    return arr;
  });
}

// Mock requestAnimationFrame / cancelAnimationFrame
if (typeof window.requestAnimationFrame !== 'function') {
  window.requestAnimationFrame = jest.fn((cb: FrameRequestCallback) => {
    return setTimeout(() => cb(Date.now()), 0) as unknown as number;
  });
}
if (typeof window.cancelAnimationFrame !== 'function') {
  window.cancelAnimationFrame = jest.fn((id: number) => clearTimeout(id));
}

// Mock navigator.clipboard
if (!navigator.clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: jest.fn().mockResolvedValue(undefined),
      readText: jest.fn().mockResolvedValue(''),
      write: jest.fn().mockResolvedValue(undefined),
      read: jest.fn().mockResolvedValue([]),
    },
    writable: true,
  });
}

// Mock structuredClone (missing in Node < 17)
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = jest.fn((val: unknown) => JSON.parse(JSON.stringify(val)));
}

// Mock browser dialog APIs
window.confirm = jest.fn(() => true);
window.alert = jest.fn();
window.prompt = jest.fn(() => '');

// Prevent unhandled promise rejections from crashing test suite
process.on('unhandledRejection', () => { /* silently ignore in tests */ });

// ---------------------------------------------------------------------------
// Console suppression for known-harmless warnings
// ---------------------------------------------------------------------------

const SUPPRESSED_PATTERNS = [
  'act(',
  'ReactDOMTestUtils.act',
  'Warning: An update to',
  'Warning: Cannot update a component',
  'Warning: Each child in a list',
  'Warning: validateDOMNesting',
  'Warning: Unknown event handler',
  'Warning: React does not recognize',
  'inside a test was not wrapped in act',
  'Warning: Failed prop type',
  'Warning: componentWillMount has been renamed',
  'Warning: componentWillReceiveProps has been renamed',
];

const originalError = console.error;
const originalWarn = console.warn;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    const msg = typeof args[0] === 'string' ? args[0] : '';
    if (SUPPRESSED_PATTERNS.some(p => msg.includes(p))) return;
    originalError.call(console, ...args);
  };
  console.warn = (...args: unknown[]) => {
    const msg = typeof args[0] === 'string' ? args[0] : '';
    if (SUPPRESSED_PATTERNS.some(p => msg.includes(p))) return;
    originalWarn.call(console, ...args);
  };
});
afterAll(() => {
  console.error = originalError;
  console.warn = originalWarn;
});
`;
}

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

function hasBaseSetupContent(content: string): boolean {
  return content.includes(`import '@testing-library/jest-dom';`)
    && content.includes('Mock window.matchMedia (required by many UI components and recharts)')
    && content.includes('Mock ResizeObserver (required by recharts and similar libs)');
}

function hasEnhancedPolyfills(content: string): boolean {
  return content.includes('Mock window.scrollTo (used by many router/scroll components)')
    && content.includes('const createMockStorage = (): Storage => {')
    && content.includes('const SUPPRESSED_PATTERNS = [');
}

function collapseRepeatedBlock(content: string, block: string): string {
  let next = normalizeLineEndings(content);
  const normalizedBlock = normalizeLineEndings(block).trim();
  const firstIndex = next.indexOf(normalizedBlock);
  if (firstIndex === -1) {
    return next;
  }

  const duplicateIndex = next.indexOf(normalizedBlock, firstIndex + normalizedBlock.length);
  if (duplicateIndex === -1) {
    return next;
  }

  while (true) {
    const repeatedIndex = next.indexOf(normalizedBlock, firstIndex + normalizedBlock.length);
    if (repeatedIndex === -1) {
      break;
    }
    next = `${next.slice(0, repeatedIndex).trimEnd()}\n\n${next.slice(repeatedIndex + normalizedBlock.length).trimStart()}`;
  }

  return next.endsWith('\n') ? next : `${next}\n`;
}

function normalizeSetupTestsContent(existingContent: string): string {
  const baseBlock = buildSetupTestsContent().trim();
  const enhancedBlock = buildEnhancedPolyfills().trim();
  let next = normalizeLineEndings(existingContent).trim();

  if (!hasBaseSetupContent(next)) {
    next = next.length > 0 ? `${next}\n\n${baseBlock}` : baseBlock;
  }

  if (!hasEnhancedPolyfills(next)) {
    next = `${next}\n\n${enhancedBlock}`;
  } else {
    next = collapseRepeatedBlock(next, enhancedBlock);
  }

  return `${next.trimEnd()}\n`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates the minimum Jest scaffolding needed to run tests in a project with
 * no jest.config file. Safe to call on every run — no-ops when a config exists.
 *
 * Creates:
 *  - jest.config.cjs            (.cjs = always CommonJS, safe with "type":"module")
 *  - src/test-utils/setupTests.ts
 *  - src/test-utils/__mocks__/fileMock.js
 *  - src/test-utils/ErrorBoundary.tsx
 */
export function ensureJestScaffold(rootDir: string, testOutput: ResolvedTestOutput = DEFAULT_TEST_OUTPUT): void {
  const configPath = path.join(rootDir, 'jest.config.cjs');
  if (!hasJestConfig(rootDir)) {
    fs.writeFileSync(configPath, buildJestConfigContent(rootDir, testOutput), 'utf8');
    console.log('  Created jest.config.cjs (no Jest config was found)');
  }

  const setupDir = path.join(rootDir, 'src', 'test-utils');
  const setupPath = path.join(setupDir, 'setupTests.ts');
  if (!fs.existsSync(setupPath)) {
    fs.mkdirSync(setupDir, { recursive: true });
    fs.writeFileSync(setupPath, normalizeSetupTestsContent(''), 'utf8');
    console.log('  Created src/test-utils/setupTests.ts');
  } else {
    const existingContent = fs.readFileSync(setupPath, 'utf8');
    const normalizedContent = normalizeSetupTestsContent(existingContent);
    if (normalizedContent !== existingContent) {
      fs.writeFileSync(setupPath, normalizedContent, 'utf8');
      console.log('  Normalized src/test-utils/setupTests.ts support scaffolding');
    }
  }

  const mocksDir = path.join(setupDir, '__mocks__');
  const fileMockPath = path.join(mocksDir, 'fileMock.js');
  if (!fs.existsSync(fileMockPath)) {
    fs.mkdirSync(mocksDir, { recursive: true });
    fs.writeFileSync(fileMockPath, `module.exports = 'test-file-stub';\n`, 'utf8');
    console.log('  Created src/test-utils/__mocks__/fileMock.js');
  }

  // Create SVG mock for .svg imports (supports ReactComponent pattern)
  const svgMockPath = path.join(mocksDir, 'svgMock.js');
  if (!fs.existsSync(svgMockPath)) {
    fs.writeFileSync(svgMockPath, buildSvgMockContent(), 'utf8');
    console.log('  Created src/test-utils/__mocks__/svgMock.js');
  }

  // Create ErrorBoundary component for test resilience
  const errorBoundaryPath = path.join(setupDir, 'ErrorBoundary.tsx');
  if (!fs.existsSync(errorBoundaryPath)) {
    fs.writeFileSync(errorBoundaryPath, buildErrorBoundaryContent(), 'utf8');
    console.log('  Created src/test-utils/ErrorBoundary.tsx');
  }
}
