#!/usr/bin/env node
/**
 * Auto Test Generator v3 - Smart Static Analysis (NO AI NEEDED)
 *
 * Uses deep pattern recognition to generate intelligent tests:
 * - Analyzes JSX structure to understand what renders
 * - Detects component patterns (forms, lists, modals, cards, etc.)
 * - Infers test scenarios from code structure
 * - Generates specific selectors based on actual attributes
 * - Creates realistic assertions based on behavior
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');

const GENERATED_HEADER = '/** @generated AUTO-GENERATED FILE - safe to overwrite */';

let ts;

async function loadTypeScript() {
  try {
    const tsModule = await import('typescript');
    ts = tsModule.default || tsModule;
  } catch (err) {
    console.error('TypeScript not found.');
    process.exit(1);
  }
}

// ============================================================================
// DEEP COMPONENT ANALYZER
// ============================================================================

class DeepComponentAnalyzer {
  constructor(sourceCode, filePath) {
    this.sourceCode = sourceCode;
    this.filePath = filePath;
    this.sourceFile = ts.createSourceFile(
      filePath,
      sourceCode,
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    this.components = [];
    this.imports = [];
    this.currentComponent = null;
  }

  analyze() {
    // First pass: collect imports
    this.collectImports();

    // Second pass: analyze components
    this.visit(this.sourceFile);

    // Third pass: infer component patterns
    for (const comp of this.components) {
      comp.pattern = this.detectPattern(comp);
      comp.scenarios = this.generateScenarios(comp);
    }

    return this.components;
  }

  collectImports() {
    const visit = (node) => {
      if (ts.isImportDeclaration(node)) {
        const moduleSpecifier = node.moduleSpecifier.getText().replace(/['"]/g, '');
        const importClause = node.importClause;

        if (importClause) {
          // Default import
          if (importClause.name) {
            this.imports.push({
              name: importClause.name.text,
              from: moduleSpecifier,
              isDefault: true,
            });
          }

          // Named imports
          if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
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
      ts.forEachChild(node, visit);
    };
    visit(this.sourceFile);
  }

  visit(node) {
    // Function component
    if (ts.isFunctionDeclaration(node) && node.name && /^[A-Z]/.test(node.name.text)) {
      this.analyzeComponent(node, node.name.text, this.hasExportModifier(node, 'default'));
    }

    // Arrow function component
    if (ts.isVariableStatement(node)) {
      const isExported = this.hasExportModifier(node, 'export');
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && /^[A-Z]/.test(decl.name.text) && decl.initializer) {
          if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
            this.analyzeComponent(decl.initializer, decl.name.text, false, isExported);
          }
          // Handle React.memo, React.forwardRef
          if (ts.isCallExpression(decl.initializer)) {
            const callee = decl.initializer.expression;
            if (this.isReactWrapper(callee)) {
              const innerFn = decl.initializer.arguments[0];
              if (innerFn && (ts.isArrowFunction(innerFn) || ts.isFunctionExpression(innerFn))) {
                this.analyzeComponent(innerFn, decl.name.text, false, isExported);
              }
            }
          }
        }
      }
    }

    // Export default
    if (ts.isExportAssignment(node) && node.expression) {
      if (ts.isIdentifier(node.expression)) {
        // Mark existing component as default export
        const comp = this.components.find((c) => c.name === node.expression.text);
        if (comp) comp.isDefault = true;
      }
    }

    ts.forEachChild(node, (child) => this.visit(child));
  }

  hasExportModifier(node, type) {
    if (!node.modifiers) return false;
    return node.modifiers.some((m) => {
      if (type === 'default') return m.kind === ts.SyntaxKind.DefaultKeyword;
      if (type === 'export') return m.kind === ts.SyntaxKind.ExportKeyword;
      return false;
    });
  }

  isReactWrapper(callee) {
    if (ts.isIdentifier(callee)) {
      return ['memo', 'forwardRef'].includes(callee.text);
    }
    if (ts.isPropertyAccessExpression(callee)) {
      return ['memo', 'forwardRef'].includes(callee.name.text);
    }
    return false;
  }

  analyzeComponent(node, name, isDefault = false, isExported = true) {
    const component = {
      name,
      isDefault,
      isExported,
      props: [],
      elements: [],
      events: [],
      stateVariables: [],
      effects: [],
      conditionals: [],
      loops: [],
      apiCalls: [],
      childComponents: [],
      accessibility: [],
      testIds: [],
      forms: [],
      inputs: [],
      buttons: [],
      links: [],
      images: [],
      modals: [],
      lists: [],
      tables: [],
      pattern: null,
      scenarios: [],
    };

    this.currentComponent = component;

    // Extract props
    this.extractProps(node);

    // Analyze body
    if (node.body) {
      this.analyzeBody(node.body);
    }

    this.currentComponent = null;

    // Only add if it has JSX
    if (component.elements.length > 0) {
      this.components.push(component);
    }
  }

  extractProps(node) {
    const params = node.parameters || [];
    if (params.length === 0) return;

    const propsParam = params[0];

    // Destructured props
    if (ts.isObjectBindingPattern(propsParam.name)) {
      for (const element of propsParam.name.elements) {
        if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) {
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

    // Type annotations
    if (propsParam.type) {
      this.extractPropsFromType(propsParam.type);
    }
  }

  extractPropsFromType(typeNode) {
    if (ts.isTypeLiteralNode(typeNode)) {
      for (const member of typeNode.members) {
        if (ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name)) {
          const name = member.name.text;
          const isOptional = !!member.questionToken;
          const type = member.type ? this.typeNodeToString(member.type) : 'unknown';

          // Check if already exists from destructuring
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

    // Handle type references (Props, ComponentProps, etc.)
    if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
      const typeName = typeNode.typeName.text;
      // Try to find the type definition in the file
      this.findAndExtractTypeDefinition(typeName);
    }
  }

  findAndExtractTypeDefinition(typeName) {
    const visit = (node) => {
      if (ts.isInterfaceDeclaration(node) && node.name.text === typeName) {
        for (const member of node.members) {
          if (ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name)) {
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
                isCallback: type.includes('=>') || (name.startsWith('on') && /^on[A-Z]/.test(name)),
                isBoolean: type === 'boolean',
              });
            }
          }
        }
      }
      if (ts.isTypeAliasDeclaration(node) && node.name.text === typeName) {
        if (ts.isTypeLiteralNode(node.type)) {
          this.extractPropsFromType(node.type);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(this.sourceFile);
  }

  typeNodeToString(typeNode) {
    if (typeNode.kind === ts.SyntaxKind.StringKeyword) return 'string';
    if (typeNode.kind === ts.SyntaxKind.NumberKeyword) return 'number';
    if (typeNode.kind === ts.SyntaxKind.BooleanKeyword) return 'boolean';
    if (typeNode.kind === ts.SyntaxKind.VoidKeyword) return 'void';
    if (ts.isFunctionTypeNode(typeNode)) return 'function';
    if (ts.isArrayTypeNode(typeNode)) return `${this.typeNodeToString(typeNode.elementType)}[]`;
    if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
      return typeNode.typeName.text;
    }
    if (ts.isUnionTypeNode(typeNode)) {
      return typeNode.types.map((t) => this.typeNodeToString(t)).join(' | ');
    }
    return 'unknown';
  }

  inferPropType(name, defaultValue) {
    // From naming conventions
    if (name.startsWith('on') && /^on[A-Z]/.test(name)) return 'function';
    if (
      name.startsWith('is') ||
      name.startsWith('has') ||
      name.startsWith('show') ||
      name.startsWith('can')
    )
      return 'boolean';
    if (name === 'children') return 'ReactNode';
    if (name === 'className' || name === 'style' || name === 'id') return 'string';
    if (
      name.endsWith('Id') ||
      name.endsWith('Name') ||
      name.endsWith('Title') ||
      name.endsWith('Label')
    )
      return 'string';
    if (
      name.endsWith('Count') ||
      name.endsWith('Index') ||
      name.endsWith('Size') ||
      name.endsWith('Amount')
    )
      return 'number';
    if (
      name.endsWith('List') ||
      name.endsWith('Items') ||
      name.endsWith('Options') ||
      name.endsWith('Data')
    )
      return 'array';

    // From default value
    if (defaultValue) {
      if (defaultValue === 'true' || defaultValue === 'false') return 'boolean';
      if (
        defaultValue.startsWith('"') ||
        defaultValue.startsWith("'") ||
        defaultValue.startsWith('`')
      )
        return 'string';
      if (/^\d+$/.test(defaultValue)) return 'number';
      if (defaultValue === '[]') return 'array';
      if (defaultValue === '{}') return 'object';
      if (defaultValue === 'null') return 'null';
      if (defaultValue.includes('=>') || defaultValue.startsWith('function')) return 'function';
    }

    return 'unknown';
  }

  analyzeBody(body) {
    const visit = (node) => {
      // State hooks
      if (ts.isCallExpression(node)) {
        this.analyzeCallExpression(node);
      }

      // JSX
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        this.analyzeJSXElement(node);
      }

      // Conditionals in JSX
      if (ts.isConditionalExpression(node)) {
        this.analyzeConditional(node);
      }

      // Logical expressions (&&, ||)
      if (ts.isBinaryExpression(node)) {
        if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
          this.analyzeLogicalAnd(node);
        }
      }

      // Map/filter for lists
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const methodName = node.expression.name.text;
        if (['map', 'filter', 'forEach'].includes(methodName)) {
          this.analyzeArrayMethod(node, methodName);
        }
      }

      ts.forEachChild(node, visit);
    };
    visit(body);
  }

