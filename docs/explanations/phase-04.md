# Phase 4 — Real Deployment & Ship

> **Status:** Implemented · **PRD:** Week 4, Days 22–28 · **Features:** F4 (deploy logs), F5 (re-run), real CFN deploy  
> **Last updated:** July 21, 2026

---

## Phase Overview

### Goal of the phase

Turn **Approve & Deploy** into a real CloudFormation deployment: upload template to S3, create/execute change sets under a scoped service role, stream stack events to the UI, persist outputs in DynamoDB, and ship docs/tests.

### Problems this phase solves

- Phase 2 approval only updated status — nothing reached AWS.
- Users need live deploy feedback (not a silent background job).
- LLM templates must deploy safely under least-privilege IAM, not the DeployLambda's broad permissions.

### Expected outcome

Click **Approve & Deploy** → status `deploying` → live terminal logs → `deployed` with stack outputs and a real `apex-gen-*` stack in CloudFormation. Re-run creates a new generation/stack. Failed deploys land in `deploy_failed` with rollback.

---

## Architecture Decisions

| Decision | Why | Alternatives | Tradeoffs |
|----------|-----|--------------|-----------|
| **Async DeployLambda invoke** | CFN can run minutes; API Gateway must return quickly | Sync deploy in approve handler | Client polls DynamoDB/WebSocket for terminal state |
| **Dedicated `DeploymentRole` for CFN** | LLM templates run under allowlisted permissions (S3-first demo) | Deploy with admin credentials | Templates with ECS/Lambda may fail until role expanded |
| **`iam:PassRole` scoped to DeploymentRole only** | CFN requires a service role via `RoleARN` on change set | Use default CFN permissions | Must maintain role policy as supported resources grow |
| **Templates in S3** | CFN `TemplateURL` requires accessible object; audit trail | Inline template in API call | Bucket policy must allow CFN service read |
| **Shared `generation.ts` schema** | Same statuses/fields across orchestrate, approve, deploy | Duplicate Zod in each Lambda | Single place to add deployment fields |
| **`stripCdkBootstrap()` before deploy** | CDK synth embeds SSM bootstrap param; scoped role can't read SSM | Grant SSM on DeploymentRole | Stripping keeps role minimal; see Common Pitfalls |
| **Cognito deferred** | PRD optional; open APIs ship faster | JWT on day 1 | Abuse risk — mitigate with billing alerts |
| **Stack name `apex-gen-{first8}`** | Deterministic, unique per generation | User-provided names | Re-run = new generationId = new stack |

---

## Implementation Walkthrough

### Task 1 — Shared generation schema

**What:** Central Zod schema + DynamoDB helpers + `buildStackName()`.

**Files:** `infra/lambda/shared/generation.ts`

**Why:** Avoid parse failures when approve writes `deploying` and orchestrate reads old records; deployment fields are optional/additive.

### Task 2 — DeployLambda

**What:** Full CFN lifecycle: S3 upload → ensure stack ready → create change set → execute → poll events → update DynamoDB → emit WebSocket events.

**Files:** `infra/lambda/deploy/index.ts`

**Why:** Long-running, isolated from approve's 30s timeout; 15-minute Lambda timeout for polling.

**Flow:**

```text
Async invoke { conversationId, generationId, connectionId? }
  → assert status === deploying
  → stripCdkBootstrap(template) → PutObject S3
  → CreateChangeSet (RoleARN = DeploymentRole)
  → ExecuteChangeSet
  → loop DescribeStackEvents → deploy_event
  → status deployed | deploy_failed
```

### Task 3 — Approve handler changes

**What:** On `approve`: set `deploying`, async `InvokeCommand` DeployLambda (`Event`), return immediately. On invoke failure, revert to `awaiting_approval` with 502. Allow retry from `deploy_failed`.

**Files:** `infra/lambda/approve/index.ts`

**Env:** `DEPLOY_FUNCTION_NAME`

### Task 4 — Infra resources

**What:** `TemplatesBucket`, `DeploymentRole`, `DeployLambda`, IAM grants, bucket policy for CFN read, outputs.

**Files:** `infra/lib/infra-stack.ts`

### Task 5 — Deploy WebSocket events

**What:** `emitDeployEvent()` alongside `emitStep()` in `pipelineStream.ts`.

**Files:** `infra/lambda/shared/pipelineStream.ts`, `frontend/src/hooks/usePipelineWebSocket.ts`

### Task 6 — Frontend deploy UI

