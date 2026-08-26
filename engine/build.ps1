# Build entry point for the engine on Windows.
#
# cl/cmake/ninja are NOT on the ambient PATH on this machine. This script
# bootstraps the MSVC environment (vcvars64 via VsDevCmd.bat) and then drives
# CMake + Ninja. Never invoke cl, cmake, or ninja directly - always go
# through this script. See engine/CLAUDE.md.
#
# Usage:
#   ./build.ps1                    # configure + build (RelWithDebInfo)
#   ./build.ps1 -Test              # ... then run ctest
#   ./build.ps1 -Config Debug
#   ./build.ps1 -Clean             # delete build/ first
param(
    [ValidateSet("Debug", "Release", "RelWithDebInfo")]
    [string]$Config = "RelWithDebInfo",
    [switch]$Test,
    [switch]$Clean,
    [string]$Simd = "",            # override ENGINE_SIMD (AVX2 default in CMake)
    # Alternate output directory. Windows locks a running .exe, so a long
    # solve in build/ blocks relinking there; build elsewhere to verify a
    # change without killing the run.
    [string]$BuildDir = "build"
)

# "Continue", not "Stop": native tools (cmake, ninja) write warnings to
# stderr, and under stream redirection PowerShell 5.1 wraps those lines in
# ErrorRecords - a Stop preference would kill the build on a mere warning.
# Failures are handled explicitly through exit-code checks + throw instead.
$ErrorActionPreference = "Continue"
$engineDir = $PSScriptRoot
$buildDir = if ([System.IO.Path]::IsPathRooted($BuildDir)) { $BuildDir }
            else { Join-Path $engineDir $BuildDir }

# --- Locate Visual Studio with the C++ toolset ---------------------------
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) {
    throw "vswhere.exe not found at '$vswhere'. Install Visual Studio (or Build Tools) with the 'Desktop development with C++' workload."
}
$vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsPath) {
    throw "No Visual Studio installation with the C++ x64 toolset (Microsoft.VisualStudio.Component.VC.Tools.x86.x64) was found. Install the 'Desktop development with C++' workload."
}

# --- Import the MSVC environment (vcvars64 equivalent) --------------------
# Run VsDevCmd.bat in a cmd subshell and absorb the resulting environment.
if (-not $env:ENGINE_VSDEVCMD_DONE) {
    $vsDevCmd = Join-Path $vsPath "Common7\Tools\VsDevCmd.bat"
    if (-not (Test-Path $vsDevCmd)) {
        throw "VsDevCmd.bat not found at '$vsDevCmd'."
    }
    # VsDevCmd.bat internally shells out to vswhere.exe by bare name; put the
    # installer directory on PATH for the subshell so that lookup succeeds.
    $installerDir = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer"
    $envDump = cmd /c "set `"PATH=%PATH%;$installerDir`" && `"$vsDevCmd`" -arch=amd64 -no_logo && set"
    if ($LASTEXITCODE -ne 0) {
        throw "VsDevCmd.bat failed (exit $LASTEXITCODE)."
    }
    foreach ($line in $envDump) {
        if ($line -match '^([^=]+)=(.*)$') {
            Set-Item -Path "env:$($Matches[1])" -Value $Matches[2]
        }
    }
    $env:ENGINE_VSDEVCMD_DONE = "1"
}

foreach ($tool in "cl", "cmake", "ninja") {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "'$tool' is still not on PATH after VsDevCmd bootstrap. Check that the VS installation includes C++ CMake tools for Windows."
    }
}

# --- Configure + build ----------------------------------------------------
if ($Clean -and (Test-Path $buildDir)) {
    Remove-Item -Recurse -Force $buildDir
}

$cmakeArgs = @("-B", $buildDir, "-S", $engineDir, "-G", "Ninja", "-DCMAKE_BUILD_TYPE=$Config")
if ($Simd) { $cmakeArgs += "-DENGINE_SIMD=$Simd" }

cmake @cmakeArgs
if ($LASTEXITCODE -ne 0) { throw "CMake configure failed (exit $LASTEXITCODE)." }

cmake --build $buildDir
if ($LASTEXITCODE -ne 0) { throw "Build failed (exit $LASTEXITCODE)." }

if ($Test) {
    ctest --test-dir $buildDir --output-on-failure
    if ($LASTEXITCODE -ne 0) { throw "Tests failed (exit $LASTEXITCODE)." }
}

Write-Host "OK ($Config)"

