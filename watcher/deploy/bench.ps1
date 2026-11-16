# Measure what this box does with a recorded-hand flop solve.
#
# Run this BEFORE trusting any solve time on a new machine. It needs only
# engine.exe: no .env, no network, nothing uploaded. It solves the committed
# hand-history-shaped configs (engine/configs/bench/hh_*.json) at several
# thread counts, then two at once with one pinned per processor socket, and
# prints a table to paste back.
#
# Usage:
#   C:\HoldemTools\watcher\deploy\bench.ps1                 # ~10-30 minutes
#   C:\HoldemTools\watcher\deploy\bench.ps1 -Full           # every config at every count
#   C:\HoldemTools\watcher\deploy\bench.ps1 -EngineExe D:\drop\engine.exe
param(
    [string]$EngineExe = "",
    [string]$OutDir = (Join-Path $env:TEMP "htsolver-bench"),
    # Sweep every config at every thread count (default: the medium spot only).
    [switch]$Full
)

$ErrorActionPreference = "Stop"
$watcherDir = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $watcherDir
if (-not $EngineExe) { $EngineExe = Join-Path $repoRoot "engine\build\engine.exe" }
if (-not (Test-Path $EngineExe)) { throw "engine.exe not found at $EngineExe (build it with engine\build.ps1 or pass -EngineExe)." }
$configDir = Join-Path $repoRoot "engine\configs\bench"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# --- The machine -------------------------------------------------------------
$cpus = @(Get-CimInstance Win32_Processor)
$logical = ($cpus | Measure-Object NumberOfLogicalProcessors -Sum).Sum
$cores = ($cpus | Measure-Object NumberOfCores -Sum).Sum
$ramGb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
$machine = "$($env:COMPUTERNAME): $($cpus.Count) x $($cpus[0].Name.Trim()), $cores cores / $logical threads, $ramGb GB"
Write-Host $machine

