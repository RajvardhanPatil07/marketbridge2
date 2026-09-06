import fallbackJson from "./fallbackData.json";
import type { Catalog, Evaluation, Trace } from "@/lib/types";

export const FALLBACK_CATALOG: Catalog = fallbackJson.catalog as unknown as Catalog;
export const FALLBACK_EVALUATION: Evaluation = fallbackJson.evaluation as unknown as Evaluation;
export const FALLBACK_TRACES: Record<string, Trace> = fallbackJson.traces as unknown as Record<string, Trace>;

export function getFallbackTrace(scenarioId: string, symbol: string): Trace | null {
  const key = `${scenarioId}_${symbol}`;
  return FALLBACK_TRACES[key] ?? null;
}
