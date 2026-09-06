import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.adversarial_sweep import run_sweep, simulate_trial  # noqa: E402
from scripts.record_divergence import record_sample  # noqa: E402


def test_adversarial_sweep_produces_genuine_failures_at_small_perturbations():
    # 1. Test sub-threshold perturbation (1.0% shock < 3.0% threshold)
    quarantined, quality = simulate_trial(
        "NVDA", perturbation=0.01, is_single_source=True, staleness=0.0
    )
    # The guard MUST NOT quarantine sub-threshold shocks (genuine sensitivity limit)
    assert not quarantined, "A 1% shock is below the 3% jump threshold and must be accepted"
    assert quality == "QUALIFIED"

    # 2. Test super-threshold perturbation (10.0% shock > 3.0% threshold)
    quarantined_10, quality_10 = simulate_trial(
        "NVDA", perturbation=0.10, is_single_source=True, staleness=0.0
    )
    # Single-source super-threshold shock MUST be quarantined
    assert quarantined_10
    assert quality_10 == "INSUFFICIENT_EVIDENCE"

    # 3. Test sweep output
    result = run_sweep()
    assert result["summary"]["small_perturbation_failure_detected"] is True
    assert result["summary"]["total_trials"] > 0
    assert len(result["roc_points"]) > 0


def test_live_divergence_logger_appends_valid_jsonl(tmp_path):
    log_file = tmp_path / "divergence_test.jsonl"
    record = record_sample(symbol="NVDA", output_path=log_file, offline_fallback=True)

    assert log_file.exists()
    assert record["symbol"] == "NVDA"
    assert "hyperliquid_oracle" in record["sources"]
    assert "xstocks" in record["sources"]
    assert "ondo" in record["sources"]
    assert record["max_divergence_bps"] >= 0.0
    assert record["status"] in ("HEALTHY", "DEGRADED", "DROPOUT")

    lines = log_file.read_text().splitlines()
    assert len(lines) == 1
    loaded = json.loads(lines[0])
    assert loaded["symbol"] == "NVDA"
