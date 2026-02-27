/**
 * Q7 Visualization 1: Branch Performance Dashboard
 * Chart: Horizontal bar chart
 * Data: Total transaction volume by branch
 * Insight: Identifies top/bottom performing branches
 */

import { BranchPerformance } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface BranchPerformanceChartProps {
  data: BranchPerformance[];
}

export function BranchPerformanceChart({ data }: BranchPerformanceChartProps) {
  // Take top 10 branches by performance score
  const chartData = data.slice(0, 10).map((branch) => ({
    branchId: branch.branchId,
    volume: Math.round(branch.totalVolume),
    score: Math.round(branch.performanceScore),
    transactions: branch.transactionCount,
  }));

  // Color code by performance score
  const getColor = (score: number) => {
    if (score >= 75) return "hsl(var(--chart-2))"; // Green - Excellent
    if (score >= 50) return "hsl(var(--chart-1))"; // Blue - Good
    if (score >= 25) return "hsl(var(--chart-4))"; // Orange - Average
    return "hsl(var(--chart-5))"; // Red - Poor
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branch Performance Dashboard</CardTitle>
        <CardDescription>
          Top 10 branches by performance score (volume, customers, growth, activity)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={chartData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" />
            <YAxis dataKey="branchId" type="category" width={80} />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  return (
                    <div className="bg-card p-3 border border-border rounded-lg shadow-lg">
                      <p className="font-semibold">Branch {data.branchId}</p>
                      <p className="text-sm">Volume: ${data.volume.toLocaleString()}</p>
                      <p className="text-sm">Score: {data.score}/100</p>
                      <p className="text-sm">Transactions: {data.transactions}</p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Bar dataKey="volume" radius={[0, 4, 4, 0]}>
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={getColor(entry.score)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
