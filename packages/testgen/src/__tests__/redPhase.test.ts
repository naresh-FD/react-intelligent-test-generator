import path from 'path';
import fs from 'fs';
import { generateTestSuite } from '../redPhase/templateEngine';
import { runRedPhase } from '../redPhase/runner';
import type { RequirementTestContract, RequirementCriterion } from '../requirements/types';
import type { MappingResult, MappingDecision } from '../mapping/types';
import { rtcContentHash } from '../requirements/hash';
import { scoreReadiness } from '../requirements/scoring';

function buildRequirement(overrides: Partial<RequirementCriterion> & { id: string; statement: string }): RequirementCriterion {
  return {
    sourcePointer: 'test',
    given: [],
    when: [],
    then: [],
    boundaries: [],
    errors: [],
    sideEffects: [],
    externalDependencies: [],
    testExamples: [],
    ...overrides,
  };
}

function buildHighScoreRequirement(id: string, statement: string, field: string, value: unknown): RequirementCriterion {
  return buildRequirement({
    id,
    statement,
    given: [{ statement: 'precondition is met' }],
    when: [{ statement: 'the user performs the action' }],
    then: [{
      field,
      operator: 'equals',
      value: value as string | number | boolean | null,
      provenance: 'explicit',
      businessCritical: false,
      evidence: { segmentId: 'seg-1', excerpt: statement, start: 0, end: statement.length },
    }],
    observableOutcome: { type: 'domain-result', statement: `${field} becomes ${value}` },
    boundaries: [{ statement: 'at least 1 item', provenance: 'explicit', status: 'specified' }],
    errors: [{ statement: 'invalid input rejected', provenance: 'explicit', status: 'specified' }],
    externalDependencies: [{ statement: 'none', provenance: 'explicit', status: 'notApplicable', approved: true }],
    testExamples: [{ statement: 'for example 5 items', provenance: 'explicit', status: 'specified' }],
  });
}

function buildRtc(requirements: RequirementCriterion[], status: 'approved' | 'review-required' = 'review-required'): RequirementTestContract {
  const ambiguities: RequirementTestContract['ambiguities'] = [];
  const readiness = scoreReadiness(requirements, ambiguities);
  const base: RequirementTestContract = {
    schemaVersion: '1.0.0',
    contractId: 'test-contract-1',
    status,
    source: {
      provider: 'mock-ado',
      ticketId: 'AB-1001',
      revision: 'rev-1',
      updatedAt: '2026-01-01T00:00:00Z',
      snapshotHash: 'a'.repeat(64),
    },
    ticket: {
      type: 'feature',
      title: 'Add expense category filter',
      risk: 'low',
      labels: ['expense-management'],
      oracleMode: 'requirement',
    },
    requirements,
    ambiguities,
    readiness,
    approval: {
      requirementOwner: null,
      approvedAt: null,
      approvedRtcHash: null,
      approvedTicketRevision: null,
      approvedSnapshotHash: null,
    },
    generation: {
      extractorVersion: '1.0.0',
      llmAssisted: false,
      inferredExpectedValues: false,
    },
  };
  if (status === 'approved') {
    base.approval = {
      requirementOwner: 'test-owner',
      approvedAt: '2026-01-01T00:00:00Z',
      approvedRtcHash: rtcContentHash(base),
      approvedTicketRevision: 'rev-1',
      approvedSnapshotHash: 'a'.repeat(64),
    };
  }
  return base;
}

function buildMapping(ticketId: string, decisions: MappingDecision[]): MappingResult {
  return {
    ticketId,
    rtcHash: 'b'.repeat(64),
    decisions,
    generatedAt: '2026-01-01T00:00:00Z',
  };
}

function buildDecision(requirementId: string): MappingDecision {
  return {
    requirementId,
    policy: 'review-required',
    candidates: [{
      requirement: requirementId,
      candidate: {
        path: 'src/components/ExpenseFilters.tsx',
        symbol: 'ExpenseFilters',
        kind: 'component',
        line: 10,
      },
      confidence: 0.72,
      evidence: [
        { kind: 'lexical', score: 0.80, detail: 'Lexical match on expense, filter' },
        { kind: 'callGraph', score: 0.65, detail: 'Connected to expenseService' },
      ],
      penalties: [],
    }],
    reason: 'Confidence 72% — engineer must approve.',
  };
}

