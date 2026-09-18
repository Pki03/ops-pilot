/**
 * Worker entry point for OpsPilot.
 *
 * This is the Cloudflare Worker that hosts both the IncidentAgent Durable Object
 * and the InvestigateIncident Workflow.
 *
 * The `agents` SDK's `Agent` class wraps `partyserver.Server` → `DurableObject`.
 * The `WorkflowEntrypoint` wraps `WorkflowEntrypoint` for durable multi-step execution.
 *
 * HTTP requests are routed using `routeAgentRequest` from the `agents` SDK,
 * which properly handles the Durable Object protocol (namespace, room headers).
 *
 * Both are exported so Cloudflare can instantiate them:
 *   - IncidentAgent via the INCIDENT_AGENT binding
 *   - InvestigateIncident via the WORKFLOWS binding
 */

import { getAgentByName } from "agents";
import { IncidentAgent } from "./agents/IncidentAgent";
import { InvestigateIncident } from "./workflows/InvestigateIncident";

/**
 * Fetch handler — handles HTTP requests.
 * Uses getAgentByName to properly get the IncidentAgent Durable Object stub
 * and route requests to it.
 */
export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({ status: "ok", service: "ops-pilot" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // getAgentByName returns a DurableObjectStub that properly handles
    // the Durable Object protocol for the agents SDK's Agent class.
    const stub = await getAgentByName(env.INCIDENT_AGENT, "ops-pilot");
    return stub.fetch(request);
  },
};

/**
 * Export the IncidentAgent Durable Object class.
 * Cloudflare registers this as a Durable Object based on the INCIDENT_AGENT binding.
 */
export { IncidentAgent };

/**
 * Export the InvestigateIncident Workflow class.
 * Cloudflare registers this as a Workflow based on the WORKFLOWS binding.
 * The Workflow is triggered via env.WORKFLOWS.run("InvestigateIncident", inputs).
 */
export { InvestigateIncident };
