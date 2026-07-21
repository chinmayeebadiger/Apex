# Phase 3 — Streaming, History & UI Polish

> **Status:** Complete · **PRD:** Week 3, Days 15–19 · **Feature:** F4 (generation streaming half)  
> **Last updated:** July 21, 2026

---

## Phase Overview

### Goal of the phase

Make the app **feel live**: stream orchestration steps to the browser over WebSocket, load real history from DynamoDB, support follow-up refinements, and polish the layout for mobile.

### Problems this phase solves

- Users stare at a spinner for 30–90s during generate with no feedback.
- History sidebar used only `localStorage` — stale across devices, lost on clear.
- No way to refine a stack without rewriting the full prompt from scratch.

### Expected outcome

Header shows **Pipeline stream connected**. During generate, steps animate (Generating → Synth → Analyze → Ready). Sidebar loads from `GET /history`. Follow-up button sends previous CDK context to orchestration.

---

## Architecture Decisions

| Decision | Why | Alternatives | Tradeoffs |
|----------|-----|--------------|-----------|
| **API Gateway WebSocket API** | Bi-directional; server pushes without polling | SSE on Function URL, polling DynamoDB | Connection management + `@connections` IAM |
| **`connectionId` in orchestration POST body** | Lambda knows which socket to push to | Store connectionId in DynamoDB by session | Client must connect before generate |
| **Same WebSocket for deploy events (Phase 4)** | One client hook; reuse infrastructure | Second socket for deploy | Message types must be discriminated (`pipeline_step` vs `deploy_event`) |
| **DynamoDB as history source of truth** | Backend already writes every generation | localStorage only | Still cache locally for snappy reload |
| **`SIMULATE_SLOW_STEPS=1` env** | Demo/debug visible step transitions | Artificial delays in frontend | Never enable in prod |

---

## Implementation Walkthrough

### Task 1 — WebSocket API (CDK)

**What:** WebSocket API with `$connect`, `$disconnect`, and `$default` routes.

**Files:**

- `infra/lib/infra-stack.ts` — `PipelineWebSocketApi`, stage `prod`, management endpoint URL in env
- `infra/lambda/ws-connect/index.ts` — echoes `{ type: 'connected', connectionId }` to client
- `infra/lambda/ws-disconnect/index.ts` — no-op ack
- `infra/lambda/ws-default/index.ts` — handles stray client messages (added after connect issues)

**Interaction:** Browser opens `wss://.../prod` → connect Lambda runs → client stores `connectionId`.

Management endpoint (for Lambdas to push):

```typescript
WEBSOCKET_MANAGEMENT_ENDPOINT=https://{apiId}.execute-api.{region}.amazonaws.com/prod
```

### Task 2 — Pipeline streamer

**What:** Helper to POST JSON to a connection via API Gateway Management API.

**Files:**

- `infra/lambda/shared/pipelineStream.ts` — `createPipelineStreamer()`, `emitStep()`

**Interaction:** Orchestrator wraps each step in `runStep()` → `emitStep(connectionId, { type: 'pipeline_step', step, status, ... })`.

410 Gone errors (stale connection) are swallowed — client may have disconnected.

### Task 3 — Orchestration streaming hooks

**What:** Accept optional `connectionId`; emit steps for `generating_code`, `validating`, `analyzing`, `awaiting_approval`, `failed`.

**Files:**

- `infra/lambda/orchestrate/index.ts` — `runStep()` helper with duration + truncated output

If `connectionId` is omitted, streaming is skipped (curl still works).

### Task 4 — Frontend WebSocket hook

**What:** React hook connects on mount, parses messages, maintains `steps[]` and `connectionId`.

**Files:**

- `frontend/src/hooks/usePipelineWebSocket.ts`
- `frontend/src/components/PipelineSteps.tsx` — UI list with spinners

**Interaction:** `page.tsx` passes `connectionId` in orchestration and approve POST bodies (Phase 4 deploy events use same hook).

### Task 5 — History from API

**What:** On mount, `GET /history?conversationId=` from API Gateway; map records to `GenerationItem`.

**Files:**

- `frontend/src/lib/conversation.ts` — stable `conversationId` in `localStorage` key `apex_conversation_id`
- `frontend/src/lib/diff.ts` — rebuild diff panel from stored `changeset`
- `frontend/src/app/page.tsx` — `loadHistory()`, search filter, follow-up button

