# TestGen product status

**Last verified:** 2026-08-15
**Verified at commit:** `b5b296144e880c455bed10a12cf7e8162e20e7fe` (`main`)
**Environment:** Linux x86_64, Node `v22.22.2`, npm `10.9.7`

This document is the **canonical source for every public TestGen capability claim**.
`README.md`, `site/index.html`, `packages/testgen/ARCHITECTURE.md` and all other
user-facing documents must not describe a capability at a higher status than the table
below. When this document and any other document disagree, this document wins.

Every row is backed by code that was read, or by a command that was executed, at the
commit above. No row is backed by a plan, an intention, or a commit message alone.

---

## Status vocabulary

| Status | Meaning |
| --- | --- |
| `MEASURED` | A committed machine-readable artifact records the number. |
| `SHIPPED_DEFAULT` | Active on the default code path with no flag required. |
| `SHIPPED_OPTIONAL` | Implemented and reachable, but only behind an explicit flag. |
| `EXPERIMENTAL` | Code exists but is not reachable from the production CLI. Not a product capability. |
| `RECORDED_PILOT` | A single measured run exists. Not a reproducible baseline. |
| `PLANNED` | Designed or discussed. No implementation claim. |
| `NOT_MEASURED` | The metric has never been collected. No number may be published. |

---

## Capability status

