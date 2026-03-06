# Copilot Prompt: React Test Generator — Stability Hardening

> Branch: `fix/react-test-generator-stability-hardening`
> Scope: `packages/testgen/` only (ignore `examples/`)

---

## Goal

Harden a deterministic (no AI) React test generator CLI so that every generated test file **compiles and passes on the first run**. The tool uses ts-morph for AST analysis, generates Jest/Vitest test files for React components, hooks, utilities, context providers, and state management stores. This branch adds four defense layers, expands file-type coverage, and introduces configurable test output locations.

---

## Architecture Overview

### Four Defense Layers (applied in order)

1. **Scaffold** — Auto-create `jest.config.cjs`, `setupTests.ts`, polyfills, and `ErrorBoundary.tsx` when the project has no Jest config. Handles ESM-only packages, tsconfig path aliases, and React deduplication.

2. **Safe Generation** — Every render call is wrapped in try-catch. Every query uses `queryBy*` (returns null) instead of `getBy*` (throws). Auto-mock third-party libraries (framer-motion, recharts, axios). Detect and wrap with required providers (Router, QueryClient, Redux, custom contexts).

3. **Self-Heal** — After Jest runs, pattern-match error messages against 25+ fix rules. Apply deterministic code patches (add missing imports, wrap with providers, fix default exports, suppress TypeScript errors). Escalate through 4 tiers across 5 retry attempts.

4. **Guaranteed Pass** — If a test still fails after all retries, replace it with a tiered smoke test (module import + type check + safe render). If even that fails, delete the test file. Never commit a red test.

### New File Types Supported

| File Type | Detector | Generator |
|-----------|----------|-----------|
| React Component | `analyzeSourceFile()` | `generator/index.ts` |
| Barrel/Index | `isBarrelFile()` | `generator/barrel.ts` |
| Context Provider | `isContextProviderFile()` | `generator/context.ts` |
| Zustand/RTK/Jotai Store | `isStoreFile()` | `generator/store.ts` |
| Utility/Service | `isServiceFile()` + fallback | `generator/utility.ts` |

### Configurable Test Output

Users configure `react-testgen.config.json` with a `testOutput` field:

```jsonc
{
  "version": 1,
  "defaults": {
    "testOutput": {
      "strategy": "colocated",     // "colocated" | "subfolder" | "mirror"
      "directory": "__tests__",    // folder name (subfolder) or root dir (mirror)
      "srcRoot": "src",            // source root to strip (mirror only)
      "suffix": ".test"            // ".test" | ".spec"
    }
  }
}
```

---

## Files to Create (13 new files)

All paths relative to `packages/testgen/src/`.

### `generator/autoMocks.ts`

Auto-generates `jest.mock()` calls for third-party libraries detected in components.

```typescript
export function buildAutoMocks(component: ComponentInfo): string[]
```

Logic:
- If `component.usesFramerMotion` → generate framer-motion mock with Proxy-based `motion` object, `AnimatePresence` passthrough, stub hooks (`useAnimation`, `useMotionValue`, `useInView`, `useScroll`, etc.)
- If `component.usesRecharts` → generate recharts mock with stub chart components (`PieChart`, `BarChart`, `LineChart`, etc.) and `ResponsiveContainer` that calls children as function
- If `component.thirdPartyImports` includes `'axios'` → generate axios mock with `get/post/put/delete/patch` as `jest.fn().mockResolvedValue(defaultResponse)`, plus `interceptors` and `create`
- For each `component.serviceImports` → generate simple `jest.mock("path")`
- Deduplicate: skip mocks already present in the test file's imports section

### `generator/barrel.ts`

Generate tests for barrel/index files (files that are 70%+ export/import statements).

```typescript
export function generateBarrelTest(
  sourceFile: SourceFile,
  testFilePath: string,
  sourceFilePath: string
): string | null
```

Logic:
- Extract all named exports from the source file
- Generate one `it()` per export: `expect(ExportName).toBeDefined()`
- Return null if no named exports found

### `generator/context.ts`

Generate tests for React Context provider files (files with `createContext` + exported `Provider`).

```typescript
export function generateContextTest(
  sourceFile: SourceFile,
  checker: TypeChecker,
  testFilePath: string,
  sourceFilePath: string
): string | null
```

