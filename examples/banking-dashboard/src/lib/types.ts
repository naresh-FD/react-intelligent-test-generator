/**
 * Core TypeScript Types for Banking Data System
 * Addresses: Assignment Requirements - Type Safety
 */

// Raw data from CSV (as strings)
export interface RawBankingRecord {
  "Customer ID": string;
  "First Name": string;
  "Last Name": string;
  Age: string;
  Gender: string;
  Address: string;
  City: string;
  "Contact Number": string;
  Email: string;
  "Account Type": string;
  "Account Balance": string;
  "Date Of Account Opening": string;
  "Last Transaction Date": string;
  TransactionID: string;
  "Transaction Date": string;
  "Transaction Type": string;
  "Transaction Amount": string;
  "Account Balance After Transaction": string;
  "Branch ID": string;
  "Loan ID": string;
  "Loan Amount": string;
  "Loan Type": string;
  "Interest Rate": string;
  "Loan Term": string;
  "Approval/Rejection Date": string;
  "Loan Status": string;
  CardID: string;
  "Card Type": string;
  "Credit Limit": string;
  "Credit Card Balance": string;
  "Minimum Payment Due": string;
  "Payment Due Date": string;
  "Last Credit Card Payment Date": string;
  "Rewards Points": string;
  "Feedback ID": string;
  "Feedback Date": string;
  "Feedback Type": string;
  "Resolution Status": string;
  "Resolution Date": string;
  Anomaly: string;
}

// Normalized gender type (Q1: Data Normalization)
export type Gender = "Male" | "Female" | "Other";

// Transaction types
export type TransactionType = "Deposit" | "Withdrawal" | "Transfer";

// Account types
export type AccountType = "Current" | "Savings";

// Cleaned and typed transaction record
export interface CleanedTransaction {
  customerId: number;
  firstName: string;
  lastName: string;
  age: number;
  gender: Gender;
  address: string;
  city: string;
  contactNumber: string;
  email: string;
  accountType: AccountType;
  accountBalance: number;
  accountOpeningDate: Date;
  lastTransactionDate: Date;
  transactionId: number;
  transactionDate: Date;
  transactionType: TransactionType;
  transactionAmount: number;
  accountBalanceAfterTransaction: number;
  branchId: string;
  // Optional fields
  loanId?: number;
  loanAmount?: number;
  loanType?: string;
  interestRate?: number;
  loanTerm?: number;
  loanApprovalDate?: Date;
  loanStatus?: string;
  cardId?: number;
  cardType?: string;
  creditLimit?: number;
  creditCardBalance?: number;
  minimumPaymentDue?: number;
  paymentDueDate?: Date;
  lastCreditCardPaymentDate?: Date;
  rewardsPoints?: number;
  feedbackId?: number;
  feedbackDate?: Date;
  feedbackType?: string;
  resolutionStatus?: string;
  resolutionDate?: Date;
  anomaly?: number;
}

// Validation error tracking
export interface ValidationError {
  recordIndex: number;
  field: string;
  value: any;
  reason: string;
  severity: "warning" | "error";
}

// Data validation result (Q2: Data Validation)
export interface ValidationResult {
  valid: CleanedTransaction[];
  invalid: ValidationError[];
  summary: {
    totalRecords: number;
    validRecords: number;
    invalidRecords: number;
    errorsByType: Record<string, number>;
  };
}

// Business metric types (Q4: Business Insights)
export interface MonthlyVolume {
  branchId: string;
  month: string; // YYYY-MM format
  totalAmount: number;
  transactionCount: number;
}

export interface CustomerLTV {
  customerId: number;
  totalDeposits: number;
  totalWithdrawals: number;
  netValue: number;
  transactionCount: number;
  avgTransactionAmount: number;
  accountAge: number; // in months
  ltv: number; // Calculated lifetime value
}

export interface AnomalousTransaction {
  transaction: CleanedTransaction;
  anomalyScore: number;
  anomalyReasons: string[];
}

// Strategic insights (Q5: Strategic Data Aggregation)
export interface BranchPerformance {
  branchId: string;
  totalVolume: number;
  transactionCount: number;
  customerCount: number;
  avgTransactionAmount: number;
  growthRate: number; // percentage
  performanceScore: number; // 0-100
}

export interface CustomerSegment {
  segmentName: string;
  customerIds: number[];
  avgBalance: number;
  avgTransactionAmount: number;
  totalVolume: number;
  characteristics: string[];
}

export interface SeasonalTrend {
  month: string; // YYYY-MM
  totalVolume: number;
  transactionCount: number;
  avgAmount: number;
  deposits: number;
  withdrawals: number;
  transfers: number;
}

// Chart data types (Q7: Visualization)
export interface ChartDataPoint {
  label: string;
  value: number;
  category?: string;
  metadata?: Record<string, any>;
}

// Filter and aggregation options
export interface DataFilters {
  startDate?: Date;
  endDate?: Date;
  branchIds?: string[];
  transactionTypes?: TransactionType[];
  minAmount?: number;
  maxAmount?: number;
  customerIds?: number[];
  accountTypes?: AccountType[];
}

// Dashboard metrics summary
export interface DashboardMetrics {
  totalTransactions: number;
  totalVolume: number;
  avgTransactionAmount: number;
  uniqueCustomers: number;
  activeBranches: number;
  anomalyCount: number;
  periodStart: Date;
  periodEnd: Date;
}
