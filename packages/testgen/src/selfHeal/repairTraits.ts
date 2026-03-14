import path from 'node:path';
import { ComponentInfo } from '../analyzer';
import { ComponentTraits } from './types';

export function buildRepairTraitsFromComponents(
  components: ComponentInfo[],
  sourceFilePath: string,
  testFilePath: string,
): ComponentTraits | undefined {
  if (components.length === 0) {
    return undefined;
  }

  const requiredProviders = new Map<string, NonNullable<ComponentTraits['requiredProviders']>[number]>();
  for (const component of components) {
    for (const context of component.contexts) {
      if (!context.providerName || !(context.providerImportPath || context.importPath)) {
        continue;
      }

      const importPath = rebaseImportPathForTest(
        context.providerImportPath ?? context.importPath!,
        sourceFilePath,
        testFilePath,
      );
      const key = `${context.providerName}:${importPath}`;
      if (!requiredProviders.has(key)) {
        requiredProviders.set(key, {
          importStatement: `import { ${context.providerName} } from "${importPath}";`,
          wrapperName: context.providerName,
        });
      }
    }
  }

  const usesReactQuery = components.some((component) => component.traits.usesReactQuery);
  const usesRedux = components.some((component) => component.traits.usesRedux);
  const usesRouter = components.some((component) => component.traits.usesRouter);
  const usesAsyncData = components.some((component) => component.traits.usesAsyncData);

  return {
    requiredProviders: [...requiredProviders.values()],
    usesRouter,
    usesAsyncData,
    usesReactQuery,
    usesRedux,
    queryClientImportStatement: usesReactQuery
      ? 'import { QueryClient, QueryClientProvider } from \'@tanstack/react-query\';'
      : undefined,
    queryClientIdentifier: usesReactQuery ? 'testQueryClient' : undefined,
    queryClientSetupStatement: usesReactQuery
      ? 'const testQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });'
      : undefined,
    reduxProviderImportStatement: usesRedux
      ? 'import { Provider } from \'react-redux\';\nimport { configureStore } from \'@reduxjs/toolkit\';'
      : undefined,
    reduxStoreIdentifier: usesRedux ? 'testStore' : undefined,
    reduxStoreFactorySnippet: usesRedux
      ? 'const testStore = configureStore({ reducer: (state = {}) => state });'
      : undefined,
  };
}

export function rebaseImportPathForTest(
  importPath: string,
  sourceFilePath: string,
  testFilePath: string,
): string {
  if (!importPath.startsWith('.')) {
    return importPath;
  }

  const sourceDir = path.dirname(sourceFilePath);
  const testDir = path.dirname(testFilePath);
  const absoluteTarget = path.resolve(sourceDir, importPath);
  let rebased = path.relative(testDir, absoluteTarget).split('\\').join('/');
  if (!rebased.startsWith('.')) {
    rebased = `./${rebased}`;
  }
  return rebased.replace(/\.(tsx?|jsx?)$/, '');
}
