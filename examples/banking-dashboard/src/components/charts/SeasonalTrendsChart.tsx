/**
 * Q7 Visualization 2: Seasonal Trends Analysis
 * Chart: Line chart with multiple series
 * Data: Monthly transaction volumes by type
 * Insight: Identifies seasonal patterns in banking activity
 */

import { SeasonalTrend } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface SeasonalTrendsChartProps {
  data: SeasonalTrend[];
}

export function SeasonalTrendsChart({ data }: SeasonalTrendsChartProps) {
  const chartData = data.map((trend) => ({
    month: trend.month,
    deposits: trend.deposits,
    withdrawals: trend.withdrawals,
    transfers: trend.transfers,
    total: trend.transactionCount,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Seasonal Trends Analysis</CardTitle>
        <CardDescription>
          Monthly transaction patterns by type - identify peak periods and trends
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  return (
                    <div className="bg-card p-3 border border-border rounded-lg shadow-lg">
                      <p className="font-semibold">{data.month}</p>
                      <p className="text-sm text-chart-2">Deposits: {data.deposits}</p>
                      <p className="text-sm text-chart-5">Withdrawals: {data.withdrawals}</p>
                      <p className="text-sm text-chart-3">Transfers: {data.transfers}</p>
                      <p className="text-sm font-semibold mt-1">Total: {data.total}</p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="deposits"
              stroke="hsl(var(--chart-2))"
              strokeWidth={2}
              name="Deposits"
            />
            <Line
              type="monotone"
              dataKey="withdrawals"
              stroke="hsl(var(--chart-5))"
              strokeWidth={2}
              name="Withdrawals"
            />
            <Line
              type="monotone"
              dataKey="transfers"
              stroke="hsl(var(--chart-3))"
              strokeWidth={2}
              name="Transfers"
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
