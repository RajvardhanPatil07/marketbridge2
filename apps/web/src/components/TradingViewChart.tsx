"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  LineStyle,
  AreaSeries,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type SeriesType,
  type CandlestickData,
  type LineData,
  type HistogramData,
  type WhitespaceData,
  type SeriesMarker,
  type IPriceLine,
  type ISeriesMarkersPluginApi,
} from "lightweight-charts";
import type { Step } from "@/lib/types";
import {
  Maximize2,
  Minimize2,
  RotateCcw,
  Sliders,
  TrendingUp,
  BarChart3,
  Layers,
} from "lucide-react";

export type ChartMode = "area" | "candles" | "line";

export interface TradingViewChartProps {
  steps: Step[];
  cursor: number;
  current?: Step;
  duration: number;
  seriesToggles: {
    reference: boolean;
    comparator: boolean;
    baseline: boolean;
    uncertainty: boolean;
    volume: boolean;
    markers: boolean;
  };
  chartMode: ChartMode;
  theme: "dark" | "light";
  symbol: string;
  scenarioTitle?: string;
  onHoverStep?: (step: Step | null) => void;
  onSeekSecond?: (second: number) => void;
  isProgressive?: boolean;
}

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export default function TradingViewChart({
  steps,
  cursor,
  current,
  duration,
  seriesToggles,
  chartMode,
  theme,
  symbol,
  scenarioTitle,
  onHoverStep,
  onSeekSecond,
  isProgressive = true,
}: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const priceLineRef = useRef<IPriceLine | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  // Active steps based on progressive reveal vs full horizon
  const activeSteps = useMemo(() => {
    if (!steps.length) return [];
    return isProgressive ? steps.slice(0, cursor + 1) : steps;
  }, [steps, cursor, isProgressive]);

  // Convert step timestamp to unix seconds for lightweight-charts Time
  const getStepTime = (step: Step): Time => {
    if (step.timestamp) {
      const parsed = Math.floor(new Date(step.timestamp).getTime() / 1000);
      if (!Number.isNaN(parsed) && parsed > 0) return parsed as Time;
    }
    return (1788874200 + step.seconds) as Time;
  };

  // Build OHLC Candlestick data
  const candleData = useMemo<(CandlestickData<Time> | WhitespaceData<Time>)[]>(() => {
    if (!activeSteps.length) return [];
    return activeSteps.map((step, idx) => {
      const time = getStepTime(step);
      if (step.reference === null) {
        return { time };
      }
      const prevStep = idx > 0 ? activeSteps[idx - 1] : step;
      const open = prevStep.reference ?? step.reference;
      const close = step.reference;
      const validSourcePrices = step.sources
        .map((s) => s.price)
        .filter((p): p is number => p !== null && Number.isFinite(p));
      const allPrices = [open, close, step.comparator, ...validSourcePrices].filter(Number.isFinite);
      const high = Math.max(...allPrices);
      const low = Math.min(...allPrices);

      return {
        time,
        open,
        high,
        low,
        close,
      };
    });
  }, [activeSteps]);

  // Build Reference Area/Line data
  const referenceLineData = useMemo<(LineData<Time> | WhitespaceData<Time>)[]>(() => {
    return activeSteps.map((step) => {
      const time = getStepTime(step);
      if (step.reference === null) {
        return { time };
      }
      return {
        time,
        value: step.reference,
      };
    });
  }, [activeSteps]);

  // Build Unguarded Comparator line data
  const comparatorLineData = useMemo<LineData<Time>[]>(() => {
    return activeSteps.map((step) => ({
      time: getStepTime(step),
      value: step.comparator,
    }));
  }, [activeSteps]);

  // Build QQQ Factor Baseline line data
  const baselineLineData = useMemo<LineData<Time>[]>(() => {
    return activeSteps.map((step) => ({
      time: getStepTime(step),
      value: step.baseline,
    }));
  }, [activeSteps]);

  // Build Uncertainty Bounds
  const upperBoundsData = useMemo<(LineData<Time> | WhitespaceData<Time>)[]>(() => {
    return activeSteps.map((step) => {
      const time = getStepTime(step);
      if (step.upper === null) return { time };
      return { time, value: step.upper };
    });
  }, [activeSteps]);

  const lowerBoundsData = useMemo<(LineData<Time> | WhitespaceData<Time>)[]>(() => {
    return activeSteps.map((step) => {
      const time = getStepTime(step);
      if (step.lower === null) return { time };
      return { time, value: step.lower };
    });
  }, [activeSteps]);

  // Build Quorum Volume Histogram data
  const volumeData = useMemo<HistogramData<Time>[]>(() => {
    return activeSteps.map((step) => {
      const freshCount = step.sources.filter((s) => s.status === "FRESH").length;
      let color = "rgba(22, 199, 132, 0.4)"; // green fresh
      if (step.assessment === "QUARANTINE") {
        color = "rgba(234, 57, 67, 0.6)"; // red quarantine
      } else if (step.quality === "CAUTION") {
        color = "rgba(245, 172, 55, 0.5)"; // amber caution
      } else if (step.quality === "INSUFFICIENT_EVIDENCE") {
        color = "rgba(234, 57, 67, 0.35)"; // red dropout
      }

      return {
        time: getStepTime(step),
        value: freshCount,
        color,
      };
    });
  }, [activeSteps]);

  // Extract scenario pivotal event markers
  const markers = useMemo<SeriesMarker<Time>[]>(() => {
    if (!seriesToggles.markers || !activeSteps.length) return [];
    const list: SeriesMarker<Time>[] = [];

    activeSteps.forEach((step, idx) => {
      const time = getStepTime(step);
      const prevStep = idx > 0 ? activeSteps[idx - 1] : null;

      // 1. Quarantined bad print
      if (step.assessment === "QUARANTINE" && prevStep?.assessment !== "QUARANTINE") {
        list.push({
          time,
          position: "aboveBar",
          shape: "arrowDown",
          color: "#ea3943",
          text: `🚨 Bad Print Quarantined`,
          size: 1.5,
        });
      }

      // 2. Corroborated recovery
      if (
        (step.quality === "RECOVERING" || (step.quality === "QUALIFIED" && prevStep?.quality === "CAUTION")) &&
        step.reasons.some((r) => r.toLowerCase().includes("corroborat") || r.toLowerCase().includes("recovering"))
      ) {
        list.push({
          time,
          position: "belowBar",
          shape: "arrowUp",
          color: "#16c784",
          text: "🤝 Corroborated Move Verified",
          size: 1.5,
        });
      }

      // 3. Feed dropout
      if (
        step.quality === "CAUTION" &&
        prevStep?.quality === "QUALIFIED" &&
        step.reasons.some((r) => r.toLowerCase().includes("age") || r.toLowerCase().includes("dropout") || r.toLowerCase().includes("stale"))
      ) {
        list.push({
          time,
          position: "aboveBar",
          shape: "circle",
          color: "#f5ac37",
          text: "🔌 Feed Dropout / Caution",
          size: 1.2,
        });
      }

      // 4. Official auction reopening
      if (
        step.sources.some((s) => s.id === "auction" && s.status === "FRESH") &&
        !prevStep?.sources.some((s) => s.id === "auction" && s.status === "FRESH")
      ) {
        list.push({
          time,
          position: "aboveBar",
          shape: "square",
          color: "#3861fb",
          text: "🏛️ Primary Auction Reopened",
          size: 1.4,
        });
      }

      // 5. Unguarded liquidation exit
      if (step.simulation.baseline_liquidated && !prevStep?.simulation.baseline_liquidated) {
        list.push({
          time,
          position: "belowBar",
          shape: "arrowDown",
          color: "#ff5252",
          text: "⚡ Unguarded Liquidation Exit",
          size: 1.4,
        });
      }
    });

    return list;
  }, [activeSteps, seriesToggles.markers]);

  // Color palettes based on theme
  const isDark = theme === "dark";
  const colors = useMemo(() => {
    return {
      bg: isDark ? "#0e1320" : "#ffffff",
      text: isDark ? "#a1a7bb" : "#58667e",
      grid: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.04)",
      border: isDark ? "#262a39" : "#e6ebf2",
      crosshair: isDark ? "#7887a0" : "#8592a6",
      blue: "#3861fb",
      blueFillTop: isDark ? "rgba(56, 97, 251, 0.35)" : "rgba(56, 97, 251, 0.20)",
      blueFillBottom: "rgba(56, 97, 251, 0.00)",
      amber: "#f5ac37",
      green: "#16c784",
      red: "#ea3943",
      gray: isDark ? "#616e85" : "#8592a6",
    };
  }, [isDark]);

  // Initialize and update Lightweight Charts
  useEffect(() => {
    if (!containerRef.current) return;

    // Create chart
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth || 800,
      height: containerRef.current.clientHeight || 380,
      layout: {
        background: { type: ColorType.Solid, color: colors.bg },
        textColor: colors.text,
        fontSize: 12,
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      },
      grid: {
        vertLines: { color: colors.grid },
        horzLines: { color: colors.grid },
      },
      crosshair: {
        vertLine: {
          color: colors.crosshair,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: colors.blue,
        },
        horzLine: {
          color: colors.crosshair,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: colors.blue,
        },
      },
      rightPriceScale: {
        borderColor: colors.border,
        scaleMargins: {
          top: 0.1,
          bottom: 0.2,
        },
      },
      timeScale: {
        borderColor: colors.border,
        timeVisible: true,
        secondsVisible: true,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    chartRef.current = chart;

    // 1. Quorum Volume Histogram series (Bottom scale)
    if (seriesToggles.volume) {
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: {
          type: "volume",
        },
        priceScaleId: "volume",
      });
      chart.priceScale("volume").applyOptions({
        scaleMargins: {
          top: 0.82,
          bottom: 0,
        },
        visible: false,
      });
      volumeSeries.setData(volumeData);
    }

    // 2. QQQ Factor Baseline Series
    if (seriesToggles.baseline) {
      const baselineSeries = chart.addSeries(LineSeries, {
        color: colors.gray,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        title: "QQQ Factor",
        priceLineVisible: false,
        lastValueVisible: true,
      });
      baselineSeries.setData(baselineLineData);
    }

    // 3. Unguarded Comparator Series (Amber)
    if (seriesToggles.comparator) {
      const comparatorSeries = chart.addSeries(LineSeries, {
        color: colors.amber,
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        title: "Unguarded",
        priceLineVisible: false,
        lastValueVisible: true,
      });
      comparatorSeries.setData(comparatorLineData);
    }

    // 4. Model Uncertainty Bounds
    if (seriesToggles.uncertainty) {
      const upperSeries = chart.addSeries(LineSeries, {
        color: "rgba(56, 97, 251, 0.4)",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        title: "Upper Bound",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      const lowerSeries = chart.addSeries(LineSeries, {
        color: "rgba(56, 97, 251, 0.4)",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        title: "Lower Bound",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      upperSeries.setData(upperBoundsData);
      lowerSeries.setData(lowerBoundsData);
    }

    // 5. MarketBridge Primary Reference Series
    let primarySeries: ISeriesApi<SeriesType, Time> | null = null;
    if (seriesToggles.reference) {
      if (chartMode === "candles") {
        const candles = chart.addSeries(CandlestickSeries, {
          upColor: colors.green,
          downColor: colors.red,
          borderVisible: true,
          wickVisible: true,
          borderColor: colors.border,
          borderUpColor: colors.green,
          borderDownColor: colors.red,
          wickUpColor: colors.green,
          wickDownColor: colors.red,
          title: "MarketBridge (OHLC)",
        });
        candles.setData(candleData);
        primarySeries = candles as unknown as ISeriesApi<SeriesType, Time>;
      } else if (chartMode === "line") {
        const line = chart.addSeries(LineSeries, {
          color: colors.blue,
          lineWidth: 3,
          title: "MarketBridge Ref",
          priceLineVisible: true,
        });
        line.setData(referenceLineData);
        primarySeries = line as unknown as ISeriesApi<SeriesType, Time>;
      } else {
        // Area mode (default)
        const area = chart.addSeries(AreaSeries, {
          lineColor: colors.blue,
          topColor: colors.blueFillTop,
          bottomColor: colors.blueFillBottom,
          lineWidth: 3,
          title: "MarketBridge Ref",
          priceLineVisible: true,
        });
        area.setData(referenceLineData);
        primarySeries = area as unknown as ISeriesApi<SeriesType, Time>;
      }

      // Add live price line on the primary series
      const active = current ?? steps[Math.min(cursor, Math.max(0, steps.length - 1))];
      const livePrice = active ? (active.reference ?? active.last_valid) : null;
      if (primarySeries && livePrice !== null && Number.isFinite(livePrice)) {
        priceLineRef.current = primarySeries.createPriceLine({
          price: livePrice,
          color: colors.blue,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "Current",
        });
      }

      // Add event markers on the primary series
      if (primarySeries && markers.length > 0) {
        markersPluginRef.current = createSeriesMarkers<Time>(primarySeries, markers);
      }
    }

    // Crosshair hover listener to sync with parent
    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point) {
        onHoverStep?.(null);
        return;
      }
      const hoveredTimestamp = param.time as number;
      const matched = activeSteps.find((s) => (getStepTime(s) as number) === hoveredTimestamp);
      if (matched) {
        onHoverStep?.(matched);
      }
    });

    // Auto-fit content
    chart.timeScale().fitContent();

    // Resize observer
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === containerRef.current && chartRef.current) {
          chartRef.current.applyOptions({
            width: entry.contentRect.width,
            height: entry.contentRect.height,
          });
        }
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [
    chartMode,
    seriesToggles,
    theme,
    colors,
    candleData,
    referenceLineData,
    comparatorLineData,
    baselineLineData,
    upperBoundsData,
    lowerBoundsData,
    volumeData,
    markers,
    current,
    activeSteps,
    onHoverStep,
  ]);

  const fitContent = () => {
    chartRef.current?.timeScale().fitContent();
  };

  const toggleFullscreen = () => {
    setIsFullscreen((prev) => !prev);
  };

  return (
    <div className={`tradingview-wrapper ${isFullscreen ? "fullscreen" : ""}`}>
      {/* Chart Top Quick Header */}
      <div className="tv-chart-header">
        <div className="tv-header-left">
          <div className="tv-symbol-title">
            <span className="tv-symbol-name">{symbol} / USD</span>
            <span className="tv-scenario-tag">{scenarioTitle ?? "Synthetic Scenario"}</span>
          </div>

          {(() => {
            const active = current ?? steps[Math.min(cursor, Math.max(0, steps.length - 1))];
            if (!active) return null;
            return (
              <div className="tv-price-tag">
                <span className="tv-price-value">
                  {active.reference !== null ? usdFormatter.format(active.reference) : "Abstaining"}
                </span>
                {active.reference === null && (
                  <span className="tv-abstain-badge">Last Valid: {usdFormatter.format(active.last_valid ?? 0)}</span>
                )}
              </div>
            );
          })()}
        </div>

        <div className="tv-header-controls">
          <button className="tv-action-btn" onClick={fitContent} title="Reset zoom and fit scenario horizon">
            <RotateCcw size={13} />
            <span>Reset View</span>
          </button>
          <button
            className="tv-action-btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen View"}
          >
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            <span>{isFullscreen ? "Exit" : "Expand"}</span>
          </button>
        </div>
      </div>

      {/* Chart Canvas Host */}
      <div ref={containerRef} className="tv-chart-canvas-container" />

      {/* Bottom Chart Legend & Watermark */}
      <div className="tv-chart-footer">
        <div className="tv-legend-items">
          {seriesToggles.reference && (
            <span className="tv-legend-item">
              <span className="tv-legend-dot blue" />
              MarketBridge Reference
            </span>
          )}
          {seriesToggles.comparator && (
            <span className="tv-legend-item">
              <span className="tv-legend-dot amber" />
              Unguarded Feed
            </span>
          )}
          {seriesToggles.baseline && (
            <span className="tv-legend-item">
              <span className="tv-legend-dot gray" />
              QQQ Macro Baseline
            </span>
          )}
          {seriesToggles.uncertainty && (
            <span className="tv-legend-item">
              <span className="tv-legend-dot dotted" />
              Uncertainty Envelope
            </span>
          )}
          {seriesToggles.volume && (
            <span className="tv-legend-item">
              <span className="tv-legend-dot green" />
              Quorum Depth Histogram
            </span>
          )}
        </div>

        <div className="tv-brand-watermark">
          <span>TradingView Lightweight Charts v5</span>
        </div>
      </div>
    </div>
  );
}
