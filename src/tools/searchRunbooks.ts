/**
 * searchRunbooks — Vectorize query wrapper for OpsPilot.
 *
 * Queries the Vectorize index `runbook-knowledge` for semantic matches to the
 * reported incident service and description.
 *
 * This is the "knowledge base lookup" piece of the investigation pipeline.
 * In Phase 2, runbooks are embedded into Vectorize via scripts/seedVectorize.ts.
 * Here, we perform a vector similarity search to find relevant runbook documents.
 *
 * The Vectorize binding comes from env.VECTORIZE (configured in wrangler.toml).
 * The `query` method performs cosine similarity search against the embedded documents.
 */

/**
 * Search the Vectorize index for runbook matches related to a service.
 *
 * @param vectorize - The Vectorize binding from Cloudflare environment
 * @param service - The service name to search for
 * @param query - Optional additional context to refine the search
 * @returns Array of matching documents with their similarity scores
 */
export async function searchRunbooks(
  vectorize: any,
  service: string,
  query?: string
): Promise<{ title: string; score: number; snippet?: string }[]> {
  // If Vectorize binding is not available (e.g., during local dev),
  // return a fallback result so the demo still works without a live Vectorize index
  if (!vectorize || typeof vectorize.query !== "function") {
    return [
      { title: `${service} — high latency runbook`, score: 0.85 },
      { title: `${service} — connection pool exhaustion`, score: 0.72 },
      { title: `${service} — general incident response`, score: 0.55 },
    ];
  }

  const searchQuery = query || `incident ${service} latency error`;

  try {
    // Call Vectorize's query method with the search text
    // topK: 5 returns the 5 most similar documents
    // returnVectors: true includes the vector data in the response
    const result = await vectorize.query({
      query: searchQuery,
      topK: 5,
      returnVectors: false,
    });

    // Vectorize returns matches sorted by similarity score (highest first)
    const matches = result.matches.map((match: any) => ({
      title: match.metadata?.title || match.text?.slice(0, 80) || "Unknown runbook",
      score: match.score || 0,
      snippet: match.text?.slice(0, 200),
    }));

    return matches;
  } catch (error) {
    console.error("Vectorize query failed:", error);
    // Fallback: return empty results so the investigation continues
    return [];
  }
}

/**
 * Upsert an incident resolution back into Vectorize as a precedent.
 * This is the "memory loop closing" feature — after resolving an incident,
 * the resolution is embedded so future similar incidents can find it as precedent.
 *
 * @param vectorize - The Vectorize binding
 * @param incidentData - The incident data to embed
 */
export async function upsertIncidentResolution(
  vectorize: any,
  incidentData: {
    incidentId: string;
    service: string;
    hypothesis: string;
    resolutionSummary: string;
  }
): Promise<void> {
  if (!vectorize || typeof vectorize.upsert !== "function") {
    console.warn("Vectorize not available — skipping incident embedding.");
    return;
  }

  const documentText = `Incident ${incidentData.incidentId}: ${incidentData.service}\nHypothesis: ${incidentData.hypothesis}\nResolution: ${incidentData.resolutionSummary}`;

  try {
    await vectorize.upsert([
      {
        id: `resolved-${incidentData.incidentId}`,
        values: [documentText], // The text to embed and store
        metadata: {
          title: `Resolved: ${incidentData.incidentId} - ${incidentData.service}`,
          incidentId: incidentData.incidentId,
          service: incidentData.service,
          resolution: incidentData.resolutionSummary,
          type: "resolved_incident",
        },
      },
    ]);

    console.log(`Embedded incident ${incidentData.incidentId} into Vectorize.`);
  } catch (error) {
    console.error("Failed to upsert incident resolution:", error);
  }
}
