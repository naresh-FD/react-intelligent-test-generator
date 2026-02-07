import { ComponentInfo, SelectorInfo } from '../analyzer';

export interface ConditionalTestCase {
    title: string;
    body: string[];
}

export function buildRenderAssertions(component: ComponentInfo): string[] {
    const lines: string[] = ['renderUI();', 'expect(container).toBeInTheDocument();'];

    for (const button of component.buttons.slice(0, 2)) {
        lines.push(`expect(${selectorQuery(button)}).toBeInTheDocument();`);
    }

    for (const input of component.inputs.slice(0, 2)) {
        lines.push(`expect(${selectorQuery(input)}).toBeInTheDocument();`);
    }

    return lines;
}

export function buildInteractionTests(component: ComponentInfo): string[] {
    const tests: string[] = [];

    for (const button of component.buttons.slice(0, 2)) {
        tests.push([
            'const user = userEvent.setup();',
            'renderUI();',
            `const target = ${selectorQuery(button)};`,
            'await user.click(target);',
        ].join('\n'));
    }

    for (const input of component.inputs.slice(0, 1)) {
        tests.push([
            'const user = userEvent.setup();',
            'renderUI();',
            `const target = ${selectorQuery(input)};`,
            'await user.type(target, "test");',
        ].join('\n'));
    }

    return tests;
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
