"""Dependency-light robust reference-price estimator.

The module combines three ideas suited to MarketBridge:
- ridge regression for factor-return baselines;
- a scalar Kalman filter for recursive hidden-price estimation;
- family-capped robust fusion so correlated resellers cannot dominate.

It is intentionally independent of the existing Engine so it can be tested and
adopted incrementally without changing the deterministic replay contract.
"""
from __future__ import annotations

from dataclasses import dataclass
import math


def _solve(a: list[list[float]], b: list[float]) -> list[float]:
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(m[r][col]))
        if abs(m[pivot][col]) < 1e-12:
            raise ValueError("Singular regression system")
        m[col], m[pivot] = m[pivot], m[col]
        p = m[col][col]
        for j in range(col, n + 1):
            m[col][j] /= p
        for r in range(n):
            if r == col:
                continue
            f = m[r][col]
            if f == 0:
                continue
            for j in range(col, n + 1):
                m[r][j] -= f * m[col][j]
    return [m[i][n] for i in range(n)]


@dataclass(frozen=True)
class RidgeModel:
    intercept: float
    coefficients: tuple[float, ...]
    l2: float

    def predict(self, features: list[float] | tuple[float, ...]) -> float:
        if len(features) != len(self.coefficients):
            raise ValueError("Feature dimension mismatch")
        return self.intercept + sum(c * x for c, x in zip(self.coefficients, features))


def fit_ridge(samples: list[tuple[list[float], float]], l2: float = 1.0) -> RidgeModel:
    """Fit ordinary ridge with an unregularized intercept."""
    if not samples:
        raise ValueError("At least one training sample is required")
    d = len(samples[0][0])
    if d == 0 or any(len(x) != d for x, _ in samples):
        raise ValueError("Inconsistent feature dimensions")
    if l2 < 0:
        raise ValueError("l2 must be non-negative")
    xtx = [[0.0] * (d + 1) for _ in range(d + 1)]
    xty = [0.0] * (d + 1)
    for x, y in samples:
        row = [1.0, *x]
        for i in range(d + 1):
            xty[i] += row[i] * y
            for j in range(d + 1):
                xtx[i][j] += row[i] * row[j]
    for i in range(1, d + 1):
        xtx[i][i] += l2
    coef = _solve(xtx, xty)
    return RidgeModel(coef[0], tuple(coef[1:]), l2)


@dataclass
class KalmanState:
    value: float
    variance: float


class ScalarKalman:
    """One-dimensional random-walk Kalman filter in log-price space."""

    def __init__(self, initial_value: float, initial_variance: float = 1e-4, process_variance: float = 2.5e-5):
        if initial_value <= 0 or initial_variance <= 0 or process_variance < 0:
            raise ValueError("Invalid Kalman parameters")
        self.state = KalmanState(math.log(initial_value), initial_variance)
        self.process_variance = process_variance

    def predict(self, drift: float = 0.0) -> KalmanState:
        self.state = KalmanState(self.state.value + drift, self.state.variance + self.process_variance)
        return self.state

    def update(self, price: float, observation_variance: float) -> KalmanState:
        if price <= 0 or observation_variance <= 0:
            raise ValueError("Invalid Kalman observation")
        z = math.log(price)
        gain = self.state.variance / (self.state.variance + observation_variance)
        self.state = KalmanState(
            self.state.value + gain * (z - self.state.value),
            max((1.0 - gain) * self.state.variance, 1e-12),
        )
        return self.state

    @property
    def price(self) -> float:
        return math.exp(self.state.value)

    @property
    def sigma_log(self) -> float:
        return math.sqrt(self.state.variance)


@dataclass(frozen=True)
class Observation:
    source_id: str
    family: str
    price: float
    quality: float = 1.0
    age_seconds: float = 0.0


@dataclass(frozen=True)
class FusionResult:
    price: float
    weights: dict[str, float]
    family_count: int
    dispersion_bps: float


def robust_fuse(observations: list[Observation], max_family_weight: float = 0.60) -> FusionResult:
    """Fuse prices in log-space with quality, age and family caps.

    The family cap is applied before normalization. A source with zero quality
    or non-finite values contributes nothing. This is a statistical estimator,
    not the admission/quarantine policy; callers should run the existing source
    guard before invoking it.
    """
    usable = [o for o in observations if o.price > 0 and o.quality > 0 and math.isfinite(o.price)]
    if not usable:
        raise ValueError("No usable observations")
    raw = {}
    for o in usable:
        freshness = math.exp(-max(0.0, o.age_seconds) / 5.0)
        raw[o.source_id] = max(0.0, o.quality) * freshness
    family_totals: dict[str, float] = {}
    for o in usable:
        family_totals[o.family] = family_totals.get(o.family, 0.0) + raw[o.source_id]
    capped = {}
    for o in usable:
        total = family_totals[o.family]
        scale = min(1.0, max_family_weight / total) if total else 0.0
        capped[o.source_id] = raw[o.source_id] * scale
    normalizer = sum(capped.values())
    if normalizer <= 0:
        raise ValueError("All observations were rejected by quality weights")
    normalized = {k: v / normalizer for k, v in capped.items()}
    log_price = sum(normalized[o.source_id] * math.log(o.price) for o in usable)
    center = math.exp(log_price)
    dispersion = math.sqrt(sum(normalized[o.source_id] * math.log(o.price / center) ** 2 for o in usable))
    return FusionResult(center, normalized, len(family_totals), dispersion * 10000)


def conformal_half_width(residuals_bps: list[float], coverage: float = 0.90) -> float:
    """Return a split-conformal absolute residual quantile in decimal price units."""
    if not residuals_bps or not 0 < coverage < 1:
        raise ValueError("Need residuals and coverage in (0,1)")
    values = sorted(abs(float(x)) for x in residuals_bps)
    rank = min(len(values) - 1, math.ceil((len(values) + 1) * coverage) - 1)
    return values[rank] / 10000.0
