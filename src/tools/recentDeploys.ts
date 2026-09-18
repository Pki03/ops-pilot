/**
 * recentDeploys — Mock GitHub deploy history for OpsPilot.
 *
 * Generates deterministic, realistic-looking deployment history keyed by service name.
 * Simulates checking GitHub Actions / a deploy tracker for recent releases.
 *
 * This is a MOCK data generator. In production, this would call:
 *   - GitHub REST API (Actions, Commits, Releases)
 *   - A deploy tracker like ArgoCD, Spinnaker, or a custom service
 */

interface DeployRecord {
  tag: string;
  timestamp: string;
  status: "success" | "failed" | "in_progress";
  message: string;
  author: string;
}

// ── Seeded deploy history by service ────────────────────────────────────────
// Each service has a recent deploy history that tells a story.
// The key insight for the demo: if a recent deploy coincides with the incident,
// that's a strong signal for root cause analysis.

const SERVICE_DEPLOYS: Record<string, DeployRecord[]> = {
  "checkout-service": [
    { tag: "v2.4.1", timestamp: "2025-01-15T09:30:00Z", status: "success", message: "Fix payment webhook retry logic", author: "alice" },
    { tag: "v2.4.0", timestamp: "2025-01-14T14:22:00Z", status: "success", message: "Add new tax calculation endpoint", author: "bob" },
    { tag: "v2.3.9", timestamp: "2025-01-12T11:05:00Z", status: "failed", message: "Update PostgreSQL driver — rollback due to connection issues", author: "carol" },
    { tag: "v2.3.8", timestamp: "2025-01-10T16:40:00Z", status: "success", message: "Optimize checkout query performance", author: "alice" },
  ],
  "payment-service": [
    { tag: "v1.8.2", timestamp: "2025-01-15T08:15:00Z", status: "success", message: "Stripe webhook signature verification update", author: "dave" },
    { tag: "v1.8.1", timestamp: "2025-01-14T10:00:00Z", status: "success", message: "Fix payment intent timeout handling", author: "eve" },
    { tag: "v1.8.0", timestamp: "2025-01-13T09:30:00Z", status: "failed", message: "Circuit breaker config change — reverted", author: "dave" },
  ],
  "search-service": [
    { tag: "v3.1.0", timestamp: "2025-01-15T07:00:00Z", status: "success", message: "Migrate index to Elasticsearch 8.x", author: "frank" },
    { tag: "v3.0.9", timestamp: "2025-01-14T22:10:00Z", status: "success", message: "Fix autocomplete ranking algorithm", author: "grace" },
    { tag: "v3.0.8", timestamp: "2025-01-13T15:30:00Z", status: "failed", message: "Shard allocation change caused yellow cluster", author: "frank" },
  ],
};

/**
 * Generate mock deploy history for a given service.
 * Returns a formatted multiline string of recent deployment records.
 *
 * @param service - The name of the service to check deploy history for
 * @returns A formatted string of recent deployments
 */
export function getRecentDeploys(service: string): string {
  const deploys = SERVICE_DEPLOYS[service];

  if (!deploys) {
    return `=== RECENT DEPLOYS for ${service} ===\nNo deploy history available for "${service}".`;
  }

  const header = `=== RECENT DEPLOYS for ${service} ===\nShowing last ${deploys.length} deployments\n`;

  return header + deploys
    .map((d) => {
      const statusIcon = d.status === "success" ? "✅" : d.status === "failed" ? "❌" : "🔄";
      return `${statusIcon} ${d.tag} — ${d.timestamp} by @${d.author}\n   "${d.message}"`;
    })
    .join("\n");
}

/**
 * Returns the raw deploy records array (useful for programmatic analysis).
 * Key for Phase 3: checking if the latest deploy might have caused the incident.
 */
export function getDeploysData(service: string): DeployRecord[] {
  return SERVICE_DEPLOYS[service] || [];
}

/**
 * Checks if the most recent deploy was within a configurable time window.
 * Useful for correlating deploys with incidents.
 */
export function getLatestDeploy(service: string): DeployRecord | undefined {
  const deploys = SERVICE_DEPLOYS[service];
  return deploys?.[0];
}
