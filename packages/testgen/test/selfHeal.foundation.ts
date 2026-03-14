import assert from 'node:assert/strict';
import {
  FAILURE_CATEGORIES,
  NOOP_REPAIR_ACTION,
  appendHealReportAttempt,
  buildHealingMemoryKey,
  classifyFailure,
  createHealAttempt,
  createHealReportEntry,
  createHealingMemoryEntry,
  createHealingMemoryState,
  createRepairResult,
  detectFailureCategory,
  isPromotableRepair,
  upsertHealingMemoryEntry,
} from '../src/selfHeal/index';

function run(): void {
  assert.ok(FAILURE_CATEGORIES.includes('router-missing'));

  const providerSignature = classifyFailure('useNavigate() may be used only in the context of a <Router> component');
  assert.equal(providerSignature.category, 'router-missing');
  assert.match(providerSignature.fingerprint, /^router-missing:/);
  assert.equal(providerSignature.confidence, 0.99);

  const importCategory = detectFailureCategory("Cannot find module './broken/import'");
  assert.equal(importCategory, 'bad-import-resolution');

  const repairResult = createRepairResult(NOOP_REPAIR_ACTION, {
    applied: false,
    reason: 'No-op foundation check',
  });
  assert.equal(repairResult.action.id, 'noop');
  assert.equal(repairResult.applied, false);

  const state = createHealingMemoryState();
  const memoryEntry = createHealingMemoryEntry({
    signature: providerSignature,
    action: {
      id: 'wrap-memory-router',
      kind: 'wrap',
      description: 'Wrap test render with MemoryRouter',
      deterministic: true,
      safeToPromote: true,
    },
    attempts: 1,
    successes: 1,
    lastAppliedAt: '2026-01-01T00:00:00.000Z',
  });
  const updatedState = upsertHealingMemoryEntry(state, memoryEntry);
  const memoryKey = buildHealingMemoryKey(providerSignature.fingerprint, 'wrap-memory-router');
  assert.ok(updatedState.entries[memoryKey]);
  assert.equal(isPromotableRepair(memoryEntry.action), true);

  const reportEntry = appendHealReportAttempt(
    createHealReportEntry({
      sourceFilePath: 'src/components/Widget.tsx',
      testFilePath: 'src/__tests__/Widget.test.tsx',
    }),
    createHealAttempt({
      attemptNumber: 1,
      failure: providerSignature,
      action: memoryEntry.action,
      applied: false,
      success: false,
      reason: repairResult.reason,
    }),
  );
  assert.equal(reportEntry.repairActionsAttempted.length, 1);

  console.log('Self-heal foundation checks passed');
}

run();
