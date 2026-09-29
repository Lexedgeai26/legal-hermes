<#
.SYNOPSIS
  Build the LexEdge Hermes Agent Setup installer on Windows, from current main.

.DESCRIPTION
  Two mistakes have each cost a full QA round, so this script refuses to
  continue on either:

    * Building apps/desktop instead of apps/bootstrap-installer. They are
      different applications. Only the bootstrap installer has the Private AI
      and cloud choice screens; the desktop app is the product it installs and
      has never had them. A build of the wrong one looks like a missing
      feature.

    * Building stale code. Two QA rounds reported bugs that had already been
      fixed, because the artifact predated the fixes. The commit is stamped
      into the output filename so any result can be tied to a revision.

  Run from anywhere:
      powershell -ExecutionPolicy Bypass -File tools\build-windows.ps1

.PARAMETER SkipGitCheck
  Build without verifying the branch is current. For offline or deliberate
  builds of an older revision.
#>
param(
    [switch]$SkipGitCheck
)

$ErrorActionPreference = 'Stop'

# Resolve the installer directory from this script's location, so the script
# works regardless of where it is invoked from.
$InstallerDir = Split-Path -Parent $PSScriptRoot
$RepoRoot     = Split-Path -Parent (Split-Path -Parent $InstallerDir)

Write-Host ""
Write-Host "LexEdge Hermes Agent Setup - Windows build" -ForegroundColor Cyan
Write-Host "  installer : $InstallerDir"
Write-Host "  repo      : $RepoRoot"
Write-Host ""

# --- Sanity: are we actually in the installer, not the desktop app? ----------
$TauriConf = Join-Path $InstallerDir "src-tauri\tauri.conf.json"
if (-not (Test-Path $TauriConf)) {
    throw "No src-tauri\tauri.conf.json here. This script must live in apps\bootstrap-installer\tools."
}
$conf = Get-Content $TauriConf -Raw | ConvertFrom-Json
if ($conf.productName -ne "LexEdge Hermes Agent Setup") {
    throw "Unexpected productName '$($conf.productName)'. This is not the setup installer."
}
if ($conf.bundle.targets -notcontains "nsis") {
    throw "tauri.conf.json has no 'nsis' target, so this build would produce no installer. Pull latest main."
}
Write-Host "  [ok] building the setup installer (not the desktop app)" -ForegroundColor Green

# --- Sanity: is the working tree current? ------------------------------------
Push-Location $RepoRoot
try {
    $commit = (git rev-parse --short HEAD).Trim()
    $branch = (git rev-parse --abbrev-ref HEAD).Trim()
    $dirty  = (git status --porcelain)

    if (-not $SkipGitCheck) {
        git fetch origin --quiet
        $behind = (git rev-list --count "HEAD..origin/$branch" 2>$null)
        if ($LASTEXITCODE -eq 0 -and [int]$behind -gt 0) {
            throw "This branch is $behind commit(s) behind origin/$branch. Run 'git pull' first, or pass -SkipGitCheck deliberately."
        }
    }

    if ($dirty) {
        # Not fatal — a developer may be testing a change — but the artifact can
        # no longer be tied to a commit, so say so loudly.
        Write-Host "  [warn] working tree has uncommitted changes; the commit stamp will not describe this build exactly" -ForegroundColor Yellow
    }

    Write-Host "  [ok] branch $branch at $commit" -ForegroundColor Green
}
finally {
    Pop-Location
}

# --- Build --------------------------------------------------------------------
Write-Host ""
Write-Host "Installing dependencies..." -ForegroundColor Cyan
Push-Location $RepoRoot
try { npm install } finally { Pop-Location }

Write-Host ""
Write-Host "Building (this takes several minutes on a cold cargo cache)..." -ForegroundColor Cyan
Push-Location $InstallerDir
try {
    npm run tauri:build
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed with exit code $LASTEXITCODE" }
}
finally { Pop-Location }

# --- Collect and stamp --------------------------------------------------------
$BundleDir = Join-Path $InstallerDir "src-tauri\target\release\bundle"
$OutDir    = Join-Path $RepoRoot "dist-windows"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
$found = @()

foreach ($kind in @("nsis", "msi")) {
    $dir = Join-Path $BundleDir $kind
    if (-not (Test-Path $dir)) { continue }
    Get-ChildItem $dir -Filter "*.$($kind -replace 'nsis','exe')" -ErrorAction SilentlyContinue | ForEach-Object {
        $ext  = $_.Extension
        $dest = Join-Path $OutDir "LexEdge-Hermes-Agent-Setup-0.0.1-Windows-$arch-$commit$ext"
        Copy-Item $_.FullName $dest -Force
        $found += $dest
    }
}

Write-Host ""
if ($found.Count -eq 0) {
    Write-Host "No installer was produced." -ForegroundColor Red
    Write-Host "Check that tauri.conf.json lists the nsis/msi targets and that NSIS downloaded successfully."
    exit 1
}

Write-Host "Built from commit $commit :" -ForegroundColor Green
foreach ($f in $found) {
    $hash = (Get-FileHash $f -Algorithm SHA256).Hash.ToLower()
    $size = [math]::Round((Get-Item $f).Length / 1MB, 1)
    Write-Host "  $f"
    Write-Host "     $size MB   sha256 $hash"
}

Write-Host ""
Write-Host "Before handing this to QA:" -ForegroundColor Cyan
Write-Host "  1. Launch it. The second screen must read 'Choose where the model runs'"
Write-Host "     with Private AI and cloud options. If you only see a progress bar,"
Write-Host "     the wrong application was built."
Write-Host "  2. Report the commit ($commit) with the build. Two QA rounds have"
Write-Host "     produced results that could not be tied to a revision."
Write-Host "  3. This build is unsigned, so SmartScreen will warn. Fine internally;"
Write-Host "     it must be signed before it goes to a client."
