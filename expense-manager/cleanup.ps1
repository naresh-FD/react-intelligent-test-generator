#!/usr/bin/env pwsh
# Final cleanup - Remove all legacy files

Write-Host "`n🧹 Cleaning up legacy test generation files..." -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor DarkGray

# Remove legacy auto-testgen.mjs
if (Test-Path "scripts/auto-testgen.mjs") {
    Write-Host "`n📁 Removing scripts/auto-testgen.mjs..." -ForegroundColor Yellow
    git rm scripts/auto-testgen.mjs
    Write-Host "   ✅ Deleted from git" -ForegroundColor Green
}

# Remove helper cleanup scripts
if (Test-Path "delete-legacy.ps1") {
    Write-Host "`n📁 Removing delete-legacy.ps1..." -ForegroundColor Yellow
    Remove-Item delete-legacy.ps1
    Write-Host "   ✅ Deleted" -ForegroundColor Green
}

if (Test-Path "delete-legacy.sh") {
    Write-Host "`n📁 Removing delete-legacy.sh..." -ForegroundColor Yellow  
    Remove-Item delete-legacy.sh
    Write-Host "   ✅ Deleted" -ForegroundColor Green
}

# Commit the deletion
Write-Host "`n💾 Committing changes..." -ForegroundColor Cyan
git commit -m "chore: remove legacy auto-testgen.mjs

- Delete 1710-line monolithic test generator
- All functionality migrated to scripts/testgen/ modular system
- Clean up helper scripts
- Final cleanup complete"

Write-Host "`n" + "=" * 60 -ForegroundColor DarkGray
Write-Host "✨ Cleanup complete! Your codebase is now clean." -ForegroundColor Green
Write-Host "`nFinal structure:" -ForegroundColor Cyan
Write-Host "  scripts/" -ForegroundColor White
Write-Host "  ├── dev.mjs                ✅ Dev server" -ForegroundColor Green
Write-Host "  └── testgen/               ✅ Modular test generator" -ForegroundColor Green
Write-Host "      ├── config.mjs" -ForegroundColor Gray
Write-Host "      ├── index.mjs" -ForegroundColor Gray
Write-Host "      ├── utils/" -ForegroundColor Gray
Write-Host "      ├── analysis/" -ForegroundColor Gray
Write-Host "      └── generation/" -ForegroundColor Gray
Write-Host "`n🎉 Migration to modular system complete!" -ForegroundColor Green
Write-Host ""

# Self-delete this cleanup script
Remove-Item $MyInvocation.MyCommand.Path
