# React Test Generator - Reuse Guide

## Overview

This is an intelligent, automated test generator for React applications built with TypeScript. It uses static analysis (AST parsing) to understand your code structure and generates comprehensive, framework-aware tests following React Testing Library best practices.

**Key Capabilities:**

- **Multi-type Detection**: Components, Services, Contexts, Utilities, Barrel files
- **Smart Testing**: Different strategies for different file types
- **Framework Aware**: Auto-detects Jest vs Vitest
- **Production Ready**: Used in real projects, handles complex scenarios
- **Git Integration**: Works with your git workflow (unstaged changes)
- **Customizable**: Centralized config for contexts, patterns, exclusions

## What It Does

The test generator:

- Parses React components using TypeScript AST (ts-morph)
- Analyzes props, hooks, event handlers, and contexts
- Generates RTL test files with:
  - Basic render tests
  - Prop variant tests
  - User interaction tests
  - Mock setups
- Automatically detects custom render utilities
- Supports both TypeScript and JavaScript React components
- Generates specialized tests for:
  - Barrel/index files (re-export testing)
  - Context providers and hooks
  - Utility functions and helpers
  - Service/API modules with axios mocking
- Auto-detects test framework (Jest vs Vitest)
- Intelligently skips test utility files and browser-only code

## File Structure

```
packages/testgen/
├── package.json            # Generator dependencies
├── tsconfig.json           # TypeScript config
└── src/
    ├── cli.ts              # Main CLI entry point
    ├── config.ts           # Configuration loader
    ├── fs.ts               # File system utilities
    ├── parser.ts           # AST parser (ts-morph)
    ├── analyzer.ts         # Component analyzer
    └── generator/
        ├── index.ts        # Main orchestrator
        ├── templates.ts    # Test templates with framework detection
        ├── render.ts       # Render statement generator
        ├── interactions.ts # Interaction tests
        ├── mocks.ts        # Mock generation
        ├── variants.ts     # Prop variant tests
        ├── barrel.ts       # Barrel/index file test generation
        ├── context.ts      # Context provider test generation
        └── utility.ts      # Utility/service/function test generation
    └── utils/
        ├── path.ts         # Path utilities
        ├── format.ts       # Code formatting
        └── framework.ts    # Framework detection
└── docs/
    └── REUSE-TESTGEN.md    # This file
```

## Installation

### 1. Copy the Generator Package

Copy the entire `packages/testgen/` directory to your project.

### 2. Install Dependencies

```bash
cd packages/testgen
npm install
```

The generator requires:

- `ts-morph`: ^21.0.0 (TypeScript AST parser)
- `typescript`: ^5.3.3
- `ts-node`: ^10.9.2

### 3. Ensure Testing Dependencies

Your app should have:

```bash
npm install --save-dev \
  @testing-library/react \
  @testing-library/jest-dom \
  @testing-library/user-event \
  jest \
  @types/jest
```

### 4. Add Scripts to Root package.json

```json
{
  "scripts": {
    "testgen": "ts-node --project packages/testgen/tsconfig.json packages/testgen/src/cli.ts --git-unstaged",
    "testgen:file": "ts-node --project packages/testgen/tsconfig.json packages/testgen/src/cli.ts --file",
    "testgen:all": "ts-node --project packages/testgen/tsconfig.json packages/testgen/src/cli.ts --all"
  }
}
```

## Configuration

### Configuration in `src/config.ts`

The generator uses a centralized configuration file at `packages/testgen/src/config.ts`. Key configuration options:

```typescript
// Test utility patterns - files to exclude from test generation
export const TEST_UTILITY_PATTERNS = {
  directories: ['/test-utils/', '/test-helpers/', '/_test-utils_/'],
  filenamePatterns: [/^(renderWithProviders|customRender|test-?helpers?|test-?utils?)/i],
}

// Untestable patterns - files that cannot run in Node.js/Jest
export const UNTESTABLE_PATTERNS = {
  directories: [
    '/mocks/browser', // MSW browser setup
    '/mocks/handlers/', // MSW handlers with ESM dependencies
    '/mocks/data/', // MSW mock data
  ],
}
```

**Why these exclusions?**

