import { ComponentInfo, PropInfo } from '../analyzer';
import { mockFn } from '../utils/framework';

/**
 * Quote prop names that are not valid JS identifiers (e.g. aria-*, data-*)
 */
function safePropKey(name: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) ? name : `"${name}"`;
}

/**
 * Filter out HTML-inherited attributes (aria-*, data-*, etc.) that are not
 * interesting for component-specific coverage testing.
 */
function isComponentProp(prop: PropInfo): boolean {
  return !prop.name.includes('-');
}

export function buildDefaultProps(component: ComponentInfo): string {
  const requiredProps = component.props.filter((p) => p.isRequired && isComponentProp(p));
  if (requiredProps.length === 0) return 'const defaultProps = {};';

  const lines = requiredProps.map((prop) => {
    let value = mockValueForProp(prop);

    // Required props must never be undefined - fall back to appropriate defaults
    // for common types so components do not crash on startup with a missing required prop.
    if (value === 'undefined') {
      if (prop.isCallback) {
        value = mockFn();
      } else if (
        prop.type.toLowerCase().includes('[]') ||
        prop.type.toLowerCase().includes('array')
      ) {
        value = '[]';
      } else if (prop.type.toLowerCase().includes('string')) {
        value = '"test-value"';
      } else if (prop.type.toLowerCase().includes('number')) {
        value = '1';
      } else if (prop.type.toLowerCase().includes('boolean')) {
        value = 'true';
      } else {
        value = '{}';
      }
    }

    return `  ${safePropKey(prop.name)}: ${value}`;
  });

  return `const defaultProps = {\n${lines.join(',\n')}\n};`;
}

export interface VariantInfo {
  label: string;
  propsExpr: string;
}

