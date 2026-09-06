"""Run a rolling historical estimator backtest.

CSV columns: timestamp,price,market_return
The estimator is refit only on observations available before each prediction.
This script is separate from the synthetic functional replay suite.
"""
from __future__ import annotations
import argparse
import csv
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from marketbridge.estimator import fit_ridge  # noqa: E402


def load(path: Path):
    with path.open(newline="") as f:
        rows = list(csv.DictReader(f))
    if not rows or not {"timestamp", "price", "market_return"} <= set(rows[0]):
        raise ValueError("CSV needs timestamp,price,market_return columns")
    return rows


def run(rows, min_train: int, ridge: float):
    errors = []
    predictions = []
    for i in range(min_train, len(rows)):
        train = rows[:i]
        anchor = float(train[-1]["price"])
        samples = [
            ([float(r["market_return"])], math.log(float(r["price"]) / float(anchor)))
            for r in train
        ]
        model = fit_ridge(samples, l2=ridge)
        pred = anchor * math.exp(model.predict([float(rows[i]["market_return"])]))
        actual = float(rows[i]["price"])
        error_bps = (pred / actual - 1.0) * 10000
        errors.append(error_bps)
        predictions.append({"timestamp": rows[i]["timestamp"], "predicted": pred, "actual": actual, "error_bps": error_bps})
    mae = sum(abs(e) for e in errors) / len(errors) if errors else None
    rmse = math.sqrt(sum(e * e for e in errors) / len(errors)) if errors else None
    return {"samples": len(errors), "mae_bps": mae, "rmse_bps": rmse, "predictions": predictions}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("csv", type=Path)
    parser.add_argument("--min-train", type=int, default=30)
    parser.add_argument("--ridge", type=float, default=1.0)
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts" / "historical_backtest.json")
    args = parser.parse_args()
    result = run(load(args.csv), args.min_train, args.ridge)
    args.output.parent.mkdir(exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    print(json.dumps({k: v for k, v in result.items() if k != "predictions"}))
