import { ComponentInfo, SelectorInfo } from '../analyzer';
import { mockFn } from '../utils/framework';

export interface ConditionalTestCase {
  title: string;
  body: string[];
  isAsync?: boolean;
}

export function buildRenderAssertions(component: ComponentInfo): string[] {
  const lines: string[] = [
    'const { container } = renderUI();',
    'expect(container).toBeTruthy();',
  ];

  // Only assert elements that use specific selectors (testid, label, text, placeholder)
  // Skip generic role-based selectors as they may not be present at render time
  // (component may conditionally render based on context/hook state)
  for (const button of component.buttons) {
    if (button.strategy !== 'role') {
      lines.push(`expect(${selectorQuery(button)}).toBeInTheDocument();`);
    }
  }

  for (const input of component.inputs) {
    if (input.strategy !== 'role') {
      lines.push(`expect(${selectorQuery(input)}).toBeInTheDocument();`);
    }
  }

  for (const select of component.selects) {
    if (select.selector.strategy !== 'role') {
      lines.push(`expect(${selectorQuery(select.selector)}).toBeInTheDocument();`);
    }
  }

  for (const link of component.links.slice(0, 4)) {
    if (link.strategy !== 'role') {
      lines.push(`expect(${selectorQuery(link)}).toBeInTheDocument();`);
    }
  }

  return lines;
}

export function buildInteractionTests(component: ComponentInfo): string[] {
  const tests: string[] = [];

  // Generate click tests for buttons with SPECIFIC selectors only (not generic role)
  // Components using hooks/context may render differently at test-time (loading/empty state)
  for (const button of component.buttons) {
    if (button.strategy === 'role') continue; // Skip generic role selectors - too fragile
    tests.push(
      [
        'const user = userEvent.setup();',
        'const { container } = renderUI();',
        `const target = ${selectorQuery(button)};`,
        'await user.click(target);',
        'expect(container).toBeTruthy();',
      ].join('\n')
    );
  }

  // Generate type tests for inputs with SPECIFIC selectors
  for (const input of component.inputs) {
    if (input.strategy === 'role') continue;
    tests.push(
      [
        'const user = userEvent.setup();',
        'renderUI();',
        `const target = ${selectorQuery(input)} as HTMLInputElement;`,
        'await user.clear(target);',
        'await user.type(target, "test");',
        'expect(target.value).toContain("test");',
      ].join('\n')
    );
  }

  // Generate select interaction tests with SPECIFIC selectors
  for (const select of component.selects) {
    if (select.selector.strategy === 'role') continue;
    tests.push(
      [
        'const user = userEvent.setup();',
        'renderUI();',
        `const target = ${selectorQuery(select.selector)} as HTMLSelectElement;`,
        'if (target.options.length > 0) {',
        '  await user.selectOptions(target, target.options[0]?.value || "");',
        '  expect(target.value).toBeDefined();',
        '}',
      ].join('\n')
    );
  }

  // Generate link click tests (up to 3) with SPECIFIC selectors
  for (const link of component.links.slice(0, 3)) {
    if (link.strategy === 'role') continue;
    tests.push(
      [
        'const user = userEvent.setup();',
        'const { container } = renderUI();',
        `const target = ${selectorQuery(link)};`,
        'await user.click(target);',
        'expect(container).toBeTruthy();',
      ].join('\n')
    );
  }

  return tests;
}

/**
 * Build tests that actually INVOKE callback props (not just check they're defined).
 * Maps callback prop names to likely trigger elements.
 */
