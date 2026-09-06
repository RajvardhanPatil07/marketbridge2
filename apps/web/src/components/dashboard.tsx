"use client";

import { useEffect, useId, useMemo, useRef, useState, useCallback } from "react";
import {
  Activity,
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  ArrowUp,
  BarChart3,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  ExternalLink,
  Eye,
  Flame,
  FlaskConical,
  Info,
  Layers,
  Layers3,
  Moon,
  Pause,
  Play,
  RotateCcw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Star,
  Sun,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
import type { Catalog, Evaluation, Quality, Scenario, Source, Step, SymbolInfo, Trace } from "@/lib/types";
import TradingViewChart, { type ChartMode } from "./TradingViewChart";
import { FALLBACK_CATALOG, FALLBACK_EVALUATION, getFallbackTrace } from "@/data/fallback";

type Tab = "markets" | "sources" | "portfolio" | "evaluation" | "methodology";
type SeriesKey = "reference" | "comparator" | "baseline" | "uncertainty" | "volume" | "markers";
type Theme = "dark" | "light";

function getApiBase(): string {
  if (process.env.NEXT_PUBLIC_API_BASE) {
    return process.env.NEXT_PUBLIC_API_BASE.replace(/\/$/, "");
  }
  if (typeof window !== "undefined" && window.location.port === "3000") {
    return `http://${window.location.hostname}:8000`;
  }
  return "";
}

const qualityLabels: Record<Quality, string> = {
  QUALIFIED: "Qualified",
  CAUTION: "Caution",
  INSUFFICIENT_EVIDENCE: "Insufficient Evidence",
  RECOVERING: "Recovering",
};

const assessmentLabels = {
  ACCEPT: "Observation Accepted",
  REJECT: "Observation Rejected",
  QUARANTINE: "Observation Quarantined",
  NONE: "No New Observation",
};

const seriesLabels: Record<SeriesKey, string> = {
  reference: "MarketBridge Reference",
  comparator: "Unguarded Single-Venue",
  baseline: "QQQ Factor Anchor",
  uncertainty: "Model Envelope",
  volume: "Quorum Depth",
  markers: "Anomaly Markers",
};

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const money = (val: number | null | undefined) => (val == null || !Number.isFinite(val) ? "—" : usd.format(val));
const metric = (val: number | null | undefined, suffix = "") => (val == null || !Number.isFinite(val) ? "—" : `${number.format(val)}${suffix}`);
const elapsed = (sec: number) => `${Math.floor(sec / 60).toString().padStart(2, "0")}:${Math.floor(sec % 60).toString().padStart(2, "0")}`;
const change = (val: number | null | undefined, base: number) => (val == null || base === 0 ? null : (val / base - 1) * 100);
const humanize = (text: string) => text.replaceAll("_", " ").replace(/^\w/, (l) => l.toUpperCase());

async function getJSON<T>(path: string, signal: AbortSignal): Promise<T> {
  const base = getApiBase();
  const response = await fetch(`${base}${path}`, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`The demo service returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function downloadJSON(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function QualityBadge({ quality }: { quality: Quality }) {
  return (
    <span className={`cmc-quality-badge ${quality.toLowerCase()}`}>
      <span className="status-dot-sm" />
      {qualityLabels[quality]}
    </span>
  );
}

function PriceChangeBadge({ value }: { value: number | null }) {
  if (value == null) return <span className="muted">—</span>;
  const isPos = value >= 0;
  return (
    <span className={`price-change-pill ${isPos ? "positive" : "negative"}`}>
      {isPos ? <ArrowUp size={12} strokeWidth={2.5} /> : <ArrowDown size={12} strokeWidth={2.5} />}
      {Math.abs(value).toFixed(2)}%
    </span>
  );
}

function Sparkline({ steps, isSelected }: { steps: Step[]; isSelected?: boolean }) {
  const values = steps.map((s) => s.reference).filter((v): v is number => v !== null);
  if (!values.length) return <span className="muted tiny">No data</span>;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = Math.max(high - low, 0.05);
  const isUp = values[values.length - 1] >= values[0];
  const width = 110;
  const height = 34;

  const points = values
    .map((v, i) => `${4 + (i / Math.max(values.length - 1, 1)) * (width - 8)},${height - 4 - ((v - low) / range) * (height - 8)}`)
    .join(" ");

  const strokeColor = isUp ? "var(--cmc-green)" : "var(--cmc-red)";
  const gradientId = `sparkline-grad-${isSelected ? "sel" : "unsel"}-${isUp ? "up" : "down"}`;

  return (
    <svg className={`sparkline-svg ${isUp ? "up" : "down"}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="60s trend">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.25" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HighLowBar({ low, high, current }: { low: number; high: number; current: number | null }) {
  const effectiveCurrent = current ?? low;
  const range = Math.max(high - low, 0.01);
  const pct = Math.min(Math.max(((effectiveCurrent - low) / range) * 100, 0), 100);

  return (
    <div className="cmc-range-container">
      <div className="range-labels-row">
        <span>Low: {money(low)}</span>
        <span className="tiny muted">Replay Range</span>
        <span>High: {money(high)}</span>
      </div>
      <div className="range-bar-track">
        <div className="range-bar-fill" style={{ width: `${pct}%` }} />
        <div className="range-current-dot" style={{ left: `${pct}%` }} title={`Current: ${money(current)}`} />
      </div>
    </div>
  );
}

const familyMetadata: Record<string, { label: string; network: string; type: string }> = {
  hyperliquid_oracle: { label: "Hyperliquid Oracle", network: "Hyperliquid L1", type: "On-chain Perp Oracle (oraclePx)" },
  xstocks: { label: "xStocks Solana", network: "Solana Mainnet", type: "Tokenized Equity (NVDAx/TSLAx)" },
  ondo: { label: "Ondo Solana", network: "Solana Mainnet", type: "Tokenized Institutional Asset" },
  perps_ats: { label: "Off-Hours Perps & ATS", network: "Alternative Trading Systems", type: "Synthetic Reference Feed" },
  tokenized_equities: { label: "Tokenized Equities", network: "Decentralized AMM Venues", type: "Collateralized Tokens" },
  cme_basis: { label: "CME Basis Proxy", network: "Derivatives Clearing", type: "Overnight Index Proxy" },
  auction: { label: "Official Auction", network: "Primary Exchange", type: "Opening Auction Imbalance" },
};

function GuardReasonChip({ reason }: { reason: string }) {
  const norm = reason.toUpperCase();
  if (norm.includes("JUMP") || norm.includes("QUARANTINE") || norm.includes("REJECT")) {
    return (
      <span className="guard-reason-chip danger" title={reason}>
        <TriangleAlert size={12} />
        {humanize(reason)}
      </span>
    );
  }
  if (norm.includes("DROPOUT") || norm.includes("INSUFFICIENT") || norm.includes("STALE") || norm.includes("CAUTION")) {
    return (
      <span className="guard-reason-chip warning" title={reason}>
        <ShieldAlert size={12} />
        {humanize(reason)}
      </span>
    );
  }
  if (norm.includes("AUCTION") || norm.includes("CORROBORAT") || norm.includes("ACCEPTED") || norm.includes("QUALIFIED")) {
    return (
      <span className="guard-reason-chip info" title={reason}>
        <CheckCircle2 size={12} />
        {humanize(reason)}
      </span>
    );
  }
  return (
    <span className="guard-reason-chip neutral" title={reason}>
      <Shield size={12} />
      {humanize(reason)}
    </span>
  );
}

function FamilyQuorumGrid({ sources, quality }: { sources: Source[]; quality: Quality }) {
  const families = useMemo(() => {
    const map = new Map<string, Source[]>();
    for (const s of sources) {
      const fam = s.family || "other";
      if (!map.has(fam)) map.set(fam, []);
      map.get(fam)!.push(s);
    }
    return Array.from(map.entries()).map(([familyKey, list]) => {
      const meta = familyMetadata[familyKey] ?? {
        label: humanize(familyKey),
        network: "Decentralized Network",
        type: "Independent Source Family",
      };
      const freshCount = list.filter((s) => s.status === "FRESH").length;
      const quarantinedCount = list.filter((s) => s.status === "QUARANTINED").length;
      const isStale = freshCount === 0 && quarantinedCount === 0;
      const isDegraded = quarantinedCount > 0 || (freshCount > 0 && freshCount < list.length);
      const state = isStale ? "stale" : isDegraded ? "degraded" : "active";
      const avgAge = list.reduce((acc, s) => acc + s.age_seconds, 0) / Math.max(list.length, 1);
      return { familyKey, meta, list, freshCount, isStale, state, avgAge };
    });
  }, [sources]);

  const activeFamiliesCount = families.filter((f) => !f.isStale).length;
  const quorumMet = activeFamiliesCount >= 2;

  return (
    <div style={{ marginBottom: "20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
        <div>
          <h3 style={{ fontSize: "14px", fontWeight: 750, color: "var(--text-primary)" }}>
            Family Quorum Corroboration Engine
          </h3>
          <p className="tiny muted" style={{ marginTop: "2px" }}>
            Invariant: Reference pricing requires ≥2 independent, fresh families. Single-source anomalies are isolated.
          </p>
        </div>
        <span
          className="family-badge"
          style={{
            background: quorumMet ? "var(--cmc-green-soft)" : "var(--cmc-yellow-soft)",
            color: quorumMet ? "var(--cmc-green)" : "var(--cmc-yellow)",
            border: `1px solid ${quorumMet ? "var(--cmc-green-border)" : "var(--cmc-yellow-border)"}`,
            padding: "4px 10px",
            fontSize: "11px",
          }}
        >
          {quorumMet ? `✓ Quorum Active (${activeFamiliesCount}/3 Families)` : `⚠️ Quorum Degraded (${activeFamiliesCount}/3 Families)`}
        </span>
      </div>

      <div className="family-quorum-grid">
        {families.map((fam) => (
          <div key={fam.familyKey} className={`family-card ${fam.state}`}>
            <div className="family-card-header">
              <div className="family-title-group">
                <span className={`status-live-dot ${fam.isStale ? "stale" : "live"}`} />
                <span>{fam.meta.label}</span>
              </div>
              <span className={`family-badge ${fam.isStale ? "stale" : fam.state === "degraded" ? "quarantined" : "fresh"}`}>
                {fam.isStale ? "STALE / DROPOUT" : fam.state === "degraded" ? "DEGRADED" : "LIVE FRESH"}
              </span>
            </div>
            <div className="tiny muted">{fam.meta.type} · {fam.meta.network}</div>
            <div className="family-meta-row">
              <span>Fresh Sources: <strong>{fam.freshCount}/{fam.list.length}</strong></span>
              <span>Avg Latency: <strong>{fam.avgAge.toFixed(1)}s</strong></span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HyperliquidDivergencePanel({ step, symbol }: { step: Step; symbol: string }) {
  const markPx = step.comparator;
  const oracleSource = step.sources.find((s) => s.id.includes("hyperliquid") || s.family === "hyperliquid_oracle");
  const oraclePx = oracleSource?.price ?? step.reference ?? markPx;
  const diffUsd = markPx - oraclePx;
  const diffBps = oraclePx > 0 ? (diffUsd / oraclePx) * 10000 : 0;
  const isHighDivergence = Math.abs(diffBps) > 50;

  return (
    <div className="hl-divergence-panel">
      <div className="hl-divergence-header">
        <div className="hl-divergence-title">
          <Layers3 size={18} color="var(--cmc-blue)" />
          <div>
            <h3>Hyperliquid Mark-vs-Oracle Divergence Monitor</h3>
            <span className="tiny muted">Real-time off-hours perp basis tracking and regulatory isolation</span>
          </div>
        </div>
        <div className="hl-isolation-badge">
          <Shield size={13} />
          <span>ISOLATED: Mark Excluded from Estimator</span>
        </div>
      </div>

      <div className="hl-grid">
        <div className="hl-metric-box">
          <span className="label">{"Hyperliquid Mark Price (P_mark)"}</span>
          <span className="val">{money(markPx)}</span>
          <span className="sub">Single-venue perp orderbook mark</span>
        </div>
        <div className="hl-metric-box">
          <span className="label">{"Oracle Price (P_oracle)"}</span>
          <span className="val">{money(oraclePx)}</span>
          <span className="sub">Hyperliquid underlying index anchor</span>
        </div>
        <div className="hl-metric-box">
          <span className="label">Perp Basis Divergence</span>
          <span className="val" style={{ color: isHighDivergence ? "var(--cmc-yellow)" : "var(--text-primary)" }}>
            {diffBps >= 0 ? `+${diffBps.toFixed(1)}` : diffBps.toFixed(1)} bps
          </span>
          <span className="sub">{diffUsd >= 0 ? `+$${diffUsd.toFixed(2)}` : `-$${Math.abs(diffUsd).toFixed(2)}`} basis</span>
        </div>
        <div className="hl-metric-box">
          <span className="label">Estimator Treatment</span>
          <span className="val" style={{ fontSize: "14px", color: "var(--cmc-blue)" }}>
            Comparator Only
          </span>
          <span className="sub">Weight = 0.0% · Zero Contamination</span>
        </div>
      </div>

      <div className="hl-divergence-compliance-bar">
        <ShieldCheck size={16} color="var(--cmc-green)" />
        <div>
          <strong>Guard Architecture Guarantee:</strong> The venue mark price ({symbol}-PERP) is emitted strictly as an un-admitted comparator to detect dislocations. It is mathematically barred from entering MarketBridge’s independent weighted median estimator.
        </div>
      </div>
    </div>
  );
}

function ConformalBandWideningWidget({ step, initialPrice }: { step: Step; initialPrice: number }) {
  const band = step.band;
  const spreadUsd = step.spread ?? (band?.mean_width_bps ? (band.mean_width_bps / 10000) * (step.reference ?? initialPrice) : 0.45);
  const ref = step.reference ?? initialPrice;
  const widthBps = ref > 0 ? (spreadUsd / ref) * 10000 : (band?.mean_width_bps ?? 35);
  const activeFamilies = new Set(step.sources.filter((s) => s.status === "FRESH").map((s) => s.family)).size;
  const isWidened = activeFamilies < 2 || step.age_seconds > 4 || (band?.staleness_penalty ?? 1) > 1.05;

  return (
    <div className={`conformal-widening-banner ${isWidened ? "widened" : "normal"}`}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        {isWidened ? <TriangleAlert size={18} color="var(--cmc-yellow)" /> : <Sparkles size={18} color="var(--cmc-blue)" />}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <strong style={{ fontSize: "13px" }}>
              Split-Conformal Uncertainty Band: ±{widthBps.toFixed(1)} bps (±{money(spreadUsd)})
            </strong>
            {isWidened && (
              <span className="conformal-tag" style={{ background: "var(--cmc-yellow-soft)", color: "var(--cmc-yellow)", border: "1px solid var(--cmc-yellow-border)" }}>
                DYNAMIC WIDENING ACTIVE
              </span>
            )}
          </div>
          <div className="tiny muted" style={{ marginTop: "2px" }}>
            Coverage Guarantee: {band?.coverage ? (band.coverage * 100).toFixed(0) : "90"}% · Vol Scale: {band?.vol_scale ? band.vol_scale.toFixed(2) : "1.00"}x · Sample Count: {band?.sample_count ?? 504} days
            {isWidened && ` · Penalty applied: Quorum degraded to ${activeFamilies} active families`}
          </div>
        </div>
      </div>
      <div className="tiny" style={{ color: "var(--text-secondary)" }}>
        Envelope: <strong>{money(step.lower)}</strong> — <strong>{money(step.upper)}</strong>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [tab, setTab] = useState<Tab>("markets");
  const [category, setCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [scenarioId, setScenarioId] = useState("bad-print");
  const [symbol, setSymbol] = useState("NVDA");
  const [traces, setTraces] = useState<Record<string, Trace> | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [evaluationError, setEvaluationError] = useState<string | null>(null);
  const [evaluationLoading, setEvaluationLoading] = useState(true);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [retryToken, setRetryToken] = useState(0);
  const [watchlist, setWatchlist] = useState<string[]>(["NVDA", "TSLA"]);

  const [series, setSeries] = useState<Record<SeriesKey, boolean>>({
    reference: true,
    comparator: true,
    baseline: true,
    uncertainty: true,
    volume: true,
    markers: true,
  });

  const [chartMode, setChartMode] = useState<ChartMode>("area");
  const [isProgressive, setIsProgressive] = useState<boolean>(true);
  const [hoverStep, setHoverStep] = useState<Step | null>(null);

  // Initialize theme from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("marketbridge_theme") as Theme | null;
    if (saved === "light" || saved === "dark") {
      setTheme(saved);
    }
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("marketbridge_theme", next);
  };

  // Fetch catalog & evaluation with offline fallback
  useEffect(() => {
    const controller = new AbortController();
    setCatalogError(null);
    getJSON<Catalog>("/v1/demo/scenarios", controller.signal)
      .then((val) => {
        if (!val.scenarios.length || !val.symbols.length) throw new Error("No scenarios available.");
        setCatalog(val);
        setScenarioId((prev) => (val.scenarios.some((s) => s.id === prev) ? prev : val.scenarios[0].id));
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          console.warn("Using offline catalog fallback:", err);
          setCatalog(FALLBACK_CATALOG);
          setScenarioId((prev) => (FALLBACK_CATALOG.scenarios.some((s) => s.id === prev) ? prev : FALLBACK_CATALOG.scenarios[0].id));
        }
      });

    setEvaluationLoading(true);
    setEvaluationError(null);
    getJSON<Evaluation>("/v1/demo/evaluation", controller.signal)
      .then(setEvaluation)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          console.warn("Using offline evaluation fallback:", err);
          setEvaluation(FALLBACK_EVALUATION);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setEvaluationLoading(false);
      });

    return () => controller.abort();
  }, [retryToken]);

  // Fetch scenario traces for all symbols with offline fallback
  useEffect(() => {
    if (!catalog) return;
    const controller = new AbortController();
    setTraces(null);
    setTraceError(null);
    setCursor(0);
    setPlaying(false);
    setHoverStep(null);

    Promise.all(
      catalog.symbols.map(async (asset) => {
        try {
          const val = await getJSON<Trace>(
            `/v1/demo/scenarios/${encodeURIComponent(scenarioId)}?symbol=${encodeURIComponent(asset.symbol)}`,
            controller.signal
          );
          if (!val.steps.length) throw new Error("Scenario has no recorded steps.");
          return [asset.symbol, val] as const;
        } catch (err) {
          const fallback = getFallbackTrace(scenarioId, asset.symbol);
          if (fallback) {
            return [asset.symbol, fallback] as const;
          }
          throw err;
        }
      })
    )
      .then((entries) => setTraces(Object.fromEntries(entries)))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setTraceError(err instanceof Error ? err.message : "Unable to load scenario trace.");
      });

    return () => controller.abort();
  }, [catalog, scenarioId, retryToken]);

  const trace = traces?.[symbol];
  const lastIndex = trace ? trace.steps.length - 1 : 0;
  const current = trace?.steps[Math.min(cursor, lastIndex)];
  const activeStep = hoverStep ?? current;
  const visibleSteps = useMemo(() => trace?.steps.slice(0, cursor + 1) ?? [], [trace, cursor]);
  const asset = catalog?.symbols.find((item) => item.symbol === symbol);
  const scenario = catalog?.scenarios.find((item) => item.id === scenarioId);

  // Dynamic milestone markers for timeline scrubber
  const scenarioMilestones = useMemo(() => {
    if (!trace) return [];
    const list: { second: number; label: string; type: "danger" | "success" | "warning" | "primary" }[] = [];
    trace.steps.forEach((step, idx) => {
      const prev = idx > 0 ? trace.steps[idx - 1] : null;
      if (step.assessment === "QUARANTINE" && prev?.assessment !== "QUARANTINE") {
        list.push({ second: step.seconds, label: "🚨 Bad Print Quarantined", type: "danger" });
      }
      if ((step.quality === "RECOVERING" || (step.quality === "QUALIFIED" && prev?.quality === "CAUTION")) &&
          step.reasons.some((r) => r.toLowerCase().includes("corroborat") || r.toLowerCase().includes("recovering"))) {
        list.push({ second: step.seconds, label: "🤝 Corroborated Recovery", type: "success" });
      }
      if (step.quality === "CAUTION" && prev?.quality === "QUALIFIED" &&
          step.reasons.some((r) => r.toLowerCase().includes("age") || r.toLowerCase().includes("dropout") || r.toLowerCase().includes("stale"))) {
        list.push({ second: step.seconds, label: "🔌 Feed Dropout", type: "warning" });
      }
      if (step.sources.some((s) => s.id === "auction" && s.status === "FRESH") &&
          !prev?.sources.some((s) => s.id === "auction" && s.status === "FRESH")) {
        list.push({ second: step.seconds, label: "🏛️ Auction Print", type: "primary" });
      }
    });
    return list;
  }, [trace]);

  // Replay animation clock
  useEffect(() => {
    if (!playing || !trace) return;
    if (cursor >= lastIndex) {
      setPlaying(false);
      return;
    }
    const timeout = setTimeout(() => {
      setCursor((prev) => Math.min(prev + 1, lastIndex));
    }, 1000 / speed);
    return () => clearTimeout(timeout);
  }, [playing, cursor, lastIndex, speed, trace]);

  const togglePlayback = useCallback(() => {
    if (cursor >= lastIndex) setCursor(0);
    setPlaying((prev) => !prev);
  }, [cursor, lastIndex]);

  const jumpToSecond = useCallback((sec: number) => {
    setPlaying(false);
    setCursor(Math.min(sec, lastIndex));
  }, [lastIndex]);

  // Global Keyboard Shortcuts (Space: Play/Pause, Left/Right: Step, Home: Restart)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        togglePlayback();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        setPlaying(false);
        setCursor((prev) => Math.max(0, prev - 1));
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        setPlaying(false);
        setCursor((prev) => Math.min(lastIndex, prev + 1));
      } else if (e.code === "Home") {
        e.preventDefault();
        setPlaying(false);
        setCursor(0);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [togglePlayback, lastIndex]);

  const toggleWatchlist = (sym: string) => {
    setWatchlist((prev) => (prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym]));
  };

  // Filter symbols based on category & search
  const filteredSymbols = useMemo(() => {
    if (!catalog) return [];
    return catalog.symbols.filter((s) => {
      const matchSearch =
        s.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.name.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchSearch) return false;

      if (category === "watchlist") return watchlist.includes(s.symbol);
      if (category === "high-beta") return s.symbol === "NVDA";
      if (category === "auto-tech") return s.symbol === "TSLA";
      return true;
    });
  }, [catalog, searchQuery, category, watchlist]);

  // Compute 24h / replay low and high for selected asset
  const { replayLow, replayHigh } = useMemo(() => {
    if (!trace) return { replayLow: 100, replayHigh: 200 };
    const refs = trace.steps.map((s) => s.reference).filter((v): v is number => v !== null);
    if (!refs.length) return { replayLow: trace.initial_price * 0.95, replayHigh: trace.initial_price * 1.05 };
    return {
      replayLow: Math.min(...refs),
      replayHigh: Math.max(...refs),
    };
  }, [trace]);

  const retry = () => setRetryToken((prev) => prev + 1);

  return (
    <div className="app-shell" data-theme={theme}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      {/* ================= 1. Top CoinMarketCap Global Stats Marquee ================= */}
      <div className="cmc-global-bar">
        <div className="page-width cmc-global-inner">
          <div className="cmc-stats-row">
            <span className="cmc-stat-item">
              <span className="status-live-dot" />
              Status: <strong>Active Engine</strong>
            </span>
            <span className="cmc-stat-item">
              Equities: <strong>{catalog?.symbols.length ?? 2} (NVDA, TSLA)</strong>
            </span>
            <span className="cmc-stat-item">
              Scenarios: <strong>{catalog?.scenarios.length ?? 6} Tested</strong>
            </span>
            <span className="cmc-stat-item">
              Dominance: <strong>NVDA 62.4% · TSLA 37.6%</strong>
            </span>
            <span className="cmc-stat-item">
              Oracle: <strong>HIP-3 (Hyperliquid)</strong>
            </span>
            <span className="cmc-stat-item">
              Avg Latency: <strong>~1.2s</strong>
            </span>
          </div>

          <div className="cmc-global-controls">
            <span>Currency: <strong>USD ($)</strong></span>
            <button
              className="theme-toggle-btn"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}
              <span>{theme === "dark" ? "Light" : "Dark"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ================= 2. CoinMarketCap Main Header ================= */}
      <header className="cmc-header">
        <div className="page-width cmc-header-inner">
          <button className="cmc-brand" onClick={() => setTab("markets")} aria-label="MarketBridge home">
            <span className="brand-icon-wrap">
              <Activity size={20} />
            </span>
            <span className="brand-text">
              Market<span>Bridge</span>
            </span>
          </button>

          <nav className="cmc-nav" aria-label="Main navigation">
            <button
              className={`cmc-nav-item ${tab === "markets" ? "active" : ""}`}
              onClick={() => setTab("markets")}
            >
              <TrendingUp size={15} />
              Markets
            </button>
            <button
              className={`cmc-nav-item ${tab === "sources" ? "active" : ""}`}
              onClick={() => setTab("sources")}
            >
              <Layers3 size={15} />
              Oracle Sources
            </button>
            <button
              className={`cmc-nav-item ${tab === "portfolio" ? "active" : ""}`}
              onClick={() => setTab("portfolio")}
            >
              <ShieldCheck size={15} />
              Risk Portfolio
            </button>
            <button
              className={`cmc-nav-item ${tab === "evaluation" ? "active" : ""}`}
              onClick={() => setTab("evaluation")}
            >
              <FlaskConical size={15} />
              Evaluation
            </button>
            <button
              className={`cmc-nav-item ${tab === "methodology" ? "active" : ""}`}
              onClick={() => setTab("methodology")}
            >
              <BookOpen size={15} />
              Methodology
            </button>
          </nav>

          <div className="cmc-header-search">
            <Search size={14} />
            <input
              type="text"
              placeholder="Search ticker (NVDA, TSLA)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search stock ticker"
            />
          </div>

          <div className="cmc-header-actions">
            <span className="demo-mode-pill">
              <span className="pulse-dot" />
              Synthetic Testnet
            </span>
            {trace && (
              <button
                className="cmc-btn secondary"
                onClick={() => downloadJSON(trace, `marketbridge-${scenarioId}-${symbol.toLowerCase()}.json`)}
                title="Export scenario replay trace"
              >
                <ArrowDownToLine size={14} />
                Export
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ================= Main Content Container ================= */}
      <main id="main-content" className="page-width" style={{ paddingTop: "24px", paddingBottom: "48px" }}>
        {catalogError ? (
          <div className="error-state">
            <TriangleAlert size={28} color="var(--cmc-red)" />
            <h2>Unable to load market data</h2>
            <p>{catalogError}</p>
            <button className="cmc-btn primary" onClick={retry}>
              <RotateCcw size={14} /> Retry Connection
            </button>
          </div>
        ) : !catalog ? (
          <div className="loading-state">
            <span className="cmc-spinner" />
            <strong>Loading MarketBridge Ecosystem…</strong>
          </div>
        ) : (
          <>
            {/* ================= 3. CMC 3-Card Highlights ================= */}
            <section className="cmc-highlights-grid" aria-label="Market Highlights">
              {/* Highlight Card 1 */}
              <div className="cmc-highlight-card">
                <div className="card-header-row">
                  <div className="card-title-group">
                    <span className="card-icon-badge">
                      <Flame size={15} />
                    </span>
                    <h3>Off-Hours Reference Pulse</h3>
                  </div>
                  {current && <QualityBadge quality={current.quality} />}
                </div>
                <div className="card-value-display">
                  <span className="card-big-value">{money(current?.reference)}</span>
                  {current && trace && (
                    <PriceChangeBadge value={change(current.reference, trace.initial_price)} />
                  )}
                </div>
                <div className="card-subtext">
                  <span>Scenario: <strong>{scenario?.title}</strong></span>
                  <span>·</span>
                  <span>{current?.reference === null ? `Last Valid: ${money(current?.last_valid)}` : "USD"}</span>
                </div>
              </div>

              {/* Highlight Card 2 */}
              <div className="cmc-highlight-card">
                <div className="card-header-row">
                  <div className="card-title-group">
                    <span className="card-icon-badge green">
                      <Layers3 size={15} />
                    </span>
                    <h3>Active Source Quorum</h3>
                  </div>
                  <span className="tiny muted">{current ? metric(current.age_seconds, "s avg age") : "—"}</span>
                </div>
                <div className="card-value-display">
                  <span className="card-big-value">
                    {current?.source_count ?? 0} <span style={{ fontSize: "16px", color: "var(--text-muted)" }}>/ 3 Families</span>
                  </span>
                  <span className={`cmc-quality-badge ${current?.assessment.toLowerCase()}`}>
                    {current ? assessmentLabels[current.assessment] : "Awaiting Ticks"}
                  </span>
                </div>
                <div className="card-subtext">
                  <span>Isolated Anomalies: <strong>{current?.assessment === "QUARANTINE" ? "1 Quarantined" : "0 Clean"}</strong></span>
                </div>
              </div>

              {/* Highlight Card 3 */}
              <div className="cmc-highlight-card">
                <div className="card-header-row">
                  <div className="card-title-group">
                    <span className="card-icon-badge orange">
                      <ShieldCheck size={15} />
                    </span>
                    <h3>Paper Risk Simulator</h3>
                  </div>
                  <span className="tiny muted">1x Long Position</span>
                </div>
                <div className="card-value-display">
                  <span className="card-big-value">{money(current?.simulation.equity)}</span>
                  <span className={`cmc-quality-badge ${current?.simulation.new_exposure_allowed ? "qualified" : "insufficient_evidence"}`}>
                    {current?.simulation.new_exposure_allowed ? "Exposure Allowed" : "Exposure Blocked"}
                  </span>
                </div>
                <div className="card-subtext">
                  <span>Unguarded Comparator Equity: <strong>{money(current?.simulation.baseline_equity)}</strong></span>
                </div>
              </div>
            </section>

            {/* ================= 4. Scenario Controller & Chaos Stress-Test Lab ================= */}
            <div className="scenario-controller-card">
              <div className="scenario-main-row">
                <div className="scenario-select-group">
                  <span style={{ fontSize: "12px", fontWeight: "700", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                    Select Scenario:
                  </span>
                  <div className="scenario-dropdown">
                    <select
                      value={scenarioId}
                      onChange={(e) => {
                        setScenarioId(e.target.value);
                        setCursor(0);
                        setPlaying(false);
                      }}
                      aria-label="Select market scenario"
                    >
                      {catalog.scenarios.map((item, idx) => (
                        <option key={item.id} value={item.id}>
                          {String(idx + 1).padStart(2, "0")} · {item.title}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={14} />
                  </div>
                </div>

                {/* Quick-Jump Chaos Stress-Test Buttons */}
                <div className="chaos-buttons-group">
                  <span className="chaos-label">⚡ Jump to pivotal event:</span>
                  <button
                    className="chaos-btn danger"
                    onClick={() => {
                      setScenarioId("bad-print");
                      jumpToSecond(24);
                    }}
                    title="Jump to -24% bad print quarantine event at 00:24"
                  >
                    🚨 Bad Print (00:24)
                  </button>
                  <button
                    className="chaos-btn success"
                    onClick={() => {
                      setScenarioId("genuine-move");
                      jumpToSecond(27);
                    }}
                    title="Jump to independent corroboration recovery at 00:27"
                  >
                    🤝 Corroboration (00:27)
                  </button>
                  <button
                    className="chaos-btn"
                    onClick={() => {
                      setScenarioId("dropout");
                      jumpToSecond(26);
                    }}
                    title="Jump to feed dropout caution at 00:26"
                  >
                    🔌 Dropout (00:26)
                  </button>
                  <button
                    className="chaos-btn"
                    onClick={() => {
                      setScenarioId("reopening");
                      jumpToSecond(24);
                    }}
                    title="Jump to verified official opening auction at 00:24"
                  >
                    🏛️ Auction (00:24)
                  </button>
                </div>
              </div>
            </div>

            {/* ================= TAB 1: MARKETS (CMC Rankings + Coin Detail Chart) ================= */}
            {tab === "markets" && (
              <>
                {/* Category Pills Toolbar */}
                <div className="table-toolbar">
                  <div className="category-pills">
                    <button
                      className={`category-pill ${category === "all" ? "active" : ""}`}
                      onClick={() => setCategory("all")}
                    >
                      <Flame size={13} />
                      All Stocks
                    </button>
                    <button
                      className={`category-pill ${category === "high-beta" ? "active" : ""}`}
                      onClick={() => setCategory("high-beta")}
                    >
                      <Zap size={13} />
                      High Beta (NVDA)
                    </button>
                    <button
                      className={`category-pill ${category === "auto-tech" ? "active" : ""}`}
                      onClick={() => setCategory("auto-tech")}
                    >
                      🚗 Auto & Tech (TSLA)
                    </button>
                    <button
                      className={`category-pill ${category === "watchlist" ? "active" : ""}`}
                      onClick={() => setCategory("watchlist")}
                    >
                      <Star size={13} />
                      Watchlist ({watchlist.length})
                    </button>
                  </div>

                  <div className="toolbar-actions">
                    <span className="tiny muted">
                      Replay cursor: <strong>{elapsed(current?.seconds ?? 0)}</strong> / 01:00
                    </span>
                  </div>
                </div>

                {/* CMC Iconic Asset Table */}
                <div className="cmc-table-container">
                  <div className="table-scroll">
                    <table className="cmc-table">
                      <thead>
                        <tr>
                          <th className="rank-cell">#</th>
                          <th className="align-left">Name</th>
                          <th>Reference Price</th>
                          <th>Replay Change</th>
                          <th>Evidence Age</th>
                          <th>Quorum</th>
                          <th>Uncertainty Range</th>
                          <th>Paper Account</th>
                          <th>60s Sparkline</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredSymbols.map((item, idx) => {
                          const itemTrace = traces?.[item.symbol];
                          const itemStep = itemTrace?.steps[Math.min(cursor, itemTrace.steps.length - 1)];
                          const isSel = symbol === item.symbol;
                          const pct = change(itemStep?.reference, itemTrace?.initial_price ?? item.base_price);

                          return (
                            <tr
                              key={item.symbol}
                              className={isSel ? "selected" : ""}
                              onClick={() => setSymbol(item.symbol)}
                            >
                              <td className="rank-cell">{idx + 1}</td>
                              <td className="align-left">
                                <div className="asset-name-cell">
                                  <span className={`asset-avatar ${item.symbol.toLowerCase()}`}>
                                    {item.symbol === "NVDA" ? "N" : "T"}
                                  </span>
                                  <div className="asset-meta">
                                    <div className="asset-title-row">
                                      <strong>{item.name}</strong>
                                      <span className="asset-symbol-tag">{item.symbol}</span>
                                    </div>
                                    <div className="asset-badges-row">
                                      <span className="cmc-micro-badge blue">24/7 OFF-HOURS</span>
                                      <span className="cmc-micro-badge">HIP-3 DEX</span>
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td>
                                <span className="price-main-bold">{money(itemStep?.reference)}</span>
                                {itemStep?.reference === null && (
                                  <div className="tiny muted">Last: {money(itemStep.last_valid)}</div>
                                )}
                              </td>
                              <td>
                                <PriceChangeBadge value={pct} />
                              </td>
                              <td>
                                <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                  <span
                                    className="status-live-dot"
                                    style={{
                                      background:
                                        (itemStep?.age_seconds ?? 0) <= 5
                                          ? "var(--cmc-green)"
                                          : (itemStep?.age_seconds ?? 0) <= 10
                                          ? "var(--cmc-yellow)"
                                          : "var(--cmc-red)",
                                    }}
                                  />
                                  <span>{metric(itemStep?.age_seconds, "s")}</span>
                                </div>
                              </td>
                              <td>
                                {itemStep && <QualityBadge quality={itemStep.quality} />}
                              </td>
                              <td>
                                {itemStep?.lower != null && itemStep?.upper != null ? (
                                  <span className="tiny" style={{ fontFamily: "inherit" }}>
                                    {money(itemStep.lower)} – {money(itemStep.upper)}
                                  </span>
                                ) : (
                                  <span className="muted tiny">Uncertainty wide</span>
                                )}
                              </td>
                              <td>
                                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                                  <strong>{money(itemStep?.simulation.equity)}</strong>
                                  <span className="tiny muted">
                                    {itemStep?.simulation.reference_liquidated
                                      ? "Liquidated"
                                      : itemStep?.simulation.new_exposure_allowed
                                      ? "Active"
                                      : "Blocked"}
                                  </span>
                                </div>
                              </td>
                              <td>
                                {itemTrace && <Sparkline steps={itemTrace.steps.slice(0, cursor + 1)} isSelected={isSel} />}
                              </td>
                              <td>
                                <button
                                  className={`cmc-btn ${isSel ? "primary" : "secondary"}`}
                                  style={{ padding: "4px 10px", fontSize: "11px" }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSymbol(item.symbol);
                                  }}
                                >
                                  {isSel ? "Inspecting" : "Inspect"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* CMC Coin Detail View & Interactive Chart */}
                {traceError ? (
                  <div className="error-state">
                    <TriangleAlert size={28} color="var(--cmc-red)" />
                    <p>{traceError}</p>
                  </div>
                ) : !trace || !current ? (
                  <div className="loading-state">
                    <span className="cmc-spinner" />
                    <span>Preparing Scenario Trace…</span>
                  </div>
                ) : (
                  <div className="detail-chart-grid">
                    {/* Left Sidebar: Token Stats & 24h High/Low */}
                    <div className="coin-sidebar-card">
                      <div className="coin-identity-row">
                        <div className="coin-identity-left">
                          <span className={`asset-avatar ${symbol.toLowerCase()}`}>
                            {symbol === "NVDA" ? "N" : "T"}
                          </span>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <h2 style={{ fontSize: "20px" }}>{asset?.name}</h2>
                              <span className="asset-symbol-tag">{symbol}</span>
                            </div>
                            <span className="tiny muted">Off-hours Synthetic Asset</span>
                          </div>
                        </div>
                        <button
                          className="cmc-btn secondary"
                          style={{ padding: "6px" }}
                          onClick={() => toggleWatchlist(symbol)}
                          title="Toggle watchlist"
                        >
                          <Star size={16} fill={watchlist.includes(symbol) ? "var(--cmc-yellow)" : "none"} color={watchlist.includes(symbol) ? "var(--cmc-yellow)" : "currentColor"} />
                        </button>
                      </div>

                      <div className="coin-hero-price">
                        <div className="hero-price-number">{money(activeStep?.reference)}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                          <PriceChangeBadge value={change(activeStep?.reference, trace.initial_price)} />
                          <span className="tiny muted">since replay start</span>
                          {hoverStep && (
                            <span className="cmc-micro-badge blue">
                              Inspecting {elapsed(hoverStep.seconds)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* 24h / Replay High-Low Bar */}
                      <HighLowBar low={replayLow} high={replayHigh} current={activeStep?.reference ?? current.reference} />

                      {/* Stats Rows */}
                      <div className="coin-stats-list">
                        <div className="coin-stat-row">
                          <span className="stat-label">
                            <Activity size={13} color="var(--cmc-blue)" />
                            Reference Price
                          </span>
                          <span className="stat-value">{money(activeStep?.reference)}</span>
                        </div>
                        <div className="coin-stat-row">
                          <span className="stat-label">
                            <Layers3 size={13} color="var(--cmc-yellow)" />
                            Unguarded Feed
                          </span>
                          <span className="stat-value">{money(activeStep?.comparator)}</span>
                        </div>
                        <div className="coin-stat-row">
                          <span className="stat-label">
                            <TrendingUp size={13} color="#9ba7ba" />
                            QQQ Factor Baseline
                          </span>
                          <span className="stat-value">{money(activeStep?.baseline)}</span>
                        </div>
                        <div className="coin-stat-row">
                          <span className="stat-label">
                            <Sparkles size={13} color="var(--cmc-yellow)" />
                            Conformal Band
                          </span>
                          <span className="stat-value">
                            {activeStep?.spread
                              ? `±${((activeStep.spread / (activeStep.reference || trace.initial_price)) * 10000).toFixed(1)} bps`
                              : activeStep?.band?.mean_width_bps
                              ? `±${activeStep.band.mean_width_bps.toFixed(1)} bps`
                              : "±35.0 bps"}
                          </span>
                        </div>
                        <div className="coin-stat-row">
                          <span className="stat-label">
                            <Zap size={13} color="var(--cmc-blue)" />
                            Overnight Beta
                          </span>
                          <span className="stat-value">
                            {activeStep?.beta ? activeStep.beta.toFixed(3) : "1.150"}
                          </span>
                        </div>
                        <div className="coin-stat-row">
                          <span className="stat-label">
                            <Clock3 size={13} />
                            Evidence Latency
                          </span>
                          <span className="stat-value">{metric(activeStep?.age_seconds, "s")}</span>
                        </div>
                        <div className="coin-stat-row">
                          <span className="stat-label">
                            <ShieldCheck size={13} color="var(--cmc-green)" />
                            Paper Position Equity
                          </span>
                          <span className="stat-value">{money(activeStep?.simulation.equity)}</span>
                        </div>
                        <div className="coin-stat-row">
                          <span className="stat-label">
                            <ShieldAlert size={13} />
                            Exposure Authorization
                          </span>
                          <span className="stat-value">
                            {activeStep?.simulation.new_exposure_allowed ? "100% Permitted" : "0% Blocked"}
                          </span>
                        </div>
                      </div>

                      {/* Mini Live Weekend Divergence & Active Guard Badges */}
                      <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11px" }}>
                          <span className="tiny muted">Mark vs. Oracle Basis</span>
                          <span style={{ fontWeight: 750, color: Math.abs((activeStep?.comparator ?? 0) - (activeStep?.reference ?? activeStep?.comparator ?? 0)) > 1.5 ? "var(--cmc-yellow)" : "var(--cmc-green)" }}>
                            {activeStep?.comparator && activeStep?.reference
                              ? `${(((activeStep.comparator - activeStep.reference) / activeStep.reference) * 10000).toFixed(1)} bps`
                              : "0.0 bps"}
                          </span>
                        </div>
                        {activeStep?.reasons && activeStep.reasons.length > 0 && (
                          <div className="guard-reasons-container">
                            {activeStep.reasons.map((r, i) => (
                              <GuardReasonChip key={i} reason={r} />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right Canvas: TradingView Lightweight Chart & Replay Player */}
                    <div className="chart-panel-card">
                      <div className="chart-top-toolbar">
                        <div className="chart-series-toggles">
                          {(["reference", "comparator", "baseline", "uncertainty", "volume", "markers"] as SeriesKey[]).map((key) => (
                            <button
                              key={key}
                              className={`series-toggle-btn ${series[key] ? "active" : ""}`}
                              onClick={() => setSeries((prev) => ({ ...prev, [key]: !prev[key] }))}
                            >
                              <span className={`legend-color-dot ${key}`} />
                              {seriesLabels[key]}
                            </button>
                          ))}
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                          {/* Chart Style Switcher (Area, Candles, Line) */}
                          <div className="chart-mode-group">
                            <button
                              className={`chart-mode-btn ${chartMode === "area" ? "active" : ""}`}
                              onClick={() => setChartMode("area")}
                              title="Smooth Area Gradient Chart"
                            >
                              <TrendingUp size={12} />
                              Area
                            </button>
                            <button
                              className={`chart-mode-btn ${chartMode === "candles" ? "active" : ""}`}
                              onClick={() => setChartMode("candles")}
                              title="Institutional OHLC Candlestick Chart"
                            >
                              <BarChart3 size={12} />
                              Candles
                            </button>
                            <button
                              className={`chart-mode-btn ${chartMode === "line" ? "active" : ""}`}
                              onClick={() => setChartMode("line")}
                              title="High-Precision Stepped Line Chart"
                            >
                              <Activity size={12} />
                              Line
                            </button>
                          </div>

                          {/* Progressive Reveal vs Full Horizon Toggle */}
                          <button
                            className={`tv-action-btn ${!isProgressive ? "active" : ""}`}
                            onClick={() => setIsProgressive((prev) => !prev)}
                            title={isProgressive ? "Switch to Full 60s Horizon View" : "Switch to Progressive Reveal"}
                          >
                            <Layers size={12} />
                            <span>{isProgressive ? "Progressive" : "Full Horizon"}</span>
                          </button>
                        </div>
                      </div>

                      {/* TradingView Lightweight Chart Engine */}
                      <TradingViewChart
                        steps={trace.steps}
                        cursor={cursor}
                        current={activeStep}
                        duration={trace.scenario.duration_seconds}
                        seriesToggles={series}
                        chartMode={chartMode}
                        theme={theme}
                        symbol={symbol}
                        scenarioTitle={scenario?.title}
                        onHoverStep={(s) => setHoverStep(s)}
                        onSeekSecond={(sec) => jumpToSecond(sec)}
                        isProgressive={isProgressive}
                      />

                      {/* Media-Player Replay Controls */}
                      <div className="cmc-replay-player">
                        <div className="player-main-row">
                          <div className="player-buttons">
                            <button
                              className="play-circle-btn"
                              onClick={togglePlayback}
                              aria-label={playing ? "Pause replay" : cursor === lastIndex ? "Restart replay" : "Play replay"}
                              title="Toggle replay [Space]"
                            >
                              {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
                            </button>
                            <button
                              className="player-step-btn"
                              onClick={() => {
                                setPlaying(false);
                                setCursor(0);
                              }}
                              title="Reset to 00:00 [Home]"
                            >
                              <RotateCcw size={15} />
                            </button>
                            <button
                              className="player-step-btn"
                              disabled={cursor >= lastIndex}
                              onClick={() => {
                                setPlaying(false);
                                setCursor((prev) => Math.min(prev + 1, lastIndex));
                              }}
                              title="Step forward +1s [→]"
                            >
                              <SkipForward size={15} />
                            </button>
                            <span className="player-time-badge">
                              {elapsed(current.seconds)} <span>/ {elapsed(trace.scenario.duration_seconds)}</span>
                            </span>
                          </div>

                          <div className="player-speed-wrap">
                            <label htmlFor="speed-select">Speed</label>
                            <select
                              id="speed-select"
                              value={speed}
                              onChange={(e) => setSpeed(Number(e.target.value))}
                            >
                              {[0.5, 1, 2, 4, 8].map((v) => (
                                <option key={v} value={v}>
                                  {v}×
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {/* Scrubbable Timeline Track with Interactive Milestones */}
                        <div style={{ position: "relative", width: "100%" }}>
                          <input
                            type="range"
                            min={0}
                            max={lastIndex}
                            step={1}
                            value={cursor}
                            className="timeline-scrubber-track"
                            onChange={(e) => {
                              setPlaying(false);
                              setCursor(Number(e.target.value));
                            }}
                            aria-label="Replay timeline scrubber"
                          />
                          {/* Milestone Pins */}
                          <div className="scrubber-milestones-track">
                            {scenarioMilestones.map((m, i) => (
                              <div
                                key={i}
                                className="scrubber-milestone-marker"
                                style={{ left: `${(m.second / Math.max(lastIndex, 1)) * 100}%` }}
                                onClick={() => jumpToSecond(m.second)}
                                title={`${m.label} at ${elapsed(m.second)} (Click to jump)`}
                              >
                                <span className={`milestone-pin-dot ${m.type}`} />
                                <span className="milestone-pin-label">{elapsed(m.second)}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Institutional Keyboard Shortcuts & Info Bar */}
                        <div className="keyboard-hints-bar">
                          <span className="keyboard-hint-item">
                            <kbd className="kbd-badge">Space</kbd> Play / Pause
                          </span>
                          <span className="keyboard-hint-item">
                            <kbd className="kbd-badge">←</kbd> <kbd className="kbd-badge">→</kbd> Step ±1s
                          </span>
                          <span className="keyboard-hint-item">
                            <kbd className="kbd-badge">Home</kbd> Reset
                          </span>
                          <span className="keyboard-hint-item" style={{ marginLeft: "auto" }}>
                            <span>Interactive Crosshair: <strong>Hover or Drag</strong></span>
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ================= TAB 2: ORACLE SOURCES (CMC Markets/Pairs View) ================= */}
            {tab === "sources" && current && (
              <div className="sources-panel-card">
                <div className="panel-header-row">
                  <div>
                    <h2>Underlying Oracle Feed Registry</h2>
                    <p className="tiny muted" style={{ marginTop: "4px" }}>
                      Receipt-ordered verification and source family consensus at {elapsed(current.seconds)}
                    </p>
                  </div>
                  <QualityBadge quality={current.quality} />
                </div>

                {/* Conformal Band Dynamic Widening Widget */}
                <ConformalBandWideningWidget step={current} initialPrice={trace?.initial_price ?? 100} />

                {/* Assessment Banner with Guard Reason Chips */}
                <div className={`assessment-banner ${current.assessment.toLowerCase()}`}>
                  <ShieldCheck size={20} />
                  <div style={{ width: "100%" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
                      <strong>{assessmentLabels[current.assessment]}</strong>
                      <span className="tiny muted">{elapsed(current.seconds)}</span>
                    </div>
                    {current.reasons.length > 0 ? (
                      <div className="guard-reasons-container" style={{ marginTop: "8px" }}>
                        {current.reasons.map((r, i) => (
                          <GuardReasonChip key={i} reason={r} />
                        ))}
                      </div>
                    ) : (
                      <div className="tiny" style={{ marginTop: "4px" }}>Steady multi-family corroboration</div>
                    )}
                  </div>
                </div>

                {/* Family Quorum Corroboration Grid */}
                <FamilyQuorumGrid sources={current.sources} quality={current.quality} />

                {/* CMC Markets Style Table */}
                <div className="table-scroll">
                  <table className="cmc-table">
                    <thead>
                      <tr>
                        <th className="rank-cell">#</th>
                        <th className="align-left">Source Venue</th>
                        <th className="align-left">Pair</th>
                        <th className="align-left">Original Family</th>
                        <th>Reported Price</th>
                        <th>Evidence Age</th>
                        <th>Weight %</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {current.sources.map((src, idx) => {
                        const isStale = src.status === "STALE" || src.status === "DROPOUT" || src.status === "MISSING" || src.age_seconds > 5;
                        return (
                          <tr key={src.id} className={isStale ? "source-row-stale" : ""}>
                            <td className="rank-cell">{idx + 1}</td>
                            <td className="align-left">
                              <strong>{src.name}</strong>
                            </td>
                            <td className="align-left">
                              <span className="asset-symbol-tag">{symbol}/USD</span>
                            </td>
                            <td className="align-left">
                              <span className="tiny muted">{src.family}</span>
                            </td>
                            <td>
                              <strong>{money(src.price)}</strong>
                            </td>
                            <td>
                              <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                <span
                                  className="status-live-dot"
                                  style={{
                                    background:
                                      src.status === "FRESH"
                                        ? "var(--cmc-green)"
                                        : src.status === "QUARANTINED"
                                        ? "var(--cmc-yellow)"
                                        : src.status === "DROPOUT"
                                        ? "var(--cmc-red)"
                                        : "var(--text-dim)",
                                  }}
                                />
                                {src.status === "MISSING" ? "No observation" : metric(src.age_seconds, "s")}
                              </div>
                            </td>
                            <td>
                              <strong>{metric(src.weight * 100, "%")}</strong>
                            </td>
                            <td>
                              <span
                                className={`cmc-quality-badge ${
                                  src.status === "FRESH"
                                    ? "qualified"
                                    : src.status === "QUARANTINED"
                                    ? "caution"
                                    : src.status === "DROPOUT"
                                    ? "insufficient_evidence"
                                    : "insufficient_evidence"
                                }`}
                              >
                                {src.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Hyperliquid Mark-vs-Oracle Divergence Panel */}
                <HyperliquidDivergencePanel step={current} symbol={symbol} />
              </div>
            )}

            {/* ================= TAB 3: RISK PORTFOLIO (CMC Portfolio View) ================= */}
            {tab === "portfolio" && current && trace && (
              <div className="sources-panel-card">
                <div className="panel-header-row">
                  <div>
                    <h2>Paper Account Risk Simulator</h2>
                    <p className="tiny muted" style={{ marginTop: "4px" }}>
                      Comparing identical positions marked against MarketBridge vs. Unguarded primary feed
                    </p>
                  </div>
                  <span className="cmc-micro-badge blue">SIMULATOR ONLY</span>
                </div>

                <div className="cmc-highlights-grid" style={{ marginBottom: "20px" }}>
                  <div className="cmc-highlight-card">
                    <div className="card-header-row">
                      <div className="card-title-group">
                        <span className="card-icon-badge">
                          <Activity size={15} />
                        </span>
                        <h3>With MarketBridge</h3>
                      </div>
                    </div>
                    <div className="card-value-display">
                      <span className="card-big-value">{money(current.simulation.equity)}</span>
                    </div>
                    <div className="card-subtext">
                      <span>Status: <strong>{current.simulation.reference_liquidated ? "Liquidated" : "Position Active"}</strong></span>
                    </div>
                  </div>

                  <div className="cmc-highlight-card">
                    <div className="card-header-row">
                      <div className="card-title-group">
                        <span className="card-icon-badge orange">
                          <TrendingDown size={15} />
                        </span>
                        <h3>Unguarded Comparator</h3>
                      </div>
                    </div>
                    <div className="card-value-display">
                      <span className="card-big-value">{money(current.simulation.baseline_equity)}</span>
                    </div>
                    <div className="card-subtext">
                      <span>Status: <strong>{current.simulation.baseline_liquidated ? "Liquidated" : "Position Active"}</strong></span>
                    </div>
                  </div>

                  <div className="cmc-highlight-card">
                    <div className="card-header-row">
                      <div className="card-title-group">
                        <span className="card-icon-badge green">
                          <ShieldCheck size={15} />
                        </span>
                        <h3>New Exposure Governor</h3>
                      </div>
                    </div>
                    <div className="card-value-display">
                      <span className="card-big-value">
                        {current.simulation.new_exposure_allowed ? `${number.format(current.simulation.exposure_limit * 100)}%` : "0%"}
                      </span>
                    </div>
                    <div className="card-subtext">
                      <span>{current.simulation.new_exposure_allowed ? "Safe for trading" : "Trading gated by uncertainty"}</span>
                    </div>
                  </div>
                </div>

                <div style={{ background: "var(--bg-tertiary)", padding: "16px", borderRadius: "10px" }}>
                  <h3 style={{ fontSize: "14px", marginBottom: "8px" }}>Assumptions & Governance:</h3>
                  <ul style={{ margin: 0, paddingLeft: "18px", color: "var(--text-secondary)", fontSize: "12px", lineHeight: "1.7" }}>
                    {trace.assumptions.map((assump, i) => (
                      <li key={i}>{assump}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* ================= TAB 4: EVALUATION ================= */}
            {tab === "evaluation" && (
              <div className="sources-panel-card">
                {evaluationLoading ? (
                  <div className="loading-state">
                    <span className="cmc-spinner" />
                    <span>Loading Audit Results…</span>
                  </div>
                ) : evaluationError || !evaluation ? (
                  <div className="error-state">
                    <TriangleAlert size={28} color="var(--cmc-red)" />
                    <p>{evaluationError ?? "Audit results unavailable."}</p>
                  </div>
                ) : (
                  <>
                    <div className="panel-header-row">
                      <div>
                        <h2>Reproducible Functional Audits</h2>
                        <p className="tiny muted" style={{ marginTop: "4px" }}>
                          Synthetic functional verification across all 12 scenario-symbol permutations
                        </p>
                      </div>
                      <button
                        className="cmc-btn secondary"
                        onClick={() => downloadJSON(evaluation, "marketbridge-evaluation-report.json")}
                      >
                        <ArrowDownToLine size={14} /> Download Report
                      </button>
                    </div>

                    <div className="eval-summary-grid">
                      <div className="eval-stat-card">
                        <span>Scenario Audits Passed</span>
                        <strong className="positive">{evaluation.summary.passed} / {evaluation.summary.total}</strong>
                        <span className="tiny muted">100% passing tests</span>
                      </div>
                      <div className="eval-stat-card">
                        <span>Total Assertions Checked</span>
                        <strong>{evaluation.cases.reduce((sum, c) => sum + c.metrics.checks.length, 0)}</strong>
                        <span className="tiny muted">Across all receipt-ordered traces</span>
                      </div>
                      <div className="eval-stat-card">
                        <span>Model Specification</span>
                        <strong>{evaluation.model_version}</strong>
                        <span className="tiny muted">Deterministic unit-beta factor</span>
                      </div>
                    </div>

                    <div className="table-scroll">
                      <table className="cmc-table">
                        <thead>
                          <tr>
                            <th className="align-left">Scenario</th>
                            <th className="align-left">Symbol</th>
                            <th>Availability</th>
                            <th>Reference MAE</th>
                            <th>Unguarded MAE</th>
                            <th>Checks Passed</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {evaluation.cases.map((c) => {
                            const sc = catalog.scenarios.find((s) => s.id === c.scenario_id);
                            const passedCount = c.metrics.checks.filter((ch) => ch.passed).length;
                            return (
                              <tr key={`${c.scenario_id}-${c.symbol}`}>
                                <td className="align-left">
                                  <strong>{sc?.title ?? c.scenario_id}</strong>
                                </td>
                                <td className="align-left">
                                  <span className="asset-symbol-tag">{c.symbol}</span>
                                </td>
                                <td>{metric(c.metrics.availability_pct, "%")}</td>
                                <td>{metric(c.metrics.mae_bps, " bps")}</td>
                                <td>{metric(c.metrics.baseline_mae_bps, " bps")}</td>
                                <td>
                                  <span className="cmc-quality-badge qualified">
                                    <Check size={12} /> {passedCount}/{c.metrics.checks.length}
                                  </span>
                                </td>
                                <td>
                                  <button
                                    className="cmc-btn secondary"
                                    style={{ padding: "4px 8px", fontSize: "11px" }}
                                    onClick={() => {
                                      setScenarioId(c.scenario_id);
                                      setSymbol(c.symbol);
                                      setTab("markets");
                                    }}
                                  >
                                    Replay <ArrowRight size={12} />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ================= TAB 5: METHODOLOGY ================= */}
            {tab === "methodology" && (
              <div className="sources-panel-card">
                <div className="panel-header-row">
                  <div>
                    <h2>MarketBridge Architecture & Academic Grounding</h2>
                    <p className="tiny muted" style={{ marginTop: "4px" }}>
                      Three lines. Three different meanings. Independent references.
                    </p>
                  </div>
                </div>

                <div className="cmc-highlights-grid" style={{ marginBottom: "24px" }}>
                  <div className="cmc-highlight-card">
                    <div className="card-header-row">
                      <div className="card-title-group">
                        <span className="card-icon-badge">01</span>
                        <h3>Read The Evidence</h3>
                      </div>
                    </div>
                    <p style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.6" }}>
                      Preserve each source’s original timestamp, family and reported price. Multiple resellers of the same quote are not independent corroboration.
                    </p>
                  </div>

                  <div className="cmc-highlight-card">
                    <div className="card-header-row">
                      <div className="card-title-group">
                        <span className="card-icon-badge orange">02</span>
                        <h3>Qualify The Update</h3>
                      </div>
                    </div>
                    <p style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.6" }}>
                      Assess an observation before it influences the reference. Large moves are quarantined until corroborated by two independent families.
                    </p>
                  </div>

                  <div className="cmc-highlight-card">
                    <div className="card-header-row">
                      <div className="card-title-group">
                        <span className="card-icon-badge green">03</span>
                        <h3>Explain The Decision</h3>
                      </div>
                    </div>
                    <p style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.6" }}>
                      Publish the reference alongside uncertainty bounds and paper risk governance. When evidence is insufficient, abstain gracefully.
                    </p>
                  </div>
                </div>

                <h3 style={{ fontSize: "15px", marginBottom: "12px" }}>Academic Literature References:</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {evaluation?.research.map((paper) => (
                    <a
                      key={paper.url}
                      href={paper.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="cmc-highlight-card"
                      style={{ padding: "14px 18px", textDecoration: "none" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div>
                          <strong style={{ fontSize: "13px", color: "var(--text-primary)" }}>{paper.title}</strong>
                          <p className="tiny muted" style={{ marginTop: "3px" }}>{paper.application}</p>
                        </div>
                        <ExternalLink size={14} color="var(--cmc-blue)" />
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* ================= CoinMarketCap Style Footer ================= */}
      <footer className="cmc-footer">
        <div className="page-width footer-inner">
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span className="brand-icon-wrap" style={{ width: "24px", height: "24px", borderRadius: "6px" }}>
              <Activity size={14} />
            </span>
            <strong>MarketBridge</strong>
            <span>·</span>
            <span>CoinMarketCap-inspired off-hours reference pricing</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <span>All prices & outcomes in this demonstration are synthetic.</span>
            <span>·</span>
            <span className="cmc-micro-badge">RESEARCH DEMO</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
