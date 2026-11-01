# Stage-3 performance orchestration (Windows PowerShell).
#
# Every invocation creates a NEW, self-describing run directory:
#   research/perf-runs/<runId>/
#     metadata.json        git SHA, node/npm, CPU/OS, parameters, seed, commands
#     order-manifest.csv   realized solver order and seeds per (batch, case)
#     raw/                 one CSV per (case, solver, batch) process
#
# Re-running never overwrites or appends to an existing run: the run id
# contains a timestamp and a random suffix, and the probe refuses to write to
# an existing file.
#
# Usage:
#   pwsh -File scripts/run-stage3-perf.ps1
#   pwsh -File scripts/run-stage3-perf.ps1 -Batches 2 -Reps 2 -Cases "heavy-24","rc-64"
param(
  [int]$Batches = 3,
  [int]$Reps = 3,
  [int]$Warmup = 1,
  [int]$Seed = 20261031,
  [string[]]$Cases = @(
    'rc-64','rc-256',
    'light-96','light-128','light-256',
    'heavy-12','heavy-24','heavy-64','heavy-128','heavy-256',
    'timed-switch-24'
  )
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$suffix = -join ((1..6) | ForEach-Object { '0123456789abcdef'[(Get-Random -Maximum 16)] })
$runId = "run-$stamp-$suffix"
$runDir = Join-Path $root "research/perf-runs/$runId"
$rawDir = Join-Path $runDir 'raw'
if (Test-Path $runDir) { throw "运行目录已存在，拒绝覆盖: $runDir" }
New-Item -ItemType Directory -Path $rawDir -Force | Out-Null

$gitSha = (& git -C $root rev-parse HEAD).Trim()
$nodeVersion = (& node --version).Trim()
$npmVersion = (& npm --version).Trim()
$cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name).Trim()
$osCaption = (Get-CimInstance Win32_OperatingSystem).Caption
$solvers = @('inverse', 'lu', 'inverse-rank1')

$metadata = [ordered]@{
  run_id = $runId
  created_at = (Get-Date).ToString('o')
  git_sha = $gitSha
  worktree_dirty = [bool]((& git -C $root status --porcelain) | Where-Object { $_ -match '\S' })
  node = $nodeVersion
  npm = $npmVersion
  platform = 'win32'
  cpu = $cpu
  os = $osCaption
  parameters = [ordered]@{ batches = $Batches; reps = $Reps; warmup = $Warmup; seed = $Seed; cases = $Cases }
  commands = @(
    "pwsh -File scripts/run-stage3-perf.ps1 -Batches $Batches -Reps $Reps -Warmup $Warmup -Seed $Seed",
    "node scripts/perf-aggregate.mjs --run=$runDir"
  )
  solver_order = 'deterministic shuffle from per-(batch,case) seed'
  notes = 'Every probe process writes exactly one new CSV; existing files are never overwritten or appended.'
}
$metadata | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $runDir 'metadata.json')

$manifest = Join-Path $runDir 'order-manifest.csv'
"batch,case,case_index,case_seed,order_index,solver,start_time,exit_code,seconds" |
  Set-Content -Encoding utf8 $manifest

$exitFailures = 0
foreach ($batch in 1..$Batches) {
  $caseIndex = 0
  foreach ($case in $Cases) {
    $caseSeed = $Seed + $batch * 1000 + $caseIndex
    $rng = [System.Random]::new([int]([math]::Abs($caseSeed) % 2147483647))
    $order = [System.Collections.ArrayList]@($solvers)
    for ($i = $order.Count - 1; $i -gt 0; $i--) {
      $j = $rng.Next($i + 1)
      $tmp = $order[$i]; $order[$i] = $order[$j]; $order[$j] = $tmp
    }
    for ($i = 0; $i -lt $order.Count; $i++) {
      $solver = $order[$i]
      $out = Join-Path $rawDir ("{0}__{1}__b{2}.csv" -f $case, $solver, $batch)
      $start = Get-Date
      & node --expose-gc (Join-Path $root 'scripts/perf-probe.mjs') `
        "--run-id=$runId" "--case=$case" "--solver=$solver" "--reps=$Reps" "--warmup=$Warmup" `
        "--batch=$batch" "--order=$i" "--seed=$caseSeed" "--out=$out" 2>$null
      $code = $LASTEXITCODE
      $seconds = ((Get-Date) - $start).TotalSeconds
      "{0},{1},{2},{3},{4},{5},{6},{7},{8}" -f $batch, $case, $caseIndex, $caseSeed, $i, $solver,
        $start.ToString('o'), $code, $seconds.ToString('F3') | Add-Content -Encoding utf8 $manifest
      if ($code -ne 0) {
        $exitFailures += 1
        Write-Host ("FAILED batch {0} case {1} solver {2} exit {3}" -f $batch, $case, $solver, $code)
        throw "perf probe failed (exit $code): batch=$batch case=$case solver=$solver"
      }
      Write-Host ("batch {0} case {1} solver {2} ok ({3:N1}s)" -f $batch, $case, $solver, $seconds)
    }
    $caseIndex += 1
  }
}
Write-Host "RUN_ID=$runId"
Write-Host "RUN_DIR=$runDir"
if ($exitFailures -ne 0) { exit 1 }
