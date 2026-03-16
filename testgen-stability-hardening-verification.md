# React Test Generator — Stability Hardening Verification Prompt

Use this file to verify each chunk was applied correctly in your target repo.
Run each chunk's verification section independently after applying that chunk.

---

## CHUNK 1 VERIFICATION: Core Files

After applying Chunk 1, verify the following:

### File existence check
```bash
ls -la packages/testgen/src/analyzer.ts
ls -la packages/testgen/src/cli.ts
ls -la packages/testgen/src/config.ts
ls -la packages/testgen/src/scaffold.ts
ls -la packages/testgen/src/failureContext.ts
ls -la packages/testgen/src/repairMemory.ts
ls -la packages/testgen/src/selfHeal.ts
```

### analyzer.ts verification
- [ ] File has ~1679 lines
- [ ] Exports `analyzeSourceFile` function (main entry point)
- [ ] Exports `ComponentInfo` interface with fields: `name`, `props`, `hasChildren`, `hooks`, `stateVars`, `effects`, `contexts`, `callbacks`, `conditionalBranches`, `isForwardRef`, `isCompound`, `compoundParent`, `storeBindings`, `defaultExport`, `localDeps`
- [ ] Contains `extractHooks()` function
- [ ] Contains `extractCallbackProps()` function
- [ ] Contains `extractConditionalBranches()` function
- [ ] Contains `detectStoreBindings()` function
- [ ] Contains `detectCompoundComponents()` function
- [ ] Uses ES6 imports: `import * as ts from 'typescript'`
- [ ] No `require()` in actual code (only inside template strings is OK)

### cli.ts verification
- [ ] File has ~925 lines
- [ ] Imports from `./healer` (not `./heal`): `heal`, `recordHealOutcome`, `isDuplicateHealAttempt`, `DEFAULT_MAX_HEAL_ATTEMPTS`
- [ ] Imports types: `FailureDetail`, `RepairPlan`, `RepairAction` from `'./healer'`
- [ ] Imports `mockFn`, `mockModuleFn`, `mockGlobalName` from `'../utils/framework'` or `'./utils/framework'`
- [ ] Contains `accumulatedActions: RepairAction[]` array in heal loop
- [ ] Heal loop builds `combinedPlan` with spread of `accumulatedActions`
- [ ] Deduplicates actions with `JSON.stringify` comparison
- [ ] Calls `generateTestForFile(filePath, ctx, combinedPlan)` after healing
- [ ] Has `--all` and `--heal` CLI flags support
- [ ] Has `--framework` flag for jest/vitest override
- [ ] Uses ES6 `import` for all dependencies

### config.ts verification
- [ ] Exports `TEST_UTILITY_PATTERNS` array
- [ ] Exports `UNTESTABLE_PATTERNS` array
- [ ] Uses ES6 exports

### scaffold.ts verification
- [ ] File has ~626 lines
- [ ] Exports `scaffoldJestConfig()` function
- [ ] Contains jest config template generation
- [ ] `require()` and `module.exports` appear ONLY inside template literal strings (generated config content), NOT as actual imports

### failureContext.ts verification
- [ ] Exports `FailureContext` interface
- [ ] Exports `parseFailureContext()` function
- [ ] ~88 lines

### repairMemory.ts verification
- [ ] Exports `RepairMemory` class/interface
- [ ] Exports `getPreferredRepairAction()` function
- [ ] Exports `getPromotedActionIds()` function
- [ ] ~140 lines

### selfHeal.ts verification
- [ ] File has ~1014 lines
- [ ] Imports from `./failureContext`: `FailureContext`, `parseFailureContext`
- [ ] Imports from `./repairMemory`: `RepairMemory`, `getPreferredRepairAction`, `getPromotedActionIds`
- [ ] Imports from `./utils/framework`: `buildDomMatchersImport`, `mockGlobalName`, `mockModuleFn`
- [ ] `require()` appears ONLY inside template literal strings for generated test code

---

## CHUNK 2 VERIFICATION: Generator Files (Modified)

### generator/index.ts verification
- [ ] Imports `mockFn`, `mockModuleFn`, `mockGlobalName` from `'../utils/framework'`
- [ ] Exports `generateTests` function
- [ ] Contains `resolveHookModule()` local function
- [ ] Contains `buildRepairMockBlocks()` local function
- [ ] `mock-hook` action block uses `mockFn()`, `mockModuleFn()`, `mockGlobalName()` (NOT hardcoded `jest.fn`, `jest.mock`)
- [ ] `fix-mock-return` action generates actual mock code with `mockModuleFn()` (NOT just comments)
- [ ] `fix-mock-return` handles shapes: `array` -> `[]`, `function` -> `mockFn()`, `promise` -> `Promise.resolve({})`, default -> `{}`

