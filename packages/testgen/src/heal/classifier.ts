/**
 * Failure classifier — categorises Jest error output into deterministic
 * failure classes so the repair engine can select a targeted strategy.
 */

// ---------------------------------------------------------------------------
// Failure classes
// ---------------------------------------------------------------------------

export type FailureClass =
  | 'missing_import'
  | 'missing_module'
  | 'missing_provider'
  | 'missing_mock'
  | 'render_error'
  | 'type_error'
  | 'syntax_error'
  | 'assertion_mismatch'
  | 'query_not_found'
  | 'act_warning'
  | 'timeout'
  | 'unknown';

export interface ClassifiedFailure {
  /** Deterministic failure class */
  failureClass: FailureClass;
  /** First concise error line (for display / memory key) */
  reason: string;
  /** Raw error output for deeper analysis if needed */
  rawOutput: string;
}

// ---------------------------------------------------------------------------
// Classification rules — order matters: first match wins
// ---------------------------------------------------------------------------

interface Rule {
  test: (text: string) => boolean;
  failureClass: FailureClass;
}

const RULES: Rule[] = [
  {
    test: (t) => /SyntaxError/.test(t),
    failureClass: 'syntax_error',
  },
  {
    test: (t) => /Cannot find module/.test(t) || /Module not found/.test(t),
    failureClass: 'missing_module',
  },
  {
    test: (t) =>
      /is not exported from/.test(t) ||
      /does not provide an export named/.test(t) ||
      /has no exported member/.test(t),
    failureClass: 'missing_import',
  },
  {
    test: (t) =>
      /could not find react-redux context/.test(t) ||
      /useContext.*null/.test(t) ||
      /wrap.*provider/i.test(t) ||
      /must be used within/.test(t) ||
      /No QueryClient set/.test(t) ||
      /useNavigate.*may be used only/.test(t),
    failureClass: 'missing_provider',
  },
  {
    test: (t) =>
      /is not a function/.test(t) ||
      /Cannot read propert/.test(t) ||
      /undefined is not an object/.test(t) ||
      /\.mock is not a function/.test(t),
    failureClass: 'missing_mock',
  },
  {
    test: (t) =>
      /Unable to find.*text/.test(t) ||
      /Unable to find.*role/.test(t) ||
      /TestingLibraryElementError/.test(t) ||
      /Unable to find an element/.test(t),
    failureClass: 'query_not_found',
  },
  {
    test: (t) =>
      /expect\(/.test(t) && (/toB|toH|toContain|toEqual|toMatch/.test(t) || /Expected/.test(t)),
    failureClass: 'assertion_mismatch',
  },
  {
    test: (t) => /act\(/.test(t) || /not wrapped in act/.test(t),
    failureClass: 'act_warning',
  },
  {
    test: (t) =>
      /TypeError/.test(t) || /ReferenceError/.test(t) || /Error:.*render/.test(t),
    failureClass: 'render_error',
  },
  {
    test: (t) => /Timeout/.test(t) || /exceeded/.test(t),
    failureClass: 'timeout',
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Strip ANSI escape codes.
 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Extract a concise single-line reason from raw error text.
 */
function extractReason(rawOutput: string): string {
  const text = stripAnsi(rawOutput);
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (
      /^(ReferenceError|TypeError|SyntaxError|Error|Cannot find module|expect\()/i.test(trimmed) ||
      /Expected .+ (to |not )/.test(trimmed) ||
      /Unable to find/.test(trimmed) ||
      /is not exported/.test(trimmed) ||
      /must be used within/.test(trimmed) ||
      /No QueryClient set/.test(trimmed)
    ) {
      return trimmed.length > 150 ? `${trimmed.substring(0, 147)}...` : trimmed;
    }
  }
  return '';
}

/**
 * Classify a Jest failure into a deterministic failure class.
 */
export function classifyFailure(rawOutput: string): ClassifiedFailure {
  const clean = stripAnsi(rawOutput);
  const reason = extractReason(rawOutput);

  for (const rule of RULES) {
    if (rule.test(clean)) {
      return { failureClass: rule.failureClass, reason, rawOutput };
    }
  }

  return { failureClass: 'unknown', reason, rawOutput };
}