- Test utility files are testing infrastructure, not code to test
- MSW browser files use browser-only APIs (Service Workers)
- MSW handlers often import ESM-only packages incompatible with Jest

### Optional: Create Custom Render Utility

Create `src/test-utils/renderWithProviders.tsx`:

```tsx
import { render, RenderOptions } from '@testing-library/react'
import { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    )
  }

  return render(ui, { wrapper: Wrapper, ...options })
}

export * from '@testing-library/react'
```

If this file exists, the generator will use `renderWithProviders` instead of the default `render`.

### Customize Context Detection

The generator automatically detects React contexts and providers your components use. You can customize this behavior in `src/config.ts` by modifying the `CONTEXT_DETECTION_CONFIG` object:

```typescript
// React Router detection
export const CONTEXT_DETECTION_CONFIG = {
  router: {
    hooks: ['useNavigate', 'useLocation', 'useParams', 'useSearchParams'],
    imports: ['react-router', 'react-router-dom'],
  },

  // React Query detection
  reactQuery: {
    hooks: ['useQuery', 'useMutation', 'useQueryClient', 'useInfiniteQuery'],
    imports: ['@tanstack/react-query', 'react-query'],
  },

  // Custom context providers specific to your app
  customContexts: [
    {
      name: 'Notification',
      hooks: ['useNotification'],
      contextName: 'NotificationContext',
      providerName: 'NotificationProvider',
    },
    {
      name: 'Api',
      hooks: ['useApi'],
      contextName: 'ApiContext',
      providerName: 'ApiProvider',
      providerProps: {
        baseUrl: 'http://localhost',
        channel: 'test',
        contextId: 'test-context',
        authReceipt: 'test-auth',
      },
    },
  ],

  // Patterns for detecting methods in hook returns (action verbs)
  methodPatterns: [
    'set', 'add', 'remove', 'update', 'delete', 'toggle',
    'fetch', 'load', 'save', 'clear', 'reset', 'login',
    'logout', 'register', 'create', 'edit', 'submit',
    'handle', 'dispatch', 'notify',
  ],

  // Patterns for detecting state values in hook returns
  statePatterns: [
    'is', 'has', 'can', 'should', 'loading', 'error',
    'data', 'items', 'list', 'user', 'token', 'theme',
    'state', 'count', 'total', 'current', 'selected',
  ],
}
```

**When to add custom contexts:**

- Your app uses a custom context provider (e.g., `AuthProvider`, `CartProvider`)
- Components use custom hooks (e.g., `useAuth()`, `useCart()`)
- Tests need these providers wrapped around components to avoid errors

**Benefits of centralized configuration:**

- Easy to maintain and update detection patterns
- Reusable across different codebases
- No need to modify generator code for new contexts
- Self-documenting configuration

## Usage

### Generate Tests for Git Unstaged Files (Default)

```bash
npm run testgen
```

This finds all modified (unstaged) files and generates appropriate tests based on file type:

- **React Components** → Component tests with render, props, interactions
- **Context Providers** → Provider + hook tests
- **Service/API Modules** → Tests with axios mocking
- **Utility Functions** → Pure function tests
- **Barrel Files** → Export verification tests

### Generate Test for Specific File

```bash
npm run testgen:file src/components/Button.tsx
npm run testgen:file src/contexts/AuthContext.tsx
npm run testgen:file src/services/userService.ts
npm run testgen:file src/utils/formatDate.ts
```

### Generate Tests for All Files

```bash
npm run testgen:all
```

> **Warning**: This will attempt to generate tests for ALL TypeScript/TSX files in your project.

Files automatically skipped:

- Existing test files (`*.test.tsx`, `*.spec.ts`)
- Test utility files (renderWithProviders, test helpers)
- Browser-only code (MSW handlers, mock data)
- Files in `node_modules/`

## How It Works

### 1. **File Discovery** (`cli.ts`, `utils/path.ts`)

- Scans project for React component files
- Uses git to find unstaged changes
- Intelligently detects file types:
  - **Barrel files**: index.ts/tsx with mostly re-exports
  - **Context files**: Files with createContext and Provider
  - **Service files**: Modules with axios/fetch + async methods
  - **Utility files**: Non-component TypeScript files
  - **Test utilities**: Helper files for testing (excluded)
  - **Untestable files**: Browser-only code (MSW, etc.)
