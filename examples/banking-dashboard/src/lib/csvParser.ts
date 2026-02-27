/**
 * CSV Parsing Utility
 * Handles CSV file reading and parsing
 */

import Papa from "papaparse";
import { RawBankingRecord } from "./types";

export interface ParseResult {
  data: RawBankingRecord[];
  errors: Papa.ParseError[];
  meta: Papa.ParseMeta;
}

/**
 * Parse CSV file into typed records
 * 
 * @param file - CSV file to parse
 * @returns Promise with parsed data
 */
export function parseCSVFile(file: File): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<RawBankingRecord>(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false, // Keep as strings for manual parsing
      complete: (results) => {
        resolve({
          data: results.data,
          errors: results.errors,
          meta: results.meta,
        });
      },
      error: (error) => {
        reject(error);
      },
    });
  });
}