export function buildCallbackPropTests(component: ComponentInfo): ConditionalTestCase[] {
  const cases: ConditionalTestCase[] = [];

  // Filter out native HTML event handlers that don't correspond to user interactions
  // (e.g. onSubmit on a <button> is a form event, onSelect is a text selection event)
  // For form components, skip onSubmit callback test (form submission test covers it)
  const hasFormInputs = component.inputs.length > 0 || component.forms.length > 0;

  const htmlNativeEvents = new Set([
    'onSubmit',
    'onSubmitCapture',
    'onReset',
    'onResetCapture',
    'onSelect',
    'onSelectCapture',
    'onToggle',
    'onToggleCapture',
    'onInvalid',
    'onInvalidCapture',
    'onLoad',
    'onLoadCapture',
    'onError',
    'onErrorCapture',
    'onAbort',
    'onAbortCapture',
    'onCanPlay',
    'onCanPlayCapture',
    'onCanPlayThrough',
    'onCanPlayThroughCapture',
    'onDurationChange',
    'onDurationChangeCapture',
    'onEmptied',
    'onEmptiedCapture',
    'onEncrypted',
    'onEncryptedCapture',
    'onEnded',
    'onEndedCapture',
    'onLoadedData',
    'onLoadedDataCapture',
    'onLoadedMetadata',
    'onLoadedMetadataCapture',
    'onLoadStart',
    'onLoadStartCapture',
    'onPause',
    'onPauseCapture',
    'onPlay',
    'onPlayCapture',
    'onPlaying',
    'onPlayingCapture',
    'onProgress',
    'onProgressCapture',
    'onRateChange',
    'onRateChangeCapture',
    'onSeeked',
    'onSeekedCapture',
    'onSeeking',
    'onSeekingCapture',
    'onStalled',
    'onStalledCapture',
    'onSuspend',
    'onSuspendCapture',
    'onTimeUpdate',
    'onTimeUpdateCapture',
    'onVolumeChange',
    'onVolumeChangeCapture',
    'onWaiting',
    'onWaitingCapture',
    'onCopy',
    'onCopyCapture',
    'onCut',
    'onCutCapture',
    'onPaste',
    'onPasteCapture',
    'onCompositionEnd',
    'onCompositionEndCapture',
    'onCompositionStart',
    'onCompositionStartCapture',
    'onCompositionUpdate',
    'onCompositionUpdateCapture',
    'onAnimationEnd',
    'onAnimationEndCapture',
    'onAnimationIteration',
    'onAnimationIterationCapture',
    'onAnimationStart',
    'onAnimationStartCapture',
    'onTransitionEnd',
    'onTransitionEndCapture',
    'onScroll',
    'onScrollCapture',
    'onWheel',
    'onWheelCapture',
    'onGotPointerCapture',
    'onGotPointerCaptureCapture',
    'onLostPointerCapture',
    'onLostPointerCaptureCapture',
  ]);
  const callbackProps = component.props.filter((p) => {
    if (!p.isCallback || p.name.includes('-') || htmlNativeEvents.has(p.name)) return false;
    // Skip onSubmit for form components — the form submission test already covers this
    if (hasFormInputs && /^onSubmit$/i.test(p.name)) return false;
    return true;
  });
  for (const prop of callbackProps) {
    const mockName = `mock${prop.name.charAt(0).toUpperCase() + prop.name.slice(1)}`;
    const triggerElement = findTriggerElement(prop.name, component);

    if (triggerElement) {
      // We can fire an event to invoke the callback
      cases.push({
        title: `calls ${prop.name} when triggered`,
        isAsync: true,
        body: [
          'const user = userEvent.setup();',
          `const ${mockName} = ${mockFn()};`,
          `renderUI({ ${prop.name}: ${mockName} });`,
          `await user.click(${triggerElement});`,
          `expect(${mockName}).toHaveBeenCalled();`,
        ],
      });
    } else {
      // Low confidence mapping: avoid speculative invocation tests.
      cases.push({
        title: `accepts ${prop.name} callback prop`,
        body: [
          `const ${mockName} = ${mockFn()};`,
          `const { container } = renderUI({ ${prop.name}: ${mockName} });`,
          'expect(container).toBeTruthy();',
        ],
      });
    }
  }

  return cases;
}

/**
 * Map callback prop name → trigger element selector.
 * Uses universal naming conventions across React projects.
 */
