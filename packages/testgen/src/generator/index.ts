import { ComponentInfo } from '../analyzer';
import type { RepairPlan } from '../healer/knowledge-base';
import type { ReferencePatternSummary } from '../repoPatterns';
import { mineReferencePatterns } from '../repoPatterns';
import { TypeChecker, Project } from 'ts-morph';
import { mockFn, mockGlobalName, mockModuleFn } from '../utils/framework';
import {
  buildAsyncTestBlock,
  buildDescribeEnd,
  buildDescribeStart,
  buildFileContent,
  buildHeader,
  buildImports,
  buildTestBlock,
  joinBlocks,
} from './templates';
import { buildDefaultProps } from './mocks';
import { buildAutoMocks } from './autoMocks';
import {
  buildCallbackPropTests,
  buildConditionalRenderTests,
  buildFormSubmissionTest,
  buildInteractionTests,
  buildNegativeBranchTests,
  buildOptionalPropTests,
  buildRenderAssertions,
  buildStateTests,
} from './interactions';
import { buildReferenceAwareSetup, buildReferenceScenarioTests } from './repoAware';
import { buildContextRenderInfo, buildRenderHelper } from './render';
import { buildVariantTestCases } from './variants';
import { buildContextVariantTests } from './contextVariants';

export interface GenerateOptions {
  pass: 1 | 2;
  testFilePath: string;
  sourceFilePath: string;
  repairPlan?: RepairPlan;
  project?: Project;
  checker?: TypeChecker;
  referencePatterns?: ReferencePatternSummary | null;
}

export function generateTests(components: ComponentInfo[], options: GenerateOptions): string {
  const usesUserEvent = components.some(
    (component) =>
      component.buttons.length > 0
      || component.inputs.length > 0
      || component.selects.length > 0
      || component.links.length > 0,
  );

  let needsScreen = usesUserEvent || components.some((component) =>
    component.buttons.length > 0
    || component.inputs.length > 0
    || component.selects.length > 0
    || component.links.length > 0
    || component.conditionalElements.length > 0
    || component.forms.length > 0
    || component.props.some((prop) =>
      /^(is)?(loading|pending|fetching|submitting|processing|busy|error|failed|invalid|disabled|readOnly|locked|readonly)/i.test(
        prop.name,
      ),
    ),
  );

  const repairPlan = options.repairPlan;
  const referencePatterns = options.referencePatterns === undefined
    ? mineReferencePatterns(options.sourceFilePath, options.testFilePath, components)
    : options.referencePatterns;
  if (referencePatterns && Object.values(referencePatterns.scenarios).some(Boolean)) {
    needsScreen = true;
  }

  const contextRenderInfos = components.map((component) => {
    if (!options.project || !options.checker || component.contexts.length === 0) {
      return null;
    }
    return buildContextRenderInfo(component, options.project, options.checker, {
      sourceFilePath: options.sourceFilePath,
      testFilePath: options.testFilePath,
    });
  });

  const contextImports = contextRenderInfos.flatMap((entry) => entry?.contextImports ?? []);
  const repoAwareSetups = components.map((component) =>
    buildReferenceAwareSetup(component, referencePatterns ?? undefined, {
      sourceFilePath: options.sourceFilePath,
      testFilePath: options.testFilePath,
    }),
  );
  const usesBeforeEach = repoAwareSetups.some((setup) => setup.beforeEachLines.length > 0);

  const parts: string[] = [];
  parts.push(buildHeader());
  parts.push(
    buildImports(components, {
      testFilePath: options.testFilePath,
      sourceFilePath: options.sourceFilePath,
      usesUserEvent,
      needsScreen,
      contextImports,
      repairPlan,
      referencePatterns: referencePatterns ?? undefined,
      usesBeforeEach,
    }),
  );

  const allAutoMocks: string[] = [];
  components.forEach((component, index) => {
    const setup = repoAwareSetups[index];
    allAutoMocks.push(...setup.declarations);
    allAutoMocks.push(...setup.mockStatements);
    allAutoMocks.push(
      ...buildAutoMocks(component, {
        sourceFilePath: options.sourceFilePath,
        testFilePath: options.testFilePath,
        skipHookMocks: (referencePatterns?.moduleMocks ?? []).map((entry) => entry.exportName),
      }),
    );
  });
  if (allAutoMocks.length > 0) {
    parts.push(dedupeSnippets(allAutoMocks).join('\n\n'));
  }

  if (repairPlan) {
    const mockBlocks = buildRepairMockBlocks(repairPlan);
    if (mockBlocks) {
      parts.push(mockBlocks);
    }
  }

  components.forEach((component, index) => {
    const blocks: string[] = [];
    const contextInfo = contextRenderInfos[index];
    const repoAwareSetup = repoAwareSetups[index];

    blocks.push(buildDescribeStart(component));

    if (repoAwareSetup.beforeEachLines.length > 0) {
      blocks.push([
        '  beforeEach(() => {',
        ...repoAwareSetup.beforeEachLines.map((line) => `    ${line}`),
        '  });',
      ].join('\n'));
    }

    contextInfo?.mockDeclarations.forEach((declaration) => {
      blocks.push(`  ${declaration}`);
    });

    if (component.props.length > 0) {
      blocks.push(`  ${buildDefaultProps(component)}`);
    }

    blocks.push(`  ${buildRenderHelper(component, options.sourceFilePath, repairPlan, referencePatterns ?? undefined, contextInfo ?? undefined)}`);

    const renderAssertions = buildRenderAssertions(component, referencePatterns ?? undefined);
    blocks.push(buildTestBlock('renders without crashing', renderAssertions));

    if (renderAssertions.length > 2) {
      blocks.push(buildTestBlock('renders key elements', renderAssertions));
    }

    buildReferenceScenarioTests(component, referencePatterns ?? undefined).forEach((testCase) => {
      if (testCase.isAsync) {
        blocks.push(buildAsyncTestBlock(testCase.title, testCase.body));
      } else {
        blocks.push(buildTestBlock(testCase.title, testCase.body));
      }
    });

    buildConditionalRenderTests(component).forEach((testCase) => {
      blocks.push(buildTestBlock(testCase.title, testCase.body));
    });

    buildNegativeBranchTests(component).forEach((testCase) => {
      blocks.push(buildTestBlock(testCase.title, testCase.body));
    });

    buildOptionalPropTests(component).forEach((testCase) => {
      blocks.push(buildTestBlock(testCase.title, testCase.body));
    });

    buildCallbackPropTests(component).forEach((testCase) => {
      if (testCase.isAsync) {
        blocks.push(buildAsyncTestBlock(testCase.title, testCase.body));
      } else {
        blocks.push(buildTestBlock(testCase.title, testCase.body));
      }
    });

    buildStateTests(component, referencePatterns ?? undefined).forEach((testCase) => {
      blocks.push(buildTestBlock(testCase.title, testCase.body));
    });

    const formTest = buildFormSubmissionTest(component, referencePatterns ?? undefined);
    if (formTest) {
      blocks.push(buildAsyncTestBlock(formTest.title, formTest.body));
    }

    buildVariantTestCases(component).forEach((variant) => {
      blocks.push(buildTestBlock(variant.title, variant.body));
    });

    if (contextInfo && contextInfo.contextMocks.length > 0) {
      buildContextVariantTests(component, contextInfo.contextMocks).forEach((variant) => {
        blocks.push(buildTestBlock(variant.title, variant.body));
      });
    }

    buildInteractionTests(component).forEach((interaction, index) => {
      blocks.push(buildAsyncTestBlock(`handles interaction ${index + 1}`, interaction.split('\n')));
    });

    blocks.push(buildDescribeEnd());
    parts.push(joinBlocks(blocks));
  });

  return buildFileContent(parts);
}

