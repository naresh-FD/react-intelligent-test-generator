#!/usr/bin/env pwsh
# Delete legacy auto-testgen.mjs from git

Write-Host "Removing legacy auto-testgen.mjs from git..." -ForegroundColor Yellow

git rm scripts/auto-testgen.mjs

Write-Host "Committing deletion..." -ForegroundColor Yellow

git commit -m "chore: remove legacy auto-testgen.mjs

- Delete 1710-line monolithic test generator
- All functionality migrated to modular scripts/testgen/ system
- npm start now uses modular testgen automatically
- Maintains clean git history while removing dead code"

Write-Host "✅ Legacy file deleted successfully!" -ForegroundColor Green
Write-Host "`nNew clean structure:" -ForegroundColor Cyan
Write-Host "  scripts/" -ForegroundColor Green
Write-Host "  ├── dev.mjs (Dev server with auto-testgen)" -ForegroundColor Green
Write-Host "  └── testgen/ (Modular test generation system)" -ForegroundColor Green
