# Reuse React Test Generator In Another Repo

This guide explains how to copy and set up the TSX test generator in a different repository.

---

## 1. Create The Tool Files (Copilot Prompt)

Use this prompt with GitHub Copilot in the target repo:

```
You are implementing a NO-AI React unit test generator (Jest + React Testing Library) that reads TSX files, analyzes AST, generates tests, then runs Jest coverage and regenerates pass-2 if coverage < 50% for that component file.

Rules:
- Do NOT use any AI model or any external API.
- Must be deterministic: same input produces same tests.
- Must parse TSX using ts-morph (TypeScript AST) and derive selectors/assertions from actual JSX (data-testid, aria-label, button text, placeholder).
- Must generate tests next to component at __tests__/Component.test.tsx by default.
- Must implement coverage loop using real Jest coverage output: run jest for the generated test file with --coverage --coverageReporters=json-summary --coverageReporters=json and read coverage/coverage-final.json to compute per-file line coverage for the component file. If < 50% and pass < 2, regenerate pass-2 with mock variants and rerun.
- Avoid fake coverage estimation and avoid placeholder randomness.
- Keep tests minimal and stable (no snapshots by default).
- Provide CLI commands:
	- npm run testgen -> generate for all src/**/*.tsx excluding tests
	- npm run testgen:file src/path/Comp.tsx -> generate for one file
- Write code under tools/react-testgen/ exactly with the file structure described below.

Create these files exactly and fill them with production-grade TypeScript code:
tools/react-testgen/package.json
tools/react-testgen/tsconfig.json
tools/react-testgen/src/config.ts
tools/react-testgen/src/fs.ts
tools/react-testgen/src/parser.ts
tools/react-testgen/src/analyzer.ts
tools/react-testgen/src/generator/templates.ts
tools/react-testgen/src/generator/mocks.ts
tools/react-testgen/src/generator/render.ts
tools/react-testgen/src/generator/interactions.ts
tools/react-testgen/src/generator/variants.ts
tools/react-testgen/src/generator/index.ts
tools/react-testgen/src/coverage/runner.ts
tools/react-testgen/src/coverage/reader.ts
tools/react-testgen/src/coverage/report.ts
tools/react-testgen/src/utils/path.ts
tools/react-testgen/src/utils/format.ts
tools/react-testgen/src/cli.ts

After generating code:
- Update repo package.json scripts to add:
	"testgen": "ts-node tools/react-testgen/src/cli.ts",
	"testgen:file": "ts-node tools/react-testgen/src/cli.ts --file"
- Update "test" to: "jest --coverage && ts-node tools/react-testgen/src/coverage/report.ts"
- Add brief README comments in cli.ts about usage.
- Ensure imports are correct and code compiles.
```

---

## 2. Add NPM Scripts

Update the target repo package.json to include:

```json
"testgen": "ts-node tools/react-testgen/src/cli.ts",
"testgen:file": "ts-node tools/react-testgen/src/cli.ts --file",
"test": "jest --coverage && ts-node tools/react-testgen/src/coverage/report.ts"
```

---

## 3. Install Dev Dependencies

Ensure these are present in devDependencies:

- ts-morph
- ts-node
- typescript
- @types/node
- jest
- @testing-library/react
- @testing-library/jest-dom
- @testing-library/user-event

Then run:

```bash
npm install
```

---

## 4. Add Test Utilities

The generator expects this file:

```
src/test-utils/renderWithProviders.tsx
```

If your repo uses a different helper path, update the import in:

```
tools/react-testgen/src/generator/templates.ts
```

---

## 5. Ensure Jest Coverage Output

The tool reads coverage reports from:

```
coverage/coverage-summary.json
coverage/coverage-final.json
```

Your Jest command must include:

```
--coverage --coverageReporters=json-summary --coverageReporters=json
```

---

## 6. Run The Generator

Generate tests for all TSX files:

```bash
npm run testgen
```

Generate tests for a single file:

```bash
npm run testgen:file -- src/path/Component.tsx
npm run testgen:file -- src/path/Component.ts
```

---

## 7. Verify Output

- Tests are generated at __tests__/Component.test.tsx next to each TSX component.
- A coverage table prints after npm run test and after npm run testgen.

---

## FAQ

### Will the Copilot prompt create a fully executable, plug-and-play tool?

Short answer: yes, it should be plug-and-play, as long as the target repo already has Jest + React Testing Library configured and you add the scripts and dependencies from this guide.

Two things still depend on the target repo:

- Jest config must support TSX and write JSON coverage output (coverage-summary.json + coverage-final.json).
- The render helper must exist at src/test-utils/renderWithProviders.tsx (or you update the path in tools/react-testgen/src/generator/templates.ts).

If those are in place, running the prompt + npm install + npm run testgen works end-to-end. If you share the target repo layout, we can confirm exactly what to adjust.

---

## Troubleshooting

- If render fails, ensure your providers are wrapped in renderWithProviders.
- If coverage table is missing, confirm coverage-summary.json exists.
- For Windows path issues, keep repo paths short and avoid spaces where possible.
