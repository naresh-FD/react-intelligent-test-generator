/**
 * Backwards-compatible auto-mocking surface.
 *
 * The generator now routes all mocking through `mockRegistry.ts`, but this
 * module remains as the stable entrypoint for existing callers and tests.
 */
import { ComponentInfo } from '../analyzer';
import { emitMockPlans, MockRegistryOptions, planMockModules, buildFallbackHookMockReturnValue } from './mockRegistry';

export interface AutoMockOptions extends MockRegistryOptions {
  skipHookMocks?: string[];
}

export function buildAutoMocks(component: ComponentInfo, options: AutoMockOptions = {}): string[] {
  return emitMockPlans(planMockModules(component, options));
}

export function buildHookMockReturnValue(hookName: string): string {
  return buildFallbackHookMockReturnValue(hookName);
}
