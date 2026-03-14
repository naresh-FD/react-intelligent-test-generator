param(
  [string]$Manifest = "local-sample",
  [string]$Scenario,
  [ValidateSet("generate", "verify", "both")]
  [string]$Mode = "both",
  [string]$OutputPath,
  [int]$CoverageThreshold = 50,
  [int]$MaxRetries = 1
)

$ErrorActionPreference = "Stop"

function Get-RepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
}

function Get-ManifestPath([string]$RepoRoot, [string]$NameOrPath) {
  if ([System.IO.Path]::IsPathRooted($NameOrPath)) {
    return $NameOrPath
  }
  if ($NameOrPath.EndsWith(".json")) {
    return (Join-Path $RepoRoot $NameOrPath)
  }
  return (Join-Path $RepoRoot "packages\testgen\src\benchmarks\manifests\$NameOrPath.json")
}

function Ensure-Dir([string]$PathValue) {
  if (-not (Test-Path $PathValue)) {
    New-Item -ItemType Directory -Path $PathValue -Force | Out-Null
  }
}

function Write-Utf8NoBom([string]$PathValue, [string]$Content) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($PathValue, $Content, $encoding)
}

function Reset-Dir([string]$PathValue) {
  if (Test-Path $PathValue) {
    Remove-Item -Recurse -Force $PathValue
  }
  New-Item -ItemType Directory -Path $PathValue -Force | Out-Null
}

function New-BenchmarkConfig([string]$ScenarioId) {
  return @{
    version = 1
    defaults = @{
      include = @("src/**/*.{js,jsx,ts,tsx}")
      exclude = @(
        "**/__tests__/**",
        "**/*.test.*",
        "**/dist/**",
        "**/build/**",
        "**/coverage/**",
        "**/.testgen-bench/**"
      )
      framework = "auto"
      renderHelper = "auto"
      generateFor = @("components", "hooks", "utils")
      mode = "file"
      existingTestStrategy = "replace"
      testOutput = @{
        strategy = "mirror"
        directory = "src/.testgen-bench/tests"
        srcRoot = "src"
      }
    }
    packages = @(
      @{
        name = $ScenarioId
        root = "."
        include = @("src/**/*.{js,jsx,ts,tsx}")
        exclude = @(
          "**/__tests__/**",
          "**/*.test.*",
          "**/dist/**",
          "**/build/**",
          "**/coverage/**",
          "**/.testgen-bench/**"
        )
        framework = "auto"
        renderHelper = "auto"
        generateFor = @("components", "hooks", "utils")
        mode = "file"
        existingTestStrategy = "replace"
        testOutput = @{
          strategy = "mirror"
          directory = "src/.testgen-bench/tests"
          srcRoot = "src"
        }
      }
    )
  }
}

function Convert-ReportToMarkdown($Report) {
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("# Testgen Benchmark Report")
  $lines.Add("")
  $lines.Add("- Manifest: $($Report.manifest.name)")
  $lines.Add("- Mode: $($Report.mode)")
  $lines.Add("- Coverage threshold: $($Report.coverageThreshold)%")
  $lines.Add("- Max retries: $($Report.maxRetries)")
  $lines.Add("- Created: $($Report.createdAt)")
  $lines.Add("")

  foreach ($scenario in $Report.scenarios) {
    $lines.Add("## $($scenario.id)")
    if ($scenario.description) {
      $lines.Add([string]$scenario.description)
    }
    $lines.Add("")
    $lines.Add("Files: $($scenario.files.Count)")
    $lines.Add("")

    foreach ($run in $scenario.runs) {
      $lines.Add("### $($run.label)")
      $lines.Add("- Duration: $($run.durationMs) ms")
      $lines.Add("- Exit code: $($run.exitCode)")
      if ($run.summary) {
        $lines.Add("- Rows: $($run.summary.aggregate.total)")
        $lines.Add("- Pass: $($run.summary.aggregate.pass)")
        $lines.Add("- Fail: $($run.summary.aggregate.fail)")
        $lines.Add("- Low coverage: $($run.summary.aggregate.lowCoverage)")
        $lines.Add("- Skipped: $($run.summary.aggregate.skipped)")
        $lines.Add("- Generated: $($run.summary.aggregate.generated)")
        $lines.Add("- Smoke fallback: $($run.summary.aggregate.smokeFallback)")
      }
      $lines.Add("")
    }
  }

  return ($lines -join "`n")
}

$repoRoot = Get-RepoRoot
$manifestPath = Get-ManifestPath -RepoRoot $repoRoot -NameOrPath $Manifest
$manifestData = Get-Content $manifestPath -Raw | ConvertFrom-Json

