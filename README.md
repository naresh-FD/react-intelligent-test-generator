# React Intelligent Test Generator

An automated test scaffold generator for React applications. It uses TypeScript AST parsing to analyze your components, hooks, utilities, and services — then generates comprehensive test files following [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/) best practices.

No AI or LLMs involved — just deterministic static analysis that produces consistent, reliable test scaffolds every time.

## Features

- **AST-Based Analysis** — Uses [ts-morph](https://ts-morph.com/) and Babel to parse TypeScript/JSX and extract props, hooks, event handlers, contexts, and more
- **Multi-File-Type Detection** — Generates tailored tests for components, custom hooks, utilities, contexts, services, and barrel (index) files
- **Framework-Aware** — Auto-detects Jest vs Vitest and adapts imports, mocking utilities, and matchers accordingly
- **Git-Integrated Safety** — Default mode processes only unstaged/changed files; never overwrites manually written tests
- **Custom Render Utility Support** — Automatically detects helpers like `renderWithProviders` and uses them in generated tests
- **Smart Mock Generation** — Creates realistic mocks for props, API services, and context providers
- **Monorepo Ready** — Centralized configuration via `react-testgen.config.json` with per-package overrides
- **Verify Mode** — Optionally runs Jest after generation, retrying with fixes if tests fail

## Project Structure

This is a monorepo using npm workspaces:

```
react-intelligent-test-generator/
├── packages/
│   └── testgen/                  # The test generator tool
│       └── src/
│           ├── cli.ts            # CLI entry point
│           ├── analyzer.ts       # Component & code analysis
│           ├── parser.ts         # TypeScript AST parser
│           ├── config.ts         # Configuration & patterns
│           ├── fs.ts             # File system utilities
│           ├── generator/        # Test generation modules
│           │   ├── index.ts      # Main orchestrator
│           │   ├── templates.ts  # Template building blocks
│           │   ├── render.ts     # Render helper generation
│           │   ├── mocks.ts      # Mock generation
│           │   ├── interactions.ts # User interaction tests
│           │   ├── utility.ts    # Utility function tests
│           │   ├── context.ts    # Context provider tests
│           │   ├── barrel.ts     # Barrel file tests
│           │   └── variants.ts   # Prop variation tests
│           ├── workspace/        # Monorepo workspace support
│           └── utils/            # Path, framework, format utils
├── examples/
│   └── expense-manager/          # Demo React app using testgen
├── react-testgen.config.json     # Workspace-level configuration
└── package.json                  # Root workspace config
```

## Quick Start

### Prerequisites

- Node.js (ES2020+ compatible)
- npm

### Installation

```bash
npm install
```

### Generate Tests

```bash
# Generate tests for git-unstaged files (default, safest)
npm run testgen

# Generate for a specific file
npm run testgen:file src/components/Button.tsx

# Generate for all source files
npm run testgen:all
```

### Generate + Verify

The smart commands generate tests and then run Jest, retrying if any tests fail:

```bash
npm run testgen:smart
npm run testgen:smart:file src/components/Button.tsx
npm run testgen:smart:git
```

### Run Tests

```bash
npm test                        # All tests with coverage
npm run test -- --watch         # Watch mode
npm run test -- --coverage      # Coverage report
```

## CLI Options

The test generator is invoked via `ts-node packages/testgen/src/cli.ts` (wrapped by the `testgen` npm scripts):

| Option | Description |
|---|---|
| `--file <path>` | Generate a test for a single file |
| `--git-unstaged` | Generate tests for unstaged git changes (default) |
| `--all` | Generate tests for all source files |
| `--verify` | Run Jest after generation, retry on failure |
| `--max-retries <n>` | Maximum retry attempts when verifying (default: 2) |
| `--coverage-threshold <n>` | Minimum coverage percentage for verification (default: 50) |
| `--dry-run` | Print the resolution plan without generating files |
| `--package <name>` | Target a specific configured package in a monorepo |

## Configuration

Create a `react-testgen.config.json` in the workspace root:

```json
{
  "version": 1,
  "defaults": {
    "include": ["src/**/*.{ts,tsx}"],
    "exclude": ["**/__tests__/**", "**/*.test.*", "**/dist/**"],
    "framework": "auto",
    "renderHelper": "auto",
    "generateFor": ["components", "hooks", "utils"],
    "mode": "git-unstaged"
  },
  "packages": [
    {
      "name": "my-app",
      "root": "packages/my-app",
      "include": ["src/**/*.{ts,tsx}"],
      "framework": "jest",
      "renderHelper": "src/test-utils/renderWithProviders.tsx"
    }
  ]
}
```

| Field | Description |
|---|---|
| `include` | Glob patterns for source files to process |
| `exclude` | Glob patterns to skip |
| `framework` | `"jest"`, `"vitest"`, or `"auto"` (auto-detects from project config) |
| `renderHelper` | Path to a custom render utility, or `"auto"` to detect automatically |
| `generateFor` | File types to generate tests for |
| `mode` | Default run mode (`"git-unstaged"`, `"all"`, etc.) |

## How It Works

1. **Parse** — Loads source files into a TypeScript AST using ts-morph
2. **Analyze** — Extracts component metadata: props, hooks, event handlers, context usage, conditional rendering, form elements
3. **Classify** — Determines file type: component, hook, utility, context, service, or barrel file
4. **Generate** — Routes to the appropriate generator, which builds test code from templates
5. **Write** — Outputs the test file into a co-located `__tests__/` directory, skipping files that already have manual tests

### What Gets Generated

| File Type | Generated Tests |
|---|---|
| **Components** | Render tests, prop variants, user interactions, conditional rendering, accessibility checks |
| **Custom Hooks** | Initial state, state updates, effects, cleanup |
| **Utilities** | Valid inputs, edge cases, error handling, return value assertions |
| **Context Providers** | Provider rendering, consumer access, default values, updates |
| **Services** | API call mocking (axios), request/response assertions, error handling |
| **Barrel Files** | Re-export verification for all named exports |

## Example

Given a component like:

```tsx
// src/components/ExpenseForm.tsx
interface ExpenseFormProps {
  onSubmit: (data: ExpenseData) => void;
  categories: Category[];
  initialValues?: Partial<ExpenseData>;
}

export const ExpenseForm: React.FC<ExpenseFormProps> = ({
  onSubmit,
  categories,
  initialValues,
}) => {
  // ... component logic
};
```

The generator produces a test file at `src/components/__tests__/ExpenseForm.test.tsx` with:

- Render test with required props
- Optional prop variation tests
- `onSubmit` callback interaction tests
- Mock data for `categories` and `initialValues`
- Automatic use of `renderWithProviders` if detected

## Development

### Running the Example App

```bash
# Start dev server + auto test generation on file changes
npm start

# Start dev server only (no test generation)
npm run start -- --no-testgen
```

### Linting & Formatting

```bash
npm run lint
npm run lint -- --fix
npm run format
```

### Building

```bash
npm run build
```

## Adopting in Your Project

See [packages/testgen/docs/REUSE-TESTGEN.md](packages/testgen/docs/REUSE-TESTGEN.md) for a step-by-step guide on integrating the test generator into another repository.

## Documentation

| Document | Description |
|---|---|
| [Getting Started](packages/testgen/docs/GETTING-STARTED-TESTGEN.md) | Full user guide with commands, workflows, and troubleshooting |
| [Reuse Guide](packages/testgen/docs/REUSE-TESTGEN.md) | How to adopt the generator in another project |
| [Technical Deep-Dive](packages/testgen/docs/automated-test-generation.md) | Architecture, design decisions, and generation strategies |

## Tech Stack

| Category | Technologies |
|---|---|
| **Language** | TypeScript 5.9+ |
| **AST Parsing** | ts-morph, @babel/parser, @babel/traverse |
| **Testing** | Jest 29, React Testing Library, jest-dom, user-event |
| **Example App** | React 19, Webpack 5, Tailwind CSS, React Router, React Query, react-hook-form, zod |
| **Code Quality** | ESLint, Prettier, Husky, lint-staged |

## License

MIT — see the individual package `package.json` files for details.
