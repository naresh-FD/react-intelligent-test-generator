import fs from 'node:fs';
import path from 'node:path';
import { Node, Project, SourceFile, SyntaxKind, TypeChecker, JsxAttribute, JsxAttributeLike, ParameterDeclaration } from 'ts-morph';
import { CONTEXT_DETECTION_CONFIG } from './config';

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

export interface ConditionalElementInfo {
  selector: SelectorInfo;
  requiredProps: string[];
}

export interface HookUsage {
  name: string;
  importSource?: string;
}

export interface ContextUsage {
  /** Name of the React context object (e.g., "AuthContext") */
  contextName: string;
  /** Import path for the context (e.g., "@/contexts/AuthContext") */
  importPath?: string;
  /** The custom hook name that wraps this context (e.g., "useAuth") */
  hookName?: string;
  /** Import path for the hook if different from context import */
  hookImportPath?: string;
  /** Properties destructured from the context value */
  consumedKeys: string[];
  /** Whether usage is guarded (try/catch, optional chaining, null check) */
  isOptional: boolean;
  /** The provider component name (e.g., "AuthProvider") */
  providerName?: string;
  /** Import path for the provider */
  providerImportPath?: string;

  // Backward compat aliases
  /** @deprecated Use contextName */
  name: string;
  /** @deprecated Use importPath */
  importSource?: string;
}

export interface FormElementInfo {
  tag: 'select' | 'form' | 'textarea';
  selector: SelectorInfo;
  options?: string[]; // for select elements
}

export type PreferredQueryStyle = 'role-first' | 'text-first';
export type PreferredTimingStyle = 'async-first' | 'sync-first';
export type PreferredRenderStyle = 'provider-wrapped-render' | 'direct-render';
export type PreferredInteractionStyle = 'event-heavy' | 'basic';
export type ProviderSignal = 'router' | 'context' | 'react-query' | 'redux' | 'portal';

export interface TestingPreferenceProfile {
  queryStyle: PreferredQueryStyle;
  timingStyle: PreferredTimingStyle;
  renderStyle: PreferredRenderStyle;
  interactionStyle: PreferredInteractionStyle;
}

export interface ComponentTraitProfile {
  usesRouter: boolean;
  usesNavigation: boolean;
  usesContext: boolean;
  usesAsyncData: boolean;
  usesRedux: boolean;
  usesReactQuery: boolean;
  usesForms: boolean;
  usesTabs: boolean;
  usesModalDialog: boolean;
  usesTableOrList: boolean;
  usesPortal: boolean;
  hasConditionalRenderingBranches: boolean;
  providerSignals: ProviderSignal[];
  contextCount: number;
  hookCount: number;
  conditionalBranchCount: number;
  testing: TestingPreferenceProfile;
}

export interface ComponentInfo {
  name: string;
  exportType: 'default' | 'named';
  props: PropInfo[];
  buttons: SelectorInfo[];
  inputs: SelectorInfo[];
  selects: FormElementInfo[];
  forms: FormElementInfo[];
  conditionalElements: ConditionalElementInfo[];
  usesRouter: boolean;
  usesAuthHook: boolean;
  hooks: HookUsage[];
  contexts: ContextUsage[];
  usesUseEffect: boolean;
  usesUseState: boolean;
  hasForwardRef: boolean;
  usesNavigation: boolean;
  links: SelectorInfo[];
  /** True when this is a React Error Boundary (class component with componentDidCatch) */
  isErrorBoundary: boolean;
  /** True when this is a class component */
  isClassComponent: boolean;
  /** True when component uses React Query hooks (useQuery, useMutation, etc.) */
  usesReactQuery: boolean;
  /** True when component uses Redux hooks (useSelector, useDispatch) */
  usesRedux: boolean;
  /** True when component uses framer-motion */
  usesFramerMotion: boolean;
  /** True when component uses Recharts */
  usesRecharts: boolean;
  /** True when component uses react-hook-form */
  usesReactHookForm: boolean;
  /** True when component uses createPortal */
  usesPortal: boolean;
  /** True when component has async useEffect (fetch, .then, async) */
  hasAsyncEffect: boolean;
  /** Third-party library imports detected (for module mocking) */
  thirdPartyImports: string[];
  /** Service/API module imports that need mocking */
  serviceImports: string[];
  /** Structured trait metadata for smarter generation and self-heal decisions */
  traits: ComponentTraitProfile;
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

    let exportType: 'default' | 'named' | null = null;
    if (name === defaultExportName) {
      exportType = 'default';
    } else if (exported.has(name)) {
      exportType = 'named';
    }

    if (!exportType) continue;

    const props = extractProps(candidate, checker);
    const jsxNodes: Node[] = [
      ...candidate.getDescendantsOfKind(SyntaxKind.JsxElement),
      ...candidate.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
    ];

    const { buttons, inputs, conditionalElements, selects, forms, links } = analyzeJsxNodes(
      jsxNodes,
      props
    );
    const usesRouterJsx = jsxNodes.some((node) => {
      const tagName = getTagName(node);
      return !!tagName && isRouterTag(tagName);
    });
    const usesRouterLink = jsxNodes.some((node) => {
      const tagName = getTagName(node);
      return tagName === 'Link' || tagName === 'NavLink';
    });
    // Also detect react-router hook usage (useLocation, useParams, useSearchParams, etc.)
    const usesRouterHook =
      fileUsesIdentifierCall(sourceFile, 'useLocation') ||
      fileUsesIdentifierCall(sourceFile, 'useParams') ||
      fileUsesIdentifierCall(sourceFile, 'useSearchParams') ||
      fileUsesIdentifierCall(sourceFile, 'useMatch') ||
      fileUsesIdentifierCall(sourceFile, 'useRouteLoaderData');
    const usesAuthHook =
      fileUsesNamedImport(sourceFile, 'useAuth') || fileUsesIdentifierCall(sourceFile, 'useAuth');

