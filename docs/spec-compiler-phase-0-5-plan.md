# Document-to-test compiler: gap-closing plan

Supersedes the earlier Phase 0–5 plan. That plan assumed nothing existed; a read of the
application repo showed the ticket-driven pipeline already covers most of the design
document's back half. This plan covers only the gaps.

Source design: *TestGen Next-Generation Technical Design v1.0* (October 2026).
Implementation: private repo `main` (merged in #25), `packages/testgen/src/spec/`.

## What already existed (reused, not rebuilt)

| Design concept | Existing implementation |
|---|---|
| Requirement IR, schema gate, hashing, approval | RTC in `requirements/` |
| Fail-closed blocking | Ambiguity linter, readiness scorer, `blocked` RTC status |
| Brownfield mapping gate | `mapping/` with the 65% confidence gate |
| Jest/RTL rendering | `redPhase/` (Jest and Vitest) |
| RED validity classifier, frozen tests, GREEN gate | `classifyRedTaxonomy`, `greenPhase/` |
| Mutation gate, traceability, reports | `mutation/`, `traceability/`, `reportPhase/` |

## Gaps and how each was closed

| Gap | Change | Status |
|---|---|---|
| No Markdown/plain-text document input | `spec/markdownAdapter.ts`: front matter, criteria headings, lists, `REQ-n` ids, tables; non-criteria prose kept as description | Implemented |
| No recipe registry | `spec/recipes.ts`: `TestRecipe` contract, versioned, ordered by priority, no generic fallback | Implemented |
| No framework-neutral Test Model | `spec/types.ts` `TestModel` (arrange/act/assert steps, fixtures, trace) | Implemented |
| Only two assertion shapes | Recipes `ENABLED_STATE_V1`, `CALLBACK_V1`, `VALIDATION_V1`, `VISIBILITY_V1` | Implemented |
| Model-to-renderer bridge | `spec/lower.ts` rewrites a Test Model into the RTC dialect, so `redPhase` is reused | Implemented |
| Red phase lacks `CalledWith`, visibility, type/click acts | Extended `redPhase/componentContract.ts` | Implemented |
| No spec CLI | `testgen spec parse\|plan\|metrics` | Implemented |
| No requirement corpus or metrics | `eval/spec-corpus/` (13 reviewed cases, 38 requirements) and `spec metrics` | Implemented |
| Unsupported classes | `NAVIGATION`, `API_STATE`, `ERROR_STATE`, `ACCESSIBILITY`, `DATA_RENDERING` are classified and blocked as `NO_RECIPE:<CLASS>` | Blocked by design |

## Measured on the committed corpus

From `testgen spec metrics eval/spec-corpus`:

| Metric | Value |
|---|---|
| Golden agreement | 100% (38/38) |
| False generation rate | 0 |
| Requirement ready rate | 47% (18/38); the corpus deliberately includes blocked cases, so this is not a quality score |
| Deterministic replay rate | 100% over 5 repeats |

Verified end to end on a `Pagination` fixture: four generated tests passed against a
correct component, and with the Previous button's `disabled` condition removed the
Previous-disabled test failed on its assertion while the other three still passed.
Full package suite: 39 suites, 532 tests passing; `tsc` clean; public-claims scan clean.

## Still open

| Item | Why |
|---|---|
| DOCX and PDF adapters (design Phase 9) | Not needed for the slice; add as adapters emitting the same normalized document |
| YAML/JSON requirement documents in the spec shape | Tickets already accept YAML/JSON; a spec-shaped schema is not defined |
| Prop-name binding | Condition prop names come from the spec text; the compile and run steps are the only check unless a contract or analyzer binds them |
| Control lookup | `click`/`type` targets are matched to controls by word overlap with the analyzed selectors, so an ambiguous label can pick the wrong control |
| Boundary, error and dependency readiness | Not inferred. Spec-derived RTCs reach `review-required` on concrete values alone; declare the rest or approve through `rtc review` |
| Multi-outcome requirements | A statement with two assertions is blocked as `UNSUPPORTED_PHRASING` |
| Feature Contract for components that do not exist yet | Greenfield contract-first input is not defined |
| Requirement Ready Rate on real documents, Valid RED Rate, Mutation Kill Rate | Only the synthetic corpus has been measured |
| Optional LLM adapter (design Phase 11) | Intentionally not started |
| Not released | Merged to the private repo's `main` but not in a tagged release; it is experimental and CLI-reachable only through `testgen spec` |

## Rules the implementation keeps

1. No network or LLM import in `src/spec/` (guard test).
2. Fail closed: ambiguity is `BLOCKED`, non-requirements are `UNRESOLVED`, never a guessed test.
3. Same input yields the same plan; `retrievedAt` is the only excluded field.
4. Existing source-driven and ticket-driven commands are unchanged; `spec` is a new subcommand.
