import { postBoardComment, assertNeverTransitionsTicketState } from '../reportPhase/adoWriter';
import type { BoardReport } from '../reportPhase/types';
import type { WorkItemProvider } from '../workItems/types';

const STUB_REPORT: BoardReport = {
  schemaVersion: 1,
  ticketId: 'AB-3001',
  generatedAt: '2026-08-29T00:00:00Z',
  requirementStatuses: [],
  blockedOrLowConfidence: [],
  overallStatus: 'ALL_SATISFIED',
  comment: 'Automated test gate summary — all requirements satisfied.',
};

function makeProvider(overrides?: Partial<WorkItemProvider>): WorkItemProvider {
  return {
    provider: 'ado',
    getTicket: () => Promise.reject(new Error('stub')),
    searchTickets: () => Promise.resolve([]),
    getRevision: () => Promise.reject(new Error('stub')),
    getRelations: () => Promise.resolve([]),
    ...overrides,
  };
}

describe('postBoardComment', () => {
  it('returns postedToAdo=false when provider lacks addComment', async () => {
    const result = await postBoardComment(STUB_REPORT, makeProvider(), '/reports/AB-3001.json');
    expect(result.postedToAdo).toBe(false);
    expect(result.adoError).toMatch(/addComment/);
    expect(result.ticketId).toBe('AB-3001');
    expect(result.adoCommentId).toBeUndefined();
  });

  it('returns postedToAdo=true and adoCommentId when addComment succeeds', async () => {
    const provider = makeProvider({ addComment: jest.fn().mockResolvedValue(42) });
    const result = await postBoardComment(STUB_REPORT, provider, '/reports/AB-3001.json');
    expect(result.postedToAdo).toBe(true);
    expect(result.adoCommentId).toBe(42);
    expect(result.adoError).toBeUndefined();
  });

  it('forwards project to provider.addComment when provided', async () => {
    const addComment = jest.fn().mockResolvedValue(99);
    const provider = makeProvider({ addComment });
    await postBoardComment(STUB_REPORT, provider, '/reports/AB-3001.json', 'MyProject');
    expect(addComment).toHaveBeenCalledWith(
      expect.objectContaining({ project: 'MyProject', id: 'AB-3001' }),
      STUB_REPORT.comment,
    );
  });

  it('returns postedToAdo=false and adoError when addComment throws', async () => {
    const provider = makeProvider({
      addComment: jest.fn().mockRejectedValue(new Error('Network timeout from ADO')),
    });
    const result = await postBoardComment(STUB_REPORT, provider, '/reports/AB-3001.json');
    expect(result.postedToAdo).toBe(false);
    expect(result.adoError).toContain('Network timeout from ADO');
    expect(result.report).toBe(STUB_REPORT);
    expect(result.reportPath).toBe('/reports/AB-3001.json');
  });

  it('assertNeverTransitionsTicketState is a callable no-op guard', () => {
    expect(() => assertNeverTransitionsTicketState()).not.toThrow();
  });
});
