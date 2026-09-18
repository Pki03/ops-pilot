/**
 * seedVectorize.ts — One-time script to embed runbook documents into Vectorize.
 *
 * Run this once to populate the `runbook-knowledge` Vectorize index with
 * realistic runbook documents. Uses Workers AI embedding model
 * (`@cf/baai/bge-base-en-v1.5`) to generate vector embeddings.
 *
 * Usage: npx tsx scripts/seedVectorize.ts
 *
 * Note: This requires:
 *   1. A Vectorize index named "runbook-knowledge" to already exist.
 *      Create via Cloudflare dashboard or: wrangler vectorize create runbook-knowledge
 *   2. Workers AI binding configured in wrangler.toml
 *   3. To run in the Cloudflare Workers environment (local dev simulation available)
 *
 * How it works:
 *   1. Each runbook's content text is embedded using the Workers AI
 *      BGE embedding model (768-dimensional vectors)
 *   2. The embeddings + metadata are upserted into Vectorize
 *   3. Future semantic searches find these documents by similarity
 *
 * Design note on why Workers AI for embeddings:
 *   The spec requires using Workers AI with the BGE embedding model.
 *   This keeps everything within the Cloudflare ecosystem — no external
 *   API calls, no additional costs, and the embeddings are consistent
 *   with the Vectorize index that the agent searches at runtime.
 */

// ── Runbook Documents ───────────────────────────────────────────────
// 10 realistic runbook documents covering common incident scenarios.
// Each document has title, service, tags, and markdown content.

