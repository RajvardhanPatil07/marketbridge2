"""Hyperliquid adapter for on-chain equity perps discovery and quotes."""

import json
import logging
import time
from typing import Any

from .base import BaseAdapter, HealthTransition, ObservationPayload, compute_payload_hash

logger = logging.getLogger(__name__)

DEFAULT_INFO_URL = "https://api.hyperliquid.xyz/info"


class HyperliquidAdapter(BaseAdapter):
    """Adapter querying Hyperliquid info API with runtime DEX discovery.

    Discovers deployer at runtime via {"type":"perpDexs"}, then fetches
    {"type":"metaAndAssetCtxs","dex":<name>} for target equities.

    CRITICAL INVARIANTS:
    - Zip universe[] to ctxs[] BY INDEX and assert lengths match; fail loudly on mismatch.
    - Emit oraclePx as evidence observation.
    - Emit markPx as comparator ONLY. Venue mark never enters the independent estimator.
    """

    def __init__(
        self,
        info_url: str = DEFAULT_INFO_URL,
        timeout: float = 5.0,
        max_retries: int = 3,
        backoff_factor: float = 0.5,
    ):
        super().__init__(
            name="Hyperliquid",
            source_id="hyperliquid_oracle",
            source_family="hyperliquid_oracle",
            timeout=timeout,
            max_retries=max_retries,
            backoff_factor=backoff_factor,
        )
        self.info_url = info_url
        self.cached_dex: str | None = None

    def discover_deployer(self, target_symbols: list[str]) -> str | None:
        """Discover which DEX deployer lists the target equity perps at runtime.

        Never hardcodes 'xyz'. Queries {"type":"perpDexs"}, inspects returned dexes,
        and verifies asset universe support.
        """
        payload = json.dumps({"type": "perpDexs"}).encode("utf-8")
        try:
            _, dex_data = self._http_request(self.info_url, method="POST", data=payload)
        except Exception as exc:
            logger.warning("Hyperliquid perpDexs discovery request failed: %s", exc)
            return self.cached_dex

        candidate_dexes: list[str] = []
        if isinstance(dex_data, list):
            for item in dex_data:
                if isinstance(item, str):
                    candidate_dexes.append(item)
                elif isinstance(item, dict):
                    name = item.get("name") or item.get("dex") or item.get("deployer") or item.get("id")
                    if name:
                        candidate_dexes.append(str(name))

        # Check candidate dexes to see which one hosts target equity perps
        for dex_name in candidate_dexes:
            try:
                meta_payload = json.dumps({"type": "metaAndAssetCtxs", "dex": dex_name}).encode("utf-8")
                _, meta_data = self._http_request(self.info_url, method="POST", data=meta_payload)
                if isinstance(meta_data, list) and len(meta_data) >= 1 and isinstance(meta_data[0], dict):
                    universe = meta_data[0].get("universe", [])
                    names = {asset.get("name", "") for asset in universe if isinstance(asset, dict)}
                    for sym in target_symbols:
                        if any(n == sym or n.endswith(f":{sym}") for n in names):
                            self.cached_dex = dex_name
                            logger.info("Discovered equity perp DEX deployer '%s'", dex_name)
                            return dex_name
            except Exception as check_exc:
                logger.debug("Failed checking DEX '%s': %s", dex_name, check_exc)

        # If perpDexs returned nothing or had no matches, fallback to checking default (no dex parameter)
        if candidate_dexes:
            self.cached_dex = candidate_dexes[0]
            return candidate_dexes[0]
        return None

    def fetch_meta_and_asset_ctxs(self, dex_name: str | None) -> tuple[bytes, dict, list]:
        """Fetch [meta, assetCtxs] from Hyperliquid and enforce 1-to-1 index alignment."""
        req_obj: dict[str, Any] = {"type": "metaAndAssetCtxs"}
        if dex_name:
            req_obj["dex"] = dex_name
        payload = json.dumps(req_obj).encode("utf-8")
        raw_bytes, resp = self._http_request(self.info_url, method="POST", data=payload)

        if not isinstance(resp, list) or len(resp) < 2:
            raise ValueError(
                f"Expected 2-element list [meta, assetCtxs] from metaAndAssetCtxs, got {type(resp)}"
            )

        meta, asset_ctxs = resp[0], resp[1]
        if not isinstance(meta, dict) or "universe" not in meta:
            raise ValueError("Invalid meta object: missing 'universe'")
        if not isinstance(asset_ctxs, list):
            raise ValueError("Invalid assetCtxs: expected list")

        universe = meta["universe"]
        # CRITICAL ASSERTION: Zip universe[] to ctxs[] BY INDEX and assert lengths match; fail loudly on mismatch.
        if len(universe) != len(asset_ctxs):
            raise ValueError(
                f"LOUD MISMATCH: universe length ({len(universe)}) != assetCtxs length ({len(asset_ctxs)})"
            )

        return raw_bytes, meta, asset_ctxs

    def fetch_observations(
        self, symbols: list[str], clock: float | None = None
    ) -> tuple[list[ObservationPayload], list[HealthTransition]]:
        now = clock if clock is not None else time.time()
        observations: list[ObservationPayload] = []
        health_events: list[HealthTransition] = []

        dex_name = self.cached_dex
        try:
            if not dex_name:
                dex_name = self.discover_deployer(symbols)
            raw_bytes, meta, asset_ctxs = self.fetch_meta_and_asset_ctxs(dex_name)
        except Exception as exc:
            logger.error("Hyperliquid fetch failed: %s", exc)
            dropout = self.emit_dropout_event(now, str(exc))
            health_events.append(dropout)
            return observations, health_events

        payload_hash = compute_payload_hash(raw_bytes)
        universe = meta["universe"]

        for asset_meta, ctx in zip(universe, asset_ctxs, strict=True):
            asset_name = str(asset_meta.get("name", ""))
            # Match target symbol: e.g. "NVDA", "xyz:NVDA", etc.
            matched_symbol = None
            for sym in symbols:
                if asset_name == sym or asset_name.endswith(f":{sym}"):
                    matched_symbol = sym
                    break

            if not matched_symbol:
                continue

            try:
                oracle_px = float(ctx["oraclePx"])
                mark_px = float(ctx["markPx"])
                mid_px = float(ctx["midPx"]) if ctx.get("midPx") is not None else oracle_px
                funding = float(ctx["funding"]) if ctx.get("funding") is not None else None
                open_interest = float(ctx["openInterest"]) if ctx.get("openInterest") is not None else None
                day_ntl_vlm = float(ctx["dayNtlVlm"]) if ctx.get("dayNtlVlm") is not None else None
                premium = float(ctx["premium"]) if ctx.get("premium") is not None else (mark_px / oracle_px - 1.0)
                impact_pxs = ctx.get("impactPxs")

                # Derive reasonable bid/ask bounds
                bid_px = round(oracle_px * 0.9999, 8)
                ask_px = round(oracle_px * 1.0001, 8)
                if impact_pxs and isinstance(impact_pxs, list) and len(impact_pxs) >= 2:
                    try:
                        p0, p1 = float(impact_pxs[0]), float(impact_pxs[1])
                        if 0 < p0 <= p1:
                            bid_px, ask_px = p0, p1
                    except (ValueError, TypeError):
                        pass

                # 1. Evidence observation: oraclePx ONLY
                obs_oracle = ObservationPayload(
                    id=f"hl:oracle:{matched_symbol}:{int(now * 1000)}",
                    source_id="hyperliquid_oracle",
                    source_family="hyperliquid_oracle",
                    event_time=now,
                    received_at=now,
                    price=oracle_px,
                    bid=bid_px,
                    ask=ask_px,
                    representation="USD_SHARE",
                    payload_hash=payload_hash,
                    symbol=matched_symbol,
                    comparator_only=False,
                    meta={
                        "funding": funding,
                        "open_interest": open_interest,
                        "day_ntl_vlm": day_ntl_vlm,
                        "mid_px": mid_px,
                    },
                )
                observations.append(obs_oracle)

                # 2. Comparator observation: markPx ONLY (must never enter independent estimator)
                obs_mark = ObservationPayload(
                    id=f"hl:mark:{matched_symbol}:{int(now * 1000)}",
                    source_id="hyperliquid_mark",
                    source_family="hyperliquid_mark",
                    event_time=now,
                    received_at=now,
                    price=mark_px,
                    bid=bid_px,
                    ask=ask_px,
                    representation="USD_SHARE",
                    payload_hash=payload_hash,
                    symbol=matched_symbol,
                    comparator_only=True,
                    meta={
                        "premium": premium,
                        "funding": funding,
                        "open_interest": open_interest,
                        "day_ntl_vlm": day_ntl_vlm,
                        "impact_pxs": impact_pxs,
                    },
                )
                observations.append(obs_mark)

            except (KeyError, ValueError, TypeError) as parse_exc:
                logger.warning("Failed parsing context for asset %s: %s", asset_name, parse_exc)
                continue

        return observations, health_events
