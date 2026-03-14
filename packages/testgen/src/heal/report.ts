/**
 * Heal report — structured output summarising each healing session.
 * Emitted after every verify-and-retry cycle.
 */

import type { FailureClass } from './classifier';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HealAttempt {
  attempt: number;
  failureClass: FailureClass;
  reason: string;
  strategyApplied: string;
  succeeded: boolean;
}

export interface HealFileReport {
  file: string;
  testFile: string;
  status: 'healed' | 'failed' | 'passed_first_try' | 'skipped';
  attempts: HealAttempt[];
  finalCoverage: number;
  totalAttempts: number;
}

export interface HealSessionReport {
  timestamp: string;
  files: HealFileReport[];
  summary: {
    total: number;
    healed: number;
    failed: number;
    passedFirstTry: number;
    skipped: number;
  };
  promotions: Array<{
    failureClass: string;
    strategy: string;
    rate: number;
    uses: number;
  }>;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function createSessionReport(): HealSessionReport {
  return {
    timestamp: new Date().toISOString(),
    files: [],
    summary: {
      total: 0,
      healed: 0,
      failed: 0,
      passedFirstTry: 0,
      skipped: 0,
    },
    promotions: [],
  };
}

export function addFileReport(session: HealSessionReport, report: HealFileReport): void {
  session.files.push(report);
  session.summary.total++;
  switch (report.status) {
    case 'healed':
      session.summary.healed++;
      break;
    case 'failed':
      session.summary.failed++;
      break;
    case 'passed_first_try':
      session.summary.passedFirstTry++;
      break;
    case 'skipped':
      session.summary.skipped++;
      break;
  }
}

// ---------------------------------------------------------------------------
// Console output
// ---------------------------------------------------------------------------

export function printHealReport(session: HealSessionReport): void {
  const { summary } = session;
  const divider = '─'.repeat(72);

  console.log(`\n${divider}`);
  console.log(' SELF-HEAL REPORT');
  console.log(divider);

  for (const file of session.files) {
    if (file.status === 'skipped') continue;

    const icon =
      file.status === 'healed' ? '🩹' :
      file.status === 'passed_first_try' ? '✅' :
      '❌';
    console.log(`\n${icon} ${file.file}  [${file.status}]  coverage: ${file.finalCoverage.toFixed(1)}%`);

    for (const attempt of file.attempts) {
      const aIcon = attempt.succeeded ? '  ✓' : '  ✗';
      console.log(
        `${aIcon} attempt ${attempt.attempt}: [${attempt.failureClass}] → ${attempt.strategyApplied}`
      );
      if (attempt.reason) {
        console.log(`      ${attempt.reason}`);
      }
    }
  }

  console.log(`\n${divider}`);
  console.log(
    ` Total: ${summary.total}  |  ✅ First-try: ${summary.passedFirstTry}  |  🩹 Healed: ${summary.healed}  |  ❌ Failed: ${summary.failed}  |  ⏭️  Skipped: ${summary.skipped}`
  );

  if (session.promotions.length > 0) {
    console.log(`\n📈 Promotable strategies (win-rate ≥ 80%, uses ≥ 3):`);
    for (const p of session.promotions) {
      console.log(
        `   ${p.failureClass} → ${p.strategy}  (${(p.rate * 100).toFixed(0)}% over ${p.uses} uses)`
      );
    }
  }

  console.log(divider);
}
