# Roll a new version of the htsolver worker out on this box.
#
# The worker is a long-lived Python process, so pulling new code changes
# nothing until it restarts. This script pulls, rebuilds what changed, lets
# the in-flight solve finish (a drain, not a kill), and starts it again.
#
# Usage (elevated PowerShell):
#   C:\HoldemTools\watcher\deploy\update.ps1
#   C:\HoldemTools\watcher\deploy\update.ps1 -DrainTimeoutMinutes 5 -NoPull
param(
    [string]$TaskName = "HoldemTools htsolver worker",
    # How long to wait for the running solve before stopping the task anyway.
    [int]$DrainTimeoutMinutes = 40,
    # Restart on the code already checked out (after copying files by hand).
    [switch]$NoPull,
    # Rebuild the engine even if engine/ did not change.
    [switch]$ForceEngineBuild
)

$ErrorActionPreference = "Stop"
function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "ERROR: $text" -ForegroundColor Red; exit 1 }

$watcherDir = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $watcherDir
$engineDir = Join-Path $repoRoot "engine"
$venvPython = Join-Path $watcherDir ".venv-ht\Scripts\python.exe"
$envFile = Join-Path $watcherDir ".env"

# Read ONE non-secret key out of .env without echoing the file.
function Get-EnvValue($name, $default) {
    if (-not (Test-Path $envFile)) { return $default }
    $line = Select-String -Path $envFile -Pattern "^\s*$name\s*=\s*(.+)$" | Select-Object -First 1
    if ($line) { return $line.Matches[0].Groups[1].Value.Trim() }
    return $default
}

# --- 1. Pull ---------------------------------------------------------------
Step "Code"
$before = (git -C $repoRoot rev-parse HEAD).Trim()
if (-not $NoPull) {
    git -C $repoRoot pull --ff-only
    if ($LASTEXITCODE -ne 0) { Fail "git pull --ff-only failed. Resolve it by hand (this box should carry no local commits)." }
}
$after = (git -C $repoRoot rev-parse HEAD).Trim()
Write-Host "$before -> $after"
$changed = @()
if ($before -ne $after) { $changed = git -C $repoRoot diff --name-only $before $after }
$engineChanged = $ForceEngineBuild -or ($changed | Where-Object { $_ -like "engine/*" })
$requirementsChanged = $changed | Where-Object { $_ -eq "watcher/requirements-ht.txt" }

if ($requirementsChanged) {
    Step "Python packages"
    & $venvPython -m pip install --quiet -r (Join-Path $watcherDir "requirements-ht.txt")
    if ($LASTEXITCODE -ne 0) { Fail "pip install failed." }
}

# --- 2. Drain the worker ---------------------------------------------------
Step "Drain"
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) { Fail "Scheduled task '$TaskName' is not registered. Run install.ps1 first." }
$workDir = Get-EnvValue "HT_WORK_DIR" (Join-Path $watcherDir "work")
$drainFile = Get-EnvValue "HT_DRAIN_FILE" (Join-Path $workDir "DRAIN")
if ($task.State -eq "Running") {
    # The worker stops claiming when this file appears and exits once the
    # solve it is running has been published. Windows locks a running .exe,
    # so the engine cannot be rebuilt in place before that.
    New-Item -ItemType File -Force -Path $drainFile | Out-Null
    $deadline = (Get-Date).AddMinutes($DrainTimeoutMinutes)
    while ((Get-ScheduledTask -TaskName $TaskName).State -eq "Running" -and (Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 5
    }
    if ((Get-ScheduledTask -TaskName $TaskName).State -eq "Running") {
        Write-Host "Still running after $DrainTimeoutMinutes min; stopping it. The API re-queues its job." -ForegroundColor Yellow
        Stop-ScheduledTask -TaskName $TaskName
        Start-Sleep -Seconds 5
    } else {
        Write-Host "Drained cleanly."
    }
} else {
    Write-Host "Worker was not running."
}
Remove-Item -Force -ErrorAction SilentlyContinue $drainFile

# --- 3. Engine -------------------------------------------------------------
if ($engineChanged) {
    Step "Engine"
    $configured = Get-EnvValue "ENGINE_EXE" ""
    $builtHere = Join-Path $engineDir "build\engine.exe"
    if ($configured -and ((Resolve-Path $configured -ErrorAction SilentlyContinue).Path -ne (Resolve-Path $builtHere -ErrorAction SilentlyContinue).Path)) {
        Write-Host ("engine/ changed, but ENGINE_EXE points at a copied binary ($configured). " +
                    "Replace that file with the new build before relying on this update.") -ForegroundColor Yellow
    } else {
        & (Join-Path $engineDir "build.ps1")
        if ($LASTEXITCODE -ne 0) { Fail "engine/build.ps1 failed; the worker is stopped. Fix the build, then run this script again with -NoPull -ForceEngineBuild." }
        & $builtHere version
    }
}

# --- 4. Start --------------------------------------------------------------
Step "Start"
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3
$state = (Get-ScheduledTask -TaskName $TaskName).State
Write-Host "Task state: $state"
if ($state -ne "Running") { Fail "The worker did not stay up. Check the log under HT_LOG_DIR." }
