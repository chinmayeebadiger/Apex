# Phase 2 — Sandbox, Validation & Orchestration

> **Status:** Complete · **PRD:** Week 2, Days 8–14 · **Features:** F2, F3 (preview half)  
> **Last updated:** July 21, 2026

---

## Phase Overview

### Goal of the phase

Make generated CDK **safe to preview**: run `cdk synth` in isolation, parse the CloudFormation template into a diff/cost/security report, persist state in DynamoDB, and gate changes behind explicit approve/cancel — still **without** real deploy.

### Problems this phase solves

- LLM code often fails `cdk synth` or contains insecure defaults (public S3, wildcard IAM).
- Users need to see **what would change** and **what it might cost** before touching AWS.
- A single "generate" Lambda cannot hold the full pipeline; state must survive across HTTP requests.

### Expected outcome

Orchestration returns `status: awaiting_approval` with `code`, `diff`, `costEstimate`, `securityFlags`. Approve/cancel updates DynamoDB. UI shows colour-coded panels and an approval bar.

---

## Architecture Decisions

| Decision | Why | Alternatives | Tradeoffs |
|----------|-----|--------------|-----------|
| **Separate SandboxStack** | Zero AWS API permissions on sandbox role — synth only | Same Lambda as orchestrator | Extra stack to deploy; clear blast-radius boundary |
| **CDK in Lambda Layer** (pinned versions) | Reproducible synth; no Docker at runtime | Bundle CDK in function zip | Layer must be rebuilt via script when CDK version changes |
| **`packages/changeset` monorepo package** | Diff/cost/security shared by Lambda and potentially frontend | Inline in orchestrator | Clean tests; imported via relative path in bundling |
| **DynamoDB on-demand** | Low ops; fits conversation + generation records | RDS, S3 JSON files | No relational queries; history by `conversationId` only |
| **Orchestration Function URL (120s)** | Claude + sandbox + pricing can exceed 29s | Step Functions | Simpler; no state machine cost yet |
| **Approval as separate Lambda + REST** | Approve is fast; doesn't need 120s URL | Same orchestration handler | Extra endpoint; clearer separation |
| **Heuristic cost + Pricing API** | Pricing API is slow/incomplete for some SKUs; heuristics fill gaps | Pricing only | Estimates are approximate — UI shows `basis` string |

---

## Implementation Walkthrough

### Task 1 — Sandbox Lambda (F2)

**What:** Isolated Lambda receives `{ code }`, writes temp workspace, runs `cdk synth`, returns CloudFormation JSON or error.

**Why:** Validates CDK before any human approval; cannot mutate user's AWS account.

**Files:**

- `infra/lambda/sandbox/index.ts` — handler
- `infra/lib/sandbox-stack.ts` — restrictive IAM (CloudWatch logs only)
- `scripts/build-sandbox-layer.sh` — pins `aws-cdk-lib@2.170.0`, etc.
- `infra/lambda/sandbox-layer/nodejs/` — layer output (gitignored artifacts)

**Interaction:** Orchestrator `InvokeCommand` → sandbox → `{ success: true, template }` or `{ success: false, error, stderr }`.

Fake AWS env in sandbox:

```typescript
// CDK needs account/region to synth; fake values — no real API calls
CDK_DEFAULT_ACCOUNT=000000000000
```

### Task 2 — Changeset library (F3)

**What:** Parse template → structured changeset; estimate cost; scan for security anti-patterns.

**Files:**

- `packages/changeset/src/parser.ts` — compare templates (first run = all `create`)
- `packages/changeset/src/diffRenderer.ts` — green/blue/red summary for UI
- `packages/changeset/src/costEstimator.ts` — `@aws-sdk/client-pricing` + fallbacks
- `packages/changeset/src/securityScanner.ts` — IAM `*`, public S3, open SGs, unencrypted RDS
- `packages/changeset/src/analyzer.ts` — `analyzeTemplate()` entry

**Interaction:** Orchestrator passes `sandboxResponse.template` to `analyzeTemplate()`.

### Task 3 — Orchestration pipeline

**What:** State machine in code: `generating` → synth → analyze → `awaiting_approval`; writes DynamoDB twice (start + finish).

**Files:**

- `infra/lambda/orchestrate/index.ts` — `createOrchestrationHandler()` (testable factory)
- `infra/lib/infra-stack.ts` — `GenerationsTable`, orchestration env vars

**Interaction:**

```text
POST Function URL { message, conversationId?, generationId? }
  → putGeneration(status: generating)
  → generateCdkCode(anthropic, prompt)
  → invokeSandbox(code)
  → analyzeTemplate(template)
  → putGeneration(status: awaiting_approval)
  → return flattened JSON + diff render model
```

Follow-up support: if `followUpFromGenerationId` is set, orchestrator loads prior CDK from DynamoDB and prepends it to the user prompt.

### Task 4 — Approval + history API

**What:** `POST /approve` with `approve | cancel`; `GET /history?conversationId=`.

**Files:**

- `infra/lambda/approve/index.ts` — Phase 2: status → `approved` | `cancelled` (Phase 4 changes approve → `deploying`)
- `infra/lambda/history/index.ts` — query by partition key, sort by `createdAt` desc

### Task 5 — Frontend preview panels

**What:** Diff, cost, security panels + `ApprovalBar`.

**Files:**