$scenarios = @($manifestData.scenarios)
if ($Scenario) {
  $scenarios = @($scenarios | Where-Object { $_.id -eq $Scenario })
}
if ($scenarios.Count -eq 0) {
  throw "No benchmark scenarios matched '$Scenario'."
}

$tsNodePath = Join-Path $repoRoot "node_modules\.bin\ts-node.cmd"
$cliPath = Join-Path $repoRoot "packages\testgen\src\cli.ts"
$scenarioResults = New-Object System.Collections.Generic.List[object]

foreach ($scenarioItem in $scenarios) {
  $appRoot = (Resolve-Path (Join-Path $repoRoot $scenarioItem.cwd)).Path
  $benchRoot = Join-Path $appRoot ".testgen-bench"
  $generatedRoot = Join-Path $appRoot "src\.testgen-bench"
  $resultsRoot = Join-Path $appRoot ".testgen-results\benchmarks"
  Ensure-Dir $benchRoot
  Ensure-Dir $resultsRoot

  $configPath = Join-Path $benchRoot "react-testgen.benchmark.config.json"
  $filesPath = Join-Path $benchRoot "$($scenarioItem.id).files.json"
  $config = New-BenchmarkConfig -ScenarioId $scenarioItem.id
  Write-Utf8NoBom -PathValue $configPath -Content ($config | ConvertTo-Json -Depth 10)
  Write-Utf8NoBom -PathValue $filesPath -Content (@($scenarioItem.files) | ConvertTo-Json -Depth 5)

  $runs = New-Object System.Collections.Generic.List[object]
  $labels = switch ($Mode) {
    "generate" { @("generate") }
    "verify" { @("verify") }
    default { @("generate", "verify") }
  }

  foreach ($label in $labels) {
    Reset-Dir $generatedRoot
    $summaryPath = Join-Path $resultsRoot "$($scenarioItem.id).$label.summary.json"
    if (Test-Path $summaryPath) {
      Remove-Item -Force $summaryPath
    }

    $cliArgs = @(
      $cliPath,
      "--config", $configPath,
      "--files-from", $filesPath,
      "--summary-json", $summaryPath
    )

    if ($label -eq "verify") {
      $cliArgs += @(
        "--verify",
        "--max-retries", "$MaxRetries",
        "--coverage-threshold", "$CoverageThreshold"
      )
    }

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    Push-Location $appRoot
    try {
      $previousErrorActionPreference = $ErrorActionPreference
      $ErrorActionPreference = "Continue"
      $output = & $tsNodePath @cliArgs 2>&1
      $exitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousErrorActionPreference
      Pop-Location
    }
    $stopwatch.Stop()

    $summary = $null
    if (Test-Path $summaryPath) {
      $summary = Get-Content $summaryPath -Raw | ConvertFrom-Json
    }

    $runs.Add([PSCustomObject]@{
      label = $label
      durationMs = [Math]::Round($stopwatch.Elapsed.TotalMilliseconds, 1)
      exitCode = $exitCode
      summary = $summary
      output = @($output) -join "`n"
    })
  }

  $scenarioResults.Add([PSCustomObject]@{
    id = $scenarioItem.id
    cwd = $appRoot
    description = $scenarioItem.description
    files = @($scenarioItem.files)
    runs = $runs
  })
}

$report = [PSCustomObject]@{
  manifest = [PSCustomObject]@{
    name = $manifestData.name
    description = $manifestData.description
  }
  createdAt = [DateTime]::UtcNow.ToString("o")
  mode = $Mode
  coverageThreshold = $CoverageThreshold
  maxRetries = $MaxRetries
  scenarios = $scenarioResults
}

if (-not $OutputPath) {
  $stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH-mm-ss-fffZ")
  $OutputPath = Join-Path $repoRoot ".testgen-results\benchmarks\$($manifestData.name)-$stamp.json"
} elseif (-not [System.IO.Path]::IsPathRooted($OutputPath)) {
  $OutputPath = Join-Path $repoRoot $OutputPath
}

Ensure-Dir (Split-Path $OutputPath -Parent)
Write-Utf8NoBom -PathValue $OutputPath -Content ($report | ConvertTo-Json -Depth 12)
Write-Utf8NoBom -PathValue ($OutputPath -replace "\.json$", ".md") -Content (Convert-ReportToMarkdown $report)

Write-Output "Benchmark report written to $OutputPath"
Write-Output "Scenarios: $($scenarioResults.Count)"
