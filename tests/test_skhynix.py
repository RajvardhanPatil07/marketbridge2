"""Tests verifying that the source-quality guard quarantines the real SK Hynix incident."""

import json
from pathlib import Path
import pytest

from marketbridge.engine import Engine


def test_skhynix_real_incident_quarantine_and_solvency_preservation():
    fixture_path = Path(__file__).resolve().parents[1] / "fixtures" / "skhynix_20260728.jsonl"
    assert fixture_path.exists(), "SK Hynix real incident fixture must exist"

    rows = [json.loads(line) for line in fixture_path.read_text().splitlines() if line]
    metadata = rows[0]
    assert metadata["kind"] == "metadata"
    assert metadata["scenario_id"] == "skhynix_20260728"
    assert metadata["data_mode"] == "REAL_INCIDENT_RECONSTRUCTION"
    assert metadata["prior_close"] == 1816000.0
    assert metadata["bad_print"] == 1272000.0

    engine = Engine("SKHYNIX", initial_price=1816000.0)
    steps: list[dict] = []
    truth: dict[int, float] = {}

    for row in rows[1:]:
        kind = row["kind"]
        if kind in ("observation", "timer"):
            engine.process(row)
            if kind == "timer":
                steps.append(engine.snapshot(len(steps), row["received_at"]))
        elif kind == "truth":
            truth[row["received_at"]] = row["price"]

    assert len(steps) == 151

    # 1. Normal state prior to t=30
    assert steps[0]["reference"] == pytest.approx(1816000.0, rel=1e-3)
    assert steps[29]["reference"] == pytest.approx(1816000.0, rel=1e-3)
    assert not steps[29]["simulation"]["reference_liquidated"]

    # 2. At t=30: Erroneous trade of 1,272,000 KRW printed (~29.96% drop)
    # The guard MUST quarantine the isolated uncorroborated print!
    step_30 = steps[30]
    assert step_30["assessment"] == "QUARANTINE"
    # Unguarded comparator drops to the bad print
    assert step_30["comparator"] == 1272000.0
    # Guarded reference DOES NOT take the 1.272M print!
    assert step_30["reference"] != 1272000.0

    # 3. Guard prevents catastrophic false liquidation
    # Baseline account tracking unguarded quote gets liquidated by the erroneous spike:
    assert step_30["simulation"]["baseline_liquidated"] is True
    # Reference account protected by MarketBridge remains solvent:
    for t in range(30, 120):
        assert steps[t]["simulation"]["reference_liquidated"] is False

    # 4. At t=120: Feed recovers to ~1.71M KRW with multi-source corroboration
    step_120 = steps[120]
    assert step_120["comparator"] == pytest.approx(1710000.0, rel=1e-2)
    assert not step_120["simulation"]["reference_liquidated"]
    # Final step at t=150 confirms recovery
    step_150 = steps[150]
    assert step_150["reference"] == pytest.approx(1710000.0, rel=1e-2)
    assert not step_150["simulation"]["reference_liquidated"]