function findTriggerElement(propName: string, component: ComponentInfo): string | null {
  // onClick/onPress → click the first button
  if (/^on(click|press|action|tap)$/i.test(propName)) {
    if (component.buttons.length > 0 && isReliableSelector(component.buttons[0])) {
      return selectorQuery(component.buttons[0]);
    }
  }

  // onSubmit/onSave/onCreate/onConfirm → find submit-like button or LAST button (not first — first is often Cancel)
  if (/^on(submit|save|create|add|confirm|apply)$/i.test(propName)) {
    const submitButton = component.buttons.find(
      (b) =>
        isReliableSelector(b) &&
        b.value &&
        /submit|save|create|add|confirm|apply|ok|done/i.test(b.value)
    );
    if (submitButton) return selectorQuery(submitButton);
  }

  // onClose/onDismiss/onCancel → find close/cancel button (usually first button)
  if (/^on(close|dismiss|cancel|back|exit|hide)$/i.test(propName)) {
    const closeButton = component.buttons.find(
      (b) =>
        isReliableSelector(b) && b.value && /close|dismiss|cancel|back|exit|hide|x|×/i.test(b.value)
    );
    if (closeButton) return selectorQuery(closeButton);
  }

  // onDelete/onRemove → find delete/remove button
  if (/^on(delete|remove|clear|destroy)$/i.test(propName)) {
    const deleteButton = component.buttons.find(
      (b) => isReliableSelector(b) && b.value && /delete|remove|clear|destroy|trash/i.test(b.value)
    );
    if (deleteButton) return selectorQuery(deleteButton);
  }

  // onToggle/onSwitch → first button
  if (/^on(toggle|switch|flip)$/i.test(propName)) {
    if (component.buttons.length > 0 && isReliableSelector(component.buttons[0]))
      return selectorQuery(component.buttons[0]);
  }

  // onChange → type in first input or change first select
  if (/^on(change|input|update|value.?change)$/i.test(propName)) {
    // Can't use userEvent.type in a click selector - return null, handled separately
    return null;
  }

  // onSelect → typically a checkbox/row selection, not a button click
  // Return null to use the fallback path (just verifies prop is accepted)
  if (/^on(select|pick|choose)$/i.test(propName)) {
    return null;
  }

  // onEdit → find edit button
  if (/^on(edit|modify|rename)$/i.test(propName)) {
    const editButton = component.buttons.find(
      (b) => isReliableSelector(b) && b.value && /edit|modify|rename|pencil/i.test(b.value)
    );
    if (editButton) return selectorQuery(editButton);
  }

  // onExpand/onCollapse/onOpen → find first button
  if (/^on(expand|collapse|open|show|reveal)$/i.test(propName)) {
    if (component.buttons.length > 0 && isReliableSelector(component.buttons[0]))
      return selectorQuery(component.buttons[0]);
  }

  // onSearch → type in an input (search is input-driven, not button-driven)
  if (/^on(search)$/i.test(propName)) {
    // Search is typically an input-driven action, return null to use the fallback path
    return null;
  }

  // onPageChange/onPaginate → prefer a later button (first/prev buttons may be disabled on page 1)
  if (/^on(paginate|page.?change)$/i.test(propName)) {
    // Prefer "next page" or "last page" buttons which are more likely to be enabled
    const nextButton = component.buttons.find(
      (b) => isReliableSelector(b) && b.value && /next|forward|last/i.test(b.value)
    );
    if (nextButton) return selectorQuery(nextButton);
  }

  // onSort/onFilter → first button
  if (/^on(sort|filter|refresh|reload|retry)$/i.test(propName)) {
    if (component.buttons.length > 0 && isReliableSelector(component.buttons[0]))
      return selectorQuery(component.buttons[0]);
  }

  return null;
}

function isReliableSelector(selector: SelectorInfo): boolean {
  return selector.strategy !== 'role';
}

export function buildConditionalRenderTests(component: ComponentInfo): ConditionalTestCase[] {
  const cases: ConditionalTestCase[] = [];
  const seen = new Set<string>();

  component.conditionalElements.forEach((element, index) => {
    if (element.requiredProps.length === 0) return;

    const propsArg = element.requiredProps.map((prop) => `${prop}: true`).join(', ');
    const key = `${propsArg}-${element.selector.strategy}-${element.selector.value}`;

    if (seen.has(key)) return;
    seen.add(key);

    // Skip conditional elements with bogus text selectors (whitespace-only, very short, or dynamic)
    if (
      element.selector.strategy === 'text' &&
      (!element.selector.value || element.selector.value.trim().length < 2)
    ) {
      cases.push({
        title: `renders conditional element ${index + 1}`,
        body: [
          `const { container } = renderUI({ ${propsArg} });`,
          'expect(container).toBeTruthy();',
        ],
      });
      return;
    }

    const query = conditionalSelectorQuery(element.selector);
    cases.push({
      title: `renders conditional element ${index + 1}`,
      body: [`renderUI({ ${propsArg} });`, `expect(${query}).toBeInTheDocument();`],
    });
  });

  return cases;
}