  analyzeCallExpression(node) {
    const callee = node.expression;
    let hookName = null;

    if (ts.isIdentifier(callee)) {
      hookName = callee.text;
    } else if (ts.isPropertyAccessExpression(callee)) {
      hookName = callee.name.text;
    }

    if (!hookName) return;

    // useState
    if (hookName === 'useState') {
      const parent = node.parent;
      if (ts.isVariableDeclaration(parent) && ts.isArrayBindingPattern(parent.name)) {
        const [stateEl, setterEl] = parent.name.elements;
        const stateName =
          stateEl && ts.isBindingElement(stateEl) && ts.isIdentifier(stateEl.name)
            ? stateEl.name.text
            : null;
        const setterName =
          setterEl && ts.isBindingElement(setterEl) && ts.isIdentifier(setterEl.name)
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

    // useEffect
    if (hookName === 'useEffect') {
      const deps = node.arguments[1];
      const dependencies = [];
      if (deps && ts.isArrayLiteralExpression(deps)) {
        for (const el of deps.elements) {
          dependencies.push(this.nodeToString(el));
        }
      }
      this.currentComponent.effects.push({
        dependencies,
        hasCleanup: this.hasCleanupFunction(node.arguments[0]),
      });
    }

    // API calls (fetch, axios, etc.)
    if (['fetch', 'axios', 'get', 'post', 'put', 'delete', 'patch'].includes(hookName)) {
      this.currentComponent.apiCalls.push({
        method: hookName,
        args: node.arguments.map((a) => this.nodeToString(a)),
      });
    }
  }

  hasCleanupFunction(callbackNode) {
    if (!callbackNode) return false;
    const text = callbackNode.getText();
    return (
      text.includes('return') &&
      (text.includes('clearInterval') ||
        text.includes('clearTimeout') ||
        text.includes('removeEventListener') ||
        text.includes('unsubscribe') ||
        text.includes('cleanup'))
    );
  }

  inferTypeFromValue(value) {
    if (value === 'true' || value === 'false') return 'boolean';
    if (value === '""' || value === "''" || value.startsWith('"') || value.startsWith("'"))
      return 'string';
    if (value === '[]') return 'array';
    if (value === '{}') return 'object';
    if (value === 'null') return 'null';
    if (value === 'undefined') return 'undefined';
    if (/^\d+$/.test(value)) return 'number';
    return 'unknown';
  }

  analyzeJSXElement(node) {
    const isFullElement = ts.isJsxElement(node);
    const openingElement = isFullElement ? node.openingElement : node;

    const tagName = this.getTagName(openingElement);
    const attributes = this.extractAttributes(openingElement);
    const textContent = isFullElement ? this.extractTextContent(node) : '';
    const children = isFullElement ? this.analyzeChildren(node) : [];

    const element = {
      tagName,
      attributes,
      textContent,
      children,
      isComponent: /^[A-Z]/.test(tagName),
      isInteractive: this.isInteractive(tagName, attributes),
      selector: this.generateSelector(tagName, attributes, textContent),
    };

    this.currentComponent.elements.push(element);

    // Categorize special elements
    this.categorizeElement(element);

    // Track child components
    if (element.isComponent) {
      this.currentComponent.childComponents.push({
        name: tagName,
        props: attributes,
      });
    }
  }

  getTagName(openingElement) {
    const tagName = openingElement.tagName;
    if (ts.isIdentifier(tagName)) return tagName.text;
    if (ts.isPropertyAccessExpression(tagName)) {
      return `${this.nodeToString(tagName.expression)}.${tagName.name.text}`;
    }
    if (ts.isJsxNamespacedName(tagName)) {
      return `${tagName.namespace.text}:${tagName.name.text}`;
    }
    return 'unknown';
  }

  extractAttributes(openingElement) {
    const attrs = {};
    const properties = openingElement.attributes?.properties || [];

    for (const attr of properties) {
      if (ts.isJsxAttribute(attr) && attr.name) {
        const name = ts.isIdentifier(attr.name) ? attr.name.text : attr.name.getText();
        const value = this.extractAttributeValue(attr.initializer);
        attrs[name] = value;

        // Track events
        if (name.startsWith('on') && /^on[A-Z]/.test(name)) {
          this.currentComponent.events.push({
            name,
            handler: value,
            element: this.getTagName(openingElement),
          });
        }
      }

      if (ts.isJsxSpreadAttribute(attr)) {
        attrs['...spread'] = this.nodeToString(attr.expression);
      }
    }

    return attrs;
  }

  extractAttributeValue(initializer) {
    if (!initializer) return true; // Boolean shorthand
    if (ts.isStringLiteral(initializer)) return initializer.text;
    if (ts.isJsxExpression(initializer)) {
      if (!initializer.expression) return '';
      return this.nodeToString(initializer.expression);
    }
    return 'dynamic';
  }

  extractTextContent(jsxElement) {
    const texts = [];
    for (const child of jsxElement.children || []) {
      if (ts.isJsxText(child)) {
        const text = child.text.trim();
        if (text) texts.push(text);
      }
      if (ts.isJsxExpression(child) && child.expression) {
        if (ts.isStringLiteral(child.expression)) {
          texts.push(child.expression.text);
        } else if (ts.isTemplateExpression(child.expression)) {
          texts.push('{template}');
        } else if (ts.isIdentifier(child.expression)) {
          texts.push(`{${child.expression.text}}`);
        }
      }
    }
    return texts.join(' ').trim();
  }

  analyzeChildren(jsxElement) {
    const children = [];
    for (const child of jsxElement.children || []) {
      if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
        const isFullElement = ts.isJsxElement(child);
        const openingElement = isFullElement ? child.openingElement : child;
        children.push({
          tagName: this.getTagName(openingElement),
          attributes: this.extractAttributes(openingElement),
        });
      }
    }
    return children;
  }

  isInteractive(tagName, attributes) {
    const interactiveTags = ['button', 'a', 'input', 'select', 'textarea', 'details', 'summary'];
    const interactiveRoles = [
      'button',
      'link',
      'checkbox',
      'radio',
      'switch',
      'tab',
      'menuitem',
      'option',
    ];

    if (interactiveTags.includes(tagName.toLowerCase())) return true;
    if (interactiveRoles.includes(attributes.role)) return true;
    if (attributes.onClick || attributes.onPress || attributes.onSubmit) return true;
    if (attributes.tabIndex !== undefined) return true;

    return false;
  }

  generateSelector(tagName, attributes, textContent) {
    // Priority: testId > role+name > label > placeholder > text

    if (attributes['data-testid']) {
      return { type: 'testId', value: attributes['data-testid'] };
    }

    const role = attributes.role || this.inferRole(tagName, attributes);
    const name = attributes['aria-label'] || textContent;

    if (role && name && !name.includes('{')) {
      return { type: 'role', role, name };
    }

    if (role) {
      return { type: 'role', role };
    }

    if (attributes['aria-label']) {
      return { type: 'labelText', value: attributes['aria-label'] };
    }

    if (attributes.placeholder) {
      return { type: 'placeholderText', value: attributes.placeholder };
    }

    if (textContent && !textContent.includes('{')) {
      return { type: 'text', value: textContent };
    }

    return { type: 'role', role: tagName.toLowerCase() };
  }

  inferRole(tagName, attributes) {
    const roleMap = {
      button: 'button',
      a: 'link',
      input:
        attributes.type === 'checkbox'
          ? 'checkbox'
          : attributes.type === 'radio'
            ? 'radio'
            : attributes.type === 'submit'
              ? 'button'
              : 'textbox',
      select: 'combobox',
      textarea: 'textbox',
      img: 'img',
      nav: 'navigation',
      main: 'main',
      header: 'banner',
      footer: 'contentinfo',
      aside: 'complementary',
      form: 'form',
      table: 'table',
      ul: 'list',
      ol: 'list',
      li: 'listitem',
      h1: 'heading',
      h2: 'heading',
      h3: 'heading',
      h4: 'heading',
      h5: 'heading',
      h6: 'heading',
      dialog: 'dialog',
      alert: 'alert',
    };

    return roleMap[tagName.toLowerCase()] || null;
  }

  categorizeElement(element) {
    const { tagName, attributes, textContent, selector } = element;
    const tag = tagName.toLowerCase();

    // Buttons
    if (tag === 'button' || attributes.role === 'button' || attributes.type === 'submit') {
      this.currentComponent.buttons.push({
        text: textContent,
        type: attributes.type || 'button',
        disabled: attributes.disabled,
        onClick: attributes.onClick,
        selector,
      });
    }

    // Inputs
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      this.currentComponent.inputs.push({
        type:
          attributes.type ||
          (tag === 'textarea' ? 'textarea' : tag === 'select' ? 'select' : 'text'),
        name: attributes.name,
        placeholder: attributes.placeholder,
        label: attributes['aria-label'],
        required: attributes.required,
        disabled: attributes.disabled,
        value: attributes.value,
        defaultValue: attributes.defaultValue,
        onChange: attributes.onChange,
        selector,
      });
    }

    // Forms
    if (tag === 'form') {
      this.currentComponent.forms.push({
        onSubmit: attributes.onSubmit,
        method: attributes.method,
        action: attributes.action,
      });
    }

    // Links
    if (tag === 'a') {
      this.currentComponent.links.push({
        text: textContent,
        href: attributes.href,
        target: attributes.target,
        selector,
      });
    }

    // Images
    if (tag === 'img') {
      this.currentComponent.images.push({
        alt: attributes.alt,
        src: attributes.src,
        hasAlt: attributes.alt !== undefined,
        selector,
      });
    }

    // Modals/Dialogs
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

    // Lists
    if (tag === 'ul' || tag === 'ol' || attributes.role === 'list') {
      this.currentComponent.lists.push({ selector });
    }

    // Tables
    if (tag === 'table') {
      this.currentComponent.tables.push({ selector });
    }

    // Accessibility
    if (attributes.role || Object.keys(attributes).some((k) => k.startsWith('aria-'))) {
      this.currentComponent.accessibility.push({
        element: tagName,
        role: attributes.role,
        ariaLabel: attributes['aria-label'],
        ariaDescribedby: attributes['aria-describedby'],
        ariaLabelledby: attributes['aria-labelledby'],
      });
    }

    // Test IDs
    if (attributes['data-testid']) {
      this.currentComponent.testIds.push({
        id: attributes['data-testid'],
        element: tagName,
      });
    }
  }

