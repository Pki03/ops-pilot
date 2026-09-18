/**
 * src/tools/fetchAll.ts — Unified tool entry point for the investigation Workflow.
 *
 * This module provides a single `investigate()` function that calls all
 * tool functions in parallel. The Workflow uses this to orchestrate the
 * investigation pipeline.
 *
 * Design note on why a separate fetchAll.ts:
 *   The Workflow needs to call all tools and pass their results to
 *   the synthesis LLM. Having a unified entry point makes the
 *   Workflow code cleaner and easier to test. It also allows us to
 *   add timing/logging around the investigation as a whole.
 *
 * Usage from the Workflow:
 *   const { logs, metrics, runbookMatches, deploys } = await investigate(service);
 */

import { fetchLogs } from "./fetchLogs.js";
import { fetchMetrics } from "./fetchMetrics.js";
import { getRecentDeploys } from "./recentDeploys.js";
import { searchRunbooks } from "./searchRunbooks.js";

// ── Investigate Result ──────────────────────────────────────────────
// The shape of the data returned by the investigation pipeline.
// This is what gets passed to the synthesis LLM in the Workflow.

export interface InvestigateResult {
  logs: string;
  metrics: string;
  runbookMatches: Array<{ title: string; score: number; snippet?: string }>;
  deploys: string;
  timing: {
    logsMs: number;
    metricsMs: number;
    runbooksMs: number;
    deploysMs: number;
  };
}

/**
 * Run all investigation tools for a given service.
 *
 * This function calls all four tools (logs, metrics, runbooks, deploys)
 * and collects their results. In the Workflow, each tool runs in its
 * own `step.do()` call so they can be checkpointed independently.
 *
 * @param service - The service name to investigate
 * @param vectorize - Optional Vectorize binding for runbook search
 * @returns All investigation results in a single object
 */
export async function investigate(
  service: string,
  vectorize?: any
): Promise<InvestigateResult> {
  const startTime = Date.now();

  // Call all tools — in the Workflow these run in step.do() calls
  // for durability and observability.
  // Note: fetchLogs, fetchMetrics, getRecentDeploys are synchronous,
  // while searchRunbooks is async (Vectorize query).
  const logs = await timed("fetchLogs", async () => fetchLogs(service));
  const metrics = await timed("fetchMetrics", async () => fetchMetrics(service));
  const runbookMatches = await timed("searchRunbooks", async () =>
    searchRunbooks(vectorize, service)
  );
  const deploys = await timed("recentDeploys", async () => getRecentDeploys(service));

  return {
    logs,
    metrics,
    runbookMatches,
    deploys,
    timing: {
      logsMs: Date.now() - startTime,
      metricsMs: Date.now() - startTime,
      runbooksMs: Date.now() - startTime,
      deploysMs: Date.now() - startTime,
    },
  };
}

/**
 * Helper: wrap a function call with timing and error handling.
 * Returns the result. If the function fails, returns a fallback value.
 *
 * All tool calls are wrapped in async here for uniform handling,
 * even though fetchLogs/fetchMetrics/getRecentDeploys are synchronous.
 */
async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    console.log(`[Investigation] ${name} completed in ${Date.now() - start}ms`);
    return result;
  } catch (error) {
    console.error(`[Investigation] ${name} failed:`, error);
    // Return a fallback value so the investigation continues
    // even if one tool fails — this is important for resilience.
    // The agent will still produce a summary with partial data.
    if (name === "fetchLogs") return "" as T;
    if (name === "fetchMetrics") return "" as T;
    if (name === "searchRunbooks") return [] as unknown as T;
    if (name === "recentDeploys") return "" as T;
    throw error;
  }
}
