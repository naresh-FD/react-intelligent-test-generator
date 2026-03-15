// ---------------------------------------------------------------------------
// Failure Analyzer — structured error analysis for self-healing
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Failure categories ordered by root-cause priority (highest first).
 * Earlier categories are more likely to be the root cause — fixing them
 * often resolves downstream symptoms automatically.
 */
export enum FailureCategory {
  SYNTAX_ERROR = 'SYNTAX_ERROR',                     // 1 — compile/parse errors
  BAD_MODULE_RESOLUTION = 'BAD_MODULE_RESOLUTION',   // 2 — Cannot find module (path/alias)
  MISSING_SYMBOL_IMPORT = 'MISSING_SYMBOL_IMPORT',   // 3 — ReferenceError: X is not defined
  MISSING_PROVIDER = 'MISSING_PROVIDER',             // 4 — Router, QueryClient, custom context
  HOOK_CONTEXT_MISSING = 'HOOK_CONTEXT_MISSING',     // 5 — useXxx() outside provider
  MOCK_SHAPE_MISMATCH = 'MOCK_SHAPE_MISMATCH',       // 6 — mock returns wrong type
  ASYNC_NOT_AWAITED = 'ASYNC_NOT_AWAITED',           // 7 — not wrapped in act
  BAD_QUERY_SELECTOR = 'BAD_QUERY_SELECTOR',         // 8 — getBy finds nothing
  ASSERTION_MISMATCH = 'ASSERTION_MISMATCH',         // 9 — expected vs received (report-only)
  UNKNOWN = 'UNKNOWN',                               // 10
}

/** Priority ordering — lower number = higher priority (fix first). */
const CATEGORY_PRIORITY: Record<FailureCategory, number> = {
  [FailureCategory.SYNTAX_ERROR]: 1,
  [FailureCategory.BAD_MODULE_RESOLUTION]: 2,
  [FailureCategory.MISSING_SYMBOL_IMPORT]: 3,
  [FailureCategory.MISSING_PROVIDER]: 4,
  [FailureCategory.HOOK_CONTEXT_MISSING]: 5,
  [FailureCategory.MOCK_SHAPE_MISMATCH]: 6,
  [FailureCategory.ASYNC_NOT_AWAITED]: 7,
  [FailureCategory.BAD_QUERY_SELECTOR]: 8,
  [FailureCategory.ASSERTION_MISMATCH]: 9,
  [FailureCategory.UNKNOWN]: 10,
};

export interface FailureAnalysis {
  /** Stable hash for cache lookup (based on category + key signals). */
  fingerprint: string;
  category: FailureCategory;
  priority: number;
  errorType: string;
  errorMessage: string;
  failingTestName: string;

  // Contextual signals extracted from the error
  missingIdentifier?: string;
  missingModule?: string;
  hookName?: string;
  providerName?: string;
  queriedSelector?: string;
  queryMethod?: string;
  expectedValue?: string;
  receivedValue?: string;
  mockTarget?: string;
  shapeIssue?: 'not-function' | 'not-array' | 'not-object' | 'undefined-property';
}

export interface FailureDetail {
  testName: string;
  errorMessage: string;
  stackTrace: string;
}

// ---------------------------------------------------------------------------
// ANSI + whitespace normalization
// ---------------------------------------------------------------------------

function normalize(text: string): string {
  // Strip ANSI escape codes
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '').trim();
}

// ---------------------------------------------------------------------------
// Category detection — ordered matchers
// ---------------------------------------------------------------------------