- Filters based on `TEST_UTILITY_PATTERNS` and `UNTESTABLE_PATTERNS`

### 2. **Parsing** (`parser.ts`)

- Uses `ts-morph` to parse TypeScript/TSX files
- Builds Abstract Syntax Tree (AST)
- Extracts component metadata:
  - Component name
  - Props interface
  - Imports
  - Export type (default/named)

### 3. **Analysis** (`analyzer.ts`)

- Analyzes component structure:
  - **Props**: Types, required/optional, default values
  - **Hooks**: useState, useEffect, useContext, etc.
  - **Event Handlers**: onClick, onChange, onSubmit, etc.
  - **Contexts**: useContext calls
  - **Conditional Rendering**: Ternaries, && operators

### 4. **Generation** (`generator/`)

- **Components** (`generator/index.ts`): Render, prop variants, interactions
- **Contexts** (`generator/context.ts`): Provider wrapping, hook testing
- **Services** (`generator/utility.ts`): Mocked HTTP calls
- **Utilities/Services** (`generator/utility.ts`): Unit tests for exported functions
- **Formatting** (`utils/format.ts`): Cleans up generated code

### 5. **Output**

- Creates `__tests__/` directory next to source file
- Writes test file (e.g., `ComponentName.test.tsx`)
- Skips if test already exists (no overwrites)

## File Type Detection & Routing

The generator intelligently routes files to appropriate test generators:

### React Components

**Detection:** Exported function/class that returns JSX

**Generated Tests:**

- Render test with required props
- Optional prop variants
- Event handler interactions
- Context/provider wrapping if needed

**Example:** `Button.tsx` → `Button.test.tsx` with render, props, onClick tests

### Context Provider Files

**Detection:**

- Filename contains "context"
- Contains `createContext()` and `Provider`

**Generated Tests:**

- Provider wraps children correctly
- Custom hook works within provider
- State updates through hook methods

**Example:** `AuthContext.tsx` → tests for `AuthProvider` + `useAuth()`

### Service/API Files

**Detection:**

- Filename matches service/api/client/repository patterns
- Contains axios/fetch imports + 2+ async methods

**Generated Tests:**

- Comprehensive axios instance mocks
- Mock interceptors (request/response)
- Tests for each exported async method
- API module import mocking

**Example:** `userService.ts` → tests with mocked HTTP calls

### Utility/Helper Files

**Detection:**

- TypeScript file with exported functions
- No React component or context patterns

**Generated Tests:**

- Unit tests for each exported function
- Parameter variation tests
- Return value assertions

**Example:** `formatDate.ts` → pure function tests

### Barrel/Index Files

**Detection:**

- Filename is index.ts/tsx
- 70%+ of lines are import/export statements

**Generated Tests:**

- Verifies each named export is defined
- Simple smoke tests

**Example:** `index.ts` → tests that Button, Input exports exist

### Excluded Files

**Test Utilities:**

- `renderWithProviders.tsx`
- Files in `/test-utils/`, `/test-helpers/`
- Matches `TEST_UTILITY_PATTERNS`

**Untestable Files:**

- MSW browser setup (`/mocks/browser`)
- MSW handlers (`/mocks/handlers/`)
- ESM-only or browser-API dependent code

## Generated Test Examples

### Component Test

```tsx
import { describe, it, expect } from '@jest/globals'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '../Button'
import { renderWithProviders } from 'src/test-utils/renderWithProviders'

describe('Button', () => {
  it('renders without crashing', () => {
    renderWithProviders(<Button label="Click me" />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('renders with disabled prop', () => {
    renderWithProviders(<Button label="Click me" disabled={true} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('calls onClick when click occurs', async () => {
    const mockClick = jest.fn()
    renderWithProviders(<Button label="Click me" onClick={mockClick} />)

    const element = screen.getByRole('button')
    await userEvent.click(element)

    expect(mockClick).toHaveBeenCalled()
  })
})
```

### Service Test (with Axios Mocking)

