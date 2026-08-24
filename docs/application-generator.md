# ADO/JSON application generator

`testgen app` is an experimental, approval-gated pipeline for generating a React,
Fastify, and PostgreSQL application in an isolated Git worktree. It never merges,
deploys, enables auto-complete, creates an ADO repository, or transitions work items.

## Lifecycle

```text
JSON/YAML or ADO Epic/Feature hierarchy
  -> canonical package and revision-set hash
  -> route/component/API/data/test/trace plan
  -> human approval of package and plan hashes
  -> transactional scaffold with provenance and npm v3 lockfile
  -> criterion-by-criterion RED / implementation / GREEN / REFACTOR
  -> required system gates
  -> exact codex/<ticket>-<slug> branch and idempotent draft ADO PR
```

The two checked-in pilots are:

- `.testgen/fixtures/applications/expense-operations.v1.json`
- `.testgen/fixtures/applications/service-operations.v1.json`

Both use JSON Schema Draft 2020-12 and normalize through the same canonical contract as
ADO. For ADO, the root Epic custom field `TestGen.ApplicationBlueprint` contains the
application-level blueprint without `features`; Feature and Story work items supply the
hierarchy and story contracts. A v1 application is limited to 200 work items.

## Plan and approve

```text
testgen app plan --file .testgen/fixtures/applications/expense-operations.v1.json --output .testgen/applications/EXP-9000.plan.json
testgen app lint --plan .testgen/applications/EXP-9000.plan.json
testgen app approve --plan .testgen/applications/EXP-9000.plan.json --by product.owner@example.test
testgen app status --plan .testgen/applications/EXP-9000.plan.json
```

For ADO, use `app plan --source ado --ticket <epic-or-feature-id>`. Any changed root or
child revision invalidates approval. Blocked plans cannot be approved.

## Scaffold in a worktree

Create and initialize a linked worktree on the exact delivery branch, then scaffold it:

```text
git worktree add ../expense-operations codex/EXP-9000-expense-operations-platform
testgen app scaffold --plan .testgen/applications/EXP-9000.plan.json --target ../expense-operations
testgen app status --plan .testgen/applications/EXP-9000.plan.json --target ../expense-operations
```

The writer rejects traversal, symbolic-link segments, human-owned collisions, and
modified generated files. A failed multi-file write restores exact prior bytes. An
unchanged rerun produces no source diff. `package-lock.json` is resolved from only the
pinned workspace manifests and must contain every workspace.

The scaffold contains nested React Router data routes, explicit public/protected access,
route loaders/actions/error boundaries, accessible UI primitives, OIDC adapters, Fastify
route/schema/service/repository layers, trusted OpenAPI 3.1 schemas, a typed frontend
client, Prisma and SQL migrations, non-root containers, Compose, and build-only ADO CI.

## Vertical-slice TDD

Requirement IDs are listed in `plan.graphs.tests`. At least one implementation source
path must be explicitly in scope.

### Receipt architecture

```text
approved criterion + current plan hash + explicit source scope
  -> executable test written and frozen
  -> focused command compiles and executes
  -> valid behavioral RED
       | invalid import/fixture/config/environment/timeout failure -> BLOCKED
  -> typed patch plan constrained to approved source paths and old hashes
  -> unchanged frozen test + changed source tree -> focused GREEN
  -> full regression GREEN
  -> optional refactor -> affected focused and regression tests remain GREEN
  -> complete TddReceiptV1 -> next slice or system verification
```

Each receipt binds the approved requirement hash, architecture plan hash, frozen-test
hash, before/after source-tree hashes, exact command and exit code, RED classification,
GREEN result, regression result and post-refactor result. The run manifest stores the
completed slice so an interrupted run can resume without replaying already verified
work.

The test hash must be identical between RED and GREEN. The source-tree hash must change
inside the approved implementation scope. A typed provider patch is rejected if it
edits the frozen test, references a stale old hash, duplicates a path, or reaches
outside the approved source files.

```text
testgen app tdd red --plan <plan> --target <worktree> --requirement <id> --test <test-file> --source <source-file>
testgen app tdd implement --plan <plan> --target <worktree> --requirement <id>
testgen app tdd green --plan <plan> --target <worktree> --requirement <id>
testgen app tdd refactor --plan <plan> --target <worktree> --requirement <id>
testgen app tdd status --plan <plan> --target <worktree> --requirement <id>
```

`implement` uses the configured Ollama, Anthropic, or OpenAI provider. Cloud providers
remain subject to the repository egress policy. The provider must return a strict typed
replacement plan; changes outside the frozen source scope, test edits, duplicate paths,
or stale hashes are rejected transactionally.

A RED receipt is valid only when an active test executes and fails for a classified
assertion or missing behavior. Compile/import, suite setup, fixture, connection,
environment, and timeout failures are rejected. GREEN requires the identical frozen
test hash and a changed source-tree hash. Completion is recorded only after focused and
full-regression GREEN.

Artificial RED templates such as `expect(true).toBe(false)` are prohibited because
they prove only that an assertion can fail, not that approved behavior is missing.
Existing implementation with later-added passing tests is described as
`regression-tested` or `test-covered`. The stronger `TDD-verified` label is used only
when a stored receipt proves the complete order above.

## Verification and ADO delivery

```text
testgen app verify --plan <plan> --target <worktree>
testgen app deliver --plan <plan> --target <worktree> --repository <ado-repository> --target-branch main
```

Verification requires current approval, exact graph materialization, one complete TDD
receipt per criterion, formatting, architecture boundaries, strict typecheck, coverage,
production build, Playwright accessibility journeys, mutation, OpenAPI/client contracts,
dependency audit, migration replay, secret scan, and container scan. Critical API
services use the blueprint's 90% line / 85% branch defaults. An unavailable required
tool is `NOT_RUN` and blocks delivery.

Delivery re-fetches every ADO revision, requires a PASS quality report and
`system-verified` manifest, pushes the current exact `codex/<ticket>-<slug>` branch, and
upserts one linked draft PR plus one audit comment. It never auto-completes the PR.

## Current promotion boundary

The generator implementation and mock/provider tests are regression-tested. This is not
a claim that every generated business slice is already TDD-verified. Production
promotion still requires an all-slice Expense run, an all-slice non-expense run, and a
live least-privilege ADO sandbox run that produces the same approved graphs and an
idempotent linked draft PR.

The current local verification snapshot is:

| Evidence | Result |
|---|---|
| TestGen package | 50 suites passed; 539 tests passed; 5 intentional skips |
| ADO adapter | 3 suites passed; 22 tests passed |
| TypeScript | `packages/testgen` and `packages/testgen-ado` pass `tsc --noEmit` |
| Public claims | 24 files scanned; 0 violations |
| Disposable Expense scaffold | Locked install, Prisma generation, format, lint, architecture, typecheck, contract tests, production build and dependency audit passed |

The interactive web version of this guide is available at
[`site/application-generator.html`](../site/application-generator.html).
