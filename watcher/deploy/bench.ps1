# Measure what this box does with a recorded-hand flop solve.
#
# Run this BEFORE trusting any solve time on a new machine. It needs only
# engine.exe: no .env, no network, nothing uploaded. It solves the committed
# hand-history-shaped configs (engine/configs/bench/hh_*.json): the small
# spot (a real recorded hand's ranges) at several thread counts, the medium
# spot on every thread, then the small spot twice at once with each solve
# pinned to half the machine. It prints a table to paste back.
#
# Usage:
#   C:\HoldemTools\watcher\deploy\bench.ps1                 # about 15 minutes on a 2016 two-socket Xeon
#   C:\HoldemTools\watcher\deploy\bench.ps1 -Full           # every config at every count (hours)
#   C:\HoldemTools\watcher\deploy\bench.ps1 -Threads 8,16   # only these counts in the sweep
#   C:\HoldemTools\watcher\deploy\bench.ps1 -EngineExe D:\drop\engine.exe
param(
    [string]$EngineExe = "",
    [string]$OutDir = (Join-Path $env:TEMP "htsolver-bench"),
    # Sweep every config at every thread count, 1 and 2 threads included.
    [switch]$Full,
    # Thread counts for the sweep instead of the defaults.
    [int[]]$Threads = @(),
    # Only the thread sweep: skip the full-width and two-at-once sections.
    [switch]$SweepOnly
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
$logical = [int]($cpus | Measure-Object NumberOfLogicalProcessors -Sum).Sum
$cores = [int]($cpus | Measure-Object NumberOfCores -Sum).Sum
$ramGb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
$machine = "$($env:COMPUTERNAME): $($cpus.Count) x $($cpus[0].Name.Trim()), $cores cores / $logical threads, $ramGb GB"
Write-Host $machine

# --- One solve ---------------------------------------------------------------
# Returns the artifact's own metadata, which is where the engine records the
# solve loop, the export pass and the peak memory separately.
function Start-Solve($configName, $threads, $tag) {
    # The configs carry // comments, which the engine accepts and
    # ConvertFrom-Json in Windows PowerShell 5.1 does not.
    $text = (Get-Content (Join-Path $configDir "$configName.json") | Where-Object { $_ -notmatch '^\s*//' }) -join "`n"
    $config = $text | ConvertFrom-Json
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
    # Touch the handle now: without it, ExitCode reads as null after the
    # process has gone (a Start-Process -PassThru quirk).
    $null = $process.Handle
    return [pscustomobject]@{ Process = $process; Artifact = $artifact; Config = $configName; Tag = $tag; Started = Get-Date }
}

function Complete-Solve($run) {
    $run.Process.WaitForExit()
    $wall = ((Get-Date) - $run.Started).TotalSeconds
    if ($run.Process.ExitCode -ne 0 -or -not (Test-Path $run.Artifact)) {
        return [pscustomobject]@{ Config = $run.Config; Tag = $run.Tag; Failed = $true; ProcessWall = $wall }
    }
    $meta = (& $EngineExe dump-json $run.Artifact --meta-only --compact) -join "`n" | ConvertFrom-Json
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
#
# A single thread on the small spot is several minutes on a fast desktop and
# much longer on an old server core, so 1 and 2 threads are -Full only: the
# question this answers is where scaling stops, and it stops well above them.
$half = [int]($logical / 2)
if ($Threads.Count -gt 0) {
    $counts = @($Threads | Where-Object { $_ -ge 1 -and $_ -le $logical } | Sort-Object -Unique)
} elseif ($Full) {
    $counts = @(@(1, 2, 4, 8, 10, 16, 20, 32, 40, 64, $cores, $logical) | Where-Object { $_ -le $logical } | Sort-Object -Unique)
} else {
    $counts = @(@(4, 8, [int]($cores / 2), $cores, $half, $logical) | Where-Object { $_ -ge 1 -and $_ -le $logical } | Sort-Object -Unique)
}
$sweepConfigs = if ($Full) { @("hh_small", "hh_medium", "hh_large") } else { @("hh_small") }
$lines.Add("### Thread scaling")
$lines.AddRange([string[]]$header)
$baseline = @{}
foreach ($name in $sweepConfigs) {
    foreach ($t in $counts) {
        Write-Host "solving $name at $t thread(s)..."
        $r = Complete-Solve (Start-Solve $name $t "t$t")
        if (-not $r.Failed -and -not $baseline.ContainsKey($name)) { $baseline[$name] = @{ Solve = $r.Solve; Threads = $t } }
        $label = "$t"
        if (-not $r.Failed -and $baseline.ContainsKey($name)) {
            $label = "{0} ({1:N2}x of {2})" -f $t, ($baseline[$name].Solve / $r.Solve), $baseline[$name].Threads
        }
        $lines.Add((Format-Row $r $label))
    }
}
$lines.Add("")

# --- 2. A wider spot at full width ---------------------------------------------
# hh_small is a real recorded hand's ranges; hh_medium is the same panel on
# 40%-wide ranges, which is what a loose hand looks like. hh_large (-Full) is
# the slow tail.
if (-not $Full -and -not $SweepOnly) {
    $lines.Add("### The medium spot, all $logical threads")
    $lines.AddRange([string[]]$header)
    Write-Host "solving hh_medium at $logical threads..."
    $lines.Add((Format-Row (Complete-Solve (Start-Solve "hh_medium" $logical "all")) "$logical"))
    $lines.Add("")
}

# --- 3. Two solves at once, each on half the machine --------------------------
# The engine has no NUMA awareness. If a solve stops scaling past one socket's
# threads, two solves side by side, each kept on its own socket and its own
# memory, is the throughput answer. Windows numbers a single processor
# group's logical processors socket by socket (and core by core), so the two
# halves are contiguous masks; on a two-socket box a half IS a socket.
if ($SweepOnly) {
    # The sweep was all that was asked for.
} elseif ($logical -ge 4 -and $logical -le 64) {
    $what = if ($cpus.Count -ge 2) { "one pinned per socket" } else { "each pinned to half the cores" }
    $lines.Add("### Two solves at once, $what (hh_small)")
    $lines.AddRange([string[]]$header)
    $runs = @()
    for ($s = 0; $s -lt 2; $s++) {
        $run = Start-Solve "hh_small" $half "half$s"
        $mask = [int64]0
        for ($b = $s * $half; $b -lt ($s + 1) * $half; $b++) { $mask = $mask -bor ([int64]1 -shl $b) }
        try { $run.Process.ProcessorAffinity = [IntPtr]$mask } catch { Write-Host "could not pin half ${s}: $_" }
        $runs += $run
    }
    Write-Host "solving hh_small twice at once, $half threads each..."
    $pair = @($runs | ForEach-Object { Complete-Solve $_ })
    for ($s = 0; $s -lt 2; $s++) {
        $first = $s * $half
        $lines.Add((Format-Row $pair[$s] "$half on cpus $first-$($first + $half - 1)"))
    }
    $ok = @($pair | Where-Object { -not $_.Failed })
    if ($ok.Count -eq 2) {
        $slowest = ($ok | Measure-Object ProcessWall -Maximum).Maximum
        $lines.Add("")
        $lines.Add(("Two pinned solves finished in {0:N1} s, which is {1:N1} solves per minute." -f $slowest, (120 / $slowest)))
        $lines.Add("If a pinned solve is not much slower than one solve on all $logical threads above, set HT_SOLVE_SLOTS=2, HT_THREADS=$half and HT_SLOT_AFFINITY=0-$($half - 1);$half-$($logical - 1).")
    }
    $lines.Add("")
} else {
    $lines.Add("Skipped the two-at-once section: it needs 4 to 64 logical processors (above 64 Windows splits them into processor groups, which this script does not pin across).")
}

$report = Join-Path $OutDir "bench-$($env:COMPUTERNAME.ToLower()).md"
# No byte-order mark: the file is meant to be pasted.
[IO.File]::WriteAllLines($report, [string[]]$lines, (New-Object Text.UTF8Encoding $false))
Write-Host ""
$lines | ForEach-Object { Write-Host $_ }
Write-Host "`nSaved to $report - paste that file back."
