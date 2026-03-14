import fs from 'node:fs';
import path from 'node:path';
import {
  FailureSignature,
  HealReportAggregate,
  HealReportAttempt,
  HealReportEntry,
  HealReportPayload,
  HealReportStatus,
  RepairAction,
} from './types';

export function createHealReportEntry(
  params: {
    sourceFilePath: string;
    testFilePath: string;
    fileName?: string;
    componentNames?: string[];
    initialStatus?: HealReportStatus;
    finalStatus?: HealReportStatus;
  },
): HealReportEntry {
  const initialStatus = params.initialStatus ?? 'generated';
  return {
    sourceFilePath: params.sourceFilePath,
    testFilePath: params.testFilePath,
    fileName: params.fileName ?? path.basename(params.sourceFilePath),
    componentNames: [...(params.componentNames ?? [])],
    initialStatus,
    failureSignatures: [],
    promotedDefaultsApplied: [],
    repairActionsAttempted: [],
    retriesUsed: 0,
    finalStatus: params.finalStatus ?? initialStatus,
  };
}

export function setHealReportInitialStatus(
  reportEntry: HealReportEntry,
  initialStatus: HealReportStatus,
): HealReportEntry {
  return {
    ...reportEntry,
    initialStatus,
  };
}

export function addHealReportFailureSignature(
  reportEntry: HealReportEntry,
  signature: FailureSignature,
): HealReportEntry {
  if (reportEntry.failureSignatures.some((entry) => entry.fingerprint === signature.fingerprint)) {
    return reportEntry;
  }

  return {
    ...reportEntry,
    failureSignatures: [...reportEntry.failureSignatures, signature],
  };
}

export function appendHealReportAttempt(
  reportEntry: HealReportEntry,
  attempt: HealReportAttempt,
): HealReportEntry {
  const repairActionsAttempted = [
    ...reportEntry.repairActionsAttempted.filter(
      (entry) => !(entry.attemptNumber === attempt.attemptNumber && entry.action.id === attempt.action.id),
    ),
    attempt,
  ].sort((left, right) => {
    if (left.attemptNumber !== right.attemptNumber) {
      return left.attemptNumber - right.attemptNumber;
    }
    return left.action.id.localeCompare(right.action.id);
  });

  return {
    ...reportEntry,
    repairActionsAttempted,
    retriesUsed: Math.max(reportEntry.retriesUsed, attempt.attemptNumber),
    successfulRepair: attempt.success
      ? {
          attemptNumber: attempt.attemptNumber,
          action: attempt.action,
          strategyId: attempt.strategyId,
        }
      : reportEntry.successfulRepair,
  };
}

export function appendPromotedHealReportAction(
  reportEntry: HealReportEntry,
  promotedAction: HealReportEntry['promotedDefaultsApplied'][number],
): HealReportEntry {
  if (
    reportEntry.promotedDefaultsApplied.some(
      (entry) =>
        entry.action.id === promotedAction.action.id &&
        entry.strategyId === promotedAction.strategyId &&
        entry.trigger === promotedAction.trigger,
    )
  ) {
    return reportEntry;
  }

  return {
    ...reportEntry,
    promotedDefaultsApplied: [...reportEntry.promotedDefaultsApplied, promotedAction],
  };
}

export function finalizeHealReportEntry(
  reportEntry: HealReportEntry,
  params: {
    finalStatus: HealReportStatus;
    remainingBlocker?: string;
  },
): HealReportEntry {
  return {
    ...reportEntry,
    finalStatus: params.finalStatus,
    remainingBlocker: params.remainingBlocker,
  };
}

export function buildHealReport(entries: HealReportEntry[]): HealReportPayload {
  return {
    generatedAt: new Date().toISOString(),
    aggregate: buildHealReportAggregate(entries),
    entries: [...entries].sort((left, right) => left.fileName.localeCompare(right.fileName)),
  };
}

