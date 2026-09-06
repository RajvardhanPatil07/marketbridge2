"""Common interface and base abstractions for MarketBridge source adapters."""

from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field
import hashlib
import json
import logging
import time
from typing import Any
import urllib.error
import urllib.request

logger = logging.getLogger(__name__)


@dataclass
class ObservationPayload:
    """Canonical observation emitted by market data adapters."""

    id: str
    source_id: str
    source_family: str
    event_time: float
    received_at: float
    price: float
    bid: float
    ask: float
    representation: str = "USD_SHARE"
    payload_hash: str = ""
    symbol: str = "NVDA"
    kind: str = "observation"
    comparator_only: bool = False
    meta: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        if not self.comparator_only:
            data.pop("comparator_only", None)
        return data


@dataclass
class HealthTransition:
    """Health status event emitted when an adapter drops out or recovers."""

    id: str
    source_id: str
    source_family: str
    status: str  # e.g., "DROPOUT", "DEGRADED", "HEALTHY"
    received_at: float
    event_time: float
    error: str | None = None
    kind: str = "health"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def compute_payload_hash(raw_bytes: bytes) -> str:
    """Generate deterministic SHA-256 hash of the raw response payload."""
    return hashlib.sha256(raw_bytes).hexdigest()


class BaseAdapter(ABC):
    """Abstract base class for live weekend adapters."""

    def __init__(
        self,
        name: str,
        source_id: str,
        source_family: str,
        timeout: float = 5.0,
        max_retries: int = 3,
        backoff_factor: float = 0.5,
    ):
        self.name = name
        self.source_id = source_id
        self.source_family = source_family
        self.timeout = timeout
        self.max_retries = max_retries
        self.backoff_factor = backoff_factor
        self.is_healthy: bool = True
        self.last_healthy_at: float | None = None
        self.last_error: str | None = None

    def _http_request(
        self,
        url: str,
        method: str = "GET",
        data: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[bytes, dict[str, Any]]:
        """Perform HTTP request with retries and exponential backoff."""
        req_headers = {"User-Agent": "MarketBridge/1.0", "Accept": "application/json"}
        if headers:
            req_headers.update(headers)
        if data is not None and "Content-Type" not in req_headers:
            req_headers["Content-Type"] = "application/json"

        last_exc: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    raw = resp.read()
                    parsed = json.loads(raw.decode("utf-8"))
                    self.is_healthy = True
                    self.last_healthy_at = time.time()
                    self.last_error = None
                    return raw, parsed
            except Exception as exc:
                last_exc = exc
                wait_time = self.backoff_factor * (2**attempt)
                logger.warning(
                    "Adapter %s attempt %d/%d failed: %s. Retrying in %.2fs",
                    self.name,
                    attempt + 1,
                    self.max_retries,
                    exc,
                    wait_time,
                )
                if attempt < self.max_retries - 1:
                    time.sleep(wait_time)

        self.is_healthy = False
        self.last_error = str(last_exc)
        raise RuntimeError(
            f"Adapter {self.name} failed after {self.max_retries} attempts: {last_exc}"
        ) from last_exc

    def emit_dropout_event(self, clock: float, error_msg: str | None = None) -> HealthTransition:
        """Construct a dropout health transition event upon connection failure."""
        err = error_msg or self.last_error or "CONNECTION_TIMEOUT"
        return HealthTransition(
            id=f"health:{self.source_id}:{int(clock * 1000)}",
            source_id=self.source_id,
            source_family=self.source_family,
            status="DROPOUT",
            received_at=clock,
            event_time=clock,
            error=err,
        )

    @abstractmethod
    def fetch_observations(
        self, symbols: list[str], clock: float | None = None
    ) -> tuple[list[ObservationPayload], list[HealthTransition]]:
        """Fetch latest quotes for the requested symbols.

        Returns a tuple of:
        - List of ObservationPayload (evidence observations, plus optional comparator observations)
        - List of HealthTransition events (if dropout or status changes occurred)
        """
        pass
