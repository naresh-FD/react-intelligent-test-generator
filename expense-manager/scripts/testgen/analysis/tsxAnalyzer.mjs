import { getTS, createSourceFile } from '../utils/tsconfig.mjs';

export class DeepComponentAnalyzer {
  constructor(sourceCode, filePath) {
    this.sourceCode = sourceCode;
    this.filePath = filePath;
    const ts = getTS();
    this.sourceFile = createSourceFile(filePath, sourceCode);
    this.ts = ts;
    this.components = [];
    this.imports = [];
    this.currentComponent = null;
  }

  analyze() {
    this.collectImports();
    this.visit(this.sourceFile);

    for (const comp of this.components) {
      comp.pattern = this.detectPattern(comp);
      comp.scenarios = this.generateScenarios(comp);
    }

    return this.components;
  }

  collectImports() {
    const visit = (node) => {
      if (this.ts.isImportDeclaration(node)) {
        const moduleSpecifier = node.moduleSpecifier.getText().replace(/['"]/g, '');
        const importClause = node.importClause;

        if (importClause) {
          if (importClause.name) {
            this.imports.push({
              name: importClause.name.text,
              from: moduleSpecifier,
              isDefault: true,
            });
          }

          if (importClause.namedBindings && this.ts.isNamedImports(importClause.namedBindings)) {
            for (const element of importClause.namedBindings.elements) {
              this.imports.push({
                name: element.name.text,
                from: moduleSpecifier,
                isDefault: false,
              });
            }
          }
        }
      }

      this.ts.forEachChild(node, visit);
    };
    visit(this.sourceFile);
  }

  visit(node) {
    if (this.ts.isFunctionDeclaration(node) && node.name) {
      this.visitComponentFunction(node);
    } else if (this.ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (this.ts.isIdentifier(decl.name) && decl.initializer) {
          if (
            this.ts.isArrowFunction(decl.initializer) ||
            this.ts.isFunctionExpression(decl.initializer)
          ) {
            this.visitComponentFunction(decl.initializer, decl.name.text);
          }
        }
      }
    }

    this.ts.forEachChild(node, (child) => this.visit(child));
  }

  visitComponentFunction(node, nameOverride = null) {
    const name = nameOverride || node.name?.text;
    if (!name) return;

    if (!this.isLikelyComponent(name)) return;

    const component = {
      name,
      filePath: this.filePath,
      isExported: this.isExported(node),
      isDefault: this.isDefaultExport(node),
      props: [],
      stateVariables: [],
      effects: [],
      apiCalls: [],
      functions: [],
      buttons: [],
      inputs: [],
      forms: [],
      links: [],
      images: [],
      modals: [],
      lists: [],
      cards: [],
      tables: [],
      elements: [],
      pattern: null,
      scenarios: [],
    };

    this.currentComponent = component;
    this.extractProps(node);
    this.analyzeBody(node.body);
    this.currentComponent = null;

    if (component.elements.length > 0) {
      this.components.push(component);
    }
  }

  isLikelyComponent(name) {
    return /^[A-Z]/.test(name);
  }

  isExported(node) {
    return node.modifiers?.some((mod) => mod.kind === this.ts.SyntaxKind.ExportKeyword) ?? false;
  }

  isDefaultExport(node) {
    return node.modifiers?.some((mod) => mod.kind === this.ts.SyntaxKind.DefaultKeyword) ?? false;
  }

  extractProps(node) {
    const params = node.parameters || [];
    if (params.length === 0) return;

    const propsParam = params[0];

    if (this.ts.isObjectBindingPattern(propsParam.name)) {
      for (const element of propsParam.name.elements) {
        if (this.ts.isBindingElement(element) && this.ts.isIdentifier(element.name)) {
          const name = element.name.text;
          const hasDefault = !!element.initializer;
          const defaultValue = hasDefault ? this.nodeToString(element.initializer) : null;

          this.currentComponent.props.push({
            name,
            isRequired: !hasDefault,
            type: this.inferPropType(name, defaultValue),
            defaultValue,
            isCallback: name.startsWith('on') && /^on[A-Z]/.test(name),
            isBoolean:
              name.startsWith('is') ||
              name.startsWith('has') ||
              name.startsWith('show') ||
              name.startsWith('can') ||
              name.startsWith('should'),
          });
        }
      }
    }

    if (propsParam.type) {
      this.extractPropsFromType(propsParam.type);
    }
  }

  extractPropsFromType(typeNode) {
    if (this.ts.isTypeLiteralNode(typeNode)) {
      for (const member of typeNode.members) {
        if (
          this.ts.isPropertySignature(member) &&
          member.name &&
          this.ts.isIdentifier(member.name)
        ) {
          const name = member.name.text;
          const isOptional = !!member.questionToken;
          const type = member.type ? this.typeNodeToString(member.type) : 'unknown';

          const existing = this.currentComponent.props.find((p) => p.name === name);
          if (existing) {
            existing.type = type;
            existing.isRequired = !isOptional;
          } else {
            this.currentComponent.props.push({
              name,
              isRequired: !isOptional,
              type,
              defaultValue: null,
              isCallback:
                type.includes('=>') ||
                type === 'function' ||
                (name.startsWith('on') && /^on[A-Z]/.test(name)),
              isBoolean: type === 'boolean',
            });
          }
        }
      }
    }

    if (this.ts.isTypeReferenceNode(typeNode) && this.ts.isIdentifier(typeNode.typeName)) {
      const typeName = typeNode.typeName.text;
      this.findAndExtractTypeDefinition(typeName);
    }
  }

  findAndExtractTypeDefinition(typeName) {
    const visit = (node) => {
      if (this.ts.isInterfaceDeclaration(node) && node.name.text === typeName) {
        for (const member of node.members) {
          if (
            this.ts.isPropertySignature(member) &&
            member.name &&
            this.ts.isIdentifier(member.name)
          ) {
            const name = member.name.text;
            const isOptional = !!member.questionToken;
            const type = member.type ? this.typeNodeToString(member.type) : 'unknown';

            const existing = this.currentComponent.props.find((p) => p.name === name);
            if (!existing) {
              this.currentComponent.props.push({
                name,
                isRequired: !isOptional,
                type,
                defaultValue: null,
                isCallback: type.includes('=>') || type === 'function',
                isBoolean: type === 'boolean',
              });
            }
          }
        }
      }

      this.ts.forEachChild(node, visit);
    };

    visit(this.sourceFile);
  }

  analyzeBody(body) {
    const visit = (node) => {
      // Detect function declarations inside component
      if (this.ts.isFunctionDeclaration(node) && node.name) {
        this.extractFunction(node, node.name.text);
      }

      // Detect arrow functions and function expressions assigned to variables
      if (this.ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (this.ts.isIdentifier(decl.name) && decl.initializer) {
            const funcName = decl.name.text;

            // Skip if it looks like a component (starts with uppercase)
            if (/^[A-Z]/.test(funcName)) {
              continue;
            }

            // Direct arrow function: const handleX = () => {}
            if (
              this.ts.isArrowFunction(decl.initializer) ||
              this.ts.isFunctionExpression(decl.initializer)
            ) {
              this.extractFunction(decl.initializer, funcName);
            }

            // React hooks wrapping functions: const handleX = useCallback(() => {}, [])
            else if (this.ts.isCallExpression(decl.initializer)) {
              const callExpr = decl.initializer;
              const isReactHook =
                this.ts.isIdentifier(callExpr.expression) &&
                ['useCallback', 'useMemo'].includes(callExpr.expression.text);

              if (isReactHook && callExpr.arguments.length > 0) {
                const firstArg = callExpr.arguments[0];
                if (this.ts.isArrowFunction(firstArg) || this.ts.isFunctionExpression(firstArg)) {
                  this.extractFunction(
                    firstArg,
                    funcName,
                    callExpr.expression.text === 'useCallback'
                  );
                }
              }
            }
          }
        }
      }

      if (this.ts.isJsxElement(node) || this.ts.isJsxSelfClosingElement(node)) {
        this.analyzeJSXElement(node);
      }

      if (this.ts.isConditionalExpression(node)) {
        this.analyzeConditional(node);
      }

      if (this.ts.isBinaryExpression(node)) {
        if (node.operatorToken.kind === this.ts.SyntaxKind.AmpersandAmpersandToken) {
          this.analyzeLogicalAnd(node);
        }
      }

      if (this.ts.isCallExpression(node) && this.ts.isPropertyAccessExpression(node.expression)) {
        const methodName = node.expression.name?.text;
        if (['map', 'filter', 'forEach'].includes(methodName)) {
          this.analyzeArrayMethod(node, methodName);
        }
      }

      if (this.ts.isCallExpression(node)) {
        this.analyzeCallExpression(node);
      }

      this.ts.forEachChild(node, visit);
    };

    if (body) {
      visit(body);
    }
  }

