/**
 * Business Logic & Aggregation Functions
 * Question 4 - Business Insights and Aggregation (25 points)
 * Question 5 - Strategic Data Aggregation (15 points)
 */

import {
  CleanedTransaction,
  MonthlyVolume,
  CustomerLTV,
  AnomalousTransaction,
  BranchPerformance,
  CustomerSegment,
  SeasonalTrend,
} from "../types";

/**
 * Q4: Calculate monthly transaction volume by branch
 * 
 * @param data - Array of cleaned transactions
 * @returns Map of branch ID to Map of month to volume data
 */
export function getMonthlyVolumeByBranch(
  data: CleanedTransaction[]
): Map<string, Map<string, MonthlyVolume>> {
  const result = new Map<string, Map<string, MonthlyVolume>>();

  data.forEach((transaction) => {
    const branchId = transaction.branchId;
    const month = formatMonth(transaction.transactionDate);

    if (!result.has(branchId)) {
      result.set(branchId, new Map());
    }

    const branchMap = result.get(branchId)!;

    if (!branchMap.has(month)) {
      branchMap.set(month, {
        branchId,
        month,
        totalAmount: 0,
        transactionCount: 0,
      });
    }

    const monthData = branchMap.get(month)!;
    monthData.totalAmount += transaction.transactionAmount;
    monthData.transactionCount += 1;
  });

  return result;
}

/**
 * Q4: Detect anomalous transactions using statistical analysis
 * 
 * Strategy: Flag transactions that are:
 * - More than 3 standard deviations from mean
 * - Unusually large for customer's typical behavior
 * - Marked as anomaly in data
 * 
 * @param data - Array of cleaned transactions
 * @returns Array of anomalous transactions with reasons
 */
export function detectAnomalousTransactions(
  data: CleanedTransaction[]
): AnomalousTransaction[] {
  const anomalies: AnomalousTransaction[] = [];

  // Calculate overall statistics
  const amounts = data.map((t) => t.transactionAmount);
  const mean = amounts.reduce((sum, amt) => sum + amt, 0) / amounts.length;
  const stdDev = Math.sqrt(
    amounts.reduce((sum, amt) => sum + Math.pow(amt - mean, 2), 0) / amounts.length
  );

  // Group transactions by customer
  const customerTransactions = new Map<number, CleanedTransaction[]>();
  data.forEach((t) => {
    if (!customerTransactions.has(t.customerId)) {
      customerTransactions.set(t.customerId, []);
    }
    customerTransactions.get(t.customerId)!.push(t);
  });

  // Detect anomalies
  data.forEach((transaction) => {
    const reasons: string[] = [];
    let anomalyScore = 0;

    // Check if marked as anomaly in data
    if (transaction.anomaly === 1) {
      reasons.push("Flagged as anomaly in source data");
      anomalyScore += 50;
    }

    // Check if amount is >3 standard deviations from mean
    const zScore = Math.abs((transaction.transactionAmount - mean) / stdDev);
    if (zScore > 3) {
      reasons.push(`Amount is ${zScore.toFixed(1)} standard deviations from mean`);
      anomalyScore += 30;
    }

    // Check customer's typical behavior
    const customerTxns = customerTransactions.get(transaction.customerId) || [];
    if (customerTxns.length > 1) {
      const customerAmounts = customerTxns.map((t) => t.transactionAmount);
      const customerMean =
        customerAmounts.reduce((sum, amt) => sum + amt, 0) / customerAmounts.length;

      if (transaction.transactionAmount > customerMean * 5) {
        reasons.push("Transaction is 5x customer's average");
        anomalyScore += 20;
      }
    }

    // Check for negative balance after transaction
    if (transaction.accountBalanceAfterTransaction < -1000) {
      reasons.push("Results in significant negative balance");
      anomalyScore += 25;
    }

    // Check for rapid succession of withdrawals
    const recentWithdrawals = customerTxns.filter(
      (t) =>
        t.transactionType === "Withdrawal" &&
        Math.abs(t.transactionDate.getTime() - transaction.transactionDate.getTime()) <
          24 * 60 * 60 * 1000 // Within 24 hours
    );

    if (recentWithdrawals.length > 5) {
      reasons.push("Multiple withdrawals in 24 hours");
      anomalyScore += 15;
    }

    if (reasons.length > 0) {
      anomalies.push({
        transaction,
        anomalyScore,
        anomalyReasons: reasons,
      });
    }
  });

  // Sort by anomaly score (highest first)
  return anomalies.sort((a, b) => b.anomalyScore - a.anomalyScore);
}