### generator/interactions.ts verification
- [ ] All `expect(container).toBeInTheDocument()` replaced with `expect(container).toBeTruthy()`
- [ ] Verify by searching: should find ZERO occurrences of `toBeInTheDocument` related to container
- [ ] Should find multiple `expect(container).toBeTruthy()` in:
  - `buildRenderAssertions`
  - `buildInteractionTests`
  - `buildCallbackPropTests`
  - `buildConditionalRenderTests`
  - `buildNegativeBranchTests`
  - `buildOptionalPropTests`
  - `buildStateTests`
  - `buildFormSubmissionTest`

### generator/context.ts verification
- [ ] `expect(container).toBeTruthy()` (not `toBeInTheDocument`)
- [ ] 1 occurrence changed

### generator/render.ts verification
- [ ] Imports `resolveRenderHelper` from `'../utils/path'`
- [ ] Contains logic: `const hasCustomRender = sourceFilePath ? resolveRenderHelper(sourceFilePath) !== null : false`
- [ ] Only uses `renderWithProviders` when `hasCustomRender === true` AND repair plan has `use-render-helper` action
- [ ] Falls back to plain `render` when project has no custom render helper

### generator/templates.ts verification
- [ ] Imports from `'../utils/framework'`: `buildTestGlobalsImport`, `buildDomMatchersImport`
- [ ] Framework-aware test file header generation
- [ ] Handles `add-wrapper` repair actions for MemoryRouter, QueryClientProvider

### generator/variants.ts verification
- [ ] `expect(container).toBeTruthy()` (not `toBeInTheDocument`)
- [ ] 2 occurrences changed

### generator/mocks.ts verification
- [ ] Exports `buildDefaultProps` function
- [ ] Uses framework-aware mock generation

### generator/utility.ts verification
- [ ] Exports `generateUtilityTest` function
- [ ] ~500+ lines

### Cross-reference check
```
grep -r "toBeInTheDocument" packages/testgen/src/generator/
```
- [ ] Should return ZERO results for container assertions (may still appear for element assertions like `expect(screen.getByText(...)).toBeInTheDocument()` which is correct)

---

## CHUNK 3 VERIFICATION: New Generator Files

### File existence check
```bash
ls -la packages/testgen/src/generator/autoMocks.ts
ls -la packages/testgen/src/generator/contextValues.ts
ls -la packages/testgen/src/generator/contextVariants.ts
ls -la packages/testgen/src/generator/patchTypes.ts
ls -la packages/testgen/src/generator/safePatterns.ts
ls -la packages/testgen/src/generator/store.ts
```

### autoMocks.ts verification
- [ ] ~232 lines
- [ ] Exports auto-mock generation functions for third-party libraries
- [ ] Uses ES6 imports only

### contextValues.ts verification
- [ ] ~407 lines
- [ ] Exports context value generation helpers
- [ ] Uses ES6 imports only

### contextVariants.ts verification
- [ ] ~197 lines
- [ ] Exports context variant test builders
- [ ] Uses ES6 imports only

### patchTypes.ts verification
- [ ] ~105 lines
- [ ] Exports patch type definitions

### safePatterns.ts verification
- [ ] ~58 lines
- [ ] Exports safe pattern matchers

### store.ts verification
- [ ] ~638 lines
- [ ] Exports Redux/Zustand store test generation
- [ ] Uses ES6 imports only

---

## CHUNK 4 VERIFICATION: Eligibility Engine

### File existence check
```bash
ls -la packages/testgen/src/eligibility/index.ts
ls -la packages/testgen/src/eligibility/types.ts
ls -la packages/testgen/src/eligibility/classifier.ts
ls -la packages/testgen/src/eligibility/engine.ts
ls -la packages/testgen/src/eligibility/reporter.ts
ls -la packages/testgen/src/eligibility/scoring.ts
ls -la packages/testgen/src/eligibility/signals.ts
```

### index.ts verification
- [ ] Barrel re-exports from all eligibility submodules
- [ ] Exports at minimum: types, classifier, engine, reporter

### types.ts verification
- [ ] ~167 lines
- [ ] Exports eligibility-related type definitions

### classifier.ts verification
- [ ] ~426 lines
- [ ] Exports component classification logic

