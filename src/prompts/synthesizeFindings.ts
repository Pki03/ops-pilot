/**
 * synthesizeFindings — Investigation synthesis prompt for OpsPilot.
 *
 * This prompt is sent to the LLM with all investigation findings (logs, metrics,
 * runbook matches, recent deploys) and asks it to produce a structured JSON
 * response with the root cause hypothesis and recommended action.
 *
 * The key design decisions here:
 * 1. We ask for STRICT JSON output — the agent parses the response programmatically
 * 2. The "humanSummary" field is what gets streamed to the user — it's the readable version
 * 3. "requiresApproval" is always true for any state-changing action (safety gate)
 * 4. "confidence" is a 0-1 score — useful for the UI to show how certain the agent is
 *
 * This prompt runs in the Workflow's "synthesize" step (Phase 3).
 */

export const synthesizeFindingsPrompt = `You are an expert SRE/incident commander. Analyze the following investigation findings and produce a structured response.

Respond ONLY in valid JSON, no markdown formatting, no other text.

INCIDENT REPORT
- Incident ID: {{incidentId}}
- Service: {{service}}
- User reported: "{{userMessage}}"

INVESTIGATION FINDINGS:
- Logs:
{{logs}}

- Metrics:
{{metrics}}

- Runbook matches:
{{runbooks}}

- Recent deploys:
{{deploys}}

OUTPUT JSON (strict format):
{
  "hypothesis": "string — the likely root cause of the incident",
  "confidence": number (0-1 — how confident you are in this hypothesis),
  "evidence": ["string", "key evidence points supporting the hypothesis"],
  "recommendedAction": "string — what should be done next (be specific)",
  "requiresApproval": true (always true — any state-changing action needs human approval)",
  "humanSummary": "string — natural-language summary of findings to show the user"
}

Rules:
- Be specific in the hypothesis — don't be vague like "could be many things"
- Evidence must reference specific data from the findings above
- Confidence should reflect the amount and quality of evidence available
- recommendedAction must be actionable and specific
- humanSummary should be concise and suitable for display to a non-technical stakeholder
- NEVER recommend destructive actions without noting they require approval`;

/**
 * Build the synthesis prompt from investigation results.
 */
export function buildSynthesizeMessage(
  incidentId: string,
  service: string,
  userMessage: string,
  logs: string,
  metrics: string,
  runbookMatches: string,
  deploys: string
): string {
  return synthesizeFindingsPrompt
    .replace("{{incidentId}}", incidentId)
    .replace("{{service}}", service)
    .replace("{{userMessage}}", userMessage)
    .replace("{{logs}}", logs)
    .replace("{{metrics}}", metrics)
    .replace("{{runbooks}}", runbookMatches)
    .replace("{{deploys}}", deploys);
}
