/**
 * Data Validation and Filtering Module
 * Addresses: Question 2 - Data Validation and Filtering (20 points)
 * Addresses: Question 3 - Edge Case Management (10 points)
 */

import { CleanedTransaction, ValidationError, ValidationResult } from "../types";

/**
 * Validate a single transaction record
 * 
 * Validation Rules:
 * 1. Transaction Amount must be positive for deposits
 * 2. Account Balance must be logical after transaction
 * 3. Customer Age must be within reasonable range (18-120)
 * 4. All required fields must be present
 * 
 * @param transaction - Cleaned transaction to validate
 * @param index - Record index for error tracking
 * @returns Array of validation errors (empty if valid)
 */
export function validateTransaction(
  transaction: CleanedTransaction,
  index: number
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Rule 1: Validate transaction amount is positive for deposits
  if (transaction.transactionType === "Deposit" && transaction.transactionAmount <= 0) {
    errors.push({
      recordIndex: index,
      field: "transactionAmount",
      value: transaction.transactionAmount,
      reason: "Deposit amount must be positive",
      severity: "error",
    });
  }

  // Rule 2: Validate account balance logic
  // For a deposit: balanceAfter should be balanceBefore + amount
  // For a withdrawal: balanceAfter should be balanceBefore - amount
  const expectedBalance = calculateExpectedBalance(
    transaction.accountBalance,
    transaction.transactionType,
    transaction.transactionAmount
  );

  const balanceDifference = Math.abs(
    transaction.accountBalanceAfterTransaction - expectedBalance
  );

  // Allow small floating point discrepancies (< 0.01)
  if (balanceDifference > 0.01) {
    errors.push({
      recordIndex: index,
      field: "accountBalanceAfterTransaction",
      value: transaction.accountBalanceAfterTransaction,
      reason: `Account balance doesn't reconcile. Expected: ${expectedBalance.toFixed(
        2
      )}, Got: ${transaction.accountBalanceAfterTransaction.toFixed(2)}`,
      severity: "error",
    });
  }

  // Rule 3: Validate customer age is within reasonable range
  if (transaction.age < 18 || transaction.age > 120) {
    errors.push({
      recordIndex: index,
      field: "age",
      value: transaction.age,
      reason: `Age ${transaction.age} is outside valid range (18-120)`,
      severity: "error",
    });
  }

  // Validate required fields are present and valid
  if (!transaction.customerId || transaction.customerId <= 0) {
    errors.push({
      recordIndex: index,
      field: "customerId",
      value: transaction.customerId,
      reason: "Customer ID must be a positive number",
      severity: "error",
    });
  }

  if (!transaction.transactionId || transaction.transactionId <= 0) {
    errors.push({
      recordIndex: index,
      field: "transactionId",
      value: transaction.transactionId,
      reason: "Transaction ID must be a positive number",
      severity: "error",
    });
  }

  if (!transaction.transactionDate || isNaN(transaction.transactionDate.getTime())) {
    errors.push({
      recordIndex: index,
      field: "transactionDate",
      value: transaction.transactionDate,
      reason: "Invalid transaction date",
      severity: "error",
    });
  }

  // Validate transaction amount is reasonable (not negative)
  if (transaction.transactionAmount < 0) {
    errors.push({
      recordIndex: index,
      field: "transactionAmount",
      value: transaction.transactionAmount,
      reason: "Transaction amount cannot be negative",
      severity: "error",
    });
  }

  // Validate account balance after transaction is not negative
  if (transaction.accountBalanceAfterTransaction < 0) {
    errors.push({
      recordIndex: index,
      field: "accountBalanceAfterTransaction",
      value: transaction.accountBalanceAfterTransaction,
      reason: "Account balance cannot be negative after transaction",
      severity: "warning", // Warning as overdrafts might be allowed
    });
  }

  return errors;
}

/**
 * Calculate expected balance after transaction
 */
function calculateExpectedBalance(
  balanceBefore: number,
  transactionType: string,
  amount: number
): number {
  switch (transactionType) {
    case "Deposit":
      return balanceBefore + amount;
    case "Withdrawal":
      return balanceBefore - amount;
    case "Transfer":
      // For transfers, we might need more context, but assume withdrawal for now
      return balanceBefore - amount;
    default:
      return balanceBefore;
  }
}

/**
 * Validate entire dataset and filter out invalid records
 * 
 * @param data - Array of cleaned transactions
 * @returns Validation result with valid records and errors
 */
