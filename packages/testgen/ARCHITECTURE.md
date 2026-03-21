# testgen — Self-Healing Test Generation Architecture

## Canonical Pipeline

```
analyze → build plan → validate → emit → typecheck → run → classify → heal → retry → persist learning
```

### Stage Details

| Stage | Module | Responsibility |
|-------|--------|---------------|
| **Analyze** | `src/analyzer.ts` | AST-based extraction of components, hooks, contexts, props, services |
| **Build Plan** | `src/generator/semanticPlan.ts` | Semantic test plan: imports, providers, mocks, test cases — all derived from analysis |
| **Validate** | `src/validation/preEmitValidator.ts` | Pre-emit validation: strips providers with missing imports, ensures plan consistency |
| **Emit** | `src/generator/templates.ts` | Code emission from the validated plan only — no raw inference allowed |
| **Typecheck** | via Jest `--silent` | TypeScript compilation via ts-jest |
| **Run** | via Jest | Test execution with coverage collection |
| **Classify** | `src/validation/issueClassifier.ts` | Maps error output to canonical `IssueType` taxonomy |
| **Heal** | `src/execution/issueToStrategy.ts` | Deterministic repair: targeted fix per issue type |
| **Retry** | `src/execution/healingLoop.ts` | Budget-controlled retry with fingerprint tracking |
| **Learn** | `src/learning/issueDatasetWriter.ts` | Normalized JSONL records for every failure and repair outcome |

## Issue Taxonomy

16 canonical issue types defined in `src/types.ts`:

| Type | Phase | Severity |
|------|-------|----------|
| `MISSING_PROVIDER` | runtime | high |
| `INVALID_PROVIDER_ORDER` | runtime | high |
| `BROKEN_IMPORT` | typecheck | critical |
| `MISSING_EXPORT` | typecheck | critical |
| `INVALID_COMPONENT_SYMBOL` | runtime | critical |
| `MOCK_MODULE_NOT_FOUND` | typecheck | critical |
| `MOCK_EXPORT_MISMATCH` | runtime | high |
| `SERVICE_NOT_MOCKED` | runtime | high |
| `JEST_DOM_MISSING` | assertion | medium |
| `TYPE_ASSERTION_MISMATCH` | assertion | medium |
| `ASYNC_QUERY_MISMATCH` | assertion | medium |
| `ACT_WARNING_PATTERN` | runtime | medium |
| `UNSAFE_UNDEFINED_ACCESS` | runtime | medium |
| `OVER_SKIPPED_TEST` | generation | low |
| `EARLY_LOOP_TERMINATION` | generation | low |
| `UNKNOWN` | runtime | low |

## Retry Controller

The healing loop (`src/execution/healingLoop.ts`) controls retry behavior:

- **Does NOT stop** while failures remain and retry budget is available
- **Fingerprint tracking** prevents infinite retry of the same failed strategy (max 3 per fingerprint)
- **Explicit exhaustion reasons** report which issue types remain unresolved
- **Exit states**: `pass`, `low-coverage`, `fail`, `exhausted`

## Learning Data

Persisted to `data/learning/`:

| File | Format | Content |
|------|--------|---------|
| `issue-dataset.jsonl` | JSONL | Normalized issue/fix records with signatures, strategies, verification |
| `heal-history.jsonl` | JSONL | Per-component session outcomes (status, attempts, coverage) |
| `issue-stats.json` | JSON | Aggregate issue type frequency counts |

Records are written by the healing loop during real runs — not as a side utility.

## Why Generated Tests Are Not the Fix Location

The system never patches generated tests as the durable solution. Instead:

1. Issues are classified and mapped to generator-level repairs
2. The generator's planning/validation/emission layers are fixed
3. Tests are regenerated from the corrected plan
4. Learning records capture what went wrong so the generator improves

This ensures the root cause is addressed, not just the symptom.
