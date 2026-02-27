/**
 * Q7 Visualization 3: Customer Segmentation
 * Chart: Pie chart
 * Data: Customer segments by value and activity
 * Insight: Shows distribution of high-value vs active customers
 */

import { CustomerSegment } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface CustomerSegmentChartProps {
  data: CustomerSegment[];
}

export function CustomerSegmentChart({ data }: CustomerSegmentChartProps) {
  const chartData = data.map((segment) => ({
    name: segment.segmentName,
    value: segment.customerIds.length,
    volume: segment.totalVolume,
    avgBalance: segment.avgBalance,
  }));

  const COLORS = [
    "hsl(var(--chart-1))",
    "hsl(var(--chart-2))",
    "hsl(var(--chart-3))",
    "hsl(var(--chart-4))",
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Customer Segmentation</CardTitle>
        <CardDescription>
          Distribution of customers by value and activity level
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={400}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={({ name, value }) => `${name}: ${value}`}
              outerRadius={120}
              fill="#8884d8"
              dataKey="value"
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  return (
                    <div className="bg-card p-3 border border-border rounded-lg shadow-lg">
                      <p className="font-semibold">{data.name}</p>
                      <p className="text-sm">Customers: {data.value}</p>
                      <p className="text-sm">
                        Total Volume: ${Math.round(data.volume).toLocaleString()}
                      </p>
                      <p className="text-sm">
                        Avg Balance: ${Math.round(data.avgBalance).toLocaleString()}
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
