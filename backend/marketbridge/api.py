"""Read-only demo API and same-origin static dashboard host."""

from functools import lru_cache
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .scenarios import list_scenarios, run_scenario
from .evaluation import evaluate_all
from .models import DATA_MODE, RUN_MODES, SOURCE_CONFIG
from .adapters.hyperliquid import HyperliquidAdapter
from .adapters.solana_tokens import SolanaTokensAdapter

ROOT = Path(__file__).resolve().parents[2]
WEB = Path(os.environ.get("MARKETBRIDGE_WEB_DIR", str(ROOT / "apps" / "web" / "out"))).resolve()

app = FastAPI(
    title="MarketBridge Demo API",
    version="0.1.0",
    description="Deterministic off-hours reference pricing and live weekend source adapters.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["GET"],
    allow_headers=["Accept"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if request.url.path.startswith("/v1/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/health")
def health():
    current_mode = os.environ.get("MARKETBRIDGE_DATA_MODE", DATA_MODE)
    return {
        "status": "ok",
        "data_mode": current_mode,
        "available_modes": list(RUN_MODES),
        "web_ready": (WEB / "index.html").exists(),
    }


@app.get("/v1/demo/scenarios")
def scenarios():
    current_mode = os.environ.get("MARKETBRIDGE_DATA_MODE", DATA_MODE)
    return {
        "scenarios": list_scenarios(),
        "symbols": [
            {"symbol": "NVDA", "name": "NVIDIA", "base_price": 182.5},
            {"symbol": "TSLA", "name": "Tesla", "base_price": 346.8},
        ],
        "data_mode": current_mode,
        "available_modes": list(RUN_MODES),
    }


@app.get("/v1/live/sources")
def live_sources():
    """Information on live weekend sources for the Saturday off-hours demo."""
    hl = HyperliquidAdapter()
    sol = SolanaTokensAdapter()
    return {
        "data_mode": os.environ.get("MARKETBRIDGE_DATA_MODE", "LIVE"),
        "sources": {
            "hyperliquid_oracle": {
                "name": SOURCE_CONFIG["hyperliquid_oracle"][0],
                "family": SOURCE_CONFIG["hyperliquid_oracle"][1],
                "role": "evidence",
                "endpoint": hl.info_url,
            },
            "hyperliquid_mark": {
                "name": SOURCE_CONFIG["hyperliquid_mark"][0],
                "family": SOURCE_CONFIG["hyperliquid_mark"][1],
                "role": "comparator_only",
                "endpoint": hl.info_url,
            },
            "xstocks": {
                "name": SOURCE_CONFIG["xstocks"][0],
                "family": SOURCE_CONFIG["xstocks"][1],
                "role": "evidence",
                "endpoint": sol.api_url,
            },
            "ondo": {
                "name": SOURCE_CONFIG["ondo"][0],
                "family": SOURCE_CONFIG["ondo"][1],
                "role": "evidence",
                "endpoint": sol.api_url,
            },
        },
    }


@lru_cache(maxsize=12)
def _trace(scenario_id: str, symbol: str):
    return run_scenario(scenario_id, symbol)


@app.get("/v1/demo/scenarios/{scenario_id}")
def scenario(scenario_id: str, symbol: str = Query(default="NVDA", max_length=8)):
    if scenario_id not in {item["id"] for item in list_scenarios()} or symbol not in {"NVDA", "TSLA"}:
        raise HTTPException(status_code=404, detail="Unknown scenario or symbol")
    return _trace(scenario_id, symbol)


@lru_cache(maxsize=1)
def _evaluation():
    return evaluate_all()


@app.get("/v1/demo/evaluation")
def evaluation():
    return _evaluation()


if (WEB / "_next").is_dir():
    app.mount("/_next", StaticFiles(directory=WEB / "_next"), name="next-assets")


@app.get("/{asset_path:path}", include_in_schema=False)
def dashboard(asset_path: str):
    if asset_path.startswith(("v1/", ".")):
        raise HTTPException(status_code=404, detail="Not found")
    target = (WEB / (asset_path or "index.html")).resolve()
    if not target.is_relative_to(WEB):
        raise HTTPException(status_code=404, detail="Not found")
    if target.is_file():
        return FileResponse(target)
    if asset_path == "":
        return JSONResponse(
            status_code=503,
            content={"detail": "Dashboard not built. Run make build, then restart make serve."},
        )
    raise HTTPException(status_code=404, detail="Not found")
