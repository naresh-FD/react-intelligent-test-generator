import { useMemo } from 'react';

export type ReconciliationClass = 'matched' | 'tolerated' | 'break';

export interface SettlementRecord {
  id: string;
  counterparty: string;
  currency: string;
  tradeDate: string;
  expectedAmount: number;
  settledAmount: number;
}

export interface ReconciliationRow extends SettlementRecord {
  deltaAmount: number;
  deltaBps: number;
  classification: ReconciliationClass;
}

export interface ReconciliationSummary {
  total: number;
  matched: number;
  tolerated: number;
  breaks: number;
  breakIds: string[];
  totalBreakAmount: number;
}

export interface ReconciliationResult {
  rows: ReconciliationRow[];
  summary: ReconciliationSummary;
}

const computeBps = (expected: number, delta: number): number => {
  if (expected === 0) {
    return delta === 0 ? 0 : Infinity;
  }
  return (delta / expected) * 10000;
};

const classifyRow = (
  deltaAbs: number,
  bpsAbs: number,
  materialityThreshold: number,
  autoToleranceBps: number
): ReconciliationClass => {
  if (deltaAbs <= materialityThreshold) {
    return 'matched';
  }
  if (bpsAbs <= autoToleranceBps) {
    return 'tolerated';
  }
  return 'break';
};

export function useReconciliationMetrics(
  records: SettlementRecord[],
  materialityThreshold: number,
  autoToleranceBps: number
): ReconciliationResult {
  return useMemo(() => {
    const rows = records
      .map((record) => {
        const deltaAmount = record.settledAmount - record.expectedAmount;
        const deltaBps = computeBps(record.expectedAmount, deltaAmount);
        const classification = classifyRow(
          Math.abs(deltaAmount),
          Math.abs(deltaBps),
          materialityThreshold,
          autoToleranceBps
        );

        return {
          ...record,
          deltaAmount,
          deltaBps,
          classification,
        };
      })
      .sort((left, right) => Math.abs(right.deltaAmount) - Math.abs(left.deltaAmount));

    const breakRows = rows.filter((row) => row.classification === 'break');
    const summary: ReconciliationSummary = {
      total: rows.length,
      matched: rows.filter((row) => row.classification === 'matched').length,
      tolerated: rows.filter((row) => row.classification === 'tolerated').length,
      breaks: breakRows.length,
      breakIds: breakRows.map((row) => row.id),
      totalBreakAmount: breakRows.reduce((sum, row) => sum + Math.abs(row.deltaAmount), 0),
    };

    return {
      rows,
      summary,
    };
  }, [records, materialityThreshold, autoToleranceBps]);
}

export default useReconciliationMetrics;
