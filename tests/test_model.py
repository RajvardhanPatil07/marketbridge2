"""Tests for Stage 3 overnight-specific beta, explainable factor updates, and split-conformal bands."""

from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT))

from marketbridge.engine import Engine  # noqa: E402
from scripts.evaluate import evaluate_three_way_ladder  # noqa: E402
from scripts.fit_beta import run_beta_fitting  # noqa: E402


def test_fit_overnight_beta_produces_valid_manifest_and_iex_label():
    manifest = run_beta_fitting()
    assert manifest["open_price_source"] == "IEX-derived open (not official exchange opening auction)"
    assert manifest["model_version"] == "overnight-ridge-conformal-v1"
    assert "NVDA" in manifest["symbols"]
    assert "TSLA" in manifest["symbols"]

    nvda_meta = manifest["symbols"]["NVDA"]
    assert nvda_meta["beta_cto"] > 0
    assert nvda_meta["sector_prior"] == 1.15
    assert nvda_meta["train_samples"] > 0
    assert nvda_meta["test_samples"] > 0
    assert "q_80" in nvda_meta["conformal_quantiles"]
    assert "q_90" in nvda_meta["conformal_quantiles"]
    assert "q_95" in nvda_meta["conformal_quantiles"]
    assert len(manifest["sha256"]) == 64


def test_engine_explainable_beta_update_rule():
    base = 182.5
    beta = 1.50
    engine = Engine("NVDA", initial_price=base, beta=beta)

    # Initialize at t=0
    engine.process(
        {
            "kind": "observation",
            "id": "qqq:0",
            "source_id": "qqq",
            "received_at": 0.0,
            "event_time": 0.0,
            "price": 480.0,
            "representation": "USD_SHARE",
        }
    )
    engine.process(
        {
            "kind": "observation",
            "id": "stock:0",
            "source_id": "iex",
            "received_at": 0.0,
            "event_time": 0.0,
            "price": base,
            "representation": "USD_SHARE",
        }
    )
    engine.process({"kind": "timer", "received_at": 0.0})
    snap0 = engine.snapshot(0, 0)
    assert snap0["reference"] == base

    # QQQ moves up by 2% (from 480 to 489.6)
    # Expected stock return = beta * 2% = 1.5 * 2% = 3%
    # Expected reference = 182.5 * (1 + 0.03) = 187.975
    engine.process(
        {
            "kind": "observation",
            "id": "qqq:1",
            "source_id": "qqq",
            "received_at": 1.0,
            "event_time": 1.0,
            "price": 489.6,
            "representation": "USD_SHARE",
        }
    )
    engine.process({"kind": "timer", "received_at": 1.0})
    snap1 = engine.snapshot(1, 1)
    assert snap1["reference"] == pytest.approx(182.5 * 1.03)
    assert snap1["beta"] == beta


def test_split_conformal_band_emits_coverage_width_and_samples():
    engine = Engine("NVDA", initial_price=182.5, target_coverage=0.90, calibration_samples=400)
    engine.process(
        {
            "kind": "observation",
            "id": "stock:0",
            "source_id": "iex",
            "received_at": 0.0,
            "event_time": 0.0,
            "price": 182.5,
            "representation": "USD_SHARE",
        }
    )
    engine.process({"kind": "timer", "received_at": 0.0})
    snap = engine.snapshot(0, 0)

    assert "band" in snap
    band = snap["band"]
    assert band["coverage"] == 0.90
    assert band["mean_width_bps"] > 0
    assert band["sample_count"] == 400
    assert "conformal_quantile_bps" in band
    assert "vol_scale" in band
    assert snap["lower"] < snap["reference"] < snap["upper"]


def test_three_way_baseline_ladder_evaluation():
    ladder = evaluate_three_way_ladder()
    assert ladder["open_price_source"] == "IEX-derived open (not official exchange opening auction)"
    assert "NVDA" in ladder["symbols"]

    nvda = ladder["symbols"]["NVDA"]
    assert "last_close" in nvda["ladder"]
    assert "beta_adjusted_factor" in nvda["ladder"]
    assert "marketbridge" in nvda["ladder"]

    # Beta-adjusted factor should improve MAE over stale last-close
    assert nvda["ladder"]["beta_adjusted_factor"]["mae_bps"] < nvda["ladder"]["last_close"]["mae_bps"]

    cov = nvda["split_conformal_coverage"]
    assert cov["nominal_80"]["nominal"] == 0.80
    assert 0.50 <= cov["nominal_80"]["empirical"] <= 1.00
    assert 0.70 <= cov["nominal_90"]["empirical"] <= 1.00
    assert 0.75 <= cov["nominal_95"]["empirical"] <= 1.00
    assert cov["mean_band_width_bps"] > 0