### engine.ts verification
- [ ] ~264 lines
- [ ] Exports eligibility evaluation engine
- [ ] Imports from sibling files: types, classifier, scoring, signals

### reporter.ts verification
- [ ] ~257 lines
- [ ] Exports eligibility report generation

### scoring.ts verification
- [ ] ~157 lines
- [ ] Exports scoring functions

### signals.ts verification
- [ ] ~414 lines
- [ ] Exports signal detection functions

### Import chain check
```
grep -r "from.*eligibility" packages/testgen/src/cli.ts
```
- [ ] cli.ts should import from `./eligibility` (if used)

---

## CHUNK 5 VERIFICATION: Heal System (heal/)

### File existence check
```bash
ls -la packages/testgen/src/heal/index.ts
ls -la packages/testgen/src/heal/classifier.ts
ls -la packages/testgen/src/heal/memory.ts
ls -la packages/testgen/src/heal/repair.ts
ls -la packages/testgen/src/heal/report.ts
```

### index.ts verification
- [ ] Barrel exports from heal submodules

### classifier.ts verification
- [ ] ~158 lines
- [ ] Exports failure classification for heal system

### memory.ts verification
- [ ] ~177 lines
- [ ] Exports healing memory persistence

### repair.ts verification
- [ ] ~281 lines
- [ ] Exports repair plan execution

### report.ts verification
- [ ] ~132 lines
- [ ] Exports heal report generation

---

## CHUNK 6 VERIFICATION: Healer System (healer/)

### File existence check
```bash
ls -la packages/testgen/src/healer/index.ts
ls -la packages/testgen/src/healer/analyzer.ts
ls -la packages/testgen/src/healer/knowledge-base.ts
ls -la packages/testgen/src/healer/memory.ts
```

### healer/index.ts verification
- [ ] Exports `heal` function
- [ ] Exports `recordHealOutcome` function
- [ ] Exports `isDuplicateHealAttempt` function
- [ ] Exports `DEFAULT_MAX_HEAL_ATTEMPTS` constant
- [ ] Re-exports types: `FailureDetail`, `RepairPlan`, `RepairAction` (from analyzer and knowledge-base)
- [ ] Imports from `./analyzer`: `FailureDetail`, `FailureAnalysis`, `FailureCategory`, `pickRootCause`, `analyzeFailures`
- [ ] Imports from `./knowledge-base`: `RepairPlan`, `findRepairPlan`
- [ ] Imports from `./memory`: `lookupExact`, `lookupRanked`, `memoryEntryToPlan`, `recordSuccess`, `recordFailure`

### healer/analyzer.ts verification
- [ ] ~338 lines
- [ ] Exports `FailureDetail` interface
- [ ] Exports `FailureAnalysis` interface
- [ ] Exports `FailureCategory` enum with values including: `MISSING_PROVIDER`, `HOOK_CONTEXT_MISSING`, `MOCK_SHAPE_MISMATCH`, `MISSING_SYMBOL_IMPORT`, `UNKNOWN`
- [ ] Exports `pickRootCause()` function
- [ ] Exports `analyzeFailures()` function
- [ ] `FailureAnalysis` has fields: `category`, `errorMessage`, `hookName?`, `providerName?`, `missingIdentifier?`
- [ ] Router context detection regex: `/Cannot destructure property ['"](\w+)['"].*(?:(?:of|from)\s+(?:undefined|null)|as it is (?:undefined|null))/`
- [ ] Router property detection: `/basename|navigator|location|matches/i`

### healer/knowledge-base.ts verification
- [ ] ~328 lines
- [ ] Exports `RepairPlan` interface with fields: `actions`, `confidence`, `description`
- [ ] Exports `RepairAction` type with `kind` field
- [ ] `RepairAction.kind` includes: `'use-render-helper'`, `'add-wrapper'`, `'mock-hook'`, `'fix-mock-return'`, `'add-import'`
- [ ] Exports `findRepairPlan()` function
- [ ] `hookContextUseRenderHelperRule` includes fallback `add-wrapper` actions for:
  - MemoryRouter (when `/navigate|location|params|route/i` matches)
  - QueryClientProvider (when `/query|mutation|queryClient/i` matches)

### healer/memory.ts verification
- [ ] ~206 lines
- [ ] Exports `lookupExact()` function
- [ ] Exports `lookupRanked()` function
- [ ] Exports `memoryEntryToPlan()` function
- [ ] Exports `recordSuccess()` function
- [ ] Exports `recordFailure()` function

---

