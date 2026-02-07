import { ComponentInfo } from '../analyzer';
import { buildVariantProps } from './mocks';

export function buildVariantRenders(component: ComponentInfo): string[] {
    const variants = buildVariantProps(component);
    return variants.map((variant, index) => `renderUI(${variant});`);
}
