import { ComponentInfo, PropInfo } from '../analyzer';

export function buildDefaultProps(component: ComponentInfo): string {
    const requiredProps = component.props.filter((p) => p.isRequired);
    if (requiredProps.length === 0) return 'const defaultProps = {};';

    const lines = requiredProps.map((prop) => {
        const value = mockValueForProp(prop);
        return `  ${prop.name}: ${value}`;
    });

    return `const defaultProps = {\n${lines.join(',\n')}\n};`;
}

export function buildVariantProps(component: ComponentInfo): string[] {
    const variants: string[] = [];

    const booleanProps = component.props.filter((p) => p.isBoolean);
    for (const prop of booleanProps) {
        variants.push(`{ ...defaultProps, ${prop.name}: true }`);
        variants.push(`{ ...defaultProps, ${prop.name}: false }`);
    }

    const callbackProps = component.props.filter((p) => p.isCallback);
    if (callbackProps.length > 0) {
        const callbacks = callbackProps.map((p) => `${p.name}: jest.fn()`).join(', ');
        variants.push(`{ ...defaultProps, ${callbacks} }`);
    }

    return variants;
}

export function mockValueForProp(prop: PropInfo): string {
    const type = prop.type.toLowerCase();

    if (prop.name.toLowerCase() === 'pagination') {
        return '{ page: 1, totalPages: 1, total: 0, limit: 10, hasNext: false, hasPrev: false }';
    }

    if (prop.name === 'children' || type.includes('reactnode')) {
        return '<div />';
    }

    if (type.includes('string')) return '"test-value"';
    if (type.includes('number')) return '1';
    if (type.includes('boolean')) return 'true';
    if (type.includes('=>') || prop.isCallback) return 'jest.fn()';
    if (type.includes('[]')) return '[]';
    if (type.includes('object')) return '{}';

    if (/^on[A-Z]/.test(prop.name)) return 'jest.fn()';
    if (/^(is|has|show|can|should)[A-Z_]/.test(prop.name)) return 'true';
    if (/id$/i.test(prop.name)) return '"test-id"';

    return 'undefined';
}
