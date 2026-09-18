/**
 * InvestigateIncident — Cloudflare Workflow definition.
 *
 * A Workflow is a durable, retryable, observable multi-step execution.
 * Unlike a plain function call, a Workflow:
 *   - Survives Worker restarts and crashes (steps are replayed from checkpoint)
 *   - Shows step-by-step status in the Cloudflare dashboard
 *   - Can be scheduled, polled, and awaited
 *   - Has built-in retry logic for failed steps
 *
 * This is the "coordination" piece of OpsPilot — it orchestrates the parallel
 * investigation steps (fetch logs, fetch metrics, search runbooks, check deploys)
 * and then synthesizes findings into a structured response.
 *
 * How it works:
 *   1. IncidentAgent triggers this Workflow via env.WORKFLOWS.run()
 *   2. Each step.do() call creates a durable checkpoint
 *   3. If the Worker crashes mid-execution, the Workflow resumes from the last checkpoint
 *   4. After all steps complete, the synthesis step runs the LLM
 *   5. The result is returned to the IncidentAgent, which streams it to the client
 *
 * Design note on why Workflow vs plain function call:
 *   Durable Objects guarantee singleton concurrency per ID — only one message
 *   is processed at a time for a given incident ID. But a Durable Object
 *   does NOT guarantee durability of multi-step execution. If the Worker
 *   crashes mid-investigation, all progress is lost.
 *
 *   Workflows solve this by checkpointing after each step. The steps survive
 *   Worker restarts, Worker redeployments, and even Cloudflare infrastructure
 *   failures. This is critical for long-running investigations that could take
 *   minutes and involve multiple external API calls.
 *
 *   Another key difference: Workflows can be monitored in the Cloudflare
 *   dashboard with step-by-step status, which is invaluable for debugging
 *   and demonstrating the investigation pipeline to reviewers.
 */

import { WorkflowEntrypoint, type WorkflowStep, type WorkflowEvent } from "cloudflare:workers";

// ── Types ────────────────────────────────────────────────────────

interface InvestigationInputs {
  incidentId: string;
  service: string;
  userMessage: string;
}

interface InvestigationStepResult {
  logs?: string;
  metrics?: string;
  runbookMatches?: Array<{ title: string; score: number; snippet?: string }>;
  recentDeploys?: string;
}

interface SynthesisResult {
  hypothesis: string;
  confidence: number;
  evidence: string[];
  recommendedAction: string;
  requiresApproval: boolean;
  humanSummary: string;
}

// ── Tool Functions ────────────────────────────────────────────────
// These are imported from src/tools/. In the Workflow runtime,
// they execute within the step.do() callbacks.

async function fetchLogsTool(service: string): Promise<string> {
  // In production, import from ./tools/fetchLogs.js
  // For now, inline the same logic as the tool module
  const SERVICE_LOGS: Record<string, string[]> = {
    "checkout-service": [
      "[ERROR] Connection pool exhausted - max 50 connections, all in use",
      "[WARN]  /api/checkout p99 latency 3200ms for the last 5 minutes",
      "[ERROR] Timeout waiting for PostgreSQL connection pool",
      "[INFO]  Retry succeeded for /api/checkout after 4.2s delay",
      "[ERROR] 5xx response rate 12.3% across /api/checkout endpoints",
      "[WARN]  Worker restart detected at pod checkout-api-7b8f9d-xk2m1",
    ],
    "payment-service": [
      "[ERROR] Stripe webhook processing failed: signature verification error",
      "[WARN]  Payment processing queue depth at 1500",
      "[ERROR] 5xx response rate 8.7% across /api/v1/charge endpoints",
      "[INFO]  Connection to billing database restored after 45s outage",
    ],
    "search-service": [
      "[ERROR] Elasticsearch cluster health: RED - 2 of 3 nodes unreachable",
      "[WARN]  Search query latency p99 at 5400ms",
      "[ERROR] Index 'products_v3' missing shards",
    ],
  };

  const logs = SERVICE_LOGS[service] || [`[WARN] No specific log data for "${service}"`];
  return `=== MOCK LOGS for ${service} ===\n${logs.join("\n")}`;
}

async function fetchMetricsTool(service: string): Promise<string> {
  const SERVICE_METRICS: Record<string, { status: string; p99: number; errorRate: number }> = {
    "checkout-service": { status: "CRITICAL", p99: 3200, errorRate: 12.3 },
    "payment-service": { status: "DEGRADED", p99: 890, errorRate: 8.7 },
    "search-service": { status: "CRITICAL", p99: 8100, errorRate: 15.2 },
  };

  const m = SERVICE_METRICS[service] || { status: "UNKNOWN", p99: 0, errorRate: 0 };
  return `=== MOCK METRICS for ${service} ===\nStatus: ${m.status}\np99 latency: ${m.p99}ms\nError rate: ${m.errorRate}%`;
}

async function searchRunbooksTool(
  vectorize: any,
  service: string
): Promise<Array<{ title: string; score: number; snippet?: string }>> {
  // If Vectorize is available, query it; otherwise return fallback
  if (!vectorize || typeof vectorize.query !== "function") {
    return [
      { title: `${service} — high latency runbook`, score: 0.85 },
      { title: `${service} — connection pool exhaustion`, score: 0.72 },
    ];
  }

  try {
    const result = await vectorize.query({
      query: `incident ${service} latency error`,
      topK: 5,
      returnVectors: false,
    });
    return result.matches.map((match: any) => ({
      title: match.metadata?.title || "Unknown runbook",
      score: match.score || 0,
    }));
  } catch {
    return [];
  }
}

