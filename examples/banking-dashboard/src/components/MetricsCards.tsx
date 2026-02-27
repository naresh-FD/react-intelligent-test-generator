import { DashboardMetrics } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  TrendingUp,
  Users,
  DollarSign,
  Activity,
  Building2,
  AlertTriangle,
} from "lucide-react";

interface MetricsCardsProps {
  metrics: DashboardMetrics;
}

export function MetricsCards({ metrics }: MetricsCardsProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat("en-US").format(num);
  };

  const cards = [
    {
      title: "Total Volume",
      value: formatCurrency(metrics.totalVolume),
      icon: DollarSign,
      description: "Total transaction amount",
      color: "text-chart-1",
    },
    {
      title: "Transactions",
      value: formatNumber(metrics.totalTransactions),
      icon: Activity,
      description: "Total number of transactions",
      color: "text-chart-2",
    },
    {
      title: "Unique Customers",
      value: formatNumber(metrics.uniqueCustomers),
      icon: Users,
      description: "Active customers",
      color: "text-chart-3",
    },
    {
      title: "Avg Transaction",
      value: formatCurrency(metrics.avgTransactionAmount),
      icon: TrendingUp,
      description: "Average per transaction",
      color: "text-chart-4",
    },
    {
      title: "Active Branches",
      value: formatNumber(metrics.activeBranches),
      icon: Building2,
      description: "Branches with activity",
      color: "text-chart-1",
    },
    {
      title: "Anomalies",
      value: formatNumber(metrics.anomalyCount),
      icon: AlertTriangle,
      description: "Flagged transactions",
      color: "text-destructive",
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
              <Icon className={`h-4 w-4 ${card.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{card.value}</div>
              <p className="text-xs text-muted-foreground mt-1">{card.description}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
