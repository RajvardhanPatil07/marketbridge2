"""Tests for Stage 4: Demo hardening, capture fixture, and project cleanups."""

import json
from pathlib import Path
import tempfile
from marketbridge.engine import Engine
from scripts.capture_fixture import capture_snapshot

ROOT = Path(__file__).resolve().parents[1]


def test_capture_fixture_creates_valid_replayable_jsonl():
    with tempfile.TemporaryDirectory() as tmpdir:
        out_path = Path(tmpdir) / "test_snapshot.jsonl"
        capture_snapshot(symbols=["NVDA", "TSLA"], duration_seconds=5, output_path=out_path)

        assert out_path.exists()
        lines = [json.loads(line) for line in out_path.read_text(encoding="utf-8").splitlines() if line]
        assert len(lines) > 0
        assert lines[0]["kind"] == "metadata"
        assert lines[0]["data_mode"] == "REPLAY"

        # Verify that an Engine can process the captured fixture
        engine = Engine(symbol="NVDA", initial_price=182.5)
        nvda_events = [row for row in lines[1:] if row.get("symbol") in (None, "NVDA")]
        step_idx = 0
        for event in nvda_events:
            engine.process(event)
            if event.get("kind") == "timer":
                snap = engine.snapshot(index=step_idx, seconds=event["received_at"])
                assert snap["reference"] is not None
                assert snap["quality"] in ("QUALIFIED", "CAUTION", "INSUFFICIENT_EVIDENCE")
                step_idx += 1


def test_metadata_files_cleaned_and_license_present():
    # Verify CLAUDE.md, AGENTS.md, .impeccable are removed
    assert not (ROOT / "CLAUDE.md").exists()
    assert not (ROOT / "AGENTS.md").exists()
    assert not (ROOT / ".impeccable").exists()
    assert not (ROOT / "apps/web/CLAUDE.md").exists()
    assert not (ROOT / "apps/web/AGENTS.md").exists()
    assert not (ROOT / "apps/web/.impeccable").exists()

    # Verify MIT LICENSE
    license_path = ROOT / "LICENSE"
    assert license_path.exists()
    license_text = license_path.read_text(encoding="utf-8")
    assert "MIT License" in license_text
    assert "2026" in license_text

    # Verify descriptions
    pyproject = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    assert "Off-hours reference pricing" in pyproject

    pkg_json = json.loads((ROOT / "apps/web/package.json").read_text(encoding="utf-8"))
    assert "description" in pkg_json
