import path from 'path';
import { relativeImport } from '../utils/path.mjs';
import { GENERATED_HEADER, RENDER_WITH_PROVIDERS_PATH, SRC_DIR } from '../config.mjs';

export class SmartTestGenerator {
  constructor(components, sourceFilePath, testFilePath) {
    this.components = components;
    this.sourceFilePath = sourceFilePath;
    this.testFilePath = testFilePath;
    this.moduleName = path.basename(sourceFilePath, path.extname(sourceFilePath));
    this.moduleImport = relativeImport(testFilePath, sourceFilePath);
  }

  generate() {
    const renderWithProvidersImport = relativeImport(
      this.testFilePath,
      path.join(SRC_DIR, 'test-utils', 'renderWithProviders.tsx')
    );

    const imports = this.generateImports(renderWithProvidersImport);
    const mocks = this.generateMocks();
    const tests = this.components.map((c) => this.generateComponentTests(c)).join('\n\n');

    return `${GENERATED_HEADER}
${imports}

${mocks}
${tests}
`;
  }

  generateImports(renderWithProvidersImport) {
    const defaultExports = this.components.filter((c) => c.isDefault);
    const namedExports = this.components.filter((c) => !c.isDefault && c.isExported);

    let componentImport = '';
    if (defaultExports.length > 0 && namedExports.length > 0) {
      componentImport = `import ${defaultExports[0].name}, { ${namedExports.map((c) => c.name).join(', ')} } from "${this.moduleImport}";`;
    } else if (defaultExports.length > 0) {
      componentImport = `import ${defaultExports[0].name} from "${this.moduleImport}";`;
    } else if (namedExports.length > 0) {
      componentImport = `import { ${namedExports.map((c) => c.name).join(', ')} } from "${this.moduleImport}";`;
    }

    const needsWaitFor = this.components.some((c) => c.effects.length > 0 || c.apiCalls.length > 0);
    const testingImports = ['screen'];
    if (needsWaitFor) testingImports.push('waitFor');

    const imports = [
      `import * as React from "react";`,
      `import { ${testingImports.join(', ')} } from "@testing-library/react";`,
    ];

    if (this.hasCallbacks()) {
      imports.push(`import userEvent from "@testing-library/user-event";`);
    }

    imports.push(`import { renderWithProviders } from "${renderWithProvidersImport}";`);

    if (componentImport) {
      imports.push(componentImport);
    }

    return imports.join('\n');
  }

  hasCallbacks() {
    return this.components.some(
      (c) => c.props.some((p) => p.isCallback) || c.buttons.length > 0 || c.inputs.length > 0
    );
  }

  generateMocks() {
    const mocks = [];

    for (const comp of this.components) {
      const callbackProps = comp.props.filter((p) => p.isCallback);

      if (callbackProps.length > 0) {
        for (const prop of callbackProps) {
          mocks.push(`const mock${this.capitalize(prop.name)} = jest.fn();`);
        }
      }
    }

    if (mocks.length > 0) {
      mocks.push('');
      mocks.push('beforeEach(() => {');
      mocks.push('  jest.clearAllMocks();');
      mocks.push('});');
    }

    return mocks.join('\n');
  }

