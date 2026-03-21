import assert from 'node:assert/strict';
import path from 'node:path';
import { createParser, getSourceFile } from '../src/parser';
import { analyzeSourceFile, ComponentInfo } from '../src/analyzer';
import { generateTests } from '../src/generator';
import { getTestFilePath, relativeImport } from '../src/utils/path';
import { applyFixRules } from '../src/selfHeal';
import { parseFailureContext } from '../src/failureContext';
import { setActiveFramework } from '../src/utils/framework';
import { buildAutoMocks } from '../src/generator/autoMocks';
import { planMockModules } from '../src/generator/mockRegistry';
import { buildSemanticTestPlan } from '../src/generator/semanticPlan';
import { buildRenderHelper } from '../src/generator/render';
import { runHealedRegressionSuite } from './healedRegression';

const fixturesRoot = path.resolve(__dirname, 'fixtures');

function generateForFixture(projectName: string, sourceRelPath: string): string {
  const fixtureRoot = path.join(fixturesRoot, projectName);
  const sourceFilePath = path.join(fixtureRoot, sourceRelPath);
  const testFilePath = getTestFilePath(sourceFilePath);
  const parser = createParser(fixtureRoot);
  const source = getSourceFile(parser.project, sourceFilePath);
  const components = analyzeSourceFile(source, parser.project, parser.checker);
  return generateTests(components, {
    pass: 1,
    testFilePath,
    sourceFilePath,
    project: parser.project,
    checker: parser.checker,
  });
}

function baseComponent(overrides: Partial<ComponentInfo> = {}): ComponentInfo {
  return {
    name: 'Demo', exportType: 'default', props: [], buttons: [], inputs: [], selects: [], forms: [],
    conditionalElements: [], usesRouter: false, usesAuthHook: false, hooks: [], contexts: [],
    usesUseEffect: false, usesUseState: false, hasForwardRef: false, usesNavigation: false, links: [],
    isErrorBoundary: false, isClassComponent: false, usesReactQuery: false, usesRedux: false,
    usesFramerMotion: false, usesRecharts: false, usesReactHookForm: false, usesPortal: false,
    hasAsyncEffect: false, thirdPartyImports: [], serviceImports: [],
    traits: {
      usesRouter: false,
      usesNavigation: false,
      usesContext: false,
      usesAsyncData: false,
      usesRedux: false,
      usesReactQuery: false,
      usesForms: false,
      usesTabs: false,
      usesModalDialog: false,
      usesTableOrList: false,
      usesPortal: false,
      hasConditionalRenderingBranches: false,
      providerSignals: [],
      contextCount: 0,
      hookCount: 0,
      conditionalBranchCount: 0,
      testing: {
        queryStyle: 'text-first',
        timingStyle: 'sync-first',
        renderStyle: 'direct-render',
        interactionStyle: 'basic',
      },
    },
    ...overrides,
  };
}

