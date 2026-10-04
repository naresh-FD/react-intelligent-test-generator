# react-intelligent-test-generator — public docs repository

This repository is **documentation and plans only**. It publishes the GitHub Pages site and holds
public docs (`index.html`, `application-generator.html`, `docs/`).

| Repo | Purpose |
|------|---------|
| `naresh-FD/react-intelligent-test-generator` (this repo) | Public docs, site, and setup/roadmap plans |
| `naresh-FD/react-intelligent-test-generator-private` | **All TestGen source code** (`packages/testgen/`), tests, CLI, and code PRs |

Rules for anyone (human or agent) working here:

- Never add source code, tests, `package.json`, lockfiles or `packages/` to this repo. Code changes
  go to the private repo. The `docs-only` workflow fails any PR that adds them.
- Do not open a PR here from a branch that was created for the private repo.
- Public claims must follow `docs/product-status.md`; it is the canonical status source.
