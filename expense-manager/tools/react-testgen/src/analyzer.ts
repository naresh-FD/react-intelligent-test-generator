import {
    Node,
    Project,
    SourceFile,
    SyntaxKind,
    TypeChecker,
    JsxAttribute,
} from 'ts-morph';

export interface PropInfo {
    name: string;
    type: string;
    isRequired: boolean;
    isCallback: boolean;
    isBoolean: boolean;
}

export interface SelectorInfo {
    strategy: 'testid' | 'label' | 'text' | 'placeholder' | 'role';
    value: string;
    role?: string;
}

export interface ComponentInfo {
    name: string;
    exportType: 'default' | 'named';
    props: PropInfo[];
    buttons: SelectorInfo[];
    inputs: SelectorInfo[];
}

export function analyzeSourceFile(
    sourceFile: SourceFile,
    project: Project,
    checker: TypeChecker
): ComponentInfo[] {
    const components: ComponentInfo[] = [];

    const exported = sourceFile.getExportedDeclarations();
    const defaultExportName = getDefaultExportName(sourceFile);

    const candidates = getComponentCandidates(sourceFile);

    for (const candidate of candidates) {
        const name = getCandidateName(candidate);
        if (!name) continue;

        const exportType = name === defaultExportName
            ? 'default'
            : exported.has(name)
                ? 'named'
                : null;

        if (!exportType) continue;

        const props = extractProps(candidate, checker);
        const jsxNodes: Node[] = [
            ...candidate.getDescendantsOfKind(SyntaxKind.JsxElement),
            ...candidate.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
        ];

        const { buttons, inputs } = analyzeJsxNodes(jsxNodes);

        components.push({
            name,
            exportType,
            props,
            buttons,
            inputs,
        });
    }

    return components;
}

function getDefaultExportName(sourceFile: SourceFile): string | null {
    const exportAssignments = sourceFile.getExportAssignments();
    for (const assignment of exportAssignments) {
        if (assignment.isExportEquals()) continue;
        const expr = assignment.getExpression();
        if (Node.isIdentifier(expr)) return expr.getText();
    }
    return null;
}

function getComponentCandidates(sourceFile: SourceFile): Node[] {
    const candidates: Node[] = [];

    for (const func of sourceFile.getFunctions()) {
        if (isComponentName(func.getName())) {
            if (hasJsx(func)) candidates.push(func);
        }
    }

    for (const variable of sourceFile.getVariableDeclarations()) {
        const name = variable.getName();
        if (!isComponentName(name)) continue;
        const initializer = variable.getInitializer();
        if (!initializer) continue;
        if (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)) {
            if (hasJsx(initializer)) candidates.push(variable);
        }
    }

    return candidates;
}

function getCandidateName(candidate: Node): string | undefined {
    if (Node.isFunctionDeclaration(candidate)) return candidate.getName();
    if (Node.isVariableDeclaration(candidate)) return candidate.getName();
    return undefined;
}

function isComponentName(name?: string): boolean {
    return !!name && /^[A-Z]/.test(name);
}

function hasJsx(node: Node): boolean {
    return (
        node.getDescendantsOfKind(SyntaxKind.JsxElement).length > 0 ||
        node.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).length > 0
    );
}

function extractProps(candidate: Node, checker: TypeChecker): PropInfo[] {
    const params = Node.isFunctionDeclaration(candidate)
        ? candidate.getParameters()
        : Node.isVariableDeclaration(candidate)
            ? (() => {
                const initializer = candidate.getInitializer();
                if (initializer && Node.isArrowFunction(initializer)) {
                    return initializer.getParameters();
                }
                if (initializer && Node.isFunctionExpression(initializer)) {
                    return initializer.getParameters();
                }
                return [];
            })()
            : [];

    if (params.length === 0) return [];

    const param = params[0];
    const props: PropInfo[] = [];

    const type = checker.getTypeAtLocation(param);
    const properties = type.getProperties();

    for (const prop of properties) {
        const declarations = prop.getDeclarations();
        const declaration = declarations.length > 0 ? declarations[0] : null;
        const propType = checker.getTypeOfSymbolAtLocation(prop, declaration ?? param);
        const typeText = checker.getTypeText(propType, declaration ?? param);

        const isOptional = declaration
            ? Node.isPropertySignature(declaration)
                ? declaration.hasQuestionToken()
                : false
            : typeText.includes('undefined');

        const name = prop.getName();
        props.push({
            name,
            type: typeText,
            isRequired: !isOptional,
            isCallback: typeText.includes('=>') || /^on[A-Z]/.test(name),
            isBoolean: typeText === 'boolean',
        });
    }

    return props;
}

