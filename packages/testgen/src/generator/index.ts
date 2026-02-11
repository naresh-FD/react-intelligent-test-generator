import { ComponentInfo } from '../analyzer';
import { buildHeader, buildImports, buildDescribeStart, buildDescribeEnd, buildTestBlock, buildAsyncTestBlock, joinBlocks, buildFileContent } from './templates';
import { buildDefaultProps } from './mocks';
import { buildRenderHelper } from './render';
import { buildRenderAssertions, buildInteractionTests, buildConditionalRenderTests, buildNegativeBranchTests, buildCallbackPropTests, buildOptionalPropTests } from './interactions';
import { buildVariantRenders } from './variants';

export interface GenerateOptions {
    pass: 1 | 2;
    testFilePath: string;
    sourceFilePath: string;
}

export function generateTests(components: ComponentInfo[], options: GenerateOptions): string {
    const usesUserEvent = components.some((c) => c.buttons.length > 0 || c.inputs.length > 0 || c.selects.length > 0 || c.links.length > 0);
    const needsScreen = usesUserEvent || components.some((c) => c.buttons.length > 0 || c.inputs.length > 0 || c.selects.length > 0 || c.links.length > 0);

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

        // Callback prop tests
        const callbackTests = buildCallbackPropTests(component);
        callbackTests.forEach((testCase) => {
            blocks.push(buildTestBlock(testCase.title, testCase.body));
        });

        // Variant renders (boolean, enum, optional prop combinations)
        const variants = buildVariantRenders(component);
        if (variants.length > 0) {
            blocks.push(buildTestBlock('renders variant props', variants));
        }

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