### Task 6 — UI polish

- Timestamps in chat and sidebar
- Mobile: `flex-col md:flex-row`, stacked panels
- Example prompt cards on empty state
- Confetti on successful generation (UX delight)

---

## Important Code

### `pipeline_step` message shape

```typescript
interface PipelineStepMessage {
  type: 'pipeline_step';
  conversationId: string;
  generationId: string;
  step: 'generating_code' | 'validating' | 'analyzing' | 'awaiting_approval' | 'failed';
  label: string;
  status: 'running' | 'done' | 'error';
  durationMs?: number;
  output?: string;
}
```

### Emit to WebSocket

```typescript
await managementClient.send(new PostToConnectionCommand({
  ConnectionId: connectionId,
  Data: Buffer.from(JSON.stringify(message)),
}));
```

### Frontend env

```env
NEXT_PUBLIC_WEBSOCKET_URL=wss://xxxx.execute-api.ap-south-1.amazonaws.com/prod
```

Must match CDK output `WebSocketUrl` exactly (`wss://`, stage name).

### Follow-up prompt construction (orchestrator)

Loads previous generation's `generatedCdkCode` from DynamoDB and builds a multi-line prompt: *"Refine the following existing stack…"* + code + user request.

---

## Important Commands

| Command | What / why | When |
|---------|------------|------|
| `cd infra && npm run deploy` | Deploy WebSocket routes + Lambdas | After ws handler changes |
| `cd frontend && npm run dev` | Test WebSocket from browser | UI work |
| `websocat "$WS_URL"` | CLI WebSocket smoke test | Optional; verify `connected` message |

```bash
# History API
curl -s "${API_URL%/}/history?conversationId=$CID" | jq '.items | length'
```

---

## Key Concepts Learned

### API Gateway WebSocket vs REST

WebSocket API has **routes** (`$connect`, `$disconnect`, custom) backed by Lambdas. To send server→client messages, use the **API Gateway Management API** (separate endpoint URL), not the public `wss://` URL.

### `@connections` resource

IAM permission: `execute-api:ManageConnections` on `arn:.../POST/@connections/*`. Without it, `PostToConnection` fails.

### React `useEffect` WebSocket lifecycle

Connect on mount, close on unmount. Store `connectionId` from first message — orchestration requests must include it.

### Client-side history cache

`localStorage` key `apex_generation_history` mirrors API for fast reload; DynamoDB wins when API is configured.

---

## Common Pitfalls

| Symptom | Cause | Fix |
|---------|-------|-----|
| **Pipeline stream offline** | Missing/wrong `NEXT_PUBLIC_WEBSOCKET_URL` | Copy CDK `WebSocketUrl`; use `wss://` |
| No steps during generate | `connectionId` not sent in POST | Hook must connect before generate |
| Steps out of order | Client sorts by `step` string | Acceptable; labels matter more than order |
| Empty history | Wrong `conversationId` | Check `apex_conversation_id` in localStorage |
| Stale deploy UI when switching history items | Deploy state not reset on item change | Known IMPORTANT-1; reset `deployEvents` on `activeItem` change |

---

## Design Notes

- **410 on PostToConnection:** Client disconnected; don't fail the pipeline — DynamoDB still holds truth.
- **WebSocket default route:** Added so unexpected client pings don't hang; connect route sends initial ack.
- **Phase 4 extends same socket** with `deploy_event` — hook branches on `message.type`.

---

## Phase Summary

### Completed

- WebSocket API + connect/disconnect/default handlers
- Live `pipeline_step` streaming during orchestration
- DynamoDB-backed history API in UI
- Follow-up refinements, search, mobile layout
- PipelineSteps component + connection indicator

### Remaining TODOs

- Reset deploy UI when switching history (fixed partially in Phase 4 work; verify when viewing old items during active deploy)

### Dependencies for Phase 4

- WebSocket infrastructure and `connectionId` flow
- `cloudFormationTemplate` stored on generation record
- Approve endpoint (will async-invoke DeployLambda)

### Knowledge before Phase 4

- CloudFormation change sets (`CreateChangeSet`, `ExecuteChangeSet`)
- Async Lambda invoke (`InvocationType: 'Event'`)
- S3 template URLs for CFN `TemplateURL` parameter
