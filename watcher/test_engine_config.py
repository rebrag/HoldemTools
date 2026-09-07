"""Tests for the engine config the compare watcher hands to htsolver.
Run directly: python test_engine_config.py

`prepare_engine_config` is where the watcher's own policy lands on a job's
config - artifact path, time budget, stop file, and whether the solve is
checkpointed. The checkpoint rule is the one with teeth: the engine refuses
`output.checkpoint_dir` for the vectorized core, so opting a heads-up
postflop job in turns it into a config error before it solves anything.
That is exactly what broke /compare once ENGINE_CHECKPOINT_DIR was set for
the multiway solves, and this file keeps it from coming back.

Stdlib only, no framework, exits non-zero on the first failure - same shape
as test_cancel.py.
"""

from __future__ import annotations

import copy
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# The module reaches for these at import time; nothing here contacts an API.
os.environ.setdefault("HOLDEMTOOLS_API_BASE", "http://localhost:1")
os.environ.setdefault("WATCHER_API_KEY", "unused")

import engine_compare_watcher as w  # noqa: E402
from engine_compare_watcher import prepare_engine_config, solver_family  # noqa: E402

failures = 0
RUN_DIR = "C:\\tmp\\htsolver_job_x" if os.name == "nt" else "/tmp/htsolver_job_x"
CKPT = "C:/Users/x/.holdemtools/checkpoints"

# A heads-up postflop /compare job: no algorithm.family at all, which the
# engine reads as vectorized.
HU_POSTFLOP = {
    "schema": 1, "game": "nlhe", "board": "Ks 3h 7c", "pot": 500,
    "players": [{"seat": "BB", "stack": 5000, "range": "AA"},
                {"seat": "BTN", "stack": 5000, "range": "KK"}],
    "algorithm": {"update": "dcfr"},
    "budget": {"iterations": 2000},
    "output": {"strategy_quantize_u8": False, "ev_float32": True, "rollups_169": False},
}
# A /multiway pushfold job on the sampled core.
MULTIWAY = {
    "schema": 1, "game": "nlhe_preflop", "chip_scale": 2.0,
    "players": [{"seat": s, "stack": 20, "range": "@file:ranges/full.txt"}
                for s in ("SB", "BB", "CO", "BTN")],
    "algorithm": {"family": "sampled", "update": "dcfr"},
    "budget": {"iterations": 400000},
    "output": {"strategy_quantize_u8": True, "ev_float32": True, "rollups_169": True},
}


def check(ok: bool, what: str) -> None:
    global failures
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        failures += 1


def test_solver_family() -> None:
    print("solver_family")
    check(solver_family(HU_POSTFLOP) == "vectorized", "no family reads as vectorized (engine default)")
    check(solver_family({}) == "vectorized", "no algorithm block at all is vectorized")
    check(solver_family({"algorithm": {"family": "vectorized"}}) == "vectorized", "explicit vectorized")
    check(solver_family(MULTIWAY) == "sampled", "sampled is sampled")
    check(solver_family({"algorithm": "bogus"}) == "vectorized", "a malformed block is not a crash")


def test_vectorized_jobs_are_never_checkpointed() -> None:
    print("prepare_engine_config: vectorized core")
    cfg = copy.deepcopy(HU_POSTFLOP)
    prepare_engine_config(cfg, RUN_DIR, checkpoint_dir=CKPT)
    check("checkpoint_dir" not in cfg["output"],
          "a heads-up postflop job gets no checkpoint_dir even with the directory set")
    check("checkpoint_path" not in cfg["output"], "and no checkpoint_path")
    check(cfg["output"]["strategy_quantize_u8"] is False, "the job's own output flags survive")

    # An explicit checkpoint_path in the job config is the job's request, not
    # the watcher's; it is passed through untouched and the engine will say no.
    cfg = copy.deepcopy(HU_POSTFLOP)
    cfg["output"]["checkpoint_path"] = "x.htck"
    prepare_engine_config(cfg, RUN_DIR, checkpoint_dir=CKPT)
    check(cfg["output"]["checkpoint_path"] == "x.htck" and "checkpoint_dir" not in cfg["output"],
          "an explicit checkpoint_path is left to the engine to judge")


