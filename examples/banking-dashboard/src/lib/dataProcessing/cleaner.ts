/**
 * Data Cleaning and Normalization
 * Combines parsing, validation, and edge case handling
 */

import { RawBankingRecord, CleanedTransaction } from "../types";
import {
  parseAmount,
  parseDate,
  parseEmail,
  parseInteger,
  parsePhone,
  parseTransactionType,
  parseAccountType,
  normalizeGender,
} from "./parser";
import {
  validateDataset,
  handleInconsistentAges,
  removeDuplicateTransactions,
} from "./validator";

/**
 * Clean a single raw banking record
 * 
 * @param raw - Raw record from CSV
 * @returns Cleaned transaction or null if critical fields are missing
 */
export function cleanRecord(raw: RawBankingRecord): CleanedTransaction | null {
  try {
    // Parse required fields
    const customerId = parseInteger(raw["Customer ID"]);
    const transactionId = parseInteger(raw.TransactionID);
    const transactionDate = parseDate(raw["Transaction Date"]);
    const age = parseInteger(raw.Age);
    const transactionAmount = parseAmount(raw["Transaction Amount"]);
    const accountBalanceAfterTransaction = parseAmount(
      raw["Account Balance After Transaction"]
    );

    // Validate critical fields
    if (
      !customerId ||
      !transactionId ||
      !transactionDate ||
      !age ||
      transactionAmount === undefined ||
      accountBalanceAfterTransaction === undefined
    ) {
      return null;
    }

    const transactionType = parseTransactionType(raw["Transaction Type"]);
    const accountType = parseAccountType(raw["Account Type"]);

    if (!transactionType || !accountType) {
      return null;
    }

    // Create cleaned record
    const cleaned: CleanedTransaction = {
      customerId,
      firstName: raw["First Name"]?.trim() || "",
      lastName: raw["Last Name"]?.trim() || "",
      age,
      gender: normalizeGender(raw.Gender),
      address: raw.Address?.trim() || "",
      city: raw.City?.trim() || "",
      contactNumber: parsePhone(raw["Contact Number"]),
      email: parseEmail(raw.Email),
      accountType,
      accountBalance: parseAmount(raw["Account Balance"]),
      accountOpeningDate: parseDate(raw["Date Of Account Opening"]) || new Date(),
      lastTransactionDate: parseDate(raw["Last Transaction Date"]) || new Date(),
      transactionId,
      transactionDate,
      transactionType,
      transactionAmount,
      accountBalanceAfterTransaction,
      branchId: raw["Branch ID"]?.trim() || "",
    };

    // Parse optional fields
    const loanId = parseInteger(raw["Loan ID"]);
    if (loanId) cleaned.loanId = loanId;

    const loanAmount = parseAmount(raw["Loan Amount"]);
    if (loanAmount) cleaned.loanAmount = loanAmount;

    if (raw["Loan Type"]) cleaned.loanType = raw["Loan Type"].trim();

    const interestRate = parseAmount(raw["Interest Rate"]);
    if (interestRate) cleaned.interestRate = interestRate;

    const loanTerm = parseInteger(raw["Loan Term"]);
    if (loanTerm) cleaned.loanTerm = loanTerm;

    const loanApprovalDate = parseDate(raw["Approval/Rejection Date"]);
    if (loanApprovalDate) cleaned.loanApprovalDate = loanApprovalDate;

    if (raw["Loan Status"]) cleaned.loanStatus = raw["Loan Status"].trim();

    const cardId = parseInteger(raw.CardID);
    if (cardId) cleaned.cardId = cardId;

    if (raw["Card Type"]) cleaned.cardType = raw["Card Type"].trim();

    const creditLimit = parseAmount(raw["Credit Limit"]);
    if (creditLimit) cleaned.creditLimit = creditLimit;

    const creditCardBalance = parseAmount(raw["Credit Card Balance"]);
    if (creditCardBalance) cleaned.creditCardBalance = creditCardBalance;

    const minimumPaymentDue = parseAmount(raw["Minimum Payment Due"]);
    if (minimumPaymentDue) cleaned.minimumPaymentDue = minimumPaymentDue;

    const paymentDueDate = parseDate(raw["Payment Due Date"]);
    if (paymentDueDate) cleaned.paymentDueDate = paymentDueDate;

    const lastCreditCardPaymentDate = parseDate(raw["Last Credit Card Payment Date"]);
    if (lastCreditCardPaymentDate)
      cleaned.lastCreditCardPaymentDate = lastCreditCardPaymentDate;

    const rewardsPoints = parseInteger(raw["Rewards Points"]);
    if (rewardsPoints) cleaned.rewardsPoints = rewardsPoints;

    const feedbackId = parseInteger(raw["Feedback ID"]);
    if (feedbackId) cleaned.feedbackId = feedbackId;

    const feedbackDate = parseDate(raw["Feedback Date"]);
    if (feedbackDate) cleaned.feedbackDate = feedbackDate;

    if (raw["Feedback Type"]) cleaned.feedbackType = raw["Feedback Type"].trim();

    if (raw["Resolution Status"])
      cleaned.resolutionStatus = raw["Resolution Status"].trim();

    const resolutionDate = parseDate(raw["Resolution Date"]);
    if (resolutionDate) cleaned.resolutionDate = resolutionDate;

    const anomaly = parseInteger(raw.Anomaly);
    if (anomaly) cleaned.anomaly = anomaly;

    return cleaned;
  } catch (error) {
    console.error("Error cleaning record:", error);
    return null;
  }
}

/**
 * Clean entire dataset with validation and edge case handling
 * 
 * @param rawData - Array of raw records from CSV
 * @returns Cleaned and validated data with processing report
 */
export function cleanDataset(rawData: RawBankingRecord[]) {
  console.log(`Starting data cleaning for ${rawData.length} records...`);

  // Step 1: Clean individual records
  const cleaned = rawData
    .map((raw) => cleanRecord(raw))
    .filter((record): record is CleanedTransaction => record !== null);

  console.log(`Cleaned ${cleaned.length} records (${rawData.length - cleaned.length} failed)`);

  // Step 2: Handle edge cases
  const { corrected: agesCorrected, corrections: ageCorrections } =
    handleInconsistentAges(cleaned);

  console.log(`Corrected ${ageCorrections.length} customers with inconsistent ages`);

  const { unique: deduplicated, duplicates } =
    removeDuplicateTransactions(agesCorrected);

  console.log(`Removed ${duplicates.length} duplicate transactions`);

  // Step 3: Validate
  const validationResult = validateDataset(deduplicated);

  console.log(
    `Validation complete: ${validationResult.summary.validRecords} valid, ${validationResult.summary.invalidRecords} invalid`
  );

  return {
    validData: validationResult.valid,
    invalidRecords: validationResult.invalid,
    processingReport: {
      totalRawRecords: rawData.length,
      successfullyCleaned: cleaned.length,
      ageCorrections: ageCorrections.length,
      duplicatesRemoved: duplicates.length,
      validRecords: validationResult.summary.validRecords,
      invalidRecords: validationResult.summary.invalidRecords,
      errorsByType: validationResult.summary.errorsByType,
    },
  };
}