  extractFunction(node, name, isCallback = false) {
    const params =
      node.parameters?.map((p) => {
        const paramName = this.ts.isIdentifier(p.name) ? p.name.text : 'param';
        const paramType = p.type ? this.typeNodeToString(p.type) : 'any';
        return { name: paramName, type: paramType };
      }) || [];

    const isAsync =
      node.modifiers?.some((m) => m.kind === this.ts.SyntaxKind.AsyncKeyword) || false;

    const funcInfo = {
      name,
      parameters: params,
      isAsync,
      isHandler: /^(handle|on)[A-Z]/.test(name),
      isCallback,
    };

    this.currentComponent.functions.push(funcInfo);
  }

  analyzeJSXElement(node) {
    const tagName = this.getJSXTagName(node);
    const attributes = this.extractJSXAttributes(node);
    const textContent = this.getJSXTextContent(node);
    const selector = this.generateSelector(tagName, attributes, textContent);

    const element = {
      tagName,
      attributes,
      textContent,
      selector,
      hasChildren: node.children?.length > 0,
    };

    this.currentComponent.elements.push(element);
    this.categorizeElement(element);
  }

  getJSXTagName(node) {
    if (node.openingElement?.tagName) {
      const tagName = node.openingElement.tagName;
      if (this.ts.isIdentifier(tagName)) {
        return tagName.text;
      }
      if (this.ts.isJsxNamespacedName(tagName)) {
        return tagName.name.text;
      }
    }
    return 'unknown';
  }