Logic:
- Detect exported context, provider component, and consumer hook
- Detect dependencies (Router, QueryClient, Redux, custom contexts from config)
- Generate tests: provider renders, hook returns expected shape, state updates work
- Wrap in required providers based on detected dependencies
- Use three-tier context value factory from `contextValues.ts`

### `generator/contextValues.ts`

Three-tier factory for generating deterministic mock values for React Context shapes.

```typescript
export interface ContextMockValue {
  declaration: string;    // e.g. "const mockValue = { user: null, setUser: jest.fn() };"
  variableName: string;   // e.g. "mockValue"
}

export function generateContextMockValue(
  context: ContextExport,
  project: Project,
  checker: TypeChecker
): ContextMockValue | null
```

Tiers:
1. Parse `createContext()` default argument from AST
2. Extract TypeScript type of the context and generate mock values per field
3. Fallback: scan consumer hook for consumed keys, generate stubs

### `generator/contextVariants.ts`

Generate toggle-based variant tests for context-consuming components.

```typescript
export interface ContextVariantTest {
  testName: string;
  overrides: Record<string, string>;  // key → override expression
}

export function buildContextVariantTests(
  component: ComponentInfo,
  contextMocks: ContextMockValue[]
): ContextVariantTest[]
```

Logic:
- For boolean keys consumed by the component → generate `true`/`false` toggle tests
- For nullable keys → generate `null` toggle test
- For array keys → generate empty-array toggle test
- Only generate variants for keys actually referenced by the component

### `generator/safePatterns.ts`

Safe test patterns that guarantee no uncaught exceptions.

```typescript
export function buildSafeRenderBlock(
  renderCall?: string,
  extraAssertions?: string[]
): string[]

export function buildSafeInteractionBlock(
  queryExpr: string,
  interactionLines: string[]
): string[]
```

Logic:
- `buildSafeRenderBlock`: wraps `render()` in try-catch, falls back to `expect(true).toBe(true)` on error
- `buildSafeInteractionBlock`: uses `queryBy*` + null-check before interaction, skips if element not found

### `generator/store.ts`

Generate tests for Zustand, Redux Toolkit (createSlice/createAsyncThunk), and Jotai atoms.

```typescript
export function generateStoreTest(
  sourceFile: SourceFile,
  checker: TypeChecker,
  testFilePath: string,
  sourceFilePath: string
): string | null
```

Logic:
- Detect store type: Zustand (`create(`), RTK (`createSlice(`), Jotai (`atom(`)
- For Zustand: test initial state, each action mutates state correctly, selectors return expected types
- For RTK: test initial state, each reducer case, async thunk lifecycle (pending/fulfilled/rejected)
- For Jotai: test atom default value, derived atom computation

### `generator/utility.ts`

Generate tests for exported utility/service functions.

```typescript
export function generateUtilityTest(
  sourceFile: SourceFile,
  checker: TypeChecker,
  testFilePath: string,
  sourceFilePath: string,
  fileType?: 'utility' | 'service'
): string | null
```

