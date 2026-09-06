"""Tests for Stage 1 live weekend adapters, family corroboration, and run modes."""

import json
from unittest.mock import patch
import pytest

from marketbridge.adapters.base import (
    BaseAdapter,
    HealthTransition,
    ObservationPayload,
    compute_payload_hash,
)
from marketbridge.adapters.hyperliquid import HyperliquidAdapter
from marketbridge.adapters.solana_tokens import (
    SolanaTokenConfig,
    SolanaTokensAdapter,
    validate_mint_address,
)
from marketbridge.engine import Engine
from marketbridge.models import RUN_MODES, validate_run_mode


def test_base_adapter_observation_shape_and_hash():
    raw_payload = b'{"test": "payload_123"}'
    phash = compute_payload_hash(raw_payload)
    assert len(phash) == 64

    obs = ObservationPayload(
        id="hl:oracle:NVDA:1000",
        source_id="hyperliquid_oracle",
        source_family="hyperliquid_oracle",
        event_time=10.0,
        received_at=10.0,
        price=185.0,
        bid=184.9,
        ask=185.1,
        representation="USD_SHARE",
        payload_hash=phash,
        symbol="NVDA",
        comparator_only=False,
    )
    obs_dict = obs.to_dict()
    assert obs_dict["source_id"] == "hyperliquid_oracle"
    assert obs_dict["source_family"] == "hyperliquid_oracle"
    assert obs_dict["price"] == 185.0
    assert obs_dict["payload_hash"] == phash
    assert "comparator_only" not in obs_dict

    comp_obs = ObservationPayload(
        id="hl:mark:NVDA:1000",
        source_id="hyperliquid_mark",
        source_family="hyperliquid_mark",
        event_time=10.0,
        received_at=10.0,
        price=186.0,
        bid=185.9,
        ask=186.1,
        representation="USD_SHARE",
        payload_hash=phash,
        symbol="NVDA",
        comparator_only=True,
    )
    assert comp_obs.to_dict()["comparator_only"] is True


def test_base_adapter_retries_and_dropout_event():
    class FailingAdapter(BaseAdapter):
        def fetch_observations(self, symbols, clock=None):
            return [], [self.emit_dropout_event(clock or 0.0)]

    adapter = FailingAdapter(
        name="MockFail",
        source_id="mock_source",
        source_family="mock_family",
        timeout=0.1,
        max_retries=2,
        backoff_factor=0.01,
    )

    with pytest.raises(RuntimeError, match="failed after 2 attempts"):
        adapter._http_request("https://fake.nonexistent.domain/api")

    event = adapter.emit_dropout_event(clock=12.5)
    assert isinstance(event, HealthTransition)
    assert event.status == "DROPOUT"
    assert event.source_id == "mock_source"
    assert event.source_family == "mock_family"
    assert event.received_at == 12.5


def test_hyperliquid_runtime_dex_discovery_and_fail_loud_on_mismatch():
    adapter = HyperliquidAdapter()

    # 1. Test runtime discovery without hardcoded "xyz"
    mock_perp_dexs = ["custom_dex_alpha", "equities_main"]
    mock_meta = [
        {"universe": [{"name": "equities_main:NVDA"}, {"name": "equities_main:TSLA"}]},
        [{"oraclePx": "182.5", "markPx": "182.6"}, {"oraclePx": "346.8", "markPx": "347.0"}],
    ]

    def mock_http(url, method="GET", data=None, headers=None):
        body = json.loads(data.decode()) if data else {}
        if body.get("type") == "perpDexs":
            return json.dumps(mock_perp_dexs).encode(), mock_perp_dexs
        if body.get("type") == "metaAndAssetCtxs":
            if body.get("dex") == "equities_main":
                return json.dumps(mock_meta).encode(), mock_meta
            return b"[]", []
        return b"{}", {}

    with patch.object(adapter, "_http_request", side_effect=mock_http):
        discovered = adapter.discover_deployer(["NVDA", "TSLA"])
        assert discovered == "equities_main"
        assert adapter.cached_dex == "equities_main"

    # 2. Test loud mismatch failure: universe length != ctxs length
    mismatched_meta = [
        {"universe": [{"name": "NVDA"}, {"name": "TSLA"}]},
        [{"oraclePx": "182.5", "markPx": "182.6"}],  # Length 1 vs length 2!
    ]

    with patch.object(
        adapter,
        "_http_request",
        return_value=(json.dumps(mismatched_meta).encode(), mismatched_meta),
    ):
        with pytest.raises(ValueError, match="LOUD MISMATCH: universe length.*!= assetCtxs length"):
            adapter.fetch_meta_and_asset_ctxs("dex_test")


