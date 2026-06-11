# Renames the project root D:\Crix -> D:\Ares, preserving everything that is
# anchored to the path:
#   1. the git repo itself (a folder move keeps history, remotes, hooks)
#   2. Claude Code's project memory (keyed by path: D--Crix -> D--Ares)
#
# Run from OUTSIDE the repo (e.g. PowerShell in D:\), with no editors, agents,
# or terminals holding the folder open:
#   powershell -ExecutionPolicy Bypass -File D:\Crix\scripts\rename-root-to-ares.ps1

$ErrorActionPreference = "Stop"
$old = "D:\Crix"
$new = "D:\Ares"
$claudeProjects = Join-Path $env:USERPROFILE ".claude\projects"
$oldMem = Join-Path $claudeProjects "D--Crix"
$newMem = Join-Path $claudeProjects "D--Ares"

if (-not (Test-Path $old)) { throw "$old not found - already renamed?" }
if (Test-Path $new) { throw "$new already exists - refusing to overwrite" }
if ((Get-Location).Path.StartsWith($old)) { throw "cd out of $old first (the move cannot happen under your feet)" }

# 1. Move the repo.
Move-Item -Path $old -Destination $new
Write-Host "moved $old -> $new"

# 2. Carry the Claude project memory over (COPY - the old stays as backup).
if ((Test-Path $oldMem) -and (-not (Test-Path $newMem))) {
  Copy-Item -Path $oldMem -Destination $newMem -Recurse
  Write-Host "copied Claude memory $oldMem -> $newMem"
} else {
  Write-Host "Claude memory: nothing to do (missing source or target exists)"
}

Write-Host ""
Write-Host "Done. Next:"
Write-Host "  cd D:\Ares; pnpm install; pnpm verify   # path-anchored caches rebuild"
Write-Host "  (desktop shortcuts / IDE recent-folders will need repointing)"