/**
 * Q4: Calculate customer lifetime value (LTV)
 * 
 * LTV Formula:
 * - Net Value = Total Deposits - Total Withdrawals
 * - Account Age in months
 * - Average transaction amount
 * - LTV = Net Value + (Avg Transaction * Expected Future Transactions)
 * 
 * @param customerId - Customer ID to calculate LTV for
 * @param data - Array of all transactions
 * @returns Customer LTV metrics
 */
export function calculateCustomerLTV(
  customerId: number,
  data: CleanedTransaction[]
): CustomerLTV {
  const customerTxns = data.filter((t) => t.customerId === customerId);

  if (customerTxns.length === 0) {
    return {
      customerId,
      totalDeposits: 0,
      totalWithdrawals: 0,
      netValue: 0,
      transactionCount: 0,
      avgTransactionAmount: 0,
      accountAge: 0,
      ltv: 0,
    };
  }

  const totalDeposits = customerTxns
    .filter((t) => t.transactionType === "Deposit")
    .reduce((sum, t) => sum + t.transactionAmount, 0);

  const totalWithdrawals = customerTxns
    .filter((t) => t.transactionType === "Withdrawal")
    .reduce((sum, t) => sum + t.transactionAmount, 0);

  const netValue = totalDeposits - totalWithdrawals;
  const transactionCount = customerTxns.length;
  const avgTransactionAmount = totalDeposits / transactionCount;

  // Calculate account age in months
  const accountOpenDate = customerTxns[0].accountOpeningDate;
  const now = new Date();
  const accountAge =
    (now.getTime() - accountOpenDate.getTime()) / (1000 * 60 * 60 * 24 * 30);

  // Simple LTV calculation
  // Assume customer will continue for 5 more years with similar activity
  const expectedFutureMonths = 60;
  const monthlyTransactionRate = transactionCount / Math.max(accountAge, 1);
  const expectedFutureTransactions = monthlyTransactionRate * expectedFutureMonths;

  const ltv = netValue + avgTransactionAmount * expectedFutureTransactions * 0.3; // 30% profit margin

  return {
    customerId,
    totalDeposits,
    totalWithdrawals,
    netValue,
    transactionCount,
    avgTransactionAmount,
    accountAge,
    ltv,
  };
}

/**
 * Q5: Identify underperforming branches
 * 
 * Performance Metrics:
 * - Total transaction volume
 * - Number of unique customers
 * - Average transaction amount
 * - Growth rate (comparing recent vs historical)
 * 
 * @param data - Array of all transactions
 * @returns Array of branch performance metrics
 */
export function analyzeBranchPerformance(
  data: CleanedTransaction[]
): BranchPerformance[] {
  const branchMap = new Map<string, CleanedTransaction[]>();

  // Group by branch
  data.forEach((t) => {
    if (!branchMap.has(t.branchId)) {
      branchMap.set(t.branchId, []);
    }
    branchMap.get(t.branchId)!.push(t);
  });

  const performances: BranchPerformance[] = [];

  branchMap.forEach((transactions, branchId) => {
    const totalVolume = transactions.reduce((sum, t) => sum + t.transactionAmount, 0);
    const transactionCount = transactions.length;
    const uniqueCustomers = new Set(transactions.map((t) => t.customerId)).size;
    const avgTransactionAmount = totalVolume / transactionCount;

    // Calculate growth rate (last 3 months vs previous 3 months)
    const now = new Date();
    const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

    const recentVolume = transactions
      .filter((t) => t.transactionDate >= threeMonthsAgo)
      .reduce((sum, t) => sum + t.transactionAmount, 0);

    const previousVolume = transactions
      .filter(
        (t) => t.transactionDate >= sixMonthsAgo && t.transactionDate < threeMonthsAgo
      )
      .reduce((sum, t) => sum + t.transactionAmount, 0);

    const growthRate =
      previousVolume > 0 ? ((recentVolume - previousVolume) / previousVolume) * 100 : 0;

    // Calculate performance score (0-100)
    const volumeScore = Math.min((totalVolume / 1000000) * 20, 30); // Up to 30 points
    const customerScore = Math.min((uniqueCustomers / 100) * 20, 30); // Up to 30 points
    const growthScore = Math.min(Math.max(growthRate, 0) / 2, 20); // Up to 20 points
    const activityScore = Math.min((transactionCount / 1000) * 20, 20); // Up to 20 points

    const performanceScore = volumeScore + customerScore + growthScore + activityScore;

    performances.push({
      branchId,
      totalVolume,
      transactionCount,
      customerCount: uniqueCustomers,
      avgTransactionAmount,
      growthRate,
      performanceScore,
    });
  });

  return performances.sort((a, b) => b.performanceScore - a.performanceScore);
}

/**
 * Q5: Segment customers by value and activity
 * 
 * Segments:
 * - High-Value: Top 20% by total deposits
 * - Active: Frequent transactions
 * - At-Risk: Declining activity
 * - New: Recently opened accounts
 * 
 * @param data - Array of all transactions
 * @returns Array of customer segments
 */