```tsx
import { describe, it, expect } from '@jest/globals'

const mockAxiosInstance = {
  get: jest.fn().mockResolvedValue({ data: {} }),
  post: jest.fn().mockResolvedValue({ data: {} }),
  interceptors: {
    request: { use: jest.fn(), eject: jest.fn() },
    response: { use: jest.fn(), eject: jest.fn() },
  },
}

jest.mock('axios', () => ({
  __esModule: true,
  default: { create: () => mockAxiosInstance },
  create: () => mockAxiosInstance,
}))

import { userService } from '../userService'

describe('userService', () => {
  it('getUser returns user data', async () => {
    const mockData = { id: 1, name: 'Test' }
    mockAxiosInstance.get.mockResolvedValueOnce({ data: mockData })

    const result = await userService.getUser(1)
    expect(result).toEqual(mockData)
  })
})
```

### Context Provider Test

```tsx
import { describe, it, expect } from '@jest/globals'
import React from 'react'
import { render, renderHook, act } from '@testing-library/react'
import { NotificationProvider, useNotification } from '../NotificationContext'

describe('NotificationContext', () => {
  it('provides notification context to children', () => {
    const { result } = renderHook(() => useNotification(), {
      wrapper: NotificationProvider,
    })
    expect(result.current).toBeDefined()
  })

  it('can add and clear notifications', () => {
    const { result } = renderHook(() => useNotification(), {
      wrapper: NotificationProvider,
    })

    act(() => {
      result.current.addNotification({ message: 'Test', type: 'info' })
    })

    expect(result.current.notifications).toHaveLength(1)
  })
})
```

### Barrel File Test

```tsx
import { describe, it, expect } from '@jest/globals'
import * as exports from '../index'

describe('index exports', () => {
  it('exports Button', () => {
    expect(exports.Button).toBeDefined()
  })

  it('exports Input', () => {
    expect(exports.Input).toBeDefined()
  })
})
```

## Customization

### Modify Templates

Edit `packages/testgen/src/generator/templates.ts` to customize test templates and framework detection.

### Add New Test Types

1. Create new generator in `packages/testgen/src/generator/`
2. Import and call in `packages/testgen/src/cli.ts`
3. Follow patterns from `barrel.ts`, `context.ts`, or `utility.ts`

### Change Output Location

Modify `getTestFilePath()` in `packages/testgen/src/utils/path.ts`:

```typescript
export function getTestFilePath(sourceFilePath: string): string {
  const dir = path.dirname(sourceFilePath)
  const base = path.basename(sourceFilePath, path.extname(sourceFilePath))
  // Change this pattern:
  return path.join(dir, '__tests__', `${base}.test.tsx`)
}
```

### Customize File Type Detection

Edit detection functions in `packages/testgen/src/cli.ts`:

```typescript
function isServiceFile(filePath: string, content: string): boolean {
  // Add your patterns here
  return /service|api|client|i.test(filePath)
}

function isContextProviderFile(filePath: string, content: string): boolean {
  // Customize context detection
  return content.includes('createContext')
}
```

### Support Vitest Instead of Jest

The generator auto-detects your test framework from `package.json`. If you use Vitest:

1. Ensure `vitest` is in your dependencies
2. Remove `jest` from dependencies (or have vitest listed first)
3. Generated tests will use `vi.mock` and `import { describe, it, expect } from "vitest"`

### Exclude Additional File Patterns

Edit `packages/testgen/src/config.ts`:

```typescript
export const UNTESTABLE_PATTERNS = {
  directories: ['/mocks/browser', '/your-custom-pattern/'],
}
```

## Troubleshooting

### "No React component found"

- Ensure your component returns JSX
- Check that it's exported (default or named)
- File may be detected as utility/service - check console output

### "Test utility file detected. Skipping"

- The file matches `TEST_UTILITY_PATTERNS` (e.g., `renderWithProviders.tsx`)
- This is intentional - test helpers shouldn't have tests generated
- To change: modify `TEST_UTILITY_PATTERNS` in `src/config.ts`

### "Git not available"

- The `--git-unstaged` flag requires git
- Use `--file` or `--all` instead

### Import Path Issues

- Generator assumes tests are in `__tests__/` subdirectory
- Adjust imports in `barrel.ts` if using different structure

### TypeScript Errors

- Ensure `tsconfig.json` exists in project root
- Generator uses it for type resolution