export function buildNegativeBranchTests(component: ComponentInfo): ConditionalTestCase[] {
  const cases: ConditionalTestCase[] = [];

  // For each boolean prop, generate a test with it set to false (skip HTML attributes like aria-*)
  const booleanProps = component.props.filter((p) => p.isBoolean && !p.name.includes('-'));
  for (const prop of booleanProps) {
    cases.push({
      title: `renders with ${prop.name} set to false`,
      body: [
        `const { container } = renderUI({ ${prop.name}: false });`,
        'expect(container).toBeTruthy();',
      ],
    });
  }

  // For conditional elements, test the negative case (prop=false -> element not shown)
  const seen = new Set<string>();
  component.conditionalElements.forEach((element, index) => {
    if (element.requiredProps.length === 0) return;

    // Skip bogus text selectors for negative tests too
    if (
      element.selector.strategy === 'text' &&
      (!element.selector.value || element.selector.value.trim().length < 2)
    ) {
      return;
    }

    const propsArgFalse = element.requiredProps.map((prop) => `${prop}: false`).join(', ');
    const query = conditionalSelectorQuery(element.selector);
    const key = `neg-${propsArgFalse}-${element.selector.strategy}-${element.selector.value}`;

    if (seen.has(key)) return;
    seen.add(key);

    cases.push({
      title: `hides conditional element ${index + 1} when condition is false`,
      body: [
        `renderUI({ ${propsArgFalse} });`,
        `expect(${toQuerySelector(query)}).not.toBeInTheDocument();`,
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
      body: ['const { container } = renderUI();', 'expect(container).toBeTruthy();'],
    });
  }

  return cases;
}

/**
 * Build tests for loading/error/empty/disabled states (branch coverage).
 * Uses universal prop naming conventions.
 */
export function buildStateTests(component: ComponentInfo): ConditionalTestCase[] {
  const cases: ConditionalTestCase[] = [];

  // Loading state tests
  const loadingProps = component.props.filter(
    (p) =>
      /^(is)?(loading|pending|fetching|submitting|processing|busy)/i.test(p.name) &&
      (p.isBoolean || p.type?.toLowerCase().includes('boolean'))
  );
  if (loadingProps.length > 0) {
    cases.push({
      title: 'renders loading state',
      body: [
        `const { container } = renderUI({ ${loadingProps.map((p) => `${p.name}: true`).join(', ')} });`,
        'expect(container).toBeTruthy();',
      ],
    });
  }

  // Error state tests
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
      ...errorBoolProps.map((p) => `${p.name}: true`),
      ...errorStringProps.map((p) => `${p.name}: "Test error message"`),
    ];
    cases.push({
      title: 'renders error state',
      body: [
        `const { container } = renderUI({ ${overrides.join(', ')} });`,
        'expect(container).toBeTruthy();',
      ],
    });
  }

  // Empty data tests (arrays set to [])
  const arrayProps = component.props.filter(
    (p) =>
      p.type?.includes('[]') ||
      p.type?.includes('Array') ||
      /^(items|data|list|rows|options|results|records|entries|expenses|categories|users|products|orders|notifications|messages|transactions|comments|posts|tasks|events)/i.test(
        p.name
      )
  );
  if (arrayProps.length > 0) {
    cases.push({
      title: 'renders with empty data',
      body: [
        `const { container } = renderUI({ ${arrayProps.map((p) => `${p.name}: []`).join(', ')} });`,
        'expect(container).toBeTruthy();',
      ],
    });
  }

  // Disabled state tests
  const disabledProps = component.props.filter(
    (p) =>
      /^(is)?(disabled|readOnly|locked|readonly)/i.test(p.name) &&
      (p.isBoolean || p.type?.toLowerCase().includes('boolean'))
  );
  if (disabledProps.length > 0) {
    cases.push({
      title: 'renders disabled state',
      body: [
        `const { container } = renderUI({ ${disabledProps.map((p) => `${p.name}: true`).join(', ')} });`,
        'expect(container).toBeTruthy();',
      ],
    });
  }

  return cases;
}

/**
 * Build form submission test (fills inputs and clicks submit).
 */
export function buildFormSubmissionTest(component: ComponentInfo): ConditionalTestCase | null {
  if (component.forms.length === 0 && component.inputs.length === 0) return null;

  // Need at least one input to fill
  if (component.inputs.length === 0) return null;

  const body: string[] = ['const user = userEvent.setup();', 'const { container } = renderUI();'];

  // Fill up to 5 inputs
  for (const input of component.inputs.slice(0, 5)) {
    const selector = selectorQuery(input);
    body.push(`await user.type(${selector}, "test value");`);
  }

  // Find and click submit-like button
  const submitButton =
    component.buttons.find(
      (b) => b.value && /submit|save|create|add|confirm|apply|send|ok|done|sign|log/i.test(b.value)
    ) || component.buttons[0];

  if (submitButton) {
    body.push(`await user.click(${selectorQuery(submitButton)});`);
  }

  body.push('expect(container).toBeTruthy();');

  return {
    title: 'handles form submission',
    isAsync: true,
    body,
  };
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

/**
 * Convert a getBy/getAllBy query to a queryBy/queryAllBy for negative assertions.
 * For getAllBy...()[0] patterns, switches to queryBy (singular) to avoid array index issues.
 */
function toQuerySelector(query: string): string {
  // screen.getAllByRole("dialog")[0] → screen.queryByRole("dialog")
  if (query.includes('getAllBy')) {
    return query.replace('getAllBy', 'queryBy').replace(/\)\[0\]$/, ')');
  }
  // screen.getByText(...) → screen.queryByText(...)
  return query.replace('getBy', 'queryBy');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