def test_sampled_jobs_opt_in() -> None:
    print("prepare_engine_config: sampled core")
    cfg = copy.deepcopy(MULTIWAY)
    prepare_engine_config(cfg, RUN_DIR, checkpoint_dir=CKPT)
    check(cfg["output"].get("checkpoint_dir") == CKPT, "a multiway job is checkpointed under the directory")

    cfg = copy.deepcopy(MULTIWAY)
    prepare_engine_config(cfg, RUN_DIR, checkpoint_dir="C:\\ckpt\\dir")
    check(cfg["output"]["checkpoint_dir"] == "C:/ckpt/dir", "backslashes are normalized for the engine")

    cfg = copy.deepcopy(MULTIWAY)
    prepare_engine_config(cfg, RUN_DIR, checkpoint_dir="")
    check("checkpoint_dir" not in cfg["output"], "no directory, no checkpoint - the documented default")

    cfg = copy.deepcopy(MULTIWAY)
    cfg["output"]["checkpoint_path"] = "named.htck"
    prepare_engine_config(cfg, RUN_DIR, checkpoint_dir=CKPT)
    check("checkpoint_dir" not in cfg["output"] and cfg["output"]["checkpoint_path"] == "named.htck",
          "a job that names its own checkpoint file is not also given the directory")


def test_compare_second_core_is_never_resumed() -> None:
    print("run_engine: a compare job's sampled-core run starts from zero")
    # The sampled config /compare queues beside its vectorized one. The engine
    # would happily checkpoint it (sampled family), and prepare_engine_config
    # would opt it in under ENGINE_CHECKPOINT_DIR - but a convergence-speed
    # run resumed from last time's checkpoint "converges" instantly, so the
    # call site passes an empty directory for that run and nothing else.
    cfg = copy.deepcopy(HU_POSTFLOP)
    cfg["algorithm"] = {"family": "sampled", "sampled": {"seed": 1, "batch": 4096, "lanes": 4}}
    cfg["isomorphism"] = False
    prepare_engine_config(cfg, RUN_DIR, checkpoint_dir="")
    check("checkpoint_dir" not in cfg["output"] and "checkpoint_path" not in cfg["output"],
          "an empty checkpoint directory leaves the sampled postflop run un-checkpointed")
    check(cfg["budget"]["stop_file"] == os.path.join(RUN_DIR, "STOP").replace("\\", "/"),
          "it still gets a stop file, so Stop reaches the second run too")
    check(solver_family(cfg) == "sampled", "and it is the sampled core")
    # The same config under the default policy WOULD be checkpointed, which
    # is exactly why the compare path must not use the default.
    cfg = copy.deepcopy(HU_POSTFLOP)
    cfg["algorithm"] = {"family": "sampled"}
    prepare_engine_config(cfg, RUN_DIR, checkpoint_dir=CKPT)
    check(cfg["output"].get("checkpoint_dir") == CKPT,
          "under the default policy the same config is checkpointed")


def test_paths_and_budget() -> None:

    print("prepare_engine_config: artifact, budget, stop file")
    cfg = copy.deepcopy(HU_POSTFLOP)
    artifact = prepare_engine_config(cfg, RUN_DIR, checkpoint_dir=CKPT)
    check(artifact == os.path.join(RUN_DIR, "solve.hta"), "the artifact lives in the run dir")
    check(cfg["output"]["path"] == artifact.replace("\\", "/"), "and the engine is told with forward slashes")
    check(cfg["budget"]["stop_file"] == os.path.join(RUN_DIR, "STOP").replace("\\", "/"),
          "the stop file is per-run, inside the run dir")
    check(cfg["budget"]["iterations"] == 2000, "the job's iterations are untouched")
    engine_budget = max(60.0, w.SOLVE_TIMEOUT_SECS - w.SOLVE_WRITE_MARGIN_SECS)
    check(cfg["budget"]["max_seconds"] == engine_budget,
          "a job with no time budget gets the ceiling minus the write margin")

    cfg = copy.deepcopy(HU_POSTFLOP)
    cfg["budget"]["max_seconds"] = 30
    prepare_engine_config(cfg, RUN_DIR, checkpoint_dir=CKPT)
    check(cfg["budget"]["max_seconds"] == 30, "a smaller budget in the job wins")

    cfg = copy.deepcopy(HU_POSTFLOP)
    cfg["budget"]["max_seconds"] = engine_budget + 10_000
    prepare_engine_config(cfg, RUN_DIR, checkpoint_dir=CKPT)
    check(cfg["budget"]["max_seconds"] == engine_budget, "a larger one is capped so the kill never wins")

    cfg = copy.deepcopy(HU_POSTFLOP)
    del cfg["output"]
    del cfg["budget"]
    prepare_engine_config(cfg, RUN_DIR, checkpoint_dir=CKPT)
    check("path" in cfg["output"] and "stop_file" in cfg["budget"],
          "a job with no output or budget block gets both created")


if __name__ == "__main__":
    test_solver_family()
    test_vectorized_jobs_are_never_checkpointed()
    test_sampled_jobs_opt_in()
    test_compare_second_core_is_never_resumed()

    test_paths_and_budget()
    print("\n" + ("FAILED" if failures else "all engine config tests passed"))
    sys.exit(1 if failures else 0)
