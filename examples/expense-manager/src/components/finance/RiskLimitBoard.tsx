import { AlertTriangle, ShieldCheck, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { formatCurrency, formatPercentage } from '@/utils/formatters';
import { cn } from '@/utils/helpers';
import { DeskExposure, RiskLimitConfig, useRiskLimits } from '@/hooks/useRiskLimits';

interface RiskLimitBoardProps {
  exposures: DeskExposure[];
  limits: RiskLimitConfig;
  onEscalate?: (rules: string[]) => void;
}

const toPercent = (value: number): string => `${(value * 100).toFixed(1)}%`;

export function RiskLimitBoard({ exposures, limits, onEscalate }: RiskLimitBoardProps) {
  const metrics = useRiskLimits(exposures, limits);

  const statusConfig =
    metrics.status === 'breach'
      ? {
          label: 'Breach',
          icon: <ShieldAlert className="h-4 w-4 text-destructive" />,
          className: 'bg-destructive/10 text-destructive border-destructive/30',
        }
      : metrics.status === 'warning'
        ? {
            label: 'Warning',
            icon: <AlertTriangle className="h-4 w-4 text-amber-600" />,
            className: 'bg-amber-100 text-amber-800 border-amber-300',
          }
        : {
            label: 'Within Limit',
            icon: <ShieldCheck className="h-4 w-4 text-emerald-600" />,
            className: 'bg-emerald-100 text-emerald-700 border-emerald-300',
          };

  return (
    <section
      className="space-y-4 rounded-lg border border-border p-4"
      aria-label="Risk limit board"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold">Risk Limits</h2>
        <span
          className={cn(
            'inline-flex items-center gap-2 rounded-md border px-3 py-1 text-sm',
            statusConfig.className
          )}
        >
          {statusConfig.icon}
          {statusConfig.label}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">VaR 95% Utilization</p>
          <p className="text-sm font-semibold">
            {formatPercentage(metrics.varUtilization * 100, 1)}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatCurrency(metrics.totalVar95)} / {formatCurrency(limits.maxVar95)}
          </p>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">Expected Shortfall Utilization</p>
          <p className="text-sm font-semibold">
            {formatPercentage(metrics.expectedShortfallUtilization * 100, 1)}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatCurrency(metrics.totalExpectedShortfall)} /{' '}
            {formatCurrency(limits.maxExpectedShortfall)}
          </p>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">Max Desk Concentration</p>
          <p className="text-sm font-semibold">{toPercent(metrics.maxDeskConcentration)}</p>
          <p className="text-xs text-muted-foreground">
            HHI: {metrics.hhiConcentration.toFixed(3)}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left">Desk</th>
              <th className="px-3 py-2 text-right">Notional</th>
              <th className="px-3 py-2 text-right">Concentration</th>
            </tr>
          </thead>
          <tbody>
            {metrics.concentrationByDesk.map((row) => (
              <tr key={row.desk} className="border-t border-border">
                <td className="px-3 py-2">{row.desk}</td>
                <td className="px-3 py-2 text-right">{formatCurrency(row.notional)}</td>
                <td className="px-3 py-2 text-right">{toPercent(row.share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {metrics.breachedRules.length > 0 && (
        <ul className="space-y-1 text-sm text-muted-foreground" aria-label="risk-breaches">
          {metrics.breachedRules.map((rule) => (
            <li key={rule}>- {rule}</li>
          ))}
        </ul>
      )}

      <Button
        variant="destructive"
        disabled={metrics.status !== 'breach'}
        onClick={() => onEscalate?.(metrics.breachedRules)}
      >
        Escalate Breach
      </Button>
    </section>
  );
}

export default RiskLimitBoard;
