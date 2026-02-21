import { useMemo } from 'react';

export interface DeskExposure {
  desk: string;
  notional: number;
  var95: number;
  expectedShortfall: number;
}

export interface RiskLimitConfig {
  maxVar95: number;
  maxExpectedShortfall: number;
  concentrationWarning: number;
  concentrationBreach: number;
}

export type RiskStatus = 'ok' | 'warning' | 'breach';

export interface DeskConcentration {
  desk: string;
  share: number;
  notional: number;
}

export interface RiskLimitResult {
  totalNotional: number;
  totalVar95: number;
  totalExpectedShortfall: number;
  varUtilization: number;
  expectedShortfallUtilization: number;
  maxDeskConcentration: number;
  concentrationByDesk: DeskConcentration[];
  hhiConcentration: number;
  status: RiskStatus;
  breachedRules: string[];
}

const safeRatio = (value: number, limit: number): number => {
  if (limit <= 0) {
    return 0;
  }
  return value / limit;
};

export function useRiskLimits(exposures: DeskExposure[], limits: RiskLimitConfig): RiskLimitResult {
  return useMemo(() => {
    const totalNotional = exposures.reduce((sum, item) => sum + Math.abs(item.notional), 0);
    const totalVar95 = exposures.reduce((sum, item) => sum + Math.max(item.var95, 0), 0);
    const totalExpectedShortfall = exposures.reduce(
      (sum, item) => sum + Math.max(item.expectedShortfall, 0),
      0
    );

    const concentrationByDesk = exposures
      .map((item) => ({
        desk: item.desk,
        notional: item.notional,
        share: totalNotional === 0 ? 0 : Math.abs(item.notional) / totalNotional,
      }))
      .sort((left, right) => right.share - left.share);

    const hhiConcentration = concentrationByDesk.reduce((sum, item) => sum + item.share ** 2, 0);
    const maxDeskConcentration = concentrationByDesk[0]?.share || 0;

    const varUtilization = safeRatio(totalVar95, limits.maxVar95);
    const expectedShortfallUtilization = safeRatio(
      totalExpectedShortfall,
      limits.maxExpectedShortfall
    );

    const breachedRules: string[] = [];

    if (varUtilization >= 1) {
      breachedRules.push('VaR 95% limit breached');
    } else if (varUtilization >= 0.8) {
      breachedRules.push('VaR 95% near limit');
    }

    if (expectedShortfallUtilization >= 1) {
      breachedRules.push('Expected shortfall limit breached');
    } else if (expectedShortfallUtilization >= 0.8) {
      breachedRules.push('Expected shortfall near limit');
    }

    if (maxDeskConcentration >= limits.concentrationBreach) {
      breachedRules.push('Desk concentration limit breached');
    } else if (maxDeskConcentration >= limits.concentrationWarning) {
      breachedRules.push('Desk concentration near limit');
    }

    let status: RiskStatus = 'ok';
    if (
      varUtilization >= 1 ||
      expectedShortfallUtilization >= 1 ||
      maxDeskConcentration >= limits.concentrationBreach
    ) {
      status = 'breach';
    } else if (
      varUtilization >= 0.8 ||
      expectedShortfallUtilization >= 0.8 ||
      maxDeskConcentration >= limits.concentrationWarning
    ) {
      status = 'warning';
    }

    return {
      totalNotional,
      totalVar95,
      totalExpectedShortfall,
      varUtilization,
      expectedShortfallUtilization,
      maxDeskConcentration,
      concentrationByDesk,
      hhiConcentration,
      status,
      breachedRules,
    };
  }, [exposures, limits]);
}

export default useRiskLimits;