  extractJSXAttributes(node) {
    const attrs = {};
    const element = node.openingElement || node;

    if (!element.attributes) return attrs;

    // Handle both JSX element attributes and spread attributes
    const attributesArray = element.attributes.properties || element.attributes;

    // Check if it's iterable before trying to iterate
    if (!attributesArray || typeof attributesArray[Symbol.iterator] !== 'function') {
      return attrs;
    }

    for (const attr of attributesArray) {
      if (this.ts.isJsxAttribute(attr) && this.ts.isIdentifier(attr.name)) {
        const name = attr.name.text;
        let value = '';

        if (attr.initializer) {
          if (this.ts.isStringLiteral(attr.initializer)) {
            value = attr.initializer.text;
          } else if (this.ts.isJsxExpression(attr.initializer)) {
            value = attr.initializer.expression
              ? this.nodeToString(attr.initializer.expression)
              : 'true';
          }
        } else {
          value = 'true';
        }

        attrs[name] = value;
      }
    }

    return attrs;
  }

  getJSXTextContent(node) {
    let text = '';
    if (node.children) {
      for (const child of node.children) {
        if (this.ts.isJsxText(child)) {
          text += child.text.trim();
        }
      }
    }
    return text;
  }

  generateSelector(tagName, attributes, textContent) {
    const testId = attributes.testId || attributes['data-testid'];
    if (testId) return `[data-testid="${testId}"]`;
    if (attributes.id) return `#${attributes.id}`;
    if (attributes.className) return `.${attributes.className.split(' ')[0]}`;
    if (textContent) return textContent;
    return tagName;
  }

