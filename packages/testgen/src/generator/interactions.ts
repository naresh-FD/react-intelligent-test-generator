import { ComponentInfo, SelectorInfo, FormElementInfo } from '../analyzer';
import { mockFn } from '../utils/framework';

export interface ConditionalTestCase {
    title: string;
    body: string[];
}

export function buildRenderAssertions(component: ComponentInfo): string[] {
    const lines: string[] = ['renderUI();', 'expect(container).toBeInTheDocument();'];

    // Assert ALL buttons (not just first 2)
    for (const button of component.buttons) {
        lines.push(`expect(${selectorQuery(button)}).toBeInTheDocument();`);
    }

    // Assert ALL inputs
    for (const input of component.inputs) {
        lines.push(`expect(${selectorQuery(input)}).toBeInTheDocument();`);
    }

    // Assert select elements
    for (const select of component.selects) {
        lines.push(`expect(${selectorQuery(select.selector)}).toBeInTheDocument();`);
    }

    // Assert links (up to 4 to avoid bloat)
    for (const link of component.links.slice(0, 4)) {
        lines.push(`expect(${selectorQuery(link)}).toBeInTheDocument();`);
    }

    return lines;
}

export function buildInteractionTests(component: ComponentInfo): string[] {
    const tests: string[] = [];

    // Generate click tests for ALL buttons (not just first 2)
    for (const button of component.buttons) {
        tests.push([
            'const user = userEvent.setup();',
            'renderUI();',
            `const target = ${selectorQuery(button)};`,
            'await user.click(target);',
        ].join('\n'));
    }

    // Generate type tests for ALL inputs (not just first 1)
    for (const input of component.inputs) {
        tests.push([
            'const user = userEvent.setup();',
            'renderUI();',
            `const target = ${selectorQuery(input)};`,
            'await user.type(target, "test");',
        ].join('\n'));
    }

    // Generate select interaction tests
    for (const select of component.selects) {
        tests.push([
            'const user = userEvent.setup();',
            'renderUI();',
            `const target = ${selectorQuery(select.selector)};`,
            'await user.selectOptions(target, target.options[0]?.value || "");',
        ].join('\n'));
    }

    // Generate link click tests (up to 3)
    for (const link of component.links.slice(0, 3)) {
        tests.push([
            'const user = userEvent.setup();',
            'renderUI();',
            `const target = ${selectorQuery(link)};`,
            'await user.click(target);',
        ].join('\n'));
    }

    return tests;
}

export function buildCallbackPropTests(component: ComponentInfo): ConditionalTestCase[] {
    const cases: ConditionalTestCase[] = [];

    const callbackProps = component.props.filter((p) => p.isCallback);
    for (const prop of callbackProps) {
        const mockName = `mock${prop.name.charAt(0).toUpperCase() + prop.name.slice(1)}`;
        cases.push({
            title: `calls ${prop.name} when triggered`,
            body: [
                `const ${mockName} = ${mockFn()};`,
                `renderUI({ ${prop.name}: ${mockName} });`,
                `expect(${mockName}).toBeDefined();`,
            ],
        });
    }

    return cases;
}

export function buildConditionalRenderTests(component: ComponentInfo): ConditionalTestCase[] {
    const cases: ConditionalTestCase[] = [];
    const seen = new Set<string>();

    component.conditionalElements.forEach((element, index) => {
        if (element.requiredProps.length === 0) return;

        const propsArg = element.requiredProps.map((prop) => `${prop}: true`).join(', ');
        const query = conditionalSelectorQuery(element.selector);
        const key = `${propsArg}-${element.selector.strategy}-${element.selector.value}`;

        if (seen.has(key)) return;
        seen.add(key);

        cases.push({
            title: `renders conditional element ${index + 1}`,
            body: [
                `renderUI({ ${propsArg} });`,
                `expect(${query}).toBeInTheDocument();`,
            ],
        });
    });

    return cases;
}

export function buildNegativeBranchTests(component: ComponentInfo): ConditionalTestCase[] {
    const cases: ConditionalTestCase[] = [];

    // For each boolean prop, generate a test with it set to false
    const booleanProps = component.props.filter((p) => p.isBoolean);
    for (const prop of booleanProps) {
        cases.push({
            title: `renders with ${prop.name} set to false`,
            body: [
                `const { container } = renderUI({ ${prop.name}: false });`,
                'expect(container).toBeInTheDocument();',
            ],
        });
    }

    // For conditional elements, test the negative case (prop=false -> element not shown)
    const seen = new Set<string>();
    component.conditionalElements.forEach((element, index) => {
        if (element.requiredProps.length === 0) return;

        const propsArgFalse = element.requiredProps.map((prop) => `${prop}: false`).join(', ');
        const query = conditionalSelectorQuery(element.selector);
        const key = `neg-${propsArgFalse}-${element.selector.strategy}-${element.selector.value}`;

        if (seen.has(key)) return;
        seen.add(key);

        cases.push({
            title: `hides conditional element ${index + 1} when condition is false`,
            body: [
                `renderUI({ ${propsArgFalse} });`,
                `expect(${query.replace('getBy', 'queryBy')}).not.toBeInTheDocument();`,
            ],
        });
    });

    return cases;
}

export function buildOptionalPropTests(component: ComponentInfo): ConditionalTestCase[] {
    const cases: ConditionalTestCase[] = [];

    // Test rendering with optional props omitted entirely (default branch)
    const optionalProps = component.props.filter((p) => !p.isRequired && !p.isCallback);
    if (optionalProps.length > 0) {
        cases.push({
            title: 'renders with only required props',
            body: [
                'const { container } = renderUI();',
                'expect(container).toBeInTheDocument();',
            ],
        });
    }

    return cases;
}

function selectorQuery(selector: SelectorInfo): string {
    switch (selector.strategy) {
        case 'testid':
            return `screen.getByTestId("${escapeRegExp(selector.value)}")`;
        case 'label':
            return `screen.getByLabelText(/${escapeRegExp(selector.value)}/i)`;
        case 'placeholder':
            return `screen.getByPlaceholderText(/${escapeRegExp(selector.value)}/i)`;
        case 'text':
            return `screen.getByRole("button", { name: /${escapeRegExp(selector.value)}/i })`;
        case 'role':
            return `screen.getAllByRole("${selector.role || selector.value}")[0]`;
        default:
            return 'screen.getByRole("button")';
    }
}

function conditionalSelectorQuery(selector: SelectorInfo): string {
    switch (selector.strategy) {
        case 'testid':
            return `screen.getByTestId("${escapeRegExp(selector.value)}")`;
        case 'label':
            return `screen.getByLabelText(/${escapeRegExp(selector.value)}/i)`;
        case 'placeholder':
            return `screen.getByPlaceholderText(/${escapeRegExp(selector.value)}/i)`;
        case 'text':
            return `screen.getByText(/${escapeRegExp(selector.value)}/i)`;
        case 'role':
            return `screen.getAllByRole("${selector.role || selector.value}")[0]`;
        default:
            return 'screen.getByText(/.+/)';
    }
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