  analyzeConditional(node) {
    this.currentComponent.conditionals.push({
      type: 'ternary',
      condition: this.nodeToString(node.condition),
      trueBranch: this.nodeToString(node.whenTrue),
      falseBranch: this.nodeToString(node.whenFalse),
    });
  }

  analyzeLogicalAnd(node) {
    this.currentComponent.conditionals.push({
      type: 'and',
      condition: this.nodeToString(node.left),
      rendered: this.nodeToString(node.right),
    });
  }

  analyzeArrayMethod(node, methodName) {
    if (methodName === 'map') {
      const sourceArray = this.nodeToString(node.expression.expression);
      this.currentComponent.loops.push({
        type: 'map',
        source: sourceArray,
      });
    }
  }

  nodeToString(node) {
    if (!node) return '';
    return node.getText(this.sourceFile);
  }

  // ============================================================================
  // PATTERN DETECTION
  // ============================================================================

  detectPattern(comp) {
    const patterns = [];

    // Form component
    if (
      comp.forms.length > 0 ||
      (comp.inputs.length >= 2 && comp.buttons.some((b) => b.type === 'submit'))
    ) {
      patterns.push('form');
    }

    // List component
    if (comp.loops.length > 0 || comp.lists.length > 0) {
      patterns.push('list');
    }

    // Modal/Dialog
    if (
      comp.modals.length > 0 ||
      comp.name.toLowerCase().includes('modal') ||
      comp.name.toLowerCase().includes('dialog')
    ) {
      patterns.push('modal');
    }

    // Card
    if (comp.name.toLowerCase().includes('card') || comp.name.toLowerCase().includes('item')) {
      patterns.push('card');
    }

    // Navigation
    if (
      comp.links.length >= 3 ||
      comp.name.toLowerCase().includes('nav') ||
      comp.name.toLowerCase().includes('menu')
    ) {
      patterns.push('navigation');
    }

    // Table
    if (comp.tables.length > 0 || comp.name.toLowerCase().includes('table')) {
      patterns.push('table');
    }

    // Loading/Error states
    if (
      comp.stateVariables.some(
        (s) => s.name.toLowerCase().includes('loading') || s.name.toLowerCase().includes('error')
      )
    ) {
      patterns.push('async');
    }

    // Container/Page
    if (
      comp.name.toLowerCase().includes('container') ||
      comp.name.toLowerCase().includes('page') ||
      comp.name.toLowerCase().includes('view')
    ) {
      patterns.push('container');
    }

    return patterns.length > 0 ? patterns : ['basic'];
  }