function buildFunctionDecision(requirementId: string): MappingDecision {
  return {
    requirementId,
    policy: 'auto-map',
    candidates: [{
      requirement: requirementId,
      candidate: {
        path: 'src/utils/expenseHelpers.ts',
        symbol: 'filterExpenses',
        kind: 'function',
        line: 5,
      },
      confidence: 0.90,
      evidence: [
        { kind: 'lexical', score: 0.90, detail: 'Lexical match on expense, filter' },
      ],
      penalties: [],
    }],
    reason: 'Auto-mapped.',
  };
}

const OUTPUT_DIR = path.join(__dirname, '../../.test-output/red');

describe('redPhase/templateEngine', () => {
  it('generates a test suite from requirements and mapping', () => {
    const req = buildRequirement({
      id: 'AC-01',
      statement: 'Filter expenses by category',
      given: [{ statement: 'expenses with category Food exist' }],
      when: [{ statement: 'the user selects the Food category filter' }],
      then: [
        { field: 'categoryFilterActive', operator: 'equals', value: true, provenance: 'explicit', businessCritical: false },
      ],
    });

    const decision = buildDecision('AC-01');
    const suite = generateTestSuite('AB-1001', 'Add expense category filter', [req], [decision], 'jest', process.cwd(), OUTPUT_DIR);

    expect(suite.ticketId).toBe('AB-1001');
    expect(suite.fileName).toBe('ab-1001.rtc.test.tsx');
    expect(suite.testCases).toHaveLength(1);
    expect(suite.testCases[0].skipped).toBe(false);
    expect(suite.source).toContain('ExpenseFilters');
    expect(suite.source).toContain('toBeInTheDocument()');
  });

  it('generates imports for component targets with testing-library', () => {
    const req = buildRequirement({ id: 'AC-01', statement: 'test' });
    const decision = buildDecision('AC-01');
    const suite = generateTestSuite('AB-1001', 'Test', [req], [decision], 'jest', process.cwd(), OUTPUT_DIR);

    expect(suite.source).toContain("@testing-library/react");
    expect(suite.source).toContain('render');
    expect(suite.source).toContain('screen');
  });

  it('generates vitest imports when framework is vitest', () => {
    const req = buildRequirement({ id: 'AC-01', statement: 'test' });
    const decision = buildDecision('AC-01');
    const suite = generateTestSuite('AB-1001', 'Test', [req], [decision], 'vitest', process.cwd(), OUTPUT_DIR);

    expect(suite.source).toContain("from 'vitest'");
    expect(suite.source).toContain('describe');
  });

  it('maps operators to correct jest matchers', () => {
    const req = buildRequirement({
      id: 'AC-01',
      statement: 'boundary check',
      then: [
        { field: 'count', operator: 'gte', value: 5, provenance: 'explicit', businessCritical: false },
        { field: 'name', operator: 'contains', value: 'test', provenance: 'explicit', businessCritical: false },
        { field: 'active', operator: 'exists', provenance: 'explicit', businessCritical: false },
      ],
    });

    const decision = buildFunctionDecision('AC-01');
    const suite = generateTestSuite('AB-1001', 'Boundary', [req], [decision], 'jest', process.cwd(), OUTPUT_DIR);

    expect(suite.source).toContain('toBeGreaterThanOrEqual(5)');
    expect(suite.source).toContain('toContain("test")');
    expect(suite.source).toContain('toBeDefined()');
  });

  it('skips tests when mapping has no candidates', () => {
    const req = buildRequirement({ id: 'AC-01', statement: 'unmapped' });
    const emptyDecision: MappingDecision = {
      requirementId: 'AC-01',
      policy: 'blocked',
      candidates: [],
      reason: 'No candidates',
    };
    const suite = generateTestSuite('AB-1001', 'Unmapped', [req], [emptyDecision], 'jest', process.cwd(), OUTPUT_DIR);

    expect(suite.testCases[0].skipped).toBe(true);
    expect(suite.source).toContain('it.skip');
  });

  it('generates multiple test cases for multiple requirements', () => {
    const reqs = [
      buildRequirement({
        id: 'AC-01',
        statement: 'first requirement',
        then: [{ field: 'a', operator: 'equals', value: 1, provenance: 'explicit', businessCritical: false }],
      }),
      buildRequirement({
        id: 'AC-02',
        statement: 'second requirement',
        then: [{ field: 'b', operator: 'equals', value: 2, provenance: 'explicit', businessCritical: false }],
      }),
    ];
    const decisions = [buildDecision('AC-01'), buildDecision('AC-02')];
    const suite = generateTestSuite('AB-1001', 'Multi', reqs, decisions, 'jest', process.cwd(), OUTPUT_DIR);

    expect(suite.testCases).toHaveLength(2);
    expect(suite.source).toContain('AC-01');
    expect(suite.source).toContain('AC-02');
  });

  it('includes the RTC ticket ID annotation in the generated source', () => {
    const req = buildRequirement({ id: 'AC-01', statement: 'annotated' });
    const decision = buildDecision('AC-01');
    const suite = generateTestSuite('AB-1001', 'Annotated', [req], [decision], 'jest', process.cwd(), OUTPUT_DIR);

    expect(suite.source).toContain('@rtc AB-1001');
    expect(suite.source).toContain('@rtc-requirement AC-01');
  });
});