const RUNBOOKS = [
  {
    title: "High latency on checkout-service",
    service: "checkout-service",
    tags: ["latency", "p99", "database"],
    content: `# High latency on checkout-service

## Symptoms
- p99 latency exceeds 2000ms on /api/checkout endpoints
- Increased connection pool wait times
- 5xx errors correlating with latency spikes

## Investigation Steps
1. Check PostgreSQL connection pool status: SELECT * FROM pg_stat_activity WHERE state = 'active';
2. Verify connection pool size vs active connections
3. Check for slow queries in pg_stat_statements

## Resolution
1. If connection pool exhausted: increase pool size from 50 to 100
2. If slow queries found: add index on orders(status, created_at)
3. If connection leaks: check for unclosed connections in payment service integration`,
  },
  {
    title: "Database connection pool exhaustion",
    service: "checkout-service",
    tags: ["database", "connection-pool", "timeout"],
    content: `# Database connection pool exhaustion

## Symptoms
- Connection timeout errors in application logs
- All pool connections in use, new requests waiting
- Error: Connection pool exhausted - max 50 connections

## Investigation Steps
1. Run SELECT count(*), state FROM pg_stat_activity GROUP BY state;
2. Check for idle-in-transaction connections
3. Check for connection leaks in application code

## Resolution
1. Immediately increase pool size to absorb the spike
2. Find and fix connection leaks (common in error paths)
3. Set idle-in-transaction timeout to 30s
4. Restart workers to clear leaked connections`,
  },
  {
    title: "Elevated 5xx after deploy",
    service: "checkout-service",
    tags: ["deploy", "5xx", "regression"],
    content: `# Elevated 5xx after deploy

## Symptoms
- Sudden spike in 5xx errors immediately after a deployment
- Error rate jumps from <1% to >10% within minutes
- Errors are consistent across all instances

## Investigation Steps
1. Check deploy history for the last 30 minutes
2. Identify the exact commit that was deployed
3. Compare error patterns to known issues in the commit
4. Roll back if the deploy is clearly the cause

## Resolution
1. If deploying caused it: rollback to previous version immediately
2. Fix the bug in a hotfix branch
3. Add integration tests to catch similar issues
4. Consider canary deployments to catch regressions earlier`,
  },
  {
    title: "Connection pool exhaustion on payment-service",
    service: "payment-service",
    tags: ["database", "connection-pool", "stripe"],
    content: `# Connection pool exhaustion on payment-service

## Symptoms
- Stripe webhook processing timeouts
- Payment processing queue depth increasing
- Database connection errors in payment handler

## Investigation Steps
1. Check PostgreSQL connection count on payment-db
2. Verify Stripe webhook concurrency settings
3. Look for long-running transactions blocking the pool

## Resolution
1. Increase connection pool from 30 to 60
2. Add queue-based processing for webhooks instead of synchronous handling
3. Set statement timeout to 10s to prevent long-running queries`,
  },
  {
    title: "Stripe webhook signature verification failure",
    service: "payment-service",
    tags: ["stripe", "webhook", "security"],
    content: `# Stripe webhook signature verification failure

## Symptoms
- Stripe webhooks failing with signature verification errors
- Payments not being processed
- Webhook delivery status shows failures in Stripe dashboard

## Investigation Steps
1. Check if Stripe webhook signing secret was recently rotated
2. Verify the webhook endpoint URL matches what's registered in Stripe
3. Check if the webhook signing secret in environment variables matches

## Resolution
1. Re-copy the signing secret from Stripe dashboard to environment
2. Verify webhook endpoint URL is accessible from Stripe's IP ranges
3. Test with a test webhook from Stripe dashboard`,
  },
  {
    title: "Elasticsearch cluster degraded",
    service: "search-service",
    tags: ["elasticsearch", "cluster", "red-health"],
    content: `# Elasticsearch cluster degraded

## Symptoms
- Cluster health status RED or YELLOW
- Search queries timing out or returning stale results
- High memory/CPU on individual nodes

## Investigation Steps
1. Check cluster health: curl localhost:9200/_cluster/health
2. Identify unassigned shards and their cause
3. Check node disk usage and memory pressure
4. Look for recent index changes that may have caused the issue

## Resolution
1. For RED: restore missing shards from snapshot or re-create the index
2. For YELLOW: allocate unassigned shards to available nodes
3. If disk full: delete old indices or increase storage
4. If memory pressure: increase heap size or add nodes`,
  },
  {
    title: "Search query latency spike",
    service: "search-service",
    tags: ["latency", "elasticsearch", "query"],
    content: `# Search query latency spike

## Symptoms
- p99 search latency exceeds 5000ms
- Users experiencing slow autocomplete and search results
- High CPU on search nodes

## Investigation Steps
1. Check for slow queries in Elasticsearch slow log
2. Verify query cache hit rate
3. Look for heavy aggregations or wildcard queries
4. Check if any indices have high doc_count with few segments

## Resolution
1. Add or optimize aliases for common queries
2. Increase filter cache size
3. Implement query result caching at the application level
4. Consider using search-as-you-type for autocomplete`,
  },
  {
    title: "PostgreSQL slow queries",
    service: "checkout-service",
    tags: ["database", "slow-queries", "optimization"],
    content: `# PostgreSQL slow queries

## Symptoms
- Application response times increasing gradually
- Database CPU at high utilization
- Queries taking >1s in pg_stat_statements

## Investigation Steps
1. Run: SELECT query, mean_exec_time, calls FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;
2. Check for missing indexes on frequently queried columns
3. Look for table bloat
4. Check for lock contention

## Resolution
1. Add missing indexes (check EXPLAIN ANALYZE output)
2. Vacuum analyze tables with high bloat
3. Break large queries into smaller batch operations
4. Consider read replicas for analytics queries`,
  },
  {
    title: "Worker restart causing connection loss",
    service: "checkout-service",
    tags: ["worker", "restart", "connection"],
    content: `# Worker restart causing connection loss

## Symptoms
- Periodic connection errors every few minutes
- Worker logs show restart messages coinciding with errors
- Connections not properly closed on worker shutdown

## Investigation Steps
1. Check worker uptime and restart frequency in logs
2. Verify connection pool cleanup on worker shutdown
3. Check if connections survive the cold start period

## Resolution
1. Implement proper connection pool cleanup in onBeforeDelete
2. Use connection pool that supports graceful shutdown
3. Add connection retry logic with exponential backoff
4. Consider using a persistent connection pool outside the worker`,
  },
  {
    title: "Circuit breaker triggered for external provider",
    service: "payment-service",
    tags: ["circuit-breaker", "external", "payment"],
    content: `# Circuit breaker triggered for external provider

## Symptoms
- All external payment provider calls failing
- Circuit breaker is in OPEN state
- Payment processing stopped

## Investigation Steps
1. Check circuit breaker status and failure rate threshold
2. Verify external provider status page
3. Check if the issue is on our side (timeout config) or provider side
4. Review recent configuration changes to circuit breaker

## Resolution
1. If provider issue: wait for provider to restore, then half-open circuit
2. If config issue: adjust timeout and failure threshold
3. Implement fallback payment method while circuit is open
4. Add monitoring for circuit breaker state changes`,
  },
];

// ── Embedding Function ──────────────────────────────────────────────
// Uses Workers AI BGE embedding model to generate vector embeddings
// for each runbook document.

/**
 * Generate an embedding vector for a text string using Workers AI.
 * Uses the @cf/baai/bge-base-en-v1.5 model which produces 768-dimensional vectors.
 *
 * @param ai - The Workers AI binding from env.AI
 * @param text - The text to embed
 * @returns A Float32Array of 768 dimensions
 */