def test_hyperliquid_channel_separation_oracle_vs_mark():
    adapter = HyperliquidAdapter()
    meta_response = [
        {"universe": [{"name": "test_dex:NVDA"}]},
        [
            {
                "oraclePx": "185.25",
                "markPx": "187.50",
                "midPx": "185.30",
                "funding": "0.00015",
                "openInterest": "42000.0",
                "dayNtlVlm": "8500000.0",
                "premium": "0.0121",
                "impactPxs": ["185.20", "185.35"],
            }
        ],
    ]

    with patch.object(
        adapter,
        "_http_request",
        return_value=(json.dumps(meta_response).encode(), meta_response),
    ):
        obs_list, health_events = adapter.fetch_observations(["NVDA"], clock=5.0)

    assert len(health_events) == 0
    assert len(obs_list) == 2

    # Verify oracle evidence observation
    oracle_obs = next(o for o in obs_list if o.source_id == "hyperliquid_oracle")
    assert oracle_obs.price == 185.25
    assert oracle_obs.source_family == "hyperliquid_oracle"
    assert oracle_obs.comparator_only is False
    assert oracle_obs.meta["funding"] == 0.00015
    assert oracle_obs.meta["open_interest"] == 42000.0

    # Verify mark comparator observation (comparator ONLY)
    mark_obs = next(o for o in obs_list if o.source_id == "hyperliquid_mark")
    assert mark_obs.price == 187.50
    assert mark_obs.source_family == "hyperliquid_mark"
    assert mark_obs.comparator_only is True
    assert mark_obs.meta["premium"] == 0.0121


def test_solana_tokens_adapter_mint_validation_and_distinct_families():
    # 1. Test mint format validation
    assert validate_mint_address("NVDAx11111111111111111111111111111111111111") is True
    assert validate_mint_address("invalid_mint_with_illegal_char_0_or_O!") is False
    assert validate_mint_address("too_short") is False

    with pytest.raises(ValueError, match="Invalid Solana mint address"):
        SolanaTokensAdapter(
            tokens=[
                SolanaTokenConfig(symbol="NVDA", issuer="xstocks", mint="short_bad_mint")
            ]
        )

    # 2. Test Jupiter Lite API query and distinct source families
    valid_tokens = [
        SolanaTokenConfig(
            symbol="NVDA",
            issuer="xstocks",
            mint="NVDAx11111111111111111111111111111111111111",
            name="xStocks NVDA",
        ),
        SolanaTokenConfig(
            symbol="NVDA",
            issuer="ondo",
            mint="ondo111111111111111111111111111111111111111",
            name="Ondo NVDA",
        ),
    ]
    adapter = SolanaTokensAdapter(tokens=valid_tokens)

    mock_jup_response = {
        "data": {
            "NVDAx11111111111111111111111111111111111111": {"price": "184.90"},
            "ondo111111111111111111111111111111111111111": {"price": "185.10"},
        }
    }

    with patch.object(
        adapter,
        "_http_request",
        return_value=(json.dumps(mock_jup_response).encode(), mock_jup_response),
    ):
        obs_list, health = adapter.fetch_observations(["NVDA"], clock=10.0)

    assert len(health) == 0
    assert len(obs_list) == 2

    xstocks_obs = next(o for o in obs_list if o.source_id == "xstocks")
    ondo_obs = next(o for o in obs_list if o.source_id == "ondo")

    # CRITICAL: Distinct source families for independent corroboration
    assert xstocks_obs.source_family == "xstocks"
    assert xstocks_obs.price == 184.90
    assert ondo_obs.source_family == "ondo"
    assert ondo_obs.price == 185.10
    assert xstocks_obs.source_family != ondo_obs.source_family


