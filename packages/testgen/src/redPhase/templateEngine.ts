import path from 'node:path';
import type { RequirementOperator, RequirementCriterion, ExpectedValue } from '../requirements/types';
import type { MappingDecision, MappingCandidate } from '../mapping/types';
import type {
  GeneratedImport,
  GeneratedTestSuite,
  RequirementTestCase,
  SymbolTarget,
  TestFramework,
} from './types';

const OPERATOR_TO_MATCHER: Record<RequirementOperator, string> = {
  equals: 'toBe',
  notEquals: 'not.toBe',
  gt: 'toBeGreaterThan',
  gte: 'toBeGreaterThanOrEqual',
  lt: 'toBeLessThan',
  lte: 'toBeLessThanOrEqual',
  contains: 'toContain',
  exists: 'toBeDefined',
};

export function generateTestSuite(
  ticketId: string,
  ticketTitle: string,
  requirements: RequirementCriterion[],
  decisions: MappingDecision[],
  framework: TestFramework,
  repoRoot: string,
  outputDir: string,
): GeneratedTestSuite {
  const primaryTarget = pickPrimaryTarget(decisions);
  const imports = buildImports(primaryTarget, framework, repoRoot, outputDir);
  const testCases = requirements.map((req) => {
    const decision = decisions.find(d => d.requirementId === req.id);
    return generateTestCase(req, decision, primaryTarget);
  });

  const ext = primaryTarget?.kind === 'component' ? '.rtc.test.tsx' : '.rtc.test.ts';
  const fileName = `${ticketId.toLowerCase().replace(/[^a-z0-9]/g, '-')}${ext}`;
  const source = renderSuite(ticketId, ticketTitle, imports, testCases, framework);

  return { ticketId, ticketTitle, fileName, imports, testCases, source, target: primaryTarget };
}

function pickPrimaryTarget(decisions: MappingDecision[]): SymbolTarget | undefined {
  for (const d of decisions) {
    if (d.accepted) return d.accepted.candidate;
    if (d.candidates.length > 0) return d.candidates[0].candidate;
  }
  return undefined;
}

function buildImports(
  target: SymbolTarget | undefined,
  framework: TestFramework,
  repoRoot: string,
  outputDir: string,
): GeneratedImport[] {
  const imports: GeneratedImport[] = [];

  if (framework === 'vitest') {
    imports.push({ modulePath: 'vitest', namedImports: ['describe', 'it', 'expect'] });
  }

  if (target) {
    const relPath = relativePath(outputDir, path.resolve(repoRoot, target.path));
    if (target.kind === 'component') {
      imports.push({ modulePath: relPath, namedImports: [target.symbol] });
      imports.push({ modulePath: '@testing-library/react', namedImports: ['render', 'screen'] });
    } else if (target.kind === 'hook') {
      imports.push({ modulePath: relPath, namedImports: [target.symbol] });
      imports.push({ modulePath: '@testing-library/react', namedImports: ['renderHook'] });
    } else {
      imports.push({ modulePath: relPath, namedImports: [target.symbol] });
    }
  }

  return imports;
}