- `frontend/src/components/DiffPanel.tsx`, `CostEstimatePanel.tsx`, `SecurityFlagsPanel.tsx`, `ApprovalBar.tsx`
- `frontend/src/lib/types.ts` — shared TS interfaces
- `frontend/src/app/page.tsx` — calls orchestration URL, then approve URL

---

## Important Code

### Orchestration status enum (initial)

```typescript
'generating' | 'awaiting_approval' | 'approved' | 'cancelled' | 'failed'
```

Extended in Phase 4 with `deploying`, `deployed`, `deploy_failed`.

### Sandbox invoke (`orchestrate/index.ts`)

```typescript
await lambdaClient.send(new InvokeCommand({
  FunctionName: getSandboxFunctionName(),
  InvocationType: 'RequestResponse',
  Payload: Buffer.from(JSON.stringify({ code })),
}));
```

Synchronous invoke — orchestrator waits for synth result (bounded by sandbox 60s timeout).

### DynamoDB schema

| Key | Type | Purpose |
|-----|------|---------|
| `conversationId` | PK (string) | Groups related generations |
| `generationId` | SK (string) | Unique per generation |

Attributes (schemaless): `originalRequest`, `generatedCdkCode`, `cloudFormationTemplate`, `changeset`, `costEstimate`, `securityFlags`, `status`, timestamps.

No GSI — history query is `conversationId = :id` only.

### Security scanner example

Flags `Action: '*'` in IAM policies, S3 buckets without encryption/public block, inbound `0.0.0.0/0` on security groups.

### API endpoints

| Method | Path | Handler |
|--------|------|---------|
| POST | Orchestration Function URL | Full pipeline |
| POST | `/approve` | Approve/cancel |
| GET | `/history?conversationId=` | List generations |

---

## Important Commands

| Command | What / why | When |
|---------|------------|------|
| `./scripts/build-sandbox-layer.sh` | Installs pinned CDK into layer path | **Before every** `cdk deploy` if layer deps changed |
| `cd infra && npm run deploy` | Deploy SandboxStack + InfraStack | After infra changes |
| `cd packages/changeset && npm test` | Parser, cost, security unit tests | After changeset logic changes |
| `cd infra && npm test` | Orchestration + approval tests | After handler changes |

```bash
# Full pipeline curl
curl -s -X POST "$ORCH_URL" -H 'Content-Type: application/json' \
  -d '{"message":"Create a private encrypted S3 bucket"}' | jq '.status, .diff.summary'

# Approve (Phase 2 only flipped status; Phase 4 triggers deploy)
curl -s -X POST "$API_URL/approve" -H 'Content-Type: application/json' \
  -d '{"conversationId":"...","generationId":"...","action":"approve"}' | jq .
```

---

## Key Concepts Learned

### `cdk synth`

CDK app code → CloudFormation template JSON in `cdk.out/*.template.json`. No AWS resources created. Sandbox runs CLI in `/tmp` with symlinked `node_modules` from the layer.

### Lambda layers

Heavy dependencies (CDK, constructs, typescript) live in a layer attached to the sandbox function. Keeps deployment package small and versions pinned.

### CloudFormation changeset (conceptual)

Phase 2 **simulates** a changeset by parsing a single template (all resources = `create`). Phase 4 uses real CFN change sets for deploy.

### DynamoDB composite key

Query all items for one conversation: `KeyConditionExpression: conversationId = :id`. Sort client-side by `createdAt`.

### AWS Pricing API

`pricing:GetProducts` — region-specific, awkward filters. Cost estimator caches results and falls back to heuristics (e.g. "assume 10 GB S3 Standard").

---

## Common Pitfalls

| Symptom | Cause | Fix |
|---------|-------|-----|
| Sandbox `Command not found: cdk` | Layer not built | Run `build-sandbox-layer.sh` |
| Synth timeout | Complex stack or cold start | 60s sandbox timeout; simplify prompt |
| Empty diff | Synth failed upstream | Check orchestration `error` / sandbox `stderr` |
| Approve 409 | Status not `awaiting_approval` | Only approve after successful pipeline |
| Orchestration 500 on pricing | Missing IAM on orchestration Lambda | `pricing:GetProducts` on `*` in infra-stack |
| Relative import errors in sandbox | Model emitted `./lib/stack` without `files` | Refine prompt or use follow-up |

---

## Design Notes

- **Injected handler factories** (`createOrchestrationHandler(deps)`) allow Jest tests without real AWS — pass mock DynamoDB, Lambda, Claude.
- **Template stored in DynamoDB** as JSON — enables re-deploy in Phase 4 without re-running Claude.
- **Approval did not deploy in Phase 2** — `approved` was terminal until Phase 4 wired DeployLambda.

---

## Phase Summary

### Completed

- Sandbox Lambda with zero AWS API access
- `packages/changeset` analyzer
- Orchestration pipeline + DynamoDB persistence
- Approve/cancel + history API
- UI diff/cost/security + approval bar

### Remaining TODOs

- None for Phase 2 scope. Deploy path is Phase 4.

### Dependencies for Phase 3

- Stable orchestration response shape
- DynamoDB records to load in history sidebar
- Long-running pipeline (motivation for WebSocket progress)

### Knowledge before Phase 3

- API Gateway WebSocket APIs (connect/disconnect routes)
- `@aws-sdk/client-apigatewaymanagementapi` `PostToConnectionCommand`