# --- One solve ---------------------------------------------------------------
# Returns the artifact's own metadata, which is where the engine records the
# solve loop, the export pass and the peak memory separately.
function Start-Solve($configName, $threads, $tag) {
    $config = Get-Content (Join-Path $configDir "$configName.json") -Raw | ConvertFrom-Json
    $artifact = Join-Path $OutDir "$configName.$tag.hta"
    $config.threads = $threads
    $config.output.path = $artifact.Replace("\", "/")
    $configPath = Join-Path $OutDir "$configName.$tag.json"
    # Depth: bet_sizing nests four levels below the root.
    $config | ConvertTo-Json -Depth 20 | Set-Content -Path $configPath -Encoding ascii
    Remove-Item -Force -ErrorAction SilentlyContinue $artifact
    $process = Start-Process -FilePath $EngineExe -ArgumentList @("solve", "`"$configPath`"") `
        -NoNewWindow -PassThru -RedirectStandardOutput (Join-Path $OutDir "$configName.$tag.log") `
        -RedirectStandardError (Join-Path $OutDir "$configName.$tag.err.log")
    return [pscustomobject]@{ Process = $process; Artifact = $artifact; Config = $configName; Tag = $tag; Started = Get-Date }
}

function Complete-Solve($run) {
    $run.Process.WaitForExit()
    $wall = ((Get-Date) - $run.Started).TotalSeconds
    if ($run.Process.ExitCode -ne 0 -or -not (Test-Path $run.Artifact)) {
        return [pscustomobject]@{ Config = $run.Config; Tag = $run.Tag; Failed = $true; ProcessWall = $wall }
    }
    $meta = & $EngineExe dump-json $run.Artifact --meta-only | ConvertFrom-Json
    $sizeGb = (Get-Item $run.Artifact).Length / 1GB
    Remove-Item -Force $run.Artifact   # multi-GB each; the numbers are what we keep
    return [pscustomobject]@{
        Config = $run.Config; Tag = $run.Tag; Failed = $false
        Threads = $meta.threads; Iterations = $meta.iterations
        Solve = [double]$meta.wall_time_s; Setup = [double]$meta.setup_time_s
        Export = [double]$meta.export_time_s; ProcessWall = $wall
        ExploitablePct = $meta.solved.last_exploitable_pct_pot; Reached = $meta.solved.reached
        PeakGb = [double]$meta.peak_rss_bytes / 1GB; ArtifactGb = $sizeGb
        Decisions = $meta.decision_node_count
    }
}

function Format-Row($r, $label) {
    if ($r.Failed) { return "| $($r.Config) | $label | FAILED (see $OutDir\$($r.Config).$($r.Tag).err.log) | | | | | | |" }
    return ("| {0} | {1} | {2:N1} | {3:N1} | {4:N1} | {5} | {6:N3} | {7:N1} | {8:N2} |" -f `
        $r.Config, $label, $r.Solve, $r.Export, $r.ProcessWall, $r.Iterations, `
        [double]$r.ExploitablePct, $r.PeakGb, $r.ArtifactGb)
}

$header = @(
    "| config | threads | solve s | export s | process wall s | iterations | exploitable % pot | peak GB | artifact GB |",
    "|---|---|---|---|---|---|---|---|---|"
)
$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("## htsolver bench - $machine")
$lines.Add("")
$lines.Add("engine: $((& $EngineExe version) -join ' ')")
$lines.Add("")

# --- 1. Thread sweep -----------------------------------------------------------
# Results are bitwise identical at any thread count, so iterations must not
# move down a column: only the seconds do.
$counts = @(1, 2, 4, 8, 10, 16, 20, 32, 40, 64) | Where-Object { $_ -le $logical }
if ($counts -notcontains $logical) { $counts += $logical }
$sweepConfigs = if ($Full) { @("hh_small", "hh_medium", "hh_large") } else { @("hh_medium") }
$lines.Add("### Thread scaling")
$lines.AddRange([string[]]$header)
$baseline = @{}
foreach ($name in $sweepConfigs) {
    foreach ($t in $counts) {
        Write-Host "solving $name at $t thread(s)..."
        $r = Complete-Solve (Start-Solve $name $t "t$t")
        if (-not $r.Failed -and -not $baseline.ContainsKey($name)) { $baseline[$name] = $r.Solve }
        $label = "$t"
        if (-not $r.Failed -and $baseline[$name]) { $label = "{0} ({1:N2}x)" -f $t, ($baseline[$name] / $r.Solve) }
        $lines.Add((Format-Row $r $label))
    }
}
$lines.Add("")

# --- 2. Every spot at full width ---------------------------------------------
if (-not $Full) {
    $lines.Add("### Every spot, all $logical threads")
    $lines.AddRange([string[]]$header)
    foreach ($name in @("hh_small", "hh_large")) {
        Write-Host "solving $name at $logical threads..."
        $lines.Add((Format-Row (Complete-Solve (Start-Solve $name $logical "all")) "$logical"))
    }
    $lines.Add("")
}

# --- 3. One solve per socket -------------------------------------------------
# The engine has no NUMA awareness. If a solve stops scaling past one socket's
# threads, two solves side by side, each kept on its own socket and its own
# memory, is the throughput answer. Windows numbers a single processor
# group's logical processors socket by socket, so the masks are contiguous.
if ($cpus.Count -ge 2 -and $logical -le 64) {
    $lines.Add("### Two solves at once, one pinned per socket (hh_medium)")
    $lines.AddRange([string[]]$header)
    $perSocket = [int]$cpus[0].NumberOfLogicalProcessors
    $runs = @()
    for ($s = 0; $s -lt 2; $s++) {
        $run = Start-Solve "hh_medium" $perSocket "socket$s"
        $mask = [int64]0
        for ($b = $s * $perSocket; $b -lt ($s + 1) * $perSocket; $b++) { $mask = $mask -bor ([int64]1 -shl $b) }
        try { $run.Process.ProcessorAffinity = [IntPtr]$mask } catch { Write-Host "could not pin socket ${s}: $_" }
        $runs += $run
    }
    Write-Host "solving hh_medium twice, one per socket..."
    $pair = $runs | ForEach-Object { Complete-Solve $_ }
    for ($s = 0; $s -lt 2; $s++) { $lines.Add((Format-Row $pair[$s] "$perSocket on socket $s")) }
    $ok = @($pair | Where-Object { -not $_.Failed })
    if ($ok.Count -eq 2) {
        $slowest = ($ok | Measure-Object ProcessWall -Maximum).Maximum
        $lines.Add("")
        $lines.Add(("Two pinned solves finished in {0:N1} s, which is {1:N1} solves per minute." -f $slowest, (120 / $slowest)))
    }
    $lines.Add("")
} elseif ($logical -gt 64) {
    $lines.Add("More than 64 logical processors: Windows splits them into processor groups, which this script does not pin across.")
}

$report = Join-Path $OutDir "bench-$($env:COMPUTERNAME.ToLower()).md"
$lines | Set-Content -Path $report -Encoding utf8
Write-Host ""
$lines | ForEach-Object { Write-Host $_ }
Write-Host "`nSaved to $report - paste that file back."
