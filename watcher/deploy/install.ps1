# Install (or repair) the headless htsolver worker on a Windows box.
#
# Idempotent: run it again after a failed step and it picks up where it left
# off. It never prints, overwrites or uploads a secret - the only file that
# holds any is watcher\.env, which this script creates EMPTY of secrets when
# it does not exist and leaves alone when it does.
#
# Usage (elevated PowerShell, from anywhere):
#   C:\HoldemTools\watcher\deploy\install.ps1
#   C:\HoldemTools\watcher\deploy\install.ps1 -EnginePath D:\drop\engine.exe
#   C:\HoldemTools\watcher\deploy\install.ps1 -DataDir D:\htsolver -SkipTask
#
# See watcher/deploy/README.md for the whole runbook.
param(
    # A prebuilt engine.exe to use instead of building one here. Needs the
    # VC++ 2015-2022 x64 runtime on the box, which this script checks.
    [string]$EnginePath = "",
    # Where artifacts, per-job scratch and logs live. Wants a big disk: the
    # artifact store is an LRU cache of multi-GB files.
    [string]$DataDir = "C:\ProgramData\HoldemTools\htsolver",
    [string]$TaskName = "HoldemTools htsolver worker",
    # The account the worker runs as. LOCAL SERVICE has no password to manage,
    # no interactive logon and no rights beyond what is granted below.
    [string]$ServiceAccount = "NT AUTHORITY\LOCAL SERVICE",
    # Install everything but do not register the scheduled task.
    [switch]$SkipTask
)

$ErrorActionPreference = "Stop"

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "ERROR: $text" -ForegroundColor Red; exit 1 }

$watcherDir = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $watcherDir
$engineDir = Join-Path $repoRoot "engine"
$venvDir = Join-Path $watcherDir ".venv-ht"
$venvPython = Join-Path $venvDir "Scripts\python.exe"
$envFile = Join-Path $watcherDir ".env"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = (New-Object Security.Principal.WindowsPrincipal $identity).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Fail "Run this from an elevated PowerShell: it registers a scheduled task and sets folder permissions."
}
if ($repoRoot -like "$env:SystemDrive\Users\*") {
    Write-Host ("WARNING: the repo is under a user profile ($repoRoot). $ServiceAccount cannot read " +
                "another user's profile by default; clone to a path like C:\HoldemTools instead.") -ForegroundColor Yellow
}

# --- 1. Python -------------------------------------------------------------
Step "Python"
$python = $null
foreach ($candidate in @(@("py", "-3"), @("python"))) {
    try {
        $exe = $candidate[0]
        $rest = @($candidate | Select-Object -Skip 1)
        $version = & $exe @rest -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null
        if ($LASTEXITCODE -eq 0 -and $version) {
            $parts = $version.Trim().Split(".")
            if ([int]$parts[0] -eq 3 -and [int]$parts[1] -ge 11) { $python = $candidate; break }
        }
    } catch { }
}
if (-not $python) {
    Fail "Python 3.11 or newer was not found. Install it for all users from python.org (tick 'Add python.exe to PATH'), then re-run."
}
Write-Host "Using: $($python -join ' ') (Python $version)"

if (-not (Test-Path $venvPython)) {
    $exe = $python[0]
    $rest = @($python | Select-Object -Skip 1)
    & $exe @rest -m venv $venvDir
    if ($LASTEXITCODE -ne 0) { Fail "Could not create the virtual environment at $venvDir." }
}
& $venvPython -m pip install --quiet --upgrade pip
& $venvPython -m pip install --quiet -r (Join-Path $watcherDir "requirements-ht.txt")
if ($LASTEXITCODE -ne 0) { Fail "pip install failed. Check the box can reach pypi.org." }
Write-Host "Virtual environment ready: $venvDir"

# --- 2. The engine binary --------------------------------------------------
Step "Engine"
if ($EnginePath) {
    if (-not (Test-Path $EnginePath)) { Fail "-EnginePath '$EnginePath' does not exist." }
    $engineExe = (Resolve-Path $EnginePath).Path
    $missing = @("vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll") |
        Where-Object { -not (Test-Path (Join-Path $env:SystemRoot "System32\$_")) }
    if ($missing) {
        Fail ("A prebuilt engine.exe needs the Microsoft Visual C++ 2015-2022 x64 runtime, and these are missing: " +
              ($missing -join ", ") + ". Install vc_redist.x64.exe from Microsoft, then re-run.")
    }
} else {
    # engine/build.ps1 is the only supported way to build on Windows: it
    # finds Visual Studio (or the Build Tools) and bootstraps the toolchain.
    & (Join-Path $engineDir "build.ps1")
    if ($LASTEXITCODE -ne 0) {
        Fail ("engine/build.ps1 failed. It needs 'Build Tools for Visual Studio 2022' with the " +
              "'Desktop development with C++' workload, or pass -EnginePath to use a prebuilt binary.")
    }
    $engineExe = Join-Path $engineDir "build\engine.exe"
}
$engineVersion = & $engineExe version
if ($LASTEXITCODE -ne 0) { Fail "engine.exe did not run ($engineExe). On a prebuilt binary that usually means the VC++ runtime or an AVX2 CPU is missing." }
Write-Host "Engine: $engineExe ($($engineVersion -join ' '))"

