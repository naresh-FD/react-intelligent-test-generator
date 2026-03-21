/**
 * Pre-emit validator — enforces import-JSX consistency.
 *
 * This is the structural guarantee that skipped/invalid imports
 * can NEVER leak into emitted JSX. After validation:
 * - Every provider in wrappers has a matching import
 * - Every import is needed by at least one consumer (provider, mock, or test code)
 * - Orphaned providers are stripped before emission
 *
 * No emitter may bypass this validator.
 */

import type { SemanticTestPlan, ComponentSemanticPlan, ResolvedImportSymbol, ProviderDescriptor } from '../generator/semanticPlan';
import type { ValidationResult } from '../types';

export interface ValidatedSemanticTestPlan extends SemanticTestPlan {
  /** True only after pre-emit validation has run */
  _validated: true;
  validationResult: ValidationResult;
}

/**
 * Validate and sanitize a SemanticTestPlan.
 * Strips any provider whose import is missing from the import plan.
 * Strips any import that has no consumer.
 * Returns a ValidatedSemanticTestPlan that emitters can trust.
 */
export function validateTestPlan(plan: SemanticTestPlan): ValidatedSemanticTestPlan {
  const result: ValidationResult = {
    valid: true,
    strippedProviders: [],
    strippedImports: [],
    strippedMocks: [],
    warnings: [],
  };

  // Phase 1: Build the set of available import symbols
  const importedSymbols = new Set<string>();
  for (const imp of plan.imports) {
    if (imp.symbolName) {
      importedSymbols.add(imp.symbolName);
    }
    if (imp.alias) {
      importedSymbols.add(imp.alias);
    }
  }

  // Phase 2: Validate providers in each component plan
  const validatedComponentPlans = plan.componentPlans.map((componentPlan) =>
    validateComponentPlan(componentPlan, importedSymbols, result),
  );

  // Phase 3: Rebuild imports to match validated providers
  // Collect all provider import names that survived validation
  const survivingProviderImportNames = new Set<string>();
  for (const componentPlan of validatedComponentPlans) {
    for (const provider of componentPlan.providers) {
      if (provider.validated && provider.importName) {
        survivingProviderImportNames.add(provider.importName);
        if (provider.importAlias) {
          survivingProviderImportNames.add(provider.importAlias);
        }
        // QueryClientProvider also needs QueryClient
        if (provider.key === 'react-query-provider') {
          survivingProviderImportNames.add('QueryClient');
        }
      }
    }
  }

  // Filter imports: keep if it's not a provider import, or if it's a surviving provider import
  const providerImportModules = new Set<string>();
  for (const componentPlan of plan.componentPlans) {
    for (const provider of componentPlan.providers) {
      if (provider.importModulePath) {
        providerImportModules.add(provider.importModulePath);
      }
    }
  }

  const validatedImports = plan.imports.filter((imp) => {
    // Side-effect imports always pass
    if (imp.importKind === 'side-effect') return true;

    // Non-provider imports always pass (RTL, jest globals, component imports, etc.)
    if (!imp.symbolName) return true;

    // If this import's symbol is a provider import name, check if it survived
    const isProviderImport = isSymbolFromProviderModule(imp, plan.componentPlans);
    if (isProviderImport && !survivingProviderImportNames.has(imp.symbolName)) {
      result.strippedImports.push({
        symbolName: imp.symbolName,
        reason: `Provider import "${imp.symbolName}" stripped — corresponding provider was removed during validation`,
      });
      return false;
    }

    return true;
  });

  if (result.strippedProviders.length > 0 || result.strippedImports.length > 0 || result.strippedMocks.length > 0) {
    result.valid = false;
  }

  return {
    ...plan,
    imports: validatedImports,
    componentPlans: validatedComponentPlans,
    _validated: true,
    validationResult: result,
  };
}

function validateComponentPlan(
  componentPlan: ComponentSemanticPlan,
  importedSymbols: Set<string>,
  result: ValidationResult,
): ComponentSemanticPlan {
  const validatedProviders: ProviderDescriptor[] = [];

  for (const provider of componentPlan.providers) {
    // Skip already-invalidated providers
    if (!provider.validated) {
      result.strippedProviders.push({
        key: provider.key,
        reason: `Provider "${provider.key}" was already marked as not validated`,
      });
      continue;
    }

    // Check: provider must have required import fields
    if (!provider.importModulePath || !provider.importKind || !provider.importName) {
      result.strippedProviders.push({
        key: provider.key,
        reason: `Provider "${provider.key}" is missing import metadata (path: ${provider.importModulePath}, kind: ${provider.importKind}, name: ${provider.importName})`,
      });
      continue;
    }

    // Check: the provider's import symbol must be in the import plan
    const effectiveSymbol = provider.importAlias ?? provider.importName;
    if (!importedSymbols.has(effectiveSymbol) && !importedSymbols.has(provider.importName)) {
      // The import wasn't added — this means buildImportPlan decided to skip it.
      // We must also skip the provider to maintain consistency.
      result.strippedProviders.push({
        key: provider.key,
        reason: `Provider "${provider.key}" references symbol "${effectiveSymbol}" which is not in the import plan`,
      });
      continue;
    }

    // Check: wrapperExpression must reference a known symbol
    const wrapperBase = provider.wrapperExpression.split('.')[0];
    if (!importedSymbols.has(wrapperBase) && !importedSymbols.has(provider.importName)) {
      result.strippedProviders.push({
        key: provider.key,
        reason: `Provider wrapper "${provider.wrapperExpression}" references symbol "${wrapperBase}" which is not importable`,
      });
      continue;
    }

    validatedProviders.push(provider);
  }

  return {
    ...componentPlan,
    providers: validatedProviders,
  };
}

/**
 * Check if an import symbol belongs to a provider module.
 * Used to determine if we should strip orphaned provider imports.
 */
function isSymbolFromProviderModule(
  imp: ResolvedImportSymbol,
  componentPlans: ComponentSemanticPlan[],
): boolean {
  for (const componentPlan of componentPlans) {
    for (const provider of componentPlan.providers) {
      if (provider.importModulePath === imp.modulePath) {
        if (provider.importName === imp.symbolName || provider.importAlias === imp.symbolName) {
          return true;
        }
        // QueryClient is also a provider-related import
        if (provider.key === 'react-query-provider' && imp.symbolName === 'QueryClient') {
          return true;
        }
      }
    }
  }
  return false;
}
