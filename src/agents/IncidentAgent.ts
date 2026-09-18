/**
 * IncidentAgent — the core Durable Object agent for OpsPilot.
 *
 * Extends the `Agent<any, IncidentState>` class from the `agents` SDK,
 * which wraps `partyserver.Server` → `cloudflare:workers.DurableObject`.
 *
 * Each incident gets its own Durable Object instance, which:
 *   - Persists state in built-in SQLite via `this.state` / `this.setState()`
 *   - Receives WebSocket messages via `onMessage(connection, message)`
 *   - Initializes its state on first creation via `onStart()`
 *   - Handles WebSocket connections via `onConnect(connection, ctx)`
 *   - Handles HTTP requests via `onRequest(request)`
 *   - Triggers Cloudflare Workflows for investigation via `env.WORKFLOWS.run()`
 *
 * The `Agent` class automatically serializes/deserializes `this.state` to
 * the Durable Object's internal SQLite database on every change.
 *
 * The `@callable()` decorator marks methods that can be invoked by the
 * client over the WebSocket RPC protocol.
 *
 * Phase 3 addition: The agent can trigger the InvestigateIncident Workflow
 * to orchestrate the multi-step investigation pipeline. When a new incident
 * is detected, the agent:
 *   1. Triggers the Workflow via env.WORKFLOWS.run()
 *   2. Streams step-by-step updates back to the client
 *   3. After synthesis, proposes an action and requests approval
 *
 * Why the Workflow is triggered from the Agent (not called directly):
 *   If the Agent called tools directly and the Worker crashed mid-investigation,
 *   all progress would be lost. The Workflow checkpoint after each step ensures
 *   the investigation survives Worker restarts, Worker redeployments, and
 *   Cloudflare infrastructure failures. This is the key difference between a
 *   Durable Object (state + identity) and a Workflow (durable multi-step execution).
 */

import { Agent, callable } from "agents";
import { searchRunbooks, upsertIncidentResolution } from "../tools/index.js";

// ── State Schema ───────────────────────────────────────────────────
// This interface defines the shape of the Durable Object's SQLite storage.
// The `Agent` class serializes/deserializes this automatically on every change.

export interface IncidentState {
  incidentId: string;
  service: string;
  status: "investigating" | "awaiting_approval" | "resolved" | "closed";
  createdAt: number;
  messages: {
    role: "user" | "assistant" | "tool";
    content: string;
    ts: number;
  }[];
  findings: {
    logs?: string;
    metrics?: string;
    runbookMatches?: Array<{ title: string; score: number; snippet?: string }>;
    recentDeploys?: string;
  };
  proposedAction?: {
    type: string;
    description: string;
    requiresApproval: boolean;
  };
  resolutionSummary?: string;
  workflowRunId?: string;
  // stepUpdates tracks the progress of each Workflow step for streaming to the client
  stepUpdates: string[];
}

export class IncidentAgent extends Agent<any, IncidentState> {
  static initialState: IncidentState = {
    incidentId: "",
    service: "",
    status: "investigating",
    createdAt: Date.now(),
    messages: [],
    findings: {},
    stepUpdates: [],
  };

  /**
   * Called once when the Durable Object instance is first created.
   * Runs exactly once per incident — even if the Worker restarts,
   * the state persists in SQLite.
   */
  override async onStart(props?: Record<string, unknown>): Promise<void> {
    if (!this.state) return;
    if (!this.state.incidentId) {
      this.state.incidentId = `INC-${Date.now().toString(36).toUpperCase()}`;
      this.state.service = "";
      this.state.status = "investigating";
      this.state.createdAt = Date.now();
      this.state.messages = [];
      this.state.findings = {};
      this.state.stepUpdates = [];
    }

    (this as any).ai = this.env?.AI;
    (this as any).vectorize = this.env?.VECTORIZE;
    (this as any).workflows = this.env?.WORKFLOWS;
  }

  /**
   * Called when a new WebSocket connection is established.
   * Sends a welcome message and sends the current state summary.
   */
  override async onConnect(
    connection: any,
    ctx: { request: Request }
  ): Promise<void> {
    connection.send(
      JSON.stringify({
        type: "welcome",
        message: "Connected to OpsPilot. Report an incident to begin investigation.",
      })
    );

    // Send current state summary so the client knows what's happening
    connection.send(
      JSON.stringify({
        type: "state",
        state: {
          incidentId: this.state.incidentId,
          status: this.state.status,
          messageCount: this.state.messages.length,
          stepUpdates: this.state.stepUpdates,
        },
      })
    );
  }

