import { ComponentInfo } from '../analyzer';
import { buildVariantProps } from './mocks';

export interface VariantTestCase {
  title: string;
  body: string[];
}

/**
 * Build individual test cases for each prop variant.
 * Each variant gets its own it() block with assertion for better coverage reporting.
 */
export function buildVariantTestCases(component: ComponentInfo): VariantTestCase[] {
  const variants = buildVariantProps(component);
  return variants.map((variant) => ({
    title: variant.label.startsWith('with ')
      ? `renders ${variant.label}`
      : `renders with ${variant.label}`,
    body: [
      `const { container } = renderUI(${variant.propsExpr});`,
      'expect(container).toBeTruthy();',
    ],
  }));
}

/**
 * @deprecated Use buildVariantTestCases for individual test blocks
 */
export function buildVariantRenders(component: ComponentInfo): string[] {
  const variants = buildVariantProps(component);
  return variants.map(
    (variant) =>
      `const { container } = renderUI(${variant.propsExpr});\nexpect(container).toBeTruthy();`
  );
}
