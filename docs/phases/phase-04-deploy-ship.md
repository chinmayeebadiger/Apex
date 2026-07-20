# Phase 4 — Real deployment & ship

**PRD:** Week 4, Days 22–28  
**Status:** Implemented (review **APPROVED**)  
**Features:** F4 (deploy logs), F5 (history re-run), real CloudFormation deploy

---

## What this phase delivers

**Approve & Deploy** is real: CloudFormation creates or updates a stack in your AWS account. Templates are stored in **S3**; CFN runs under a dedicated **DeploymentRole** (S3 allowlist for demo safety). Events stream to the UI as **`deploy_event`**; terminal state and outputs land in **DynamoDB**.

---

## Architecture

```text
Approve & Deploy
  → ApprovalLambda (status: deploying)
  → DeployLambda (async invoke)
       → Upload template to S3
       → CreateChangeSet + ExecuteChangeSet (RoleARN = DeploymentRole)
       → Poll DescribeStackEvents
       → deploy_event → WebSocket
       → DynamoDB: deployed | deploy_failed + outputs
```

Full diagram: [architecture.md](../architecture.md)

---

## Key components

| Component | Location |
|-----------|----------|
| Deploy handler | `infra/lambda/deploy/index.ts` |
| Shared generation schema | `infra/lambda/shared/generation.ts` |
| Approve (async deploy) | `infra/lambda/approve/index.ts` |
| Templates bucket | `infra/lib/infra-stack.ts` — `TemplatesBucket` |
| Deployment role | `infra/lib/infra-stack.ts` — `DeploymentRole` (S3 actions) |
| Deploy events | `infra/lambda/shared/pipelineStream.ts` — `emitDeployEvent` |
| Deploy log UI | `frontend/src/components/DeployLogPanel.tsx` |
| Outputs UI | `frontend/src/components/DeploymentOutputsPanel.tsx` |
| Re-run | `frontend/src/app/page.tsx` — new generation + new stack |

---

## Status machine (full product)

```text
generating → awaiting_approval → deploying → deployed
                               → cancelled           → deploy_failed
           → failed
```

- **Retry:** From `deploy_failed`, approve again or use UI **Retry deploy**.
- **Re-run:** New `generationId` → new stack name `apex-gen-<8 chars>`.

---

## Safety model

| Guard | Detail |
|-------|--------|
| Manual approval | Nothing deploys until user clicks Approve |
| Service role separation | CFN assumes `DeploymentRole`, not DeployLambda’s role |
| `iam:PassRole` | Scoped to `DeploymentRole` ARN only |
| Stack name prefix | `apex-gen-*` |
| Resource allowlist | **S3-first** — templates with IAM/other resources may fail deploy by design |
| Sandbox | Still runs before approval — invalid CDK caught early |

**Review note (IMPORTANT-2):** DeploymentRole S3 policy uses `Resource: '*'` for bucket-level actions — acceptable for demo; tighten to `apex-*` prefix for production hardening.

---

## CloudFormation stack naming

```text
apex-gen-<first-8-chars-of-generationId>
```

Example: generationId `a1b2c3d4-e5f6-...` → stack `apex-gen-a1b2c3d4`

---

## WebSocket: `deploy_event`

Same socket as Phase 3. Example shape:

```json
{
  "type": "deploy_event",
  "conversationId": "...",
  "generationId": "...",
  "timestamp": "...",
  "resourceType": "AWS::S3::Bucket",
  "logicalResourceId": "...",
  "resourceStatus": "CREATE_COMPLETE",
  "resourceStatusReason": "..."
}
```

---

## Cognito (deferred)

PRD Days 25–26 — **not enabled**. APIs use open Function URL / API Gateway. Set `ENABLE_COGNITO` when implemented.

---

## How to verify Phase 4

Follow [VERIFICATION.md](../VERIFICATION.md) **in full**, especially:

1. Section 4.2 — Approve & Deploy → **deployed**
2. Section 5 — DynamoDB `deployed` + CFN `CREATE_COMPLETE`
3. Section 8 — teardown when done

**Recommended demo prompt:** `Create a private encrypted S3 bucket`

**Script for recording:** [DEMO.md](../DEMO.md)

---

## Tests

```bash
cd infra && npm test
# deploy.test.ts, deploy-infra.test.ts, approval.test.ts (deploy paths)
```

Review recorded **7 suites / 17 tests** passing at sign-off.

---

## Ship checklist (Days 27–28)

| Item | Doc |
|------|-----|
| README | [README.md](../../README.md) |
| Architecture | [architecture.md](../architecture.md) |
| Demo video script | [DEMO.md](../DEMO.md) |
| Verification | [VERIFICATION.md](../VERIFICATION.md) |
| Phase review | [phase-reviews/phase-01-review.md](../phase-reviews/phase-01-review.md) |

---

## After Phase 4

Optional next work:

- Fix deploy UI state when switching history items (review IMPORTANT-1)
- Tighten DeploymentRole S3 resources (IMPORTANT-2)
- Cognito auth
- Expand DeploymentRole beyond S3 (ECS, Lambda, etc.) with care
- Rate limiting (PRD Day 20–21)