**What:** xterm deploy log, outputs panel, deploy-aware approval bar, re-run button.

**Files:**

- `frontend/src/components/DeployLogPanel.tsx`
- `frontend/src/components/DeploymentOutputsPanel.tsx`
- `frontend/src/lib/deploy.ts`
- `frontend/src/app/page.tsx` — passes `connectionId` on approve; reconciles terminal state via `loadHistory`

### Task 7 — Tests & docs

**Files:** `infra/test/deploy.test.ts`, `deploy-infra.test.ts`, updated `approval.test.ts`; `README.md`, `docs/VERIFICATION.md`, `docs/DEMO.md`

---

## Important Code

### Status machine (full product)

```text
generating → awaiting_approval → deploying → deployed
                               → cancelled           → deploy_failed
           → failed
```

### Approve → async deploy

```typescript
await putGeneration(dynamoDbClient, { ...existing, status: 'deploying' });
await lambdaClient.send(new InvokeCommand({
  FunctionName: getDeployFunctionName(),
  InvocationType: 'Event',  // fire-and-forget
  Payload: Buffer.from(JSON.stringify({ conversationId, generationId, connectionId })),
}));
return response(200, { status: 'deploying' });
```

### stripCdkBootstrap (critical for deploy success)

```typescript
// Remove Parameters whose Default starts with /cdk-bootstrap/
// Remove Rules.CheckBootstrapVersion
export const stripCdkBootstrap = (template: unknown): unknown => { ... }
```

Applied immediately before S3 upload. Without this, CFN fails with `ssm:GetParameters` AccessDenied under the S3-only DeploymentRole.

### deploy_event message (abbreviated)

```typescript
{
  type: 'deploy_event',
  phase: 'preparing' | 'change_set' | 'executing' | 'polling' | 'complete' | 'failed' | 'rolling_back',
  status: 'deploying' | 'deployed' | 'deploy_failed',
  resourceStatus?: string,  // e.g. CREATE_COMPLETE
  message?: string,
  stackName?: string,
  outputs?: Record<string, string>,
}
```

### DynamoDB deployment fields (optional)

`deploymentStackName`, `deploymentStackId`, `deploymentOutputs`, `deploymentError`, `templateS3Key`, `deployStartedAt`, `deployFinishedAt`

### Lambda env (DeployLambda)

| Variable | Purpose |
|----------|---------|
| `GENERATIONS_TABLE_NAME` | Read/write generation state |
| `TEMPLATES_BUCKET_NAME` | Upload JSON templates |
| `DEPLOYMENT_ROLE_ARN` | Passed to CFN as `RoleARN` |
| `WEBSOCKET_MANAGEMENT_ENDPOINT` | Stream deploy events |

### Infrastructure additions

- **S3** `TemplatesBucket` — encrypted, block public, auto-delete on stack destroy
- **IAM** `DeploymentRole` — assumed by `cloudformation.amazonaws.com`, S3 actions (demo scope)
- **DeployLambda** — 15 min timeout, CFN + S3 + PassRole permissions on `apex-gen-*` stacks

---

## Important Commands

| Command | What / why | When |
|---------|------------|------|
| `cd infra && npm run build && npm test` | Verify deploy + approval tests | After deploy handler changes |
| `cd infra && npx cdk deploy InfraStack` | Push DeployLambda code fix (e.g. bootstrap strip) | After `deploy/index.ts` changes |
| `aws logs tail /aws/lambda/InfraStack-DeployLambda... --since 1h` | Debug failed deploys | When UI stuck on deploying |
| `aws dynamodb get-item ... \| jq '.Item.status.S, .Item.deploymentError.S'` | Ground truth for deploy result | Faster than guessing from UI |

```bash
# Approve triggers deploy
curl -s -X POST "${API_URL%/}/approve" \
  -H 'Content-Type: application/json' \
  -d '{"conversationId":"'"$CID"'","generationId":"'"$GID"'","action":"approve"}' | jq '.status'
# → "deploying"

# Confirm stack
aws cloudformation describe-stacks --stack-name apex-gen-${GID:0:8} --region ap-south-1 \
  --query 'Stacks[0].StackStatus'
```

**Demo prompt:** `Create a private encrypted S3 bucket` (S3-only templates match DeploymentRole allowlist).

---

## Key Concepts Learned

### CloudFormation change sets

`CreateChangeSet` previews changes; `ExecuteChangeSet` applies them. Safer than direct stack updates for approval workflows.

### Service role (`RoleARN`)