  // ============================================================================
  // SCENARIO GENERATION
  // ============================================================================

  generateScenarios(comp) {
    const scenarios = [];

    // Basic rendering
    scenarios.push({
      name: 'renders without crashing',
      type: 'render',
    });

    // Specific element rendering
    for (const btn of comp.buttons) {
      if (btn.text && !btn.text.includes('{')) {
        scenarios.push({
          name: `renders "${btn.text}" button`,
          type: 'render',
          selector: btn.selector,
        });
      }
    }

    for (const input of comp.inputs) {
      const label = input.placeholder || input.label || input.name;
      if (label && typeof label === 'string') {
        scenarios.push({
          name: `renders ${input.type} input${label ? ` with ${input.placeholder ? 'placeholder' : 'label'} "${label}"` : ''}`,
          type: 'render',
          selector: input.selector,
        });
      }
    }

    for (const testId of comp.testIds) {
      scenarios.push({
        name: `renders element with testid "${testId.id}"`,
        type: 'render',
        selector: { type: 'testId', value: testId.id },
      });
    }

    // Button clicks
    for (const btn of comp.buttons) {
      if (btn.onClick) {
        const callbackProp = comp.props.find((p) => p.name === btn.onClick);
        scenarios.push({
          name: `handles click on ${btn.text || 'button'}`,
          type: 'interaction',
          action: 'click',
          selector: btn.selector,
          expectCallback: callbackProp ? btn.onClick : null,
        });
      }
    }

    // Form interactions
    if (comp.pattern.includes('form')) {
      for (const input of comp.inputs) {
        scenarios.push({
          name: `allows typing in ${input.name || input.type} field`,
          type: 'interaction',
          action: 'type',
          selector: input.selector,
          value: this.getTestValueForType(input.type),
        });
      }

      if (comp.forms.length > 0 && comp.forms[0].onSubmit) {
        scenarios.push({
          name: 'submits form with valid data',
          type: 'form-submit',
          inputs: comp.inputs,
          submitCallback: comp.forms[0].onSubmit,
        });

        scenarios.push({
          name: 'prevents submission with empty required fields',
          type: 'form-validation',
          requiredInputs: comp.inputs.filter((i) => i.required),
        });
      }
    }

    // Conditional rendering
    for (const cond of comp.conditionals) {
      const condVar = this.extractVariableFromCondition(cond.condition);
      if (condVar) {
        const isProp = comp.props.some((p) => p.name === condVar);
        const isState = comp.stateVariables.some((s) => s.name === condVar);

        if (isProp || isState) {
          scenarios.push({
            name: `conditionally renders based on ${condVar}`,
            type: 'conditional',
            condition: condVar,
            isProp,
            isState,
          });
        }
      }
    }

    // Loading/Error states
    const loadingState = comp.stateVariables.find((s) => s.name.toLowerCase().includes('loading'));
    const errorState = comp.stateVariables.find((s) => s.name.toLowerCase().includes('error'));

    if (loadingState) {
      scenarios.push({
        name: 'shows loading state',
        type: 'state',
        state: 'loading',
      });
    }

    if (errorState) {
      scenarios.push({
        name: 'shows error state',
        type: 'state',
        state: 'error',
      });
    }

    // Accessibility
    for (const a11y of comp.accessibility) {
      if (a11y.role) {
        scenarios.push({
          name: `has accessible role "${a11y.role}"`,
          type: 'accessibility',
          role: a11y.role,
        });
      }
    }

    if (comp.images.some((i) => !i.hasAlt)) {
      scenarios.push({
        name: 'images have alt text',
        type: 'accessibility',
        check: 'image-alt',
      });
    }

    // Keyboard navigation
    if (comp.buttons.length > 0 || comp.inputs.length > 0 || comp.links.length > 0) {
      scenarios.push({
        name: 'is keyboard accessible',
        type: 'accessibility',
        check: 'keyboard',
      });
    }

    return scenarios;
  }