export function buildHealReportAggregate(entries: HealReportEntry[]): HealReportAggregate {
  const categoryCounts = new Map<FailureSignature['category'], number>();
  let initiallyFailing = 0;
  let fixed = 0;
  let unresolved = 0;
  let lowCoverage = 0;
  let passWithoutHealing = 0;
  let retriesUsed = 0;

  for (const entry of entries) {
    retriesUsed += entry.retriesUsed;
    if (entry.initialStatus === 'fail') {
      initiallyFailing += 1;
    }
    if (entry.finalStatus === 'pass' && entry.successfulRepair) {
      fixed += 1;
    }
    if (entry.finalStatus === 'fail') {
      unresolved += 1;
    }
    if (entry.finalStatus === 'low-coverage') {
      lowCoverage += 1;
    }
    if (entry.finalStatus === 'pass' && !entry.successfulRepair) {
      passWithoutHealing += 1;
    }
    for (const signature of entry.failureSignatures) {
      categoryCounts.set(signature.category, (categoryCounts.get(signature.category) ?? 0) + 1);
    }
  }

  return {
    totalEntries: entries.length,
    initiallyFailing,
    fixed,
    unresolved,
    lowCoverage,
    passWithoutHealing,
    retriesUsed,
    repeatedFailureCategories: [...categoryCounts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }
        return left.category.localeCompare(right.category);
      }),
  };
}

export function formatHealReportSummary(report: HealReportPayload): string {
  if (report.entries.length === 0) {
    return 'Heal report: no generated entries to summarize.';
  }

  const lines = [
    '',
    'HEAL REPORT',
    `Initial failures: ${report.aggregate.initiallyFailing}  |  Fixed: ${report.aggregate.fixed}  |  Unresolved: ${report.aggregate.unresolved}  |  Low coverage: ${report.aggregate.lowCoverage}  |  Retries used: ${report.aggregate.retriesUsed}`,
  ];

  const repeatedCategories = report.aggregate.repeatedFailureCategories
    .filter((entry) => entry.count > 0)
    .slice(0, 5)
    .map((entry) => `${entry.category}(${entry.count})`);
  if (repeatedCategories.length > 0) {
    lines.push(`Failure categories: ${repeatedCategories.join(', ')}`);
  }

  const interestingEntries = report.entries.filter(
    (entry) =>
      entry.initialStatus === 'fail' ||
      entry.finalStatus === 'fail' ||
      entry.finalStatus === 'low-coverage' ||
      entry.promotedDefaultsApplied.length > 0 ||
      entry.repairActionsAttempted.length > 0,
  );

  if (interestingEntries.length === 0) {
    lines.push('No self-heal actions were needed.');
    return lines.join('\n');
  }

  lines.push('Attention summary:');
  for (const entry of interestingEntries) {
    const repairedBy = entry.successfulRepair
      ? `fixed via ${entry.successfulRepair.action.id}`
      : entry.remainingBlocker
        ? `blocked by ${entry.remainingBlocker}`
        : 'no successful repair';
    const failureLabel = entry.failureSignatures[0]?.category ?? 'none';
    const promotedLabel = entry.promotedDefaultsApplied.length > 0
      ? ` | promoted ${entry.promotedDefaultsApplied.map((item) => item.action.id).join(', ')}`
      : '';
    lines.push(
      `- ${entry.fileName}: ${entry.initialStatus} -> ${entry.finalStatus} | ${failureLabel} | retries ${entry.retriesUsed} | ${repairedBy}${promotedLabel}`,
    );
  }

  return lines.join('\n');
}

export function getDefaultHealReportPath(rootDir: string): string {
  return path.join(rootDir, '.testgen-results', 'heal-report.json');
}

export function writeHealReportJson(reportPath: string, report: HealReportPayload): void {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
}

export function createHealAttempt(params: {
  attemptNumber: number;
  failure: FailureSignature;
  action: RepairAction;
  strategyId?: string;
  applied: boolean;
  success: boolean;
  reason: string;
  explanation?: string;
}): HealReportAttempt {
  return {
    attemptNumber: params.attemptNumber,
    failure: params.failure,
    action: params.action,
    strategyId: params.strategyId,
    applied: params.applied,
    success: params.success,
    reason: params.reason,
    explanation: params.explanation,
  };
}
