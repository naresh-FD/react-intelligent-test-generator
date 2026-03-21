# Mock Catalog for Provider-Heavy React Components

## Purpose

This catalog is the single source of truth for mocks the generator is allowed to emit.
It exists to keep generated tests deterministic and to prevent invalid JSX, unresolved providers,
and incorrect default-vs-named export mocks.

## Provider Stack Contract

Observed provider order in provider-heavy apps:

`Router -> ApiContext -> GlobalContext -> FeatureContext -> DynamicReportingService -> TransactionsProvider`

This stack is documentation and registry guidance only.
The generator must still validate each provider before emitting it.

Optional providers are emitted only when detected and validated:

- `ImageViewerService`
- `ReportProvider`

## Mock Categories

### P0: Routing and Provider Hooks

- Prefer validated provider wrappers when imports/exports are known.
- Otherwise mock hook boundaries, not guessed provider names.
- Router support should prefer `MemoryRouter` for validated wrapper composition.

### P0: Context and State Hooks

Primary scenario-driving hooks:

- `useFeatureContext`
- `useGlobalState`
- `useTransactionsState`
- `useApi`
- `useDynamicReportingService`

These should expose deterministic factories and per-test overrides for:

- loading
- empty
- error
- data
- modal/action

### P1: Service and Utility Modules

- Service hooks and API clients should preserve correct default vs named export semantics.
- Partial mocks should preserve real exports when only a subset is overridden.
- Utility/formatter mocks should return stable business-plausible values.

### P1: Child Component Stubs

- Child component stubs should only be emitted from registry/resolver logic.
- Default-export component stubs must include `__esModule: true` and `default`.
- Named component stubs must export the named symbol only.

### P2: Environment and Browser Gaps

Centralized environment support should cover:

- `matchMedia`
- `ResizeObserver`
- `IntersectionObserver`
- `scrollTo`
- `print`
- canvas `getContext`
- portal root when needed
- `fetch` and `crypto` only when required by source usage

## Rules the Generator Must Follow

1. Resolve imports before emitting wrappers or mocks.
2. Never emit guessed provider names.
3. Never emit JSX for unresolved symbols.
4. Drive scenarios through hook/module overrides, not wrapper mutations.
5. Use the registry as the only emitted mock authority.
