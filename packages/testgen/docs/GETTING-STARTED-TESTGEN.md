# Automated Test Generation - Getting Started Guide

This guide covers everything you need to know to use the automated test generation system for React 19 components.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Available Commands](#available-commands)
3. [How It Works](#how-it-works)
4. [Generated Test Structure](#generated-test-structure)
5. [Best Practices](#best-practices)
6. [Troubleshooting](#troubleshooting)
7. [Reuse In Another Repo](#reuse-in-another-repo)

---

## Quick Start

### 1. Verify Dependencies Are Installed

All required dependencies should already be installed. If not, run:

```bash
npm install
```

Required dev dependencies (already in package.json):

- `@babel/parser`, `@babel/traverse` - AST parsing for export detection
- `ts-morph` - TypeScript type extraction
- `chokidar` - File watching
- `prettier` - Code formatting
- `jest`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event` - Testing

### 2. Start Development with Auto Test Generation

```bash
npm start
```

This runs BOTH:

- Webpack dev server (your app at http://localhost:3000)
- Test generator in watch mode (creates tests when you edit files)

### 3. Run Tests

```bash
npm test                    # Run all tests
npm run test:watch          # Run tests in watch mode
npm run test:coverage       # Run with coverage report
npm run test:coverage:check # Run with 80% coverage threshold
```

---

## Available Commands

### Development

| Command                    | Description                              |
| -------------------------- | ---------------------------------------- |
| `npm start`                | Run dev server + test generator watcher  |
| `npm run start:raw`        | Run only dev server (no test generation) |
| `npm run start:no-testgen` | Same as start:raw                        |

### Test Generation

| Command                              | Description                                         |
| ------------------------------------ | --------------------------------------------------- |
| `npm run test:generate:git`          | Generate tests for git unstaged files only (safest) |
| `npm run test:generate`              | Generate tests for ALL source files                 |
| `npm run test:generate:file <path>`  | Generate test for a single file                     |

### Testing

| Command                       | Description                    |
| ----------------------------- | ------------------------------ |
| `npm test`                    | Run all tests                  |
| `npm run test:watch`          | Run tests in watch mode        |
| `npm run test:coverage`       | Run with coverage report       |
| `npm run test:coverage:check` | Enforce 80% coverage threshold |

---

## How It Works

### File Detection

The generator uses **Babel AST parsing** to detect exports from your source files:

```
Source File                    Generated Test
───────────────────────────────────────────────────
src/components/Button.tsx  →   src/components/__tests__/Button.test.tsx
src/hooks/useAuth.ts       →   src/hooks/__tests__/useAuth.test.ts
src/utils/formatters.ts    →   src/utils/__tests__/formatters.test.ts
```

### Safety Rules

1. **Only generates for changed files** (in git-unstaged or watch mode)
2. **Never overwrites manual tests** - Files without this header are safe:
   ```typescript
   /** @generated AUTO-GENERATED FILE - safe to overwrite */
   ```
3. **Skips certain files**:
   - `index.ts/tsx` files (typically re-exports)
   - Files in `__tests__` directories
   - Files in `node_modules`, `dist`, `build`, `coverage`

### Component Detection

A file is treated as a React component if:

- Export name starts with uppercase (e.g., `Button`, `UserCard`)
- Contains JSX syntax (`<` with `/>` or `</`)
- Uses standard function declarations or arrow functions

**Known Limitation:** Components created with `forwardRef` are not automatically detected. You'll need to write tests manually for these components.

---

## Generated Test Structure

### For React Components

```typescript
/** @generated AUTO-GENERATED FILE - safe to overwrite */
import * as React from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../../test-utils/renderWithProviders";
import Button from "../Button";

describe("Button", () => {
  // Auto-detected required props
  const defaultProps = {
    onClick: () => { /* TODO */ },
    children: "TODO",
  };

  // ============ Rendering ============
  describe("Rendering", () => {
    it("renders without crashing", () => {
      renderWithProviders(<Button {...defaultProps} />);
    });

    it("renders with default props", () => {
      const { container } = renderWithProviders(<Button {...defaultProps} />);
      expect(container.firstChild).toBeInTheDocument();
    });
  });

  // ============ Snapshot ============
  describe("Snapshot", () => {
    it("matches snapshot", () => {
      const { container } = renderWithProviders(<Button {...defaultProps} />);
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  // ============ Props ============
  describe("Props", () => { /* ... */ });

  // ============ User Interactions ============
  describe("User Interactions", () => { /* ... */ });

  // ============ Accessibility ============
  describe("Accessibility", () => { /* ... */ });
});
```

### For Utility Functions

```typescript
/** @generated AUTO-GENERATED FILE - safe to overwrite */
import { formatCurrency, formatDate } from '../formatters';

describe('formatters', () => {
  describe('formatCurrency', () => {
    it('is defined', () => {
      expect(formatCurrency).toBeDefined();
    });

    it('handles valid input', () => {
      // TODO: Add test for valid input
    });

    it('handles edge cases', () => {
      // TODO: Add edge case tests
    });
  });

  describe('formatDate', () => {
    // Similar structure...
  });
});
```

---

## Best Practices

### 1. Use Git-Unstaged Mode for Safety

```bash
# Before committing, generate tests only for your changes
npm run test:generate:git

# Then run tests
npm test
```

### 2. Add Proper Selectors to Components

The generator creates TODO placeholders. Replace them with proper selectors:

```typescript
// ❌ Generated placeholder
const button = screen.getByRole('button');

// ✅ Better - use accessible name
const button = screen.getByRole('button', { name: /submit/i });

// ✅ Or add data-testid for complex elements
const chart = screen.getByTestId('expense-chart');
```

### 3. Fill in Required Props

The generator tries to detect required props, but may need manual updates:

```typescript
// Generated (may need adjustment)
const defaultProps = {
  title: 'TODO',
  onSubmit: () => {
    /* TODO */
  },
};

// ✅ Update with realistic values
const defaultProps = {
  title: 'Create Expense',
  onSubmit: jest.fn(),
};
```

### 4. Add Branch Coverage Tests

Generated tests provide baseline coverage. Add tests for:

```typescript
// Loading state
it("shows loading spinner when loading", () => {
  renderWithProviders(<ExpenseList isLoading={true} />);
  expect(screen.getByRole("status")).toBeInTheDocument();
});

// Error state
it("shows error message on error", () => {
  renderWithProviders(<ExpenseList error="Failed to load" />);
  expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
});

// Empty state
it("shows empty state when no data", () => {
  renderWithProviders(<ExpenseList expenses={[]} />);
  expect(screen.getByText(/no expenses/i)).toBeInTheDocument();
});
```

### 5. Update renderWithProviders for Your Needs

The test utility at `src/test-utils/renderWithProviders.tsx` wraps components with all app providers. Customize it if needed:

```typescript
// Already includes:
// - QueryClientProvider (React Query)
// - ThemeProvider
// - AuthProvider
// - NotificationProvider
// - ExpenseProvider
// - CategoryProvider
// - BudgetProvider
// - MemoryRouter (React Router)
```

---

## Troubleshooting

### "Cannot find module" in generated tests

**Cause**: Import path issues or path aliases not configured.

**Fix**: The generator computes relative imports automatically. If using path aliases like `@/`, ensure Jest is configured:

```javascript
// jest.config.js
moduleNameMapper: {
  "^@/(.*)$": "<rootDir>/src/$1",
  "^@components/(.*)$": "<rootDir>/src/components/$1",
  // ... etc
}
```

### "React refers to a UMD global" (TS2686)

**Cause**: Missing React import in TypeScript tests.

**Fix**: Generated tests include `import * as React from "react"`. If you see this error, ensure your `tsconfig.json` has:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "esModuleInterop": true
  }
}
```

### Tests fail because Router/Providers missing

**Cause**: Component expects context that isn't provided.

**Fix**: The `renderWithProviders` utility already wraps with MemoryRouter and all app providers. If you need custom initial route:

```typescript
renderWithProviders(<ExpensePage />, { initialRoute: "/expenses/123" });
```

### Generated tests fail for async components

**Cause**: Component shows loading state initially before data loads.

**Fix**: Components that fetch data will render a loading skeleton first. The generated tests detect buttons/inputs from the JSX but may not find them at runtime. Solutions:

1. Mock the data provider to return data immediately
2. Use `waitFor` to wait for elements to appear
3. Add `screen.findByRole` instead of `getByRole` for async elements

```typescript
// Instead of:
expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument();

// Use:
expect(await screen.findByRole('button', { name: /submit/i })).toBeInTheDocument();
```

### Coverage below 80%

**Cause**: Generated scaffolding provides baseline; complex branches need manual tests.

**Fix**:

1. Replace TODO placeholders with real props and assertions
2. Add tests for loading/error/empty states
3. Add interaction tests for all click/input handlers
4. Test conditional rendering branches

```bash
# Check current coverage
npm run test:coverage

# Enforce 80% threshold
npm run test:coverage:check
```

---

## Recommended Workflow

### Daily Development

```bash
# 1. Start development (includes test generator watcher)
npm start

# 2. Edit components - tests are auto-generated
# 3. Run tests periodically
npm test

# 4. Before committing, check coverage
npm run test:coverage:check
```

### Before Pull Request

```bash
# 1. Generate tests for your changes only
npm run test:generate:git

# 2. Run all tests
npm test

# 3. Check coverage meets threshold
npm run test:coverage:check

# 4. Commit and push
git add .
git commit -m "feat: add new feature with tests"
```

---

## Project Structure

```text
expense-manager/
├── src/
│   ├── components/
│   │   ├── Button.tsx
│   │   └── __tests__/
│   │       └── Button.test.tsx    ← Generated tests go here
│   ├── hooks/
│   ├── services/
│   ├── utils/
│   └── test-utils/
│       ├── renderWithProviders.tsx  ← Shared test wrapper
│       ├── setupTests.ts            ← Jest setup
│       └── index.ts
├── scripts/
│   ├── testgen/                    ← Modular test generator system
│   └── dev.mjs                     ← Dev server + watcher
├── jest.config.js
├── package.json
└── tsconfig.json
```

---

## Reuse In Another Repo

Use this checklist to install the same TSX test generator in a different repo.

### 1. Copy Files

Copy the entire tool directory into the target repo:

```
tools/react-testgen/
```

### 2. Add Scripts

Update the target repo [package.json](../package.json):

```json
"testgen": "ts-node tools/react-testgen/src/cli.ts",
"testgen:file": "ts-node tools/react-testgen/src/cli.ts --file",
"test": "jest --coverage && ts-node tools/react-testgen/src/coverage/report.ts"
```

### 3. Install Dev Dependencies

Ensure these dev dependencies exist in the target repo:

- `ts-morph`
- `ts-node`
- `typescript`
- `@types/node`
- `jest`
- `@testing-library/react`
- `@testing-library/jest-dom`
- `@testing-library/user-event`

### 4. Add Render Utilities

The generator expects this test helper:

```
src/test-utils/renderWithProviders.tsx
```

If your repo already has a custom render helper, update the generator import path in:

```
tools/react-testgen/src/generator/templates.ts
```

### 5. Ensure Jest Coverage Output

The tool reads:

```
coverage/coverage-summary.json
coverage/coverage-final.json
```

Your Jest command must include:

```
--coverage --coverageReporters=json-summary --coverageReporters=json
```

### 6. Run It

```bash
npm run testgen
npm run testgen:file -- src/path/Component.tsx
```

### 7. Verify Output

- Tests are created at `__tests__/Component.test.tsx` next to each TSX component
- Coverage table prints after `npm run test` and after `npm run testgen`

If you want the coverage table to include `.ts` files too, update the filter in:

```
tools/react-testgen/src/coverage/report.ts
```

---

## Summary


| Task                             | Command                              |
| -------------------------------- | ------------------------------------ |
| Start development                | `npm start`                          |
| Generate tests for changed files | `npm run test:generate:git`          |
| Generate tests for all files     | `npm run test:generate`              |
| Generate test for single file    | `npm run test:generate:file <path>`  |
| Run all tests                    | `npm test`                           |
| Run with coverage                | `npm run test:coverage`              |
| Enforce 80% coverage             | `npm run test:coverage:check`        |

The generator removes initial friction by creating test scaffolding, but you'll still need to:

1. Fill in TODO placeholders with real values
2. Add branch coverage tests (loading/error/empty states)
3. Add interaction tests with proper selectors

Happy testing!