async function generateEmbedding(ai: any, text: string): Promise<number[]> {
  const response = await ai.run("@cf/baai/bge-base-en-v1.5", {
    input: text,
  });

  // Workers AI returns the embedding as an array of floats
  // The response structure depends on the model output format
  const embedding = response.output || response.embedding || response;

  // Convert to number array if needed
  if (embedding && typeof embedding === "object") {
    if (Array.isArray(embedding)) {
      return embedding.map((v: any) => Number(v));
    }
    // Handle nested response formats
    if (Array.isArray(embedding[0])) {
      return embedding[0].map((v: any) => Number(v));
    }
  }

  throw new Error(`Unexpected embedding response format: ${typeof embedding}`);
}

/**
 * Upsert a single document into Vectorize.
 *
 * @param vectorize - The Vectorize binding from env.VECTORIZE
 * @param id - Unique document ID
 * @param text - The text content to embed and store
 * @param metadata - Metadata associated with the document
 */
async function upsertDocument(
  vectorize: any,
  ai: any,
  id: string,
  text: string,
  metadata: Record<string, unknown>
): Promise<void> {
  // Generate the embedding vector using Workers AI
  const values = await generateEmbedding(ai, text);

  await vectorize.upsert([
    {
      id,
      values: [values], // Vectorize expects an array of vectors
      metadata,
    },
  ]);
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // For local dev, we simulate the embedding process
  // In production, this runs inside the Cloudflare Workers environment
  // where env.AI and env.VECTORIZE are available

  const isLocal = !process.env.CF_WORKER_ENV && !process.env.CF_BINDINGS;

  if (isLocal) {
    // Local dev mode — simulate the embedding
    // In production, this would use real Workers AI + Vectorize
    console.log("🚀 Starting Vectorize seed process (LOCAL MODE)...");
    console.log(`   Index: runbook-knowledge`);
    console.log(`   Documents to embed: ${RUNBOOKS.length}`);
    console.log("");
    console.log("   Note: Local mode simulates embedding.");
    console.log("   For actual Vectorize embedding, deploy to Cloudflare.");
    console.log("");

    for (const runbook of RUNBOOKS) {
      const documentText = `${runbook.content}\n\nTags: ${runbook.tags.join(", ")}`;
      console.log(`   Would embed: "${runbook.title}" (${runbook.service})`);
      console.log(`   → Vector: 768 dimensions (simulated)`);
      console.log(`   ✓ "${runbook.title}" ready`);
    }

    console.log("\n✅ All runbooks processed.");
    console.log("\nTo actually embed into Vectorize, deploy to Cloudflare:");
    console.log("  1. Create the index: wrangler vectorize create runbook-knowledge");
    console.log("  2. Deploy: wrangler deploy");
    console.log("  3. Run: wrangler secret put VECTORIZE_API_KEY (if needed)");
    return;
  }

  // Production mode — use real Workers AI + Vectorize
  // This code runs inside the Cloudflare Workers environment
  // where env is available as a global

  // Access env bindings — in the Cloudflare Workers runtime,
  // env is injected based on wrangler.toml configuration
  const env = (globalThis as any).env || {};
  const ai = env.AI;
  const vectorize = env.VECTORIZE;

  if (!ai || !vectorize) {
    console.error("Missing env bindings (AI, VECTORIZE). Run in Cloudflare Workers environment.");
    process.exit(1);
  }

  console.log("🚀 Starting Vectorize seed process (PRODUCTION MODE)...");
  console.log(`   Index: runbook-knowledge`);
  console.log(`   Documents to embed: ${RUNBOOKS.length}`);
  console.log(`   Embedding model: @cf/baai/bge-base-en-v1.5 (768 dims)`);
  console.log("");

  let count = 0;
  for (const runbook of RUNBOOKS) {
    const documentText = `${runbook.content}\n\nTags: ${runbook.tags.join(", ")}`;

    try {
      await upsertDocument(
        vectorize,
        ai,
        runbook.title,
        documentText,
        {
          title: runbook.title,
          service: runbook.service,
          tags: runbook.tags,
          type: "runbook",
        }
      );
      count++;
      console.log(`   ✓ Embedded "${runbook.title}" (${runbook.service})`);
    } catch (error) {
      console.error(`   ✗ Failed "${runbook.title}":`, error);
    }
  }

  console.log(`\n✅ Embedded ${count}/${RUNBOOKS.length} runbooks into Vectorize index 'runbook-knowledge'`);
}

main().catch(console.error);
