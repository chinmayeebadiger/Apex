# Phase 3 — Streaming, history & UI polish

**PRD:** Week 3, Days 15–19  
**Status:** Complete  
**Feature:** F4 (pipeline streaming — generation half)

---

## What this phase delivers

The app **feels live**: WebSocket pushes each orchestration step to the browser while Claude, sandbox, and analysis run. The sidebar loads **real history from DynamoDB**, supports **search/filter**, **follow-up refinements**, **timestamps**, and a **mobile-friendly** layout.

Deploy log streaming (CloudFormation events) is added in **Phase 4** on the same WebSocket.

---

## Architecture

```text
Browser ←WebSocket→ API Gateway WebSocket API
                         ↑
              pipeline_step (orchestration)
              deploy_event  (Phase 4 deploy)

Browser ──POST + connectionId──► OrchestrationLambda
Browser ──GET /history────────► HistoryLambda ──► DynamoDB
```

---

## Key components

| Piece | Location | Role |
|-------|----------|------|
| WebSocket connect | `infra/lambda/ws-connect/index.ts` | Sends `{ type: connected, connectionId }` |
| WebSocket disconnect | `infra/lambda/ws-disconnect/index.ts` | Clean disconnect |
| WebSocket API | `infra/lib/infra-stack.ts` | `PipelineWebSocketApi` + stage |
| Pipeline emitter | `infra/lambda/shared/pipelineStream.ts` | `pipeline_step` messages |
| Orchestration (updated) | `infra/lambda/orchestrate/index.ts` | Emits steps; accepts `connectionId` |
| History Lambda | `infra/lambda/history/index.ts` | Query by `conversationId` |
| WebSocket hook | `frontend/src/hooks/usePipelineWebSocket.ts` | Connect, parse events |
| Pipeline UI | `frontend/src/components/PipelineSteps.tsx` | Step list + spinners |
| Conversation ID | `frontend/src/lib/conversation.ts` | Stable `conversationId` in localStorage |
| Diff from history | `frontend/src/lib/diff.ts` | Rebuild diff panel from stored changeset |

---

## WebSocket message types (Phase 3)

### `connected`

```json
{ "type": "connected", "connectionId": "abc123" }
```

Frontend stores `connectionId` and sends it with orchestration requests.

### `pipeline_step`

```json
{
  "type": "pipeline_step",
  "conversationId": "...",
  "generationId": "...",
  "step": "generating_code | validating | analyzing | awaiting_approval | failed",
  "label": "Human-readable label",
  "status": "running | done | error",
  "durationMs": 1234,
  "output": "Optional truncated detail"
}
```

---

## UI features (Day 17–19)

| Feature | Where |
|---------|--------|
| Live pipeline panel | Chat column during generate |
| Header connection indicator | “Pipeline stream connected” |
| History search | Sidebar filter input |
| DynamoDB-backed history | Load on mount via `GET /history` |
| Follow-up refine | “Refine this stack…” button → sends previous code context |
| Timestamps | Chat + sidebar |
| Mobile layout | `flex-col md:flex-row`, stacked panels |

---

## Environment variables

```env
NEXT_PUBLIC_WEBSOCKET_URL=wss://....execute-api.ap-south-1.amazonaws.com/prod
```

Must match CDK output **`WebSocketUrl`**.

**Optional backend flag:** `SIMULATE_SLOW_STEPS=1` on OrchestrationLambda — adds ~750ms per step for demos.

---

## How to verify Phase 3

1. [VERIFICATION.md](../VERIFICATION.md) section 3 — header shows **connected**.
2. Section 4.1 — **Live Pipeline** animates through 3+ steps.
3. Section 5 — history curl returns items.
4. Resize browser to phone width — layout stacks vertically.

| Fail | Fix |
|------|-----|
| “Pipeline stream offline” | Check `NEXT_PUBLIC_WEBSOCKET_URL` |
| No steps during generate | Pass `connectionId` in body; check orchestration env `WEBSOCKET_MANAGEMENT_ENDPOINT` |
| Empty history | Run at least one generation; use same `conversationId` from localStorage key `apex_conversation_id` |

---

## Known limitations

- Deploy events use the same socket but are documented under [Phase 4](./phase-04-deploy-ship.md).
- History sidebar also caches in `localStorage` for snappy reload; DynamoDB is source of truth when API is configured.
- Review noted: switching history items during an active deploy can show stale deploy UI until fixed (see phase review IMPORTANT-1).

---

## Next phase

→ [Phase 4 — Deploy & ship](./phase-04-deploy-ship.md): Approve triggers real CloudFormation + live deploy logs.
