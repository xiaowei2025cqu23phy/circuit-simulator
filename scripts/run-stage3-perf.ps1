# Stage-3 performance orchestration (Windows PowerShell).
#
# Runs every (case, solver) configuration in its OWN Node process, in several
# independent batches, with a randomized solver order per case and batch.
# Raw per-repetition rows are appended to research/perf-raw/*.csv and the
# process order is recorded in research/perf-raw/order-manifest.csv.
#
# Usage:
#   pwsh -File scripts/run-stage3-perf.ps1
#   pwsh -File scripts/run-stage3-perf.ps1 -Batches 2 -Reps 2 -Cases "heavy-24","rc-64"
param(
  [int]$Batches = 3,
  [int]$Reps = 3,
  [int]$Warmup = 1,
  [string[]]$Cases = @(
    'rc-64','rc-256',
    'light-96','light-128','light-256',
    'heavy-12','heavy-24','heavy-64','heavy-128','heavy-256',
    'timed-switch-24'
  )
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$rawDir = Join-Path $root 'research/perf-raw'
New-Item -ItemType Directory -Path $rawDir -Force | Out-Null
$manifest = Join-Path $rawDir 'order-manifest.csv'
"batch,case,order_index,solver,start_time,exit_code,seconds" | Set-Content -Encoding utf8 $manifest

$solvers = @('inverse', 'lu', 'inverse-rank1')
foreach ($batch in 1..$Batches) {
  foreach ($case in $Cases) {
    $order = $solvers | Get-Random -Shuffle
    for ($i = 0; $i -lt $order.Count; $i++) {
      $solver = $order[$i]
      $out = Join-Path $rawDir ("{0}__{1}__b{2}.csv" -f $case, $solver, $batch)
      $start = Get-Date
      $t0 = Get-Date
      & node --expose-gc (Join-Path $root 'scripts/perf-probe.mjs') `
        "--case=$case" "--solver=$solver" "--reps=$Reps" "--warmup=$Warmup" `
        "--batch=$batch" "--order=$i" "--out=$out" 2>$null
      $code = $LASTEXITCODE
      $seconds = ((Get-Date) - $t0).TotalSeconds
      "{0},{1},{2},{3},{4},{5},{6}" -f $batch, $case, $i, $solver,
        $start.ToString('o'), $code, $seconds.ToString('F3') | Add-Content -Encoding utf8 $manifest
      if ($code -ne 0) { throw "perf probe failed: case=$case solver=$solver batch=$batch exit=$code" }
      Write-Host ("batch {0} case {1} solver {2} ok ({3:N1}s)" -f $batch, $case, $solver, $seconds)
    }
  }
}
Write-Host "raw rows written to $rawDir"
