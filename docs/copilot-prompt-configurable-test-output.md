# Copilot Prompt: Configurable Test File Output Location

## Goal

Add configurable test file output location to the React test generator CLI (`packages/testgen/`). Users should be able to control where generated test files are placed via `react-testgen.config.json`, choosing between three strategies: colocated (next to component), subfolder (in a named subdirectory), or mirror (separate root mirroring source tree). The suffix should also be configurable (`.test` or `.spec`).

---

## Context

The test generator is a deterministic (no AI) CLI tool under `packages/testgen/`. It uses ts-morph for AST analysis, generates Jest test files for React components/hooks/utils, and has a self-heal loop that retries failing tests with fix rules.

Currently test file paths are hardcoded:
- `getTestFilePath()` in `src/utils/path.ts` always outputs to `__tests__/` subfolder with `.test` suffix
- `TESTS_DIR_NAME = '__tests__'` constant in `src/config.ts`
- `jest.config.cjs` scaffold in `src/scaffold.ts` has hardcoded `testMatch` and `collectCoverageFrom` patterns
- `isTestFile()` in `src/utils/path.ts` checks for `__tests__/` and `.test.` only

The project already has a JSON config system at `src/workspace/config.ts` with `loadConfig()`, `TestgenDefaults`, `TestgenPackageConfig`, and validation logic.

---

## Files to Modify (5 files, all under `packages/testgen/src/`)

### 1. `workspace/config.ts` — Add types, resolver, validation

Add the following **types** after the existing type aliases:

```typescript
export type TestSuffix = '.test' | '.spec';

export interface TestOutputConfig {
  strategy: 'colocated' | 'subfolder' | 'mirror';
  directory?: string;   // folder name for subfolder, root dir for mirror
  srcRoot?: string;     // source root to strip (mirror only), default "src"
  suffix?: TestSuffix;  // default ".test"
}

export interface ResolvedTestOutput {
  strategy: 'colocated' | 'subfolder' | 'mirror';
  directory: string;
  srcRoot: string;
  suffix: TestSuffix;
}

export const DEFAULT_TEST_OUTPUT: ResolvedTestOutput = {
  strategy: 'subfolder',
  directory: '__tests__',
  srcRoot: 'src',
  suffix: '.test',
};
```

Add a **resolver function** that fills defaults based on strategy:

```typescript
export function resolveTestOutput(raw?: TestOutputConfig): ResolvedTestOutput {
  if (!raw) return { ...DEFAULT_TEST_OUTPUT };
  switch (raw.strategy) {
    case 'colocated':
      return { strategy: 'colocated', directory: '', srcRoot: raw.srcRoot ?? 'src', suffix: raw.suffix ?? '.test' };
    case 'subfolder':
      return { strategy: 'subfolder', directory: raw.directory ?? '__tests__', srcRoot: raw.srcRoot ?? 'src', suffix: raw.suffix ?? '.test' };
    case 'mirror':
      return { strategy: 'mirror', directory: raw.directory ?? 'tests', srcRoot: raw.srcRoot ?? 'src', suffix: raw.suffix ?? '.test' };
    default:
      return { ...DEFAULT_TEST_OUTPUT };
  }
}
```

Add `testOutput?: TestOutputConfig` to both `TestgenDefaults` and `TestgenPackageConfig` interfaces.

Add a **`validateTestOutput()`** function that validates:
- `strategy` must be one of `colocated | subfolder | mirror`
- `suffix` (if present) must be `.test` or `.spec`
- `directory` (if present) must be non-empty string
- `srcRoot` (if present) must be non-empty string

Wire `validateTestOutput` into the existing `validateDefaults()` and `validatePackage()` functions.

---

### 2. `utils/path.ts` — Update `getTestFilePath()` and `isTestFile()`

**Import** `ResolvedTestOutput` and `DEFAULT_TEST_OUTPUT` from `../workspace/config`.

**Remove** the import of `TESTS_DIR_NAME` from `../config`.

**Update `isTestFile()`** to accept optional `output?: ResolvedTestOutput`:
- Check configured suffix (`.test` or `.spec`) + `.ts`/`.tsx` endings
- Check configured directory name for subfolder/mirror strategies
- Keep backwards-compat: always recognise `__tests__/` and `.test.` files regardless of config

**Update `getTestFilePath()`** to accept optional `output?: ResolvedTestOutput` and `packageRoot?: string`:
- `colocated`: `path.join(dir, testFileName)` — test file next to source
- `subfolder`: `path.join(dir, cfg.directory, testFileName)` — in named subdirectory
- `mirror`: strip `srcRoot` from source path, rebuild under `cfg.directory` at package root
  - Edge case: if source is outside `srcRoot` (relative path starts with `..`), fall back to subfolder with a console warning
