/**
 * Type declarations for Cloudflare Workers environment bindings.
 *
 * This file augments the global `env` type with our project-specific
 * bindings (Workers AI, Vectorize, Workflows).
 *
 * In Cloudflare Workers, `env` is available as a global parameter.
 * We declare it here so that `typeof env` can be used as a type
 * parameter for the `Agent<typeof env, IncidentState>` class.
 */

// ── Cloudflare Workers environment bindings ───────────────────────
// These match the bindings declared in wrangler.toml

interface AI {
  /** Call a Workers AI model */
  run(model: string, options: {
    messages: Array<{ role: string; content: string }>;
    stream?: boolean;
  }): AsyncIterable<string>;
}

interface VECTORIZE {
  /** Query the Vectorize index for semantic matches */
  query(args: {
    query: string;
    topK?: number;
    returnVectors?: boolean;
  }): {
    matches: Array<{
      score: number;
      metadata?: Record<string, unknown>;
      text?: string;
    }>;
  };
  /** Upsert documents into the Vectorize index */
  upsert(documents: Array<{
    id: string;
    values: string[];
    metadata?: Record<string, unknown>;
  }>): Promise<void>;
}

interface WORKFLOWS {
  /** Trigger a Workflow and await its result */
  run(workflow: string, inputs: Record<string, unknown>): Promise<string>;
}

// ── Combined Environment Type ──────────────────────────────────────
// This type is used as the Env parameter in Agent<Env, State>

export interface Env {
  AI: AI;
  VECTORIZE: VECTORIZE;
  WORKFLOWS: WORKFLOWS;
}

// ── Global Declaration ─────────────────────────────────────────────
// Cloudflare Workers provides `env` as a global parameter.
// We declare it here so `typeof env` resolves correctly in the Worker context.

declare const env: Env;
