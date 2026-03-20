import { FailureCategory, FailureSignature } from './types';

interface FailureRule {
  category: FailureCategory;
  confidence: number;
  pattern: RegExp;
}

const ANSI_ESCAPE = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-9;]*m`, 'g');
const FILE_URL_PATTERN = /file:\/\/\/[^\s)]+/gi;
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:\\(?:[^\\\s:()]+\\)*[^\\\s:()]+/g;
const POSIX_PATH_PATTERN = /(^|[\s(])\/(?:[^/\s:()]+\/)*[^/\s:()]+/g;
const STACK_LOCATION_PATTERN = /:\d+:\d+\b/g;
const TSC_LOCATION_PATTERN = /\(\d+,\d+\)/g;
const LINE_COLUMN_PATTERN = /\bline \d+\s+column \d+\b/gi;
const WHITESPACE_PATTERN = /\s+/g;

const FAILURE_RULES: readonly FailureRule[] = [
  {
    category: 'missing-jest-dom-matcher',
    confidence: 0.99,
    pattern: /Invalid Chai property:\s*to(?:BeInTheDocument|BeVisible|HaveTextContent)|to(?:BeInTheDocument|BeVisible|HaveTextContent) is not a function/i,
  },
  {
    category: 'router-missing',
    confidence: 0.99,
    pattern: /use(?:Navigate|Location|Href|Routes|Params)\(\) may be used only in the context of a <Router> component|outside.*Router/i,
  },
  {
    category: 'query-client-missing',
    confidence: 0.99,
    pattern: /No QueryClient set|Missing QueryClient/i,
  },
  {
    category: 'redux-store-missing',
    confidence: 0.99,
    pattern: /could not find react-redux context value|could not find ["']?store["']? in the context/i,
  },
  {
    category: 'hook-context-missing',
    confidence: 0.96,
    pattern: /Cannot destructure property ['"][^'"]+['"] of ['"`][^'"`]*use[A-Z]\w*\([^)]*\)['"`] as it is undefined|use[A-Z]\w+\(\) must be used within/i,
  },
  {
    category: 'missing-provider-wrapper',
    confidence: 0.93,
    pattern: /must be used within .*Provider|must be wrapped in .*Provider|outside.*Provider/i,
  },
  {
    category: 'non-existent-export-mock',
    confidence: 0.99,
    pattern: /No ['"][^'"]+['"] export is defined on the .* mock|does not provide an export named/i,
  },
  {
    category: 'bad-module-mock',
    confidence: 0.97,
    pattern: /The module factory of `jest\.mock\(\)` is not allowed to reference any out-of-scope variables|Cannot access ['"][^'"]+['"] before initialization.*mock|jest\.mock.*out-of-scope/i,
  },
  {
    category: 'service-mock-missing',
    confidence: 0.95,
    pattern: /mock(?:Resolved|Rejected|Implementation|Return)Value(?:Once)? is not a function|Cannot read propert(?:y|ies) of undefined \(reading ['"]mock(?:Resolved|Rejected|Implementation|Return)Value/i,
  },
  {
    category: 'bad-import-resolution',
    confidence: 0.99,
    pattern: /Cannot find module ['"][^'"]+['"]|Module not found: Can't resolve ['"][^'"]+['"]/i,
  },
  {
    category: 'async-query-mismatch',
    confidence: 0.91,
    pattern: /Timed out in waitFor|Timed out retrying|Unable to find an element .*findBy/i,
  },
  {
    category: 'selector-too-weak',
    confidence: 0.9,
    pattern: /If this is intentional, then use the `?\*AllBy\*`? variant of the query|A better query is available/i,
  },
  {
    category: 'multiple-elements-found',
    confidence: 0.97,
    pattern: /Found multiple elements with[^.]+/i,
  },
  {
    category: 'element-not-found',
    confidence: 0.96,
    pattern: /Unable to find an element with[^.]+|Unable to find role[^.]+|Unable to find text[^.]+|Unable to find label[^.]+/i,
  },
  {
    category: 'event-simulation-mismatch',
    confidence: 0.94,
    pattern: /Unable to fire a ["'][^"']+["'] event - please provide a DOM element|The given element does not have a value setter|pointer-events:\s*none/i,
  },
] as const;

export function classifyFailure(errorOutput: string): FailureSignature {
  const normalizedText = normalizeFailureText(errorOutput);
  const matchedRule = FAILURE_RULES.find((rule) => rule.pattern.test(normalizedText));
  const category = matchedRule?.category ?? 'unknown';
  const evidence = matchedRule
    ? extractEvidenceSnippet(normalizedText, matchedRule.pattern)
    : extractFailureSummary(normalizedText);
  const summary = evidence || extractFailureSummary(normalizedText);

  return {
    category,
    normalizedText,
    summary,
    confidence: matchedRule?.confidence ?? 0,
    evidence,
    fingerprint: buildFailureFingerprint(category, evidence || summary),
  };
}

export function detectFailureCategory(errorOutput: string): FailureCategory {
  return classifyFailure(errorOutput).category;
}

export function normalizeFailureText(errorOutput: string): string {
  return collapseWhitespace(
    stripVolatileLocationData(
      stripAbsolutePaths(
        stripAnsiCodes(errorOutput ?? ''),
      ),
    ),
  );
}

export function stripAnsiCodes(input: string): string {
  return input.replace(ANSI_PATTERN, '');
}

export function stripAbsolutePaths(input: string): string {
  return input
    .replace(FILE_URL_PATTERN, '<path>')
    .replace(WINDOWS_PATH_PATTERN, '<path>')
    .replace(POSIX_PATH_PATTERN, (_match, prefix: string) => `${prefix}<path>`);
}

export function stripVolatileLocationData(input: string): string {
  return input
    .replace(STACK_LOCATION_PATTERN, ':#:#')
    .replace(TSC_LOCATION_PATTERN, '(#,#)')
    .replace(LINE_COLUMN_PATTERN, 'line # column #');
}

export function collapseWhitespace(input: string): string {
  return input.replace(WHITESPACE_PATTERN, ' ').trim();
}

export function extractFailureSummary(normalizedText: string): string {
  if (!normalizedText) {
    return 'Unknown failure';
  }
  return normalizedText.slice(0, 160);
}

export function buildFailureFingerprint(
  category: FailureCategory,
  evidence: string,
): string {
  return `${category}:${normalizeFingerprintToken(evidence)}`;
}

function extractEvidenceSnippet(
  normalizedText: string,
  pattern: RegExp,
): string {
  const match = pattern.exec(normalizedText);
  if (!match) {
    return extractFailureSummary(normalizedText);
  }
  return collapseWhitespace(match[0]).slice(0, 160);
}

function normalizeFingerprintToken(value: string): string {
  return value
    .replace(/\d+/g, '#')
    .replace(/["'`]/g, '')
    .replace(/[^a-zA-Z0-9<>\-_: ]+/g, ' ')
    .replace(WHITESPACE_PATTERN, ' ')
    .trim()
    .toLowerCase();
}