- Default (no output param): backwards-compatible subfolder + `__tests__` + `.test`

Test file name formula: `${basename}${suffix}${ext}` where ext is `.ts` or `.tsx` matching source.

---

### 3. `cli.ts` — Thread config through pipeline

**Import** `loadConfig`, `resolveTestOutput`, `ResolvedTestOutput`, `DEFAULT_TEST_OUTPUT` from `./workspace/config`.

**In `run()`** at the top:
- Call `loadConfig(cwd)` to load `react-testgen.config.json`
- Get `testOutput` from first package config (falling back to defaults): `resolveTestOutput(firstPkg?.testOutput ?? config.defaults.testOutput)`
- Resolve `packageRoot` from first package's `root` field

**Update `generateTestForFile()`** signature:
- Add params: `testOutput: ResolvedTestOutput = DEFAULT_TEST_OUTPUT` and `packageRoot: string = process.cwd()`
- Pass `testOutput` and `packageRoot` to `getTestFilePath()` call

**Thread `testOutput` and `packageRoot`** to all call sites:
- Phase 1 generation loop: `generateTestForFile(filePath, ctx, testOutput, packageRoot)`
- Self-heal retry fallback: `generateTestForFile(e.srcPath, ctx, testOutput, packageRoot)`
- Smoke test fallback: `generateMinimalSmokeTest(e.srcPath, e.testPath, ctx, testOutput, packageRoot)`
- Scaffold call: `ensureJestScaffold(cwd, testOutput)`

**Update `generateMinimalSmokeTest()`** signature to accept `_testOutput` and `_packageRoot` params (prefixed with `_` since not yet used internally — the function computes import paths from the already-resolved `testFilePath`).

---

### 4. `scaffold.ts` — Dynamic Jest config patterns

**Import** `ResolvedTestOutput` and `DEFAULT_TEST_OUTPUT` from `./workspace/config`.

**Update `buildJestConfigContent()`** to accept `testOutput: ResolvedTestOutput = DEFAULT_TEST_OUTPUT`:

Build dynamic `testMatch` based on strategy:
- `colocated`: `['**/*${suffix}.{ts,tsx}']`
- `subfolder`: `['**/${directory}/**/*${suffix}.{ts,tsx}', '**/*${suffix}.{ts,tsx}']`
- `mirror`: `['${directory}/**/*${suffix}.{ts,tsx}', '**/*${suffix}.{ts,tsx}']`

Build dynamic `collectCoverageFrom` exclusion:
- `mirror`: `!${directory}/**`
- `subfolder`: `!src/**/${directory}/**`
- `colocated`: `!src/**/*.test.*`

**Update `ensureJestScaffold()`** to accept and forward `testOutput: ResolvedTestOutput = DEFAULT_TEST_OUTPUT`.

---

### 5. `config.ts` — Deprecate constant

Mark `TESTS_DIR_NAME` with `@deprecated` JSDoc:
```typescript
/** @deprecated Use ResolvedTestOutput.directory from workspace/config instead. */
export const TESTS_DIR_NAME = '__tests__';
```

Do NOT remove it — other files still import it for backwards compatibility.

---

## Config file format (`react-testgen.config.json`)

```jsonc
{
  "version": 1,
  "defaults": {
    "include": ["src/**/*.{ts,tsx}"],
    "exclude": ["**/__tests__/**", "**/*.test.*", "**/dist/**"],
    "framework": "auto",
    "renderHelper": "auto",
    "generateFor": ["components", "hooks", "utils"],
    "mode": "git-unstaged",
    "testOutput": {
      "strategy": "colocated"           // or "subfolder" or "mirror"
      // "directory": "__tests__",      // optional, folder name
      // "srcRoot": "src",             // optional, mirror only
      // "suffix": ".test"             // optional, ".test" or ".spec"
    }
  },
  "packages": [
    { "name": "my-app", "root": "." }
  ]
}
```

---

## Constraints

- Zero breakage: when no `testOutput` is configured (or no config file exists), behavior must be identical to before (subfolder + `__tests__` + `.test`)
- No changes under `examples/` directory
- Must pass `tsc --noEmit` with zero errors
- Do not add new dependencies
- Keep all function signatures backward-compatible by using defaults for new params
- Do not remove `TESTS_DIR_NAME` — only deprecate it