export function segmentCustomers(data: CleanedTransaction[]): CustomerSegment[] {
  const customerMap = new Map<number, CleanedTransaction[]>();

  data.forEach((t) => {
    if (!customerMap.has(t.customerId)) {
      customerMap.set(t.customerId, []);
    }
    customerMap.get(t.customerId)!.push(t);
  });

  // Calculate metrics for each customer
  const customerMetrics = Array.from(customerMap.entries()).map(
    ([customerId, transactions]) => {
      const totalDeposits = transactions
        .filter((t) => t.transactionType === "Deposit")
        .reduce((sum, t) => sum + t.transactionAmount, 0);

      const avgBalance =
        transactions.reduce((sum, t) => sum + t.accountBalanceAfterTransaction, 0) /
        transactions.length;

      const avgTransactionAmount =
        transactions.reduce((sum, t) => sum + t.transactionAmount, 0) /
        transactions.length;

      return {
        customerId,
        totalDeposits,
        avgBalance,
        avgTransactionAmount,
        transactionCount: transactions.length,
        totalVolume: transactions.reduce((sum, t) => sum + t.transactionAmount, 0),
      };
    }
  );

  // Sort by total deposits for segmentation
  const sortedByDeposits = [...customerMetrics].sort(
    (a, b) => b.totalDeposits - a.totalDeposits
  );

  // Top 20% high-value customers
  const highValueCount = Math.ceil(sortedByDeposits.length * 0.2);
  const highValueCustomers = sortedByDeposits.slice(0, highValueCount);

  // Active customers (top 30% by transaction count)
  const sortedByActivity = [...customerMetrics].sort(
    (a, b) => b.transactionCount - a.transactionCount
  );
  const activeCount = Math.ceil(sortedByActivity.length * 0.3);
  const activeCustomers = sortedByActivity.slice(0, activeCount);

  return [
    {
      segmentName: "High-Value Customers",
      customerIds: highValueCustomers.map((c) => c.customerId),
      avgBalance:
        highValueCustomers.reduce((sum, c) => sum + c.avgBalance, 0) /
        highValueCustomers.length,
      avgTransactionAmount:
        highValueCustomers.reduce((sum, c) => sum + c.avgTransactionAmount, 0) /
        highValueCustomers.length,
      totalVolume: highValueCustomers.reduce((sum, c) => sum + c.totalVolume, 0),
      characteristics: [
        "Top 20% by total deposits",
        `Average balance: $${(
          highValueCustomers.reduce((sum, c) => sum + c.avgBalance, 0) /
          highValueCustomers.length
        ).toFixed(2)}`,
      ],
    },
    {
      segmentName: "Active Customers",
      customerIds: activeCustomers.map((c) => c.customerId),
      avgBalance:
        activeCustomers.reduce((sum, c) => sum + c.avgBalance, 0) /
        activeCustomers.length,
      avgTransactionAmount:
        activeCustomers.reduce((sum, c) => sum + c.avgTransactionAmount, 0) /
        activeCustomers.length,
      totalVolume: activeCustomers.reduce((sum, c) => sum + c.totalVolume, 0),
      characteristics: [
        "Top 30% by transaction frequency",
        `Average ${(
          activeCustomers.reduce((sum, c) => sum + c.transactionCount, 0) /
          activeCustomers.length
        ).toFixed(0)} transactions`,
      ],
    },
  ];
}

/**
 * Q5: Analyze seasonal trends in banking activity
 * 
 * @param data - Array of all transactions
 * @returns Monthly breakdown of activity
 */
export function analyzeSeasonalTrends(data: CleanedTransaction[]): SeasonalTrend[] {
  const monthlyData = new Map<string, SeasonalTrend>();

  data.forEach((transaction) => {
    const month = formatMonth(transaction.transactionDate);

    if (!monthlyData.has(month)) {
      monthlyData.set(month, {
        month,
        totalVolume: 0,
        transactionCount: 0,
        avgAmount: 0,
        deposits: 0,
        withdrawals: 0,
        transfers: 0,
      });
    }

    const monthData = monthlyData.get(month)!;
    monthData.totalVolume += transaction.transactionAmount;
    monthData.transactionCount += 1;

    if (transaction.transactionType === "Deposit") monthData.deposits += 1;
    if (transaction.transactionType === "Withdrawal") monthData.withdrawals += 1;
    if (transaction.transactionType === "Transfer") monthData.transfers += 1;
  });

  // Calculate averages
  monthlyData.forEach((data) => {
    data.avgAmount = data.totalVolume / data.transactionCount;
  });

  // Sort by month
  return Array.from(monthlyData.values()).sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Helper: Format date as YYYY-MM
 */
function formatMonth(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}