## CHUNK 7 VERIFICATION: SelfHeal System (selfHeal/)

### File existence check
```bash
ls -la packages/testgen/src/selfHeal/index.ts
ls -la packages/testgen/src/selfHeal/types.ts
ls -la packages/testgen/src/selfHeal/failureClassifier.ts
ls -la packages/testgen/src/selfHeal/healReport.ts
ls -la packages/testgen/src/selfHeal/healingMemory.ts
ls -la packages/testgen/src/selfHeal/promotion.ts
ls -la packages/testgen/src/selfHeal/repairEngine.ts
ls -la packages/testgen/src/selfHeal/repairTraits.ts
ls -la packages/testgen/src/selfHeal/repairs/index.ts
ls -la packages/testgen/src/selfHeal/repairs/utils.ts
ls -la packages/testgen/src/selfHeal/repairs/asyncQueryStrategy.ts
ls -la packages/testgen/src/selfHeal/repairs/importPathNormalizationStrategy.ts
ls -la packages/testgen/src/selfHeal/repairs/importResolutionHintsStrategy.ts
ls -la packages/testgen/src/selfHeal/repairs/jestDomMatcherStrategy.ts
ls -la packages/testgen/src/selfHeal/repairs/missingExternalModuleStrategy.ts
ls -la packages/testgen/src/selfHeal/repairs/moduleMockStrategy.ts
ls -la packages/testgen/src/selfHeal/repairs/providerWrapperStrategy.ts
ls -la packages/testgen/src/selfHeal/repairs/queryClientMissingStrategy.ts
ls -la packages/testgen/src/selfHeal/repairs/reduxStoreMissingStrategy.ts
ls -la packages/testgen/src/selfHeal/repairs/routerMissingStrategy.ts
ls -la packages/testgen/src/selfHeal/repairs/selectorStrategy.ts
```

### selfHeal/types.ts verification
- [ ] ~222 lines
- [ ] Exports `FailureCategory` as const tuple with 16 variants
- [ ] Exports `FailureSignature` interface
- [ ] Exports `RepairAction` with `RepairActionKind` (7 kinds)
- [ ] Exports `RepairPatchOperation` (6 types)
- [ ] Exports `RepairResult`, `HealingAttempt`, `HealingMemoryEntry`
- [ ] Exports `HealReportStatus`, `HealReportEntry`, `HealReportAggregate`, `HealReportPayload`
- [ ] Exports `ProviderWrapperDescriptor`, `ImportResolutionHint`, `SelectorReplacement`
- [ ] Exports `ComponentTraits` interface
- [ ] Exports `RepairContext`, `RepairDecision`, `RepairStrategy` interface

### selfHeal/failureClassifier.ts verification
- [ ] ~185 lines
- [ ] Exports `classifyFailure()` function returning `FailureSignature`
- [ ] Contains 14 ordered `FailureRules` with regex patterns
- [ ] Contains normalization pipeline: `stripAnsiCodes`, `stripAbsolutePaths`, `stripVolatileLocationData`, `collapseWhitespace`

### selfHeal/healReport.ts verification
- [ ] ~267 lines
- [ ] Exports immutable `HealReportEntry` builders
- [ ] Exports `buildHealReport()` function
- [ ] Exports `formatHealReportSummary()` function
- [ ] Writes JSON report to `.testgen-results/heal-report.json`

### selfHeal/healingMemory.ts verification
- [ ] ~339 lines
- [ ] Persistent memory to `.testgen-healing-memory.json`
- [ ] Exports `recordHealingAttempt()` function
- [ ] Exports `rankRepairsForFailure()` function
- [ ] Scoring: exact fingerprint boost 1000, category match 200, success boost 500, component pattern boost 50

### selfHeal/promotion.ts verification
- [ ] ~157 lines
- [ ] Exports `shouldPromoteRepairEntry()` function
- [ ] Exports `getPromotedRepairsForGeneration()` function
- [ ] Criteria: minSuccesses:2, minAttempts:2, minSuccessRate:0.9

### selfHeal/repairEngine.ts verification
- [ ] ~129 lines
- [ ] Exports `chooseRepairStrategy()` function
- [ ] Exports `NOOP_REPAIR_ACTION` constant
- [ ] Orchestrates 11 repair strategies

### selfHeal/repairTraits.ts verification
- [ ] ~82 lines
- [ ] Exports `buildRepairTraitsFromComponents()` function

### selfHeal/repairs/index.ts verification
- [ ] Barrel re-exports all 11 strategy modules

