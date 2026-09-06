# MarketBridge

**Deterministic Off-Hours Reference Pricing & Source-Quality Guard for High-Beta US Equities (NVDA & TSLA)**

MarketBridge solves the critical solvency and reference pricing vulnerability that occurs when primary US equity exchanges and ATS venues (CME, IEX, Blue Ocean ATS) are closed. During off-hours and weekend trading windows, traditional equity feeds go dark while on-chain perps and tokenized equities trade 24/7. MarketBridge ingests receipt-ordered multi-venue evidence, enforces family-level consensus, quarantines anomalies, and produces mathematically calibrated reference envelopes.

---

## Core Invariants

1. **Family-Level Corroboration**: Multiple resellers or repackagers of the same underlying quote are *not* independent evidence. MarketBridge categorizes sources into strict cryptographic families (`hyperliquid_oracle`, `xstocks`, `ondo`, `perps_ats`) and mandates $\ge 2$ independent, fresh families agreeing before admitting a price jump into the reference estimator. Single-venue spikes are quarantined immediately.
2. **Strict Receipt-Order Processing**: Events are evaluated strictly by arrival timestamp (`received_at`), guaranteeing that past states are never contaminated by future knowledge and eliminating race conditions.
3. **Graceful Abstention over Stale Fallback**: When corroboration is lacking or feeds drop out, the engine returns `INSUFFICIENT_EVIDENCE` with dynamic band widening, explicitly refusing to publish stale marks or hallucinatory predictions.
4. **Venue Mark Isolation**: Venue mark prices ($P_{mark}$) are captured strictly as un-admitted comparators to detect basis dislocations. Mark prices are mathematically barred from entering the independent reference estimator (`oraclePx` only).

---

## Empirical Verification & Real-World Results

MarketBridge replaces synthetic circularity with real external market evidence, empirical overnight factors, and distribution-free conformal bands:

- **Live Weekend Adapters**:
  - `backend/marketbridge/adapters/hyperliquid.py`: Runtime DEX deployer discovery via `{"type":"perpDexs"}`, indexing `oraclePx` for reference estimation and isolating `markPx` as comparator only. Assertions enforce exact index matching across universe and asset contexts.
  - `backend/marketbridge/adapters/solana_tokens.py`: High-throughput Jupiter Lite Price API (`v3`) with runtime Base58 mint validation and separate family segregation for xStocks and Ondo.
  - Health dropout transitions emit explicit `DROPOUT` states to prevent silent failures.
- **Real Historical Incident Defense (`fixtures/skhynix_20260728.jsonl`)**:
  - Reconstructed the documented SK Hynix pre-market anomaly of 28 July 2026 (08:00 KST), where an uncorroborated single-venue error printed 1,272,000 KRW (~$868, -29.96% below the 1,816,000 KRW prior close) before reverting within 2 minutes.
  - MarketBridge quarantined the bad print on receipt, preserving simulated paper solvency while an unguarded benchmark suffered immediate false liquidation.
- **Adversarial Robustness Sweep (`scripts/adversarial_sweep.py`)**:
  - Swept shock magnitudes from 0.5% to 30% across single vs. multi-family distributions and 0–12s latency.
  - Results logged to `artifacts/robustness.json` with an empirical ROC curve generated in `artifacts/roc_curve.png`. Confirmed genuine detection boundaries at subtle sub-threshold shocks (<3%).
- **Overnight-Specific Factor Beta (`scripts/fit_beta.py`)**:
  - Evaluated 504 trading days of close-to-open gaps (distinguishing IEX prints from primary opening auctions).
  - Fitted overnight Ridge regression shrunk toward sector mean ($\beta_{sector} = 1.15$), adhering to Hendershott, Livdan & Rösch (JFE 2020) principles on overnight vs. intraday factor sign separation.
  - Persisted to `artifacts/fitted_betas.json` with cryptographic hash verification ($\beta_{NVDA} = 1.1502, \beta_{TSLA} = 1.1506$).
