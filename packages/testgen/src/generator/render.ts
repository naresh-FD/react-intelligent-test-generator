import { ComponentInfo, ContextUsage } from '../analyzer';
import { getRenderFunctionName } from './templates';
import { ContextMockValue, generateContextMockValue } from './contextValues';
import { Project, TypeChecker } from 'ts-morph';

export interface ContextRenderInfo {
  /** Mock value declarations to place before renderUI */
  mockDeclarations: string[];
  /** Context import lines to add to the file header */
  contextImports: string[];
  /** All generated ContextMockValue objects (for variant tests) */
  contextMocks: ContextMockValue[];
}

/**
 * Build mock declarations and import lines for context-consuming components.
 * Returns empty arrays if the component uses no contexts.
 */
export function buildContextRenderInfo(
  component: ComponentInfo,
  project: Project,
  checker: TypeChecker
): ContextRenderInfo {
  const mockDeclarations: string[] = [];
  const contextImports: string[] = [];
  const contextMocks: ContextMockValue[] = [];

  if (component.contexts.length === 0) {
    return { mockDeclarations, contextImports, contextMocks };
  }

  for (const ctx of component.contexts) {
    const mock = generateContextMockValue(ctx, project, checker);
    if (!mock) continue;

    contextMocks.push(mock);
    mockDeclarations.push(mock.mockDeclaration);

    // The import for the context object (e.g., import { AuthContext } from "...")
    // We need to import the raw context object, not the provider
    const contextName = ctx.contextName;
    const importPath = mock.importPath;
    if (contextName && importPath) {
      contextImports.push(`import { ${contextName} } from "${importPath}";`);
    }
  }

  return { mockDeclarations, contextImports, contextMocks };
}

/**
 * Build the renderUI helper for component tests.
 * Enhanced to wrap components in Context.Provider when they consume contexts.
 */
export function buildRenderHelper(
  component: ComponentInfo,
  sourceFilePath?: string,
  contextMocks?: ContextMockValue[]
): string {
  const renderFn = sourceFilePath
    ? getRenderFunctionName(component, sourceFilePath)
    : 'render';

  const renderOptions: string[] = [];
  // Only add auth options for known custom render functions (not plain 'render')
  if (renderFn !== 'render' && component.usesAuthHook) {
    renderOptions.push('withAuthProvider: false');
    const authState = deriveAuthState(component);
    renderOptions.push(`authState: ${authState}`);
  }
  const optionsSuffix = renderOptions.length > 0 ? `, { ${renderOptions.join(', ')} }` : '';

  // When the component uses router hooks and we're using plain `render`,
  // wrap the JSX in <MemoryRouter>
  const needsRouterWrap = component.usesRouter && renderFn === 'render';

  // Build the component JSX
  const compJsx = component.props.length > 0
    ? `<${component.name} {...defaultProps} {...props} />`
    : `<${component.name} />`;

  // Build context provider wrapping
  const contextWrapping = buildContextProviderJsx(component.contexts, contextMocks);

  // Compose the full JSX with wrapping layers (outermost → innermost → component)
  let fullJsx = compJsx;

  // Wrap with context providers (innermost wrapping)
  if (contextWrapping.openTags.length > 0) {
    fullJsx = `${contextWrapping.openTags.join('')}${fullJsx}${contextWrapping.closeTags.join('')}`;
  }

  // Wrap with MemoryRouter
  if (needsRouterWrap) {
    fullJsx = `<MemoryRouter>${fullJsx}</MemoryRouter>`;
  }

  // Wrap with QueryClientProvider (proactive — detected at analysis time)
  if (component.usesReactQuery) {
    fullJsx = `<QueryClientProvider client={testQueryClient}>${fullJsx}</QueryClientProvider>`;
  }

  // Wrap with Redux Provider (proactive — detected at analysis time)
  if (component.usesRedux) {
    fullJsx = `<ReduxProvider store={testStore}>${fullJsx}</ReduxProvider>`;
  }

  const params = component.props.length > 0 ? '(props = {})' : '()';

  // Portal-using components need a multi-line renderUI with DOM setup
  if (component.usesPortal) {
    return [
      `const renderUI = ${params} => {`,
      '  if (!document.getElementById("portal-root")) {',
      '    const el = document.createElement("div");',
      '    el.id = "portal-root";',
      '    document.body.appendChild(el);',
      '  }',
      `  return ${renderFn}(${fullJsx}${optionsSuffix});`,
      '};',
    ].join('\n');
  }

  return [
    `const renderUI = ${params} =>`,
    `  ${renderFn}(${fullJsx}${optionsSuffix});`,
  ].join('\n');
}

interface ContextJsxWrapping {
  openTags: string[];
  closeTags: string[];
}

/**
 * Build JSX wrapper tags for context providers.
 * Uses Context.Provider with mock values for deterministic, side-effect-free testing.
 */
function buildContextProviderJsx(
  contexts: ContextUsage[],
  contextMocks?: ContextMockValue[]
): ContextJsxWrapping {
  const openTags: string[] = [];
  const closeTags: string[] = [];

  if (!contextMocks || contextMocks.length === 0) {
    return { openTags, closeTags };
  }

  // Map context names to their mock variable names
  for (const ctx of contexts) {
    const mock = contextMocks.find((m) => m.importName === ctx.contextName);
    if (!mock) continue;

    openTags.push(`<${ctx.contextName}.Provider value={${mock.mockVarName}}>`);
    closeTags.unshift(`</${ctx.contextName}.Provider>`);
  }

  return { openTags, closeTags };
}

function deriveAuthState(component: ComponentInfo): string {
  const name = component.name;
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