### selfHeal/repairs/utils.ts verification
- [ ] ~170 lines
- [ ] Exports: `insertStatementAfterImports`, `insertSetupSnippet`, `wrapFirstRenderArgument`, `createWrapperSnippets`, `normalizeRelativeImportSpecifiers`, `applyStringReplacements`, `upgradeFirstScreenQueryToFindBy`, `ensureAsyncTestCallback`, `findMatchingParen`

### Repair strategies verification (all should export a `RepairStrategy` constant)
- [ ] asyncQueryStrategy.ts — Priority 85
- [ ] importPathNormalizationStrategy.ts — Priority 80
- [ ] importResolutionHintsStrategy.ts — Priority 95
- [ ] jestDomMatcherStrategy.ts — Priority 90
- [ ] missingExternalModuleStrategy.ts — Priority 90, vitest/jest aware
- [ ] moduleMockStrategy.ts — Priority 88
- [ ] providerWrapperStrategy.ts — Priority 80
- [ ] queryClientMissingStrategy.ts — Priority 95
- [ ] reduxStoreMissingStrategy.ts — Priority 92
- [ ] routerMissingStrategy.ts — Priority 95
- [ ] selectorStrategy.ts — Priority 84

---

## CHUNK 8 VERIFICATION: Utils and Workspace

### utils/path.ts verification
- [ ] ~323 lines
- [ ] Exports `resolveRenderHelper()` function
- [ ] Exports `scanSourceFiles()` function
- [ ] Exports `getTestFilePath()` function
- [ ] Exports `isTestFile()` function
- [ ] `detectRenderExport()` contains async render helper skip logic:
  ```
  const asyncCheck = new RegExp(
    `export\\s+const\\s+${customExportMatch[1]}\\s*=\\s*async\\b|` +
    `export\\s+async\\s+function\\s+${customExportMatch[1]}\\b`
  );
  if (asyncCheck.test(content)) return null;
  ```
- [ ] Searches 14 directory patterns and 14 file name patterns for render helpers

### utils/framework.ts verification
- [ ] ~109 lines
- [ ] Exports `detectTestFramework()` function (detects jest/vitest via config files and package.json)
- [ ] Exports `detectFrameworkForFile()` function
- [ ] Exports `setActiveFramework()` function
- [ ] Exports `getActiveFramework()` function
- [ ] Exports `mockFn()` — returns `'vi.fn()'` or `'jest.fn()'`
- [ ] Exports `mockModuleFn()` — returns `'vi.mock'` or `'jest.mock'`
- [ ] Exports `mockGlobalName()` — returns `'vi'` or `'jest'`
- [ ] Exports `buildTestGlobalsImport()` — returns vitest or jest import line
- [ ] Exports `buildDomMatchersImport()` — returns matcher import
- [ ] No `require()` usage

### workspace/config.ts verification
- [ ] ~319 lines
- [ ] Exports `TestgenConfig` type/interface
- [ ] Exports `TestOutputConfig` supporting strategies: colocated, subfolder, mirror
- [ ] Exports `ExistingTestStrategy`: merge, replace, skip
- [ ] Config loader reads from `react-testgen.config.json`

### workspace/discovery.ts verification
- [ ] ~254 lines (approx)
- [ ] Exports workspace package resolution
- [ ] Exports target file discovery
- [ ] Supports 4 modes: git-unstaged, changed-since, all, file

---

## CHUNK 9 VERIFICATION: Config Files

### package.json verification
- [ ] Has `ts-morph` or `typescript` in dependencies
- [ ] Has required devDependencies for testing
- [ ] `main` or `bin` field points to correct entry

### tsconfig.json verification
- [ ] `compilerOptions.module` is set to a modern value (ES2020, ESNext, etc.)
- [ ] `compilerOptions.moduleResolution` is `node` or `bundler`
- [ ] Includes `src/**/*`

### tsconfig.test.json verification (if present)
- [ ] Extends base tsconfig
- [ ] Includes test files

### react-testgen.config.json verification
- [ ] Has `testOutput` configuration
- [ ] Has `framework` field or auto-detection settings

---

## GLOBAL VERIFICATION CHECKS

Run these after applying ALL chunks:

### 1. No require() as actual imports
```bash
# Should return ZERO results (template strings with require are OK)
grep -rn "^const.*= require(" packages/testgen/src/
grep -rn "^let.*= require(" packages/testgen/src/
grep -rn "^var.*= require(" packages/testgen/src/
```

### 2. No var declarations (ES5)
```bash
grep -rn "^\s*var " packages/testgen/src/
# Should return ZERO results
```

