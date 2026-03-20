import path from 'node:path';
import { Project, TypeChecker } from 'ts-morph';
import { ComponentInfo } from '../analyzer';
import type { RepairPlan } from '../healer/knowledge-base';
import type { ReferencePatternSummary } from '../repoPatterns';
import { resolveRenderHelper } from '../utils/path';
import { ContextMockValue, generateContextMockValue } from './contextValues';
import { getRenderFunctionName } from './templates';

interface ProviderWrapperTemplate {
  name: string;
  valueObjectName?: string;
}

interface BuildContextRenderInfoOptions {
  sourceFilePath: string;
  testFilePath: string;
}

export interface ContextRenderInfo {
  contextImports: string[];
  mockDeclarations: string[];
  contextMocks: ContextMockValue[];
}

export function buildRenderHelper(
  component: ComponentInfo,
  sourceFilePath?: string,
  repairPlan?: RepairPlan,
  referencePatterns?: ReferencePatternSummary,
  contextInfo?: ContextRenderInfo,
): string {
  const renderFn = sourceFilePath
    ? getRenderFunctionName(component, sourceFilePath)
    : 'render';

  const hasCustomRender = sourceFilePath ? resolveRenderHelper(sourceFilePath) !== null : false;
  const useCustomRender = hasCustomRender && repairPlan?.actions.some(
    (action) => action.kind === 'use-render-helper' && action.helper === 'renderWithProviders',
  );
  const effectiveRenderFn = useCustomRender ? 'renderWithProviders' : renderFn;
  const wrapperActions = repairPlan?.actions.filter((action) => action.kind === 'add-wrapper') ?? [];

  const renderOptions: string[] = [];
  if (effectiveRenderFn !== 'render' && component.usesAuthHook) {
    renderOptions.push('withAuthProvider: false');
    renderOptions.push(`authState: ${deriveAuthState(component)}`);
  }
  const optionsSuffix = renderOptions.length > 0 ? `, { ${renderOptions.join(', ')} }` : '';

  const propsSpread = component.props.length > 0 ? ' {...defaultProps} {...props}' : '';
  const paramsDecl = component.props.length > 0 ? '(props = {})' : '()';
  let jsx = `<${component.name}${propsSpread} />`;

  const referenceWrappers = buildReferenceWrappers(component, referencePatterns);
  const existingWrapperNames = new Set(referenceWrappers.map((wrapper) => wrapper.name));
  for (const wrapper of referenceWrappers.reverse()) {
    if (wrapper.valueObjectName) {
      jsx = `<${wrapper.name} value={${wrapper.valueObjectName}}>${jsx}</${wrapper.name}>`;
    } else {
      jsx = `<${wrapper.name}>${jsx}</${wrapper.name}>`;
    }
  }

  if (effectiveRenderFn === 'render' && component.usesReactQuery) {
    jsx = `<QueryClientProvider client={new QueryClient()}>${jsx}</QueryClientProvider>`;
  }

  if (effectiveRenderFn === 'render' && component.usesRouter) {
    jsx = `<MemoryRouter>${jsx}</MemoryRouter>`;
  }

  for (const contextMock of [...(contextInfo?.contextMocks ?? [])].reverse()) {
    if (existingWrapperNames.has(`${contextMock.importName}.Provider`)) continue;
    jsx = `<${contextMock.importName}.Provider value={${contextMock.mockVarName}}>${jsx}</${contextMock.importName}.Provider>`;
  }

  for (const action of wrapperActions) {
    if (action.kind !== 'add-wrapper') continue;
    if (effectiveRenderFn !== 'render') continue;

    if (action.wrapper === 'QueryClientProvider') {
      jsx = `<QueryClientProvider client={new QueryClient()}>${jsx}</QueryClientProvider>`;
    } else {
      jsx = `<${action.wrapper}>${jsx}</${action.wrapper}>`;
    }
  }

  return [
    `const renderUI = ${paramsDecl} =>`,
    `  ${effectiveRenderFn}(${jsx}${optionsSuffix});`,
  ].join('\n');
}

export function buildContextRenderInfo(
  component: ComponentInfo,
  project: Project,
  checker: TypeChecker,
  options: BuildContextRenderInfoOptions,
): ContextRenderInfo {
  const contextImports: string[] = [];
  const mockDeclarations: string[] = [];
  const contextMocks: ContextMockValue[] = [];

  for (const context of component.contexts) {
    const mock = generateContextMockValue(context, project, checker);
    if (!mock) continue;

    contextMocks.push(mock);
    const importPath = resolveContextImportPath(mock.importPath, options.sourceFilePath, options.testFilePath);
    const importLine = `import { ${mock.importName} } from "${importPath}";`;
    if (!contextImports.includes(importLine)) {
      contextImports.push(importLine);
    }
    if (!mockDeclarations.includes(mock.mockDeclaration)) {
      mockDeclarations.push(mock.mockDeclaration);
    }
  }

  return {
    contextImports,
    mockDeclarations,
    contextMocks,
  };
}

function deriveAuthState(component: ComponentInfo): string {
  const name = component.name;
  if (/public|login|register|signup/i.test(name)) {
    return '{ isAuthenticated: false, isLoading: false }';
  }
  if (/protected|private|auth|dashboard/i.test(name)) {
    return '{ isAuthenticated: true, isLoading: false }';
  }
  return '{ isAuthenticated: false, isLoading: false }';
}

function buildReferenceWrappers(
  component: ComponentInfo,
  referencePatterns?: ReferencePatternSummary,
): ProviderWrapperTemplate[] {
  if (!referencePatterns) return [];

  const wrappers: ProviderWrapperTemplate[] = [];
  const seen = new Set<string>();

  for (const wrapper of referencePatterns.providerWrappers) {
    const lowerName = wrapper.name.toLowerCase();
    const isContextWrapper =
      /\.provider$/i.test(wrapper.name)
      && component.contexts.some((context) =>
        lowerName.includes(context.contextName.toLowerCase().replace(/context$/, '')),
      );
    const isFrameworkWrapper =
      wrapper.name === 'MemoryRouter'
      || wrapper.name === 'QueryClientProvider'
      || (wrapper.name === 'Provider' && component.usesRedux);

    if (!isContextWrapper && !isFrameworkWrapper) continue;

    const key = `${wrapper.name}::${wrapper.valueObjectName ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    wrappers.push({
      name: wrapper.name,
      valueObjectName: wrapper.valueObjectName,
    });
  }

  return wrappers;
}

function resolveContextImportPath(importPath: string, sourceFilePath: string, testFilePath: string): string {
  if (!importPath.startsWith('.')) return importPath;

  const sourceDir = path.dirname(sourceFilePath);
  const absoluteTarget = path.resolve(sourceDir, importPath);
  const testDir = path.dirname(testFilePath);
  let relativePath = path.relative(testDir, absoluteTarget).split('\\').join('/');
  if (!relativePath.startsWith('.')) {
    relativePath = `./${relativePath}`;
  }
  return relativePath.replace(/\.(tsx?|jsx?)$/, '');
}
