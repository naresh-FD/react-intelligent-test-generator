import { ComponentInfo } from '../analyzer';
import { getRenderFunctionName } from './templates';

export function buildRenderHelper(component: ComponentInfo, sourceFilePath?: string): string {
  const renderFn = sourceFilePath
    ? getRenderFunctionName(component, sourceFilePath)
    : component.usesRouter
      ? 'render'
      : 'render';

  const renderOptions: string[] = [];
  // Only add auth options for known custom render functions (not plain 'render')
  if (renderFn !== 'render' && component.usesAuthHook) {
    renderOptions.push('withAuthProvider: false');
    const authState = deriveAuthState(component);
    renderOptions.push(`authState: ${authState}`);
  }
  const optionsSuffix = renderOptions.length > 0 ? `, { ${renderOptions.join(', ')} }` : '';

  // When the component uses router hooks (useLocation, useNavigate, etc.) and we're
  // using plain `render` (not a custom renderWithProviders that already wraps Router),
  // wrap the JSX in <MemoryRouter> so hooks have the required context.
  const needsRouterWrap = component.usesRouter && renderFn === 'render';

  if (component.props.length > 0) {
    const jsx = needsRouterWrap
      ? `<MemoryRouter><${component.name} {...defaultProps} {...props} /></MemoryRouter>`
      : `<${component.name} {...defaultProps} {...props} />`;
    return [
      'const renderUI = (props = {}) =>',
      `  ${renderFn}(${jsx}${optionsSuffix});`,
    ].join('\n');
  }

  const jsx = needsRouterWrap
    ? `<MemoryRouter><${component.name} /></MemoryRouter>`
    : `<${component.name} />`;
  return ['const renderUI = () =>', `  ${renderFn}(${jsx}${optionsSuffix});`].join('\n');
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
