#!/usr/bin/env node
/**
 * Build a JSONL training dataset from (source, test) file pairs.
 *
 * Scans the expense-manager example for __tests__/ directories,
 * pairs each test file with its source, and formats them as
 * instruction-tuning examples for fine-tuning qwen2.5-coder.
 *
 * Usage:
 *   node packages/testgen/scripts/build-training-data.mjs
 *
 * Output:
 *   packages/testgen/training/dataset.jsonl
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../../examples/expense-manager/src');
const OUTPUT_DIR = path.resolve(__dirname, '../training');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'dataset.jsonl');

// ---------------------------------------------------------------------------
// Collect (source, test) pairs
// ---------------------------------------------------------------------------

function findTestFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__snapshots__') continue;
      results.push(...findTestFiles(fullPath));
    } else if (entry.name.match(/\.test\.(ts|tsx)$/)) {
      results.push(fullPath);
    }
  }
  return results;
}

function resolveSourceFile(testFilePath) {
  // __tests__/Foo.test.tsx -> ../Foo.tsx
  const dir = path.dirname(testFilePath);
  const parentDir = path.dirname(dir); // go up from __tests__
  const testName = path.basename(testFilePath)
    .replace('.test.tsx', '.tsx')
    .replace('.test.ts', '.ts');

  const candidates = [
    path.join(parentDir, testName),
    path.join(parentDir, testName.replace('.ts', '.tsx')),
    path.join(parentDir, testName.replace('.tsx', '.ts')),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Format as instruction-tuning JSONL
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a React testing expert. Given a React/TypeScript source file, generate a comprehensive Jest + React Testing Library test file.

Rules:
- Use Jest 29 + @testing-library/react 16 + @testing-library/user-event 14
- Import test globals from @jest/globals
- Use renderWithProviders for components that use context providers
- Use accessible queries (getByRole, getByLabelText, getByText)
- Test behavior, not implementation
- Include edge cases, error states, and interaction tests
- Use async/await with userEvent for interactions`;

function buildTrainingExample(sourceCode, sourcePath, testCode) {
  const relPath = path.relative(PROJECT_ROOT, sourcePath).replace(/\\/g, '/');

  return {
    messages: [
      {
        role: 'system',
        content: SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: `Generate a test file for this React component:\n\n## File: ${relPath}\n\`\`\`tsx\n${sourceCode}\n\`\`\``,
      },
      {
        role: 'assistant',
        content: `\`\`\`tsx\n${testCode}\n\`\`\``,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log(`Scanning: ${PROJECT_ROOT}`);

  const testFiles = findTestFiles(PROJECT_ROOT);
  console.log(`Found ${testFiles.length} test file(s)`);

  const pairs = [];
  let skipped = 0;

  for (const testFile of testFiles) {
    const sourceFile = resolveSourceFile(testFile);
    if (!sourceFile) {
      skipped++;
      continue;
    }

    const sourceCode = fs.readFileSync(sourceFile, 'utf8');
    const testCode = fs.readFileSync(testFile, 'utf8');

    // Skip very small files (barrel tests, etc.)
    if (testCode.split('\n').length < 10 || sourceCode.split('\n').length < 10) {
      skipped++;
      continue;
    }

    pairs.push({ sourceFile, testFile, sourceCode, testCode });
  }

  console.log(`Valid pairs: ${pairs.length} | Skipped: ${skipped}`);

  // Write JSONL
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const lines = pairs.map((p) => {
    const example = buildTrainingExample(p.sourceCode, p.sourceFile, p.testCode);
    return JSON.stringify(example);
  });

  fs.writeFileSync(OUTPUT_FILE, lines.join('\n') + '\n', 'utf8');
  console.log(`\nDataset written: ${OUTPUT_FILE}`);
  console.log(`Examples: ${lines.length}`);

  // Also write a summary
  const summary = pairs.map((p) => ({
    source: path.relative(PROJECT_ROOT, p.sourceFile).replace(/\\/g, '/'),
    test: path.relative(PROJECT_ROOT, p.testFile).replace(/\\/g, '/'),
    sourceLines: p.sourceCode.split('\n').length,
    testLines: p.testCode.split('\n').length,
  }));

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'summary.json'),
    JSON.stringify(summary, null, 2),
    'utf8'
  );
  console.log(`Summary written: ${path.join(OUTPUT_DIR, 'summary.json')}`);
}

main();
