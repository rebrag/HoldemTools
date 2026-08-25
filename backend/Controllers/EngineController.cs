using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PokerRangeAPI2.Services.EngineArtifacts;

namespace PokerRangeAPI2.Controllers
{
    // Dev-only import endpoint for engine artifacts. All actions 404 unless
    // Engine:LocalSolutionsDir is configured, which never happens on a
    // deployed instance - this controller exists so a local dev loop can go
    // "engine solve -> POST import -> open /solutions" without touching ADLS.
    [ApiController]
    [Route("api/engine")]
    [Authorize]
    public class EngineController : ControllerBase
    {
        private readonly EngineLocalSolutions _local;
        private readonly IConfiguration _config;
        // One compare run at a time: each spawns htsolver plus a Pio process.
        private static readonly SemaphoreSlim CompareGate = new(1, 1);

        public EngineController(EngineLocalSolutions local, IConfiguration config)
        {
            _local = local;
            _config = config;
        }

        public class ImportRequestDto
        {
            public string ArtifactPath { get; set; } = "";
        }

        public class ImportResultDto
        {
            public string Stacks { get; set; } = "";
            public string NodeName { get; set; } = "";
            public string Board { get; set; } = "";
        }

        public class CompareRequestDto
        {
            /// <summary>The htsolver config, as the engine's JSON config schema.</summary>
            public JsonObject Config { get; set; } = new();
            /// <summary>Pio accuracy ("exploitable for") as % of the pot.</summary>
            public double PioAccuracyPct { get; set; } = 0.02;
        }

        // POST api/engine/compare - dev-only: solve the config with htsolver,
        // build + solve the identical tree in Pio (engine_compare.py
        // --solve-pio), and return the full per-hand comparison JSON that the
        // /compare page renders. Synchronous: a river spot takes seconds for
        // htsolver plus roughly Pio's solve time.
        [HttpPost("compare")]
        public async Task<IActionResult> Compare([FromBody] CompareRequestDto request,
                                                 CancellationToken ct)
        {
            if (!_local.Enabled) return NotFound();
            if (!await CompareGate.WaitAsync(0, ct))
                return Conflict("A compare run is already in progress.");
            try
            {
                var repoRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));
                var engineExe = Path.GetFullPath(
                    _config["Engine:ExePath"] ?? Path.Combine(repoRoot, "engine", "build", "engine.exe"));
                var watcherDir = Path.GetFullPath(
                    _config["Engine:WatcherDir"] ?? Path.Combine(repoRoot, "watcher"));
                var python = _config["Engine:PythonExe"] ?? "python";
                if (!System.IO.File.Exists(engineExe))
                    return Problem($"htsolver binary not found at {engineExe} - build it first (engine/build.ps1).");
                if (!System.IO.File.Exists(Path.Combine(watcherDir, "engine_compare.py")))
                    return Problem($"engine_compare.py not found under {watcherDir}.");

                var runDir = Path.Combine(Path.GetTempPath(), "htsolver_compare_" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(runDir);
                try
                {
                    // Force validation-friendly output flags; the caller only
                    // controls the spot and budget.
                    var config = request.Config;
                    config["output"] = new JsonObject
                    {
                        ["path"] = Path.Combine(runDir, "solve.hta").Replace('\\', '/'),
                        ["strategy_quantize_u8"] = false,
                        ["ev_float32"] = true,
                        ["rollups_169"] = false,
                    };
                    var configPath = Path.Combine(runDir, "config.json");
                    await System.IO.File.WriteAllTextAsync(configPath, config.ToJsonString(), ct);

                    var (engineExit, engineLog) = await RunProcessAsync(
                        engineExe, $"solve \"{configPath}\"", runDir, TimeSpan.FromMinutes(3), ct);
                    if (engineExit != 0)
                        return Problem($"htsolver solve failed (exit {engineExit}):\n{engineLog}");

                    var jsonOut = Path.Combine(runDir, "compare.json");
                    var harnessArgs =
                        $"-u engine_compare.py --artifact \"{Path.Combine(runDir, "solve.hta")}\" " +
                        $"--engine-exe \"{engineExe}\" --solve-pio " +
                        $"--pio-accuracy-pct {request.PioAccuracyPct} --top 0 --json-out \"{jsonOut}\"";
                    var (pioExit, pioLog) = await RunProcessAsync(
                        python, harnessArgs, watcherDir, TimeSpan.FromMinutes(10), ct);
                    if (!System.IO.File.Exists(jsonOut))
                        return Problem($"comparison failed (exit {pioExit}):\n{engineLog}\n{pioLog}");

                    var comparison = await System.IO.File.ReadAllTextAsync(jsonOut, ct);
                    return Content(
                        $"{{\"log\":{System.Text.Json.JsonSerializer.Serialize(engineLog + "\n" + pioLog)}," +
                        $"\"comparison\":{comparison}}}",
                        "application/json");
                }
                finally
                {
                    try { Directory.Delete(runDir, true); } catch { /* best effort */ }
                }
            }
            finally
            {
                CompareGate.Release();
            }
        }

        private static async Task<(int ExitCode, string Log)> RunProcessAsync(
            string fileName, string arguments, string workingDir, TimeSpan timeout,
            CancellationToken ct)
        {
            var psi = new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments,
                WorkingDirectory = workingDir,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            using var process = Process.Start(psi)!;
            var log = new StringBuilder();
            var pump = Task.WhenAll(
                PumpAsync(process.StandardOutput, log),
                PumpAsync(process.StandardError, log));
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(timeout);
            try
            {
                await process.WaitForExitAsync(cts.Token);
            }
            catch (OperationCanceledException)
            {
                try { process.Kill(entireProcessTree: true); } catch { /* already gone */ }
                log.AppendLine($"[timed out after {timeout.TotalSeconds:0}s or canceled]");
                return (-1, log.ToString());
            }
            await pump;
            return (process.ExitCode, log.ToString());
        }

        private static async Task PumpAsync(StreamReader reader, StringBuilder log)
        {
            string? line;
            while ((line = await reader.ReadLineAsync()) != null)
            {
                lock (log) log.AppendLine(line);
            }
        }

        // POST api/engine/import - convert a local .hta artifact into
        // schema-4 JSON under Engine:LocalSolutionsDir so the /solutions
        // viewer can render it.
        [HttpPost("import")]
        public async Task<ActionResult<ImportResultDto>> Import([FromBody] ImportRequestDto request,
                                                                CancellationToken ct)
        {
            if (!_local.Enabled) return NotFound();
            if (string.IsNullOrWhiteSpace(request.ArtifactPath) ||
                !System.IO.File.Exists(request.ArtifactPath))
            {
                return BadRequest($"Artifact not found: {request.ArtifactPath}");
            }

            var exporter = new EngineSolutionExporter();
            var result = await exporter.ExportAsync(request.ArtifactPath, _local.Root!, ct);
            return Ok(new ImportResultDto
            {
                Stacks = result.Stacks,
                NodeName = result.NodeName,
                Board = result.Board,
            });
        }
    }
}
