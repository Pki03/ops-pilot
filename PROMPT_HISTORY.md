# Prompt History — OpsPilot Development

> This document logs every prompt sent to AI tools during development.
> Required submission artifact per the project spec.

## [Phase 0 — Scaffold] Prompt to AI code generation

**Prompt:**
"Scaffold a Cloudflare Workers project called OpsPilot using the `agents` SDK. Requirements:
- package.json with `agents` dependency and wrangler
- wrangler.jsonc with Workers AI binding, Durable Object binding for IncidentAgent, Vectorize index binding named 'runbook-knowledge', and Workflows binding
- src/index.ts as the Worker entry point
- src/agents/IncidentAgent.ts extending Agent<Env, IncidentState>
- src/workflows/InvestigateIncident.ts as a Cloudflare Workflow definition
- Mock tool generators in src/tools/
- LLM prompt templates in src/prompts/
- Vectorize seed script in scripts/seedVectorize.ts
- A React Pages frontend scaffold

Use TypeScript. The Agent class should have onStart and onMessage lifecycle methods. State should include incidentId, service, status, messages, findings, and proposedAction fields."

---

## Outcome

**What was kept:**
- Full project scaffold with all specified files
- IncidentAgent class with proper TypeScript generics for Env and IncidentState
- Workflow definition with step.do() pattern
- Mock data generators with realistic, seeded data
- Prompt templates with strict JSON output requirements
- Clean separation of concerns across files

**What was changed:**
- The initial scaffold had the Agent class using `@callable()` decorator syntax which is from a different SDK version — switched to method-based approach that works with the core `agents` SDK
- Vectorize seed script initially tried to call real Vectorize API — replaced with simulated embedding for local dev

**What was rejected:**
- Using a separate LLM service for intent classification — decided to use the same Workers AI model for simplicity in Phase 0, with plan to optimize later
- Adding real GitHub API calls for deploy history — decided to keep everything mocked for demo reliability

---

## [Phase 1 — Core Agent + Chat Loop]

**Prompt:**
"Implement the core chat loop for IncidentAgent. Requirements:
- onStart initializes state with incidentId, service, status, messages, findings
- onMessage receives user message, appends to messages array, calls LLM, returns response
- LLM call uses Workers AI @cf/meta/llama-3.3-70b-instruct-fp8-fast with streaming
- handleApprovalResponse method handles approve/reject when status === awaiting_approval
- setState and getState for persisting per-incident data
- Add @callable() methods for approveAction and rejectAction"

**Outcome:**
Implemented full chat loop with streaming LLM responses. State persists correctly across messages. Approval handling works for both approve and reject cases.

---

## [Phase 2 — Tools + Vectorize]

**Prompt:**
"Create realistic mock data generators and Vectorize integration:
- fetchLogs.ts: deterministic mock logs by service name, 7 log entries per service
- fetchMetrics.ts: latency (p50/p95/p99), error rate, throughput, CPU, memory
- recentDeploys.ts: 3-4 deploy records per service with tags, timestamps, status
- searchRunbooks.ts: Vectorize query wrapper with fallback for local dev
- scripts/seedVectorize.ts: embed 10 runbook documents into Vectorize index using Workers AI @cf/baai/bge-base-en-v1.5 embedding model
- src/tools/fetchAll.ts: unified investigate() entry point calling all tools with timing
- Include realistic service-specific data for checkout-service, payment-service, search-service
- src/tools/index.ts: barrel export for all tools"

**Outcome:**
All mock data generators produce deterministic, realistic output. Vectorize search has fallback for local dev. 10 runbook documents defined with realistic content. seedVectorize.ts uses Workers AI BGE embedding model for actual Vectorize embedding. fetchAll.ts provides unified investigate() entry point with timing and error resilience. TypeScript compiles cleanly.

**Key design decisions:**
- `seedVectorize.ts` has both local dev simulation AND production Workers AI embedding paths — uses `@cf/baai/bge-base-en-v1.5` model which produces 768-dim vectors
- `fetchAll.ts` wraps all tool calls in `timed()` helper with error fallbacks — if one tool fails, investigation continues with partial data
- `searchRunbooks.ts` properly handles Vectorize responses with `result.matches` mapping

---

## [Phase 3 — Workflow Orchestration]

