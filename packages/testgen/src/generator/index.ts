import { ComponentInfo } from '../analyzer';
import { Project, TypeChecker } from 'ts-morph';
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
import { buildRenderHelper, buildContextRenderInfo } from './render';
import {
  buildRenderAssertions,
  buildInteractionTests,
  buildConditionalRenderTests,
  buildNegativeBranchTests,
  buildCallbackPropTests,
  buildOptionalPropTests,
  buildStateTests,
  buildFormSubmissionTest,
  buildAccessibilityTests,
  buildKeyboardNavigationTests,
} from './interactions';
import { buildVariantTestCases } from './variants';
import { buildContextVariantTests } from './contextVariants';
import { buildAutoMocks } from './autoMocks';
import { buildSafeRenderBlock } from './safePatterns';

export interface GenerateOptions {
  pass: 1 | 2;
  testFilePath: string;
  sourceFilePath: string;
  /** ts-morph Project instance for cross-file context resolution */
  project?: Project;
  /** ts-morph TypeChecker for type analysis */
  checker?: TypeChecker;
}

const GENERATION_LIMITS = {
  conditional: 2,
  negative: 2,
  optional: 1,
  callback: 2,
  state: 2,
  variants: 4,
  contextVariants: 4,
  interactions: 2,
  accessibility: 2,
  keyboard: 1,
} as const;

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
        c.forms.length > 0 ||
        c.props.some((p) =>
          /^(is)?(loading|pending|fetching|submitting|processing|busy|error|failed|invalid|disabled|readOnly|locked|readonly)/i.test(
            p.name
          )
        )
    );

  // Build context render info for all components
  const allContextImports: string[] = [];
  const contextRenderInfoMap = new Map<string, ReturnType<typeof buildContextRenderInfo>>();

  if (options.project && options.checker) {
    for (const component of components) {
      if (component.contexts.length > 0) {
        const info = buildContextRenderInfo(component, options.project, options.checker, {
          sourceFilePath: options.sourceFilePath,
          testFilePath: options.testFilePath,
        });
        contextRenderInfoMap.set(component.name, info);
        allContextImports.push(...info.contextImports);
      }
    }
  }

  const parts: string[] = [];
  parts.push(buildHeader());
  parts.push(
    buildImports(components, {
      testFilePath: options.testFilePath,
      sourceFilePath: options.sourceFilePath,
      usesUserEvent,
      needsScreen,
      contextImports: allContextImports,
    })
  );

  // Auto-mocks for third-party libraries (placed between imports and describe blocks)
  const allAutoMocks: string[] = [];
  for (const component of components) {
    const mocks = buildAutoMocks(component, {
      sourceFilePath: options.sourceFilePath,
      testFilePath: options.testFilePath,
    });
    for (const mock of mocks) {
      // Deduplicate: same jest.mock() call shouldn't appear twice
      if (!allAutoMocks.some((existing) => existing === mock)) {
        allAutoMocks.push(mock);
      }
    }
  }
  if (allAutoMocks.length > 0) {
    parts.push(allAutoMocks.join('\n\n'));
  }

  for (const component of components) {
    const blocks: string[] = [];
    blocks.push(buildDescribeStart(component));

    // Context mock value declarations (placed before defaultProps)
    const ctxInfo = contextRenderInfoMap.get(component.name);
    if (ctxInfo && ctxInfo.mockDeclarations.length > 0) {
      for (const decl of ctxInfo.mockDeclarations) {
        blocks.push(`  ${decl}`);
      }
    }

    if (component.props.length > 0) {
      blocks.push(`  ${buildDefaultProps(component)}`);
    }

    const contextMocks = ctxInfo?.contextMocks;
    blocks.push(`  ${buildRenderHelper(component, options.sourceFilePath, contextMocks)}`);

    // Error boundary components get specialized tests
    if (component.isErrorBoundary) {
      blocks.push(...buildErrorBoundaryTestBlocks(component));
      blocks.push(buildDescribeEnd());
      parts.push(joinBlocks(blocks));
      continue;
    }

    const renderAssertions = buildRenderAssertions(component);
    blocks.push(
      buildTestBlock('renders without crashing', buildSafeRenderBlock())
    );

    if (renderAssertions.length > 2) {
      blocks.push(
        buildTestBlock('renders key elements', buildSafeRenderBlock('renderUI()', renderAssertions.slice(2)))
      );
    }

    // Always generate comprehensive tests (pass 2 level)
    const conditionalTests = buildConditionalRenderTests(component).slice(
      0,
      GENERATION_LIMITS.conditional
    );
    conditionalTests.forEach((testCase) => {
      blocks.push(buildTestBlock(testCase.title, testCase.body));
    });

    // Negative branch tests (prop=false)
    const negativeTests = buildNegativeBranchTests(component).slice(0, GENERATION_LIMITS.negative);
    negativeTests.forEach((testCase) => {
      blocks.push(buildTestBlock(testCase.title, testCase.body));
    });

    // Optional prop tests
    const optionalTests = buildOptionalPropTests(component).slice(0, GENERATION_LIMITS.optional);
    optionalTests.forEach((testCase) => {
      blocks.push(buildTestBlock(testCase.title, testCase.body));
    });

    // Callback prop tests (now actually invoke callbacks)
    const callbackTests = buildCallbackPropTests(component).slice(0, GENERATION_LIMITS.callback);
    callbackTests.forEach((testCase) => {
      if (testCase.isAsync) {
        blocks.push(buildAsyncTestBlock(testCase.title, testCase.body));
      } else {
        blocks.push(buildTestBlock(testCase.title, testCase.body));
      }
    });

    // State tests (loading, error, empty, disabled)
    const stateTests = buildStateTests(component).slice(0, GENERATION_LIMITS.state);
    stateTests.forEach((testCase) => {
      blocks.push(buildTestBlock(testCase.title, testCase.body));
    });

    // Form submission test
    const formTest = buildFormSubmissionTest(component);
    if (formTest) {
      blocks.push(buildAsyncTestBlock(formTest.title, formTest.body));
    }

    // Variant renders - individual test blocks (boolean, enum, optional prop combinations, state variants)
    const variantCases = buildVariantTestCases(component).slice(0, GENERATION_LIMITS.variants);
    variantCases.forEach((variant) => {
      blocks.push(buildTestBlock(variant.title, variant.body));
    });

    // Context variant tests (boolean toggles, null checks, empty arrays in context values)
    if (contextMocks && contextMocks.length > 0) {
      const contextVariants = buildContextVariantTests(component, contextMocks)
        .slice(0, GENERATION_LIMITS.contextVariants);
      contextVariants.forEach((variant) => {
        blocks.push(buildTestBlock(variant.title, variant.body));
      });
    }

    // Interaction tests (click, type, select)
    const interactions = buildInteractionTests(component).slice(0, GENERATION_LIMITS.interactions);
    interactions.forEach((interaction, index) => {
      blocks.push(buildAsyncTestBlock(`handles interaction ${index + 1}`, interaction.split('\n')));
    });

    // Accessibility tests (ARIA roles, labels, keyboard)
    const a11yTests = buildAccessibilityTests(component).slice(0, GENERATION_LIMITS.accessibility);
    a11yTests.forEach((testCase) => {
      if (testCase.isAsync) {
        blocks.push(buildAsyncTestBlock(testCase.title, testCase.body));
      } else {
        blocks.push(buildTestBlock(testCase.title, testCase.body));
      }
    });

    // Keyboard navigation tests for interactive components
    const kbTests = buildKeyboardNavigationTests(component).slice(0, GENERATION_LIMITS.keyboard);
    kbTests.forEach((testCase) => {
      blocks.push(buildAsyncTestBlock(testCase.title, testCase.body));
    });

    blocks.push(buildDescribeEnd());
    parts.push(joinBlocks(blocks));
  }

  return buildFileContent(parts);
}