function buildRepairMockBlocks(plan: RepairPlan): string | null {
  const lines: string[] = [];

  for (const action of plan.actions) {
    if (action.kind === 'mock-hook') {
      const fn = mockFn();
      const mock = mockModuleFn();
      const global = mockGlobalName();
      const defaultReturn = action.valueKind === 'function' ? fn : '{}';
      lines.push(
        `// Auto-heal: mock ${action.hookName}`,
        `${mock}('${resolveHookModule(action.hookName)}', () => ({`,
        `  ...${global}.requireActual('${resolveHookModule(action.hookName)}'),`,
        `  ${action.hookName}: ${global}.fn(() => (${defaultReturn})),`,
        '}));',
        '',
      );
    }
    if (action.kind === 'fix-mock-return') {
      const fn = mockFn();
      const mock = mockModuleFn();
      const global = mockGlobalName();
      const shape =
        action.shapeKind === 'array'
          ? '[]'
          : action.shapeKind === 'function'
            ? fn
            : action.shapeKind === 'promise'
              ? 'Promise.resolve({})'
              : '{}';
      const modulePath = resolveHookModule(action.target);
      lines.push(
        `// Auto-heal: fix mock return shape for ${action.target}`,
        `${mock}('${modulePath}', () => ({`,
        `  ...${global}.requireActual('${modulePath}'),`,
        `  ${action.target}: ${global}.fn(() => (${shape})),`,
        '}));',
        '',
      );
    }
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

function resolveHookModule(hookName: string): string {
  const wellKnown: Record<string, string> = {
    useNavigate: 'react-router-dom',
    useLocation: 'react-router-dom',
    useParams: 'react-router-dom',
    useSearchParams: 'react-router-dom',
    useQuery: '@tanstack/react-query',
    useMutation: '@tanstack/react-query',
    useQueryClient: '@tanstack/react-query',
    useSelector: 'react-redux',
    useDispatch: 'react-redux',
  };
  if (wellKnown[hookName]) return wellKnown[hookName];

  if (/^use\w+Context$/i.test(hookName)) {
    const contextName = hookName.replace(/^use/, '').replace(/Context$/i, '');
    return `../context/${contextName}Context`;
  }

  return `./${hookName}`;
}

function dedupeSnippets(snippets: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const snippet of snippets) {
    const trimmed = snippet.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    deduped.push(trimmed);
  }
  return deduped;
}
