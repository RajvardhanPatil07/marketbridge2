# MarketBridge

A runnable demonstration of off-hours reference pricing, source-quality checks, and a paper risk simulator for NVDA and TSLA. The dashboard takes its market-table and chart layout cues from CoinMarketCap, with an original MarketBridge identity.

**Every price, source, event, and outcome in this build is synthetic.** It runs without market-data accounts, API keys, a wallet, or external feed access. This is the four-day demo implementation; the earlier research documents describe a broader proposed product.

## Run locally

Install Python 3.12, Node.js 24, [uv](https://docs.astral.sh/uv/getting-started/installation/), and Make. From the repository root:

```sh
uv sync --frozen
npm --prefix apps/web ci
make demo
```

Open [http://localhost:8000](http://localhost:8000). `make demo` builds the static Next.js frontend and serves it alongside the FastAPI API on port 8000. Stop it with Ctrl+C. Dependency installation needs internet access; the built demo uses its bundled fixtures.

For separate development servers, run these in two terminals:

```sh
# Terminal 1: API on port 8000
make serve
```

```sh
# Terminal 2: frontend on port 3000, targeting the local API
make dev
```

Open [http://localhost:3000](http://localhost:3000) for development. `make dev` sets `NEXT_PUBLIC_API_BASE=http://127.0.0.1:8000`; production builds use the same origin as the page. No `.env` file is required. `.env.example` documents the optional settings; the root Makefile does not automatically load it. To change the serving port, use `PORT=8080 make demo`.

## What to demonstrate

Choose NVDA or TSLA and one of six scenarios: normal observations, an isolated bad print, a corroborated genuine move, feed dropout, reopening, or repeated observations from one source family. Playback exposes the reference, source ages, guard decisions, uncalibrated model range, and simulated position state. Use the four-minute [demo script](docs/demo-script.md) for a rehearsal.

The engine processes events in receipt order and produces a deterministic trace. The browser controls playback of that trace. It does not receive live prices, and the playback clock is a fixture clock.

The model uses an explicit **unit-beta QQQ factor rule** between accepted stock observations, plus synthetic guard and recovery rules. There is no fitted ridge model in this implementation: no licensed historical training set or provider credentials were supplied. The displayed **Model range · uncalibrated** is a rule-based illustration, not an empirically calibrated confidence or next-open prediction interval.

Two benchmarks have different meanings:

- `Step.baseline` is the QQQ factor-only price path anchored at the scenario's initial stock price.
- `simulation.baseline_equity` values the same paper position against the unguarded primary-feed comparator (`Step.comparator`). It is not a position marked against the QQQ baseline.

Both paper paths use the disclosed fixture assumptions and a common synthetic terminal outcome for final scoring. An unavailable reference creates unresolved current valuation and blocks new simulated exposure. A recorded liquidation remains an exit; the simulator does not silently reopen the position. Fixture MAE and paper equity outcomes are functional demonstrations, not measured stock-market performance or customer savings.

## Verify and export

```sh
make verify
make evaluate
make replay
SCENARIO=genuine-move SYMBOL=TSLA make replay
```

`make verify` runs Python lint, backend tests, frontend type checking, and a production frontend build. `make evaluate` writes `artifacts/evaluation.json`; default `make replay` writes `artifacts/bad-print-NVDA.json`. The final command writes `artifacts/genuine-move-TSLA.json`. Generated artifacts are ignored by Git and retain `data_mode: SYNTHETIC_TEST`.

The GitHub Actions workflow runs the same verification commands and retains synthetic evaluation/replay JSON for seven days. Its presence does not establish that a remote CI run or deployment has passed.

The API exposes:

| Route | Result |
| --- | --- |
| `GET /health` | Service health |
| `GET /v1/demo/scenarios` | Scenarios and supported symbols |
| `GET /v1/demo/scenarios/bad-print?symbol=NVDA` | One complete synthetic trace |
| `GET /v1/demo/evaluation` | Synthetic functional checks and limitations |

The [integration contract](docs/demo-contract.md) specifies the trace and simulation fields.

## Docker and Railway

Build and run the self-contained image from the repository root:

```sh
docker build -t marketbridge-demo .
docker run --rm -p 8000:8000 marketbridge-demo
```

The multi-stage Dockerfile exports the frontend, installs the locked Python runtime dependencies, and runs FastAPI as a non-root user. One process serves both the site and API. The container honors `PORT`; Railway's checked-in configuration uses `/health` as its health check. This demo requires no database, volume, feed secret, or wallet.

For a deployment through an authorized local [Railway CLI](https://docs.railway.com/cli), first run `make verify`, then select the intended project, environment, and service:

```sh
railway login
railway link
railway status
railway up
railway domain
```

Use an existing demo service when linking. If a new service is needed, create/select it through the CLI before uploading. `railway up` uploads this directory and starts a deployment; `railway domain` exposes the selected service. After deployment, check `/health`, open the returned domain, and rehearse all six scenarios. These are deployment instructions, not a claim that this checkout is already hosted.

The synthetic application has no account system or trading actions. Enterprise authentication, live-data adapters, trained models, calibrated forecasts, exchange-oracle writes, and real execution remain outside this build.

## Vercel

The root `app.py` exposes the same FastAPI application to Vercel. The checked-in `vercel.json` builds the static frontend and prepares its files for hosting beside the API. Deploy from the repository root, using an authorized local [Vercel CLI](https://vercel.com/docs/cli):

```sh
make verify
vercel link --yes --project marketbridge-demo
vercel deploy --yes --project marketbridge-demo
```

The command creates a preview deployment and prints its URL. Open that URL and verify `/health`, all scenarios, and the export controls. Use `vercel curl /health --deployment <deployment-url>` when checking a protected preview through the CLI. The configuration and commands alone do not establish a successful hosted deployment. The GitHub verification workflow does not deploy automatically.

## Research context

[MarketBridge-build-plan.md](MarketBridge-build-plan.md), [MarketBridge-debate-conclusion.md](MarketBridge-debate-conclusion.md), and [research-papers.md](research-papers.md) preserve the research and proposed next stages. Papers motivate evaluation and source-quality choices; they do not validate the fixture model or establish access to any provider's data.