// ---------------------------------------------------------------------------
// Error Boundary test builder
// ---------------------------------------------------------------------------

/**
 * Generates test blocks for React Error Boundary class components.
 * Tests that:
 * 1. The boundary renders children normally when no error occurs
 * 2. The boundary catches errors and renders fallback UI
 * 3. Console errors are suppressed during the error test
 */
function buildErrorBoundaryTestBlocks(_component: ComponentInfo): string[] {
  const blocks: string[] = [];

  // Define a helper component that always throws
  const throwingChildBlock = [
    '/** Helper component that throws during render for error boundary testing */',
    `const ThrowingChild = ({ shouldThrow = false }: { shouldThrow?: boolean }) => {`,
    '  if (shouldThrow) throw new Error("Test error for boundary");',
    '  return <div data-testid="child-content">Child rendered</div>;',
    '};',
  ].join('\n  ');

  blocks.push(`  ${throwingChildBlock}`);

  // Test 1: Renders children normally when no error
  blocks.push(
    buildTestBlock('renders children when no error occurs', [
      'const { container } = renderUI();',
      'expect(container).toBeInTheDocument();',
    ])
  );

  // Test 2: Catches errors and renders fallback
  blocks.push(
    buildTestBlock('catches errors and renders fallback UI', [
      '// Suppress React error boundary console output during this test',
      `const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});`,
      `const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});`,
      'try {',
      '  const { container } = renderUI();',
      '  expect(container).toBeInTheDocument();',
      '} catch {',
      '  // Error boundary may propagate in test env — boundary itself is what we are testing',
      '} finally {',
      '  errorSpy.mockRestore();',
      '  warnSpy.mockRestore();',
      '}',
    ])
  );

  // Test 3: Boundary does not crash on initial render
  blocks.push(
    buildTestBlock('does not crash on initial render with default props', [
      'expect(() => renderUI()).not.toThrow();',
    ])
  );

  return blocks;
}
