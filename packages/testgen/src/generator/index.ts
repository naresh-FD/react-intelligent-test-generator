import { ComponentInfo } from '../analyzer';
import type { RepairPlan } from '../healer/knowledge-base';
import type { ReferencePatternSummary } from '../repoPatterns';
import { mineReferencePatterns } from '../repoPatterns';
import { TypeChecker, Project } from 'ts-morph';
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
import { buildRenderHelper } from './render';
import { buildVariantTestCases } from './variants';
import { buildContextVariantTests } from './contextVariants';
import { buildSemanticTestPlan } from './semanticPlan';
import { validateTestPlan } from '../validation/preEmitValidator';

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
  const referencePatterns = options.referencePatterns === undefined
    ? mineReferencePatterns(options.sourceFilePath, options.testFilePath, components)
    : options.referencePatterns;
  const sourceFile = options.project?.getSourceFile(options.sourceFilePath) ?? null;
  const rawPlan = buildSemanticTestPlan({
    ...options,
    components,
    sourceFile,
    referencePatterns,
  });

  // Validate plan before emission — enforces import-JSX consistency.
  // Any provider whose import was skipped is stripped here, making it
  // structurally impossible for invalid symbols to appear in emitted JSX.
  const semanticPlan = validateTestPlan(rawPlan);

  if (semanticPlan.validationResult.strippedProviders.length > 0) {
    console.log(`  ⚠ Pre-emit validator stripped ${semanticPlan.validationResult.strippedProviders.length} provider(s) with missing imports`);
    for (const stripped of semanticPlan.validationResult.strippedProviders) {
      console.log(`    - ${stripped.key}: ${stripped.reason}`);
    }
  }

  const parts: string[] = [];
  parts.push(buildHeader());
  parts.push(buildImports(semanticPlan.imports));

  if (semanticPlan.topLevelBlocks.length > 0) {
    parts.push(semanticPlan.topLevelBlocks.join('\n\n'));
  }

  if (semanticPlan.globalBeforeEachLines.length > 0) {
    parts.push([
      'beforeEach(() => {',
      ...semanticPlan.globalBeforeEachLines.map((line) => `  ${line}`),
      '});',
    ].join('\n'));
  }

  semanticPlan.componentPlans.forEach((componentPlan) => {
    const component = componentPlan.component;
    const blocks: string[] = [];

    blocks.push(buildDescribeStart(component));

    if (componentPlan.beforeEachLines.length > 0) {
      blocks.push([
        '  beforeEach(() => {',
        ...componentPlan.beforeEachLines.map((line) => `    ${line}`),
        '  });',
      ].join('\n'));
    }

    componentPlan.topLevelDeclarations.forEach((declaration) => {
      blocks.push(`  ${declaration}`);
    });

    if (componentPlan.defaultPropsBlock) {
      blocks.push(`  ${componentPlan.defaultPropsBlock}`);
    }

    blocks.push(`  ${buildRenderHelper(componentPlan)}`);

    const renderAssertions = buildRenderAssertions(component, referencePatterns ?? undefined);
    blocks.push(buildTestBlock('renders without crashing', renderAssertions));
    if (renderAssertions.length > 2) {
      blocks.push(buildTestBlock('renders key elements', renderAssertions));
    }

    componentPlan.scenarioPlans.forEach((scenarioPlan) => {
      if (scenarioPlan.isAsync) {
        blocks.push(buildAsyncTestBlock(scenarioPlan.title, scenarioPlan.body));
      } else {
        blocks.push(buildTestBlock(scenarioPlan.title, scenarioPlan.body));
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

    const contextVariantValues = componentPlan.providers
      .filter((provider) => provider.source === 'context' && provider.importName && provider.valueExpression)
      .map((provider) => ({
        importName: provider.importName!,
        importPath: provider.importModulePath ?? '',
        mockDeclaration: '',
        mockVarName: provider.valueExpression!,
      }));
    if (contextVariantValues.length > 0) {
      buildContextVariantTests(component, contextVariantValues).forEach((variant) => {
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
