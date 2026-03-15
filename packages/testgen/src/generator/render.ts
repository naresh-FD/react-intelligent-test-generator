import { ComponentInfo } from '../analyzer';
import { getRenderFunctionName } from './templates';
import { resolveRenderHelper } from '../utils/path';
import type { RepairPlan } from '../healer/knowledge-base';

export function buildRenderHelper(
  component: ComponentInfo,
  sourceFilePath?: string,
  repairPlan?: RepairPlan
): string {
  const renderFn = sourceFilePath
    ? getRenderFunctionName(component, sourceFilePath)
    : 'render';

  // Check if repair plan says to use renderWithProviders
  // But only if the project actually has a custom render helper
  const hasCustomRender = sourceFilePath ? resolveRenderHelper(sourceFilePath) !== null : false;
  const useCustomRender = hasCustomRender && repairPlan?.actions.some(
    (a) => a.kind === 'use-render-helper' && a.helper === 'renderWithProviders'
  );
  const effectiveRenderFn = useCustomRender ? 'renderWithProviders' : renderFn;

  // Collect wrappers from repair plan (MemoryRouter, QueryClientProvider, etc.)
  const wrapperActions = repairPlan?.actions.filter((a) => a.kind === 'add-wrapper') ?? [];

  const renderOptions: string[] = [];
  // Only add auth options for known custom render functions (not plain 'render')
  if (effectiveRenderFn !== 'render' && component.usesAuthHook) {
    renderOptions.push('withAuthProvider: false');
    const authState = deriveAuthState(component);
    renderOptions.push(`authState: ${authState}`);
  }
  const optionsSuffix = renderOptions.length > 0 ? `, { ${renderOptions.join(', ')} }` : '';

  // Build the JSX element
  const propsSpread = component.props.length > 0 ? ' {...defaultProps} {...props}' : '';
  const paramsDecl = component.props.length > 0 ? '(props = {})' : '()';
  let jsx = `<${component.name}${propsSpread} />`;

  // Wrap with repair-plan wrappers (idempotent — each wrapper applied once)
  for (const action of wrapperActions) {
    if (action.kind === 'add-wrapper') {
      // Don't double-wrap if the render function already provides this wrapper
      // (e.g., renderWithProviders already includes MemoryRouter)
      if (effectiveRenderFn !== 'render') continue;

      if (action.wrapper === 'QueryClientProvider') {
        jsx = `<QueryClientProvider client={new QueryClient()}>${jsx}</QueryClientProvider>`;
      } else {
        jsx = `<${action.wrapper}>${jsx}</${action.wrapper}>`;
      }
    }
  }

  return [
    `const renderUI = ${paramsDecl} =>`,
    `  ${effectiveRenderFn}(${jsx}${optionsSuffix});`,
  ].join('\n');
}

function deriveAuthState(component: ComponentInfo): string {
  const name = component.name;
  // Check for common auth-related route patterns generically
  if (
    /public/i.test(name) ||
    /login/i.test(name) ||
    /register/i.test(name) ||
    /signup/i.test(name)
  ) {
    return '{ isAuthenticated: false, isLoading: false }';
  }
  if (
    /protected/i.test(name) ||
    /private/i.test(name) ||
    /auth/i.test(name) ||
    /dashboard/i.test(name)
  ) {
    return '{ isAuthenticated: true, isLoading: false }';
  }
  return '{ isAuthenticated: false, isLoading: false }';
}