# --- 3. Data directories ---------------------------------------------------
Step "Data directories"
$artifactDir = Join-Path $DataDir "artifacts"
$workDir = Join-Path $DataDir "work"
$logDir = Join-Path $DataDir "logs"
foreach ($dir in @($DataDir, $artifactDir, $workDir, $logDir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
}
# The worker writes only under DataDir; everything else it needs is read-only.
icacls $DataDir /grant "${ServiceAccount}:(OI)(CI)M" /T /Q | Out-Null
icacls $repoRoot /grant "${ServiceAccount}:(OI)(CI)RX" /T /Q | Out-Null
$freeGb = [math]::Round((Get-PSDrive -Name $DataDir.Substring(0, 1)).Free / 1GB)
Write-Host "Data directory: $DataDir ($freeGb GB free on that drive)"

# --- 4. .env ---------------------------------------------------------------
Step ".env"
if (Test-Path $envFile) {
    Write-Host "watcher\.env already exists; leaving it untouched."
} else {
    $budgetGb = [math]::Max(20, [math]::Min(200, [math]::Floor($freeGb * 0.6)))
    $template = @"
# htsolver worker settings. Fill in the three values marked REQUIRED.
# This file is gitignored and readable only by Administrators and the worker
# account. Never paste its contents anywhere.

# REQUIRED: the API the worker claims jobs from.
HOLDEMTOOLS_API_BASE=
# REQUIRED: the shared watcher key (App Service setting Watcher__ApiKey).
WATCHER_API_KEY=
# REQUIRED: storage account connection string (Portal > Access keys).
AZURE_STORAGE_CONNECTION_STRING=
AZURE_STORAGE_CONTAINER=onlinerangedata

# Names this box's artifact store. Keep it if the machine is ever replaced.
WATCHER_ID=$($env:COMPUTERNAME.ToLower())

ENGINE_EXE=$engineExe
HT_ARTIFACT_DIR=$artifactDir
HT_ARTIFACT_MAX_GB=$budgetGb
HT_WORK_DIR=$workDir
HT_LOG_DIR=$logDir

# One solve at a time on every hardware thread. On a two-socket box, compare
# against two slots pinned one per NUMA node (see deploy/README.md):
#HT_SOLVE_SLOTS=2
#HT_THREADS=20
#HT_SLOT_AFFINITY=0-19;20-39
"@
    # No byte-order mark: Windows PowerShell's "-Encoding utf8" writes one,
    # and python-dotenv would read it as part of the first line.
    [IO.File]::WriteAllText($envFile, $template + "`r`n", (New-Object Text.UTF8Encoding $false))
    Write-Host "Created watcher\.env with empty secrets. Fill in the three REQUIRED values."
}
# Secrets: Administrators and the worker account only.
icacls $envFile /inheritance:r /grant:r "BUILTIN\Administrators:F" "NT AUTHORITY\SYSTEM:F" "${ServiceAccount}:R" /Q | Out-Null

# --- 5. Scheduled task -----------------------------------------------------
if ($SkipTask) {
    Step "Scheduled task skipped (-SkipTask)"
} else {
    Step "Scheduled task"
    $action = New-ScheduledTaskAction -Execute $venvPython `
        -Argument "-u ht_solve_watcher.py" -WorkingDirectory $watcherDir
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId $ServiceAccount -LogonType ServiceAccount
    # No time limit (it is a service), restart if it ever exits non-zero, and
    # never start a second copy: two workers would share one artifact store.
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
        -StartWhenAvailable -MultipleInstances IgnoreNew `
        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
        -Principal $principal -Settings $settings -Force | Out-Null
    Write-Host "Registered '$TaskName': starts at boot, no logon needed, restarts on failure."
}

Step "Next"
Write-Host @"
1. Edit $envFile and fill in the three REQUIRED values.
2. Measure this box before trusting a solve time:   $PSScriptRoot\bench.ps1
3. Start the worker:                                Start-ScheduledTask -TaskName '$TaskName'
4. Watch it:                                        Get-Content '$logDir\ht_solve_watcher.log' -Tail 40 -Wait
"@
