"""Three-way baseline evaluation ladder: Last-Close vs Beta-Adjusted Factor vs MarketBridge.

Reports MAE/RMSE in bps, split-conformal band coverage at 80/90/95 nominal targets,
and generates a reliability diagram to artifacts/reliability.png.
"""

import hashlib
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT))

from marketbridge.engine import Engine  # noqa: E402
from marketbridge.evaluation import evaluate_all  # noqa: E402
from marketbridge.png_canvas import Canvas  # noqa: E402
from scripts.fit_beta import generate_historical_daily_bars  # noqa: E402


def evaluate_three_way_ladder() -> dict:
    """Evaluate Last-Close, Beta-Adjusted Factor, and MarketBridge across historical test bars."""
    bars_data = generate_historical_daily_bars(seed=42)
    qqq_bars = bars_data["QQQ"]
    n_total = len(qqq_bars)
    n_train = int(n_total * 0.70)

    # Use out-of-sample test split (last 30%)
    test_days = range(n_train, n_total)
    ladder_results = {}

    # Load fitted betas if available, or compute
    fitted_betas_file = ROOT / "artifacts" / "fitted_betas.json"
    betas_cache = {}
    if fitted_betas_file.exists():
        try:
            betas_cache = json.loads(fitted_betas_file.read_text()).get("symbols", {})
        except Exception:
            pass

    for sym in ["NVDA", "TSLA"]:
        sym_bars = bars_data[sym]
        beta_info = betas_cache.get(sym, {})
        beta_cto = beta_info.get("beta_cto", 1.1502 if sym == "NVDA" else 1.1506)
        conformal_quantiles = beta_info.get(
            "conformal_quantiles",
            {
                "q_80": 0.0132 if sym == "NVDA" else 0.0175,
                "q_90": 0.0194 if sym == "NVDA" else 0.0258,
                "q_95": 0.0255 if sym == "NVDA" else 0.0340,
            },
        )

        lc_errors, factor_errors, mb_errors = [], [], []
        cov_80_hits, cov_90_hits, cov_95_hits = 0, 0, 0
        mb_widths_bps = []

        q_80 = conformal_quantiles["q_80"]
        q_90 = conformal_quantiles["q_90"]
        q_95 = conformal_quantiles["q_95"]

        for d in test_days:
            close_prev = sym_bars[d]["close"]
            actual_open = sym_bars[d]["open_iex"]
            actual_return = (actual_open - close_prev) / close_prev
            r_qqq = qqq_bars[d]["r_cto"]

            # 1. Last-Close Baseline: predict prior close
            pred_lc = close_prev
            err_lc = abs(pred_lc - actual_open) / actual_open
            lc_errors.append(err_lc)

            # 2. Beta-Adjusted Factor Baseline: predict with overnight beta
            pred_factor = close_prev * (1.0 + beta_cto * r_qqq)
            err_factor = abs(pred_factor - actual_open) / actual_open
            factor_errors.append(err_factor)

            # 3. MarketBridge Model: guarded engine prediction + conformal band
            engine = Engine(sym, initial_price=close_prev, beta=beta_cto, conformal_q=q_90)
            # Initial stock and factor anchors at t=0
            engine.process(
                {
                    "kind": "observation",
                    "id": f"eval:qqq_init:{d}",
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
                    "id": f"eval:{sym}:{d}",
                    "source_id": "iex",
                    "received_at": 0.0,
                    "event_time": 0.0,
                    "price": close_prev,
                    "representation": "USD_SHARE",
                }
            )
            # Factor gap updates at t=1 (market opens)
            engine.process(
                {
                    "kind": "observation",
                    "id": f"eval:qqq_open:{d}",
                    "source_id": "qqq",
                    "received_at": 1.0,
                    "event_time": 1.0,
                    "price": 480.0 * (1.0 + r_qqq),
                    "representation": "USD_SHARE",
                }
            )
            engine.process({"kind": "timer", "received_at": 1.0})
            snap = engine.snapshot(0, 1)
            pred_mb = snap["reference"] if snap["reference"] is not None else pred_factor
            err_mb = abs(pred_mb - actual_open) / actual_open
            mb_errors.append(err_mb)

            # Check coverage across 80, 90, 95 conformal quantiles
            spread_80 = q_80
            spread_90 = snap["spread"]
            spread_95 = q_95

            if abs(actual_return) <= spread_80:
                cov_80_hits += 1
            if abs(actual_return) <= spread_90:
                cov_90_hits += 1
            if abs(actual_return) <= spread_95:
                cov_95_hits += 1

            mb_widths_bps.append(spread_90 * 20000.0)

        n_samples = len(test_days)

        def calc_metrics(err_list: list[float]) -> tuple[float, float]:
            mae = (sum(err_list) / len(err_list)) * 10000.0
            rmse = math.sqrt(sum(e * e for e in err_list) / len(err_list)) * 10000.0
            return round(mae, 2), round(rmse, 2)

        mae_lc, rmse_lc = calc_metrics(lc_errors)
        mae_factor, rmse_factor = calc_metrics(factor_errors)
        mae_mb, rmse_mb = calc_metrics(mb_errors)

        emp_cov_80 = round(cov_80_hits / n_samples, 3)
        emp_cov_90 = round(cov_90_hits / n_samples, 3)
        emp_cov_95 = round(cov_95_hits / n_samples, 3)
        mean_width_bps = round(sum(mb_widths_bps) / len(mb_widths_bps), 1)

        ladder_results[sym] = {
            "symbol": sym,
            "sample_count": n_samples,
            "fitted_beta": beta_cto,
            "ladder": {
                "last_close": {"mae_bps": mae_lc, "rmse_bps": rmse_lc},
                "beta_adjusted_factor": {"mae_bps": mae_factor, "rmse_bps": rmse_factor},
                "marketbridge": {"mae_bps": mae_mb, "rmse_bps": rmse_mb},
            },
            "split_conformal_coverage": {
                "nominal_80": {"nominal": 0.80, "empirical": emp_cov_80},
                "nominal_90": {"nominal": 0.90, "empirical": emp_cov_90},
                "nominal_95": {"nominal": 0.95, "empirical": emp_cov_95},
                "mean_band_width_bps": mean_width_bps,
            },
        }

    manifest = {
        "evaluation_kind": "three_way_baseline_ladder",
        "open_price_source": "IEX-derived open (not official exchange opening auction)",
        "model_version": "marketbridge-conformal-ladder-v1",
        "literature_reference": "Hendershott, Livdan & Rösch (JFE 2020)",
        "symbols": ladder_results,
    }

    # Deterministic SHA-256
    raw = json.dumps(manifest, sort_keys=True, indent=2)
    manifest["sha256"] = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return manifest


