import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { formatCurrency } from '@/utils/formatters';
import { SettlementRecord, useReconciliationMetrics } from '@/hooks/useReconciliationMetrics';

interface SettlementReconciliationProps {
  records: SettlementRecord[];
  materialityThreshold: number;
  autoToleranceBps: number;
  onApproveTolerated?: (ids: string[]) => void;
  onEscalateBreaks?: (ids: string[]) => void;
}

const formatBps = (value: number): string => {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)} bps`;
};

const classificationVariant = (classification: 'matched' | 'tolerated' | 'break') => {
  if (classification === 'break') return 'destructive' as const;
  if (classification === 'tolerated') return 'warning' as const;
  return 'success' as const;
};

export function SettlementReconciliation({
  records,
  materialityThreshold,
  autoToleranceBps,
  onApproveTolerated,
  onEscalateBreaks,
}: SettlementReconciliationProps) {
  const { rows, summary } = useReconciliationMetrics(
    records,
    materialityThreshold,
    autoToleranceBps
  );
  const toleratedIds = rows
    .filter((row) => row.classification === 'tolerated')
    .map((row) => row.id);

  return (
    <section
      className="space-y-4 rounded-lg border border-border p-4"
      aria-label="settlement-reconciliation"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold">Settlement Reconciliation</h2>
        <div className="text-xs text-muted-foreground">
          Materiality: {formatCurrency(materialityThreshold)} | Auto Tolerance: {autoToleranceBps}{' '}
          bps
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">Total Records</p>
          <p className="text-sm font-semibold">{summary.total}</p>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">Matched</p>
          <p className="text-sm font-semibold">{summary.matched}</p>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">Tolerated</p>
          <p className="text-sm font-semibold">{summary.tolerated}</p>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">Break Amount</p>
          <p className="text-sm font-semibold">{formatCurrency(summary.totalBreakAmount)}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left">Counterparty</th>
              <th className="px-3 py-2 text-right">Expected</th>
              <th className="px-3 py-2 text-right">Settled</th>
              <th className="px-3 py-2 text-right">Delta</th>
              <th className="px-3 py-2 text-right">Delta (bps)</th>
              <th className="px-3 py-2 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="px-3 py-2">{row.counterparty}</td>
                <td className="px-3 py-2 text-right">
                  {formatCurrency(row.expectedAmount, row.currency)}
                </td>
                <td className="px-3 py-2 text-right">
                  {formatCurrency(row.settledAmount, row.currency)}
                </td>
                <td className="px-3 py-2 text-right">
                  {formatCurrency(row.deltaAmount, row.currency)}
                </td>
                <td className="px-3 py-2 text-right">{formatBps(row.deltaBps)}</td>
                <td className="px-3 py-2 text-center">
                  <Badge variant={classificationVariant(row.classification)}>
                    {row.classification}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={toleratedIds.length === 0}
          onClick={() => onApproveTolerated?.(toleratedIds)}
        >
          Approve Tolerated
        </Button>
        <Button
          variant="destructive"
          disabled={summary.breaks === 0}
          onClick={() => onEscalateBreaks?.(summary.breakIds)}
        >
          Escalate Breaks
        </Button>
      </div>
    </section>
  );
}

export default SettlementReconciliation;