function analyzeJsxNodes(nodes: Node[]): { buttons: SelectorInfo[]; inputs: SelectorInfo[] } {
    const buttons: SelectorInfo[] = [];
    const inputs: SelectorInfo[] = [];

    for (const node of nodes) {
        if (isConditionalNode(node)) continue;
        const tagName = getTagName(node);
        if (!tagName) continue;

        const isIntrinsic = tagName.toLowerCase() === tagName;
        const lowerTag = tagName.toLowerCase();

        const attrs = getAttributes(node);
        const text = getTextContent(node);

        const dataTestId = normalizeAttr(attrs['data-testid'] || attrs['dataTestId']);
        const ariaLabel = normalizeAttr(attrs['aria-label']);
        const placeholder = normalizeAttr(attrs['placeholder']);
        const role = normalizeAttr(attrs['role']);

        if ((isIntrinsic && lowerTag === 'button') || role === 'button') {
            if (dataTestId) {
                buttons.push({ strategy: 'testid', value: dataTestId });
            } else if (ariaLabel) {
                buttons.push({ strategy: 'label', value: ariaLabel });
            } else if (text) {
                buttons.push({ strategy: 'text', value: text });
            } else {
                buttons.push({ strategy: 'role', value: 'button', role: 'button' });
            }
        }

        if (isIntrinsic && (lowerTag === 'input' || lowerTag === 'textarea' || lowerTag === 'select')) {
            if (dataTestId) {
                inputs.push({ strategy: 'testid', value: dataTestId });
            } else if (ariaLabel) {
                inputs.push({ strategy: 'label', value: ariaLabel });
            } else if (placeholder) {
                inputs.push({ strategy: 'placeholder', value: placeholder });
            } else {
                inputs.push({ strategy: 'role', value: 'textbox', role: 'textbox' });
            }
        }
    }

    return { buttons, inputs };
}

function getTagName(node: Node): string | null {
    if (Node.isJsxElement(node)) {
        return node.getOpeningElement().getTagNameNode().getText();
    }
    if (Node.isJsxSelfClosingElement(node)) {
        return node.getTagNameNode().getText();
    }
    return null;
}

function getAttributes(node: Node): Record<string, string> {
    const attrs: Record<string, string> = {};
    const attributeNodes = Node.isJsxElement(node)
        ? node.getOpeningElement().getAttributes()
        : Node.isJsxSelfClosingElement(node)
            ? node.getAttributes()
            : [];

    for (const attr of attributeNodes) {
        if (Node.isJsxAttribute(attr)) {
            const name = attr.getNameNode().getText();
            attrs[name] = getAttributeValue(attr);
        }
    }

    return attrs;
}

function getAttributeValue(attr: JsxAttribute): string {
    const initializer = attr.getInitializer();
    if (!initializer) return 'true';

    if (Node.isStringLiteral(initializer)) return initializer.getLiteralText();

    if (Node.isJsxExpression(initializer)) {
        const expr = initializer.getExpression();
        if (!expr) return 'true';
        if (Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) {
            return expr.getLiteralText();
        }
        return '';
    }

    return initializer.getText();
}

function getTextContent(node: Node): string {
    if (!Node.isJsxElement(node)) return '';

    const texts = node.getChildrenOfKind(SyntaxKind.JsxText)
        .map((t) => t.getText().trim())
        .filter((t) => t.length > 0);

    if (texts.length > 0) return texts.join(' ');

    const exprs = node.getChildrenOfKind(SyntaxKind.JsxExpression)
        .map((expr) => expr.getExpression())
        .filter((expr) => !!expr)
        .map((expr) => (expr && Node.isStringLiteral(expr) ? expr.getLiteralText() : ''))
        .filter((t) => t.length > 0);

    return exprs.join(' ');
}

function normalizeAttr(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function isConditionalNode(node: Node): boolean {
    let current: Node | undefined = node;
    while (current) {
        const parent = current.getParent();
        if (!parent) break;

        if (Node.isConditionalExpression(parent)) return true;
        if (Node.isBinaryExpression(parent) && parent.getOperatorToken().getKind() === SyntaxKind.AmpersandAmpersandToken) {
            return true;
        }
        if (Node.isJsxExpression(parent)) {
            const expr = parent.getExpression();
            if (expr && Node.isConditionalExpression(expr)) return true;
            if (expr && Node.isBinaryExpression(expr) && expr.getOperatorToken().getKind() === SyntaxKind.AmpersandAmpersandToken) {
                return true;
            }
        }

        current = parent;
    }
    return false;
}
