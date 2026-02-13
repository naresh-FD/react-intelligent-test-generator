import { ComponentInfo } from '../analyzer';
import { buildHeader, buildImports, buildDescribeStart, buildDescribeEnd, buildTestBlock, buildAsyncTestBlock, joinBlocks, buildFileContent } from './templates';
import { buildDefaultProps } from './mocks';
import { buildRenderHelper } from './render';
import { buildRenderAssertions, buildInteractionTests, buildConditionalRenderTests, buildNegativeBranchTests, buildCallbackPropTests, buildOptionalPropTests, buildStateTests, buildFormSubmissionTest } from './interactions';
import { buildVariantTestCases } from './variants';

export interface GenerateOptions {
    pass: 1 | 2;
    testFilePath: string;
    sourceFilePath: string;
}

export function generateTests(components: ComponentInfo[], options: GenerateOptions): string {
    const usesUserEvent = components.some((c) => c.buttons.length > 0 || c.inputs.length > 0 || c.selects.length > 0 || c.links.length > 0);
    const needsScreen = usesUserEvent || components.some((c) =>
        c.buttons.length > 0 || c.inputs.length > 0 || c.selects.length > 0 || c.links.length > 0 ||
        c.conditionalElements.length > 0 ||
        c.props.some(p => /^(is)?(loading|pending|fetching|submitting|processing|busy|error|failed|invalid|disabled|readOnly|locked|readonly)/i.test(p.name))
    );

    const parts: string[] = [];
    parts.push(buildHeader());
    parts.push(buildImports(components, {
        testFilePath: options.testFilePath,
        sourceFilePath: options.sourceFilePath,
        usesUserEvent,
        needsScreen,
    }));

    for (const component of components) {
        const blocks: string[] = [];
        blocks.push(buildDescribeStart(component));

        if (component.props.length > 0) {
            blocks.push(`  ${buildDefaultProps(component)}`);
        }

        blocks.push(`  ${buildRenderHelper(component, options.sourceFilePath)}`);

        const renderAssertions = buildRenderAssertions(component);
        blocks.push(
            buildTestBlock('renders without crashing', [
                'const { container } = renderUI();',
                'expect(container).toBeInTheDocument();',
            ])
        );

        if (renderAssertions.length > 2) {
            blocks.push(
                buildTestBlock('renders key elements', [
                    'const { container } = renderUI();',
                    'expect(container).toBeInTheDocument();',
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
