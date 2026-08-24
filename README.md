# React Intelligent Test Generator

This is the standalone public web-documentation repository for React Intelligent Test Generator.

Published site: <https://naresh-fd.github.io/react-intelligent-test-generator/>

The application source remains in a separate private repository. Keeping this public repository at the existing `react-intelligent-test-generator` slug preserves the established GitHub Pages URL without adding a second product name.

## Publishing

GitHub Actions deploys `index.html` from `main`. Any change to the page or Pages workflow triggers a new deployment; a manual `workflow_dispatch` is also available.

## Documentation policy

Public metrics must retain their qualifiers:

- The committed 20-case BOL corpus records 12 first-run passes (60%), 16 compilations (80%), and 0% generation nondeterminism across five repetitions.
- The React Admin `ra-core` result is one post-fix external pilot: 214 of 355 generated suites passed after iterative generator fixes. It is not a first-run or cross-repository benchmark.
- Mapping calibration keeps the 65% review threshold unchanged: the real PILOT-2 target reaches 56% without ticket-linked history and crosses the gate only when deterministic git evidence corroborates it.
- Unmerged branch work is described as development or pilot work, not as a released capability.
