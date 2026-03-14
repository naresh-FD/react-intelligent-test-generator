# Testgen Benchmarking

This repo now includes a low-memory benchmark runner for `testgen`.

## What it does

- Uses local example apps already present in this workspace
- Generates tests into `src/.testgen-bench/tests`
- Writes machine-readable summaries per run
- Produces final JSON and Markdown benchmark reports under `.testgen-results/benchmarks`

## Default run

```bash
npm run benchmark:testgen
```

This runs the `local-sample` manifest in `both` mode:

- generation-only benchmark
- generate + verify benchmark

## Useful commands

Run only generation:

```bash
npm run benchmark:testgen -- --mode generate
```

Run only one scenario:

```bash
npm run benchmark:testgen -- --scenario expense-manager
```

Change retries or coverage threshold:

```bash
npm run benchmark:testgen -- --mode verify --max-retries 2 --coverage-threshold 60
```

## Why this is low-memory

- No external repos need to be cloned
- No extra dependency installs are required
- Benchmark outputs are isolated under `.testgen-bench`
- The manifest uses a small, representative file set instead of whole-repo scans

## Next step

After the local benchmark is stable, add external repo manifests and run them one repo at a time using shallow or sparse clones.