**Prompt:**
"Define the InvestigateIncident Cloudflare Workflow with step.do() calls:
1. step.do('fetch-logs', ...) → calls fetchLogsTool
2. step.do('fetch-metrics', ...) → calls fetchMetricsTool
3. step.do('search-runbooks', ...) → calls searchRunbooksTool
4. step.do('recent-deploys', ...) → calls recentDeploysTool
5. step.do('synthesize', ...) → calls synthesizeFindings with all results
- Return structured result with logs, metrics, runbookMatches, recentDeploys, synthesis
- synthesizeFindings calls LLM with all findings to produce JSON: hypothesis, confidence, evidence, recommendedAction, requiresApproval, humanSummary"

**Outcome:**
Workflow defined as `WorkflowEntrypoint<Env, InvestigationInputs>` subclass with 5 durable `step.do()` calls. Each step is checkpointed and survives Worker restarts. Synthesis step produces structured JSON from all investigation data.

**Changes made:**
- Rewrote `src/workflows/InvestigateIncident.ts` as a proper `WorkflowEntrypoint<Env, InvestigationInputs>` class extending `cloudflare:workers.WorkflowEntrypoint`
- The `run(event, step)` method orchestrates 5 sequential steps via `step.do("name", async () => { ... })`
- Each `step.do()` creates a durable checkpoint — if the Worker crashes mid-execution, the Workflow resumes from the last checkpoint
- Added helper functions: `fetchLogsTool()`, `fetchMetricsTool()`, `searchRunbooksTool()`, `recentDeploysTool()`, `synthesizeFindings()`
- Updated `src/agents/IncidentAgent.ts` to trigger the Workflow via `env.WORKFLOWS.run("InvestigateIncident", inputs)` in `triggerInvestigation()` method
- Added local fallback simulation in `runLocalInvestigation()` for when Workflows binding is unavailable (local dev)
- Added `stepUpdates` to `IncidentState` interface for tracking Workflow progress
- Updated `wrangler.toml` with `[[workflows]]` binding for `WORKFLOWS`/`InvestigateIncident`
- Updated `src/index.ts` to export both `IncidentAgent` and `InvestigateIncident`
- Key design: Agent (Durable Object) is the "brain" managing state + approval gate; Workflow is the "execution engine" running investigation steps durably. This separation ensures investigation progress survives Worker restarts.
- `wrangler dev --local` confirmed WORKFLOWS (InvestigateIncident) binding registered correctly

---

## [Phase 4 — Human-in-the-Loop Approval]

**Prompt:**
"Add human-in-the-loop approval to IncidentAgent:
- When synthesis returns requiresApproval: true, set state.status to 'awaiting_approval'
- Create @callable() approveAction() and rejectAction() methods
- On approve: call mock pageOnCall/rollbackDeploy, set status to 'resolved'
- On reject: set status back to 'investigating'
- Add approval card UI component in frontend"

**Outcome:**
Approval gate implemented. Agent transitions to awaiting_approval state, waits for explicit user response. Approval triggers mocked action and resolution. Rejection returns to investigating state.

---

## [Phase 5 — Memory Loop Closing]

**Prompt:**
"Add memory loop closing:
- On resolution, embed {incidentId, service, hypothesis, resolutionSummary} into Vectorize using upsert
- Modify searchRunbooks to check for resolved incident precedents
- When a similar incident is reported, surface the previous incident as precedent
- Add upsertIncidentResolution function to searchRunbooks.ts"

**Outcome:**
Resolution embedding implemented. Vectorize upsert adds resolved incidents to the index. Future searches surface past incidents as precedent.

**Changes made:**
- `searchRunbooks.ts` already had `upsertIncidentResolution()` function that embeds `{incidentId, service, hypothesis, resolutionSummary}` into Vectorize with metadata
- Added `checkPrecedents()` method to `IncidentAgent.ts` — queries Vectorize for similar resolved incidents using `vectorize.query()`
- Updated `handleInvestigationResult()` to call `upsertIncidentResolution()` on resolution and `checkPrecedents()` to surface historical incidents
- `handleInvestigationResult()` now sends `precedents_found` WebSocket message type to the client when similar past incidents exist
- Both Workflow and local fallback paths call `upsertIncidentResolution` and `checkPrecedents` via `handleInvestigationResult`
- Updated `src/tools/index.ts` barrel export to include `upsertIncidentResolution`
- Phase 5 is fully implemented: when an incident is resolved, it's embedded into Vectorize as a precedent; when a new incident is investigated, similar past incidents are surfaced to the agent

---

## [Phase 6 — Voice (Optional)]

**Status:** Skipped — scope management per spec §9.7. Not blocking the core demo.

---

## [Phase 7 — Polish, Deploy]

**Status:** Pending — will complete after all phases verified.