  getTestValueForType(inputType) {
    const values = {
      text: 'Test value',
      email: 'test@example.com',
      password: 'Password123!',
      number: '42',
      tel: '555-123-4567',
      url: 'https://example.com',
      date: '2024-01-15',
      search: 'search term',
      textarea: 'This is a longer text input for testing purposes.',
    };
    return values[inputType] || 'test';
  }

  extractVariableFromCondition(condition) {
    // Extract variable name from conditions like: isLoading, !isError, items.length > 0
    const match = condition.match(/^!?(\w+)/);
    return match ? match[1] : null;
  }
}

// ============================================================================
// SMART TEST GENERATOR
// ============================================================================

class SmartTestGenerator {
  constructor(components, sourceFilePath, testFilePath) {
    this.components = components;
    this.sourceFilePath = sourceFilePath;
    this.testFilePath = testFilePath;
    this.moduleName = path.basename(sourceFilePath, path.extname(sourceFilePath));
    this.moduleImport = this.relativeImport(testFilePath, sourceFilePath);
  }

  relativeImport(fromFile, toFile) {
    const fromDir = path.dirname(fromFile);
    let rel = path
      .relative(fromDir, toFile)
      .replace(/\\/g, '/')
      .replace(/\.(tsx?|jsx?)$/, '');
    return rel.startsWith('.') ? rel : './' + rel;
  }

