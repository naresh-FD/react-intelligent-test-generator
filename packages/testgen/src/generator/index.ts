import { ComponentInfo } from '../analyzer';
import {
  buildHeader,
  buildImports,
  buildDescribeStart,
  buildDescribeEnd,
  buildTestBlock,
  buildAsyncTestBlock,
  joinBlocks,
  buildFileContent,
} from './templates';
import { buildDefaultProps } from './mocks';
import { buildRenderHelper } from './render';
import { mockFn, mockModuleFn, mockGlobalName } from '../utils/framework';
import {
  buildRenderAssertions,
  buildInteractionTests,
  buildConditionalRenderTests,
  buildNegativeBranchTests,
  buildCallbackPropTests,
  buildOptionalPropTests,
  buildStateTests,
  buildFormSubmissionTest,
} from './interactions';
import { buildVariantTestCases } from './variants';
import type { RepairPlan } from '../healer/knowledge-base';

export interface GenerateOptions {
  pass: 1 | 2;
  testFilePath: string;
  sourceFilePath: string;
  /** Semantic repair plan from the self-healing system. */
  repairPlan?: RepairPlan;
}

/**
 * Build jest.mock() / hook-mock blocks from a RepairPlan.
 * These go after imports, before describe blocks.
 */
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
        `}));`,
        ''
      );
    }
    if (action.kind === 'fix-mock-return') {
      const fn = mockFn();
      const mock = mockModuleFn();
      const global = mockGlobalName();
      const shape =
        action.shapeKind === 'array' ? '[]' :
        action.shapeKind === 'function' ? fn :
        action.shapeKind === 'promise' ? 'Promise.resolve({})' :
        '{}';
      const modulePath = resolveHookModule(action.target);
      lines.push(
        `// Auto-heal: fix mock return shape for ${action.target}`,
        `${mock}('${modulePath}', () => ({`,
        `  ...${global}.requireActual('${modulePath}'),`,
        `  ${action.target}: ${global}.fn(() => (${shape})),`,
        `}));`,
        ''
      );
    }
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Attempt to resolve a hook name to its likely module path.
 * Uses common conventions (useXxxContext → context file, useNavigate → react-router-dom, etc.)
 */
function resolveHookModule(hookName: string): string {
  // Well-known hooks
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

  // Custom context hooks — best guess based on naming convention
  // e.g., useAuthContext → ../context/AuthContext
  if (/^use\w+Context$/i.test(hookName)) {
    const contextName = hookName.replace(/^use/, '').replace(/Context$/i, '');
    return `../context/${contextName}Context`;
  }

  return `./${hookName}`;
}

export function generateTests(components: ComponentInfo[], options: GenerateOptions): string {
  const usesUserEvent = components.some(
    (c) => c.buttons.length > 0 || c.inputs.length > 0 || c.selects.length > 0 || c.links.length > 0
  );
  const needsScreen =
    usesUserEvent ||
    components.some(
      (c) =>
        c.buttons.length > 0 ||
        c.inputs.length > 0 ||
        c.selects.length > 0 ||
        c.links.length > 0 ||
        c.conditionalElements.length > 0 ||
        c.props.some((p) =>
          /^(is)?(loading|pending|fetching|submitting|processing|busy|error|failed|invalid|disabled|readOnly|locked|readonly)/i.test(
            p.name
          )
        )
    );

  const repairPlan = options.repairPlan;

  const parts: string[] = [];
  parts.push(buildHeader());
  parts.push(
    buildImports(components, {
      testFilePath: options.testFilePath,
      sourceFilePath: options.sourceFilePath,
      usesUserEvent,
      needsScreen,
      repairPlan,
    })
  );

  // Apply repair plan: add jest.mock / hook mock blocks after imports
  if (repairPlan) {
    const mockBlocks = buildRepairMockBlocks(repairPlan);
    if (mockBlocks) {
      parts.push(mockBlocks);
    }
  }

  for (const component of components) {
    const blocks: string[] = [];
    blocks.push(buildDescribeStart(component));

    if (component.props.length > 0) {
      blocks.push(`  ${buildDefaultProps(component)}`);
    }

    blocks.push(`  ${buildRenderHelper(component, options.sourceFilePath, repairPlan)}`);

    const renderAssertions = buildRenderAssertions(component);
    blocks.push(
      buildTestBlock('renders without crashing', [
        'const { container } = renderUI();',
        'expect(container).toBeTruthy();',
      ])
    );

    if (renderAssertions.length > 2) {
      blocks.push(
        buildTestBlock('renders key elements', [
          'const { container } = renderUI();',
          'expect(container).toBeTruthy();',
          ...renderAssertions.slice(2),
        ])
      );
    }

    // Always generate comprehensive tests (pass 2 level)
    const conditionalTests = buildConditionalRenderTests(component);
    conditionalTests.forEach((testCase) => {
      blocks.push(buildTestBlock(testCase.title, testCase.body));
    });

    // Negative branch tests (prop=false)
    const negativeTests = buildNegativeBranchTests(component);
    negativeTests.forEach((testCase) => {
      blocks.push(buildTestBlock(testCase.title, testCase.body));
    });

    // Optional prop tests
    const optionalTests = buildOptionalPropTests(component);
    optionalTests.forEach((testCase) => {
      blocks.push(buildTestBlock(testCase.title, testCase.body));
    });

    // Callback prop tests (now actually invoke callbacks)
    const callbackTests = buildCallbackPropTests(component);
    callbackTests.forEach((testCase) => {
      if (testCase.isAsync) {
        blocks.push(buildAsyncTestBlock(testCase.title, testCase.body));
      } else {
        blocks.push(buildTestBlock(testCase.title, testCase.body));
      }
    });

    // State tests (loading, error, empty, disabled)
    const stateTests = buildStateTests(component);
    stateTests.forEach((testCase) => {
      blocks.push(buildTestBlock(testCase.title, testCase.body));
    });

    // Form submission test
    const formTest = buildFormSubmissionTest(component);
    if (formTest) {
      blocks.push(buildAsyncTestBlock(formTest.title, formTest.body));
    }

    // Variant renders - individual test blocks (boolean, enum, optional prop combinations, state variants)
    const variantCases = buildVariantTestCases(component);
    variantCases.forEach((variant) => {
      blocks.push(buildTestBlock(variant.title, variant.body));
    });

    // Interaction tests (click, type, select)
    const interactions = buildInteractionTests(component);
    interactions.forEach((interaction, index) => {
      blocks.push(buildAsyncTestBlock(`handles interaction ${index + 1}`, interaction.split('\n')));
    });

    blocks.push(buildDescribeEnd());
    parts.push(joinBlocks(blocks));
  }

  return buildFileContent(parts);
}