  generateComponentTests(comp) {
    const lines = [];
    const propsType = this.generatePropsType(comp);

    lines.push(`describe("${comp.name}", () => {`);
    lines.push(`  type Props = React.ComponentProps<typeof ${comp.name}>;`);
    lines.push(`  const defaultProps: Partial<Props> = ${this.generateDefaultPropsObject(comp)};`);
    lines.push('');
    lines.push('  const renderUI = (props: Partial<Props> = {}) =>');
    lines.push(
      `    renderWithProviders(<${comp.name} {...(defaultProps as Props)} {...(props as Props)} />);`
    );
    lines.push('');

    // Rendering tests
    lines.push('  describe("Rendering", () => {');
    lines.push(`    it("should render without crashing", () => {`);
    lines.push(`      renderUI();`);
    lines.push(`    });`);
    lines.push('');
    lines.push(`    it("should render with default props", () => {`);
    lines.push(`      const { container } = renderUI();`);
    lines.push(`      expect(container.firstChild).toBeInTheDocument();`);
    lines.push(`    });`);

    if (comp.buttons.length > 0) {
      lines.push('');
      lines.push(`    it("should render buttons", () => {`);
      lines.push(`      renderUI();`);
      for (const btn of comp.buttons.slice(0, 2)) {
        const selector = this.getButtonSelector(btn);
        lines.push(`      expect(${selector}).toBeInTheDocument();`);
      }
      lines.push(`    });`);
    }

    if (comp.inputs.length > 0) {
      lines.push('');
      lines.push(`    it("should render inputs", () => {`);
      lines.push(`      renderUI();`);
      for (const input of comp.inputs.slice(0, 2)) {
        const selector = this.getInputSelector(input);
        lines.push(`      expect(${selector}).toBeInTheDocument();`);
      }
      lines.push(`    });`);
    }

    lines.push('  });');
    lines.push('');

    // User interaction tests
    if (comp.buttons.length > 0 || comp.inputs.length > 0) {
      lines.push('  describe("User Interactions", () => {');

      if (comp.buttons.length > 0) {
        lines.push(`    it("should handle button clicks", async () => {`);
        lines.push(`      const user = userEvent.setup();`);
        lines.push(`      renderUI();`);
        const btn = comp.buttons[0];
        const selector = this.getButtonSelector(btn);
        lines.push(`      const button = ${selector};`);
        lines.push(`      await user.click(button);`);
        lines.push(`    });`);
        lines.push('');
      }

      if (comp.inputs.length > 0) {
        lines.push(`    it("should handle input changes", async () => {`);
        lines.push(`      const user = userEvent.setup();`);
        lines.push(`      renderUI();`);
        const input = comp.inputs[0];
        const selector = this.getInputSelector(input);
        lines.push(`      const input = ${selector};`);
        lines.push(`      await user.type(input, "test value");`);
        lines.push(`      expect(input).toHaveValue("test value");`);
        lines.push(`    });`);
      }

      lines.push('  });');
      lines.push('');
    }

    // Props tests
    if (comp.props.length > 0) {
      lines.push('  describe("Props", () => {');
      lines.push(`    it("should accept and render custom props", () => {`);
      const customProps = comp.props.slice(0, 2);
      const customPropsObj = {};
      for (const prop of customProps) {
        customPropsObj[prop.name] = this.getDefaultValueForType(prop.type);
      }
      lines.push(`      renderUI(${JSON.stringify(customPropsObj)});`);
      lines.push(`    });`);
      lines.push('  });');
      lines.push('');
    }

    // Snapshot test
    lines.push('  describe("Snapshot", () => {');
    lines.push(`    it("should match snapshot", () => {`);
    lines.push(`      const { container } = renderUI();`);
    lines.push(`      expect(container.firstChild).toMatchSnapshot();`);
    lines.push(`    });`);
    lines.push('  });');

    lines.push('});');

    return lines.join('\n');
  }

  generatePropsType(comp) {
    if (comp.props.length === 0) return '{}';

    const propLines = comp.props.map((p) => {
      const required = p.isRequired ? '' : '?';
      return `  ${p.name}${required}: ${p.type || 'any'}`;
    });

    return `{\n${propLines.join(';\n')};\n}`;
  }

  generateDefaultPropsObject(comp) {
    const props = [];

    for (const prop of comp.props) {
      if (prop.isRequired && !prop.isCallback) {
        const value = this.getDefaultValueForType(prop.type);
        if (prop.type === 'string') {
          props.push(`  ${prop.name}: "${value}"`);
        } else {
          props.push(`  ${prop.name}: ${value}`);
        }
      } else if (prop.isCallback) {
        props.push(`  ${prop.name}: jest.fn()`);
      }
    }

    if (props.length === 0) {
      return '{}';
    }

    return `{\n${props.join(',\n')}\n  }`;
  }

  getButtonSelector(btn) {
    if (btn.selector && btn.selector !== 'button') {
      return `screen.getByRole("button", { name: /${btn.text || 'button'}/i })`;
    }
    return `screen.getByRole("button", { name: /${btn.text || 'button'}/i })`;
  }

  getInputSelector(input) {
    if (input.name) {
      return `screen.getByRole("textbox", { name: /${input.label || input.name}/i })`;
    }
    if (input.placeholder) {
      return `screen.getByPlaceholderText(/${input.placeholder}/i)`;
    }
    return `screen.getByRole("textbox")`;
  }

  getDefaultValueForType(type) {
    if (!type) return 'undefined';

    const typeStr = String(type).toLowerCase();

    if (typeStr.includes('string')) return 'test-value';
    if (typeStr.includes('number')) return '42';
    if (typeStr.includes('boolean')) return 'true';
    if (typeStr.includes('[]')) return '[]';
    if (typeStr.includes('=>')) return 'jest.fn()';
    if (typeStr.includes('object')) return '{}';

    return 'undefined';
  }

  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