export function buildVariantProps(component: ComponentInfo): VariantInfo[] {
  const variants: VariantInfo[] = [];

  const booleanProps = component.props.filter((p) => p.isBoolean && isComponentProp(p));
  for (const prop of booleanProps) {
    variants.push({
      label: `${prop.name} true`,
      propsExpr: `{ ...defaultProps, ${safePropKey(prop.name)}: true }`,
    });
    variants.push({
      label: `${prop.name} false`,
      propsExpr: `{ ...defaultProps, ${safePropKey(prop.name)}: false }`,
    });
  }

  const callbackProps = component.props.filter((p) => p.isCallback && isComponentProp(p));
  if (callbackProps.length > 0) {
    const callbacks = callbackProps.map((p) => `${safePropKey(p.name)}: ${mockFn()}`).join(', ');
    variants.push({ label: 'with callbacks', propsExpr: `{ ...defaultProps, ${callbacks} }` });
  }

  // Generate variants for string/enum union props (e.g. variant: "primary" | "secondary")
  const enumProps = component.props.filter((p) => isEnumLikeType(p.type) && isComponentProp(p));
  for (const prop of enumProps) {
    const values = extractEnumValues(prop.type);
    for (const val of values.slice(0, 4)) {
      // Strip quotes from label to avoid breaking test title strings
      const cleanVal = val.replace(/^["']|["']$/g, '');
      variants.push({
        label: `${prop.name} ${cleanVal}`,
        propsExpr: `{ ...defaultProps, ${safePropKey(prop.name)}: ${val} }`,
      });
    }
  }

  // Generate variants for optional props (include them to cover the "provided" branch)
  const optionalNonCallback = component.props.filter(
    (p) =>
      !p.isRequired &&
      !p.isCallback &&
      !p.isBoolean &&
      !isEnumLikeType(p.type) &&
      isComponentProp(p)
  );
  for (const prop of optionalNonCallback.slice(0, 4)) {
    const value = mockValueForProp(prop);
    if (value !== 'undefined') {
      variants.push({
        label: `with ${prop.name}`,
        propsExpr: `{ ...defaultProps, ${safePropKey(prop.name)}: ${value} }`,
      });
    }
  }

  // Loading state variant
  const loadingProps = component.props.filter(
    (p) =>
      /^(is)?(loading|pending|fetching|submitting|processing|busy)/i.test(p.name) &&
      (p.isBoolean || p.type?.toLowerCase().includes('boolean'))
  );
  if (loadingProps.length > 0) {
    variants.push({
      label: 'loading state',
      propsExpr: `{ ...defaultProps, ${loadingProps.map((p) => `${safePropKey(p.name)}: true`).join(', ')} }`,
    });
  }

  // Error state variant
  const errorBoolProps = component.props.filter(
    (p) =>
      /^(is)?(error|failed|invalid)/i.test(p.name) &&
      (p.isBoolean || p.type?.toLowerCase().includes('boolean'))
  );
  const errorStringProps = component.props.filter(
    (p) => /^(error|errorMessage|errorText|failureReason|errMsg)/i.test(p.name) && !p.isBoolean
  );
  if (errorBoolProps.length > 0 || errorStringProps.length > 0) {
    const overrides = [
      ...errorBoolProps.map((p) => `${safePropKey(p.name)}: true`),
      ...errorStringProps.map((p) => `${safePropKey(p.name)}: "Test error"`),
    ];
    variants.push({
      label: 'error state',
      propsExpr: `{ ...defaultProps, ${overrides.join(', ')} }`,
    });
  }

  // Empty data variant (arrays set to [])
  // Exclude callbacks and function types - a type like `(rules: string[]) => void` contains
  // "[]" but is a function, not an array prop.
  const arrayProps = component.props.filter(
    (p) =>
      !p.isCallback &&
      !p.type?.includes('=>') &&
      (p.type?.includes('[]') ||
        p.type?.includes('Array') ||
        /^(items|data|list|rows|options|results|records|entries|expenses|categories|users|products|orders|notifications|messages|transactions|comments|posts|tasks|events|tabs|columns|dropdowndata|itemsperpageoptions|pageoptions)/i.test(
          p.name
        ))
  );
  if (arrayProps.length > 0 && !arrayProps.every((p) => p.isRequired)) {
    variants.push({
      label: 'empty data',
      propsExpr: `{ ...defaultProps, ${arrayProps.map((p) => `${safePropKey(p.name)}: []`).join(', ')} }`,
    });
  }

  // Disabled state variant
  const disabledProps = component.props.filter(
    (p) =>
      /^(is)?(disabled|readOnly|locked|readonly)/i.test(p.name) &&
      (p.isBoolean || p.type?.toLowerCase().includes('boolean'))
  );
  if (disabledProps.length > 0) {
    variants.push({
      label: 'disabled state',
      propsExpr: `{ ...defaultProps, ${disabledProps.map((p) => `${safePropKey(p.name)}: true`).join(', ')} }`,
    });
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

  // Pagination-like props (generic shape) - ensure totalPages > 1 so component renders
  if (/pagination/i.test(name)) {
    return '{ page: 1, totalPages: 5, total: 50, limit: 10, hasNext: true, hasPrev: false }';
  }

  if (name === 'children' || type.includes('reactnode') || type.includes('react.reactnode')) {
    return '<div />';
  }

  if (name === 'className' || name === 'class') return '"test-class"';
  if (name === 'style') return '{}';
  if (name === 'ref') return '{ current: null }';
  if (name === 'key') return '"test-key"';

  // Common name patterns - check before generic type patterns
  if (
    /^(on|handle|set|update|change|toggle|add|remove|delete|clear)[A-Z]/.test(name) ||
    /^handle[A-Z_]/.test(name)
  ) {
    return mockFn();
  }
  if (
    /^(is|has|show|can|should|disabled|loading|open|visible|active|checked|selected|expanded|hidden)[A-Z_]?/.test(
      name
    ) &&
    (type === 'boolean' || !type.includes('=>'))
  ) {
    return 'true';
  }

  // Callback / function types
  if (type.includes('=>') || prop.isCallback) return mockFn();

  // Enum/union string literal types - use first value
  if (isEnumLikeType(prop.type)) {
    const values = extractEnumValues(prop.type);
    return values.length > 0 ? values[0] : '"default"';
  }

  // Handle generic union types without quotes (e.g. type1 | type2)
  if (prop.type.includes('|') && !prop.type.includes('=>')) {
    // For string literal unions like 'value1' | 'value2'
    const quotedMatch = prop.type.match(/'([^']+)'/);
    if (quotedMatch) return `'${quotedMatch[1]}'`;

    const doubleQuotedMatch = prop.type.match(/"([^"]+)"/);
    if (doubleQuotedMatch) return `"${doubleQuotedMatch[1]}"`;

    // For non-literal unions, return first option
    const parts = prop.type.split('|').map((p) => p.trim());
    if (parts.length > 0 && parts[0] !== 'undefined') {
      return parts[0] === 'null' ? 'null' : `"${parts[0]}"`;
    }
  }

  // Date types - only match actual Date type, not interfaces containing "date"
  // in their name.
  const trimmedType = prop.type.trim();
  if (trimmedType === 'Date' || type === 'date') return 'new Date("2024-01-01")';

  // Array props - match based on name patterns (items, data, rows, options,
  // tabs, etc.) or explicit array types in the type string.
  const isArrayByName =
    /^(items|data|list|rows|options|results|records|entries|tabs|columns|dropdowndata|itemsperpageoptions|pageoptions)$/i.test(
      name
    );
  const isArrayByType = type.includes('[]') || /array</.test(type) || /readonly\s*\[\]/.test(type);

  if (isArrayByName || isArrayByType) {
    // If it is an array of objects, provide at least one item.
    if (type.includes('{') || type.includes('interface') || type.includes('type')) {
      return mockArrayOfObjects(prop);
    }

    // For arrays of primitives (number[], string[]), provide sample data.
    if (type.includes('number') || /page.*options/i.test(name)) {
      return '[10, 25, 50, 100]';
    }
    if (type.includes('string')) {
      return '["option1", "option2", "option3"]';
    }

    // Generic array fallback with at least one item.
    return mockArrayOfObjects(prop);
  }

  // Basic types
  if (type.includes('string')) return contextualStringMock(name);
  if (type.includes('number')) return contextualNumberMock(name);
  if (type.includes('boolean')) return 'true';
  if (type.includes('[]')) return '[]';

  // Complex object types
  if (type.includes('{') || type.includes('object') || type.includes('record')) return '{}';

  // Name-based fallbacks for complex domain objects
  if (/^expense$/i.test(name))
    return '{ id: "1", description: "Test Expense", categoryId: "cat-1", amount: 100, type: "expense", date: "2024-01-01", isRecurring: false }';
  if (/^expenses$/i.test(name)) return '[]';
  if (/^category$/i.test(name))
    return '{ id: "cat-1", name: "Food", color: "#000", type: "expense", icon: "utensils" }';
  if (/^categories$/i.test(name)) return '[]';
  if (/^budget$/i.test(name))
    return '{ id: "1", categoryId: "cat-1", amount: 1000, spent: 0, period: "monthly" }';
  if (/^budgets$/i.test(name)) return '[]';
  if (/^user$/i.test(name)) return '{ id: "1", email: "test@example.com", name: "Test User" }';
  if (/^transaction$/i.test(name))
    return '{ id: "1", description: "Test", amount: 100, type: "expense", date: "2024-01-01" }';
  if (/^transactions$/i.test(name)) return '[]';

  // Name-based fallbacks
  if (/id$/i.test(name)) return '"test-id"';
  if (/name$/i.test(name)) return '"Test Name"';
  if (/email$/i.test(name)) return '"test@example.com"';
  if (/url$/i.test(name) || /link$/i.test(name) || /href$/i.test(name))
    return '"https://example.com"';
  if (/title$/i.test(name)) return '"Test Title"';
  if (/description$/i.test(name) || /message$/i.test(name) || /text$/i.test(name))
    return '"Test description"';
  if (/label$/i.test(name)) return '"Test Label"';
  if (/color$/i.test(name)) return '"#000000"';
  if (/size$/i.test(name)) return '"md"';
  if (/type$/i.test(name) || /variant$/i.test(name) || /kind$/i.test(name)) return '"default"';
  if (/icon$/i.test(name)) return '"test-icon"';
  if (/image$/i.test(name) || /src$/i.test(name) || /avatar$/i.test(name))
    return '"https://example.com/image.png"';
  if (/count$/i.test(name) || /total$/i.test(name) || /index$/i.test(name)) return '0';
  if (/amount$/i.test(name) || /price$/i.test(name) || /value$/i.test(name)) return '100';
  if (/data$/i.test(name) || /items$/i.test(name) || /list$/i.test(name) || /rows$/i.test(name))
    return '[]';
  if (/options$/i.test(name)) return '[{ label: "Option 1", value: "option1" }]';
  if (/^(itemsperpageoptions|pageoptions)$/i.test(name)) return '[10, 25, 50, 100]';
  if (/columns$/i.test(name)) return '[]';

  // For required props, never return undefined - provide a safe default.
  if (prop.isRequired) {
    const lowerType = prop.type.toLowerCase();
    if (lowerType.includes('string')) return '"test-value"';
    if (lowerType.includes('number')) return '1';
    if (lowerType.includes('boolean')) return 'true';
    if (lowerType.includes('array') || lowerType.includes('[]')) return '[]';
    // For objects and other complex types, return empty object.
    return '{}';
  }

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
  // Try to generate a minimal generic object matching common array patterns.
  const name = prop.name.toLowerCase();

  // Tab options (ActivityTabs use case).
  if (name.includes('tab') && !name.includes('table')) {
    return '[{ label: "Tab 1", value: "tab1" }, { label: "Tab 2", value: "tab2" }]';
  }

  // Pagination options (itemsPerPageOptions use case).
  if (
    name.includes('pageoptions') ||
    name.includes('perpageoptions') ||
    name.includes('itemsperpageoptions')
  ) {
    return '[10, 25, 50, 100]';
  }

  // Dropdown data (DescriptionDropdown use case).
  if (name.includes('dropdown') || name.includes('select')) {
    return '[{ text: "Option 1", value: "option1" }, { text: "Option 2", value: "option2" }]';
  }

  if (name.includes('column')) {
    return '[{ key: "col1", header: "Column 1" }, { key: "col2", header: "Column 2" }]';
  }

  if (name.includes('option')) {
    return '[{ label: "Option 1", value: "option1" }, { label: "Option 2", value: "option2" }]';
  }

  if (name.includes('item') || name.includes('data') || name.includes('row')) {
    return '[{ id: "1", name: "Test Item" }]';
  }

  // Generic fallback for any array of objects - at least one item.
  return '[{ id: "1", label: "Item 1", value: "item1" }]';
}