| Capability | Status | Evidence | Approved public wording |
| --- | --- | --- | --- |
| AST/template test generation | `SHIPPED_DEFAULT` | `src/generator/*`, `src/parser.ts`; default path in `cli.ts:run()` | "Deterministic by default" |
| Repository intelligence (imports, exports, providers, conventions) | `SHIPPED_DEFAULT` | `src/repository/*`; 8/8 tests in `repositoryIntelligence.test.ts` | "Resolves imports and exports against your tsconfig before emitting" |
| Structural type fixtures from live checker | `SHIPPED_DEFAULT` | `src/generator/typeFixtureBuilder.ts`; 35/35 tests | "Builds fixtures from live TypeScript types" |
| Behavioral planning with structured skips | `SHIPPED_DEFAULT` | `src/generator/behavioralPlan.ts`; `behavioralPlan.test.ts` | "One planned scenario emits exactly one test; unprovable scenarios are skipped, not faked" |
| Single-run verification (`--verify`) | `SHIPPED_OPTIONAL` | `cli.ts:800-802` selects an **existing** test file; `cli.ts:903-925` calls the runner once, `attempts` hardcoded to `1` | "Runs an existing test once and reports pass/fail and coverage. Read-only." |
| Scoped repair runtime (`--repair`) | `SHIPPED_OPTIONAL` | `src/repairRuntime/*`; called at `cli.ts:855-901`; `repairRuntime.test.ts`, `cliRepair.test.ts` | "Opt-in. Applies registered operations to TestGen-owned generated artifacts only, verifies each change, reverts regressions exactly." |
| Local Ollama operation proposals (`--repair-llm`) | `SHIPPED_OPTIONAL` | `createOllamaRepairResolver`, `src/repairRuntime/ollamaResolver.ts:8-18`; `ollamaIsolation.test.ts` | "Opt-in and local-only. Proposes registered operation IDs only — never literal source edits. Loopback endpoints only; rejects every provider other than Ollama, including when a cloud provider is configured." |
| LLM generation / enhancement (`--llm`, `--enhance`) | `SHIPPED_OPTIONAL` | `cli.ts:757` `needsLlm = args.enhance \|\| args.llm \|\| args.repairLlm`; `src/llm/enhancer.ts` | "Opt-in. Engaged only by explicit flag, including during generation." |
| Jest and Vitest runner adapters | `SHIPPED_OPTIONAL` | `src/repairRuntime/runner/*`; real executions in `repairRuntime.test.ts` | "Both runners are supported by the repair runtime." |
| Protected artifact writes (ownership, provenance, containment, atomic) | `SHIPPED_DEFAULT` | `src/safeWriter.ts`, `src/pathPolicy.ts`; `safeWriter.test.ts`, `pathPolicy.test.ts` | "Generated artifacts are written transactionally and only when TestGen owns them." |
| Automatic healing / retry loop | `EXPERIMENTAL` | `src/execution/healingLoop.ts:104-119` is `@deprecated @experimental`. **Zero value importers** — the only three importers take `HealingAttemptRecord` as a *type*. `cli.ts` never imports `./execution`. Enforced by `repairRuntimeBoundary.test.ts`. | "Not a shipped capability. A controlled repair loop is planned; `--verify` does not heal." |
| Cloud inference (OpenAI / Anthropic) | `SHIPPED_OPTIONAL` | `resolveCliLlmConfig` (`src/llm/config.ts`) honours `TESTGEN_LLM_PROVIDER` after `assertEgressAllowed`; loaded via one deferred `require` in `cli.ts`. `llmProviderSelection.test.ts` (22 tests), `ollamaIsolation.test.ts` | "Opt-in and denied by default. Requires naming the provider, an API key, and `TESTGEN_EGRESS_POLICY=allow`; the `banking` profile denies it unconditionally. Ollama remains the default and the only statically imported provider." |
| Failure knowledge graph observation | `SHIPPED_DEFAULT` | `src/fkg/observe.ts` called from the verify path in `cli.ts`; `fkgRuntime.test.ts` (12 tests), `fkg.test.ts` | "Classifies a failing generated test and records what a repair would have done. Writes nothing to the test file — every authored repair is in shadow state." |
| Shadow repair promotion | `EXPERIMENTAL` | All repairs enter at `state: 'shadow'`. Evidence accrues at `.testgen-results/fkg/evidence.jsonl`; promotion thresholds are not yet met. | "Not a shipped capability. No graph repair modifies a file today." |
| Single live repair engine | `MEASURED` | `repairRuntimeBoundary.test.ts` fails on any value import of `selfHeal/` or `execution/` from a live module | "`src/repairRuntime` is the only engine the CLI drives; the separation is enforced by test, not convention." |
| External pilot validation | `RECORDED_PILOT` | Commit `e7d00500`, see below | "One recorded external pilot, post-fix." |
| BOL baseline (first-run) | `MEASURED` | `eval/results/baseline.json` + `.md`, manifest `bol-v1`, seed 12345 | "First-run green rate is 60% on the 20-case corpus; see the committed baseline." |
| First-run green rate | `MEASURED` | `firstRunGreenRate: 0.6` (12/20). Compile rate 80% (16/20). | "60% of eligible cases generate a test that compiles and passes untouched." |
| Generation determinism | `MEASURED` | 0% generation nondeterminism and 0% execution flake across 5 repetitions | "Generation is byte-identical across repeated runs." |
| Golden-comparison metrics | `NOT_MEASURED` | All 20 `goldenTestFile` values are still `null`; report shows `not_collected` for coverage delta and retained-assertion rate | "Golden comparison pending." |
| No-manual-edit acceptance rate | `NOT_MEASURED` | This metric has never been collected. | Publish no number. |
| Coverage uplift / time savings | `NOT_MEASURED` | No before/after study exists in the repository. | Publish no number. |
| CI/CD integration | `PLANNED` | `.github/workflows/testgen.yml` runs the package's own suite. There is no consumer-repo CI integration. | "Planned." |
| VS Code integration | `PLANNED` | No extension, no `testgen.skill` package, no editor entry point exists. | "Planned." |
| Autonomous agent orchestration | `PLANNED` | `docs/agent-rollout.md`; all benchmarks are `TBD`. | "Planned. Gated behind reliability work." |

---

## Recorded pilot evidence

The only external measurement TestGen has is commit
`e7d005001381b91dec92fbe8950c593946f6630e`, which is an ancestor of `main`. Its message
records, verbatim:

```
Measured on ra-core (479 source files, clean regeneration):
  Suites:  191/440 (43%) -> 214/355 (60%)
```

Approved wording, with all four qualifiers intact:

> In one recorded external pilot against React Admin's `ra-core`, 214 of 355 generated
> suites passed (60%) **after iterative generator fixes**. Remaining failures are
> concentrated in the component-render generation path.

**Every one of these qualifiers is mandatory:**

1. **Post-fix, not first-run.** The number is the *result* of an improvement pass from
   191/440 (43%). It is not what TestGen produced on an untouched first run.