    const hooks = detectHooks(candidate, sourceFile);
    const contexts = detectContexts(candidate, sourceFile, project);
    const usesUseEffect = fileUsesIdentifierCall(sourceFile, 'useEffect');
    const usesUseState = fileUsesIdentifierCall(sourceFile, 'useState');
    const hasForwardRef = candidate.getText().includes('forwardRef');
    const usesNavigation =
      fileUsesIdentifierCall(sourceFile, 'useNavigate') ||
      fileUsesIdentifierCall(sourceFile, 'useHistory');
    const usesRouter = usesRouterJsx || usesRouterLink || usesRouterHook || usesNavigation;
    const isClassComponent = Node.isClassDeclaration(candidate);
    const isErrorBoundary =
      isClassComponent &&
      (candidate.getText().includes('componentDidCatch') ||
        candidate.getText().includes('getDerivedStateFromError'));

    // Detect third-party library usage for auto-mocking
    const reactQueryHooks = ['useQuery', 'useMutation', 'useQueryClient', 'useInfiniteQuery', 'useSuspenseQuery'];
    const reduxHooks = ['useSelector', 'useDispatch', 'useStore'];
    const usesReactQuery = hooks.some(h =>
      reactQueryHooks.includes(h.name) ||
      (h.importSource != null && (h.importSource.includes('@tanstack/react-query') || h.importSource.includes('react-query')))
    );
    const usesRedux = hooks.some(h =>
      reduxHooks.includes(h.name) ||
      (h.importSource != null && h.importSource.includes('react-redux'))
    );
    const usesFramerMotion = sourceFile.getImportDeclarations().some(d =>
      d.getModuleSpecifierValue() === 'framer-motion'
    );
    const usesRecharts = sourceFile.getImportDeclarations().some(d =>
      d.getModuleSpecifierValue() === 'recharts'
    );
    const usesReactHookForm = hooks.some(h =>
      h.name === 'useForm' && (h.importSource == null || h.importSource.includes('react-hook-form'))
    );
    const candidateText = candidate.getText();
    const usesPortal = candidateText.includes('createPortal');
    const hasAsyncEffect = detectAsyncEffect(candidate);
    const thirdPartyImports = detectThirdPartyImports(sourceFile);
    const serviceImports = detectServiceImports(sourceFile);
    const traits = buildComponentTraitProfile({
      candidate,
      sourceFile,
      jsxNodes,
      buttons,
      inputs,
      selects,
      forms,
      links,
      conditionalElements,
      hooks,
      contexts,
      usesRouter,
      usesNavigation,
      usesReactQuery,
      usesRedux,
      usesPortal,
      usesReactHookForm,
      hasAsyncEffect,
      serviceImports,
    });

    components.push({
      name,
      exportType,
      props,
      buttons,
      inputs,
      selects,
      forms,
      links,
      conditionalElements,
      usesRouter,
      usesAuthHook,
      hooks,
      contexts,
      usesUseEffect,
      usesUseState,
      hasForwardRef,
      usesNavigation,
      isErrorBoundary,
      isClassComponent,
      usesReactQuery,
      usesRedux,
      usesFramerMotion,
      usesRecharts,
      usesReactHookForm,
      usesPortal,
      hasAsyncEffect,
      thirdPartyImports,
      serviceImports,
      traits,
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

  // Class components extending React.Component / PureComponent
  for (const cls of sourceFile.getClasses()) {
    const name = cls.getName();
    if (!isComponentName(name)) continue;
    const extendsClause = cls.getExtends();
    if (!extendsClause) continue;
    const extendsText = extendsClause.getExpression().getText();
    if (
      extendsText === 'Component' ||
      extendsText === 'React.Component' ||
      extendsText === 'PureComponent' ||
      extendsText === 'React.PureComponent'
    ) {
      candidates.push(cls);
    }
  }

  for (const variable of sourceFile.getVariableDeclarations()) {
    const name = variable.getName();
    if (!isComponentName(name)) continue;
    const initializer = variable.getInitializer();
    if (!initializer) continue;

    // Direct arrow function or function expression
    if (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)) {
      if (hasJsx(initializer)) candidates.push(variable);
      continue;
    }

    // React.memo() / memo() / forwardRef() / React.forwardRef() wrapped components
    if (Node.isCallExpression(initializer)) {
      const callee = initializer.getExpression().getText();
      if (
        callee === 'memo' ||
        callee === 'React.memo' ||
        callee === 'forwardRef' ||
        callee === 'React.forwardRef'
      ) {
        const args = initializer.getArguments();
        if (args.length > 0 && hasJsx(args[0])) {
          candidates.push(variable);
          continue;
        }
      }
      // HOC patterns: withRouter(Comp), connect(...)(Comp)
      if (hasJsx(initializer)) {
        candidates.push(variable);
      }
    }
  }

  return candidates;
}

function getCandidateName(candidate: Node): string | undefined {
  if (Node.isFunctionDeclaration(candidate)) return candidate.getName();
  if (Node.isVariableDeclaration(candidate)) return candidate.getName();
  if (Node.isClassDeclaration(candidate)) return candidate.getName() ?? undefined;
  return undefined;
}

function isComponentName(name?: string): boolean {
  return !!name && /^[A-Z]/.test(name);
}

function extractClassComponentProps(cls: Node, checker: TypeChecker): PropInfo[] {
  if (!Node.isClassDeclaration(cls)) return [];
  const extendsClause = cls.getExtends();
  if (!extendsClause) return [];

  const typeArgs = extendsClause.getTypeArguments();
  if (typeArgs.length === 0) return [];

  // The first type argument is the Props type
  const propsTypeNode = typeArgs[0];
  const propsType = checker.getTypeAtLocation(propsTypeNode);
  const props: PropInfo[] = [];

  for (const prop of propsType.getProperties()) {
    const declarations = prop.getDeclarations();
    const declaration = declarations.length > 0 ? declarations[0] : null;
    const propType = checker.getTypeOfSymbolAtLocation(prop, declaration ?? propsTypeNode);
    const typeText = checker.getTypeText(propType, declaration ?? propsTypeNode);
    let isOptional = false;
    if (declaration && Node.isPropertySignature(declaration)) {
      isOptional = declaration.hasQuestionToken();
    } else if (!declaration) {
      isOptional = typeText.includes('undefined');
    }

    const name = prop.getName();
    const isCallbackByName =
      /^(on[A-Z]|handle[A-Z]|set[A-Z]|update[A-Z]|change[A-Z]|toggle[A-Z]|add[A-Z]|remove[A-Z]|delete[A-Z]|clear[A-Z])/.test(name);
    const isCallbackByType = typeText.includes('=>');
    props.push({
      name,
      type: typeText,
      isRequired: !isOptional,
      isCallback: isCallbackByType || isCallbackByName,
      isBoolean: typeText === 'boolean',
    });
  }

  return props;
}

function hasJsx(node: Node): boolean {
  return (
    node.getDescendantsOfKind(SyntaxKind.JsxElement).length > 0 ||
    node.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).length > 0
  );
}

