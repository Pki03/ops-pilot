/**
 * fetchMetrics — Mock metrics generator for OpsPilot.
 *
 * Generates deterministic, realistic-looking metric data keyed by service name.
 * Simulates common observability metrics: latency (p50/p95/p99), error rate,
 * throughput, and resource utilization.
 *
 * This is a MOCK data generator. In production, this would call:
 *   - Prometheus / Datadog / Cloudflare Analytics APIs
 *   - Real time-series data from the service infrastructure
 */

interface ServiceMetrics {
  service: string;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  errorRate: number;
  throughput: number;
  cpuUsage: number;
  memoryUsage: number;
  status: "healthy" | "degraded" | "critical";
}

// ── Seeded metrics by service ───────────────────────────────────────────────
// Each service has a metric profile that matches a realistic incident scenario.
// The numbers are deliberately inconsistent across services to create variety
// in the demo.

const SERVICE_METRICS: Record<string, ServiceMetrics> = {
  "checkout-service": {
    service: "checkout-service",
    p50LatencyMs: 120,
    p95LatencyMs: 2100,
    p99LatencyMs: 3200,
    errorRate: 12.3,
    throughput: 450,
    cpuUsage: 78,
    memoryUsage: 85,
    status: "critical",
  },
  "payment-service": {
    service: "payment-service",
    p50LatencyMs: 85,
    p95LatencyMs: 420,
    p99LatencyMs: 890,
    errorRate: 8.7,
    throughput: 320,
    cpuUsage: 62,
    memoryUsage: 71,
    status: "degraded",
  },
  "search-service": {
    service: "search-service",
    p50LatencyMs: 200,
    p95LatencyMs: 5400,
    p99LatencyMs: 8100,
    errorRate: 15.2,
    throughput: 180,
    cpuUsage: 91,
    memoryUsage: 88,
    status: "critical",
  },
};

/**
 * Generate mock metrics for a given service.
 * Returns a formatted multi-line string with key observability data.
 *
 * @param service - The name of the service to generate metrics for
 * @returns A formatted string of metrics that look like they came from a monitoring dashboard
 */
export function fetchMetrics(service: string): string {
  const metrics = SERVICE_METRICS[service];

  if (!metrics) {
    return `=== MOCK METRICS for ${service} ===\nNo specific metric data available.\nShowing generic overview:\n  p99 latency: N/A\n  error_rate: N/A\n  status: unknown`;
  }

  const statusEmoji = metrics.status === "critical" ? "🔴" : metrics.status === "degraded" ? "🟡" : "🟢";

  return `=== MOCK METRICS for ${metrics.service} ===\n${statusEmoji} Status: ${metrics.status.toUpperCase()}
Generated: ${new Date().toISOString()}

Latency:
  p50: ${metrics.p50LatencyMs}ms
  p95: ${metrics.p95LatencyMs}ms
  p99: ${metrics.p99LatencyMs}ms

Errors:
  Error rate: ${metrics.errorRate}% (threshold: 1%)

Throughput:
  Requests/sec: ${metrics.throughput}

Resources:
  CPU: ${metrics.cpuUsage}%
  Memory: ${metrics.memoryUsage}%`;
}

/**
 * Returns the raw metrics object (useful for programmatic analysis in the Workflow).
 */
export function getMetricsData(service: string): ServiceMetrics | undefined {
  return SERVICE_METRICS[service];
}
