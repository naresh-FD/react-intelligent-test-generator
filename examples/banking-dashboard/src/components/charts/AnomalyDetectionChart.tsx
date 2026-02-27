/**
 * Q7 Visualization 5: Anomaly Detection
 * Chart: Scatter plot
 * Data: Anomalous transactions by score and amount
 * Insight: Identifies and visualizes suspicious transactions
 */

import { AnomalousTransaction } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ZAxis,
} from "recharts";

interface AnomalyDetectionChartProps {
  data: AnomalousTransaction[];
}

export function AnomalyDetectionChart({ data }: AnomalyDetectionChartProps) {
  // Take top 100 anomalies for visualization
  const chartData = data.slice(0, 100).map((anomaly) => ({
    amount: anomaly.transaction.transactionAmount,
    score: anomaly.anomalyScore,
    customerId: anomaly.transaction.customerId,
    date: anomaly.transaction.transactionDate.toLocaleDateString(),
    reasons: anomaly.anomalyReasons.join(", "),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Anomaly Detection</CardTitle>
        <CardDescription>
          Suspicious transactions by anomaly score - bubble size indicates severity
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={400}>
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="amount"
              name="Amount"
              unit="$"
              label={{ value: "Transaction Amount", position: "insideBottom", offset: -5 }}
            />
            <YAxis
              type="number"
              dataKey="score"
              name="Score"
              label={{ value: "Anomaly Score", angle: -90, position: "insideLeft" }}
            />
            <ZAxis type="number" dataKey="score" range={[50, 400]} />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  return (
                    <div className="bg-card p-3 border border-border rounded-lg shadow-lg max-w-xs">
                      <p className="font-semibold">Customer {data.customerId}</p>
                      <p className="text-sm">Amount: ${data.amount.toLocaleString()}</p>
                      <p className="text-sm">Score: {data.score}</p>
                      <p className="text-sm">Date: {data.date}</p>
                      <p className="text-xs text-muted-foreground mt-1">{data.reasons}</p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Scatter data={chartData} fill="hsl(var(--chart-5))" fillOpacity={0.6} />
          </ScatterChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