/** Extract parameters from a function/variable component declaration */
function getComponentParameters(candidate: Node): ParameterDeclaration[] {
  if (Node.isFunctionDeclaration(candidate)) {
    return candidate.getParameters();
  }

  if (Node.isVariableDeclaration(candidate)) {
    const initializer = candidate.getInitializer();
    if (initializer && Node.isArrowFunction(initializer)) {
      return initializer.getParameters();
    }
    if (initializer && Node.isFunctionExpression(initializer)) {
      return initializer.getParameters();
    }
    // Handle memo(), React.memo(), forwardRef(), React.forwardRef() wrappers
    if (initializer && Node.isCallExpression(initializer)) {
      const callee = initializer.getExpression().getText();
      if (
        callee === 'memo' ||
        callee === 'React.memo' ||
        callee === 'forwardRef' ||
        callee === 'React.forwardRef'
      ) {
        const args = initializer.getArguments();
        if (args.length > 0) {
          const innerFn = args[0];
          if (Node.isArrowFunction(innerFn)) {
            return innerFn.getParameters();
          }
          if (Node.isFunctionExpression(innerFn)) {
            return innerFn.getParameters();
          }
        }
      }
    }
  }

  return [];
}

function extractProps(candidate: Node, checker: TypeChecker): PropInfo[] {
  // Class components: extract props from the generic type argument of React.Component<Props>
  if (Node.isClassDeclaration(candidate)) {
    return extractClassComponentProps(candidate, checker);
  }

  const params = getComponentParameters(candidate);

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

    let isOptional = false;
    if (declaration && Node.isPropertySignature(declaration)) {
      isOptional = declaration.hasQuestionToken();
    } else if (!declaration) {
      isOptional = typeText.includes('undefined');
    }

    const name = prop.getName();
    const isCallbackByName =
      /^(on[A-Z]|handle[A-Z]|set[A-Z]|update[A-Z]|change[A-Z]|toggle[A-Z]|add[A-Z]|remove[A-Z]|delete[A-Z]|clear[A-Z])/.test(
        name
      );
    const isCallbackByType = typeText.includes('=>');
    props.push({
      name,
      type: typeText,
      isRequired: !isOptional,
      isCallback: isCallbackByType || isCallbackByName,
      isBoolean: typeText === 'boolean',
    });
  }

  return props;
}

