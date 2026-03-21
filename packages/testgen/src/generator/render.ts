import { ComponentSemanticPlan, ProviderDescriptor } from './semanticPlan';

export function buildRenderHelper(plan: ComponentSemanticPlan): string {
  const paramsDecl = plan.component.props.length > 0 ? '(props = {})' : '()';
  const propsSpread = plan.component.props.length > 0 ? ' {...defaultProps} {...props}' : '';
  const wrappedJsx = wrapWithProviders(`<${plan.component.name}${propsSpread} />`, plan.providers);
  const optionsSuffix = plan.renderStrategy.optionsExpression ? `, ${plan.renderStrategy.optionsExpression}` : '';

  return [
    `const renderUI = ${paramsDecl} =>`,
    `  ${plan.renderStrategy.functionName}(${wrappedJsx}${optionsSuffix});`,
  ].join('\n');
}

function wrapWithProviders(jsx: string, providers: ProviderDescriptor[]): string {
  return providers
    .filter((provider) => provider.validated)
    .reduceRight((inner, provider) => {
      const valueAttr = provider.valueExpression ? ` value={${provider.valueExpression}}` : '';
      const propsAttr = provider.propsExpression ? ` ${provider.propsExpression}` : '';
      return `<${provider.wrapperExpression}${valueAttr}${propsAttr}>${inner}</${provider.wrapperExpression}>`;
    }, jsx);
}
