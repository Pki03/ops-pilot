/**
 * src/tools/index.ts — Barrel export for all tool functions.
 *
 * This file re-exports all tool functions so the Workflow and
 * IncidentAgent can import them from a single location.
 *
 * The tools are the data layer for the investigation pipeline.
 * Each tool is deterministic (same service → same data) so the
 * demo is consistent across runs.
 *
 * Why a barrel file:
 *   Instead of importing from each individual tool file, the Workflow
 *   imports from `./tools`. This is cleaner and makes it easy to
 *   add new tools without updating import paths across the codebase.
 */

export { fetchLogs } from "./fetchLogs.js";
export { fetchMetrics, getMetricsData } from "./fetchMetrics.js";
export { getRecentDeploys, getDeploysData, getLatestDeploy } from "./recentDeploys.js";
export { searchRunbooks, upsertIncidentResolution } from "./searchRunbooks.js";
export { investigate, type InvestigateResult } from "./fetchAll.js";
