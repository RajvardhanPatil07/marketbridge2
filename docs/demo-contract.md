# MarketBridge demo integration contract

Scope: six deterministic synthetic scenarios for NVDA and TSLA. All input prices, events and outcomes are synthetic. No live-data or empirical stock-performance claims. User specifically requests CoinMarketCap-inspired design and NO Impeccable skill.

Backend Python package lives in `backend/marketbridge`. FastAPI entrypoint is `marketbridge.api:app` (parent owns api.py). Core agent owns models.py, engine.py, scenarios.py, evaluation.py, fixtures and backend unit tests. Frontend agent owns apps/web entirely. Parent owns root packaging, API integration, docs, browser checks and deployment. Do not overwrite others' files.

Core exported functions: `list_scenarios() -> list[dict]`, `run_scenario(scenario_id: str, symbol: str) -> dict`, `evaluate_all() -> dict`. Unknown scenario or symbol raises ValueError. Outputs JSON-serializable finite values. Engine generates all steps sequentially, without future inputs.

GET /v1/demo/scenarios returns {scenarios: Scenario[], symbols: [{symbol:'NVDA',name:'NVIDIA',base_price:182.5},{symbol:'TSLA',name:'Tesla',base_price:346.8}], data_mode:'SYNTHETIC_TEST'}.

Scenario = {id,title,description,expected_outcome,duration_seconds,event_count,symbols:['NVDA','TSLA']}. IDs: normal, bad-print, genuine-move, dropout, reopening, single-source. Use 61 steps at seconds 0..60, with main event around second 24 and corroboration around 27; duration_seconds=60. Actual event_count defined from fixtures.

GET /v1/demo/scenarios/{id}?symbol=NVDA returns Trace = {scenario:Scenario,symbol,initial_price,model_version,data_mode:'SYNTHETIC_TEST',steps:Step[],assumptions:string[],metrics:Metrics}.

Step = {index:number,seconds:number,timestamp:string,reference:number|null,last_valid:number|null,comparator:number,factor:number,baseline:number,lower:number|null,upper:number|null,quality:'QUALIFIED'|'CAUTION'|'INSUFFICIENT_EVIDENCE'|'RECOVERING',assessment:'ACCEPT'|'REJECT'|'QUARANTINE'|'NONE',reasons:string[],source_count:number,age_seconds:number,sources:Source[],simulation:Simulation}.

Source = {id:string,name:string,family:string,price:number|null,event_time:string|null,age_seconds:number,status:'FRESH'|'STALE'|'QUARANTINED'|'MISSING',weight:number}. Every source clearly synthetic by trace mode and names/assumptions; names may indicate simulated exchange/source role. An IEX-like synthetic source may be named 'IEX · simulated'. No purported actual feed access.

Simulation = {equity:number|null,baseline_equity:number|null,new_exposure_allowed:boolean,exposure_limit:number,valuation_status:'RESOLVED'|'UNRESOLVED',reference_liquidated:boolean,baseline_liquidated:boolean}. Fixed long position, explicitly stated initial equity/units/maintenance/fees, independent common synthetic outcome for final ex-post scoring. Unavailable reference yields unresolved current valuation and blocks exposure, not zero loss. Preserve exited equity after liquidation; do not repeatedly liquidate/reopen each step.

Metrics = {availability_pct:number,quarantined_count:number,accepted_count:number,recovery_seconds:number|null,mae_bps:number|null,baseline_mae_bps:number|null,final_equity:number|null,baseline_final_equity:number|null,checks:{name:string,passed:boolean,detail:string}[]}. MAE is explicitly only against synthetic fixture truth. Counterfactuals have identical position/fee/fill assumptions and common synthetic outcome. No savings claims.

GET /v1/demo/evaluation returns {data_mode:'SYNTHETIC_TEST',evaluation_kind:'synthetic_functional_tests',model_version:string,summary:{total:number,passed:number,failed:number},cases:[{scenario_id,symbol,metrics:Metrics}],limitations:string[],research:[{title,url,application}]}.

UI: fetch same-origin API. Read-only client playback cursor (default begins index0 paused), scenario/symbol controls, play/pause/reset/step/scrub/speed, view tabs for overview/evaluation/methodology, working downloads of trace JSON, keyboard/phone friendly. Catch loading/error states. Persistent synthetic label; range label 'Model range · uncalibrated'. Do not draw future points in main price trace except optional empty axis. No fake nav buttons or fabricated performance counts. Derive stats from current data. Corporate logos unnecessary; use simple letter icons and original MarketBridge wordmark.

Frontend must export static output with Next.js output:'export'; no server-only routes or runtime next/font Google dependency. System sans stack or locally bundled font. Parent serves apps/web/out via FastAPI. Dev allowed next.config dev proxy only when not exporting, or use NEXT_PUBLIC_API_BASE=http://127.0.0.1:8000 with API allowing localhost3000. Production uses same origin.