function relativePath(from: string, to: string): string {
  let rel = path.relative(from, to).replace(/\\/g, '/');
  rel = rel.replace(/\.(tsx?|jsx?)$/, '');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

function generateTestCase(
  req: RequirementCriterion,
  decision: MappingDecision | undefined,
  primaryTarget: SymbolTarget | undefined,
): RequirementTestCase {
  if (decision && decision.policy === 'blocked' && decision.candidates.length === 0) {
    return {
      requirementId: req.id,
      title: statementToTitle(req),
      arrangeLines: [],
      actLines: [],
      assertLines: [],
      asyncMode: 'sync',
      skipped: true,
      skipReason: 'No mapping candidate found — manual test authoring required.',
    };
  }

  const target = decision?.accepted?.candidate ?? decision?.candidates[0]?.candidate ?? primaryTarget;
  const arrangeLines = buildArrange(req, target);
  const actLines = buildAct(req, target);
  const assertLines = buildAssert(req, target);
  const asyncMode = inferAsyncMode(req, target);

  return {
    requirementId: req.id,
    title: statementToTitle(req),
    arrangeLines,
    actLines,
    assertLines,
    asyncMode,
    skipped: false,
  };
}

function statementToTitle(req: RequirementCriterion): string {
  const thenSummary = req.then.length > 0
    ? req.then.map(t => `${t.field} ${t.operator} ${formatValue(t.value)}`).join(', ')
    : 'expected outcome';
  const whenSummary = req.when.length > 0
    ? req.when[0].statement
    : 'action is performed';
  return `${req.id}: ${truncate(whenSummary, 60)} → ${truncate(thenSummary, 40)}`;
}

function buildArrange(req: RequirementCriterion, target: SymbolTarget | undefined): string[] {
  const lines: string[] = [];
  for (const given of req.given) {
    lines.push(`// Given: ${given.statement}`);
  }
  if (req.given.length === 0) {
    lines.push('// Given: default preconditions');
  }
  if (target?.kind === 'component') {
    lines.push(`// TODO: set up props and context for <${target.symbol} />`);
    lines.push(`const props = {};`);
  } else if (target?.kind === 'hook') {
    lines.push(`// TODO: set up hook input parameters`);
  } else if (target) {
    lines.push(`// TODO: set up input for ${target.symbol}()`);
  }
  return lines;
}

function buildAct(req: RequirementCriterion, target: SymbolTarget | undefined): string[] {
  const lines: string[] = [];
  for (const when of req.when) {
    lines.push(`// When: ${when.statement}`);
  }
  if (!target) {
    lines.push('// TODO: invoke the action under test');
    lines.push('const result = undefined; // replace with actual call');
    return lines;
  }

  switch (target.kind) {
    case 'component':
      lines.push(`render(<${target.symbol} {...props} />);`);
      if (req.when.length > 0) {
        lines.push(`// TODO: simulate user interaction described above`);
      }
      break;
    case 'hook':
      lines.push(`const { result } = renderHook(() => ${target.symbol}());`);
      break;
    case 'function':
    case 'module':
      lines.push(`const result = ${target.symbol}(/* TODO: args from Given */);`);
      break;
    case 'class':
      lines.push(`const instance = new ${target.symbol}();`);
      lines.push(`const result = instance; // TODO: call the method under test`);
      break;
    default:
      lines.push(`const result = ${target.symbol}; // TODO: invoke correctly`);
  }
  return lines;
}

function buildAssert(req: RequirementCriterion, target: SymbolTarget | undefined): string[] {
  const lines: string[] = [];
  if (req.then.length === 0) {
    lines.push('// Then: no explicit expected values — add assertions manually');
    lines.push('expect(true).toBe(false); // RED: replace with real assertion');
    return lines;
  }
  for (const expected of req.then) {
    lines.push(buildExpectation(expected, target));
  }
  return lines;
}

function buildExpectation(ev: ExpectedValue, target: SymbolTarget | undefined): string {
  const matcher = OPERATOR_TO_MATCHER[ev.operator];

  if (target?.kind === 'component') {
    if (ev.operator === 'exists') {
      return `expect(screen.queryByText(${formatValue(ev.value)})).toBeDefined();`;
    }
    if (ev.operator === 'contains') {
      return `expect(screen.getByRole('generic')).toHaveTextContent(${formatValue(ev.value)});`;
    }
    return `expect(screen.getByText(${formatValue(ev.value)})).toBeInTheDocument();`;
  }

  const accessor = target?.kind === 'hook' ? `result.current.${ev.field}` : `result.${ev.field}`;

  if (ev.operator === 'exists') {
    return `expect(${accessor}).${matcher}();`;
  }

  const value = formatValue(ev.value);
  if (ev.operator === 'notEquals') {
    return `expect(${accessor}).not.toBe(${value});`;
  }
  return `expect(${accessor}).${matcher}(${value});`;
}

function formatValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return `"${value.replace(/"/g, '\\"')}"`;
  return String(value);
}

function inferAsyncMode(req: RequirementCriterion, target: SymbolTarget | undefined): 'sync' | 'async' {
  const text = [
    req.statement,
    ...req.when.map(w => w.statement),
    ...req.given.map(g => g.statement),
  ].join(' ').toLowerCase();
  if (/\b(?:async|await|fetch|api|network|timeout|delay|loading)\b/.test(text)) return 'async';
  if (target?.kind === 'hook') return 'async';
  return 'sync';
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function renderSuite(
  ticketId: string,
  ticketTitle: string,
  imports: GeneratedImport[],
  testCases: RequirementTestCase[],
  framework: TestFramework,
): string {
  const lines: string[] = [];

  lines.push(`/**`);
  lines.push(` * @generated by react-testgen RED phase`);
  lines.push(` * @rtc ${ticketId}`);
  lines.push(` *`);
  lines.push(` * These tests encode the requirements from the approved RTC.`);
  lines.push(` * They MUST fail until the implementation satisfies every acceptance criterion.`);
  lines.push(` */`);
  lines.push('');

  for (const imp of imports) {
    if (imp.defaultImport && imp.namedImports.length > 0) {
      lines.push(`import ${imp.defaultImport}, { ${imp.namedImports.join(', ')} } from '${imp.modulePath}';`);
    } else if (imp.defaultImport) {
      lines.push(`import ${imp.defaultImport} from '${imp.modulePath}';`);
    } else if (imp.namedImports.length > 0) {
      lines.push(`import { ${imp.namedImports.join(', ')} } from '${imp.modulePath}';`);
    }
  }
  lines.push('');

  const safeTitle = ticketTitle.replace(/"/g, '\\"');
  lines.push(`describe('${ticketId}: ${safeTitle}', () => {`);

  for (const tc of testCases) {
    lines.push('');
    if (tc.skipped) {
      lines.push(`  // @rtc-skip ${tc.requirementId}: ${tc.skipReason}`);
      lines.push(`  it.skip('${escapeQuote(tc.title)}', () => {`);
      lines.push(`    // ${tc.skipReason}`);
      lines.push(`  });`);
      continue;
    }

    const fn = tc.asyncMode === 'async' ? 'async ' : '';
    lines.push(`  // @rtc-requirement ${tc.requirementId}`);
    lines.push(`  it('${escapeQuote(tc.title)}', ${fn}() => {`);

    if (tc.arrangeLines.length > 0) {
      for (const line of tc.arrangeLines) lines.push(`    ${line}`);
      lines.push('');
    }
    if (tc.actLines.length > 0) {
      for (const line of tc.actLines) lines.push(`    ${line}`);
      lines.push('');
    }
    for (const line of tc.assertLines) lines.push(`    ${line}`);

    lines.push(`  });`);
  }

  lines.push('');

  const boundaryTests = testCases.flatMap((tc, i) => {
    const req = tc.requirementId;
    return [];
  });

  lines.push('});');
  lines.push('');

  return lines.join('\n');
}

function escapeQuote(s: string): string {
  return s.replace(/'/g, "\\'?");
}