2. **One pilot, not a set.** There is exactly one. Never write "pilot repositories",
   "a growing set", or any plural.
3. **Not a BOL result.** No BOL repository was involved.
4. **Not reproducible from this repository.** `examples/react-admin/` gitignores the
   third-party source; only 13 generated test files are tracked, not 355 suites. The
   figures cannot currently be re-derived by a reader.

The pilot came from **engineering fixes made in response to observed failures**. It is
not evidence of autonomous learning or self-improvement, and must never be described
as such.

---

## Measured baseline

`eval/results/baseline.json` and `baseline.md` are the first committed evaluation
artifacts. Reproduce with:

```bash
npm --workspace packages/testgen run eval:manifest
```

Manifest `bol-v1`, seed 12345, repeat 5, TestGen SHA `5af70d9`, Node v22.22.2, TS 5.9.3.

| Metric | First baseline (`cc6f416`) | Current (`5af70d9`) |
| --- | --- | --- |
| Eligible cases | 20 | 20 |
| Generated | 9 | 17 |
| First-run compiled | 4 (20.0%) | 16 (80.0%) |
| **First-run passed** | **0 (0.0%)** | **12 (60.0%)** |
| Compile failed | 5 | 1 |
| Test failed | 4 | 4 |
| Known skips | 8 | 3 |
| Generator crashes | 3 | 0 |
| Unknown failures | 0 | 0 |
| Harness errors | 0 | 0 |
| Generation nondeterminism | 0.0% | 0.0% |
| Execution flake | 0.0% | 0.0% |
| Median branch coverage | not measured | 58.2% |

The jump from 0% to 60% first-run green came from a single generator fix pass
(root-caused against the Aug 17 run) rather than any change to the corpus: literal-union
props no longer widen to `string` in the untyped `defaultProps` object, boolean props
that gate rendering (`isOpen`/`visible`/`expanded`/`show*`) default to `true` instead of
`false`, assertions are only planned against props that are actually serialized into
defaults, and assertions no longer target attribute expressions or conditionally
rendered elements the default fixtures never reach. This is also why compile failures
fell (5 → 1) and generator crashes disappeared (3 → 0): those fixes removed failure
modes rather than reclassifying them into a different bucket.

Two further results are genuinely positive. Generation is byte-identical across five
repetitions, so "deterministic by default" is now measured rather than asserted. And
there are zero harness errors and zero unknown failures — every outcome is classified.

Read this honestly: 8 of 20 cases (40%) still do not produce a test that compiles and
passes untouched — 1 compile failure, 4 test failures, 3 known skips. The remaining
category breakdown (`eval/results/baseline.md`) shows those concentrated in
`forms-router`, `internal-custom-package`, and `module-federation` (0% first-run green
each) and `async-api` (50%); `context-custom-hook` and `redux-react-query` are at 100%.
The generator defects behind the F1-era failures are tracked as F1-F3 under Known
hazards; F1-F3 are now resolved, and the 8 remaining failures have not yet been
root-caused to named defect IDs.

### Instrument caveat

An earlier run of this same harness reported 0% first-run *compile*. That number was an
instrument artifact: the harness invoked `tsc` with a bare file path, which ignores
tsconfig.json and leaves `jsx` unset, failing every `.tsx` file regardless of content.
Fixed in `cc6f416`. Do not cite any evaluation number produced before that commit.

## Metrics that still do not exist

| Metric | Why it is unavailable |
| --- | --- |
| Golden-comparison metrics | All 20 `goldenTestFile` values are `null`; the report records `not_collected` for coverage delta and retained-assertion rate. |
| No-edit acceptance rate | Never instrumented. |
| Coverage uplift | No before/after study committed. |
| Time saved per component | Never measured. |
| Cross-repository pass rate | Only one external repository has ever been piloted. |

The manifest's own description still applies to the golden dimension: *"Golden tests are
not yet reviewed; goldenTestFile is null for all cases."* The first-run green rate does
**not** depend on goldens — it is computed from terminal outcomes — which is why a
baseline exists while golden comparison remains pending.

---

## Forbidden wording