def test_three_live_weekend_families_corroborate_in_engine():
    """Verify that Hyperliquid-oracle, xStocks, and Ondo form 3 independent families

    under the existing >=2-family corroboration rule in Engine.
    """
    engine = Engine("NVDA")
    base = 182.5

    # 1. Initial qualifying prints from all 3 live sources
    engine.process(
        {
            "kind": "observation",
            "id": "hl:0",
            "source_id": "hyperliquid_oracle",
            "received_at": 0.0,
            "event_time": 0.0,
            "price": base,
            "representation": "USD_SHARE",
        }
    )
    engine.process({"kind": "timer", "received_at": 0.0})
    snap0 = engine.snapshot(0, 0)
    assert snap0["reference"] == base
    assert snap0["quality"] == "QUALIFIED"

    # 2. Hyperliquid mark (comparator ONLY) arrives at a different price
    engine.process(
        {
            "kind": "observation",
            "id": "hl:mark:1",
            "source_id": "hyperliquid_mark",
            "received_at": 1.0,
            "event_time": 1.0,
            "price": 220.0,
            "comparator_only": True,
            "representation": "USD_SHARE",
        }
    )
    # Venue mark updates comparator ONLY; reference anchor must NOT change!
    assert engine.comparator == 220.0
    assert engine.last_valid == base

    # 3. A large jump (10% drop) arrives from Hyperliquid Oracle alone
    jump_px = base * 0.90
    engine.process(
        {
            "kind": "observation",
            "id": "hl:2",
            "source_id": "hyperliquid_oracle",
            "received_at": 2.0,
            "event_time": 2.0,
            "price": jump_px,
            "representation": "USD_SHARE",
        }
    )
    engine.process({"kind": "timer", "received_at": 2.0})
    snap2 = engine.snapshot(1, 2)
    # Uncorroborated single-source jump: must QUARANTINE and return INSUFFICIENT_EVIDENCE
    assert snap2["assessment"] == "QUARANTINE"
    assert snap2["reference"] is None
    assert snap2["quality"] == "INSUFFICIENT_EVIDENCE"

    # 4. Repeated prints from same source cannot corroborate
    engine.process(
        {
            "kind": "observation",
            "id": "hl:3",
            "source_id": "hyperliquid_oracle",
            "received_at": 3.0,
            "event_time": 3.0,
            "price": jump_px,
            "representation": "USD_SHARE",
        }
    )
    engine.process({"kind": "timer", "received_at": 3.0})
    assert engine.snapshot(2, 3)["reference"] is None

    # 5. Second independent family (xStocks) arrives confirming the jump
    engine.process(
        {
            "kind": "observation",
            "id": "xstocks:4",
            "source_id": "xstocks",
            "received_at": 4.0,
            "event_time": 4.0,
            "price": jump_px,
            "representation": "USD_SHARE",
        }
    )
    engine.process({"kind": "timer", "received_at": 4.0})
    snap4 = engine.snapshot(3, 4)
    # Now >= 2 independent families corroborate! Engine admits repricing!
    assert snap4["quality"] == "RECOVERING"
    assert snap4["reference"] == pytest.approx(jump_px)
    assert snap4["assessment"] == "ACCEPT"


def test_engine_handles_health_dropout_events():
    engine = Engine("NVDA")
    base = 182.5

    engine.process(
        {
            "kind": "observation",
            "id": "hl:0",
            "source_id": "hyperliquid_oracle",
            "received_at": 0.0,
            "event_time": 0.0,
            "price": base,
            "representation": "USD_SHARE",
        }
    )
    engine.process({"kind": "timer", "received_at": 0.0})
    assert engine.sources["hyperliquid_oracle"].health == "HEALTHY"

    # Health transition event occurs (dropout)
    engine.process(
        {
            "kind": "health",
            "id": "health:hl:1",
            "source_id": "hyperliquid_oracle",
            "source_family": "hyperliquid_oracle",
            "status": "DROPOUT",
            "received_at": 1.0,
            "error": "HTTP 503 Service Unavailable",
        }
    )
    assert engine.sources["hyperliquid_oracle"].health == "DROPOUT"
    assert "HEALTH_TRANSITION_DROPOUT" in engine.assessments[-1]["reason"]

    engine.process({"kind": "timer", "received_at": 1.0})
    snap1 = engine.snapshot(1, 1)
    hl_row = next(r for r in snap1["sources"] if r["id"] == "hyperliquid_oracle")
    assert hl_row["status"] == "DROPOUT"


def test_run_modes_and_live_mode_integrity():
    assert "LIVE" in RUN_MODES
    assert "REPLAY" in RUN_MODES
    assert "SYNTHETIC_TEST" in RUN_MODES
    assert validate_run_mode("LIVE") == "LIVE"
    with pytest.raises(ValueError, match="Invalid run mode"):
        validate_run_mode("INVALID_MODE")
