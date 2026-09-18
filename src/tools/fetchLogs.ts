/**
 * fetchLogs — Mock log generator for OpsPilot.
 *
 * Generates deterministic, realistic-looking log output keyed by the service name.
 * Uses a seeded approach so the same service always returns the same logs
 * (important for demo consistency — reviewers should see the same output for the same input).
 *
 * This is a MOCK data generator. In production, this would call:
 *   - Datadog API / Cloudflare Analytics / a log aggregation service
 *   - Real log streams from the service infrastructure
 */

// ── Seeded log templates by service ─────────────────────────────────────────
// Each service has a set of realistic-looking log patterns that match common
// incident scenarios (latency spikes, 5xx errors, connection pool exhaustion, etc.)

const SERVICE_LOGS: Record<string, string[]> = {
  "checkout-service": [
    "[ERROR] Connection pool exhausted - max 50 connections, all in use at 2025-01-15T10:23:00Z",
    "[WARN]  /api/checkout p99 latency 3200ms (threshold: 1000ms) for the last 5 minutes",
    "[ERROR] Timeout waiting for PostgreSQL connection pool - retrying (attempt 3/5)",
    "[INFO]  Retry succeeded for /api/checkout after 4.2s delay",
    "[ERROR] 5xx response rate 12.3% across /api/checkout endpoints in last 10 minutes",
    "[WARN]  Worker restart detected at pod checkout-api-7b8f9d-xk2m1",
    "[ERROR] Failed to process payment webhook from Stripe - idempotency key collision",
  ],
  "payment-service": [
    "[ERROR] Stripe webhook processing failed: signature verification error",
    "[WARN]  Payment processing queue depth at 1500 (threshold: 500)",
    "[ERROR] 5xx response rate 8.7% across /api/v1/charge endpoints",
    "[INFO]  Connection to billing database restored after 45s outage",
    "[ERROR] Retry limit exceeded for payment intent pi_3Nvq5xABCD",
    "[WARN]  Circuit breaker triggered for external payment provider",
  ],
  "search-service": [
    "[ERROR] Elasticsearch cluster health: RED - 2 of 3 nodes unreachable",
    "[WARN]  Search query latency p99 at 5400ms (threshold: 1000ms)",
    "[ERROR] Index 'products_v3' missing shards - automatic recovery in progress",
    "[INFO]  Fallback to cached search results enabled for 30 seconds",
    "[WARN]  High memory pressure on search-node-3 (87% heap usage)",
  ],
};

/**
 * Generate mock logs for a given service.
 * If the service is not in our known services, returns generic system logs.
 *
 * @param service - The name of the service to generate logs for
 * @returns A multiline string of realistic-looking log entries
 */
export function fetchLogs(service: string): string {
  const logs = SERVICE_LOGS[service] || [
    `[WARN]  No specific log data available for "${service}"`,
    `[INFO]  Generic health check: all systems nominal as of ${new Date().toISOString()}`,
    `[ERROR] Last incident for ${service}: none recorded in system`,
  ];

  // Add a timestamp header for realism
  const header = `=== MOCK LOGS for ${service} ===\nGenerated: ${new Date().toISOString()}\n`;
  return header + logs.join("\n");
}

/**
 * Generate logs for a specific error pattern within a service.
 * Useful for creating varied incident scenarios in the demo.
 */
export function fetchLogsForPattern(service: string, pattern: string): string {
  const baseLogs = fetchLogs(service);
  return `${baseLogs}\n\n=== Additional context: ${pattern} ===\n[TRACE] Correlated event: ${pattern} detected in service ${service}`;
}