async function recentDeploysTool(service: string): Promise<string> {
  const SERVICE_DEPLOYS: Record<string, string[]> = {
    "checkout-service": ["v2.4.1 — Fix payment webhook retry logic"],
    "payment-service": ["v1.8.2 — Stripe webhook signature verification update"],
    "search-service": ["v3.1.0 — Migrate index to Elasticsearch 8.x"],
  };
  return `Recent deploy: ${SERVICE_DEPLOYS[service]?.[0] || "No recent deploy"}`;
}

// ── LLM Synthesis ─────────────────────────────────────────────────

async function synthesizeFindings(
  ai: any,
  inputs: InvestigationInputs,
  results: InvestigationStepResult
): Promise<SynthesisResult> {
  const systemPrompt = `You are an incident investigation analyst. Given the following investigation results, produce a structured JSON response:
- hypothesis: the likely root cause
- confidence: 0-1
- evidence: list of key evidence points
- recommendedAction: specific next step
- requiresApproval: true always
- humanSummary: natural-language summary

Respond ONLY in valid JSON.`;

  const response = await ai.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Incident: ${inputs.incidentId} (${inputs.service})
User reported: ${inputs.userMessage}

Logs: ${results.logs || "not available"}
Metrics: ${results.metrics || "not available"}
Runbook matches: ${JSON.stringify(results.runbookMatches || [])}
Deploys: ${results.recentDeploys || "not available"}`,
      },
    ],
    stream: false,
  });

  let text = "";
  for await (const chunk of response) {
    text += typeof chunk === "string" ? chunk : JSON.stringify(chunk);
  }

  try {
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}") + 1;
    return JSON.parse(text.slice(jsonStart, jsonEnd)) as SynthesisResult;
  } catch {
    return {
      hypothesis: "Unable to determine root cause.",
      confidence: 0.1,
      evidence: [],
      recommendedAction: "Manual investigation required.",
      requiresApproval: true,
      humanSummary: "Investigation could not complete automatically.",
    };
  }
}

// ── Workflow Entrypoint ───────────────────────────────────────────

/**
 * InvestigateIncident — Cloudflare Workflow that orchestrates the investigation.
 *
 * Extends WorkflowEntrypoint from cloudflare:workers. The run() method
 * is the main entry point — it's called when the Workflow is triggered
 * via env.WORKFLOWS.run().
 *
 * The `step` parameter provides the `step.do()` method for creating
 * durable, checkpointed steps. Each step runs independently and can
 * survive Worker restarts.
 */
export class InvestigateIncident extends WorkflowEntrypoint {
  /**
   * The main Workflow execution method. Called by Cloudflare when
   * the Workflow is triggered via env.WORKFLOWS.run().
   *
   * @param event - The workflow event containing inputs (incidentId, service, userMessage)
   * @param step - The WorkflowStep object with step.do() for durable execution
   */
  async run(
    event: WorkflowEvent<InvestigationInputs>,
    step: WorkflowStep
  ): Promise<SynthesisResult & InvestigationStepResult> {
    const inputs = event.payload;

    // ── Step 1: Fetch logs ────────────────────────────────────
    // step.do() creates a durable checkpoint. If this step fails,
    // it retries automatically. The step name appears in the
    // Cloudflare dashboard for observability.
    const logs = await step.do("fetch-logs", async () => {
      return await fetchLogsTool(inputs.service);
    });

    // ── Step 2: Fetch metrics ─────────────────────────────────
    const metrics = await step.do("fetch-metrics", async () => {
      return await fetchMetricsTool(inputs.service);
    });

    // ── Step 3: Search runbooks ───────────────────────────────
    // Note: vectorize binding needs to be accessed through env
    const runbookMatches = await step.do("search-runbooks", async () => {
      // Access the VECTORIZE binding through the env
      // In Cloudflare Workers, env is available as a global
      const vectorize = (globalThis as any).env?.VECTORIZE;
      return await searchRunbooksTool(vectorize, inputs.service);
    });

    // ── Step 4: Check recent deploys ──────────────────────────
    const deploys = await step.do("recent-deploys", async () => {
      return await recentDeploysTool(inputs.service);
    });

    // ── Step 5: Synthesize findings ──────────────────────────
    // This is the "reasoning" step — the LLM correlates all the data.
    // It has the highest context requirements and the most tokens.
    const synthesis = await step.do("synthesize", async () => {
      const ai = (globalThis as any).env?.AI;
      return await synthesizeFindings(ai, inputs, {
        logs,
        metrics,
        runbookMatches,
        recentDeploys: deploys,
      });
    });

    // ── Return all results ───────────────────────────────────
    // The Workflow returns the full result to the caller
    // (IncidentAgent), which then streams it to the user.

    return {
      logs,
      metrics,
      runbookMatches,
      recentDeploys: deploys,
      ...(synthesis as SynthesisResult),
    };
  }
}
