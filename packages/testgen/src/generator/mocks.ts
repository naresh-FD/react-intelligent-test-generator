import { ComponentInfo, PropInfo } from '../analyzer';
import { mockFn } from '../utils/framework';

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
        const callbacks = callbackProps.map((p) => `${p.name}: ${mockFn()}`).join(', ');
        variants.push(`{ ...defaultProps, ${callbacks} }`);
    }

    // Generate variants for string/enum union props (e.g. variant: "primary" | "secondary")
    const enumProps = component.props.filter((p) => isEnumLikeType(p.type));
    for (const prop of enumProps) {
        const values = extractEnumValues(prop.type);
        for (const val of values.slice(0, 4)) {
            variants.push(`{ ...defaultProps, ${prop.name}: ${val} }`);
        }
    }

    // Generate variants for optional props (include them to cover the "provided" branch)
    const optionalNonCallback = component.props.filter(
        (p) => !p.isRequired && !p.isCallback && !p.isBoolean && !isEnumLikeType(p.type)
    );
    for (const prop of optionalNonCallback.slice(0, 4)) {
        const value = mockValueForProp(prop);
        if (value !== 'undefined') {
            variants.push(`{ ...defaultProps, ${prop.name}: ${value} }`);
        }
    }

    return variants;
}

function isEnumLikeType(type: string): boolean {
    // Match union types like: "primary" | "secondary" | "danger"
    return /^"[^"]+"\s*\|/.test(type.trim()) || /\|\s*"[^"]+"/.test(type.trim());
}

function extractEnumValues(type: string): string[] {
    const matches = type.match(/"[^"]+"/g);
    return matches || [];
}

export function mockValueForProp(prop: PropInfo): string {
    const type = prop.type.toLowerCase();
    const name = prop.name;

    // Pagination-like props (generic shape)
    if (/pagination/i.test(name)) {
        return '{ page: 1, totalPages: 1 }';
    }

    if (name === 'children' || type.includes('reactnode') || type.includes('react.reactnode')) {
        return '<div />';
    }

    if (name === 'className' || name === 'class') return '"test-class"';
    if (name === 'style') return '{}';
    if (name === 'ref') return '{ current: null }';
    if (name === 'key') return '"test-key"';

    // Common name patterns - check before generic type patterns
    if (/^on[A-Z]/.test(name)) return mockFn();
    if (/^handle[A-Z]/.test(name)) return mockFn();
    if (/^(is|has|show|can|should|disabled|loading|open|visible|active|checked|selected|expanded|hidden)[A-Z_]?/.test(name) && (type === 'boolean' || !type.includes('=>'))) return 'true';

    // Callback / function types
    if (type.includes('=>') || prop.isCallback) return mockFn();

    // Enum/union string types - use first value
    if (isEnumLikeType(prop.type)) {
        const values = extractEnumValues(prop.type);
        return values.length > 0 ? values[0] : '"default"';
    }

    // Date types
    if (type.includes('date')) return 'new Date("2024-01-01")';

    // Array of objects
    if (type.includes('[]') && type.includes('{')) {
        return mockArrayOfObjects(prop);
    }

    // Basic types
    if (type.includes('string')) return contextualStringMock(name);
    if (type.includes('number')) return contextualNumberMock(name);
    if (type.includes('boolean')) return 'true';
    if (type.includes('[]')) return '[]';

    // Complex object types
    if (type.includes('{') || type.includes('object') || type.includes('record')) return '{}';

    // Name-based fallbacks
    if (/id$/i.test(name)) return '"test-id"';
    if (/name$/i.test(name)) return '"Test Name"';
    if (/email$/i.test(name)) return '"test@example.com"';
    if (/url$/i.test(name) || /link$/i.test(name) || /href$/i.test(name)) return '"https://example.com"';
    if (/title$/i.test(name)) return '"Test Title"';
    if (/description$/i.test(name) || /message$/i.test(name) || /text$/i.test(name)) return '"Test description"';
    if (/label$/i.test(name)) return '"Test Label"';
    if (/color$/i.test(name)) return '"#000000"';
    if (/size$/i.test(name)) return '"md"';
    if (/type$/i.test(name) || /variant$/i.test(name) || /kind$/i.test(name)) return '"default"';
    if (/icon$/i.test(name)) return '"test-icon"';
    if (/image$/i.test(name) || /src$/i.test(name) || /avatar$/i.test(name)) return '"https://example.com/image.png"';
    if (/count$/i.test(name) || /total$/i.test(name) || /index$/i.test(name)) return '0';
    if (/amount$/i.test(name) || /price$/i.test(name) || /value$/i.test(name)) return '100';
    if (/data$/i.test(name) || /items$/i.test(name) || /list$/i.test(name) || /rows$/i.test(name) || /options$/i.test(name)) return '[]';
    if (/columns$/i.test(name)) return '[]';

    return 'undefined';
}

function contextualStringMock(name: string): string {
    if (/title/i.test(name)) return '"Test Title"';
    if (/name/i.test(name)) return '"Test Name"';
    if (/email/i.test(name)) return '"test@example.com"';
    if (/description/i.test(name) || /message/i.test(name)) return '"Test description"';
    if (/label/i.test(name)) return '"Test Label"';
    if (/placeholder/i.test(name)) return '"Enter value..."';
    if (/url/i.test(name) || /link/i.test(name) || /href/i.test(name)) return '"https://example.com"';
    if (/path/i.test(name)) return '"/test-path"';
    if (/icon/i.test(name)) return '"test-icon"';
    if (/class/i.test(name)) return '"test-class"';
    return '"test-value"';
}

function contextualNumberMock(name: string): string {
    if (/page/i.test(name)) return '1';
    if (/count/i.test(name) || /total/i.test(name)) return '10';
    if (/index/i.test(name)) return '0';
    if (/amount/i.test(name) || /price/i.test(name)) return '100';
    if (/size/i.test(name) || /limit/i.test(name)) return '10';
    if (/width/i.test(name) || /height/i.test(name)) return '100';
    return '1';
}

function mockArrayOfObjects(prop: PropInfo): string {
    // Try to generate a minimal generic object matching common array patterns
    const name = prop.name.toLowerCase();
    if (name.includes('column')) {
        return '[{ key: "col1", header: "Column 1" }]';
    }
    if (name.includes('option')) {
        return '[{ label: "Option 1", value: "option1" }]';
    }
    if (name.includes('item') || name.includes('data') || name.includes('row')) {
        return '[{ id: "1", name: "Test Item" }]';
    }
    // Generic fallback for any array of objects
    return '[{ id: "1" }]';
}
