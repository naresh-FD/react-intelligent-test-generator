# Copilot Prompt: Generate Mocks for Provider-Heavy React Components

You are improving `packages/testgen` and its deterministic mock system.

## Non-Negotiable Rules

- Do not edit generated tests directly.
- Do not edit app source files.
- Do not use `@ts-nocheck`.
- Do not skip tests.
- Do not weaken assertions to get green.
- Only change generator, registry, resolver, planner, scaffold, validator, and docs inside `packages/testgen`.

## Goal

Produce a registry-first mock strategy that prevents:

- invalid JSX symbols
- wrong default vs named export mocks
- missing provider stack errors
- missing JSDOM/browser API crashes

## Required Method

1. Inventory source imports, hooks, and context usage.
2. For each dependency, choose exactly one:
   - registry mock at the module boundary
   - hook mock with deterministic factory overrides
   - validated provider wrapper
3. Only emit wrappers if the provider import path, export style, and symbol are validated.
4. Use hook/module overrides for scenario states:
   - loading
   - empty
   - error
   - data
   - modal/action
5. Keep browser API stubs centralized and generator-supported.

## Required Output

### Mock Plan

- providers required
- hooks to mock
- services/utilities to mock
- child components to stub
- browser APIs required

### Registry Entries

- exact mock registry additions or updates
- correct default vs named export handling
- partial mock usage where appropriate

### Scenario Overrides

- hook factory or `mockReturnValue` override patterns for each scenario

### Validation Checklist

- no unresolved provider/component JSX
- no skipped import with emitted JSX
- no guessed wrapper names
- no ad hoc mocks outside registry logic
