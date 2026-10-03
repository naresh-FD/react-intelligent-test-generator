# Document-to-test compiler: Phase 0–5 vertical-slice plan

Status: **PLANNED** (no implementation claim). Source: *TestGen Next-Generation Technical
Design v1.0* (October 2026). Implementation lives in the private application repo under
`packages/testgen/src/`; this document is the plan only.

Goal: one narrow end-to-end slice, proven before anything else is added.

> Markdown spec -> Requirement IR -> testability gate -> `ENABLED_STATE_V1` recipe ->
> Test Model -> Jest/RTL render -> compile -> run against a minimal Pagination component.

Out of scope until the slice is stable: DOCX, PDF, other classifications, greenfield
contracts (Phase 6), brownfield mapping (Phase 7), traceability reports (Phase 8),
mutation, LLM adapter.

## Ground rules

1. **Feature flag, default off.** All new code is reachable only via `testgen spec ...`
   (and `TESTGEN_SPEC=1` if any shared path is touched). With the flag off, the existing
   source-driven CLI is byte-identical in behavior.
2. **Fail closed.** Anything not provably testable is `BLOCKED` or `UNRESOLVED`; never a
   guessed test. No generic fallback recipe.
3. **No LLM, no network** anywhere in the new modules. Enforce with a test that fails on
   any value import of `src/llm/*` from `src/document|requirements|recipes|test-model`.
4. **Versioned output.** Every IR/Test Model carries `schemaVersion`, `parserVersion`,
   `ruleVersion`, `recipeId@recipeVersion`, and a `requirementHash`.
5. **Understanding is separate from rendering.** Renderer imports only `TestModel`.
6. **Status-doc discipline.** Add a `PLANNED` row, and move it only per the existing
   promotion rules in `docs/product-status.md`.

## Phase 0 — Baseline and ground truth

Work
- Record current suite counts, regression fixtures and `eval/results/baseline.json`
  (60% first-run green, 0% nondeterminism) as the frozen baseline.
- Add `spec` flag plumbing in `cli.ts`: unknown subcommand path only, no behavior change.
- Create `eval/spec-corpus/` with 12–20 requirement examples, each a `.md` file plus a
  `.expected.json` (expected IR and READY/BLOCKED/UNRESOLVED):
  - 6 clear ENABLED_STATE (varied wording, numeric/boolean/string conditions)
  - 4 ambiguous prose ("smooth experience") -> BLOCKED with named blockers
  - 3 incomplete (no target / no expected / no condition) -> BLOCKED
  - 2 unsupported classification (CALLBACK etc.) -> BLOCKED "no recipe" for now
  - 1 greenfield and 1 brownfield sample kept for later phases
- Human-review the expected files before they are treated as golden.

Exit
- Flag off: full suite and regression identical to baseline.
- Corpus committed; baseline numbers recorded in the status doc.

## Phase 1 — Requirement IR and schema gate

Work
- `requirements/schema/requirementIR.ts`: `RequirementIR`, `RequirementCase`,
  `Condition`, `Action`, `ExpectedOutcome`; Zod schema; `status` and `blockers`.
- `validate/schemaGate.ts`: mandatory fields per classification as a table, emitting
  stable, ordered blocker codes (e.g. `NO_TARGET`, `NO_CONDITION`, `NO_EXPECTED`).
- Deterministic `sourceLocation` and `provenance`; `requirementHash` = SHA-256 of the
  canonical (key-sorted) JSON of the normalized case.
- One unit test per schema rule and per blocker code.

Exit
- Same input -> byte-identical IR. Missing field -> the same blockers every time.
- No code generation exists.

## Phase 2 — Markdown adapter and normalization (Markdown only)

Work
- `DocumentAdapter` contract (Appendix A) and `NormalizedBlock` union.
- `markdownAdapter.ts`: headings, bullets, simple tables, fenced `requirement` blocks.
- `normalizeBlocks.ts` / `normalizeTables.ts`: whitespace, casing of keywords, stable IDs
  (`REQ-<n>` from document order if absent).
- Unsupported blocks are kept as `UNRESOLVED`, never dropped.
- Golden tests: Markdown -> normalized blocks.
- Defer YAML/JSON/text adapters to after the slice; the adapter contract must make them
  additive.

Exit
- Golden snapshots stable across 5 runs.
- Unknown content appears in output as `UNRESOLVED`.

## Phase 3 — Classifier and testability gate (ENABLED_STATE only)