### 3. All imports are ES6 style
```bash
# Should return many results — all imports should be `import` statements
grep -c "^import " packages/testgen/src/**/*.ts | grep -v ":0$"
```

### 4. container.toBeTruthy() everywhere
```bash
# Should return ZERO container.toBeInTheDocument:
grep -rn "container).toBeInTheDocument" packages/testgen/src/
# Should return multiple container.toBeTruthy:
grep -rn "container).toBeTruthy" packages/testgen/src/
```

### 5. Framework-aware mock functions
```bash
# generator/index.ts should import from framework utils:
grep "mockFn\|mockModuleFn\|mockGlobalName" packages/testgen/src/generator/index.ts
# Should NOT have hardcoded jest.mock in mock-hook/fix-mock-return blocks:
# (Check manually — jest.mock in template strings for generated code is expected)
```

### 6. Cross-file import integrity
```bash
# TypeScript compilation check — the ultimate verification:
cd packages/testgen && npx tsc --noEmit
# Should complete with ZERO errors
```

### 7. Heal system integration
```bash
# Verify the heal entry point exports everything cli.ts needs:
grep "export" packages/testgen/src/healer/index.ts
# Should show: heal, recordHealOutcome, isDuplicateHealAttempt, DEFAULT_MAX_HEAL_ATTEMPTS
# Plus re-exports of types
```

### 8. Directory structure
```
packages/testgen/src/
├── analyzer.ts
├── cli.ts
├── config.ts
├── failureContext.ts
├── repairMemory.ts
├── scaffold.ts
├── selfHeal.ts
├── eligibility/
│   ├── index.ts
│   ├── types.ts
│   ├── classifier.ts
│   ├── engine.ts
│   ├── reporter.ts
│   ├── scoring.ts
│   └── signals.ts
├── generator/
│   ├── autoMocks.ts
│   ├── context.ts
│   ├── contextValues.ts
│   ├── contextVariants.ts
│   ├── index.ts
│   ├── interactions.ts
│   ├── mocks.ts
│   ├── patchTypes.ts
│   ├── render.ts
│   ├── safePatterns.ts
│   ├── store.ts
│   ├── templates.ts
│   ├── utility.ts
│   └── variants.ts
├── heal/
│   ├── index.ts
│   ├── classifier.ts
│   ├── memory.ts
│   ├── repair.ts
│   └── report.ts
├── healer/
│   ├── index.ts
│   ├── analyzer.ts
│   ├── knowledge-base.ts
│   └── memory.ts
├── selfHeal/
│   ├── index.ts
│   ├── types.ts
│   ├── failureClassifier.ts
│   ├── healReport.ts
│   ├── healingMemory.ts
│   ├── promotion.ts
│   ├── repairEngine.ts
│   ├── repairTraits.ts
│   └── repairs/
│       ├── index.ts
│       ├── utils.ts
│       ├── asyncQueryStrategy.ts
│       ├── importPathNormalizationStrategy.ts
│       ├── importResolutionHintsStrategy.ts
│       ├── jestDomMatcherStrategy.ts
│       ├── missingExternalModuleStrategy.ts
│       ├── moduleMockStrategy.ts
│       ├── providerWrapperStrategy.ts
│       ├── queryClientMissingStrategy.ts
│       ├── reduxStoreMissingStrategy.ts
│       ├── routerMissingStrategy.ts
│       └── selectorStrategy.ts
├── utils/
│   ├── path.ts
│   └── framework.ts
└── workspace/
    ├── config.ts
    └── discovery.ts
```

---

## QUICK SMOKE TEST

After applying all chunks, run:

```bash
# 1. Compile check
cd packages/testgen && npx tsc --noEmit

# 2. Generate test for a single component
npx ts-node packages/testgen/src/cli.ts path/to/some/Component.tsx

# 3. Generate + heal for a single component
npx ts-node packages/testgen/src/cli.ts path/to/some/Component.tsx --heal

# 4. Full run on all files
npx ts-node packages/testgen/src/cli.ts --all --heal
```

Expected behavior:
- Tests should use `expect(container).toBeTruthy()` not `toBeInTheDocument()`
- Vitest projects should get `vi.mock`/`vi.fn` (not `jest.mock`/`jest.fn`)
- Projects without `renderWithProviders` should NOT get `renderWithProviders` imports
- Healing should accumulate fixes across attempts (not lose previous fixes)
- Async render helpers (like `renderApp = async () => ...`) should be skipped