def render_reliability_diagram(evaluation_results: dict, output_path: Path) -> None:
    """Render reliability diagram comparing nominal vs empirical coverage to PNG."""
    width, height = 700, 480
    canvas = Canvas(width, height, bg_color=(15, 23, 42))  # slate-900

    x_offset, y_offset = 80, 50
    plot_w, plot_h = 560, 360

    # Grid
    grid_color = (30, 41, 59)
    axis_color = (100, 116, 139)
    for i in range(5):
        gx = x_offset + int(plot_w * (i / 4))
        gy = y_offset + int(plot_h * (i / 4))
        canvas.draw_line(gx, y_offset, gx, y_offset + plot_h, grid_color)
        canvas.draw_line(x_offset, gy, x_offset + plot_w, gy, grid_color)

    canvas.draw_line(x_offset, y_offset, x_offset, y_offset + plot_h, axis_color, width=2)
    canvas.draw_line(
        x_offset, y_offset + plot_h, x_offset + plot_w, y_offset + plot_h, axis_color, width=2
    )

    # Ideal calibration diagonal (y = x)
    diag_color = (148, 163, 184)  # slate-400
    canvas.draw_line(x_offset, y_offset + plot_h, x_offset + plot_w, y_offset, diag_color, width=1)

    # Plot empirical coverage points for symbols
    sym_colors = {
        "NVDA": ((59, 130, 246), (96, 165, 250)),  # blue-500, blue-400
        "TSLA": ((16, 185, 129), (52, 211, 153)),  # emerald-500, emerald-400
    }

    for sym, res in evaluation_results["symbols"].items():
        curve_col, dot_col = sym_colors.get(sym, ((245, 158, 11), (251, 191, 36)))
        cov_data = res["split_conformal_coverage"]

        points = [
            (0.0, 0.0),
            (0.80, cov_data["nominal_80"]["empirical"]),
            (0.90, cov_data["nominal_90"]["empirical"]),
            (0.95, cov_data["nominal_95"]["empirical"]),
            (1.0, 1.0),
        ]

        coords = [
            (x_offset + int(plot_w * pt[0]), y_offset + plot_h - int(plot_h * pt[1]))
            for pt in points
        ]

        for i in range(len(coords) - 1):
            canvas.draw_line(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1], curve_col, width=3)
            # Fill point dot
            canvas.fill_rect(coords[i][0] - 4, coords[i][1] - 4, coords[i][0] + 4, coords[i][1] + 4, dot_col)
        # End dot
        canvas.fill_rect(coords[-1][0] - 4, coords[-1][1] - 4, coords[-1][0] + 4, coords[-1][1] + 4, dot_col)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(canvas.to_png())
    print(f"Reliability diagram successfully saved to {output_path}")


if __name__ == "__main__":
    ladder_eval = evaluate_three_way_ladder()
    synthetic_eval = evaluate_all()

    combined_eval = {
        **ladder_eval,
        "synthetic_suite": synthetic_eval,
        "summary": synthetic_eval["summary"],
    }

    out_file = ROOT / "artifacts" / "evaluation.json"
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(json.dumps(combined_eval, indent=2) + "\n")
    print(f"Evaluation report successfully written to {out_file}")

    rel_png = ROOT / "artifacts" / "reliability.png"
    render_reliability_diagram(ladder_eval, rel_png)

    print("\n--- Three-Way Baseline Ladder Results ---")
    print(f"Open Source: {ladder_eval['open_price_source']}")
    for sym, data in ladder_eval["symbols"].items():
        print(f"\n{sym} (N={data['sample_count']}, fitted beta={data['fitted_beta']}):")
        print(f"  Last-Close:           MAE={data['ladder']['last_close']['mae_bps']} bps, RMSE={data['ladder']['last_close']['rmse_bps']} bps")
        print(f"  Beta-Adjusted Factor: MAE={data['ladder']['beta_adjusted_factor']['mae_bps']} bps, RMSE={data['ladder']['beta_adjusted_factor']['rmse_bps']} bps")
        print(f"  MarketBridge:         MAE={data['ladder']['marketbridge']['mae_bps']} bps, RMSE={data['ladder']['marketbridge']['rmse_bps']} bps")
        cov = data["split_conformal_coverage"]
        print(f"  Conformal Coverage:   80% -> {cov['nominal_80']['empirical']}, 90% -> {cov['nominal_90']['empirical']}, 95% -> {cov['nominal_95']['empirical']} (Mean width: {cov['mean_band_width_bps']} bps)")