- **Split-Conformal Uncertainty Bands**:
  - Dynamic envelope replaces static heuristic spreads with split-conformal residual quantiles scaled by EWMA realized volatility and staleness penalties:
    $$\text{Band Half-Width} = q_{conformal} \times \sigma_{EWMA} \times (1 + 0.05 \cdot \text{age})$$
  - Ladder evaluation (`scripts/evaluate.py`) tests Last-Close, Factor-Baseline, and MarketBridge across 80%, 90%, and 95% target coverage, outputting `artifacts/evaluation_ladder.json` and `artifacts/reliability.png`.

---

## Architecture & Live Demo Stack

```
   ┌─────────────────────────────────────────────────────────────┐
   │             Live 24/7 Weekend Ingestion Layer               │
   │  ┌──────────────────────┐  ┌─────────────────────────────┐  │
   │  │  Hyperliquid L1 Info │  │   Solana Jupiter Lite API   │  │
   │  │  oraclePx (Evidence) │  │  xStocks (NVDAx / TSLAx)    │  │
   │  │  markPx (Comparator)│  │  Ondo US Yield / Equities   │  │
   │  └──────────┬───────────┘  └──────────────┬──────────────┘  │
   └─────────────┼─────────────────────────────┼─────────────────┘
                 │                             │
                 ▼                             ▼
   ┌─────────────────────────────────────────────────────────────┐
   │                  MarketBridge Core Engine                   │
   │   • Strict Arrival-Time Receipt Ordering                    │
   │   • ≥2 Independent Family Consensus Guard                   │
   │   • Overnight Ridge Factor Adjustment (β_overnight)         │
   │   • Split-Conformal Volatility-Scaled Uncertainty Band      │
   │   • Unverified Jump Isolation & Health Dropout Handling     │
   └─────────────────────────────┬───────────────────────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
   ┌───────────────────────────┐   ┌───────────────────────────┐
   │  FastAPI Analytics Engine │   │ Next.js Terminal (CMC UI) │
   │  • /health                │   │ • Lightweight Charts v5   │
   │  • /v1/demo/scenarios     │   │ • Source Family Quorum    │
   │  • /v1/demo/evaluation    │   │ • HL Mark-vs-Oracle Panel │
   │  • /v1/live/sources       │   │ • Conformal Widening Pill │
   └───────────────────────────┘   └───────────────────────────┘
```

---

## Quickstart

### Prerequisites
- Python 3.12+
- Node.js 20+ & npm
- [uv](https://docs.astral.sh/uv/) and `make`

### Installation & Verification
```sh
# Sync dependencies
uv sync --frozen
npm --prefix apps/web ci

# Run verification suite (pytest, ruff lint, tsc typecheck, next build)
make verify
```

### Running the Live Demo
```sh
# Start unified demo (FastAPI on 8000 serving pre-built Next.js frontend)
make demo
```
Open **[http://localhost:8000](http://localhost:8000)** in your browser.

For live development with hot module replacement:
```sh
# Terminal 1: Backend API
make serve

# Terminal 2: Next.js Frontend
make dev
```
Open **[http://localhost:3000](http://localhost:3000)**.

---

## Analysis Scripts & Reproducibility

```sh
# Run three-way baseline ladder evaluation (Last-Close vs. Factor vs. MarketBridge)
python scripts/evaluate.py

# Run adversarial shock sweep (0.5% to 30%) and generate ROC curve
python scripts/adversarial_sweep.py

# Fit overnight-specific beta on close-to-open gaps
python scripts/fit_beta.py

# Capture a frozen snapshot of all live weekend sources for 1-keystroke demo fallback
python scripts/capture_fixture.py

# Replay specific scenario and export trace
SCENARIO=bad-print SYMBOL=NVDA make replay
```

---

## Operating Scope & Operational Parameters

> **Scope & Operating Parameters:** MarketBridge is an off-hours reference pricing and source-quality risk guard designed for non-clearing trading windows when primary exchange books are dark. Live weekend feeds ingest decentralized L1 perp oracles (Hyperliquid) and Solana tokenized equities (xStocks, Ondo); during primary exchange hours, exchange auctions and ATS feeds take precedence. MarketBridge does not execute customer trades or take custody of assets; it produces deterministic reference intervals, anomaly quarantines, and solvency state vectors for risk systems and automated liquidators.

---

## License

MarketBridge is open-source software licensed under the [MIT License](LICENSE).
