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

    // Only generate tests for exported components
    const exportedComponents = this.components.filter((c) => c.isExported || c.isDefault);

    const imports = this.generateImportsForComponents(
      exportedComponents,
      renderWithProvidersImport
    );
    const mocks = this.generateMocksForComponents(exportedComponents);
    const tests = exportedComponents.map((c) => this.generateComponentTests(c)).join('\n\n');

    return `${GENERATED_HEADER}
${imports}

${mocks}
${tests}
`;
  }

  generateImportsForComponents(components, renderWithProvidersImport) {
    const defaultExports = components.filter((c) => c.isDefault);
    const namedExports = components.filter((c) => !c.isDefault && c.isExported);

    let componentImport = '';
    if (defaultExports.length > 0 && namedExports.length > 0) {
      componentImport = `import ${defaultExports[0].name}, { ${namedExports.map((c) => c.name).join(', ')} } from "${this.moduleImport}";`;
    } else if (defaultExports.length > 0) {
      componentImport = `import ${defaultExports[0].name} from "${this.moduleImport}";`;
    } else if (namedExports.length > 0) {
      componentImport = `import { ${namedExports.map((c) => c.name).join(', ')} } from "${this.moduleImport}";`;
    }

    const needsScreen = components.some(
      (c) => c.buttons.length > 0 || c.inputs.length > 0 || c.elements.length > 0
    );
    const needsWaitFor = components.some((c) => c.effects.length > 0 || c.apiCalls.length > 0);

    const testingImports = [];
    if (needsScreen) testingImports.push('screen');
    if (needsWaitFor) testingImports.push('waitFor');

    const imports = [`import * as React from "react";`];

    if (testingImports.length > 0) {
      imports.push(`import { ${testingImports.join(', ')} } from "@testing-library/react";`);
    }

    if (this.hasCallbacksInComponents(components)) {
      imports.push(`import userEvent from "@testing-library/user-event";`);
    }

    imports.push(`import { renderWithProviders } from "${renderWithProvidersImport}";`);

    if (componentImport) {
      imports.push(componentImport);
    }

    return imports.join('\n');
  }

  hasCallbacksInComponents(components) {
    return components.some(
      (c) => c.props.some((p) => p.isCallback) || c.buttons.length > 0 || c.inputs.length > 0
    );
  }

  generateMocksForComponents(components) {
    const mocks = [];
    const seen = new Set();

    for (const comp of components) {
      const callbackProps = comp.props.filter((p) => p.isCallback);

      if (callbackProps.length > 0) {
        for (const prop of callbackProps) {
          const mockName = `mock${this.capitalize(prop.name)}`;
          if (!seen.has(mockName)) {
            seen.add(mockName);
            mocks.push(`const ${mockName} = jest.fn();`);
          }
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
    const hasProps = comp.props && comp.props.length > 0;
    const hasRequiredProps = comp.props?.some((p) => p.isRequired) || false;

    lines.push(`describe("${comp.name}", () => {`);

    if (hasProps) {
      lines.push(`  type Props = React.ComponentProps<typeof ${comp.name}>;`);
      if (hasRequiredProps) {
        lines.push(`  const defaultProps: Props = ${this.generateDefaultPropsObject(comp)};`);
        lines.push('');
        lines.push('  const renderUI = (props: Partial<Props> = {}) =>');
      } else {
        lines.push(
          `  const defaultProps: Partial<Props> = ${this.generateDefaultPropsObject(comp)};`
        );
        lines.push('');
        lines.push('  const renderUI = (props: Partial<Props> = {}) =>');
      }
      lines.push(`    renderWithProviders(<${comp.name} {...defaultProps} {...props} />);`);
    } else {
      lines.push('  const renderUI = () =>');
      lines.push(`    renderWithProviders(<${comp.name} />);`);
    }
    lines.push('');

    // Rendering tests
    lines.push('  describe("Rendering", () => {');
    lines.push(`    it("should render without crashing", () => {`);
    lines.push(`      renderUI();`);
    lines.push(`    });`);
    lines.push('');
    lines.push(`    it("should render with default props", () => {`);
    lines.push(`      const { container } = renderUI();`);
    lines.push(`      expect(container).toBeInTheDocument();`);
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
      const customProps = comp.props.filter((p) => p.name !== 'children').slice(0, 2);
      if (customProps.length > 0) {
        const customPropsObj = {};
        for (const prop of customProps) {
          customPropsObj[prop.name] = this.getDefaultValueForType(prop.type, prop.name);
        }
        lines.push(`      renderUI(${this.renderPropsObject(customPropsObj)});`);
      } else {
        lines.push(`      renderUI({ ...defaultProps });`);
      }
      lines.push(`    });`);
      lines.push('  });');
      lines.push('');
    }

    // Function tests
    if (comp.functions.length > 0) {
      lines.push('  describe("Functions", () => {');

      for (const func of comp.functions) {
        lines.push(`    describe("${func.name}", () => {`);

        if (func.isHandler) {
          // Generate handler function tests
          lines.push(
            `      it("should call ${func.name} correctly", ${func.isAsync ? 'async ' : ''}() => {`
          );
          lines.push(`        renderUI();`);

          // Try to find associated element/button to trigger
          const relatedButton = comp.buttons.find(
            (b) =>
              b.attributes?.onClick &&
              (b.text?.toLowerCase().includes(func.name.replace(/^handle/, '').toLowerCase()) ||
                func.name.toLowerCase().includes(b.text?.toLowerCase()))
          );

          if (relatedButton) {
            const selector = this.getButtonSelector(relatedButton);
            lines.push(`        const button = ${selector};`);
            lines.push(`        ${func.isAsync ? 'await ' : ''}userEvent.click(button);`);
          }

          lines.push(`        // Add your assertions here`);
          lines.push(`      });`);
        } else {
          // Regular function test
          lines.push(
            `      it("should execute ${func.name} correctly", ${func.isAsync ? 'async ' : ''}() => {`
          );
          lines.push(`        // Test ${func.name} functionality`);
          if (func.parameters.length > 0) {
            const paramList = func.parameters
              .map((p) => {
                const defaultVal = this.getDefaultValueForType(p.type);
                return p.type === 'string' ? `"${defaultVal}"` : defaultVal;
              })
              .join(', ');
            lines.push(`        // Call with: ${func.name}(${paramList})`);
          }
          lines.push(`        // Add your assertions here`);
          lines.push(`      });`);
        }

        lines.push(`    });`);
        lines.push('');
      }

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
      if (prop.isCallback) {
        props.push(`  ${prop.name}: jest.fn()`);
      } else if (prop.isRequired) {
        const value = this.getDefaultValueForType(prop.type, prop.name);
        if (prop.name === 'children' || String(prop.type).toLowerCase().includes('reactnode')) {
          props.push(`  ${prop.name}: ${value}`);
        } else if (prop.type === 'string') {
          props.push(`  ${prop.name}: "${value}"`);
        } else {
          props.push(`  ${prop.name}: ${value}`);
        }
      }
    }

    if (props.length === 0) {
      return '{}';
    }

    return `{\n${props.join(',\n')}\n  }`;
  }

  getButtonSelector(btn) {
    if (btn.testId) {
      return `screen.getByTestId("${btn.testId}")`;
    }
    const name = btn.ariaLabel || btn.text;
    if (name) {
      return `screen.getByRole("button", { name: /${name}/i })`;
    }
    return `screen.getAllByRole("button")[0]`;
  }

  getInputSelector(input) {
    if (input.label) {
      return `screen.getByLabelText(/${input.label}/i)`;
    }
    if (input.name) {
      return `screen.getByLabelText(/${input.name}/i)`;
    }
    if (input.placeholder) {
      return `screen.getByPlaceholderText(/${input.placeholder}/i)`;
    }

    const type = String(input.type || '').toLowerCase();
    if (type === 'number') return `screen.getByRole("spinbutton")`;
    if (type === 'checkbox') return `screen.getByRole("checkbox")`;
    if (type === 'radio') return `screen.getByRole("radio")`;

    return `screen.getByRole("textbox")`;
  }

  getDefaultValueForType(type, propName = '') {
    const typeStr = type ? String(type).toLowerCase() : '';

    // Handle children prop specifically
    if (
      propName === 'children' ||
      typeStr.includes('reactnode') ||
      typeStr.includes('react.reactnode')
    ) {
      return '<div>Test Content</div>';
    }

    if (typeStr.includes('string')) return 'test-value';
    if (typeStr.includes('number')) return '42';
    if (typeStr.includes('boolean')) return 'true';
    if (typeStr.includes('[]')) return '[]';
    if (typeStr.includes('=>')) return 'jest.fn()';
    if (typeStr.includes('object')) return '{}';

    if (/^on[A-Z]/.test(propName)) return 'jest.fn()';
    if (/^(is|has|show|can|should)[A-Z_]/.test(propName)) return 'true';
    if (/id$/i.test(propName)) return '"test-id"';

    return 'undefined';
  }

  renderPropsObject(propsObj) {
    const entries = Object.entries(propsObj);
    if (entries.length === 0) return '{}';

    const lines = entries.map(([key, value]) => {
      if (value === undefined || value === null) {
        return `  ${key}: ${value}`;
      }

      const valueStr = String(value);
      const isQuotedString =
        (valueStr.startsWith('"') && valueStr.endsWith('"')) ||
        (valueStr.startsWith("'") && valueStr.endsWith("'"));
      const isCodeLike =
        valueStr === 'true' ||
        valueStr === 'false' ||
        valueStr === 'null' ||
        valueStr === 'undefined' ||
        valueStr === '[]' ||
        valueStr === '{}' ||
        valueStr.startsWith('<') ||
        valueStr.includes('jest.fn') ||
        isQuotedString;

      if (isCodeLike) {
        return `  ${key}: ${valueStr}`;
      }

      const isNumber = !Number.isNaN(Number(valueStr));
      if (isNumber) {
        return `  ${key}: ${valueStr}`;
      }

      return `  ${key}: "${valueStr}"`;
    });

    return `({\n${lines.join(',\n')}\n})`;
  }

  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
