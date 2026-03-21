/**
 * Builds a ComponentTestContext from a ComponentInfo.
 *
 * This is the canonical bridge between analysis and planning.
 * All provider requirements are derived from hook/context usage — never guessed.
 */

import type { ComponentInfo } from '../analyzer';
import type { ComponentTestContext, ProviderRequirement, ServiceDependency, PropsModel, ImportedSymbol } from '../types';

/**
 * Build a ComponentTestContext from analyzer output.
 * Provider requirements are derived deterministically from:
 * 1. Hook usage (e.g., useNavigate → MemoryRouter)
 * 2. Context consumption (e.g., useAuth → AuthContext.Provider)
 * 3. Framework trait detection (e.g., usesReactQuery → QueryClientProvider)
 */
export function buildComponentTestContext(
  component: ComponentInfo,
  sourceFilePath: string,
): ComponentTestContext {
  const requiredProviders = deriveProviderRequirements(component);
  const serviceDependencies = deriveServiceDependencies(component);
  const propsModel = derivePropsModel(component);
  const importedSymbols = deriveImportedSymbols(component);
  const stateRiskFlags = deriveStateRiskFlags(component);
  const asyncRiskFlags = deriveAsyncRiskFlags(component);

  return {
    componentPath: sourceFilePath,
    componentName: component.name,
    exportType: component.exportType,
    importedSymbols,
    usedHooks: component.hooks,
    requiredProviders,
    serviceDependencies,
    contexts: component.contexts,
    propsModel,
    stateRiskFlags,
    asyncRiskFlags,
    componentInfo: component,
  };
}

function deriveProviderRequirements(component: ComponentInfo): ProviderRequirement[] {
  const providers: ProviderRequirement[] = [];

  if (component.usesRouter) {
    providers.push({
      providerName: 'MemoryRouter',
      importModulePath: 'react-router-dom',
      importName: 'MemoryRouter',
      importKind: 'named',
      source: 'framework-detection',
    });
  }

  if (component.usesReactQuery) {
    providers.push({
      providerName: 'QueryClientProvider',
      importModulePath: '@tanstack/react-query',
      importName: 'QueryClientProvider',
      importKind: 'named',
      source: 'framework-detection',
      propsExpression: 'client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}',
    });
  }

  if (component.usesRedux) {
    providers.push({
      providerName: 'Provider',
      importModulePath: 'react-redux',
      importName: 'Provider',
      importKind: 'named',
      source: 'framework-detection',
      propsExpression: 'store={{ getState: () => ({}), subscribe: () => () => undefined, dispatch: () => undefined }}',
    });
  }

  for (const ctx of component.contexts) {
    if (ctx.importPath || ctx.hookImportPath) {
      providers.push({
        providerName: `${ctx.contextName}.Provider`,
        importModulePath: ctx.importPath ?? ctx.hookImportPath ?? '',
        importName: ctx.contextName,
        importKind: 'named',
        source: 'context-usage',
      });
    }
  }

  return providers;
}

function deriveServiceDependencies(component: ComponentInfo): ServiceDependency[] {
  return component.serviceImports.map((importPath) => ({
    modulePath: importPath,
    importedNames: [],
    needsMock: true,
  }));
}

function derivePropsModel(component: ComponentInfo): PropsModel {
  return {
    required: component.props.filter((p) => p.isRequired).map((p) => ({
      name: p.name,
      type: p.type,
      isCallback: p.isCallback,
      isBoolean: p.isBoolean,
    })),
    optional: component.props.filter((p) => !p.isRequired).map((p) => ({
      name: p.name,
      type: p.type,
      isCallback: p.isCallback,
      isBoolean: p.isBoolean,
    })),
  };
}

function deriveImportedSymbols(component: ComponentInfo): ImportedSymbol[] {
  const symbols: ImportedSymbol[] = [];

  for (const hook of component.hooks) {
    if (hook.importSource) {
      symbols.push({
        modulePath: hook.importSource,
        symbolName: hook.name,
        importKind: 'named',
        isResolvable: true,
      });
    }
  }

  return symbols;
}

function deriveStateRiskFlags(component: ComponentInfo): string[] {
  const flags: string[] = [];
  if (component.usesUseState) flags.push('uses-state');
  if (component.usesUseEffect) flags.push('uses-effect');
  if (component.hasAsyncEffect) flags.push('async-effect');
  return flags;
}

function deriveAsyncRiskFlags(component: ComponentInfo): string[] {
  const flags: string[] = [];
  if (component.hasAsyncEffect) flags.push('async-effect');
  if (component.usesReactQuery) flags.push('react-query');
  if (component.serviceImports.length > 0) flags.push('service-calls');
  return flags;
}