Logic:
- Extract all exported functions with their parameter types and return types
- For each function: generate a `describe` block with:
  - Basic invocation test (smoke test that it doesn't throw)
  - Parameter variation tests based on parameter types
  - Switch-case branch tests if switch statements detected in function body
  - Async function handling (wrap in async/await)
- Generate mock values for each parameter type:
  - string → `'test-string'`, number → `1`, boolean → `true`
  - Object types → `{}`, Array types → `[]`
  - Callback/function types → `jest.fn()`
  - Optional params → `undefined`
- For service files: mock axios/fetch imports at top level

### `selfHeal.ts`

Deterministic self-healing engine with 25+ fix rules applied against Jest error output.

```typescript
export interface FixRule {
  name: string;
  match: (error: string, testContent: string) => boolean;
  fix: (testContent: string, error: string, sourceFilePath: string) => string;
}

export const FIX_RULES: FixRule[];

export function applyFixRules(
  testContent: string,
  errorMessage: string,
  sourceFilePath: string,
  attempt?: number
): string | null
```

Key rules (not exhaustive):
1. **Cannot find module** → add `jest.mock()` for the missing module
2. **useNavigate/useLocation** → wrap render in `<MemoryRouter>`
3. **Closing tag mismatch** → fix `render(<Component />)` wrapping
4. **QueryClient** → add `QueryClientProvider` wrapper with test client
5. **act() warning** → wrap in `await waitFor()`
6. **Cannot read properties of undefined** → add null-safe checks
7. **Default import** → convert named import to default (skip React)
8. **recharts false positive** → word boundary check (`\bchart\b` not `chart`)
9. **Redux Provider** → wrap in `<Provider store={testStore}>`
10. **Suspense boundary** → wrap in `<React.Suspense fallback={<div/>}>`

Escalation tiers (by attempt number):
- Tier 1 (attempt 1-2): Apply specific fix rules only
- Tier 2 (attempt 3): Add `@ts-nocheck` + try-catch all test blocks
- Tier 3 (attempt 4): Simplify test to bare-minimum (strip interactions, keep only render)
- Tier 4 (attempt 5): Last-resort specific rules

Also exports:
```typescript
export function simplifyTestFile(testContent: string): string
```
Strips interaction tests, keeps only render/smoke tests, adds `@ts-nocheck`.

### `scaffold.ts`

Auto-scaffolds Jest configuration for projects that have no `jest.config`.

```typescript
export function hasJestConfig(rootDir: string): boolean
export function ensureJestScaffold(rootDir: string, testOutput?: ResolvedTestOutput): void
```

Creates:
- `jest.config.cjs` with:
  - `ts-jest` preset, `jsdom` environment
  - `moduleNameMapper` from tsconfig path aliases (reads `tsconfig.app.json` or `tsconfig.json`)
  - `transformIgnorePatterns` for ESM-only packages (auto-detected from `node_modules` + hardcoded list of ~30 common ESM packages)
  - React deduplication (pins react/react-dom to local `node_modules` copy if present)
  - CSS/image/SVG/font mocks
  - Dynamic `testMatch` and `collectCoverageFrom` based on `ResolvedTestOutput` config
- `src/test-utils/setupTests.ts` with:
  - `@testing-library/jest-dom` import
  - `matchMedia`, `ResizeObserver`, `IntersectionObserver` mocks
  - Enhanced polyfills: `fetch`, `localStorage`, `sessionStorage`, `crypto`, `requestAnimationFrame`, `clipboard`, `structuredClone`, dialog APIs
  - Console suppression for known-harmless React warnings
- `src/test-utils/__mocks__/fileMock.js` — static file stub
- `src/test-utils/__mocks__/svgMock.js` — SVG mock with `ReactComponent` export
- `src/test-utils/ErrorBoundary.tsx` — React error boundary for test resilience

### `utils/framework.ts`

Test framework detection and abstraction layer.

```typescript
export type TestFramework = 'jest' | 'vitest';

export function detectTestFramework(rootDir?: string): TestFramework
export function detectFrameworkForFile(filePath: string, packageRoot: string): TestFramework
export function mockFn(): string                           // 'jest.fn()' | 'vi.fn()'
export function mockGlobalName(): 'jest' | 'vi'
export function buildTestGlobalsImport(symbols: string[]): string
export function buildDomMatchersImport(): string
```

Detection logic: checks for `vitest.config.*`, `vite.config.*` with test plugin, `jest.config.*`, and `package.json` test script.

### `workspace/config.ts`

Workspace configuration loading, validation, and test output resolution.

```typescript
export type TestSuffix = '.test' | '.spec';

export interface TestOutputConfig {
  strategy: 'colocated' | 'subfolder' | 'mirror';
  directory?: string;
  srcRoot?: string;
  suffix?: TestSuffix;
}

export interface ResolvedTestOutput {
  strategy: 'colocated' | 'subfolder' | 'mirror';
  directory: string;
  srcRoot: string;
  suffix: TestSuffix;
}

export const DEFAULT_TEST_OUTPUT: ResolvedTestOutput;

export function loadConfig(rootDir?: string, explicitConfigPath?: string): TestgenConfig
export function resolveTestOutput(raw?: TestOutputConfig): ResolvedTestOutput
```

Config file: `react-testgen.config.json` at project root with `version`, `defaults`, and `packages[]` sections. Validates all fields including `testOutput`.

### `workspace/discovery.ts`

Workspace package discovery and target file resolution.

```typescript
export interface ResolvedPackage { ... }
export interface TargetFile { ... }

export function resolveWorkspacePackages(config: TestgenConfig, rootDir?: string): ResolvedPackage[]
export function resolveTargetFiles(options: ResolveTargetFilesOptions): TargetFile[]
```

Filters packages by name, applies generation modes (git-unstaged, changed-since, all, file), resolves final target files with include/exclude glob matching.

---

## Files to Modify (13 files)

### `analyzer.ts` — Expand component analysis

Add to the `ComponentInfo` interface:
```typescript
usesRouter: boolean;
usesReactQuery: boolean;
usesRedux: boolean;
usesFramerMotion: boolean;
usesRecharts: boolean;
usesPortal: boolean;
thirdPartyImports: string[];
serviceImports: string[];
contexts: ContextUsage[];
conditionalElements: ConditionalElementInfo[];
callbacks: CallbackInfo[];
selectorQueries: SelectorInfo[];
```

Expand `analyzeSourceFile()` to detect:
- Hook usage patterns (useNavigate, useQuery, useSelector, useDispatch)
- Third-party library imports (framer-motion, recharts, axios, etc.)
- Service/API file imports (files matching service/api/client patterns)
- Context consumption (`useContext(XxxContext)`)
- Conditional rendering (`{condition && <Element>}`, ternary JSX)
- Callback props and their parameter shapes
- Selector strategy: prefer `data-testid`, then `aria-label`, then text content, then role
- Compound UI sub-component detection (Radix UI, cmdk, vaul patterns)

Add `getCompoundSubComponents(sourceFile): Set<string>` — detects components that are assigned as properties of a parent (e.g., `Dialog.Content = DialogContent`).

### `cli.ts` — Major CLI expansion

Add types:
```typescript
interface JestRunResult {
  passed: boolean; numTests: number; numFailed: number;
  coverage: number; errorOutput: string; failureReason: string;
}
type VerifyStatus = 'pass' | 'fail' | 'low-coverage' | 'skipped' | 'generated' | 'smoke-fallback';
```

Add CLI flags: `--verify`, `--all`, `--max-retries <n>`, `--coverage-threshold <n>`

Add `generateTestForFile()` — extracted per-file logic that detects file type (barrel, context, store, utility, component) and dispatches to the appropriate generator. Accepts `testOutput` and `packageRoot` for configurable output.

Add `runJestBatch()` — runs Jest on multiple test files in a SINGLE invocation (not one-per-file). Returns `Map<string, JestRunResult>`. Parses JSON output and coverage-summary.json.

Add `generateMinimalSmokeTest()` — tiered smoke test fallback with auto-mocks, provider wrapping, try-catch render.

Restructure `run()` into 4 phases:
1. Generate all test files (no Jest)
2. Run Jest once on all files (batch)
3. Self-heal loop (up to 5 iterations with escalating tiers)
4. Replace remaining failures with smoke tests

Add file classifier helpers: `isStoreFile()`, `isServiceFile()`, `isContextProviderFile()`, `isTestUtilityFile()`, `isUntestableFile()`, `isBarrelFile()`

Add summary printer with status icons and formatted table output.

### `config.ts` — Expand configuration

Add detection config:
```typescript
export const TEST_UTILITY_PATTERNS = {
  directories: ['/test-utils/', '/test-helpers/', '/_test-utils_/'],
  filenamePatterns: [/^(renderWithProviders|customRender|test-?helpers?|test-?utils?)/i],
};

export const UNTESTABLE_PATTERNS = {
  directories: ['/mocks/browser', '/mocks/handlers/', '/mocks/data/'],
};

export const STORE_FILE_PATTERNS = {
  filenamePatterns: [/Store\.(ts|tsx)$/i, /slice\.(ts|tsx)$/i, ...],
  zustand: ["from 'zustand'", ...],
  rtk: ["from '@reduxjs/toolkit'", ...],
  jotai: ["from 'jotai'", ...],
};

export const CONTEXT_DETECTION_CONFIG = {
  router: { hooks: ['useNavigate', 'useLocation', ...], imports: ['react-router', ...] },
  reactQuery: { hooks: ['useQuery', 'useMutation', ...], imports: ['@tanstack/react-query', ...] },
  customContexts: Array<{ name, hooks, contextName, providerName, providerProps? }>,
  methodPatterns: ['set', 'add', 'remove', 'update', ...],
  statePatterns: ['is', 'has', 'loading', 'error', 'data', ...],
};
```

Deprecate `TESTS_DIR_NAME` with `@deprecated` JSDoc (keep for backwards compat).

### `fs.ts` — Add directory utilities

Add:
```typescript
export function listFilesRecursive(dir: string): string[]
```
Recursively lists all files in a directory, skipping `node_modules`, `.git`, `dist`, `build`.

### `generator/index.ts` — Integrate new systems

In `generateTests()`:
- Call `buildAutoMocks(component)` and insert mock blocks between imports and describe
- Deduplicate auto-mocks against existing `jest.mock()` calls
- Replace bare `renderUI()` calls with `buildSafeRenderBlock()` (try-catch wrapped)
- Integrate context variant tests from `buildContextVariantTests()`

### `generator/interactions.ts` — Expand interaction tests

Add test generators for:
- Callback prop invocations (click handlers, onChange, onSubmit)
- Optional/conditional prop testing (with and without optional props)
- State toggle testing (click → re-render → assert changed text)
- Form submission flows
- Keyboard navigation (Enter, Escape, Tab)
- Accessibility assertions (role, aria-label checks)
- Negative branch testing (component with error/empty states)

All interaction tests use safe patterns: `queryBy*` + null-check, try-catch wrapping.

### `generator/mocks.ts` — Enhance mock value generation

Add:
- `buildDefaultProps(component)` — generates a complete props object with safe defaults per type
- HTML-attribute filtering: skip `aria-*`, `data-*`, event handlers from component prop mocks
- Type-aware mock values: `Date` → `new Date()`, `ReactNode` → `<span>test</span>`, `Ref` → `{ current: null }`
- Enum prop detection: use first enum member as default
- Union type handling: pick the most concrete type from the union

### `generator/render.ts` — Context-aware rendering

Add:
- `ContextRenderInfo` interface for tracking context mock declarations and provider imports
- `buildContextRender(component, contexts)` — generates render block with context providers
- Provider nesting order: outermost (Router) → middle (QueryClient, Redux) → innermost (custom contexts)

### `generator/templates.ts` — Enhanced templates

Add:
- `TemplateOptions.contextImports` field for context provider imports
- Smart provider detection from component analysis
- Callback mock declarations at describe-block scope
- `@ts-nocheck` header when needed

### `generator/variants.ts` — Variant structure

Add:
- `VariantTestCase` interface with `testName`, `props`, `expectedBehavior`
- Individual `it()` block generation per variant (was grouped before)

### `parser.ts` — Enhanced parser context

Change `createParser()` to return a typed context object:
```typescript
export interface ParserContext {
  project: Project;
  checker: TypeChecker;
}
export function createParser(): ParserContext
```

Add tsconfig auto-detection (checks `tsconfig.app.json` first, then `tsconfig.json`).

### `utils/path.ts` — Configurable path resolution

Update `getTestFilePath()` to accept `output?: ResolvedTestOutput` and `packageRoot?: string`:
- `colocated`: test file next to source
- `subfolder`: test in named subdirectory (default: `__tests__`)
- `mirror`: separate root mirroring source structure

Update `isTestFile()` to accept `output?: ResolvedTestOutput`:
- Check configured suffix (`.test` or `.spec`)
- Check configured directory name
- Backwards-compat: always recognise `__tests__/` and `.test` files

Add render helper resolution system:
```typescript
export function resolveRenderHelper(sourceFilePath: string): { path: string; exportName: string } | null
```
Searches for `renderWithProviders`, `customRender`, `testUtils`, etc. in common directories. Caches results per package root.

Remove import of `TESTS_DIR_NAME` from `../config`.

### `utils/format.ts` — Minor utility

Add `joinLines(lines: string[]): string` — joins non-empty lines with newline.

---

## Constraints

- Zero breakage: without config file, behavior is identical to before (subfolder + `__tests__` + `.test`)
- No changes under `examples/` directory
- Must pass `tsc --noEmit` with zero errors
- No new npm dependencies
- All function signatures backward-compatible (new params have defaults)
- Deterministic output — no AI, no randomness, no network calls
- Never commit a red (failing) test — smoke test fallback or delete
- Support both Jest and Vitest (framework detection + abstraction layer)
- Windows path compatibility (normalize backslashes everywhere)