describe('redPhase/runner', () => {
  afterAll(() => {
    if (fs.existsSync(OUTPUT_DIR)) {
      fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
    }
  });

  it('rejects a blocked RTC', () => {
    const req = buildRequirement({ id: 'AC-01', statement: 'blocked' });
    const rtc = buildRtc([req]);
    rtc.status = 'blocked';
    const mapping = buildMapping('AB-1001', [buildDecision('AC-01')]);

    expect(() =>
      runRedPhase({ rtc, mapping, config: { framework: 'jest', outputDir: OUTPUT_DIR, dryRun: true }, repoRoot: process.cwd() })
    ).toThrow(/blocked/i);
  });

  it('rejects mismatched ticket IDs', () => {
    const req = buildHighScoreRequirement('AC-01', 'mismatch check', 'ok', true);
    const rtc = buildRtc([req]);
    const mapping = buildMapping('AB-9999', [buildDecision('AC-01')]);

    expect(() =>
      runRedPhase({ rtc, mapping, config: { framework: 'jest', outputDir: OUTPUT_DIR, dryRun: true }, repoRoot: process.cwd() })
    ).toThrow(/AB-9999.*AB-1001/);
  });

  it('runs in dry-run mode without writing files', () => {
    const req = buildHighScoreRequirement('AC-01', 'dry run test', 'result', true);
    const rtc = buildRtc([req]);
    const mapping = buildMapping('AB-1001', [buildDecision('AC-01')]);

    const result = runRedPhase({
      rtc,
      mapping,
      config: { framework: 'jest', outputDir: OUTPUT_DIR, dryRun: true },
      repoRoot: process.cwd(),
    });

    expect(result.ticketId).toBe('AB-1001');
    expect(result.summary.testsGenerated).toBe(1);
    expect(result.summary.testsSkipped).toBe(0);
    expect(result.suites).toHaveLength(1);
    expect(result.suites[0].source).toContain('toBeInTheDocument()');
    expect(fs.existsSync(path.join(OUTPUT_DIR, 'ab-1001.rtc.test.tsx'))).toBe(false);
  });

  it('generates source with correct RTC annotations', () => {
    const req = buildHighScoreRequirement('AC-01', 'write test', 'written', true);
    const rtc = buildRtc([req]);
    const mapping = buildMapping('AB-1001', [buildDecision('AC-01')]);

    const result = runRedPhase({
      rtc,
      mapping,
      config: { framework: 'jest', outputDir: OUTPUT_DIR, dryRun: true },
      repoRoot: process.cwd(),
    });

    const source = result.suites[0].source;
    expect(source).toContain('@rtc AB-1001');
    expect(source).toContain('@rtc-requirement AC-01');
    expect(source).toContain('toBeInTheDocument()');
  });

  it('returns correct summary counts', () => {
    const reqs = [
      buildHighScoreRequirement('AC-01', 'mapped requirement', 'x', 1),
      buildHighScoreRequirement('AC-02', 'unmapped requirement', 'y', 2),
    ];
    const decisions: MappingDecision[] = [
      buildDecision('AC-01'),
      { requirementId: 'AC-02', policy: 'blocked', candidates: [], reason: 'No match' },
    ];
    const rtc = buildRtc(reqs);
    const mapping = buildMapping('AB-1001', decisions);

    const result = runRedPhase({
      rtc,
      mapping,
      config: { framework: 'jest', outputDir: OUTPUT_DIR, dryRun: true },
      repoRoot: process.cwd(),
    });

    expect(result.summary.testsGenerated).toBe(1);
    expect(result.summary.testsSkipped).toBe(1);
    expect(result.summary.totalRequirements).toBe(2);
  });
});
