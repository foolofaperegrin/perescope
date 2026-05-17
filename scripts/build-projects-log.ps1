# Runs build-projects.ps1, then validates outputs and summarizes errors from the log.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-projects-log.ps1
# Or: scripts\build-projects-log.cmd
#
# Log file: scripts/build-projects.log

param(
    [switch]$AnalyzeOnly
)

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$projectsDir = Join-Path $root "projects"
$manifestFile = Join-Path $projectsDir "manifest.json"
$buildScript = Join-Path $PSScriptRoot "build-projects.ps1"
$logFile = Join-Path $PSScriptRoot "build-projects.log"

function Write-Section([string] $title) {
    Write-Host ""
    Write-Host "=== $title ===" -ForegroundColor Cyan
}

function Test-JsonFile([string] $path) {
    try {
        $null = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
        return $true
    }
    catch {
        return $false
    }
}

function Analyze-BuildProjectsLog {
    param([string] $LogPath)

    Write-Section "Log analysis"
    if (-not (Test-Path -LiteralPath $LogPath)) {
        Write-Host "No log file at: $LogPath" -ForegroundColor Yellow
        Write-Host "Run the build first (scripts\build-projects-log.cmd)."
        return 1
    }

    $logText = Get-Content -LiteralPath $LogPath -Raw -Encoding UTF8
    $issues = New-Object System.Collections.Generic.List[string]
    $warnings = New-Object System.Collections.Generic.List[string]

    $warningMatches = [regex]::Matches(
        $logText,
        '(?m)^\s*WARNING:\s*(.+)$'
    )
    foreach ($m in $warningMatches) {
        $line = $m.Groups[1].Value.Trim()
        if ($line) { [void]$warnings.Add($line) }
    }

    $errorMatches = [regex]::Matches(
        $logText,
        '(?m)^\s*(?:Projects: FAILED|FATAL:)\s*(.+)$'
    )
    foreach ($m in $errorMatches) {
        $line = $m.Groups[1].Value.Trim()
        if ($line) { [void]$issues.Add("LOG: $line") }
    }

    if ($logText -match 'Out of memory') {
        [void]$issues.Add(
            "HINT: Out of memory usually means a very large WEBP/AVIF file. Convert to JPG/PNG or use: npm run build:projects (requires Node + sharp)."
        )
    }
    if ($logText -match 'System\.Web\.HttpUtility') {
        [void]$issues.Add(
            "HINT: System.Web.HttpUtility missing - YouTube URL parsing may fail on some PowerShell installs."
        )
    }

    Write-Section "Manifest and images.json"
    if (-not (Test-Path -LiteralPath $manifestFile)) {
        [void]$issues.Add("MISSING: projects/manifest.json")
    }
    elseif (-not (Test-JsonFile $manifestFile)) {
        [void]$issues.Add("INVALID JSON: projects/manifest.json")
    }
    else {
        $manifest = Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
        $featured = @($manifest.featured)
        Write-Host "manifest.json OK - $($featured.Count) featured project(s)"
        foreach ($p in $featured) {
            if ($p.cover) {
                $coverPath = Join-Path $root ($p.cover -replace '/', '\')
                if (-not (Test-Path -LiteralPath $coverPath)) {
                    [void]$issues.Add("MISSING COVER: $($p.slug) -> $($p.cover)")
                }
            }
            else {
                [void]$issues.Add("NO COVER in manifest: $($p.slug)")
            }
        }
    }

    Get-ChildItem -LiteralPath $projectsDir -Directory |
        Where-Object { -not $_.Name.StartsWith('.') } |
        ForEach-Object {
            $slug = $_.Name
            $indexPath = Join-Path $_.FullName "index.html"
            $imagesPath = Join-Path $_.FullName "images.json"
            if (-not (Test-Path -LiteralPath $indexPath)) { return }

            if (-not (Test-Path -LiteralPath $imagesPath)) {
                [void]$issues.Add("MISSING: projects/$slug/images.json")
                return
            }
            if (-not (Test-JsonFile $imagesPath)) {
                [void]$issues.Add("INVALID JSON: projects/$slug/images.json")
                return
            }

            $data = Get-Content -LiteralPath $imagesPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($null -eq $data.images) {
                [void]$issues.Add("BAD SHAPE: projects/$slug/images.json - images is not an array")
            }
            elseif ($data.images -isnot [Array]) {
                [void]$issues.Add("BAD SHAPE: projects/$slug/images.json - images must be a JSON array")
            }

            if ($data.cover) {
                $coverOnDisk = Join-Path $_.FullName $data.cover
                if (-not (Test-Path -LiteralPath $coverOnDisk)) {
                    [void]$issues.Add("MISSING FILE: projects/$slug/$($data.cover) (listed as cover)")
                }
            }
        }

    Write-Section "Summary"
    if ($warnings.Count -gt 0) {
        Write-Host "$($warnings.Count) warning(s) in log (non-fatal):" -ForegroundColor DarkYellow
        foreach ($w in $warnings) {
            Write-Host "  - $w" -ForegroundColor DarkYellow
        }
    }

    if ($issues.Count -eq 0) {
        Write-Host "No blocking issues found." -ForegroundColor Green
        return 0
    }

    Write-Host "$($issues.Count) blocking issue(s):" -ForegroundColor Yellow
    foreach ($issue in $issues) {
        Write-Host "  - $issue" -ForegroundColor Yellow
    }
    return 1
}

if ($AnalyzeOnly) {
    exit (Analyze-BuildProjectsLog $logFile)
}

Write-Host "Running projects build..."
Write-Host "Log: $logFile"
Write-Host ""

& powershell -NoProfile -ExecutionPolicy Bypass -File $buildScript
$buildExit = $LASTEXITCODE

$analyzeExit = Analyze-BuildProjectsLog $logFile

if ($buildExit -ne 0) {
    Write-Host ""
    Write-Host "Build exit code: $buildExit" -ForegroundColor Red
    exit $buildExit
}

if ($analyzeExit -ne 0) {
    Write-Host ""
    Write-Host "Build finished but validation reported problems." -ForegroundColor Yellow
    exit $analyzeExit
}

Write-Host ""
Write-Host "Build and validation OK." -ForegroundColor Green
exit 0