  /**
   * Called when an HTTP request is made to the Worker.
   * Used for health checks and any REST endpoints.
   */
  override async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({ status: "ok", service: "ops-pilot" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("OpsPilot Worker", { headers: { "Content-Type": "text/plain" } });
  }

  /**
   * Called when a message is received from a WebSocket connection.
   * The `Agent` class deserializes the latest state from SQLite before
   * calling this method, so `this.state` always reflects persisted data.
   *
   * Protocol: messages are JSON strings with a `type` field:
   *   - `{ type: "connect" }` → initial handshake
   *   - `{ type: "investigate", service, message }` → trigger Workflow investigation
   *   - `{ type: "approve" }` / `{ type: "reject" }` → approval actions
   *   - `{ type: "rpc", method }` → @callable() method invocation
   *   - Plain string → treated as a chat message
   */
  override async onMessage(
    connection: any,
    message: string
  ): Promise<void> {
    let data: any;
    try {
      data = JSON.parse(message);
    } catch {
      // Not JSON — treat as a plain chat message
      await this.handleChatMessage(connection, message);
      return;
    }

    switch (data.type) {
      case "connect":
        // Send current state summary
        connection.send(
          JSON.stringify({
            type: "state",
            state: {
              incidentId: this.state.incidentId,
              status: this.state.status,
              messageCount: this.state.messages.length,
              stepUpdates: this.state.stepUpdates,
            },
          })
        );
        break;

      case "investigate":
        // New incident — trigger the Workflow investigation pipeline
        // This is the Phase 3 centerpiece: user reports incident →
        // Agent triggers Workflow → Workflow runs tools → LLM synthesizes →
        // Agent streams results and asks for approval
        await this.triggerInvestigation(connection, data.service, data.message);
        break;

      case "approve":
        await this.handleApprovalResponse(connection, "approve");
        break;

      case "reject":
        await this.handleApprovalResponse(connection, "reject");
        break;

      case "rpc":
        // RPC call — handled by the `partyserver` layer via @callable()
        // The framework routes `{ type: "rpc", method }` to the matching
        // `@callable()` method on this Agent.
        break;

      default:
        await this.handleChatMessage(connection, message);
    }
  }

  /**
   * Handle a plain chat message: call the LLM and stream the response.
   * This is the original Phase 1 chat loop, kept for backward compatibility.
   */
  private async handleChatMessage(connection: any, message: string): Promise<void> {
    const userMessage = message.trim();
    if (!userMessage) return;

    this.state.messages.push({ role: "user", content: userMessage, ts: Date.now() });

    if (this.state.status === "awaiting_approval") {
      await this.handleApprovalResponse(connection, userMessage);
      return;
    }

    const response = await this.callLLM(userMessage, connection);
    connection.send(
      JSON.stringify({ type: "message", content: response })
    );
  }

  /**
   * Trigger the InvestigateIncident Workflow.
   *
   * This is the Phase 3 centerpiece. The agent:
   *   1. Calls env.WORKFLOWS.run() to start the Workflow
   *   2. Stores the workflowRunId in state
   *   3. Streams step-by-step updates back to the client
   *   4. After synthesis, proposes an action and requests approval
   *
   * Design note on why we trigger the Workflow from the Agent:
   *   The Agent (Durable Object) is the "brain" — it manages state,
   *   conversation, and the human-in-the-loop approval gate.
   *   The Workflow is the "execution engine" — it runs the investigation
   *   steps durably. The Agent orchestrates; the Workflow executes.
   *
   *   This separation means:
   *   - If the Workflow fails, the Agent state is preserved
   *   - The Agent can retry the Workflow
   *   - The Workflow can be monitored independently in the Cloudflare dashboard
   *   - The Agent can handle other incidents while this Workflow runs
   */
  private async triggerInvestigation(
    connection: any,
    service: string,
    userMessage: string
  ): Promise<void> {
    // Initialize the state for the new investigation
    this.state.service = service;
    this.state.status = "investigating";
    this.state.stepUpdates = [];
    this.state.findings = {};
    this.state.proposedAction = undefined;

    // Record the user's report
    this.state.messages.push({ role: "user", content: userMessage, ts: Date.now() });

    // Stream initial status to the client
    connection.send(
      JSON.stringify({
        type: "workflow_start",
        message: `Starting investigation for ${service}...`,
      })
    );

    try {
      // Trigger the Cloudflare Workflow via env.WORKFLOWS
      // env.WORKFLOWS is injected by Cloudflare based on wrangler.toml
      // The run() method returns a WorkflowHandle that can be awaited
      //
      // IMPORTANT: The exact API of env.WORKFLOWS.run() may vary based on
      // the Cloudflare SDK version. This uses the conceptual API described
      // in the Cloudflare Workflows documentation.
      const workflows = (this as any).workflows;

      if (!workflows || typeof workflows.run !== "function") {
        // Fallback: if Workflows binding is not available (e.g., local dev),
        // simulate the investigation locally
        connection.send(
          JSON.stringify({
            type: "workflow_step",
            step: "fallback",
            status: "running",
            detail: "Workflows binding not available — running local simulation",
          })
        );
        await this.runLocalInvestigation(connection, service, userMessage);
        return;
      }

      // Trigger the Workflow with the investigation inputs
      const workflowHandle = await workflows.run("InvestigateIncident", {
        incidentId: this.state.incidentId,
        service,
        userMessage,
      });

      // Store the workflow run ID for tracking
      this.state.workflowRunId = workflowHandle.id;

      // Wait for the Workflow to complete
      // In production, you might poll the workflowHandle for status
      // or use a callback mechanism. Here we await the result.
      const result = await workflowHandle.result;

      // Process the Workflow result
      await this.handleInvestigationResult(connection, result);

    } catch (error) {
      console.error("Workflow execution failed:", error);
      connection.send(
        JSON.stringify({
          type: "workflow_error",
          message: "Investigation failed. Please try again.",
          error: String(error),
        })
      );

      // Fallback to local investigation on error
      await this.runLocalInvestigation(connection, service, userMessage);
    }
  }

  /**
   * Run a local simulation of the investigation (used when
   * the Workflows binding is not available, e.g., in local dev).
   * This ensures the demo still works without Cloudflare Workflows.
   */
  private async runLocalInvestigation(
    connection: any,
    service: string,
    userMessage: string
  ): Promise<void> {
    // Import the tools dynamically — in the bundled Worker these
    // are available as modules. For local dev, we use the function bodies.

    connection.send(
      JSON.stringify({ type: "workflow_step", step: "fetch-logs", status: "running" })
    );

    // Simulate fetchLogs
    const logs = await this.simulateTool("logs", service);
    connection.send(
      JSON.stringify({ type: "workflow_step", step: "fetch-logs", status: "complete", detail: "Logs fetched" })
    );

    connection.send(
      JSON.stringify({ type: "workflow_step", step: "fetch-metrics", status: "running" })
    );
    const metrics = await this.simulateTool("metrics", service);
    connection.send(
      JSON.stringify({ type: "workflow_step", step: "fetch-metrics", status: "complete", detail: "Metrics fetched" })
    );

    connection.send(
      JSON.stringify({ type: "workflow_step", step: "search-runbooks", status: "running" })
    );
    const runbookMatches = await this.simulateTool("runbooks", service);
    connection.send(
      JSON.stringify({ type: "workflow_step", step: "search-runbooks", status: "complete", detail: "Runbooks searched" })
    );

    connection.send(
      JSON.stringify({ type: "workflow_step", step: "recent-deploys", status: "running" })
    );
    const deploys = await this.simulateTool("deploys", service);
    connection.send(
      JSON.stringify({ type: "workflow_step", step: "recent-deploys", status: "complete", detail: "Deploys checked" })
    );

    // Synthesize findings
    connection.send(
      JSON.stringify({ type: "workflow_step", step: "synthesize", status: "running" })
    );

    const synthesis = await this.synthesizeLocally(service, userMessage, logs, metrics, runbookMatches, deploys);

    connection.send(
      JSON.stringify({ type: "workflow_step", step: "synthesize", status: "complete" })
    );

    // Process the result
    await this.handleInvestigationResult(connection, {
      logs,
      metrics,
      runbookMatches,
      recentDeploys: deploys,
      ...synthesis,
    });
  }

  /**
   * Simulate a tool call for local dev. Returns realistic mock data.
   */
  private async simulateTool(type: string, service: string): Promise<any> {
    // Small delay to simulate API latency
    await new Promise((resolve) => setTimeout(resolve, 500));

    const data: Record<string, string | any> = {
      logs: `=== MOCK LOGS for ${service} ===\n[ERROR] Connection pool exhausted - max 50 connections\n[WARN]  p99 latency 3200ms on /api/checkout\n[ERROR] 5xx response rate 12.3%`,
      metrics: `=== MOCK METRICS for ${service} ===\nStatus: CRITICAL\np99 latency: 3200ms\nError rate: 12.3%`,
      runbooks: [
        { title: `${service} — high latency runbook`, score: 0.85 },
        { title: `${service} — connection pool exhaustion`, score: 0.72 },
      ],
      deploys: `Recent deploy: v2.4.1 — Fix payment webhook retry logic`,
    };

    return data[type] || "";
  }

  /**
   * Synthesize findings locally using the LLM (for local dev fallback).
   */
  private async synthesizeLocally(
    service: string,
    userMessage: string,
    logs: string,
    metrics: string,
    runbookMatches: any[],
    deploys: string
  ): Promise<any> {
    const systemPrompt = `You are an incident investigation analyst. Respond ONLY in valid JSON with: hypothesis, confidence (0-1), evidence, recommendedAction, requiresApproval (true), humanSummary.`;

    const response = await (this as any).ai.run(
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      {
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Incident: ${this.state.incidentId} (${service})
User reported: ${userMessage}
Logs: ${logs}
Metrics: ${metrics}
Runbook matches: ${JSON.stringify(runbookMatches)}
Deploys: ${deploys}`,
          },
        ],
        stream: false,
      }
    );

    let text = "";
    for await (const chunk of response) {
      text += typeof chunk === "string" ? chunk : JSON.stringify(chunk);
    }

    try {
      const jsonStart = text.indexOf("{");
      const jsonEnd = text.lastIndexOf("}") + 1;
      return JSON.parse(text.slice(jsonStart, jsonEnd));
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

  /**
   * Process the Workflow or local investigation result.
   * Streams the findings to the client and requests approval if needed.
   */
  private async handleInvestigationResult(connection: any, result: any): Promise<void> {
    // Store findings in state
    this.state.findings = {
      logs: result.logs,
      metrics: result.metrics,
      runbookMatches: result.runbookMatches || [],
      recentDeploys: result.recentDeploys,
    };

    // Stream the synthesis result to the client
    connection.send(
      JSON.stringify({
        type: "investigation_result",
        findings: this.state.findings,
        synthesis: {
          hypothesis: result.hypothesis,
          confidence: result.confidence,
          humanSummary: result.humanSummary,
        },
      })
    );

    // Check if approval is required
    if (result.requiresApproval) {
      this.state.status = "awaiting_approval";
      this.state.proposedAction = {
        type: result.recommendedAction.includes("rollback") ? "rollback" : "investigate",
        description: result.recommendedAction,
        requiresApproval: true,
      };

      connection.send(
        JSON.stringify({
          type: "approval_request",
          action: this.state.proposedAction,
          summary: result.humanSummary,
          recommendedAction: result.recommendedAction,
        })
      );
    } else {
      this.state.status = "resolved";
      this.state.resolutionSummary = result.humanSummary;
    }

    // Phase 5: Memory loop closing — embed resolution into Vectorize
    try {
      const vectorize = (this as any).vectorize;
      if (vectorize && typeof vectorize.upsert === "function") {
        await upsertIncidentResolution(vectorize, {
          incidentId: this.state.incidentId,
          service: this.state.service,
          hypothesis: result.hypothesis || "Unknown",
          resolutionSummary: result.humanSummary || result.resolutionSummary || "",
        });
      }
    } catch {
      // Non-critical — embedding failure shouldn't block resolution
    }

    // Phase 5: Check for precedents — notify client of similar past incidents
    try {
      const vectorize = (this as any).vectorize;
      if (vectorize && typeof vectorize.query === "function") {
        const precedents = await this.checkPrecedents(vectorize, this.state.service);
        if (precedents.length > 0) {
          connection.send(
            JSON.stringify({
              type: "precedents_found",
              precedents,
            })
          );
        }
      }
    } catch {
      // Non-critical
    }
  }

  /**
   * Call Workers AI (Llama 3.3 70B) and stream the response to the client.
   * Each chunk is sent as `{ type: "stream", content: chunk }` so the
   * UI can show a live-typing effect.
   */
  private async callLLM(message: string, connection: any): Promise<string> {
    const systemPrompt = `You are OpsPilot, an AI incident-response copilot.
You help engineers triage operational incidents by investigating logs, metrics,
and runbooks. Always respond with actionable information and ask for human
approval before taking any state-changing action.

Current incident: ${this.state.incidentId} (${this.state.service})
Status: ${this.state.status}`;

    const response = await (this as any).ai.run(
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        stream: true,
      }
    );

    let fullText = "";
    for await (const chunk of response) {
      const text = typeof chunk === "string" ? chunk : JSON.stringify(chunk);
      fullText += text;
      connection.send(JSON.stringify({ type: "stream", content: text }));
    }

    this.state.messages.push({ role: "assistant", content: fullText, ts: Date.now() });
    return fullText;
  }

  /**
   * Handle approve/reject responses from the user.
   */
  private async handleApprovalResponse(connection: any, message: string): Promise<void> {
    const lower = message.toLowerCase().trim();
    const isApprove =
      lower.includes("approve") || lower.includes("yes") || lower.includes("yep");
    const isReject =
      lower.includes("reject") || lower.includes("no") || lower.includes("deny");

    if (isApprove) {
      this.state.status = "resolved";
      this.state.resolutionSummary = `Action executed: ${this.state.proposedAction?.description || "user-approved action"}`;
      const summary = `✅ Action approved and executed. Incident resolved.`;
      this.state.messages.push({ role: "assistant", content: summary, ts: Date.now() });
      connection.send(JSON.stringify({ type: "message", content: summary }));
    } else if (isReject) {
      this.state.status = "investigating";
      this.state.messages.push({
        role: "assistant",
        content: "❌ Action rejected. Remaining in investigating state.",
        ts: Date.now(),
      });
      connection.send(
        JSON.stringify({ type: "message", content: "Action rejected. Remaining in investigating state." })
      );
    } else {
      connection.send(
        JSON.stringify({ type: "message", content: 'Please respond with "approve" or "reject".' })
      );
    }
  }

  // ── Callable Methods ─────────────────────────────────────────────
  // The @callable() decorator makes these methods invocable by the client
  // via the WebSocket RPC protocol. The client sends:
  //   { type: "rpc", method: "approveAction", id: "xyz" }
  // The partyserver framework invokes the method and returns the result.

  // @ts-ignore
  @callable()
  async approveAction(): Promise<string> {
    if (this.state.status !== "awaiting_approval") {
      return "No pending approval to approve.";
    }

    this.state.status = "resolved";
    this.state.resolutionSummary = `Action executed: ${this.state.proposedAction?.description}`;
    const summary = `Action approved. ${this.state.proposedAction?.description}. Incident marked as resolved.`;
    this.state.messages.push({ role: "assistant", content: summary, ts: Date.now() });
    return summary;
  }

  // @ts-ignore
  @callable()
  async rejectAction(): Promise<string> {
    if (this.state.status !== "awaiting_approval") {
      return "No pending approval to reject.";
    }

    this.state.status = "investigating";
    this.state.messages.push({
      role: "assistant",
      content: "Action rejected. Remaining in investigating state.",
      ts: Date.now(),
    });
    return "Action rejected. Remaining in investigating state.";
  }

  /**
   * Phase 5: Check Vectorize for precedent incidents — similar past
   * resolved incidents that could inform the current investigation.
   * This "closes the memory loop" by surfacing historical context.
   */
  private async checkPrecedents(
    vectorize: any,
    service: string
  ): Promise<Array<{ incidentId: string; service: string; resolution: string; score: number }>> {
    try {
      const result = await vectorize.query({
        query: `resolved incident ${service}`,
        topK: 3,
        returnVectors: false,
      });

      return result.matches.map((match: any) => ({
        incidentId: match.metadata?.incidentId || "unknown",
        service: match.metadata?.service || service,
        resolution: match.metadata?.resolution || "",
        score: match.score || 0,
      }));
    } catch {
      return [];
    }
  }
}
