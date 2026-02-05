#!/bin/bash
# Delete legacy auto-testgen.mjs from git
git rm scripts/auto-testgen.mjs
git commit -m "chore: remove legacy auto-testgen.mjs

- Delete 1710-line monolithic test generator
- All functionality migrated to modular scripts/testgen/ system
- npm start now uses modular testgen automatically
- Maintains clean git history while removing dead code"
