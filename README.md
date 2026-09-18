# OpsPilot — AI Incident Response Copilot on Cloudflare

An AI agent that autonomously investigates operational incidents, correlates logs/metrics/runbooks, and asks for human approval before taking action.

## Architecture

**OpsPilot** consists of two primary components working in tandem:

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **IncidentAgent** | Cloudflare Durable Object (via `agents` SDK) | Per-incident stateful session with built-in SQL storage |
| **InvestigateIncident** | Cloudflare Workflow | Durable, retryable multi-step investigation pipeline |

**Architecture overview:**

- **IncidentAgent** (Durable Object) manages per-incident state, WebSocket connections, and the human-in-the-loop approval gate
- **InvestigateIncident** (Workflow) orchestrates the multi-step investigation via `step.do()` calls, with checkpointing that survives Worker restarts
- **Workers AI** (Llama 3.3 70B) handles LLM inference for intent classification and finding synthesis
- **Vectorize** (`runbook-knowledge` index) provides semantic search over runbooks and stores resolved incident precedents
- **Frontend** (React + Vite) connects via WebSocket to the IncidentAgent

## Quick Start

### Prerequisites

- Node.js 20+
- Cloudflare account with Workers, Workers AI, Vectorize, and Workflows enabled
- `wrangler` CLI (`npm i -g wrangler`)

### 1. Install dependencies

```bash
npm install
cd frontend && npm install && cd ..
```

### 2. Configure Cloudflare bindings

Edit `wrangler.toml` to add your:
- Workers AI binding (for the `AI` global)
- Vectorize index binding (`runbook-knowledge`)
- Durable Object binding (`IncidentAgent`)
- Workflow binding (`InvestigateIncident`)

### 3. Seed the Vectorize index

```bash
npm run seed
```

This embeds the runbook documents into the `runbook-knowledge` Vectorize index.

### 4. Start local development

```bash
npm run dev
```

### 5. Start the frontend

```bash
npm run frontend
```

### 6. Deploy

```bash
npm run deploy
npm run pages:deploy
```

## Demo Scenarios

### Scenario 1: Checkout service latency spike

1. Open the chat UI
2. Type: "checkout-service API latency spiked"
3. Watch the Workflow investigate (logs → metrics → runbooks → deploys)
4. Review the synthesized findings and proposed action
5. Approve or reject the action

### Scenario 2: Precedent retrieval (memory loop)

1. After resolving Scenario 1, the resolution is embedded in Vectorize
2. Report a similar incident for checkout-service
3. The agent should cite the previous incident as precedent

### Scenario 3: Unknown service

1. Type about a service with no runbook matches
2. Watch the agent handle gracefully with no prior knowledge

## Project Structure

```
opsilot/
├── src/
│   ├── agents/IncidentAgent.ts    # Durable Object agent
│   ├── workflows/InvestigateIncident.ts  # Workflow definition (WorkflowEntrypoint subclass)
│   ├── tools/                     # Mock data generators + upsert + precedent retrieval
│   ├── prompts/                   # LLM prompt templates
│   └── index.ts                   # Worker entry point (exports Agent + Workflow)
├── frontend/                      # Pages chat UI
├── scripts/seedVectorize.ts       # Vectorize seeding script
├── wrangler.toml                  # Cloudflare configuration
└── README.md
```

## How It Works

1. **User sends a message** via WebSocket to the IncidentAgent Durable Object
2. **Agent classifies intent** using Workers AI (Llama 3.3)
3. **For new incidents**, the agent kicks off a Workflow that:
   - Fetches mock logs and metrics
   - Searches the Vectorize runbook knowledge base
   - Checks recent deploys
   - Synthesizes findings into a structured JSON response
4. **Human-in-the-loop**: The agent proposes an action and asks for explicit approval
5. **On approval**: State transitions to resolved, and the resolution is embedded in Vectorize
6. **Memory loop**: Future similar incidents retrieve past resolutions as precedent

## License

MIT