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
    hasAsyncEffect: false, thirdPartyImports: [], serviceImports: [], ...overrides,
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
  assert.match(ts2322Fixed ?? '', /as const/, 'TS2322 failures should trigger deterministic type-safe regeneration');

  const hookFailure = `TypeError: Cannot destructure property 'profile' of 'useProfile(...)' as it is undefined`;
  const hookContext = parseFailureContext(hookFailure);
  assert.equal(hookContext.kind, 'hook-shape');
  const hookFixed = applyFixRules('import { useProfile } from \"../hooks/useProfile\";\nconst x = useProfile();', hookFailure, 'x.tsx', 1, hookContext);
  assert.ok(Boolean(hookFixed), 'hook destructuring should trigger hook-shape fix');

  const providerOutput = generateForFixture('provider', 'src/components/BigProviderComponent.tsx');
  assert.match(providerOutput, /QueryClientProvider/, 'provider-heavy component should include query provider');
  const routerFailure = 'useNavigate() may be used only in the context of a <Router> component';
  const providerFixed = applyFixRules(providerOutput, routerFailure, 'x.tsx', 1, parseFailureContext(routerFailure));
  assert.match(providerFixed ?? '', /MemoryRouter/, 'provider-required runtime failures should apply router wrapper repair');

  const aliasError = `Cannot find module '../..//components/AliasComp'`;
  const aliasFixed = applyFixRules('import AliasComp from "./../components/AliasComp";', aliasError, 'x.tsx', 1, parseFailureContext(aliasError));
  assert.match(aliasFixed ?? '', /\.\.\//, 'relative import self-heal should normalize malformed local paths');

  const matcherContext = parseFailureContext('TypeError: expect(...).toBeInTheDocument is not a function');
  assert.equal(matcherContext.kind, 'matcher');
  const matcherFixed = applyFixRules('import { expect } from "@jest/globals";', matcherContext.raw, 'x.tsx', 1, matcherContext);
  assert.match(matcherFixed ?? '', /@testing-library\/jest-dom/);

  setActiveFramework('jest');
  const jestMocks = buildAutoMocks(baseComponent({ serviceImports: ['axios-service'] }));
  assert.ok(jestMocks.some((m) => m.startsWith('jest.mock')), 'jest mode should emit jest.mock');

  setActiveFramework('vitest');
  const vitestMocks = buildAutoMocks(baseComponent({ serviceImports: ['axios-service'] }));
  assert.ok(vitestMocks.some((m) => m.startsWith('vi.mock')), 'vitest mode should emit vi.mock');

  setActiveFramework(null);
  console.log('Regression checks passed');
}

run();