Work
- `classify/requirementClassifier.ts`: pattern rules with explicit precedence. Initial
  patterns: `When <prop> is <value>, <target> (must|should) be (disabled|enabled)`
  and a small set of equivalent phrasings.
- `extractors/*`: condition (prop, operator, literal), target (control name), expected
  (`disabled` true/false).
- `validate/testabilityGate.ts`: READY only if target + condition + expected state present.
- Other classifications may be recognized but are `BLOCKED: NO_RECIPE`.
- Blocker reasons surfaced in `testgen spec parse` and `testgen spec plan` output.

Exit
- Corpus: every clear case READY with expected IR; every ambiguous/incomplete case
  BLOCKED with expected blockers. **False generation rate = 0** on the corpus.
- No LLM import (guard test).

## Phase 4 — Recipe registry and Test Model

Work
- `recipes/registry.ts`: `TestRecipe` contract (Appendix B), ordered by priority, with
  stable tie-breaking; unmatched requirement -> `BLOCKED: NO_RECIPE`.
- `enabledState.recipe.ts` (`ENABLED_STATE_V1@1.0`): validate + build.
- `test-model/types.ts`, `buildTestModel.ts`: arrange/act/assert steps, fixtures,
  `requiredProviders`, `trace`.
- Deterministic fixtures: stable values derived from the condition (e.g. `currentPage=1`
  -> `totalPages=10`, callback stub for required function props). Boundary values from a
  fixed rule table, no randomness.

Exit
- Same IR + recipe version -> identical Test Model (deep-equal, repeated 5x).
- Unsupported classification stays blocked; no generic fallback exists.

## Phase 5 — Jest/RTL renderer

Work
- `render/jestRtlRenderer.ts`, `astBuilders.ts`: ts-morph/TypeScript factory based
  rendering; templates only for the import header and `describe` shell.
- Reuse existing import/provider helpers; imports come only from resolved project
  exports, never invented. Unresolvable import -> generator defect, not a test.
- Emit `.tsx` when JSX is present; required props are always supplied (no
  `const props = {}` fallback).
- Write through the existing `safeWriter` (ownership, containment, atomic).
- `testgen spec red <doc> --target <path>` renders and compiles only; running it is
  Phase 6.
- Tests: snapshot of rendered output, compile gate in a fixture project, byte-identical
  output over 5 runs.

Exit
- Generated tests compile for controlled fixtures.
- Renderer failures classified `GENERATOR_ERROR`.

## Vertical-slice demo (end of Phase 5)

Fixture: a minimal `Pagination` component with `currentPage`, `totalPages`,
`onPageChange`, and a `Previous` button.

1. Spec: "When currentPage is 1, the Previous button must be disabled."
2. `testgen spec plan` -> REQ-01 READY, `ENABLED_STATE`.
3. `testgen spec red` -> `Pagination.req01.test.tsx`, compiles.
4. Run against a stub where Previous is always enabled -> fails on the assertion.
5. Run against the correct component -> passes.

Honest limitation: classifying the failure as a *valid RED* and recording evidence is
Phases 6 and 8; in this demo the RED/GREEN runs are manual.

## Acceptance checks for the whole slice

| Check | Target |
|---|---|
| Existing suite, regression, public-claims scan | unchanged and green |
| `tsc --noEmit` | clean |
| Corpus false-generation rate | 0 |
| Corpus READY/BLOCKED agreement with golden | 100% |
| Deterministic replay (IR, Test Model, rendered file) | 100% over 5 runs |
| Compile success of generated tests | 100% on controlled fixtures |
| Network/LLM imports in new modules | none (guard test) |

## Suggested order of pull requests

1. Phase 0: corpus + flag plumbing + status-doc `PLANNED` row.
2. Phase 1: IR + schema gate.
3. Phase 2: Markdown adapter.
4. Phase 3: classifier + testability gate (`spec parse`, `spec plan`).
5. Phase 4: recipe + Test Model.
6. Phase 5: renderer + `spec red` + demo fixture.

Each PR updates `docs/product-status.md` in the same change, only as high as its
evidence supports.

## Risks specific to the slice

- **Phrase coverage creep.** Hold the pattern list to the corpus; add a pattern only with
  a corpus case.
- **Control lookup.** `getByRole('button', {name})` needs an accessible-name assumption;
  record it in the Test Model as an explicit assumption, not a silent default.
- **Prop-name binding.** The condition's `currentPage` must resolve to a real prop;
  without a contract (Phase 6) or analyzer (Phase 7), the renderer takes the prop name
  from the spec and the compile gate is the check.
