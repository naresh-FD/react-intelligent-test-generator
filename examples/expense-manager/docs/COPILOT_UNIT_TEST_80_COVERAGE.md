# GitHub Copilot + Automated Unit Test Generation (80% Coverage)

Use this workflow to connect GitHub Copilot and automatically generate/update unit tests from your current unstaged changes.

## 1) Connect GitHub Copilot

1. Install the **GitHub Copilot** extension in VS Code.
2. Sign in with your GitHub account.
3. Open this repo folder in VS Code.
4. Verify Copilot is active (status bar shows Copilot enabled).

## 2) Automation now enabled in `npm run testgen`

When you run:

```bash
npm run testgen
```

it now automatically:

- reads **git unstaged source changes** (`.tsx`, non-test files)
- generates a new unit test file when one does not exist
- updates existing generated test files when they already exist

No extra flag is needed anymore.

## 3) Optional commands

- Run generator for one file:

```bash
npm run testgen:file -- src/path/Component.tsx
```

- Run generator for all source files:

```bash
npm run testgen:all
```

## 4) Coverage rule in this project

This project enforces minimum global thresholds in `jest.config.js`:

- Branches: 80%
- Functions: 80%
- Lines: 80%
- Statements: 80%

If coverage is below this threshold, Jest fails.

## 5) Copilot prompt for exact tests

Use this prompt in Copilot Chat (edit file path as needed):

```text
Create Jest + React Testing Library unit tests for <FILE_PATH>.
Requirements:
- Target only unit tests (no e2e).
- Cover happy path, edge cases, validation, and error handling.
- Mock all network/service dependencies.
- Use existing test utilities from src/test-utils.
- Keep tests deterministic and independent.
- Generate enough tests so global coverage remains >= 80%.
- Return only code for <TARGET_TEST_FILE>.
```

## 6) Run coverage check

From repo root:

```bash
npm --workspace examples/expense-manager run test:coverage:check
```