These phrases are factually wrong at the verified commit. The regression guard
(`npm --workspace packages/testgen run test:public-claims`) fails the build if any
reappears in a public surface.

<!-- claims-check:ignore-start -->

| Forbidden | Why |
| --- | --- |
| "creates and self-heals" | The CLI has no reachable healing path. |
| "retrying with fixes" | `--verify` runs exactly once; `attempts` is hardcoded to `1`. |
| "growing set of pilot repositories" | There is exactly one pilot. |
| "each run tightens" / "learns automatically" | Improvements came from engineering fixes. |
| "only engages when the compiler cannot resolve" | The model never auto-engages; a flag is always required. |
| "DeepSeek-Coder-1.3B" | No such model is configured anywhere. The Ollama default is `deepseek-coder-v2:16b` (`src/llm/config.ts:15`); the training scripts target `unsloth/Qwen2.5-Coder-3B`. |
| "42% baseline" / "75% coverage" | No such measurement exists. |
| "~45 min" / "~5 min" | No time study exists. |
| "first-run 60%" | The 60% figure is post-fix. |
| "no manual edits" | Never measured. |
| "BOL validated" | A BOL baseline is measured (60% first-run green), but a measured baseline is not validation; the Phase 4/5 reliability and pilot gates have not been passed. |

<!-- claims-check:ignore-end -->

---

## Canonical roadmap

This numbering is authoritative. No other document may use a conflicting global phase
number. (Note: the five tabs on `site/index.html` are **verification areas**, not
roadmap phases, and are intentionally numbered separately.)

**Phase 1 — Foundation.** *Complete.* AST analysis, deterministic templates, CLI, safe
generated-file handling.

**Phase 2 — Test intelligence.** *Complete.* Semantic planning, repository-aware imports
/providers/mocks, optional local LLM modes, evaluation harness scaffold.

**Phase 3 — External pilot validation.** *Current.* One recorded React Admin `ra-core`
pilot at 214/355 post-fix. BOL baseline recorded: 60% first-run green, 80% first-run
compile (see Measured baseline). Remaining first-run failures are concentrated in
`forms-router`, `internal-custom-package`, and `module-federation`; not yet root-caused
to named defect IDs.

**Phase 4 — Reliability hardening.** *Next gate.* Human-reviewed golden tests;
reproducible baseline artifacts; untouched first-run green rate; provider and
component-render correctness; deterministic failure classification; zero regression
against previously passing suites; a controlled repair loop behind an explicit flag;
assertion-retention and repair-safety measurements.

**Phase 5 — BOL pilot and CI integration.** *Planned.* Selected BOL repositories;
before/after telemetry; repository policy profiles; report-only PR integration;
fleet-level metrics; module-by-module expansion after quality gates pass.

**Phase 6 — Ticket-driven requirement contracts.** *Experimental, CLI-reachable.*
Discovery, deterministic RTCs, protected approval hashes, hierarchy-batched ADO/JSON
application ingestion, evidence-based existing-code mapping, approved architecture graphs,
transactional full-stack scaffolding, frozen-test RED/GREEN/REFACTOR receipts, system
quality gates, and opt-in draft ADO PR/comment delivery are implemented. Existing-code
mapping uses the documented `existing-code-v2` signal model; greenfield targets use
planned/materialized/indexed/verified states instead of confidence scores. The live ADO
sandbox pilot, 30-ticket organizational corpus, all-slice Expense pilot, and a real second
repository promotion run remain external gates. Until those pass, this remains
experimental and must stop at human-reviewed draft PRs.

**Phase 7 — Autonomous orchestration.** *Planned.* Agentic repair only after
deterministic reliability gates; bounded actions; transactional rollback; human
approval; auditable decisions; no production-code modification to rescue generated tests.

---

## Promotion rules

A claim may only move to a higher status when **all** of the following hold:

1. Production code implements it on a reachable code path.
2. A focused test proves it, and that test runs in the default suite.
3. `npx tsc -p packages/testgen/tsconfig.json --noEmit` passes.
4. The full package suite and the regression suite pass.
5. This document is updated in the same change, with the evidence column filled in.

