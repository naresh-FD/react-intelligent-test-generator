# Automated Test Generation for React Components (Git & AST Based)

**Version:** 1.0
**Last Updated:** February 2026
**Maintainers:** Frontend Platform Team

---

## Table of Contents

1. [Overview](#1-overview)
2. [Key Principles](#2-key-principles)
3. [High-Level Architecture](#3-high-level-architecture)
4. [Workflow](#4-workflow)
5. [Modes of Operation](#5-modes-of-operation)
6. [Git-Based Safety Mechanism](#6-git-based-safety-mechanism)
7. [Test Generation Rules](#7-test-generation-rules)
8. [Component Test Strategy](#8-component-test-strategy)
9. [Utility Test Strategy](#9-utility-test-strategy)
10. [Import Resolution Strategy](#10-import-resolution-strategy)
11. [renderWithProviders Role](#11-renderwithproviders-role)
12. [Coverage Strategy](#12-coverage-strategy)
13. [Non-Goals](#13-non-goals)
14. [Benefits](#14-benefits)
15. [Limitations](#15-limitations)
16. [When to Use / When Not to Use](#16-when-to-use--when-not-to-use)
17. [Example](#17-example)
18. [Summary](#18-summary)

---

## 1. Overview

### What Problem This Solves

Modern React applications require comprehensive test coverage, but writing boilerplate test code is time-consuming and error-prone. Teams often face:

- **Inconsistent test structure** across components written by different developers
- **Missing tests** for new components due to time pressure
- **Delayed testing** where tests are written long after the component, leading to gaps
- **Onboarding friction** where new developers don't know the team's testing patterns

### Why Automatic Test Scaffolding Is Needed

Manual test creation for every component requires:

1. Creating the correct directory structure (`__tests__/`)
2. Setting up imports (component, testing utilities, providers)
3. Writing boilerplate render tests
4. Remembering accessibility and interaction patterns
5. Configuring snapshot tests

This repetitive work discourages thorough testing and introduces inconsistency.

### Why This Approach Is Safer Than Blanket Auto-Generation

Unlike tools that regenerate all tests on every run, this system:

- **Processes only changed files** - Minimizes unintended side effects
- **Never overwrites manual tests** - Preserves human-authored test logic
- **Generates scaffolds, not assertions** - Developers complete the meaningful parts
- **Uses deterministic AST parsing** - No AI hallucinations or unpredictable output
- **Integrates with Git** - Respects version control boundaries

---

## 2. Key Principles

| Principle | Description |
|-----------|-------------|
| **Generate tests ONLY for changed files** | The system processes only files that appear in Git's unstaged changes, not the entire codebase |
| **Never touch unrelated files** | Files outside the change set are completely ignored |
| **Manual tests are never overwritten** | If a test file exists without the `@generated` header, it is skipped |
| **Generated tests are clearly marked** | All generated files include `/** @generated AUTO-GENERATED FILE - safe to overwrite */` |
| **Deterministic, non-AI generation** | Output is based purely on AST analysis; no machine learning or external API calls |

---

## 3. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        auto-testgen.mjs                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │     Git      │───▶│    Babel     │───▶│   ts-morph   │          │
│  │  Integration │    │   Parser     │    │    Types     │          │
│  └──────────────┘    └──────────────┘    └──────────────┘          │
│         │                   │                   │                   │
│         ▼                   ▼                   ▼                   │
│  ┌──────────────────────────────────────────────────────┐          │
│  │              Test Template Generator                  │          │
│  │  - Component detection                                │          │
│  │  - Export enumeration                                 │          │
│  │  - Props extraction                                   │          │
│  └──────────────────────────────────────────────────────┘          │
│                            │                                        │
│                            ▼                                        │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │   Prettier   │───▶│  File Write  │───▶│     Jest     │          │
│  │  Formatting  │    │   (atomic)   │    │  Execution   │          │
│  └──────────────┘    └──────────────┘    └──────────────┘          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Breakdown

| Component | Technology | Purpose |
|-----------|------------|---------|
| Git Integration | `child_process` / shell | Identifies changed files via `git diff` |
| AST Parser | `@babel/parser` | Parses TypeScript/JSX to extract exports |
| Type Extraction | `ts-morph` | Reads TypeScript interfaces for prop types |
| Formatter | `prettier` | Ensures consistent code style |
| Test Runner | `jest` + `@testing-library/react` | Executes generated tests |

---

## 4. Workflow

```
Developer Workflow
==================

1. Developer modifies a React/TS file
   └── src/components/Button.tsx (edited)

2. File appears in git unstaged changes
   └── $ git diff --name-only
       src/components/Button.tsx

3. Generator reads only those files
   └── $ npm run testgen
       Processing: src/components/Button.tsx

4. Corresponding test file is created/updated
   └── src/components/__tests__/Button.test.tsx (generated)

5. Developer reviews and completes TODOs
   └── Fill in mock data, assertions, edge cases

6. Jest enforces coverage thresholds
   └── $ npm test -- --coverage
       Coverage: 85% (threshold: 80%)

7. Commit both source and test files
   └── $ git add . && git commit
```

### Detailed Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Source    │────▶│  Git Diff   │────▶│  Generator  │────▶│  Test File  │
│   Change    │     │   Filter    │     │   Process   │     │   Output    │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                           │                   │
                           │                   ▼
                           │            ┌─────────────┐
                           │            │  Skip if:   │
                           │            │  - Manual   │
                           │            │  - No diff  │
                           │            │  - Excluded │
                           │            └─────────────┘
                           │
                           ▼
                    Only unstaged
                    source files
```

---

## 5. Modes of Operation

### 5.1 Git-Unstaged Mode (Primary)

```bash
npm run test:generate:git
```

**Behavior:**
- Reads `git diff --name-only` for unstaged changes
- Processes only modified `.ts`, `.tsx`, `.js`, `.jsx` files
- Skips files already in `__tests__/` directories
- Recommended for daily development

**Use Case:** Incremental test generation during active development.

### 5.2 All Mode (Manual / One-Time Only)

```bash
npm run test:generate
```

**Behavior:**
- Scans entire `src/` directory
- Processes all eligible source files
- Respects manual test protection (never overwrites)
- Should be used sparingly (initial setup, major refactors)

**Use Case:** Initial project setup or codebase-wide audit.

### 5.3 File Mode (Single-File Generation)

```bash
npm run test:generate:file src/components/MyComponent.tsx
```

**Behavior:**
- Processes exactly one specified file
- Useful for targeted regeneration
- Bypasses Git diff checks

**Use Case:** Regenerating a specific test after major component changes.

---

## 6. Git-Based Safety Mechanism

### How `git diff --name-only` Is Used

The generator queries Git to identify files with uncommitted changes:

```bash
git diff --name-only          # Unstaged changes only
git diff --name-only --cached # Staged changes (not used by default)
```

This ensures the generator only processes files the developer is actively working on.

### Why Only Unstaged Files Are Processed

| File State | Processed? | Rationale |
|------------|------------|-----------|
| Unstaged (modified) | Yes | Active development; tests should match |
| Staged | No | Developer has prepared for commit; don't interfere |
| Committed | No | Part of version history; regeneration could cause conflicts |
| Untracked | Optional | New files may need initial test scaffolding |

### Benefits for Large Repositories

- **Performance:** Scanning 5 changed files is faster than scanning 500
- **Safety:** Reduces blast radius of any generation bugs
- **Predictability:** Developers know exactly which files will be affected
- **CI Compatibility:** Prevents accidental mass regeneration in pipelines

---

## 7. Test Generation Rules

### 7.1 Test File Location

Tests are created in a `__tests__/` subdirectory adjacent to the source file:

| Source File | Generated Test File |
|-------------|---------------------|
| `src/components/Button.tsx` | `src/components/__tests__/Button.test.tsx` |
| `src/hooks/useAuth.ts` | `src/hooks/__tests__/useAuth.test.ts` |
| `src/utils/formatters.ts` | `src/utils/__tests__/formatters.test.ts` |
| `src/pages/Dashboard.tsx` | `src/pages/__tests__/Dashboard.test.tsx` |

### 7.2 Component vs Utility Detection

The generator distinguishes between React components and utility functions:

**Component Indicators:**
- Export name starts with uppercase letter (PascalCase)
- Source contains JSX syntax (`<`, `/>`, `</`)
- Standard function declarations or arrow functions

**Utility Indicators:**
- Export name starts with lowercase letter (camelCase)
- No JSX detected
- Pure function or constant export

**Known Limitation - forwardRef Components:**
Components created with `forwardRef` are currently not detected by the AST analyzer. This is because `forwardRef` wraps the component in a higher-order function call, making it harder to identify as a React component through static analysis. For these components, you should write tests manually or create a wrapper component that the generator can detect.

### 7.3 Export Detection Using AST

The Babel parser extracts exports through AST traversal:

```javascript
// Detected exports:
export default function Button() {}     // Default export (component)
export const formatDate = () => {}      // Named export (utility)
export { helper, utils }                // Re-exports
export class DataService {}             // Class export

// Filtered out (not tested):
export type ButtonProps = {}            // Type export
export interface Config {}              // Interface export
export type { SomeType }                // Type re-export
```

### 7.4 Filtering of Types/Interfaces/Contexts

The following patterns are automatically excluded from test generation:

| Pattern | Example | Reason |
|---------|---------|--------|
| Type aliases | `export type Props = {}` | Not runtime code |
| Interfaces | `export interface Config {}` | Not runtime code |
| Props suffix | `export type ButtonProps` | Convention for prop types |
| Context suffix | `export const ThemeContext` | Context objects need special handling |
| I-prefix interfaces | `export interface IUser` | Hungarian notation for interfaces |

---

## 8. Component Test Strategy

Generated component tests follow a consistent structure:

### 8.1 Render Tests

```typescript
describe('Rendering', () => {
  it('renders without crashing', () => {
    renderWithProviders(<Button {...defaultProps} />);
  });

  it('renders with default props', () => {
    const { container } = renderWithProviders(<Button {...defaultProps} />);
    expect(container.firstChild).toBeInTheDocument();
  });
});
```

**Purpose:** Verifies basic component mounting and DOM presence.

### 8.2 Snapshot Tests

```typescript
describe('Snapshot', () => {
  it('matches snapshot', () => {
    const { container } = renderWithProviders(<Button {...defaultProps} />);
    expect(container.firstChild).toMatchSnapshot();
  });
});
```

**Purpose:** Catches unintended UI regressions.

### 8.3 Props Handling with TODO Placeholders

```typescript
describe('Props', () => {
  // TODO: Add required props
  const defaultProps = {
    label: "TODO",           // Extracted from ButtonProps
    onClick: () => {},       // Function placeholder
  };

  it('applies custom className', () => {
    // TODO: Implement if component accepts className prop
    expect(true).toBe(true);
  });
});
```

**Purpose:** Scaffolds prop testing with type-aware placeholders.

### 8.4 User Interaction Stubs

```typescript
describe('User Interactions', () => {
  it('handles click events', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Button {...defaultProps} />);

    // TODO: Add click interaction tests
    // Example:
    // const button = screen.getByRole("button");
    // await user.click(button);
    // expect(mockHandler).toHaveBeenCalled();
  });

  it('handles input changes', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Button {...defaultProps} />);

    // TODO: Add input interaction tests
  });
});
```

**Purpose:** Provides interaction testing boilerplate with examples.

### 8.5 Accessibility Placeholders

```typescript
describe('Accessibility', () => {
  it('has no accessibility violations', async () => {
    // TODO: Add axe-core tests if available
    // const { container } = renderWithProviders(<Button {...defaultProps} />);
    // const results = await axe(container);
    // expect(results).toHaveNoViolations();
    expect(true).toBe(true);
  });

  it('has proper ARIA attributes', () => {
    renderWithProviders(<Button {...defaultProps} />);
    // TODO: Check for proper ARIA labels
  });

  it('is keyboard navigable', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Button {...defaultProps} />);
    // TODO: Test keyboard navigation
  });
});
```

**Purpose:** Encourages accessibility testing without failing by default.

### 8.6 Error Handling Stubs

Error boundary and error state testing can be added manually:

```typescript
// TODO: Add error handling tests
// it('displays error state on API failure', async () => {
//   server.use(rest.get('/api/data', (_, res, ctx) => res(ctx.status(500))));
//   renderWithProviders(<DataComponent />);
//   expect(await screen.findByText(/error/i)).toBeInTheDocument();
// });
```

---

## 9. Utility Test Strategy

Non-component exports receive simpler test scaffolding:

### 9.1 Export Existence Tests

```typescript
describe('formatDate', () => {
  it('is defined', () => {
    expect(formatDate).toBeDefined();
  });
});
```

**Purpose:** Confirms the export is accessible.

### 9.2 Basic Behavior Stubs

```typescript
describe('formatDate', () => {
  it('handles valid input', () => {
    // TODO: Add test for valid input
    // const result = formatDate(new Date('2024-01-01'));
    // expect(result).toEqual('January 1, 2024');
  });

  it('handles edge cases', () => {
    // TODO: Add edge case tests
  });

  it('handles invalid input', () => {
    // TODO: Add invalid input tests
    // expect(() => formatDate(null)).toThrow();
  });
});
```

**Purpose:** Provides structure for function testing.

### 9.3 Safe Placeholders

All generated stubs pass by default (`expect(true).toBe(true)`) to avoid blocking CI. Developers are expected to replace these with real assertions.

---

## 10. Import Resolution Strategy

### 10.1 Relative Imports Only

Generated tests use relative imports to maximize portability:

```typescript
// Generated import (relative)
import { Button } from '../Button';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';

// NOT generated (path aliases)
import { Button } from '@/components/Button';  // Avoided
import { renderWithProviders } from '@/test-utils';  // Avoided
```

**Rationale:**
- Works regardless of TypeScript path alias configuration
- Simpler Jest module resolution
- Fewer configuration dependencies

### 10.2 Correct Handling of `__tests__` Folders

Import paths account for the `__tests__/` directory depth:

```
Source:  src/components/Button.tsx
Test:    src/components/__tests__/Button.test.tsx

Import path from test to source:
  '../Button'  (go up from __tests__, reference Button.tsx)
```

### 10.3 renderWithProviders Resolution

The generator calculates the correct relative path to `renderWithProviders`:

```typescript
// From: src/components/__tests__/Button.test.tsx
// To:   src/test-utils/renderWithProviders.tsx

import { renderWithProviders } from '../../test-utils/renderWithProviders';
```

---

## 11. renderWithProviders Role

### 11.1 Why It Exists

React applications typically require multiple context providers:

- **React Query** - Data fetching state
- **React Router** - Navigation context
- **Theme Provider** - Styling context
- **Auth Provider** - Authentication state
- **Custom Contexts** - Application-specific state

Without a unified wrapper, every test would need to manually configure these providers.

### 11.2 Router Safety

```typescript
// renderWithProviders uses MemoryRouter by default
function renderWithProviders(ui, options = {}) {
  const { useMemoryRouter = true } = options;

  if (useMemoryRouter) {
    return <MemoryRouter>{wrapped}</MemoryRouter>;  // Safe for tests
  }
  return <BrowserRouter>{wrapped}</BrowserRouter>;  // Avoid in tests
}
```

**Why MemoryRouter:**
- Does not interact with browser history API
- Prevents Jest hanging from history listeners
- Allows controlled route testing with `initialEntries`

### 11.3 Context Extensibility

Adding new providers requires only updating `renderWithProviders`:

```typescript
function AllProviders({ children, queryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <NotificationProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </NotificationProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
```

### 11.4 Preventing Test Crashes

The wrapper handles common test environment issues:

| Issue | Solution |
|-------|----------|
| Missing QueryClient | Creates test-specific client with `retry: false` |
| Router context errors | Provides MemoryRouter wrapper |
| Auth context missing | Includes AuthProvider with test defaults |
| QueryClient memory leaks | Cleans up clients after each test |

---

## 12. Coverage Strategy

### 12.1 How Auto-Generated Tests Help Reach Baseline Coverage

Generated tests provide:

- **Line coverage** from render tests (component code executes)
- **Branch coverage** from default prop combinations
- **Function coverage** from exported function existence tests

Typical coverage boost from generated tests: **40-60% baseline coverage**.

### 12.2 Why 80% Is Enforced

```javascript
// jest.config.js
coverageThreshold: {
  global: {
    branches: 80,
    functions: 80,
    lines: 80,
    statements: 80,
  },
}
```

**Rationale:**
- 80% is achievable with generated scaffolds + minimal manual additions
- Forces developers to test critical paths
- Allows some flexibility for truly untestable code

### 12.3 Why Full Coverage Still Requires Human Intent

Generated tests cannot:

- Understand business logic requirements
- Create meaningful mock data
- Verify correct behavior (only that code runs)
- Test error boundaries with realistic scenarios
- Validate accessibility beyond structure

**The 80% floor is a starting point, not a ceiling.**

### 12.4 CI Compatibility

```yaml
# Example CI configuration
test:
  script:
    - npm run testgen:all    # Generate missing tests
    - npm test -- --coverage # Run with coverage enforcement
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```

Generated tests should be committed to the repository, not generated in CI.

---

## 13. Non-Goals

This system explicitly does NOT aim to:

| Non-Goal | Explanation |
|----------|-------------|
| **Replace real test design** | Generated tests are scaffolds; assertions must be human-authored |
| **Be a full AI test writer** | No machine learning, LLMs, or external AI services |
| **Provide snapshot-only testing** | Snapshots are one tool among many in generated tests |
| **Generate integration tests** | Focus is on unit/component tests |
| **Mock API responses** | MSW or similar mocking is left to developers |
| **Test implementation details** | Generated tests focus on public API and behavior |

---

## 14. Benefits

### For Frontend Engineers

- **Faster onboarding** - New team members see consistent test patterns
- **Reduced boilerplate** - No manual setup of imports and providers
- **Example-driven** - TODO comments show expected patterns

### For Tech Leads / Architects

- **Consistent structure** - All tests follow the same organization
- **Enforceable standards** - Coverage thresholds prevent gaps
- **Reduced review friction** - Test structure is predictable

### For QA Engineers

- **Baseline coverage** - Every component has at least render tests
- **Clear extension points** - TODOs indicate where to add edge cases
- **Accessibility scaffolding** - A11y tests are stubbed by default

### For DevOps / CI

- **Deterministic output** - No flaky generation based on AI
- **No external dependencies** - Works offline, no API keys needed
- **Fast execution** - Only changed files are processed

### Enterprise Compliance

- **Auditable** - Generated code is deterministic and reproducible
- **No data exfiltration** - No code sent to external services
- **Controlled updates** - Manual review before committing generated tests

---

## 15. Limitations

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| **TODO placeholders must be completed manually** | Generated tests pass but don't verify behavior | Enforce code review for test quality |
| **Complex logic needs hand-written tests** | Edge cases, error handling not auto-generated | Add manual tests for critical paths |
| **AST/type extraction is best-effort** | Some prop types may not be detected | Review generated `defaultProps` |
| **No mock data generation** | Developers must provide realistic test data | Create shared test fixtures |
| **Dynamic components are harder to test** | Components with complex conditional rendering | Manual test augmentation required |
| **Context-dependent components** | May need custom provider configuration | Use `renderWithProviders` options |
| **forwardRef components not detected** | Components using `forwardRef` are skipped | Write tests manually for these components |
| **Async/Loading components** | Generated tests may fail if component shows loading state initially | Use `waitFor` or mock data providers to render final state |

---

## 16. When to Use / When Not to Use

### Ideal Use Cases

| Scenario | Recommendation |
|----------|----------------|
| **Greenfield projects** | Use from day one for consistent patterns |
| **New component creation** | Generate immediately after creating component |
| **Refactoring existing components** | Regenerate tests to match new structure |
| **Increasing coverage quickly** | Run `testgen:all` for baseline coverage |
| **Onboarding new developers** | Generated tests serve as documentation |

### Suboptimal Use Cases

| Scenario | Recommendation |
|----------|----------------|
| **Legacy codebase with existing tests** | Risk of conflicts; use file mode selectively |
| **Highly dynamic components** | Portal-based, animation-heavy components need manual tests |
| **Critical business logic** | Write tests manually with full assertions |
| **Components with complex state machines** | Generated tests won't cover state transitions |
| **Performance-sensitive rendering** | Profiling tests require manual setup |

### When to Skip Generation

- Component is a thin wrapper with no logic
- Component is deprecated and scheduled for removal
- Manual test already exists with comprehensive coverage
- Component requires integration testing (not unit testing)

---

## 17. Example

### Before: Modified React Component

```typescript
// src/components/expense/ExpenseCard.tsx

import { formatCurrency, formatDate } from '@/utils/formatters';
import { Card } from '@/components/common/Card';
import { Badge } from '@/components/common/Badge';

export interface ExpenseCardProps {
  id: string;
  amount: number;
  category: string;
  date: Date;
  description?: string;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
}

export function ExpenseCard({
  id,
  amount,
  category,
  date,
  description,
  onEdit,
  onDelete,
}: ExpenseCardProps) {
  return (
    <Card className="expense-card">
      <div className="expense-card__header">
        <Badge variant="category">{category}</Badge>
        <span className="expense-card__date">{formatDate(date)}</span>
      </div>
      <div className="expense-card__amount">
        {formatCurrency(amount)}
      </div>
      {description && (
        <p className="expense-card__description">{description}</p>
      )}
      <div className="expense-card__actions">
        {onEdit && (
          <button onClick={() => onEdit(id)} aria-label="Edit expense">
            Edit
          </button>
        )}
        {onDelete && (
          <button onClick={() => onDelete(id)} aria-label="Delete expense">
            Delete
          </button>
        )}
      </div>
    </Card>
  );
}
```

### After: Generated Test File

```typescript
// src/components/expense/__tests__/ExpenseCard.test.tsx

/** @generated AUTO-GENERATED FILE - safe to overwrite */
import * as React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import { ExpenseCard } from '../ExpenseCard';

describe('ExpenseCard', () => {
  const defaultProps = {
    id: "TODO",
    amount: 0,
    category: "TODO",
    date: undefined /* TODO */,
  };

  // ============ Rendering ============
  describe('Rendering', () => {
    it('renders without crashing', () => {
      renderWithProviders(<ExpenseCard {...defaultProps} />);
    });

    it('renders with default props', () => {
      const { container } = renderWithProviders(<ExpenseCard {...defaultProps} />);
      expect(container.firstChild).toBeInTheDocument();
    });
  });

  // ============ Snapshot ============
  describe('Snapshot', () => {
    it('matches snapshot', () => {
      const { container } = renderWithProviders(<ExpenseCard {...defaultProps} />);
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  // ============ Props ============
  describe('Props', () => {
    it('applies custom className', () => {
      // TODO: Implement if component accepts className prop
      expect(true).toBe(true);
    });

    it('handles optional props correctly', () => {
      // TODO: Test optional prop combinations
      expect(true).toBe(true);
    });
  });

  // ============ User Interactions ============
  describe('User Interactions', () => {
    it('handles click events', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ExpenseCard {...defaultProps} />);

      // TODO: Add click interaction tests
      // Example:
      // const button = screen.getByRole("button");
      // await user.click(button);
      // expect(mockHandler).toHaveBeenCalled();
    });

    it('handles input changes', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ExpenseCard {...defaultProps} />);

      // TODO: Add input interaction tests
      // Example:
      // const input = screen.getByRole("textbox");
      // await user.type(input, "test");
      // expect(input).toHaveValue("test");
    });
  });

  // ============ Accessibility ============
  describe('Accessibility', () => {
    it('has no accessibility violations', async () => {
      // TODO: Add axe-core tests if available
      // const { container } = renderWithProviders(<ExpenseCard {...defaultProps} />);
      // const results = await axe(container);
      // expect(results).toHaveNoViolations();
      expect(true).toBe(true);
    });

    it('has proper ARIA attributes', () => {
      renderWithProviders(<ExpenseCard {...defaultProps} />);

      // TODO: Check for proper ARIA labels
      // Example:
      // expect(screen.getByRole("button")).toHaveAttribute("aria-label");
    });

    it('is keyboard navigable', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ExpenseCard {...defaultProps} />);

      // TODO: Test keyboard navigation
      // Example:
      // await user.tab();
      // expect(screen.getByRole("button")).toHaveFocus();
    });
  });
});
```

### Developer Completion

After generation, a developer would complete the TODOs:

```typescript
// Completed defaultProps
const defaultProps = {
  id: "expense-123",
  amount: 49.99,
  category: "Food & Dining",
  date: new Date('2024-06-15'),
};

// Completed interaction test
it('handles click events', async () => {
  const user = userEvent.setup();
  const handleEdit = jest.fn();
  const handleDelete = jest.fn();

  renderWithProviders(
    <ExpenseCard
      {...defaultProps}
      onEdit={handleEdit}
      onDelete={handleDelete}
    />
  );

  await user.click(screen.getByRole('button', { name: /edit/i }));
  expect(handleEdit).toHaveBeenCalledWith('expense-123');

  await user.click(screen.getByRole('button', { name: /delete/i }));
  expect(handleDelete).toHaveBeenCalledWith('expense-123');
});
```

---

## 18. Summary

### Why This Approach Is Pragmatic

1. **Reduces friction** - Developers spend less time on boilerplate
2. **Increases consistency** - All tests follow the same structure
3. **Provides guardrails** - Coverage thresholds enforce testing discipline
4. **Respects human judgment** - TODOs require developer completion
5. **Integrates with Git** - Changes are scoped and predictable

### How It Balances Automation and Control

| Aspect | Automated | Human-Controlled |
|--------|-----------|------------------|
| Test file creation | Yes | - |
| Import resolution | Yes | - |
| Basic render tests | Yes | - |
| Snapshot setup | Yes | - |
| Prop extraction | Yes (best-effort) | Review required |
| Meaningful assertions | - | Yes |
| Mock data creation | - | Yes |
| Edge case testing | - | Yes |
| Error handling tests | - | Yes |
| Accessibility validation | - | Yes |

### Final Recommendation

Use this system as a **testing accelerator**, not a testing replacement. The generated scaffolds provide a consistent starting point, but the quality of your test suite ultimately depends on the assertions and edge cases that developers add.

**Generated tests get you to 60% coverage. Human intent gets you to 100% confidence.**

---

## Appendix: Quick Reference

### Commands

```bash
npm run test:generate:git           # Process unstaged Git changes (recommended)
npm run test:generate               # Process all source files
npm run test:generate:file <path>   # Process single file
```

### Configuration Files

| File | Purpose |
|------|---------|
| `scripts/testgen/index.mjs` | Main generator entry point |
| `scripts/testgen/analysis/tsxAnalyzer.mjs` | Component AST analyzer |
| `scripts/testgen/generation/testWriter.mjs` | Test code generator |
| `scripts/testgen/config.mjs` | Generator configuration |
| `src/test-utils/renderWithProviders.tsx` | Test wrapper utility |
| `src/test-utils/setupTests.ts` | Jest environment setup |
| `jest.config.js` | Jest configuration |

### Generated File Markers

```typescript
/** @generated AUTO-GENERATED FILE - safe to overwrite */
```

Tests with this header will be regenerated. Remove the header to protect manual edits.
