/**
 * Unified issue classifier — maps error output to the canonical IssueType taxonomy.
 *
 * This collapses the previous two competing classifiers
 * (heal/classifier.ts and selfHeal/failureClassifier.ts) into one canonical
 * classifier using the normalized IssueType enum from types.ts.
 *
 * The old classifiers remain importable for backward compat but this is the
 * authoritative classifier for the self-heal loop.
 */

import type { IssueType } from '../types';

export interface ClassifiedIssue {
  issueType: IssueType;
  confidence: number;
  evidence: string;
  fingerprint: string;
  rawErrorExcerpt: string;
}

interface ClassificationRule {
  issueType: IssueType;
  confidence: number;
  pattern: RegExp;
}

const CLASSIFICATION_RULES: readonly ClassificationRule[] = [
  // JEST_DOM_MISSING
  {
    issueType: 'JEST_DOM_MISSING',
    confidence: 0.99,
    pattern: /Invalid Chai property:\s*to(?:BeInTheDocument|BeVisible|HaveTextContent)|to(?:BeInTheDocument|BeVisible|HaveTextContent) is not a function|jest-dom|toBeInTheDocument is not a function/i,
  },

  // MISSING_PROVIDER — Router
  {
    issueType: 'MISSING_PROVIDER',
    confidence: 0.99,
    pattern: /use(?:Navigate|Location|Href|Routes|Params)\(\) may be used only in the context of a <Router> component|outside.*Router/i,
  },

  // MISSING_PROVIDER — QueryClient
  {
    issueType: 'MISSING_PROVIDER',
    confidence: 0.99,
    pattern: /No QueryClient set|Missing QueryClient/i,
  },

  // MISSING_PROVIDER — Redux
  {
    issueType: 'MISSING_PROVIDER',
    confidence: 0.99,
    pattern: /could not find react-redux context value|could not find ["']?store["']? in the context/i,
  },

  // MISSING_PROVIDER — hook context
  {
    issueType: 'MISSING_PROVIDER',
    confidence: 0.96,
    pattern: /Cannot destructure property ['"][^'"]+['"] of ['"`][^'"`]*use[A-Z]\w*\([^)]*\)['"`] as it is undefined|use[A-Z]\w+\(\) must be used within/i,
  },

  // MISSING_PROVIDER — generic
  {
    issueType: 'MISSING_PROVIDER',
    confidence: 0.93,
    pattern: /must be used within .*Provider|must be wrapped in .*Provider|outside.*Provider/i,
  },

  // MISSING_EXPORT
  {
    issueType: 'MISSING_EXPORT',
    confidence: 0.99,
    pattern: /No ['"][^'"]+['"] export is defined on the .* mock|does not provide an export named|is not exported from|has no exported member/i,
  },

  // MOCK_EXPORT_MISMATCH — out-of-scope variable in mock factory
  {
    issueType: 'MOCK_EXPORT_MISMATCH',
    confidence: 0.97,
    pattern: /The module factory of `jest\.mock\(\)` is not allowed to reference any out-of-scope variables|Cannot access ['"][^'"]+['"] before initialization|jest\.mock.*out-of-scope|ReferenceError: Cannot access ['"][^'"]+['"] before initialization/i,
  },

  // SERVICE_NOT_MOCKED
  {
    issueType: 'SERVICE_NOT_MOCKED',
    confidence: 0.95,
    pattern: /mock(?:Resolved|Rejected|Implementation|Return)Value(?:Once)? is not a function|Cannot read propert(?:y|ies) of undefined \(reading ['"]mock(?:Resolved|Rejected|Implementation|Return)Value/i,
  },

  // BROKEN_IMPORT
  {
    issueType: 'BROKEN_IMPORT',
    confidence: 0.99,
    pattern: /Cannot find module ['"][^'"]+['"]|Module not found: Can't resolve ['"][^'"]+['"]/i,
  },

  // MOCK_MODULE_NOT_FOUND
  {
    issueType: 'MOCK_MODULE_NOT_FOUND',
    confidence: 0.97,
    pattern: /Cannot find module ['"][^'"]+['"] from ['"][^'"]+['"].*mock|jest\.mock\(\) module not found/i,
  },

  // ASYNC_QUERY_MISMATCH
  {
    issueType: 'ASYNC_QUERY_MISMATCH',
    confidence: 0.91,
    pattern: /Timed out in waitFor|Timed out retrying|Unable to find an element .*findBy/i,
  },

  // INVALID_COMPONENT_SYMBOL
  {
    issueType: 'INVALID_COMPONENT_SYMBOL',
    confidence: 0.95,
    pattern: /Element type is invalid.*expected a string.*but got.*undefined|is not a function.*component|ReferenceError:.*is not defined|Objects are not valid as a React child/i,
  },

  // TYPE_ASSERTION_MISMATCH
  {
    issueType: 'TYPE_ASSERTION_MISMATCH',
    confidence: 0.9,
    pattern: /expect\(.*\)\.to(?:Be|Have|Equal|Match|Contain)/i,
  },

  // ACT_WARNING_PATTERN
  {
    issueType: 'ACT_WARNING_PATTERN',
    confidence: 0.88,
    pattern: /act\(|not wrapped in act|An update to .* inside a test was not wrapped in act/i,
  },

  // UNSAFE_UNDEFINED_ACCESS
  {
    issueType: 'UNSAFE_UNDEFINED_ACCESS',
    confidence: 0.85,
    pattern: /Cannot read propert(?:y|ies) of (?:undefined|null)|undefined is not an object|TypeError:.*(?:undefined|null)/i,
  },
];

/**
 * Classify an error output string into a canonical IssueType.
 */
export function classifyIssue(errorOutput: string): ClassifiedIssue {
  const cleaned = stripAnsi(errorOutput);

  for (const rule of CLASSIFICATION_RULES) {
    const match = rule.pattern.exec(cleaned);
    if (match) {
      const evidence = (match[0] ?? '').slice(0, 160);
      const excerpt = extractExcerpt(cleaned);
      return {
        issueType: rule.issueType,
        confidence: rule.confidence,
        evidence,
        fingerprint: `${rule.issueType}:${normalizeFingerprint(evidence)}`,
        rawErrorExcerpt: excerpt,
      };
    }
  }

  return {
    issueType: 'UNKNOWN',
    confidence: 0,
    evidence: extractExcerpt(cleaned),
    fingerprint: `UNKNOWN:${normalizeFingerprint(extractExcerpt(cleaned))}`,
    rawErrorExcerpt: extractExcerpt(cleaned),
  };
}

/**
 * Classify multiple failure messages and deduplicate by fingerprint.
 */
export function classifyIssues(errorOutputs: string[]): ClassifiedIssue[] {
  const seen = new Set<string>();
  const issues: ClassifiedIssue[] = [];

  for (const output of errorOutputs) {
    const issue = classifyIssue(output);
    if (!seen.has(issue.fingerprint)) {
      seen.add(issue.fingerprint);
      issues.push(issue);
    }
  }

  return issues;
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function extractExcerpt(text: string): string {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (
      /^(ReferenceError|TypeError|SyntaxError|Error|Cannot find module|expect\()/i.test(trimmed) ||
      /Expected .+ (to |not )/.test(trimmed) ||
      /Unable to find/.test(trimmed) ||
      /must be used within/.test(trimmed) ||
      /No QueryClient set/.test(trimmed)
    ) {
      return trimmed.length > 200 ? `${trimmed.substring(0, 197)}...` : trimmed;
    }
  }
  const first = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return first.length > 200 ? `${first.substring(0, 197)}...` : first;
}

function normalizeFingerprint(value: string): string {
  return value
    .replace(/\d+/g, '#')
    .replace(/["'`]/g, '')
    .replace(/[^a-zA-Z0-9<>\-_: ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
