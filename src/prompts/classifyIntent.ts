/**
 * classifyIntent — Intent classification prompt for OpsPilot.
 *
 * This prompt is sent to the LLM to determine the user's intent based on
 * their latest message and the current incident state.
 *
 * The LLM outputs a JSON object with:
 *   - intent: "new_incident" | "followup" | "question" | "approval_response"
 *   - service: (optional) the service mentioned in the message
 *
 * Using a small, fast, low-temperature model for intent classification
 * keeps latency low — the heavy reasoning model (Llama 3.3 70B) is only
 * called for synthesis, not for classification.
 *
 * Note: In the current implementation, we use the same Llama 3.3 model for
 * both classification and synthesis. In production, you'd route classification
 * to a smaller model (e.g., Llama 3.1 8B) for cost savings.
 */

export const classifyIntentPrompt = `Classify the user's intent from their message and the current incident state.

Respond ONLY in valid JSON, no markdown formatting, no other text.

Current incident context:
{
  incidentId: "{{incidentId}}",
  service: "{{service}}",
  status: "{{status}}",
  lastMessage: "{{lastMessage}}"
}

User message: "{{userMessage}}"

Output JSON:
{
  "intent": "new_incident" | "followup" | "question" | "approval_response",
  "service": "string (optional - extracted from message if mentioned)"
}

Guidelines:
- "new_incident": User reports a new operational problem
- "followup": User is asking about an existing, active incident
- "question": User asking a general question not related to an incident
- "approval_response": User responding to an approval request (approve/reject)
- Extract the service name ONLY if explicitly mentioned in the message.`;

/**
 * Build the classification message payload for the LLM.
 */
export function buildClassifyMessage(
  incidentState: { incidentId: string; service: string; status: string },
  userMessage: string
): string {
  return classifyIntentPrompt
    .replace("{{incidentId}}", incidentState.incidentId)
    .replace("{{service}}", incidentState.service)
    .replace("{{status}}", incidentState.status)
    .replace("{{lastMessage}}", userMessage)
    .replace("{{userMessage}}", userMessage);
}
