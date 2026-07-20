# Phase 2 — Sandbox, validation & orchestration

**PRD:** Week 2, Days 8–14  
**Status:** Complete  
**Features:** F2 (sandbox), F3 (diff / cost / security preview)

---

## What this phase delivers

Generated CDK is **never trusted blindly**. It runs in an isolated Lambda that executes `cdk synth`, then a shared library turns the CloudFormation template into:

- **Diff** — green create / blue modify / red delete  
- **Cost estimate** — heuristic + AWS Pricing API  
- **Security scan** — IAM wildcards, public S3, unencrypted RDS, open security groups  

An **orchestration Lambda** chains: Claude → sandbox → analysis → **awaiting approval**, with state in **DynamoDB**.

---

## Architecture

```text
OrchestrationLambda
  ├─► Anthropic (generate CDK)
  ├─► SandboxLambda (cdk synth → template)
  ├─► packages/changeset (analyze)
  └─► DynamoDB (GenerationsTable)

ApprovalLambda
  └─► approve | cancel → update DynamoDB
```

---

## Key components

### Sandbox (F2)

| Piece | Location |
|-------|----------|
| Sandbox handler | `infra/lambda/sandbox/index.ts` |
| CDK layer (pinned versions) | `infra/lambda/sandbox-layer/` via `scripts/build-sandbox-layer.sh` |
| Sandbox stack | `infra/lib/sandbox-stack.ts` |
| IAM | Logs only — **no S3, IAM, or other AWS API access** |

Sandbox writes code to `/tmp`, symlinks layer `node_modules`, runs `cdk synth`, returns first `*.template.json`.

### Changeset library (F3)

| Module | File | Output |
|--------|------|--------|
| Parser | `packages/changeset/src/parser.ts` | `Changeset` with per-resource actions |
| Diff renderer | `packages/changeset/src/diffRenderer.ts` | Summary + colors for UI |
| Cost | `packages/changeset/src/costEstimator.ts` | Monthly USD + `basis` string |
| Security | `packages/changeset/src/securityScanner.ts` | Flags with severity |
| Analyzer | `packages/changeset/src/analyzer.ts` | Orchestrates all three + Zod |

### Orchestration + approval

| Piece | Location |
|-------|----------|
| Orchestration handler | `infra/lambda/orchestrate/index.ts` |
| Approval handler | `infra/lambda/approve/index.ts` |
| History API | `infra/lambda/history/index.ts` — `GET /history?conversationId=` |
| DynamoDB table | `infra/lib/infra-stack.ts` — `GenerationsTable` |
| UI panels | `DiffPanel`, `CostEstimatePanel`, `SecurityFlagsPanel`, `ApprovalBar` |

---

## Status machine (Phase 2)

```text
generating → awaiting_approval → approved | cancelled
           → failed
```

*(Phase 4 extends `approve` to trigger deploy — see Phase 4 doc.)*

---

## Important concepts

### Why a separate Sandbox stack?

- **Blast radius:** LLM code cannot call your AWS APIs.
- **Reproducibility:** Pinned CDK in the layer (`aws-cdk-lib@2.170.0`).
- **Cost:** Synth runs in Lambda; you pay per invocation, not per developer laptop setup.

### Why DynamoDB?

- Conversation + generation IDs (`conversationId`, `generationId`)
- Enables history API and later WebSocket reconnect (Phase 3)
- Stores changeset, cost, security for reload without re-running Claude

### Follow-up prompts (enhanced in Phase 3)

Orchestration can prepend **previous CDK code** when `followUpFromGenerationId` is sent — refinements without starting from scratch.

---

## How to verify Phase 2

1. Complete [VERIFICATION.md](../VERIFICATION.md) sections 1–4.1 and 5 (orchestration + history curl).
2. Do **not** approve deploy yet if you only want Phase 2 — cancel or stop before Phase 4 deploy.

| Check | Expected |
|-------|----------|
| Orchestration response | `status: awaiting_approval`, `diff`, `costEstimate`, `securityFlags` |
| DynamoDB item | Same fields + `generatedCdkCode` |
| Bad IAM prompt | Security flags for `Action: '*'` |
| Open SG prompt | Flag for `0.0.0.0/0` |

**Security test prompt:** `Create a security group that allows SSH from anywhere`

---

## Tests

```bash
cd packages/changeset && npm test
cd infra && npm test   # includes orchestration.test.ts, approval.test.ts, history.test.ts
```

---

## Next phase

→ [Phase 3 — Streaming & polish](./phase-03-streaming-polish.md): live pipeline steps over WebSocket, DynamoDB history in UI.