function detectCategory(msg: string): { category: FailureCategory; signals: Partial<FailureAnalysis> } {
  const n = normalize(msg);

  // 1. Syntax / compile errors
  if (/SyntaxError/i.test(n) || /Unexpected token/i.test(n) || /Unterminated string/i.test(n)) {
    return { category: FailureCategory.SYNTAX_ERROR, signals: {} };
  }

  // 2. Cannot find module (path/alias issue)
  const moduleMatch = n.match(/Cannot find module ['"]([^'"]+)['"]/);
  if (moduleMatch) {
    return {
      category: FailureCategory.BAD_MODULE_RESOLUTION,
      signals: { missingModule: moduleMatch[1] },
    };
  }

  // 3. ReferenceError: X is not defined
  const refErrMatch = n.match(/ReferenceError:\s+(\w+)\s+is not defined/);
  if (refErrMatch) {
    return {
      category: FailureCategory.MISSING_SYMBOL_IMPORT,
      signals: { missingIdentifier: refErrMatch[1] },
    };
  }

  // 4. Missing provider — Router
  if (
    /useNavigate\(\).*may.*only.*be used.*context.*<Router/i.test(n) ||
    /useLocation\(\).*may.*only.*be used.*context.*<Router/i.test(n) ||
    /useParams\(\).*may.*only.*be used.*context.*<Router/i.test(n) ||
    /useHref\(\).*may.*only.*be used.*context.*<Router/i.test(n) ||
    /You should not use <Link> outside a <Router>/i.test(n) ||
    /Invariant failed:.*useNavigate/i.test(n) ||
    /useRoutes\(\).*may.*only.*be used/i.test(n)
  ) {
    return {
      category: FailureCategory.MISSING_PROVIDER,
      signals: { providerName: 'MemoryRouter', hookName: 'useNavigate' },
    };
  }

  // 4b. Missing provider — QueryClient
  if (
    /No QueryClient set/i.test(n) ||
    /QueryClientProvider/i.test(n) ||
    /useQuery.*must be used within.*QueryClientProvider/i.test(n)
  ) {
    return {
      category: FailureCategory.MISSING_PROVIDER,
      signals: { providerName: 'QueryClientProvider', hookName: 'useQuery' },
    };
  }

  // 4c. Missing provider — Redux
  if (
    /Could not find "store"/i.test(n) ||
    /useSelector.*must be used within.*Provider/i.test(n) ||
    /useDispatch.*must be used within.*Provider/i.test(n)
  ) {
    return {
      category: FailureCategory.MISSING_PROVIDER,
      signals: { providerName: 'ReduxProvider', hookName: 'useSelector' },
    };
  }

  // 5. Hook context missing — custom context
  const ctxDestructureMatch = n.match(
    /Cannot destructure property ['"](\w+)['"].*(?:(?:of|from)\s+(?:undefined|null)|as it is (?:undefined|null))/
  );
  if (ctxDestructureMatch) {
    const prop = ctxDestructureMatch[1];
    // Detect router-related context destructuring (basename, navigator, etc.)
    const isRouterCtx = /basename|navigator|location|matches/i.test(prop) ||
      /useContext|React\d*\.useContext/i.test(n);
    const signals: Partial<FailureAnalysis> = { missingIdentifier: prop };
    if (isRouterCtx || /router/i.test(n)) {
      signals.hookName = 'useNavigate';
      signals.providerName = 'MemoryRouter';
    }
    return {
      category: FailureCategory.HOOK_CONTEXT_MISSING,
      signals,
    };
  }

  const hookCtxMatch = n.match(/(\w+) must be used within/i);
  if (hookCtxMatch) {
    return {
      category: FailureCategory.HOOK_CONTEXT_MISSING,
      signals: { hookName: hookCtxMatch[1] },
    };
  }

  // 6. Mock shape mismatch
  if (/is not a function/i.test(n)) {
    const fnMatch = n.match(/(?:TypeError:\s+)?(\S+)\s+is not a function/);
    return {
      category: FailureCategory.MOCK_SHAPE_MISMATCH,
      signals: {
        mockTarget: fnMatch?.[1],
        shapeIssue: 'not-function',
      },
    };
  }
  if (/\.map is not a function/i.test(n)) {
    const arrMatch = n.match(/(\S+)\.map is not a function/);
    return {
      category: FailureCategory.MOCK_SHAPE_MISMATCH,
      signals: {
        mockTarget: arrMatch?.[1],
        shapeIssue: 'not-array',
      },
    };
  }
  if (/Cannot read propert(?:y|ies) of undefined/i.test(n)) {
    const propMatch = n.match(/Cannot read propert(?:y|ies) of undefined \(reading ['"](\w+)['"]\)/);
    return {
      category: FailureCategory.MOCK_SHAPE_MISMATCH,
      signals: {
        missingIdentifier: propMatch?.[1],
        shapeIssue: 'undefined-property',
      },
    };
  }
  if (/Cannot read propert(?:y|ies) of null/i.test(n)) {
    const propMatchNull = n.match(/Cannot read propert(?:y|ies) of null \(reading ['"](\w+)['"]\)/);
    return {
      category: FailureCategory.MOCK_SHAPE_MISMATCH,
      signals: {
        missingIdentifier: propMatchNull?.[1],
        shapeIssue: 'undefined-property',
      },
    };
  }

  // 7. Async — not wrapped in act
  if (
    /not wrapped in act/i.test(n) ||
    /Warning:.*An update to .* inside a test was not wrapped in act/i.test(n) ||
    /act\(\.\.\.\)/i.test(n)
  ) {
    return { category: FailureCategory.ASYNC_NOT_AWAITED, signals: {} };
  }

  // 8. Bad query selector
  const queryMatch = n.match(/Unable to find.*(?:by|with)\s+(text|role|label|placeholder|testid)/i);
  const getByMatch = n.match(/(getBy\w+|queryBy\w+|findBy\w+)/);
  if (/Unable to find/i.test(n) || /TestingLibraryElementError/i.test(n)) {
    return {
      category: FailureCategory.BAD_QUERY_SELECTOR,
      signals: {
        queriedSelector: queryMatch?.[1],
        queryMethod: getByMatch?.[1],
      },
    };
  }

  // 9. Assertion mismatch
  if (
    /expect\(received\)/i.test(n) ||
    /Expected:.*Received:/i.test(n) ||
    /expected .+ (to |not to )/i.test(n) ||
    /toBe\b|toEqual\b|toHaveBeenCalled/i.test(n)
  ) {
    const expMatch = n.match(/Expected:\s*(.+)/);
    const recMatch = n.match(/Received:\s*(.+)/);
    return {
      category: FailureCategory.ASSERTION_MISMATCH,
      signals: {
        expectedValue: expMatch?.[1]?.trim(),
        receivedValue: recMatch?.[1]?.trim(),
      },
    };
  }

  return { category: FailureCategory.UNKNOWN, signals: {} };
}

// ---------------------------------------------------------------------------
// Fingerprint generation (stable, not path/line dependent)
// ---------------------------------------------------------------------------

function buildFingerprint(category: FailureCategory, signals: Partial<FailureAnalysis>): string {
  const parts: string[] = [category];

  // Add stable discriminators depending on category
  if (signals.missingModule) parts.push(`mod:${signals.missingModule.toLowerCase()}`);
  if (signals.missingIdentifier) parts.push(`id:${signals.missingIdentifier.toLowerCase()}`);
  if (signals.hookName) parts.push(`hook:${signals.hookName.toLowerCase()}`);
  if (signals.providerName) parts.push(`prov:${signals.providerName.toLowerCase()}`);
  if (signals.queryMethod) parts.push(`qm:${signals.queryMethod.toLowerCase()}`);
  if (signals.shapeIssue) parts.push(`shape:${signals.shapeIssue}`);
  if (signals.mockTarget) parts.push(`mock:${signals.mockTarget.toLowerCase()}`);

  const raw = parts.join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 16);
}

// ---------------------------------------------------------------------------
// Extract error type from message
// ---------------------------------------------------------------------------

function extractErrorType(msg: string): string {
  const n = normalize(msg);
  const typeMatch = n.match(/^((?:Reference|Type|Syntax|Range|URI)Error)/);
  if (typeMatch) return typeMatch[1];
  if (/Cannot find module/i.test(n)) return 'ModuleNotFoundError';
  if (/Unable to find/i.test(n)) return 'TestingLibraryElementError';
  if (/not wrapped in act/i.test(n)) return 'ActWarning';
  return 'Error';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze a single test failure into a structured FailureAnalysis.
 */
export function analyzeFailure(detail: FailureDetail): FailureAnalysis {
  const fullMessage = detail.errorMessage || detail.stackTrace || '';
  const { category, signals } = detectCategory(fullMessage);
  const fingerprint = buildFingerprint(category, signals);

  return {
    fingerprint,
    category,
    priority: CATEGORY_PRIORITY[category],
    errorType: extractErrorType(fullMessage),
    errorMessage: fullMessage.length > 500 ? fullMessage.substring(0, 500) : fullMessage,
    failingTestName: detail.testName,
    ...signals,
  };
}

/**
 * Analyze multiple failures and return them sorted by root-cause priority
 * (highest priority / lowest number first).
 */
export function analyzeFailures(details: FailureDetail[]): FailureAnalysis[] {
  return details
    .map(analyzeFailure)
    .sort((a, b) => a.priority - b.priority);
}

/**
 * Pick the single highest-priority root-cause failure.
 * Returns null if no failures provided.
 */
export function pickRootCause(details: FailureDetail[]): FailureAnalysis | null {
  const sorted = analyzeFailures(details);
  return sorted.length > 0 ? sorted[0] : null;
}