  categorizeElement(element) {
    const { tagName, attributes, textContent, selector } = element;
    const tag = tagName.toLowerCase();

    if (tag === 'button' || attributes.role === 'button' || attributes.type === 'submit') {
      this.currentComponent.buttons.push({
        text: textContent,
        type: attributes.type || 'button',
        disabled: attributes.disabled === 'true',
        onClick: attributes.onClick,
        ariaLabel: attributes['aria-label'],
        testId: attributes.testId || attributes['data-testid'],
        selector,
      });
    }

    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      this.currentComponent.inputs.push({
        type:
          attributes.type ||
          (tag === 'textarea' ? 'textarea' : tag === 'select' ? 'select' : 'text'),
        name: attributes.name,
        placeholder: attributes.placeholder,
        label: attributes['aria-label'],
        required: attributes.required === 'true',
        disabled: attributes.disabled === 'true',
        value: attributes.value,
        defaultValue: attributes.defaultValue,
        onChange: attributes.onChange,
        selector,
      });
    }

    if (tag === 'form') {
      this.currentComponent.forms.push({
        onSubmit: attributes.onSubmit,
        method: attributes.method,
        action: attributes.action,
      });
    }

    if (tag === 'a') {
      this.currentComponent.links.push({
        text: textContent,
        href: attributes.href,
        target: attributes.target,
        selector,
      });
    }

    if (tag === 'img') {
      this.currentComponent.images.push({
        alt: attributes.alt,
        src: attributes.src,
        hasAlt: attributes.alt !== undefined,
        selector,
      });
    }

    if (
      attributes.role === 'dialog' ||
      attributes.role === 'alertdialog' ||
      tagName.includes('Modal') ||
      tagName.includes('Dialog')
    ) {
      this.currentComponent.modals.push({
        ariaModal: attributes['aria-modal'],
        ariaLabelledby: attributes['aria-labelledby'],
        selector,
      });
    }

    if (tag === 'ul' || tag === 'ol' || attributes.role === 'list') {
      this.currentComponent.lists.push({ selector });
    }

    if (
      attributes.role === 'region' ||
      tagName.includes('Card') ||
      tag === 'section' ||
      attributes.className?.includes('card')
    ) {
      this.currentComponent.cards.push({ selector });
    }