function run(): void {
  const depthSource = path.join(fixturesRoot, 'depth/src/components/deep/Widget.tsx');
  const depthTest = getTestFilePath(depthSource);
  const rebased = relativeImport(depthTest, depthSource);
  assert.equal(rebased, '../Widget', 'depth import should be rebased from __tests__ folder');

  const refOutput = generateForFixture('mutable-ref', 'src/components/RefConsumer.tsx');
  assert.match(refOutput, /readyRef:\s*\{\s*current:/, 'MutableRefObject prop should be rendered as current-bearing object');

  const ts2322Fixed = applyFixRules(refOutput, 'error TS2322: Type mismatch', 'x.tsx', 1, parseFailureContext('TS2322'));
  assert.match(ts2322Fixed?.content ?? '', /as const/, 'TS2322 failures should trigger deterministic type-safe regeneration');

  const hookFailure = `TypeError: Cannot destructure property 'profile' of 'useProfile(...)' as it is undefined`;
  const hookContext = parseFailureContext(hookFailure);
  assert.equal(hookContext.kind, 'hook-shape');
  const hookFixed = applyFixRules('import { useProfile } from "../hooks/useProfile";\nconst x = useProfile();', hookFailure, 'x.tsx', 1, hookContext);
  assert.ok(Boolean(hookFixed), 'hook destructuring should trigger hook-shape fix');

  const providerOutput = generateForFixture('provider', 'src/components/BigProviderComponent.tsx');
  assert.match(providerOutput, /QueryClientProvider/, 'provider-heavy component should include query provider');
  const routerFailure = 'useNavigate() may be used only in the context of a <Router> component';
  const providerFixed = applyFixRules(providerOutput, routerFailure, 'x.tsx', 1, parseFailureContext(routerFailure));
  assert.match(providerFixed?.content ?? '', /MemoryRouter/, 'provider-required runtime failures should apply router wrapper repair');

  const aliasError = `Cannot find module '../..//components/AliasComp'`;
  const aliasFixed = applyFixRules('import AliasComp from "./../components/AliasComp";', aliasError, 'x.tsx', 1, parseFailureContext(aliasError));
  assert.match(aliasFixed?.content ?? '', /\.\.\//, 'relative import self-heal should normalize malformed local paths');

  const matcherContext = parseFailureContext('TypeError: expect(...).toBeInTheDocument is not a function');
  assert.equal(matcherContext.kind, 'matcher');
  const matcherFixed = applyFixRules('import { expect } from "@jest/globals";', matcherContext.raw, 'x.tsx', 1, matcherContext);
  assert.match(matcherFixed?.content ?? '', /@testing-library\/jest-dom/);

  setActiveFramework('jest');
  const jestMocks = buildAutoMocks(baseComponent({ serviceImports: ['axios-service'] }));
  assert.ok(jestMocks.some((m) => m.startsWith('jest.mock')), 'jest mode should emit jest.mock');

  setActiveFramework('vitest');
  const vitestMocks = buildAutoMocks(baseComponent({ serviceImports: ['axios-service'] }));
  assert.ok(vitestMocks.some((m) => m.startsWith('vi.mock')), 'vitest mode should emit vi.mock');

  const mockRegistryParser = createParser(path.join(fixturesRoot, 'mock-registry'));
  const defaultServiceSource = getSourceFile(
    mockRegistryParser.project,
    path.join(fixturesRoot, 'mock-registry', 'src/components/UsesDefaultService.tsx'),
  );
  const namedServiceSource = getSourceFile(
    mockRegistryParser.project,
    path.join(fixturesRoot, 'mock-registry', 'src/components/UsesNamedService.tsx'),
  );
  const hookModuleSource = getSourceFile(
    mockRegistryParser.project,
    path.join(fixturesRoot, 'mock-registry', 'src/components/UsesHookModule.tsx'),
  );

  const defaultServiceMocks = planMockModules(
    baseComponent({ serviceImports: ['../services/authService'] }),
    { sourceFile: defaultServiceSource },
  );
  assert.match(defaultServiceMocks[0]?.statement ?? '', /__esModule:\s*true/, 'default export mocks should mark ES module default shape');
  assert.match(defaultServiceMocks[0]?.statement ?? '', /default:/, 'default export mocks should include default');

  const namedServiceMocks = planMockModules(
    baseComponent({ serviceImports: ['../utils/formatters'] }),
    { sourceFile: namedServiceSource },
  );
  assert.match(namedServiceMocks[0]?.statement ?? '', /formatCurrency:/, 'named export mocks should export named bindings');
  assert.doesNotMatch(namedServiceMocks[0]?.statement ?? '', /default:/, 'named export mocks should not emit default export stubs');

  const partialHookMocks = planMockModules(
    baseComponent({
      hooks: [{ name: 'useFeatureData', importSource: '../hooks/useFeatureData' }],
    }),
    { sourceFile: hookModuleSource },
  );
  assert.match(partialHookMocks[0]?.statement ?? '', /requireActual/, 'relative hook mocks should preserve real exports with partial mocks');

  const unresolvedProviderPlan = buildSemanticTestPlan({
    sourceFilePath: path.join(fixturesRoot, 'repo-aware', 'src/components/ScheduledTransfers.tsx'),
    testFilePath: path.join(fixturesRoot, 'repo-aware', 'src/components/__tests__/Ghost.test.tsx'),
    components: [
      baseComponent({
        name: 'GhostComponent',
        contexts: [{
          contextName: 'GhostContext',
          consumedKeys: ['value'],
          isOptional: false,
          name: 'GhostContext',
        }],
      }),
    ],
  });
  const unresolvedRender = buildRenderHelper(unresolvedProviderPlan.componentPlans[0]);
  assert.doesNotMatch(unresolvedRender, /GhostContext\.Provider/, 'unresolved providers should not be emitted into JSX');

  const environmentPlan = buildSemanticTestPlan({
    sourceFilePath: path.join(fixturesRoot, 'mock-registry', 'src/components/UsesNamedService.tsx'),
    testFilePath: path.join(fixturesRoot, 'mock-registry', 'src/components/__tests__/UsesNamedService.test.tsx'),
    components: [baseComponent({ name: 'ChartWidget', usesRecharts: true })],
  });
  const environmentOutput = environmentPlan.topLevelBlocks.join('\n');
  assert.match(environmentOutput, /matchMedia/, 'environment planner should request matchMedia stubs when needed');
  assert.match(environmentOutput, /ResizeObserver/, 'environment planner should request ResizeObserver stubs when needed');
  assert.match(environmentOutput, /HTMLCanvasElement\.prototype\.getContext/, 'environment planner should centralize canvas stubs when needed');

  const repoAwareOutput = generateForFixture('repo-aware', 'src/components/ScheduledTransfers.tsx');
  assert.match(repoAwareOutput, /const createMockFeatureContext =/, 'repo-aware generation should create provider mock factories');
  assert.match(repoAwareOutput, /let mockFeatureContext = createMockFeatureContext\(\);/, 'repo-aware generation should retain reusable provider state');
  assert.match(repoAwareOutput, /const mockUseTransactionsState = vi\.fn\(\(\) => createMockUseTransactionsState\(\)\);/, 'repo-aware generation should create repo-style hook mocks');
  assert.match(repoAwareOutput, /vi\.mock\("\.\.\/\.\.\/hooks\/useTransactionsState"/, 'repo-aware generation should mock sibling hooks');
  assert.match(repoAwareOutput, /beforeEach\(\(\) => \{[\s\S]*vi\.clearAllMocks\(\)/, 'repo-aware generation should adopt local beforeEach clearing patterns');
  assert.match(repoAwareOutput, /<FeatureContext\.Provider value=\{mockFeatureContext\}>/, 'repo-aware generation should reuse mined provider wrappers');
  assert.match(repoAwareOutput, /it\("renders loading state"/, 'repo-aware generation should emit loading scenario tests');
  assert.match(repoAwareOutput, /it\("renders empty state"/, 'repo-aware generation should emit empty-state scenario tests');
  assert.match(repoAwareOutput, /it\("renders error state"/, 'repo-aware generation should emit error scenario tests');
  assert.match(repoAwareOutput, /it\("renders data state"/, 'repo-aware generation should emit data scenario tests');

  setActiveFramework(null);
  runHealedRegressionSuite();
  console.log('Regression checks passed');
}

run();