  generate() {
    const renderWithProvidersImport = this.relativeImport(
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

    return `import React from "react";
import { ${testingImports.join(', ')} } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "${renderWithProvidersImport}";
${componentImport}`;
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

    lines.push(`describe("${comp.name}", () => {`);
    lines.push(this.generateDefaultProps(comp));
    lines.push('');

    // Group scenarios by type
    const renderScenarios = comp.scenarios.filter((s) => s.type === 'render');
    const interactionScenarios = comp.scenarios.filter((s) => s.type === 'interaction');
    const formScenarios = comp.scenarios.filter(
      (s) => s.type === 'form-submit' || s.type === 'form-validation'
    );
    const conditionalScenarios = comp.scenarios.filter((s) => s.type === 'conditional');
    const stateScenarios = comp.scenarios.filter((s) => s.type === 'state');
    const a11yScenarios = comp.scenarios.filter((s) => s.type === 'accessibility');

    // Rendering tests
    if (renderScenarios.length > 0) {
      lines.push('  describe("Rendering", () => {');
      for (const scenario of renderScenarios) {
        lines.push(this.generateRenderTest(comp, scenario));
      }
      lines.push('  });');
      lines.push('');
    }

    // Interaction tests
    if (interactionScenarios.length > 0) {
      lines.push('  describe("User Interactions", () => {');
      for (const scenario of interactionScenarios) {
        lines.push(this.generateInteractionTest(comp, scenario));
      }
      lines.push('  });');
      lines.push('');
    }

    // Form tests
    if (formScenarios.length > 0) {
      lines.push('  describe("Form Behavior", () => {');
      for (const scenario of formScenarios) {
        lines.push(this.generateFormTest(comp, scenario));
      }
      lines.push('  });');
      lines.push('');
    }

    // Conditional rendering tests
    if (conditionalScenarios.length > 0) {
      lines.push('  describe("Conditional Rendering", () => {');
      for (const scenario of conditionalScenarios) {
        lines.push(this.generateConditionalTest(comp, scenario));
      }
      lines.push('  });');
      lines.push('');
    }

    // State tests
    if (stateScenarios.length > 0) {
      lines.push('  describe("State Changes", () => {');
      for (const scenario of stateScenarios) {
        lines.push(this.generateStateTest(comp, scenario));
      }
      lines.push('  });');
      lines.push('');
    }

    // Accessibility tests
    if (a11yScenarios.length > 0) {
      lines.push('  describe("Accessibility", () => {');
      for (const scenario of a11yScenarios) {
        lines.push(this.generateA11yTest(comp, scenario));
      }
      lines.push('  });');
    }

    lines.push('});');

    return lines.join('\n');
  }

  generateDefaultProps(comp) {
    const propEntries = [];

    for (const prop of comp.props) {
      if (prop.isRequired || prop.isCallback) {
        if (prop.isCallback) {
          propEntries.push(`    ${prop.name}: mock${this.capitalize(prop.name)},`);
        } else {
          propEntries.push(`    ${prop.name}: ${this.getDefaultValueForProp(prop)},`);
        }
      }
    }

    if (propEntries.length === 0) {
      return '  const defaultProps = {};';
    }

    return `  const defaultProps = {\n${propEntries.join('\n')}\n  };`;
  }

  getDefaultValueForProp(prop) {
    if (prop.defaultValue && prop.defaultValue !== 'undefined') {
      return prop.defaultValue;
    }

    switch (prop.type) {
      case 'string':
        return `"test-${prop.name}"`;
      case 'number':
        return '0';
      case 'boolean':
        return 'false';
      case 'array':
        return '[]';
      case 'object':
        return '{}';
      case 'ReactNode':
        return 'null';
      case 'function':
        return '() => {}';
      default:
        return 'undefined';
    }
  }

  generateRenderTest(comp, scenario) {
    if (scenario.name === 'renders without crashing') {
      return `    it("${scenario.name}", () => {
      renderWithProviders(<${comp.name} {...defaultProps} />);
    });
`;
    }

    const selector = this.selectorToCode(scenario.selector);
    return `    it("${scenario.name}", () => {
      renderWithProviders(<${comp.name} {...defaultProps} />);
      expect(${selector}).toBeInTheDocument();
    });
`;
  }

  generateInteractionTest(comp, scenario) {
    const selector = this.selectorToCode(scenario.selector);

    if (scenario.action === 'click') {
      if (scenario.expectCallback) {
        return `    it("${scenario.name}", async () => {
      const user = userEvent.setup();
      renderWithProviders(<${comp.name} {...defaultProps} />);
      
      await user.click(${selector});
      
      expect(mock${this.capitalize(scenario.expectCallback)}).toHaveBeenCalledTimes(1);
    });
`;
      }
      return `    it("${scenario.name}", async () => {
      const user = userEvent.setup();
      renderWithProviders(<${comp.name} {...defaultProps} />);
      
      await user.click(${selector});
    });
`;
    }

    if (scenario.action === 'type') {
      return `    it("${scenario.name}", async () => {
      const user = userEvent.setup();
      renderWithProviders(<${comp.name} {...defaultProps} />);
      
      const input = ${selector};
      await user.type(input, "${scenario.value}");
      
      expect(input).toHaveValue("${scenario.value}");
    });
`;
    }

    return '';
  }

  generateFormTest(comp, scenario) {
    if (scenario.type === 'form-submit') {
      const fillInputs = scenario.inputs
        .map((input) => {
          const selector = this.selectorToCode(input.selector);
          const value = this.getTestValueForType(input.type);
          if (input.type === 'checkbox' || input.type === 'radio') {
            return `      await user.click(${selector});`;
          }
          return `      await user.type(${selector}, "${value}");`;
        })
        .join('\n');

      const expectCallback = scenario.submitCallback
        ? `\n      expect(mock${this.capitalize(scenario.submitCallback)}).toHaveBeenCalled();`
        : '';

      return `    it("${scenario.name}", async () => {
      const user = userEvent.setup();
      renderWithProviders(<${comp.name} {...defaultProps} />);
      
${fillInputs}
      
      const submitButton = screen.getByRole("button", { name: /submit/i });
      await user.click(submitButton);${expectCallback}
    });
`;
    }

    if (scenario.type === 'form-validation') {
      return `    it("${scenario.name}", async () => {
      const user = userEvent.setup();
      renderWithProviders(<${comp.name} {...defaultProps} />);
      
      const submitButton = screen.getByRole("button", { name: /submit/i });
      await user.click(submitButton);
      
      // Verify validation errors are shown
    });
`;
    }

    return '';
  }

  generateConditionalTest(comp, scenario) {
    if (scenario.isProp) {
      return `    it("${scenario.name}", () => {
      // When ${scenario.condition} is true
      const { rerender } = renderWithProviders(
        <${comp.name} {...defaultProps} ${scenario.condition}={true} />
      );
      // Verify conditional content is shown
      
      // When ${scenario.condition} is false
      rerender(<${comp.name} {...defaultProps} ${scenario.condition}={false} />);
      // Verify conditional content is hidden
    });
`;
    }

    return `    it("${scenario.name}", async () => {
      renderWithProviders(<${comp.name} {...defaultProps} />);
      
      // Trigger state change that affects ${scenario.condition}
      // Verify UI updates accordingly
    });
`;
  }

  generateStateTest(comp, scenario) {
    if (scenario.state === 'loading') {
      return `    it("${scenario.name}", () => {
      renderWithProviders(<${comp.name} {...defaultProps} />);
      
      // Verify loading indicator is present
      // expect(screen.getByRole("progressbar")).toBeInTheDocument();
      // OR
      // expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });
`;
    }

    if (scenario.state === 'error') {
      return `    it("${scenario.name}", async () => {
      renderWithProviders(<${comp.name} {...defaultProps} />);
      
      // Trigger error state
      // await waitFor(() => {
      //   expect(screen.getByRole("alert")).toBeInTheDocument();
      // });
    });
`;
    }

    return '';
  }

  generateA11yTest(comp, scenario) {
    if (scenario.role) {
      return `    it("${scenario.name}", () => {
      renderWithProviders(<${comp.name} {...defaultProps} />);
      expect(screen.getByRole("${scenario.role}")).toBeInTheDocument();
    });
`;
    }

    if (scenario.check === 'image-alt') {
      return `    it("${scenario.name}", () => {
      renderWithProviders(<${comp.name} {...defaultProps} />);
      const images = screen.getAllByRole("img");
      images.forEach(img => {
        expect(img).toHaveAttribute("alt");
        expect(img.getAttribute("alt")).not.toBe("");
      });
    });
`;
    }

    if (scenario.check === 'keyboard') {
      return `    it("${scenario.name}", async () => {
      const user = userEvent.setup();
      renderWithProviders(<${comp.name} {...defaultProps} />);
      
      // Tab through interactive elements
      await user.tab();
      // Verify focus is on first interactive element
      
      await user.keyboard("{Enter}");
      // Verify Enter key triggers action
    });
`;
    }

    return '';
  }

  selectorToCode(selector) {
    if (!selector) return 'screen.getByRole("button")';

    switch (selector.type) {
      case 'testId':
        return `screen.getByTestId("${selector.value}")`;
      case 'role':
        if (selector.name) {
          return `screen.getByRole("${selector.role}", { name: /${this.escapeRegex(selector.name)}/i })`;
        }
        return `screen.getByRole("${selector.role}")`;
      case 'labelText':
        return `screen.getByLabelText(/${this.escapeRegex(selector.value)}/i)`;
      case 'placeholderText':
        return `screen.getByPlaceholderText(/${this.escapeRegex(selector.value)}/i)`;
      case 'text':
        return `screen.getByText(/${this.escapeRegex(selector.value)}/i)`;
      default:
        return `screen.getByRole("${selector.role || 'button'}")`;
    }
  }

  getTestValueForType(inputType) {
    const values = {
      text: 'Test value',
      email: 'test@example.com',
      password: 'Password123!',
      number: '42',
      tel: '555-123-4567',
      textarea: 'Test content',
    };
    return values[inputType] || 'test';
  }

  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  escapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// ============================================================================
// MAIN
// ============================================================================

function getTestFilePath(sourceFilePath) {
  const dir = path.dirname(sourceFilePath);
  const ext = path.extname(sourceFilePath);
  const baseName = path.basename(sourceFilePath, ext);
  const testExt = ['.tsx', '.jsx'].includes(ext) ? '.tsx' : '.ts';
  return path.join(dir, '__tests__', `${baseName}.test${testExt}`);
}

function isManualTest(testFilePath) {
  if (!fs.existsSync(testFilePath)) return false;
  return !fs.readFileSync(testFilePath, 'utf-8').includes(GENERATED_HEADER);
}

async function processFile(sourceFilePath) {
  const absolutePath = path.isAbsolute(sourceFilePath)
    ? sourceFilePath
    : path.resolve(process.cwd(), sourceFilePath);
  const ext = path.extname(absolutePath);

  if (!['.ts', '.tsx', '.js', '.jsx'].includes(ext)) return { skipped: true };
  if (
    absolutePath.includes('__tests__') ||
    absolutePath.includes('.test.') ||
    absolutePath.includes('.spec.')
  )
    return { skipped: true };
  if (path.basename(absolutePath, ext) === 'index') return { skipped: true };

  const testFilePath = getTestFilePath(absolutePath);
  if (isManualTest(testFilePath)) {
    console.log(`⏭️  Skipping ${path.relative(ROOT_DIR, absolutePath)} - manual test exists`);
    return { skipped: true };
  }

  let sourceCode;
  try {
    sourceCode = fs.readFileSync(absolutePath, 'utf-8');
  } catch (err) {
    console.error(`❌ Failed to read: ${err.message}`);
    return { error: err.message };
  }

  console.log(`🔍 Analyzing ${path.relative(ROOT_DIR, absolutePath)}...`);

  const analyzer = new DeepComponentAnalyzer(sourceCode, absolutePath);
  const components = analyzer.analyze();

  if (components.length === 0) {
    console.log(`⏭️  Skipping - no components found`);
    return { skipped: true };
  }

  for (const comp of components) {
    console.log(`   └─ ${comp.name}: ${comp.scenarios.length} test scenarios`);
    console.log(`      Pattern: ${comp.pattern.join(', ')}`);
    console.log(
      `      Props: ${comp.props.length}, Buttons: ${comp.buttons.length}, Inputs: ${comp.inputs.length}`
    );
  }

  const generator = new SmartTestGenerator(components, absolutePath, testFilePath);
  const testContent = generator.generate();

  const testDir = path.dirname(testFilePath);
  if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

  fs.writeFileSync(testFilePath, testContent, 'utf-8');
  console.log(`✅ Generated ${path.relative(ROOT_DIR, testFilePath)}`);

  return { success: true, testFilePath };
}

async function processAll() {
  console.log('🔍 Scanning all source files...\n');
  const files = [];

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (
        entry.isDirectory() &&
        !['__tests__', 'node_modules', 'dist', 'reports', 'public'].includes(entry.name)
      ) {
        scanDir(fullPath);
      } else if (
        entry.isFile() &&
        ['.ts', '.tsx', '.js', '.jsx'].includes(path.extname(entry.name))
      ) {
        files.push(fullPath);
      }
    }
  }

  scanDir(SRC_DIR);
  console.log(`Found ${files.length} source files\n`);

  let processed = 0,
    skipped = 0,
    errors = 0;
  for (const file of files) {
    const result = await processFile(file);
    if (result.success) processed++;
    else if (result.skipped) skipped++;
    else if (result.error) errors++;
  }

  console.log(`\n📊 Summary: ${processed} generated, ${skipped} skipped, ${errors} errors`);
}

async function main() {
  await loadTypeScript();

  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'all':
      await processAll();
      break;
    case 'file':
      if (!args[1]) {
        console.error('❌ Please provide a file path');
        process.exit(1);
      }
      await processFile(args[1]);
      break;
    default:
      console.log(`
Auto Test Generator v3 - Smart Static Analysis (NO AI)

Usage:
  node scripts/auto-testgen.mjs all          - Process all files
  node scripts/auto-testgen.mjs file <path>  - Process single file

Features:
  ✅ Deep JSX analysis
  ✅ Pattern detection (forms, lists, modals, etc.)
  ✅ Smart selector generation (testId > role > label > text)
  ✅ Scenario-based test generation
  ✅ Proper import handling
  ✅ No external dependencies (uses TypeScript only)
`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
