# Robust estimator integration

MarketBridge now has a dependency-light estimator toolkit that can be adopted by the receipt-ordered engine without replacing its source-quality guard.

## Components

- `backend/marketbridge/estimator.py`
  - `fit_ridge`: regularized factor-return baseline with an unregularized intercept.
  - `ScalarKalman`: recursive hidden-price state in log-price space; process variance grows during gaps and observations update the state.
  - `robust_fuse`: quality/age weighted log-price fusion with a hard cap on any source family.
  - `conformal_half_width`: split-conformal residual quantile helper.
- `scripts/backtest_estimator.py`: rolling historical CSV evaluation. It trains only on data available before each prediction and reports MAE/RMSE in bps.
- `tests/test_estimator.py`: regression, Kalman, family-cap and conformal tests.

## Recommended production flow

`source adapters -> timestamp/unit validation -> existing family admission guard -> robust_fuse -> Kalman predict/update -> conformal band -> risk state`

The existing engine remains the authority for quarantine, receipt ordering, abstention and venue-mark isolation. The estimator must never receive a quarantined observation, and a repeated stale observation must never be passed to `update` as new evidence.

## Historical evaluation

Use a CSV with `timestamp,price,market_return` and run:

```sh
python scripts/backtest_estimator.py data/history.csv --output artifacts/historical_backtest.json
```

Do not call this a weekend forecast result unless the dataset actually contains the target off-hours regime. Report abstentions and availability separately from error metrics.

## Provenance

The design was informed by public GitHub examples of Kalman filtering in trading and stock-model experimentation, including `baslia/quant_analysis` and `marcosamaris/OracleStock`. Their code is not vendored here; MarketBridge keeps its own small, auditable implementation and tests.