function analyzeJsxNodes(
  nodes: Node[],
  props: PropInfo[]
): {
  buttons: SelectorInfo[];
  inputs: SelectorInfo[];
  selects: FormElementInfo[];
  forms: FormElementInfo[];
  links: SelectorInfo[];
  conditionalElements: ConditionalElementInfo[];
} {
  const buttons: SelectorInfo[] = [];
  const inputs: SelectorInfo[] = [];
  const selects: FormElementInfo[] = [];
  const forms: FormElementInfo[] = [];
  const links: SelectorInfo[] = [];
  const conditionalElements: ConditionalElementInfo[] = [];
  const propNames = new Set(props.map((prop) => prop.name));

  for (const node of nodes) {
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

    const conditionalProps = getConditionalProps(node, propNames);
    const isConditional = isConditionalNode(node);
    if (isConditional) {
      const selector = buildElementSelector({ dataTestId, ariaLabel, placeholder, role, text });
      if (selector && conditionalProps.length > 0) {
        conditionalElements.push({
          selector,
          requiredProps: conditionalProps,
        });
      }
      continue;
    }

    const isButton =
      (isIntrinsic && lowerTag === 'button') || role === 'button' || isButtonLikeComponent(tagName);

    if (isButton) {
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

    const isSelect = (isIntrinsic && lowerTag === 'select') || isSelectLikeComponent(tagName);

    if (isSelect) {
      let selector: SelectorInfo;
      if (dataTestId) {
        selector = { strategy: 'testid', value: dataTestId };
      } else if (ariaLabel) {
        selector = { strategy: 'label', value: ariaLabel };
      } else {
        selector = { strategy: 'role', value: 'combobox', role: 'combobox' };
      }
      selects.push({ tag: 'select', selector });
    } else if (
      (isIntrinsic && (lowerTag === 'input' || lowerTag === 'textarea')) ||
      isInputLikeComponent(tagName)
    ) {
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

    if ((isIntrinsic && lowerTag === 'form') || tagName === 'Form') {
      let selector: SelectorInfo;
      if (dataTestId) {
        selector = { strategy: 'testid', value: dataTestId };
      } else if (ariaLabel) {
        selector = { strategy: 'label', value: ariaLabel };
      } else {
        selector = { strategy: 'role', value: 'form', role: 'form' };
      }
      forms.push({ tag: 'form', selector });
    }

    if ((isIntrinsic && lowerTag === 'a') || tagName === 'Link' || tagName === 'NavLink') {
      if (dataTestId) {
        links.push({ strategy: 'testid', value: dataTestId });
      } else if (ariaLabel) {
        links.push({ strategy: 'label', value: ariaLabel });
      } else if (text) {
        links.push({ strategy: 'text', value: text });
      } else {
        links.push({ strategy: 'role', value: 'link', role: 'link' });
      }
    }
  }

  return { buttons, inputs, selects, forms, links, conditionalElements };
}

function buildComponentTraitProfile(params: {
  candidate: Node;
  sourceFile: SourceFile;
  jsxNodes: Node[];
  buttons: SelectorInfo[];
  inputs: SelectorInfo[];
  selects: FormElementInfo[];
  forms: FormElementInfo[];
  links: SelectorInfo[];
  conditionalElements: ConditionalElementInfo[];
  hooks: HookUsage[];
  contexts: ContextUsage[];
  usesRouter: boolean;
  usesNavigation: boolean;
  usesReactQuery: boolean;
  usesRedux: boolean;
  usesPortal: boolean;
  usesReactHookForm: boolean;
  hasAsyncEffect: boolean;
  serviceImports: string[];
}): ComponentTraitProfile {
  const usesContext =
    params.contexts.length > 0 ||
    params.candidate
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .some((call) => call.getExpression().getText() === 'useContext');
  const usesForms =
    params.usesReactHookForm ||
    params.forms.length > 0 ||
    params.inputs.length > 0 ||
    params.selects.length > 0;
  const usesTabs = detectTabs(params.jsxNodes);
  const usesModalDialog = detectModalDialog(params.jsxNodes);
  const usesTableOrList = detectTableOrList(params.jsxNodes);
  const conditionalBranchCount = detectConditionalBranchCount(params.candidate);
  const hasConditionalRenderingBranches =
    conditionalBranchCount > 0 || params.conditionalElements.length > 0;
  const usesAsyncData =
    params.usesReactQuery ||
    params.hasAsyncEffect ||
    detectAsyncDataUsage(params.candidate, params.serviceImports);
  const providerSignals: ProviderSignal[] = [];

  if (params.usesRouter || params.usesNavigation) {
    providerSignals.push('router');
  }
  if (usesContext) {
    providerSignals.push('context');
  }
  if (params.usesReactQuery) {
    providerSignals.push('react-query');
  }
  if (params.usesRedux) {
    providerSignals.push('redux');
  }
  if (params.usesPortal) {
    providerSignals.push('portal');
  }

  const explicitRoles = countExplicitRoles(params.jsxNodes);
  const interactiveCount =
    params.buttons.length +
    params.inputs.length +
    params.selects.length +
    params.links.length +
    params.forms.length;
  const queryStyle: PreferredQueryStyle =
    interactiveCount > 0 || usesTabs || usesModalDialog || usesTableOrList || explicitRoles > 0
      ? 'role-first'
      : 'text-first';
  const timingStyle: PreferredTimingStyle = usesAsyncData ? 'async-first' : 'sync-first';
  const renderStyle: PreferredRenderStyle =
    providerSignals.length > 0 ? 'provider-wrapped-render' : 'direct-render';
  const interactionStyle: PreferredInteractionStyle =
    usesForms || usesTabs || usesModalDialog || params.usesNavigation || interactiveCount >= 2
      ? 'event-heavy'
      : 'basic';

  return {
    usesRouter: params.usesRouter,
    usesNavigation: params.usesNavigation,
    usesContext,
    usesAsyncData,
    usesRedux: params.usesRedux,
    usesReactQuery: params.usesReactQuery,
    usesForms,
    usesTabs,
    usesModalDialog,
    usesTableOrList,
    usesPortal: params.usesPortal,
    hasConditionalRenderingBranches,
    providerSignals,
    contextCount: params.contexts.length,
    hookCount: params.hooks.length,
    conditionalBranchCount,
    testing: {
      queryStyle,
      timingStyle,
      renderStyle,
      interactionStyle,
    },
  };
}

function detectTabs(nodes: Node[]): boolean {
  return nodes.some((node) => {
    const tagName = getTagName(node);
    const role = normalizeAttr(getAttributes(node).role);
    return (
      tagName != null &&
      /^(Tabs|Tab|TabList|TabPanel|TabPanels|TabsList|TabsTrigger|TabsContent)$/i.test(tagName)
    ) || role === 'tab' || role === 'tablist' || role === 'tabpanel';
  });
}

function detectModalDialog(nodes: Node[]): boolean {
  return nodes.some((node) => {
    const tagName = getTagName(node);
    const role = normalizeAttr(getAttributes(node).role);
    return (
      tagName != null &&
      /^(Dialog|DialogContent|Modal|Drawer|Sheet|Popover|AlertDialog|DialogPortal)$/i.test(tagName)
    ) || role === 'dialog' || role === 'alertdialog';
  });
}

function detectTableOrList(nodes: Node[]): boolean {
  return nodes.some((node) => {
    const tagName = getTagName(node);
    if (!tagName) return false;

    const lowerTag = tagName.toLowerCase();
    return (
      ['table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'ul', 'ol', 'li', 'dl', 'dt', 'dd'].includes(lowerTag) ||
      /^(Table|DataTable|TableBody|TableHead|TableRow|TableCell|List|ListItem|VirtualList)$/i.test(tagName)
    );
  });
}

function detectConditionalBranchCount(candidate: Node): number {
  return candidate.getDescendants().filter((descendant) => {
    if (Node.isConditionalExpression(descendant)) {
      return isNodeInsideJsx(descendant);
    }

    return (
      Node.isBinaryExpression(descendant) &&
      descendant.getOperatorToken().getKind() === SyntaxKind.AmpersandAmpersandToken &&
      isNodeInsideJsx(descendant)
    );
  }).length;
}

function detectAsyncDataUsage(candidate: Node, serviceImports: string[]): boolean {
  const networkExpressionPattern = /(?:^|\.)(fetch|get|post|put|patch|delete|request)$/;
  return candidate.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
    const expressionText = call.getExpression().getText();
    if (expressionText === 'fetch' || /^useSWR/.test(expressionText)) {
      return true;
    }

    if (networkExpressionPattern.test(expressionText)) {
      return true;
    }

    if (serviceImports.length > 0 && (expressionText.includes('Service') || expressionText.includes('Client'))) {
      return true;
    }

    return false;
  });
}

function countExplicitRoles(nodes: Node[]): number {
  return nodes.filter((node) => {
    const role = normalizeAttr(getAttributes(node).role);
    return Boolean(role);
  }).length;
}

function isNodeInsideJsx(node: Node): boolean {
  let current: Node | undefined = node;
  while (current) {
    if (
      Node.isJsxExpression(current) ||
      Node.isJsxElement(current) ||
      Node.isJsxSelfClosingElement(current) ||
      Node.isJsxFragment(current)
    ) {
      return true;
    }
    current = current.getParent();
  }
  return false;
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
  let attributeNodes: JsxAttributeLike[] = [];
  if (Node.isJsxElement(node)) {
    attributeNodes = node.getOpeningElement().getAttributes();
  } else if (Node.isJsxSelfClosingElement(node)) {
    attributeNodes = node.getAttributes();
  }

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

  const texts = node
    .getChildrenOfKind(SyntaxKind.JsxText)
    .map((t) => t.getText().trim())
    .filter((t) => t.length > 0);

  if (texts.length > 0) return texts.join(' ');

  const exprs = node
    .getChildrenOfKind(SyntaxKind.JsxExpression)
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

function buildElementSelector(params: {
  dataTestId?: string;
  ariaLabel?: string;
  placeholder?: string;
  role?: string;
  text?: string;
}): SelectorInfo | null {
  if (params.dataTestId) return { strategy: 'testid', value: params.dataTestId };
  if (params.ariaLabel) return { strategy: 'label', value: params.ariaLabel };
  if (params.text) return { strategy: 'text', value: params.text };
  if (params.placeholder) return { strategy: 'placeholder', value: params.placeholder };
  if (params.role) return { strategy: 'role', value: params.role, role: params.role };
  return null;
}

function detectHooks(candidate: Node, sourceFile: SourceFile): HookUsage[] {
  const hooks: HookUsage[] = [];
  const seen = new Set<string>();

  const calls = candidate.getDescendantsOfKind(SyntaxKind.CallExpression);
  for (const call of calls) {
    const expr = call.getExpression();
    const name = expr.getText();
    if (/^use[A-Z]/.test(name) && !seen.has(name)) {
      seen.add(name);
      const importSource = getImportSourceForIdentifier(sourceFile, name);
      hooks.push({ name, importSource });
    }
  }

  return hooks;
}

function detectContexts(
  candidate: Node,
  sourceFile: SourceFile,
  project: Project
): ContextUsage[] {
  const contexts: ContextUsage[] = [];
  const seen = new Set<string>();

  // Strategy 1: Direct useContext() calls within this component
  detectDirectUseContext(candidate, sourceFile, contexts, seen);

  // Strategy 2: Custom hooks that internally call useContext
  detectCustomHookContexts(candidate, sourceFile, project, contexts, seen);

  return contexts;
}

// ---------------------------------------------------------------------------
// Third-party and service import detection
// ---------------------------------------------------------------------------

/** Detect if component has async operations inside useEffect */
function detectAsyncEffect(candidate: Node): boolean {
  const useEffectCalls = candidate.getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter(c => c.getExpression().getText() === 'useEffect');
  return useEffectCalls.some(c => {
    const args = c.getArguments();
    if (args.length === 0) return false;
    const callbackText = args[0].getText();
    return callbackText.includes('async') || callbackText.includes('fetch') || callbackText.includes('.then');
  });
}

/** Detect third-party (non-relative, non-react) imports */
function detectThirdPartyImports(sourceFile: SourceFile): string[] {
  return sourceFile.getImportDeclarations()
    .map(d => d.getModuleSpecifierValue())
    .filter(m =>
      !m.startsWith('.') &&
      !m.startsWith('@/') &&
      !m.startsWith('~/') &&
      m !== 'react' &&
      !m.startsWith('react/') &&
      m !== 'react-dom' &&
      !m.startsWith('react-dom/') &&
      !m.includes('@testing-library')
    );
}

/** Detect service/API module imports that should be auto-mocked.
 *  Only returns imports whose target file actually exists on disk,
 *  preventing broken jest.mock() calls for non-existent modules. */
function detectServiceImports(sourceFile: SourceFile): string[] {
  const sourceDir = path.dirname(sourceFile.getFilePath());

  return sourceFile.getImportDeclarations()
    .filter(d => {
      const mod = d.getModuleSpecifierValue();
      const isRelative = mod.startsWith('.') || mod.startsWith('@/') || mod.startsWith('~/');
      return isRelative && /service|api|client|repository|http/i.test(mod);
    })
    .filter(d => {
      const mod = d.getModuleSpecifierValue();
      // Only validate relative imports (alias imports resolved by bundler are trusted)
      if (!mod.startsWith('.')) return true;
      return resolveModulePath(sourceDir, mod);
    })
    .map(d => d.getModuleSpecifierValue());
}

/** Check if a relative import resolves to an existing file on disk. */
function resolveModulePath(fromDir: string, importSpecifier: string): boolean {
  const extensions = ['.ts', '.tsx', '.js', '.jsx'];
  const base = path.resolve(fromDir, importSpecifier);

  // Direct file match (import already includes extension)
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return true;

  // Try appending extensions
  for (const ext of extensions) {
    if (fs.existsSync(base + ext)) return true;
  }

  // Try index files in directory
  for (const ext of extensions) {
    if (fs.existsSync(path.join(base, `index${ext}`))) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Context detection helpers
// ---------------------------------------------------------------------------

/** Extract destructured property names from a variable declaration containing the call */
function extractDestructuredKeys(call: Node): string[] {
  const keys: string[] = [];
  const parent = call.getParent();
  if (!parent) return keys;

  // Pattern: const { a, b } = useContext(X)
  let varDecl: Node | undefined;
  if (Node.isVariableDeclaration(parent)) {
    varDecl = parent;
  } else if (Node.isCallExpression(parent)) {
    // useContext may be wrapped: const { a } = useContext(X)
    varDecl = parent.getParent();
  }
  if (!varDecl) varDecl = parent;

  if (Node.isVariableDeclaration(varDecl)) {
    const nameNode = varDecl.getNameNode();
    if (Node.isObjectBindingPattern(nameNode)) {
      for (const element of nameNode.getElements()) {
        keys.push(element.getName());
      }
    }
  }
  return keys;
}

/** Check if a useContext/hook call is inside a try/catch, optional chain, or null guard */
function isOptionalUsage(call: Node): boolean {
  let current: Node | undefined = call;
  while (current) {
    const parent = current.getParent();
    if (!parent) break;

    // Inside try block
    if (Node.isTryStatement(parent)) return true;
    if (Node.isBlock(parent) && parent.getParent() && Node.isTryStatement(parent.getParent()!)) {
      return true;
    }

    // Optional chaining: context?.value
    const parentText = parent.getText();
    if (parentText.includes('?.')) return true;

    // Null check: if (context) or context && ...
    if (Node.isIfStatement(parent)) return true;
    if (
      Node.isBinaryExpression(parent) &&
      (parent.getOperatorToken().getKind() === SyntaxKind.AmpersandAmpersandToken ||
        parent.getOperatorToken().getKind() === SyntaxKind.QuestionQuestionToken)
    ) {
      return true;
    }

    current = parent;
  }
  return false;
}

/** Infer provider name from context name: AuthContext -> AuthProvider */
function inferProviderName(contextName: string): string {
  if (contextName.endsWith('Context')) {
    return contextName.replace(/Context$/, 'Provider');
  }
  return `${contextName}Provider`;
}

/** Strategy 1: Find direct useContext() calls within the component */
function detectDirectUseContext(
  candidate: Node,
  sourceFile: SourceFile,
  contexts: ContextUsage[],
  seen: Set<string>
): void {
  const calls = candidate.getDescendantsOfKind(SyntaxKind.CallExpression);
  for (const call of calls) {
    const expr = call.getExpression();
    if (expr.getText() !== 'useContext') continue;

    const args = call.getArguments();
    if (args.length === 0) continue;

    const contextName = args[0].getText();
    if (seen.has(contextName)) continue;
    seen.add(contextName);

    const importSource = getImportSourceForIdentifier(sourceFile, contextName);
    const consumedKeys = extractDestructuredKeys(call);
    const optional = isOptionalUsage(call);
    const providerName = inferProviderName(contextName);

    contexts.push({
      contextName,
      importPath: importSource,
      consumedKeys,
      isOptional: optional,
      providerName,
      providerImportPath: importSource,
      // backward compat
      name: contextName,
      importSource,
    });
  }
}

/** Strategy 2: Detect custom hooks that internally call useContext */
function detectCustomHookContexts(
  candidate: Node,
  sourceFile: SourceFile,
  project: Project,
  contexts: ContextUsage[],
  seen: Set<string>
): void {
  const calls = candidate.getDescendantsOfKind(SyntaxKind.CallExpression);
  for (const call of calls) {
    const expr = call.getExpression();
    const hookName = expr.getText();

    // Only check custom hooks (useXxx pattern), skip built-in React hooks
    if (!/^use[A-Z]/.test(hookName)) continue;
    if (isBuiltInReactHook(hookName)) continue;

    const hookImportSource = getImportSourceForIdentifier(sourceFile, hookName);

    // Try to resolve the hook to a context via AST follow-through
    const resolved = resolveHookToContext(hookName, hookImportSource, sourceFile, project);

    if (resolved && !seen.has(resolved.contextName)) {
      seen.add(resolved.contextName);

      // Extract consumed keys from how the hook result is destructured
      const consumedKeys = extractDestructuredKeys(call);
      const optional = isOptionalUsage(call);

      contexts.push({
        contextName: resolved.contextName,
        importPath: resolved.contextImportPath,
        hookName,
        hookImportPath: hookImportSource,
        consumedKeys,
        isOptional: optional,
        providerName: resolved.providerName,
        providerImportPath: resolved.providerImportPath ?? resolved.contextImportPath,
        // backward compat
        name: resolved.contextName,
        importSource: resolved.contextImportPath,
      });
    } else if (!resolved) {
      // Fallback: check CONTEXT_DETECTION_CONFIG.customContexts
      const configMatch = resolveHookFromConfig(hookName);
      if (configMatch && !seen.has(configMatch.contextName)) {
        seen.add(configMatch.contextName);
        const consumedKeys = extractDestructuredKeys(call);
        const optional = isOptionalUsage(call);

        contexts.push({
          contextName: configMatch.contextName,
          importPath: configMatch.importPath,
          hookName,
          hookImportPath: hookImportSource,
          consumedKeys,
          isOptional: optional,
          providerName: configMatch.providerName,
          providerImportPath: configMatch.importPath,
          // backward compat
          name: configMatch.contextName,
          importSource: configMatch.importPath,
        });
      }
    }
  }
}

/** Check if a hook name is a built-in React hook that should be skipped */
function isBuiltInReactHook(name: string): boolean {
  return /^use(State|Effect|Context|Ref|Memo|Callback|Reducer|LayoutEffect|ImperativeHandle|DebugValue|DeferredValue|Id|InsertionEffect|SyncExternalStore|Transition|OptimisticState|ActionState|Formatus)$/.test(
    name
  );
}

interface ResolvedContext {
  contextName: string;
  contextImportPath?: string;
  providerName: string;
  providerImportPath?: string;
}

/**
 * Follow a custom hook import to its source file and check if it calls useContext().
 * Also looks for the context + provider exports in the same file.
 */
function resolveHookToContext(
  hookName: string,
  hookImportSource: string | undefined,
  sourceFile: SourceFile,
  project: Project
): ResolvedContext | null {
  if (!hookImportSource) return null;

  // Only follow local/relative imports or path aliases
  if (
    !hookImportSource.startsWith('.') &&
    !hookImportSource.startsWith('@/') &&
    !hookImportSource.startsWith('~/')
  ) {
    return null;
  }

  // Try to find the source file in the project
  const hookSourceFile = resolveImportToSourceFile(hookImportSource, sourceFile, project);
  if (!hookSourceFile) return null;

  // Find the hook function in the resolved file
  const hookFunc = findFunctionByName(hookSourceFile, hookName);
  if (!hookFunc) return null;

  // Check if the hook calls useContext
  const useContextCalls = hookFunc.getDescendantsOfKind(SyntaxKind.CallExpression).filter(
    (call) => call.getExpression().getText() === 'useContext'
  );

  if (useContextCalls.length === 0) return null;

  // Extract the context name from the first useContext call
  const firstCall = useContextCalls[0];
  const args = firstCall.getArguments();
  if (args.length === 0) return null;

  const contextName = args[0].getText();
  const providerName = inferProviderName(contextName);

  // Check if provider is exported from the same file
  const exportedDecls = hookSourceFile.getExportedDeclarations();
  let providerImportPath: string | undefined = hookImportSource;
  if (!exportedDecls.has(providerName)) {
    // Check if context is imported from elsewhere in the hook file
    const contextImport = getImportSourceForIdentifier(hookSourceFile, contextName);
    if (contextImport) {
      providerImportPath = contextImport;
    }
  }

  return {
    contextName,
    contextImportPath: hookImportSource,
    providerName,
    providerImportPath,
  };
}

/** Resolve an import specifier to a SourceFile in the project */
function resolveImportToSourceFile(
  importSpecifier: string,
  fromFile: SourceFile,
  project: Project
): SourceFile | null {
  const fromDir = fromFile.getDirectoryPath();
  const extensions = ['.ts', '.tsx', '.js', '.jsx', ''];

  // Handle path aliases
  let basePath: string;
  if (importSpecifier.startsWith('@/') || importSpecifier.startsWith('~/')) {
    // Find src directory by walking up from the current file
    const srcDir = findSrcDirFromPath(fromDir);
    if (!srcDir) return null;
    basePath = `${srcDir}/${importSpecifier.replace(/^[@~]\//, '')}`;
  } else if (importSpecifier.startsWith('.')) {
    basePath = `${fromDir}/${importSpecifier}`;
  } else {
    return null; // package import
  }

  // Normalize the path
  basePath = basePath.split('\\').join('/');

  // Try with extensions
  for (const ext of extensions) {
    const candidate = basePath + ext;
    const sf = project.getSourceFile(candidate);
    if (sf) return sf;
  }

  // Try as index file
  for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
    const candidate = `${basePath}/index${ext}`;
    const sf = project.getSourceFile(candidate);
    if (sf) return sf;
  }

  // Try to add the file to the project if it exists on disk
  for (const ext of extensions) {
    const candidate = basePath + ext;
    try {
      const sf = project.addSourceFileAtPathIfExists(candidate);
      if (sf) return sf;
    } catch {
      // Ignore resolution errors
    }
  }

  return null;
}

/** Walk up directory tree to find the nearest src/ directory */
function findSrcDirFromPath(dir: string): string | null {
  const normalized = dir.split('\\').join('/');
  const srcIdx = normalized.lastIndexOf('/src');
  if (srcIdx !== -1) {
    return normalized.substring(0, srcIdx + 4);
  }
  return null;
}

/** Find a function or arrow function by name in a source file */
function findFunctionByName(sourceFile: SourceFile, name: string): Node | null {
  for (const func of sourceFile.getFunctions()) {
    if (func.getName() === name) return func;
  }

  for (const variable of sourceFile.getVariableDeclarations()) {
    if (variable.getName() !== name) continue;
    const init = variable.getInitializer();
    if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
      return init;
    }
  }

  return null;
}

/** Resolve a hook name using CONTEXT_DETECTION_CONFIG as fallback */
function resolveHookFromConfig(hookName: string): {
  contextName: string;
  providerName: string;
  importPath?: string;
} | null {
  for (const ctx of CONTEXT_DETECTION_CONFIG.customContexts) {
    if (ctx.hooks.includes(hookName)) {
      return {
        contextName: ctx.contextName,
        providerName: ctx.providerName,
        importPath: undefined, // Config-based matches don't have import paths
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Compound UI library detection
// ---------------------------------------------------------------------------

/**
 * Known compound-component libraries whose sub-components require a parent
 * context/provider and will crash when rendered in isolation.
 */
const COMPOUND_UI_LIBRARY_PATTERNS = [
  /^@radix-ui\//,
  /^cmdk$/,
  /^vaul$/,
  /^react-hook-form$/,
  /^@headlessui\//,
  /^@ark-ui\//,
  /^embla-carousel/,
  /^react-resizable-panels$/,
  /^input-otp$/,
  /^recharts$/,
  /^react-day-picker$/,
  /^@dnd-kit\//,
];

const COMPOUND_CHILD_SUFFIXES = [
  'Item',
  'Trigger',
  'Content',
  'Label',
  'Separator',
  'Indicator',
  'Viewport',
  'Action',
  'Close',
  'Title',
  'Description',
  'Thumb',
  'Track',
  'Handle',
  'Panel',
  'Bar',
  'Style',
  'Slot',
  'Shortcut',
  'Control',
  'Message',
  'Input',
];

const COMPOUND_ROOT_SUFFIXES = ['Provider', 'Root', 'Container', 'Group'];
const ALWAYS_SKIP_COMPOUND_ROOTS = new Set(['ToggleGroup', 'Command', 'CommandGroup']);

/**
 * Given a source file, returns the set of component names that are thin wrappers
 * around compound UI library primitives and require a parent context to render.
 *
 * Handles two patterns:
 * 1. Files importing from compound UI libraries (shadcn/ui wrappers)
 * 2. Files with local React.createContext where sub-components call the context hook
 */
export function getCompoundSubComponents(sourceFile: SourceFile): Set<string> {
  const subComponents = new Set<string>();

  // --- Pattern 1: Third-party compound library imports ---
  let hasCompoundImport = false;
  for (const decl of sourceFile.getImportDeclarations()) {
    const moduleSpec = decl.getModuleSpecifierValue();
    if (COMPOUND_UI_LIBRARY_PATTERNS.some((pattern) => pattern.test(moduleSpec))) {
      hasCompoundImport = true;
      break;
    }
  }

  if (hasCompoundImport) {
    const exported = sourceFile.getExportedDeclarations();
    const exportNames = Array.from(exported.keys());
    for (const name of exportNames) {
      // Pure HTML wrappers like SheetHeader, DrawerFooter are just divs — safe to render.
      if (/(?:Header|Footer)$/.test(name)) continue;
      // Only mark likely sub-components (AccordionItem, DialogContent, etc.).
      // Do not mark standalone/root components (Button, Calendar, AnomalyDetectionChart).
      if (isLikelyCompoundSubComponent(name, exportNames)) {
        subComponents.add(name);
      }
    }
  }

  // --- Pattern 2: Same-file context compound components ---
  // Detect files with React.createContext + useXxx hook + multiple exported components.
  // Sub-components that call the context hook need the root component as a wrapper.
  const sourceText = sourceFile.getText();
  const hasLocalContext = sourceText.includes('createContext');
  if (!hasLocalContext) return subComponents;

  // Find local useXxx hooks that consume the context (useCarousel, useChart, etc.)
  const contextHookNames: string[] = [];
  for (const func of sourceFile.getFunctions()) {
    const name = func.getName();
    if (name && /^use[A-Z]/.test(name)) {
      const body = func.getText();
      if (body.includes('useContext') || body.includes('use(')) {
        contextHookNames.push(name);
      }
    }
  }
  // Also check variable declarations (arrow functions)
  for (const variable of sourceFile.getVariableDeclarations()) {
    const name = variable.getName();
    if (/^use[A-Z]/.test(name)) {
      const init = variable.getInitializer();
      if (init) {
        const initText = init.getText();
        if (initText.includes('useContext') || initText.includes('use(')) {
          contextHookNames.push(name);
        }
      }
    }
  }

  if (contextHookNames.length === 0) return subComponents;

  // Now find which exported components call these context hooks.
  // Those are the sub-components that need the parent wrapper.
  const exported = sourceFile.getExportedDeclarations();
  for (const [name, decls] of exported) {
    for (const decl of decls) {
      const declText = decl.getText();
      // Check if this component calls any of the local context hooks
      if (contextHookNames.some((hook) => declText.includes(hook))) {
        subComponents.add(name);
      }
    }
  }

  return subComponents;
}

function isLikelyCompoundSubComponent(name: string, exportNames: string[]): boolean {
  if (ALWAYS_SKIP_COMPOUND_ROOTS.has(name)) return true;

  // If a matching provider exists (ToastProvider -> Toast), the base/root
  // component usually needs provider context and should not be rendered alone.
  if (exportNames.some((n) => n === `${name}Provider`)) {
    return true;
  }

  if (name.endsWith('Provider')) return false;
  if (COMPOUND_CHILD_SUFFIXES.some((suffix) => name.endsWith(suffix))) return true;
  if (COMPOUND_ROOT_SUFFIXES.some((suffix) => name.endsWith(suffix))) return false;

  // If another exported component is a prefix of this one, this is likely
  // a sub-component in a compound family (e.g., AccordionItem under Accordion).
  return exportNames.some(
    (candidateRoot) =>
      candidateRoot !== name &&
      candidateRoot.length >= 3 &&
      !COMPOUND_CHILD_SUFFIXES.some((suffix) => candidateRoot.endsWith(suffix)) &&
      name.startsWith(candidateRoot)
  );
}

function getImportSourceForIdentifier(
  sourceFile: SourceFile,
  identifier: string
): string | undefined {
  for (const decl of sourceFile.getImportDeclarations()) {
    const namedImports = decl.getNamedImports();
    for (const named of namedImports) {
      if (named.getName() === identifier) {
        return decl.getModuleSpecifierValue();
      }
    }
    const defaultImport = decl.getDefaultImport();
    if (defaultImport && defaultImport.getText() === identifier) {
      return decl.getModuleSpecifierValue();
    }
  }
  return undefined;
}

/** Detects custom component library button elements (MUI, Chakra, Ant, etc.) */
function isButtonLikeComponent(tagName: string): boolean {
  return /^(Button|IconButton|Fab|ButtonBase|ToggleButton|LoadingButton|SubmitButton)$/.test(
    tagName
  );
}

/** Detects custom component library input elements */
function isInputLikeComponent(tagName: string): boolean {
  return /^(Input|TextField|TextInput|TextArea|NumberInput|SearchInput|InputBase|FormInput)$/.test(
    tagName
  );
}

/** Detects custom component library select elements */
function isSelectLikeComponent(tagName: string): boolean {
  return /^(Select|Dropdown|Autocomplete|Combobox|Listbox|SelectField|FormSelect)$/.test(tagName);
}

function isRouterTag(tagName: string): boolean {
  return (
    tagName === 'BrowserRouter' ||
    tagName === 'Router' ||
    tagName === 'MemoryRouter' ||
    tagName === 'HashRouter' ||
    tagName === 'RouterProvider'
  );
}

function fileUsesNamedImport(sourceFile: SourceFile, importName: string): boolean {
  return sourceFile
    .getImportDeclarations()
    .some((decl) => decl.getNamedImports().some((named) => named.getName() === importName));
}

function fileUsesIdentifierCall(sourceFile: SourceFile, identifier: string): boolean {
  return sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .some((call) => call.getExpression().getText() === identifier);
}

function getConditionalProps(node: Node, propNames: Set<string>): string[] {
  const condition = getConditionExpression(node);
  if (!condition) return [];

  const found = new Set<string>();
  collectPropNames(condition, propNames, found);

  return Array.from(found);
}

function getConditionExpression(node: Node): Node | undefined {
  let current: Node | undefined = node;
  while (current) {
    const parent = current.getParent();
    if (!parent) return undefined;

    if (Node.isConditionalExpression(parent)) return parent.getCondition();
    if (
      Node.isBinaryExpression(parent) &&
      parent.getOperatorToken().getKind() === SyntaxKind.AmpersandAmpersandToken
    ) {
      return parent.getLeft();
    }
    if (Node.isJsxExpression(parent)) {
      const expr = parent.getExpression();
      if (expr && Node.isConditionalExpression(expr)) return expr.getCondition();
      if (
        expr &&
        Node.isBinaryExpression(expr) &&
        expr.getOperatorToken().getKind() === SyntaxKind.AmpersandAmpersandToken
      ) {
        return expr.getLeft();
      }
    }

    current = parent;
  }
  return undefined;
}

function collectPropNames(condition: Node, propNames: Set<string>, found: Set<string>): void {
  if (Node.isIdentifier(condition)) {
    const name = condition.getText();
    if (propNames.has(name)) found.add(name);
  }

  condition.forEachDescendant((desc) => {
    if (Node.isIdentifier(desc)) {
      const name = desc.getText();
      if (propNames.has(name)) found.add(name);
    }
    if (Node.isPropertyAccessExpression(desc)) {
      const expr = desc.getExpression();
      if (Node.isIdentifier(expr) && expr.getText() === 'props') {
        const name = desc.getName();
        if (propNames.has(name)) found.add(name);
      }
    }
  });
}

function isConditionalNode(node: Node): boolean {
  let current: Node | undefined = node;
  while (current) {
    const parent = current.getParent();
    if (!parent) break;

    if (Node.isConditionalExpression(parent)) return true;
    if (
      Node.isBinaryExpression(parent) &&
      parent.getOperatorToken().getKind() === SyntaxKind.AmpersandAmpersandToken
    ) {
      return true;
    }
    if (Node.isJsxExpression(parent)) {
      const expr = parent.getExpression();
      if (expr && Node.isConditionalExpression(expr)) return true;
      if (
        expr &&
        Node.isBinaryExpression(expr) &&
        expr.getOperatorToken().getKind() === SyntaxKind.AmpersandAmpersandToken
      ) {
        return true;
      }
    }

    current = parent;
  }
  return false;
}
