/**
 * Error signature extractor — derives stable, deduplicable signatures
 * from noisy error output.
 *
 * Signatures strip away file-specific paths, line numbers, and
 * runtime-specific noise to produce a stable key that identifies
 * the *class* of failure rather than the specific instance.
 */

/**
 * Extract a stable error signature from raw error output.
 *
 * The signature is used for:
 * - Deduplicating issues across runs
 * - Fingerprinting recurring failures
 * - Grouping dataset records by failure class
 */
export function extractErrorSignature(rawError: string): string {
  let sig = rawError;

  // Strip ANSI color codes
  sig = sig.replace(/\x1b\[[0-9;]*m/g, '');

  // Normalize file paths to just the filename
  sig = sig.replace(/(?:[A-Za-z]:)?[/\\](?:[^/\\\s:]+[/\\])*([^/\\\s:]+\.\w+)/g, '$1');

  // Strip line/column numbers (e.g. :42:10, line 42, col 10)
  sig = sig.replace(/:\d+:\d+/g, ':L:C');
  sig = sig.replace(/\bline \d+/gi, 'line N');
  sig = sig.replace(/\bcol(?:umn)? \d+/gi, 'col N');

  // Strip stack trace lines (at Module._compile, at Object.<anonymous>, etc.)
  sig = sig.replace(/^\s+at\s+.+$/gm, '');

  // Collapse whitespace
  sig = sig.replace(/\n{2,}/g, '\n').trim();

  // Take the first meaningful line as the signature
  const lines = sig.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return 'EMPTY_ERROR';

  // Use the first non-empty line, capped at 200 chars
  return lines[0].substring(0, 200);
}

/**
 * Extract the error type prefix (e.g., "TypeError", "ReferenceError").
 */
export function extractErrorType(rawError: string): string | null {
  const match = rawError.match(/\b(TypeError|ReferenceError|SyntaxError|Error|RangeError|EvalError|URIError):/);
  return match ? match[1] : null;
}

/**
 * Extract the module/symbol involved in an error if identifiable.
 */
export function extractInvolvedSymbol(rawError: string): string | null {
  // "Cannot find module 'foo'"
  const moduleMatch = rawError.match(/Cannot find module ['"]([^'"]+)['"]/);
  if (moduleMatch) return moduleMatch[1];

  // "useX is not defined" or "useX is not a function"
  const symbolMatch = rawError.match(/\b(use[A-Z]\w+|[A-Z]\w+Provider|[A-Z]\w+Context)\b.*(?:not defined|not a function|before initialization)/);
  if (symbolMatch) return symbolMatch[1];

  // "X is not exported from Y"
  const exportMatch = rawError.match(/'([^']+)' is not exported from/);
  if (exportMatch) return exportMatch[1];

  return null;
}