CloudFormation assumes **`DeploymentRole`**, not the Lambda role. Lambda only needs `iam:PassRole` for that ARN.

### Async Lambda invocation

`InvocationType: 'Event'` returns immediately; errors in DeployLambda appear in CloudWatch, not in approve HTTP response.

### API Gateway Management API

Same as Phase 3 — deploy events use `PostToConnection` on the existing WebSocket connection.

### xterm.js in Next.js

Deploy log panel uses `@xterm/xterm` in a `'use client'` component — terminal renders CFN event lines with color by resource status.

---

## Common Pitfalls

### Deploy button "doesn't work" — SSM AccessDenied (fixed July 2026)

**Symptom:** Approve succeeds (`deploying`), then quickly `deploy_failed`. DeployLambda finishes in ~700ms (too fast for real CFN).

**Error in DynamoDB `deploymentError`:**

```text
...DeploymentRole.../AWSCloudFormation is not authorized to perform:
ssm:GetParameters on resource: .../parameter/cdk-bootstrap/hnb659fds/version
```

**Root cause:** `cdk synth` injects `BootstrapVersion` (SSM parameter type) and `CheckBootstrapVersion` rule. Scoped DeploymentRole has S3 only — CFN tries SSM lookup at deploy time.

**Fix:** `stripCdkBootstrap()` in `deploy/index.ts` before uploading template to S3. **Redeploy InfraStack** so Lambda code updates in AWS.

**Alternative:** Add `ssm:GetParameters` on `/cdk-bootstrap/*` to DeploymentRole (weakens least-privilege).

### Approve 502

**Cause:** `DEPLOY_FUNCTION_NAME` missing or invoke permission denied.

**Fix:** Redeploy CDK; verify `deployLambda.grantInvoke(approvalLambda)`.

### Stuck on `deploying`

**Cause:** DeployLambda timeout/crash without writing terminal status.

**Fix:** CloudWatch logs; check `deploymentError` in DynamoDB. Added `console.error` in deploy catch for visibility.

### `deploy_failed` on non-S3 templates

**Cause:** DeploymentRole is S3-first by design.

**Fix:** Use S3 bucket prompts for demo; expand role deliberately for other resource types.

### WebSocket shows no deploy log

**Cause:** Missing `connectionId` on approve POST, or socket offline.

**Fix:** Ensure header shows connected; approve body includes `connectionId`.

---

## Design Notes

- **Idempotency:** Approve only from `awaiting_approval` or retry from `deploy_failed`; DeployLambda re-checks `status === deploying`.
- **Rollback:** CFN automatic rollback on failure; Lambda records `deploy_failed` + first `*_FAILED` event reason.
- **No changes short-circuit:** If change set reports no changes, mark `deployed` with existing outputs.
- **Security:** Manual approval still required; sandbox still runs before approval; CFN never uses DeployLambda's credentials for resources.
- **Logging gap (addressed):** Early deploy failures only appeared in DynamoDB — added structured `console.error` for CloudWatch.

---

## Phase Summary

### Completed

- DeployLambda + TemplatesBucket + DeploymentRole
- Approve async-invokes deploy; extended status machine
- `deploy_event` WebSocket streaming
- DeployLogPanel, DeploymentOutputsPanel, re-run (F5)
- Shared `generation.ts`; unit + CDK infra tests
- Docs: README, VERIFICATION, DEMO, architecture
- **Fix:** `stripCdkBootstrap` for SSM bootstrap parameter issue

### Remaining TODOs

| Item | Notes |
|------|-------|
| Cognito auth | Deferred (`ENABLE_COGNITO`) |
| Tighten DeploymentRole S3 `Resource: '*'` | IMPORTANT-2 — use `apex-*` prefix |
| Rate limiting on API Gateway | PRD Day 20–21 |
| Vercel production deploy | See `docs/phase-plans/production-deployment-plan.md` |
| Expand DeploymentRole beyond S3 | ECS, Lambda, etc. — with care |

### Dependencies for post-Phase 4

- Production CORS lockdown if frontend hosted on Vercel
- Billing alerts on Anthropic + AWS
- Optional Step Functions if deploys exceed Lambda 15 min

### Knowledge for maintainers

- How CDK bootstrap metadata appears in synthesized templates
- CloudFormation stack states (`ROLLBACK_COMPLETE` → delete before recreate)
- Debugging async Lambda + WebSocket + DynamoDB as three sources of truth (prefer DynamoDB for terminal state)
