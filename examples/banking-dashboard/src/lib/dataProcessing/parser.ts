/**
 * Data Parsing Functions
 * Question 1 - Data Normalization and Type Conversion (15 points)
 */

import { Gender, TransactionType, AccountType } from "../types";

/**
 * Here we convert string to number safely
 * Handles cases like: "$1,234.56", "1234.56", "", "N/A", null
 * 
 * @param amount
 * @returns 
 */
export function parseAmount(amount: string): number {
  // Handle null, undefined, or empty strings
  if (!amount || amount.trim() === "" || amount.toUpperCase() === "N/A") {
    return 0;
  }

  // Remove currency symbols ($, €, £, etc.) and commas
  const cleaned = amount.replace(/[$€£¥,\s]/g, "");

  // Parse the cleaned string
  const parsed = parseFloat(cleaned);

  // Return 0 if parsing failed (NaN)
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Standardize gender values
 * This handles cases like: "M", "male", "FEMALE", "f", "", "Non-binary"
 * 
 * @param gender - String representation of gender
 * @returns Normalized gender type
 */
export function normalizeGender(gender: string): Gender {
  // Handle empty or null values
  if (!gender || gender.trim() === "") {
    return "Other";
  }

  // Convert to lowercase and trim for comparison
  const normalized = gender.toLowerCase().trim();

  // Male variations
  if (normalized === "m" || normalized === "male" || normalized === "man") {
    return "Male";
  }

  // Female variations
  if (normalized === "f" || normalized === "female" || normalized === "woman") {
    return "Female";
  }

  // Everything else (non-binary, prefer not to say, etc.)
  return "Other";
}

/**
 * Parse date safely handling various formats
 * Handles formats: "2023-12-15", "12/15/2023", "15-Dec-2023", etc.
 * 
 * @param dateString - String representation of date
 * @returns Parsed Date object or null if invalid
 */
export function parseDate(dateString: string): Date | null {
  // Handle null, undefined, or empty strings
  if (!dateString || dateString.trim() === "" || dateString.toUpperCase() === "N/A") {
    return null;
  }

  // Try parsing with Date constructor
  const parsed = new Date(dateString);

  // Check if date is valid
  if (isNaN(parsed.getTime())) {
    // Try alternative formats (DD/MM/YYYY or MM/DD/YYYY)
    const parts = dateString.split(/[/-]/);
    
    if (parts.length === 3) {
      // Try MM/DD/YYYY format
      const attempt1 = new Date(`${parts[2]}-${parts[0]}-${parts[1]}`);
      if (!isNaN(attempt1.getTime())) {
        return attempt1;
      }

      // Try DD/MM/YYYY format
      const attempt2 = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
      if (!isNaN(attempt2.getTime())) {
        return attempt2;
      }
    }

    return null;
  }

  return parsed;
}

/**
 * Parse transaction type from string
 * 
 * @param type - String representation of transaction type
 * @returns Normalized transaction type or undefined
 */
export function parseTransactionType(type: string): TransactionType | undefined {
  if (!type) return undefined;

  const normalized = type.toLowerCase().trim();

  if (normalized === "deposit") return "Deposit";
  if (normalized === "withdrawal") return "Withdrawal";
  if (normalized === "transfer") return "Transfer";

  return undefined;
}

/**
 * Parse account type from string
 * 
 * @param type - string representation of account type
 * @returns normalize account type 
 */
export function parseAccountType(type: string): AccountType | undefined {
  if (!type) return undefined;

  const normalized = type.toLowerCase().trim();

  if (normalized === "current" || normalized === "checking") return "Current";
  if (normalized === "savings") return "Savings";

  return undefined;
}

/**
 * Safely parse integer
 * 
 * @param value - String representation of integer
 * @returns Parsed integer or 0 if invalid
 */
export function parseInteger(value: string): number {
  if (!value || value.trim() === "") return 0;

  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * validate email
 * 
 * @param email - Email string
 * @returns cleaned email or empty string if invalid
 */
export function parseEmail(email: string): string {
  if (!email) return "";

  const trimmed = email.trim().toLowerCase();
  
  // email validation regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  return emailRegex.test(trimmed) ? trimmed : "";
}

/**
 * Parse phone number 
 * 
 * @param phone - Phone number string
 * @returns cleaned phone number
 */
export function parsePhone(phone: string): string {
  if (!phone) return "";

  // We remove all non-numeric characters except + at start
  return phone.trim().replace(/[^\d+]/g, "");
}
