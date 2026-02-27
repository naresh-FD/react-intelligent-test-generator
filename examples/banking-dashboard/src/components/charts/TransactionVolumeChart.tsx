/**
 * Q7 Visualization 4: Transaction Volume Trends
 * Chart: Area chart
 * Data: Daily/monthly transaction volumes
 * Insight: Shows transaction volume growth over time
 */

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { CleanedTransaction } from "@/lib/types";

interface TransactionVolumeChartProps {
  data: CleanedTransaction[];
}

export function TransactionVolumeChart({ data }: TransactionVolumeChartProps) {
  // Aggregate by month
  const monthlyVolume = new Map<string, { volume: number; count: number }>();

  data.forEach((transaction) => {
    const month = `${transaction.transactionDate.getFullYear()}-${String(
      transaction.transactionDate.getMonth() + 1
    ).padStart(2, "0")}`;

    if (!monthlyVolume.has(month)) {
      monthlyVolume.set(month, { volume: 0, count: 0 });
    }

    const current = monthlyVolume.get(month)!;
    current.volume += transaction.transactionAmount;
    current.count += 1;
  });

  const chartData = Array.from(monthlyVolume.entries())
    .map(([month, data]) => ({
      month,
      volume: Math.round(data.volume),
      count: data.count,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transaction Volume Trends</CardTitle>
        <CardDescription>
          Monthly transaction volumes - shows growth patterns over time
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={400}>
          <AreaChart data={chartData}>
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
                      <p className="text-sm">Volume: ${data.volume.toLocaleString()}</p>
                      <p className="text-sm">Transactions: {data.count}</p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Area
              type="monotone"
              dataKey="volume"
              stroke="hsl(var(--chart-1))"
              fill="hsl(var(--chart-1))"
              fillOpacity={0.6}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