### Axios Mocks Not Working in Service Tests

- Check that axios is imported correctly
- Verify mock is defined before the import statement
- For API modules, ensure the import path detection works correctly

### Context Tests Failing

- Verify provider name matches what's exported
- Check `CONTEXT_DETECTION_CONFIG` for custom contexts
- Ensure hook is called within provider wrapper

## Best Practices

1. **Review Generated Tests**: Always review and customize generated tests
2. **Add Assertions**: Generated tests are templates - add specific assertions for your use case
3. **Update Mocks**: Customize mock implementations and return values
4. **Commit Tests**: Don't auto-generate in CI - commit them to version control
5. **Iterate**: Use as starting point, then refine based on testing needs
6. **Update Config**: Keep `CONTEXT_DETECTION_CONFIG` in sync with your app's contexts
7. **Check Exclusions**: Verify `TEST_UTILITY_PATTERNS` match your project structure
8. **Complex Services**: For complex services, enhance generated mocks with realistic data
9. **Context Tests**: Add state change scenarios specific to your context logic

## Architecture Decisions

### Why ts-morph?

- TypeScript Compiler API wrapper
- Easier AST manipulation than raw `tsc`
- Full type information available for inferring test requirements
- Better for analyzing TypeScript-specific patterns

### Why Not Babel?

- ts-morph provides better TypeScript support
- Full type information helps infer test requirements
- Better for analyzing TypeScript-specific patterns

### Why CLI Tool?

- Integrates with existing workflow (git hooks, npm scripts)
- No IDE dependencies - works everywhere
- Can be automated as part of development process
- Easy to customize and extend

### Why Separate File Type Handlers?

Different file types need different testing approaches:

- **Components**: Render, interaction, prop variant testing
- **Services**: Mock HTTP calls, test async operations
- **Contexts**: Provider wrapping, test hook testing within provider
- **Barrels**: Simple export verification
- **Utilities**: Pure function testing

This separation provides better, more appropriate tests for each file type.

### Why Framework Detection?

Projects use either Jest or Vitest, with different APIs:

- Jest: `jest.fn()`, `jest.mock()`
- Vitest: `vi.fn()`, `vi.mock()`

Auto-detection removes manual configuration and ensures compatibility.

### Why Exclude Test Utilities?

Test utility files (like `renderWithProviders`) are testing infrastructure:

- They're not application code
- Testing them would be testing React Testing Library itself
- Excluding prevents infinite recursion (test utils testing test utils)

## Recent Enhancements

Recently added features:

- Support for React Context Provider testing
- Barrel/index file test generation
- Service/API module testing with enhanced axios mocking
- Utility function test generation
- Test framework detection (Jest vs Vitest)
- ApiProvider support with custom props
- Test utility file exclusion patterns
- MSW/browser-only file detection

## Future Enhancements

Potential improvements:

- [ ] Accessibility-focused assertions (jest-axe)
- [ ] Snapshot test generation
- [ ] Integration test templates
- [ ] Visual regression test scaffolding
- [ ] AI-powered assertion suggestions
- [ ] Custom hook testing improvements

## License

Reuse this tool in your projects as needed. Customize to fit your team's conventions.

## Support

For issues or questions:

1. Check that file is a valid React component (or other supported file type)
2. Review `src/config.ts` for exclusion patterns
3. Check console output for file type detection
4. Inspect generated test file for clues
5. Verify test framework dependencies are installed

## Changelog

### Latest Updates (2026)

**Enhanced File Type Support:**

- Barrel/index file test generation
- React Context provider testing
- Service/API module testing with advanced mocking
- Utility function test generation

**Framework Improvements:**

- Auto-detection of Jest vs Vitest
- Framework-specific imports and mocking
- Explicit test framework imports (`@jest/globals`, `vitest`)

**Smart Detection:**

- Intelligent file type routing
- Test utility file exclusion
- MSW/browser-only file detection
- Service file pattern recognition

**Configuration:**

- ApiProvider support with custom props
- `UNTESTABLE_PATTERNS` for browser-only code
- Enhanced `CONTEXT_DETECTION_CONFIG`

---

**Happy Testing!**

_Last Updated: February 2026_
