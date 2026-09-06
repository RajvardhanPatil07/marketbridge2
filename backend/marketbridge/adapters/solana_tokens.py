"""Solana tokenized equities and RWAs adapter using Jupiter Lite Price API v3."""

from dataclasses import dataclass
import logging
import re
import time
from typing import Any

from .base import BaseAdapter, HealthTransition, ObservationPayload, compute_payload_hash

logger = logging.getLogger(__name__)

DEFAULT_JUPITER_URL = "https://lite-api.jup.ag/price/v3"

# Standard Base58 regex for Solana public keys (32-44 base58 characters)
BASE58_PATTERN = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")


@dataclass(frozen=True)
class SolanaTokenConfig:
    symbol: str
    issuer: str  # "xstocks" or "ondo"
    mint: str
    decimals: int = 6
    name: str = ""


# Default mints for xStocks and Ondo on Solana (configurable/overridable at runtime)
DEFAULT_TOKEN_REGISTRY: list[SolanaTokenConfig] = [
    SolanaTokenConfig(
        symbol="NVDA",
        issuer="xstocks",
        mint="NVDAx11111111111111111111111111111111111111",  # xStocks NVDA synthetic/tokenized mint
        decimals=6,
        name="xStocks NVDA (Solana)",
    ),
    SolanaTokenConfig(
        symbol="TSLA",
        issuer="xstocks",
        mint="TSLAx11111111111111111111111111111111111111",  # xStocks TSLA synthetic/tokenized mint
        decimals=6,
        name="xStocks TSLA (Solana)",
    ),
    SolanaTokenConfig(
        symbol="NVDA",
        issuer="ondo",
        mint="ondo111111111111111111111111111111111111111",  # Ondo short-duration/equity reference mint
        decimals=6,
        name="Ondo Solana Token",
    ),
    SolanaTokenConfig(
        symbol="TSLA",
        issuer="ondo",
        mint="ondot11111111111111111111111111111111111111",  # Ondo TSLA equity reference mint
        decimals=6,
        name="Ondo Solana TSLA Token",
    ),
]


def validate_mint_address(mint: str) -> bool:
    """Validate that a string conforms to the Solana Base58 public key format."""
    if not isinstance(mint, str):
        return False
    return bool(BASE58_PATTERN.match(mint.strip()))


class SolanaTokensAdapter(BaseAdapter):
    """Adapter for tokenized equities (xStocks) and Ondo RWA tokens on Solana.

    Queries Jupiter Lite Price API v3 and emits distinct source_family per issuer
    ('xstocks' vs 'ondo') so that multi-family corroboration operates cleanly.
    """

    def __init__(
        self,
        api_url: str = DEFAULT_JUPITER_URL,
        tokens: list[SolanaTokenConfig] | None = None,
        timeout: float = 5.0,
        max_retries: int = 3,
        backoff_factor: float = 0.5,
    ):
        super().__init__(
            name="SolanaTokens",
            source_id="solana_tokens",
            source_family="solana_rwa",
            timeout=timeout,
            max_retries=max_retries,
            backoff_factor=backoff_factor,
        )
        self.api_url = api_url
        self.tokens = tokens if tokens is not None else list(DEFAULT_TOKEN_REGISTRY)
        self._validate_configured_mints()

    def _validate_configured_mints(self) -> None:
        """Validate all configured mints at initialization."""
        for token in self.tokens:
            if not validate_mint_address(token.mint):
                raise ValueError(
                    f"Invalid Solana mint address '{token.mint}' for {token.symbol} ({token.issuer})"
                )

    def fetch_observations(
        self, symbols: list[str], clock: float | None = None
    ) -> tuple[list[ObservationPayload], list[HealthTransition]]:
        now = clock if clock is not None else time.time()
        observations: list[ObservationPayload] = []
        health_events: list[HealthTransition] = []

        relevant_tokens = [t for t in self.tokens if t.symbol in symbols]
        if not relevant_tokens:
            return observations, health_events

        mint_ids = ",".join(t.mint for t in relevant_tokens)
        url = f"{self.api_url}?ids={mint_ids}"

        try:
            raw_bytes, resp = self._http_request(url, method="GET")
        except Exception as exc:
            logger.error("SolanaTokensAdapter query failed: %s", exc)
            # Emit dropout events for both families so the engine notices the outage
            for issuer in {"xstocks", "ondo"}:
                health_events.append(
                    HealthTransition(
                        id=f"health:{issuer}:{int(now * 1000)}",
                        source_id=issuer,
                        source_family=issuer,
                        status="DROPOUT",
                        received_at=now,
                        event_time=now,
                        error=str(exc),
                    )
                )
            return observations, health_events

        payload_hash = compute_payload_hash(raw_bytes)

        # Handle nested {"data": { ... }} or top-level dict format
        price_dict: dict[str, Any] = resp.get("data", resp) if isinstance(resp, dict) else {}

        for token in relevant_tokens:
            token_data = price_dict.get(token.mint)
            if not token_data or not isinstance(token_data, dict):
                continue

            try:
                raw_price = token_data.get("price")
                if raw_price is None:
                    continue
                price = float(raw_price)
                if price <= 0:
                    continue

                bid = round(price * 0.9998, 8)
                ask = round(price * 1.0002, 8)

                # Assign distinct source_id and source_family per issuer
                source_id = token.issuer
                source_family = token.issuer

                obs = ObservationPayload(
                    id=f"sol:{token.issuer}:{token.symbol}:{int(now * 1000)}",
                    source_id=source_id,
                    source_family=source_family,
                    event_time=now,
                    received_at=now,
                    price=price,
                    bid=bid,
                    ask=ask,
                    representation="USD_SHARE",
                    payload_hash=payload_hash,
                    symbol=token.symbol,
                    comparator_only=False,
                    meta={
                        "mint": token.mint,
                        "issuer": token.issuer,
                        "token_name": token.name,
                    },
                )
                observations.append(obs)

            except (ValueError, TypeError) as parse_exc:
                logger.warning("Failed parsing price for mint %s: %s", token.mint, parse_exc)
                continue

        return observations, health_events