export function validateDataset(
  data: CleanedTransaction[]
): ValidationResult {
  const valid: CleanedTransaction[] = [];
  const invalid: ValidationError[] = [];
  const errorsByType: Record<string, number> = {};

  // Validate each transaction
  data.forEach((transaction, index) => {
    const errors = validateTransaction(transaction, index);

    if (errors.length === 0) {
      valid.push(transaction);
    } else {
      invalid.push(...errors);
      
      // Count errors by type
      errors.forEach((error) => {
        errorsByType[error.reason] = (errorsByType[error.reason] || 0) + 1;
      });
    }
  });

  return {
    valid,
    invalid,
    summary: {
      totalRecords: data.length,
      validRecords: valid.length,
      invalidRecords: data.length - valid.length,
      errorsByType,
    },
  };
}

/**
 * Question 3: Edge Case Management
 * Handle inconsistent customer ages across transactions
 * 
 * Strategy: Use the most frequent age for a customer, flag inconsistencies
 * 
 * @param data - Array of transactions
 * @returns Data with corrected ages and list of corrections made
 */
export function handleInconsistentAges(
  data: CleanedTransaction[]
): {
  corrected: CleanedTransaction[];
  corrections: Array<{ customerId: number; ages: number[]; correctedTo: number }>;
} {
  const customerAges = new Map<number, number[]>();
  const corrections: Array<{ customerId: number; ages: number[]; correctedTo: number }> = [];

  // Group ages by customer
  data.forEach((transaction) => {
    const ages = customerAges.get(transaction.customerId) || [];
    ages.push(transaction.age);
    customerAges.set(transaction.customerId, ages);
  });

  // Find customers with inconsistent ages
  const correctedAges = new Map<number, number>();
  customerAges.forEach((ages, customerId) => {
    const uniqueAges = Array.from(new Set(ages));
    
    if (uniqueAges.length > 1) {
      // Use mode (most frequent age) or median as correction
      const mode = calculateMode(ages);
      correctedAges.set(customerId, mode);
      corrections.push({
        customerId,
        ages: uniqueAges,
        correctedTo: mode,
      });
    }
  });

  // Apply corrections
  const corrected = data.map((transaction) => {
    const correctedAge = correctedAges.get(transaction.customerId);
    if (correctedAge !== undefined) {
      return { ...transaction, age: correctedAge };
    }
    return transaction;
  });

  return { corrected, corrections };
}

/**
 * Calculate mode (most frequent value) of an array
 */
function calculateMode(numbers: number[]): number {
  const frequency = new Map<number, number>();
  
  numbers.forEach((num) => {
    frequency.set(num, (frequency.get(num) || 0) + 1);
  });

  let maxFreq = 0;
  let mode = numbers[0];

  frequency.forEach((freq, num) => {
    if (freq > maxFreq) {
      maxFreq = freq;
      mode = num;
    }
  });

  return mode;
}

/**
 * Detect and remove duplicate transactions
 * 
 * Strategy: Transactions are duplicates if they have the same:
 * - Customer ID
 * - Transaction Date
 * - Transaction Amount
 * - Transaction Type
 * 
 * @param data - Array of transactions
 * @returns De-duplicated data and list of removed duplicates
 */
export function removeDuplicateTransactions(
  data: CleanedTransaction[]
): {
  unique: CleanedTransaction[];
  duplicates: CleanedTransaction[];
} {
  const seen = new Set<string>();
  const unique: CleanedTransaction[] = [];
  const duplicates: CleanedTransaction[] = [];

  data.forEach((transaction) => {
    // Create a unique key for the transaction
    const key = `${transaction.customerId}-${transaction.transactionDate.getTime()}-${
      transaction.transactionAmount
    }-${transaction.transactionType}`;

    if (seen.has(key)) {
      duplicates.push(transaction);
    } else {
      seen.add(key);
      unique.push(transaction);
    }
  });

  return { unique, duplicates };
}

/**
 * Reconcile account balances for a customer
 * 
 * Strategy: Sort transactions by date and recalculate balances sequentially
 * 
 * @param customerTransactions - All transactions for a single customer
 * @returns Reconciled transactions with corrected balances
 */
export function reconcileCustomerBalances(
  customerTransactions: CleanedTransaction[]
): CleanedTransaction[] {
  // Sort by transaction date
  const sorted = [...customerTransactions].sort(
    (a, b) => a.transactionDate.getTime() - b.transactionDate.getTime()
  );

  // Recalculate balances
  let runningBalance = sorted[0]?.accountBalance || 0;

  return sorted.map((transaction, index) => {
    if (index === 0) {
      runningBalance = transaction.accountBalanceAfterTransaction;
      return transaction;
    }

    // Calculate what balance should be
    const expectedBalance = calculateExpectedBalance(
      runningBalance,
      transaction.transactionType,
      transaction.transactionAmount
    );

    runningBalance = expectedBalance;

    return {
      ...transaction,
      accountBalance: runningBalance - transaction.transactionAmount,
      accountBalanceAfterTransaction: expectedBalance,
    };
  });
}
