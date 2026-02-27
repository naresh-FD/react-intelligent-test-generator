import { useState } from "react";
import { FileUploader } from "./FileUploader";
import { MetricsCards } from "./MetricsCards";
import { BranchPerformanceChart } from "./charts/BranchPerformanceChart";
import { SeasonalTrendsChart } from "./charts/SeasonalTrendsChart";
import { CustomerSegmentChart } from "./charts/CustomerSegmentChart";
import { TransactionVolumeChart } from "./charts/TransactionVolumeChart";
import { AnomalyDetectionChart } from "./charts/AnomalyDetectionChart";
import { parseCSVFile } from "@/lib/csvParser";
import { cleanDataset } from "@/lib/dataProcessing/cleaner";
import {
  analyzeBranchPerformance,
  analyzeSeasonalTrends,
  segmentCustomers,
  detectAnomalousTransactions,
} from "@/lib/dataProcessing/aggregator";
import { CleanedTransaction, DashboardMetrics } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

export function Dashboard() {
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [validData, setValidData] = useState<CleanedTransaction[]>([]);
  const [processingReport, setProcessingReport] = useState<any>(null);

  const handleFileSelect = async (file: File) => {
    setIsProcessing(true);

    try {
      // Step 1: Parse CSV
      toast({
        title: "Processing file...",
        description: "Parsing CSV data",
      });

      const parseResult = await parseCSVFile(file);

      if (parseResult.errors.length > 0) {
        console.warn("CSV parsing errors:", parseResult.errors);
      }

      // Step 2: Clean and validate data
      toast({
        title: "Cleaning data...",
        description: "Normalizing and validating records",
      });

      const cleanResult = cleanDataset(parseResult.data);

      setValidData(cleanResult.validData);
      setProcessingReport(cleanResult.processingReport);

      toast({
        title: "Success!",
        description: `Processed ${cleanResult.validData.length} valid transactions`,
      });
    } catch (error) {
      console.error("Error processing file:", error);
      toast({
        title: "Error",
        description: "Failed to process CSV file. Please check the file format.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Calculate dashboard metrics
  const metrics: DashboardMetrics | null = validData.length > 0
    ? {
        totalTransactions: validData.length,
        totalVolume: validData.reduce((sum, t) => sum + t.transactionAmount, 0),
        avgTransactionAmount:
          validData.reduce((sum, t) => sum + t.transactionAmount, 0) / validData.length,
        uniqueCustomers: new Set(validData.map((t) => t.customerId)).size,
        activeBranches: new Set(validData.map((t) => t.branchId)).size,
        anomalyCount: validData.filter((t) => t.anomaly === 1).length,
        periodStart: new Date(
          Math.min(...validData.map((t) => t.transactionDate.getTime()))
        ),
        periodEnd: new Date(Math.max(...validData.map((t) => t.transactionDate.getTime()))),
      }
    : null;

  // Calculate business insights
  const branchPerformance = validData.length > 0 ? analyzeBranchPerformance(validData) : [];
  const seasonalTrends = validData.length > 0 ? analyzeSeasonalTrends(validData) : [];
  const customerSegments = validData.length > 0 ? segmentCustomers(validData) : [];
  const anomalies = validData.length > 0 ? detectAnomalousTransactions(validData) : [];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-6 py-4">
          <h1 className="text-3xl font-bold text-foreground">Banking Data Analytics</h1>
          <p className="text-muted-foreground mt-1">
            Comprehensive data visualization and business intelligence
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {validData.length === 0 ? (
          <div className="max-w-2xl mx-auto">
            <FileUploader onFileSelect={handleFileSelect} isProcessing={isProcessing} />
            
            {processingReport && (
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle>Data Quality Report</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span>Total Records:</span>
                      <Badge>{processingReport.totalRawRecords}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Valid Records:</span>
                      <Badge variant="default">{processingReport.validRecords}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Invalid Records:</span>
                      <Badge variant="destructive">{processingReport.invalidRecords}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Duplicates Removed:</span>
                      <Badge variant="secondary">{processingReport.duplicatesRemoved}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Age Corrections:</span>
                      <Badge variant="secondary">{processingReport.ageCorrections}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          <div className="space-y-8">
            {/* Key Metrics */}
            {metrics && <MetricsCards metrics={metrics} />}

            {/* Visualizations */}
            <Tabs defaultValue="branches" className="space-y-4">
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="branches">Branches</TabsTrigger>
                <TabsTrigger value="trends">Trends</TabsTrigger>
                <TabsTrigger value="customers">Customers</TabsTrigger>
                <TabsTrigger value="volume">Volume</TabsTrigger>
                <TabsTrigger value="anomalies">Anomalies</TabsTrigger>
              </TabsList>

              <TabsContent value="branches" className="space-y-4">
                <BranchPerformanceChart data={branchPerformance} />
              </TabsContent>

              <TabsContent value="trends" className="space-y-4">
                <SeasonalTrendsChart data={seasonalTrends} />
              </TabsContent>

              <TabsContent value="customers" className="space-y-4">
                <CustomerSegmentChart data={customerSegments} />
              </TabsContent>

              <TabsContent value="volume" className="space-y-4">
                <TransactionVolumeChart data={validData} />
              </TabsContent>

              <TabsContent value="anomalies" className="space-y-4">
                <AnomalyDetectionChart data={anomalies} />
                <Card>
                  <CardHeader>
                    <CardTitle>Top Anomalies</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {anomalies.slice(0, 5).map((anomaly, idx) => (
                        <div
                          key={idx}
                          className="flex justify-between items-start p-3 border border-border rounded-lg"
                        >
                          <div>
                            <p className="font-semibold">
                              Customer {anomaly.transaction.customerId}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {anomaly.anomalyReasons.join(", ")}
                            </p>
                          </div>
                          <Badge variant="destructive">{anomaly.anomalyScore}</Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </main>
    </div>
  );
}