To move `NOT_MEASURED` → a published number, a **machine-readable artifact must be
committed** (for example `eval/results/baseline.json`). A commit message, a console
transcript, or a remembered figure is not sufficient evidence.

To move `EXPERIMENTAL` → `SHIPPED_OPTIONAL`, the module must additionally be imported by
`cli.ts` on a flag-guarded path, with bounded retries, rollback, and a demonstrated zero
regression against previously passing suites.

---

## Known hazards

Recorded deliberately. These are **not fixed** at the verified commit; they are tracked
here so that no future reader mistakes them for working behaviour.

| ID | Hazard | Location |
| --- | --- | --- |
| ~~D10~~ | **Resolved.** `verifyAndRetry` and its orphaned dependents (`generateTestForFileSync`, `VerifyResult`, the `maxRetries = 0` vestige) were deleted — 128 lines, no replacement. The codebase no longer contains a retry loop that could contradict this document. | was `src/cli.ts:602-663` |
| ~~D11~~ | **Resolved in `d242647`.** The help text was accurate and the code was not: `resolveCliLlmConfig()` now honours `TESTGEN_LLM_PROVIDER`, so the documented cloud providers are reachable — behind `assertEgressAllowed`, which denies by default. Ollama remains the default and the only statically imported provider. | was `src/cli.ts:20,23` |
| D12 | The documented command `npm run testgen:file src/components/Button.tsx` omits the `--` separator, so the path never reaches the CLI. The site has the correct form. | `README.md:78` |
| D14 | `packages/testgen/Modelfile` and the training pipeline target `qwen2.5-coder:3b`, while the CLI's Ollama default is `deepseek-coder-v2:16b`. The fine-tuned output `testgen-coder-finetuned` is wired to nothing. | `Modelfile:1`, `src/llm/config.ts:15` |
| D16 | `GETTING-STARTED-TESTGEN.md` and `REUSE-TESTGEN.md` document none of `--verify`, `--repair`, `--repair-llm` or the Ollama requirements, although `README.md:268` bills the former as the full command guide. | both docs |
| ~~D17~~ | **Resolved in `d242647`.** `src/llm/config.ts` calls `assertEgressAllowed` before returning any cloud config, so the gate now decides — it is no longer the case that cloud is merely unimported. The check runs before any source file is read, so a denied run transmits nothing. Egress policy may now be described as an active control. | was `src/egress.ts` |

### Defects found by the baseline

These are generator defects, reproducible from `eval/results/baseline.json`. They account
for the cases outside the 60% first-run green rate.

| ID | Defect | Evidence |
| --- | --- | --- |
| ~~F1~~ | **Resolved in `6f8c657`.** Scenario IDs ignored the enclosing `describe`, so identically titled tests in a multi-export file collided and the planner rejected the whole plan. IDs now include the describe chain, with a deterministic suffix for same-scope duplicates. Crashes 3 → 0. | was `generator/behavioralPlan.ts:213` |
| ~~F2~~ | **Resolved in `c9d3a2d`.** A string-literal-union prop widened to bare `string` inside the untyped `defaultProps` object literal and failed to satisfy the component's prop type. Literal fixtures are now flagged (`fixture.isLiteralType`) and pinned with `as const`. | was `generator/mocks.ts:19,35` |
| ~~F3~~ | **Resolved in `c9d3a2d`.** Two related causes: assertions were planned from any prop's fixture while `defaultProps` only serialized required props, so optional props were asserted without being passed; and attribute expressions (`type={type}`) were collected as observable text, inventing assertions for content that never renders. Selectors now record their source prop so assertion-backed props are included in defaults, and attribute expressions are excluded from observable text. | was `generator/mocks.ts` fixture naming + component assertion planning |

---

## Verification commands

```bash
npm ci   # required: plain `npm install` leaves @types/react unresolved
npx tsc -p packages/testgen/tsconfig.json --noEmit --skipLibCheck
npm --workspace packages/testgen test -- --runInBand
npm --workspace packages/testgen run test:regression
npm --workspace packages/testgen run test:public-claims
```

Result at commit `15876e1` on Linux: `tsc` clean; 25 suites / 390 tests passing,
0 skips; regression suite passing (5 fixtures); public-claims scan clean.