    if (tag === 'table') {
      this.currentComponent.tables.push({ selector });
    }
  }

  analyzeCallExpression(node) {
    const callee = node.expression;
    let hookName = null;

    if (this.ts.isIdentifier(callee)) {
      hookName = callee.text;
    } else if (this.ts.isPropertyAccessExpression(callee)) {
      hookName = callee.name?.text;
    }

    if (!hookName) return;

    if (hookName === 'useState') {
      const parent = node.parent;
      if (this.ts.isVariableDeclaration(parent) && this.ts.isArrayBindingPattern(parent.name)) {
        const [stateEl, setterEl] = parent.name.elements;
        const stateName =
          stateEl && this.ts.isBindingElement(stateEl) && this.ts.isIdentifier(stateEl.name)
            ? stateEl.name.text
            : null;
        const setterName =
          setterEl && this.ts.isBindingElement(setterEl) && this.ts.isIdentifier(setterEl.name)
            ? setterEl.name.text
            : null;
        const initialValue = node.arguments[0] ? this.nodeToString(node.arguments[0]) : 'undefined';

        if (stateName) {
          this.currentComponent.stateVariables.push({
            name: stateName,
            setter: setterName,
            initialValue,
            type: this.inferTypeFromValue(initialValue),
          });
        }
      }
    }

    if (hookName === 'useEffect') {
      const deps = node.arguments[1];
      const dependencies = [];
      if (deps && this.ts.isArrayLiteralExpression(deps)) {
        for (const el of deps.elements) {
          dependencies.push(this.nodeToString(el));
        }
      }
      this.currentComponent.effects.push({
        dependencies,
        hasCleanup: this.hasCleanupFunction(node.arguments[0]),
      });
    }

    if (['fetch', 'axios', 'get', 'post', 'put', 'delete', 'patch'].includes(hookName)) {
      this.currentComponent.apiCalls.push({
        method: hookName,
        args: node.arguments.map((a) => this.nodeToString(a)),
      });
    }
  }

  analyzeConditional(node) {
    const whenCondition = node.whenTrue;
    if (this.ts.isJsxElement(whenCondition) || this.ts.isJsxSelfClosingElement(whenCondition)) {
      this.analyzeJSXElement(whenCondition);
    }
    if (node.whenFalse) {
      const whenFalse = node.whenFalse;
      if (this.ts.isJsxElement(whenFalse) || this.ts.isJsxSelfClosingElement(whenFalse)) {
        this.analyzeJSXElement(whenFalse);
      }
    }
  }

  analyzeLogicalAnd(node) {
    if (this.ts.isJsxElement(node.right) || this.ts.isJsxSelfClosingElement(node.right)) {
      this.analyzeJSXElement(node.right);
    }
  }

  analyzeArrayMethod(node, methodName) {
    if (node.arguments[0]) {
      const callback = node.arguments[0];
      const body = this.ts.isArrowFunction(callback)
        ? callback.body
        : this.ts.isFunctionExpression(callback)
          ? callback.body
          : null;

      if (body) {
        const visit = (n) => {
          if (this.ts.isJsxElement(n) || this.ts.isJsxSelfClosingElement(n)) {
            this.analyzeJSXElement(n);
          }
          this.ts.forEachChild(n, visit);
        };
        visit(body);
      }
    }
  }

  hasCleanupFunction(callbackNode) {
    if (!callbackNode) return false;
    const text = callbackNode.getText?.();
    if (!text) return false;
    return (
      text.includes('return') &&
      (text.includes('clearInterval') ||
        text.includes('clearTimeout') ||
        text.includes('removeEventListener') ||
        text.includes('unsubscribe') ||
        text.includes('cleanup'))
    );
  }

  inferPropType(name, defaultValue) {
    if (!defaultValue) return 'unknown';

    if (defaultValue === 'true' || defaultValue === 'false') return 'boolean';
    if (!isNaN(defaultValue)) return 'number';
    if (defaultValue.startsWith('"') || defaultValue.startsWith("'")) return 'string';
    if (defaultValue.startsWith('[')) return 'array';
    if (defaultValue.startsWith('{')) return 'object';
    if (defaultValue === 'null') return 'null';
    if (defaultValue === 'undefined') return 'undefined';

    return 'unknown';
  }

  inferTypeFromValue(value) {
    return this.inferPropType('', value);
  }

  nodeToString(node) {
    if (!node) return 'undefined';
    return this.sourceCode.substring(node.pos, node.end).trim();
  }

  typeNodeToString(node) {
    if (!node) return 'unknown';
    return this.sourceCode.substring(node.pos, node.end).trim();
  }

  detectPattern(component) {
    if (component.forms.length > 0) return 'form';
    if (component.lists.length > 0) return 'list';
    if (component.modals.length > 0) return 'modal';
    if (component.tables.length > 0) return 'table';
    if (component.cards.length > 0) return 'card';
    return 'generic';
  }

  generateScenarios(component) {
    const scenarios = [];
    const { buttons, inputs, forms, props, pattern } = component;

    scenarios.push({
      name: `renders without crashing`,
      checks: ['toBeInTheDocument'],
    });

    scenarios.push({
      name: `renders with default props`,
      checks: ['toBeInTheDocument'],
    });

    if (buttons.length > 0) {
      for (const btn of buttons) {
        scenarios.push({
          name: `handles ${btn.text || 'button'} click`,
          checks: ['toHaveBeenCalled'],
          userAction: `click button with text "${btn.text || 'button'}"`,
        });
      }
    }

    if (inputs.length > 0) {
      for (const input of inputs) {
        scenarios.push({
          name: `updates on input change`,
          checks: ['toHaveValue', 'toBeInTheDocument'],
          userAction: `type in ${input.type} input`,
        });
      }
    }

    if (props.length > 0) {
      scenarios.push({
        name: `renders with custom props`,
        checks: ['toBeInTheDocument'],
        props: props.slice(0, 2),
      });
    }

    return scenarios;
  }
}
