# Phase 4 Plan — Real Deployment & Ship It (Week 4)

> Scope: **Phase 4 only** — maps to Week 4 of the PRD ([context.md](../../context.md) §7): *Real deployment + ship it*.
> Delivers PRD features **F4 (live deployment logs)** and **F5 (deployment history & re-run)** completion, plus real CloudFormation deploy on approval.
>
> Phases 1–3 (F1 generate, F2 sandbox validation, F3 diff/cost/security preview, WebSocket streaming, history) are already implemented. This plan builds **only** the remaining Week 4 work.

---

## 1. Current repository state

### What already works (Phases 1–3)

| Capability | Location | Status |
|-----------|----------|--------|
| NL → CDK generation (Claude + retry) | `infra/lambda/shared/prompt.ts` | Done |
| API key via Secrets Manager (cached) | `infra/lambda/shared/anthropicApiKey.ts` | Done |
| Sandbox `cdk synth` (isolated, zero-perm) | `infra/lambda/sandbox/index.ts`, `infra/lib/sandbox-stack.ts` | Done |
| Changeset diff / cost / security | `packages/changeset/src/*` | Done |
| Orchestration pipeline (generate→validate→analyze→await approval) | `infra/lambda/orchestrate/index.ts` | Done |
| Approve / cancel state machine | `infra/lambda/approve/index.ts` | Done |
| DynamoDB generations table | `infra/lib/infra-stack.ts:24-35` | Done |
| WebSocket API + connect/disconnect | `infra/lib/infra-stack.ts:37-79`, `infra/lambda/ws-connect|ws-disconnect` | Done (uncommitted) |
| Live pipeline step streaming | `infra/lambda/shared/pipelineStream.ts` | Done (uncommitted) |
| History query API | `infra/lambda/history/index.ts` | Done (uncommitted) |
| Frontend: chat, diff/cost/security panels, approval bar, pipeline steps, history sidebar | `frontend/src/app/page.tsx`, `frontend/src/components/*`, `frontend/src/hooks/usePipelineWebSocket.ts` | Done (partly uncommitted) |

### Current generation status machine

```
generating → awaiting_approval → approved   (terminal today)
                               → cancelled
           → failed
```

`approved` is currently **terminal** — the approve Lambda only flips DynamoDB status; **nothing deploys**. (Confirmed in `progress.md` "Known limitations": *"Approve saves state only; actual deploy is Week 4"*.)

### Uncommitted working tree (git status at plan time)

```
 M frontend/src/app/page.tsx
 M infra/lambda/orchestrate/index.ts
 M infra/lib/infra-stack.ts
 M infra/package.json / package-lock.json
 M infra/test/orchestration.test.ts
 M progress.md
?? frontend/src/components/PipelineSteps.tsx
?? frontend/src/hooks/usePipelineWebSocket.ts
?? frontend/src/lib/conversation.ts
?? frontend/src/lib/diff.ts
?? infra/lambda/history/index.ts
?? infra/lambda/shared/pipelineStream.ts
?? infra/lambda/ws-connect/index.ts
?? infra/lambda/ws-disconnect/index.ts
?? infra/test/history.test.ts
```

**Pre-req before Phase 4:** commit the Phase 3 working tree so Phase 4 diffs are reviewable in isolation.

### Region / account

- Region hardcoded `ap-south-1` (`infra/bin/infra.ts`).
- Two stacks: `SandboxStack` (deployed first) → `InfraStack` (consumes `sandboxFn`).

---

## 2. What Phase 4 delivers

From PRD Week 4:

| Day | Goal | In this plan |
|-----|------|--------------|
| 22–24 | **CloudFormation deploy** — deploy step, CreateChangeSet + ExecuteChangeSet, stream CF events via WebSocket, test with real S3 bucket, automatic rollback on failure | **Core — required** |
| 25–26 | Auth upgrade — Cognito user pool, JWT replaces API-key | **Optional / stretch — documented, gated behind a flag, not on the critical path** |
| 27–28 | Ship it — full CDK deploy, README + architecture diagram + demo, clean git history | **Docs + release checklist** |

**Non-goals (explicitly out of scope for Phase 4):** cross-account/region deploys, Slack bot, GitHub Actions, cost-anomaly detection, prompt caching (all PRD §10 post-launch stretch).

### Target status machine (after Phase 4)

```
generating → awaiting_approval → approved → deploying → deployed        (terminal, success)
                               → cancelled              → deploy_failed  (terminal, rolled back)
           → failed
```

---

## 3. Architecture decisions

1. **Deploy is asynchronous.** CloudFormation change-set create+execute for even a single S3 bucket exceeds the API Gateway 29s limit and can run minutes. The approve Lambda must return fast. Therefore approve **async-invokes** a new `DeployLambda` (`InvocationType: 'Event'`) and returns immediately with status `deploying`.
2. **DeployLambda owns the CF lifecycle**: upload template to S3 → `CreateChangeSet` → `DescribeChangeSet` (wait `CREATE_COMPLETE`) → `ExecuteChangeSet` → poll `DescribeStackEvents` until terminal → write final status + outputs to DynamoDB → stream every new stack event over the existing WebSocket.
3. **CloudFormation deploys under a dedicated, least-privilege service role** (`DeploymentRole`), *not* the Lambda's own role. CF assumes this role via the `RoleARN` param on `CreateChangeSet`. For a safe demo the role is **allowlisted to S3 + a small resource set** (see §8 Risks). This is the single most important safety control in Phase 4 because the template is LLM-generated.
4. **Automatic rollback**: change sets created with default behavior roll back on failure. DeployLambda also handles the `ROLLBACK_COMPLETE`/`REVIEW_IN_PROGRESS` states explicitly (delete + recreate) so re-deploys of the same stack name don't wedge.
5. **Streaming reuses `pipelineStream.ts`** with a new `deploy_event` message type — no new WebSocket infra. The `connectionId` flows frontend → approve → DeployLambda payload.
6. **Templates persisted to S3** (`TemplatesBucket`) satisfies the PRD "CloudFormation templates stored in S3" architecture item that is currently unmet.
7. **Shared generation schema**: the `StoredGenerationSchema` (currently duplicated in `orchestrate` and `approve`) is extracted to `infra/lambda/shared/generation.ts` so the new statuses and deployment fields are defined once and reused by orchestrate/approve/deploy. This avoids Zod enum-parse failures when one Lambda reads a record another Lambda wrote (e.g. follow-up refinement of a `deployed` generation).
8. **Cognito is feature-flagged.** It is genuinely optional in the PRD ("optional", "stretch"). It ships behind a `ENABLE_COGNITO` CDK context flag defaulting to `false` so the core deploy path is not blocked by auth work.

---

## 4. Exact files to CREATE

### Backend / infra

| File | Purpose |
|------|---------|
| `infra/lambda/shared/generation.ts` | Single source of truth: `GenerationStatus` enum (incl. `deploying`/`deployed`/`deploy_failed`), `StoredGenerationSchema` (incl. deployment fields), helper `getGeneration`/`putGeneration`. |
| `infra/lambda/deploy/index.ts` | `DeployLambda` — CF change-set create/execute, event polling, WebSocket streaming, DynamoDB status writes, rollback handling. Exposes `createDeployHandler(deps)` factory for tests. |
| `infra/lambda/shared/deployStream.ts` | `deploy_event` message type + `emitDeployEvent()` (thin extension of `pipelineStream` pattern; may live inside `pipelineStream.ts` instead — see §5). |
| `infra/test/deploy.test.ts` | Unit tests for DeployLambda with mocked CFN + DynamoDB + streamer. |
| `infra/test/deploy-infra.test.ts` | CDK assertions: `TemplatesBucket` exists, `DeploymentRole` exists, DeployLambda has correct env + IAM, approve Lambda can invoke deploy. |

### Frontend

| File | Purpose |
|------|---------|
| `frontend/src/components/DeployLogPanel.tsx` | Live CloudFormation event terminal (xterm.js) rendering streamed `deploy_event`s. |
| `frontend/src/components/DeploymentOutputsPanel.tsx` | Renders CF stack outputs + stack name/ARN + link to CloudFormation console after `deployed`. |
| `frontend/src/lib/deploy.ts` | Client helpers: map deploy events → log lines, derive deploy status, build console URL. |

### Docs / release (Day 27–28)

| File | Purpose |
|------|---------|
| `docs/architecture.md` | Architecture diagram (mermaid) + data-flow, updated for the deploy path. |
| `README.md` (rewrite; currently a 6-byte stub) | Setup, deploy, demo GIF, feature list. |
| `docs/DEMO.md` | 90-second demo script + recording steps. |

### Optional (Day 25–26, only if `ENABLE_COGNITO=true`)

| File | Purpose |
|------|---------|
| `infra/lib/auth-stack.ts` (or a construct in `infra-stack.ts`) | Cognito user pool + hosted UI + app client. |
| `frontend/src/lib/auth.ts` | Amplify/Cognito JWT helper; attach `Authorization` header to API calls. |

---

## 5. Exact files to MODIFY

| File | Change |
|------|--------|
| `infra/lib/infra-stack.ts` | Add `TemplatesBucket` (S3, encrypted, block public, `RemovalPolicy.DESTROY` + `autoDeleteObjects`). Add `DeploymentRole` (CF service role, scoped). Add `DeployLambda` (`NodejsFunction`, 600–900s timeout, env: `GENERATIONS_TABLE_NAME`, `TEMPLATES_BUCKET_NAME`, `WEBSOCKET_MANAGEMENT_ENDPOINT`, `DEPLOYMENT_ROLE_ARN`, `AWS_ACCOUNT_ID`). Grant DeployLambda: DynamoDB RW, bucket RW, `webSocketApi.grantManageConnections`, CFN change-set/stack/events actions, `iam:PassRole` on `DeploymentRole`. Add env `DEPLOY_FUNCTION_NAME` to approve Lambda and `deployFn.grantInvoke(approvalLambda)`. New `CfnOutput`s: `TemplatesBucketName`, `DeployLambdaName`, `DeploymentRoleArn`. |
| `infra/lambda/approve/index.ts` | Import shared schema. Accept optional `connectionId` in request. On `approve`: set status `deploying` (not `approved` terminal), persist, then async-invoke `DeployLambda` with `{ conversationId, generationId, connectionId }`; return `{ status: 'deploying' }`. `cancel` unchanged. Guard: only `awaiting_approval` may be approved. Add `LambdaClient` dep (injectable). |
| `infra/lambda/orchestrate/index.ts` | Replace local `GenerationStatusSchema`/`StoredGenerationSchema` with imports from `shared/generation.ts` (adds new statuses so follow-up reads of deployed records parse cleanly). No behavioral change to the happy path. |
| `infra/lambda/shared/pipelineStream.ts` | Add `DeployEventMessage` type (`type: 'deploy_event'`) and an `emitDeployEvent` (or generalize `emitStep` to accept a union). Keep 410-gone handling. |
| `infra/lambda/history/index.ts` | No schema change needed (uses raw `unmarshall`); optionally include deployment fields in the returned shape (already passthrough). Verify sort still by `createdAt`. |
| `infra/test/orchestration.test.ts` | Update env/imports if schema moves; assert unchanged happy-path shape. |
| `infra/test/approval.test.ts` | Add: approve now triggers deploy invoke + sets `deploying`; assert `LambdaClient.send(InvokeCommand)` called with `Event`. Cancel path unchanged. |
| `infra/test/orchestration-infra.test.ts` | Extend or leave to `deploy-infra.test.ts` for new resources. |
| `frontend/src/lib/types.ts` | Extend `GenerationStatus` with `'deploying' \| 'deployed' \| 'deploy_failed'`. Add optional `deployment` fields to `GenerationItem`/`OrchestrationResponse` (`stackName`, `stackId`, `deploymentOutputs`, `deployEvents?`). |
| `frontend/src/hooks/usePipelineWebSocket.ts` | Handle `deploy_event` messages → new `deployEvents` + `deployStatus` state; expose from hook. |
| `frontend/src/components/ApprovalBar.tsx` | Render `deploying` (spinner, disabled), `deployed` (success + outputs), `deploy_failed` (error + retry). |
| `frontend/src/app/page.tsx` | Pass `connectionId` to approve. Render `DeployLogPanel` + `DeploymentOutputsPanel`. Handle new statuses in chat + sidebar labels. After approve, keep listening on WS and refresh via `loadHistory` on terminal deploy status. Add **Re-run** button (F5): resubmits `activeItem.prompt` as a new generation. Map deployment fields in `mapHistoryRecord`. |
| `frontend/package.json` | Add `xterm` (+ `@xterm/addon-fit`) dependency. |
| `frontend/.env.example` | Already has `NEXT_PUBLIC_WEBSOCKET_URL`; add comment that deploy events arrive on the same socket. |
| `progress.md` | Update to Week 4 status + verification steps. |
| `CODE_GUIDE.md` | Add "Deploy pipeline" section referencing new files. |

---

## 6. Interfaces & contracts

### 6.1 Approve request/response (modified)

Request (`POST /approve`):
```jsonc
{ "conversationId": "…", "generationId": "…", "action": "approve" | "cancel", "connectionId": "…?" }
```
Response (approve):
```jsonc
{ "conversationId": "…", "generationId": "…", "status": "deploying", "item": { … } }
```
- 404 if not found; 409 if not `awaiting_approval`; 400 on bad input (unchanged codes).

### 6.2 DeployLambda invoke payload (internal, async `Event`)

```ts
interface DeployInvocation {
  conversationId: string;
  generationId: string;
  connectionId?: string; // for WebSocket streaming
}
```
Reads the generation, requires `status === 'deploying'` (idempotency guard), aborts otherwise.

### 6.3 `deploy_event` WebSocket message (new)

```ts
interface DeployEventMessage {
  type: 'deploy_event';
  conversationId: string;
  generationId: string;
  phase: 'preparing' | 'change_set' | 'executing' | 'polling' | 'complete' | 'failed' | 'rolling_back';
  status: GenerationStatus;               // deploying | deployed | deploy_failed
  resourceStatus?: string;                // e.g. CREATE_COMPLETE
  logicalId?: string;
  resourceType?: string;                  // e.g. AWS::S3::Bucket
  message?: string;                       // human-readable line
  timestamp: string;                      // ISO
}
```
- Client appends `message`/derived line to the deploy log; on `phase: 'complete'|'failed'` it flips terminal UI.
- Terminal event also carries `outputs?: Record<string,string>` and `stackName`.

### 6.4 Shared generation record (`shared/generation.ts`)

```ts
export const GenerationStatusSchema = z.enum([
  'generating','awaiting_approval','approved',
  'deploying','deployed','deploy_failed',
  'cancelled','failed',
]);

export const StoredGenerationSchema = z.object({
  conversationId: z.string(),
  generationId: z.string(),
  originalRequest: z.string(),
  generatedCdkCode: z.string().optional(),
  generatedExplanation: z.string().optional(),
  cloudFormationTemplate: z.unknown().optional(),
  changeset: z.unknown().optional(),
  costEstimate: z.unknown().optional(),
  securityFlags: z.unknown().optional(),
  status: GenerationStatusSchema,
  error: z.string().optional(),
  // Phase 4 deployment fields (all optional, additive):
  deploymentStackName: z.string().optional(),
  deploymentStackId: z.string().optional(),
  deploymentOutputs: z.record(z.string(), z.string()).optional(),
  deploymentError: z.string().optional(),
  templateS3Key: z.string().optional(),
  deployStartedAt: z.string().optional(),
  deployFinishedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
```
Backward compatible: all new fields optional; Zod strips unknown keys, existing records still parse. `approved` retained for backward compatibility even though the new flow skips straight to `deploying`.

### 6.5 Stack naming

Deterministic, collision-safe, DNS/CFN-safe:
```
apex-gen-<generationId-first-8>   // e.g. apex-gen-3f9a1c2b
```
Stored as `deploymentStackName`. Re-run creates a *new* generationId → new stack (no clobber). Redeploying the same generation targets the same stack (update semantics).

---

## 7. Database changes

- **DynamoDB `GenerationsTable`**: no key/index change (schemaless). New **optional attributes** written by DeployLambda: `deploymentStackName`, `deploymentStackId`, `deploymentOutputs`, `deploymentError`, `templateS3Key`, `deployStartedAt`, `deployFinishedAt`; `status` gains three new values. No migration required.
- **New S3 `TemplatesBucket`** (storage, not DB): stores `templates/<generationId>.template.json` (and optionally CDK synth artifacts). Encrypted (S3-managed), public access blocked, `RemovalPolicy.DESTROY` + `autoDeleteObjects: true` for easy teardown during dev.

---

## 8. Backend changes (detail)

### DeployLambda algorithm (`infra/lambda/deploy/index.ts`)

1. Parse `{conversationId, generationId, connectionId}`; load record; assert `status === 'deploying'` and `cloudFormationTemplate` present (else emit `deploy_failed`, write error, return).
2. Emit `deploy_event {phase:'preparing'}`. Put template JSON to `s3://TemplatesBucket/templates/<generationId>.template.json`; store `templateS3Key`.
3. Compute `stackName`. `DescribeStacks` to detect existing/`ROLLBACK_COMPLETE`/`REVIEW_IN_PROGRESS`; if in unrecoverable state, `DeleteStack` + wait.
4. `CreateChangeSet` (`ChangeSetType: CREATE|UPDATE`, `TemplateURL` = S3 URL, `RoleARN = DEPLOYMENT_ROLE_ARN`, `Capabilities: [CAPABILITY_IAM, CAPABILITY_NAMED_IAM]`). Emit `phase:'change_set'`.
5. Poll `DescribeChangeSet` → wait `CREATE_COMPLETE`. If "no changes", short-circuit to `deployed` with existing outputs.
6. `ExecuteChangeSet`. Emit `phase:'executing'`.
7. Poll `DescribeStackEvents` loop (interval ~3–5s, budget < Lambda timeout). Stream each **new** event as `deploy_event {phase:'polling', resourceStatus, logicalId, resourceType, message}`. De-dupe by event `EventId`.
8. On stack terminal state:
   - `CREATE_COMPLETE`/`UPDATE_COMPLETE` → read `Outputs`, write `status:'deployed'`, `deploymentStackId`, `deploymentOutputs`, `deployFinishedAt`; emit `phase:'complete'`.
   - `ROLLBACK_COMPLETE`/`*_FAILED`/`UPDATE_ROLLBACK_COMPLETE` → write `status:'deploy_failed'`, `deploymentError` (first `*_FAILED` reason); emit `phase:'failed'` (with a `rolling_back` event beforehand). CloudFormation performs the rollback automatically; Lambda records it.
9. All CFN calls wrapped; any thrown error → `status:'deploy_failed'` + `deployment_failed` event (never leave a record stuck in `deploying`).

### Approve changes

- Adds `LambdaClient` (injectable), `DEPLOY_FUNCTION_NAME` env.
- `approve` path: transition `awaiting_approval → deploying`, persist, `Invoke(Event) DeployLambda`, return `deploying`. If the async invoke *call* fails, revert to `awaiting_approval` and return 502 so the UI can retry.

### IAM (least privilege)

- **DeployLambda role**: `dynamodb:*Item/Query` on table; `s3:PutObject/GetObject` on `TemplatesBucket/*`; `execute-api:ManageConnections` on the WS stage; `cloudformation:CreateChangeSet, DescribeChangeSet, ExecuteChangeSet, DescribeStacks, DescribeStackEvents, DeleteStack` on `arn:aws:cloudformation:ap-south-1:<acct>:stack/apex-gen-*/*`; `iam:PassRole` on `DeploymentRole` only.
- **DeploymentRole** (assumed by CloudFormation): allowlisted service actions for the demo-supported resource set — start with **S3 only** (`s3:CreateBucket, PutBucket*, DeleteBucket, PutEncryptionConfiguration, PutBucketPublicAccessBlock, …`), expand deliberately. Trust policy: `cloudformation.amazonaws.com`. This is the guardrail against the LLM emitting dangerous/expensive resources.

---

## 9. Frontend changes (detail)

- **Deps**: add `xterm` + `@xterm/addon-fit`. (Note: `frontend/AGENTS.md` warns this Next.js build differs from training data — consult `node_modules/next/dist/docs/` before adding client-only libs; xterm must be dynamically imported / gated to client, this component is already `'use client'`.)
- **`usePipelineWebSocket`**: extend `onmessage` to branch on `deploy_event`; keep `steps` for pipeline, add `deployEvents: DeployEventMessage[]` and `deployStatus`. Expose `resetDeploy()`.
- **`DeployLogPanel`**: xterm terminal; write each `deploy_event.message` (colored by `resourceStatus`: green COMPLETE, red FAILED/ROLLBACK, amber IN_PROGRESS). Auto-fit + auto-scroll. Renders only when `status ∈ {deploying, deployed, deploy_failed}`.
- **`DeploymentOutputsPanel`**: table of `deploymentOutputs`, stack name, and a CloudFormation console deep link `https://ap-south-1.console.aws.amazon.com/cloudformation/home?region=ap-south-1#/stacks/stackinfo?stackId=<id>`.
- **`ApprovalBar`**: state-aware (`awaiting_approval` → Approve/Cancel; `deploying` → disabled spinner "Deploying…"; `deployed` → success; `deploy_failed` → error + "Retry deploy"). "Retry deploy" re-POSTs approve for a fresh attempt (guarded).
- **`page.tsx`**: send `connectionId` in `submitApproval`; render new panels in the right column; extend `mapHistoryRecord` with deployment fields; on terminal deploy event, `loadHistory(conversationId)` to reconcile; add **Re-run** button that calls `handleGenerate` with `activeItem.prompt` (F5). Update sidebar status label formatting for new statuses.

---

## 10. Infrastructure changes (summary)

| Resource | New/changed | Notes |
|----------|-------------|-------|
| `TemplatesBucket` (S3) | new | encrypted, block public, autoDelete |
| `DeploymentRole` (IAM role) | new | CF service role, S3-allowlisted |
| `DeployLambda` (NodejsFunction) | new | 600–900s timeout, 512MB, env + IAM above |
| `ApprovalLambda` | changed | +`DEPLOY_FUNCTION_NAME` env, +invoke grant |
| `OrchestrationLambda` | unchanged infra | code-only (shared schema) |
| CfnOutputs | new | `TemplatesBucketName`, `DeployLambdaName`, `DeploymentRoleArn` |
| Cognito (optional) | new, flagged | only if `ENABLE_COGNITO=true` |

No change to `SandboxStack`. WebSocket API/stage reused as-is.

---

## 11. Implementation order

1. **Commit Phase 3 working tree** (baseline).
2. `infra/lambda/shared/generation.ts` — shared schema/statuses; refactor `orchestrate` + `approve` imports; run infra tests (green, no behavior change).
3. `infra/lambda/shared/pipelineStream.ts` — add `deploy_event` type + emitter.
4. `infra/lambda/deploy/index.ts` — DeployLambda with injectable factory; write `infra/test/deploy.test.ts` (mock CFN/S3/DDB/stream). TDD here.
5. `infra/lambda/approve/index.ts` — deploy invoke + `deploying`; update `infra/test/approval.test.ts`.
6. `infra/lib/infra-stack.ts` — TemplatesBucket, DeploymentRole, DeployLambda, grants, outputs; `infra/test/deploy-infra.test.ts`.
7. `cdk synth` + `cdk diff`; deploy to `ap-south-1`; smoke-test deploy of an S3 bucket generation end-to-end via curl.
8. Frontend: types → hook → `DeployLogPanel`/`DeploymentOutputsPanel`/`deploy.ts` → `ApprovalBar` → `page.tsx`; add xterm dep; `npm run build`.
9. End-to-end UI test (generate → approve → live logs → deployed → outputs → re-run).
10. Rollback test (force a failing template).
11. **(Optional)** Day 25–26 Cognito behind `ENABLE_COGNITO`.
12. Day 27–28: `README.md`, `docs/architecture.md`, `docs/DEMO.md`, `progress.md`, `CODE_GUIDE.md`; final `cdk deploy`; demo recording; clean commits.

Backend (steps 2–7) is independently shippable and testable before any frontend work.

---

## 12. Testing commands

```bash
# Unit tests — infra (orchestration, approval, deploy, CDK assertions)
cd infra && npm run build && npm test

# Unit tests — changeset (unchanged, regression check)
cd packages/changeset && npm run build && npm test

# CDK validation
cd infra && npx cdk synth && npx cdk diff

# Frontend build + lint
cd frontend && npm install && npm run build && npm run lint

# Full deploy (from repo root)
./scripts/build-sandbox-layer.sh
cd infra && npm run deploy   # deploys SandboxStack + InfraStack
```

### Manual end-to-end (post-deploy)

```bash
# 1) Generate (orchestration Function URL)
curl -s -X POST "$ORCHESTRATION_URL" -H 'Content-Type: application/json' \
  -d '{"message":"Create a private encrypted S3 bucket","conversationId":"'"$CID"'"}' | jq .

# 2) Approve → triggers real deploy (status becomes "deploying")
curl -s -X POST "$API_URL/approve" -H 'Content-Type: application/json' \
  -d '{"conversationId":"'"$CID"'","generationId":"'"$GID"'","action":"approve"}' | jq .

# 3) Watch status flip to "deployed"
aws dynamodb get-item --table-name "$GEN_TABLE" \
  --key '{"conversationId":{"S":"'"$CID"'"},"generationId":{"S":"'"$GID"'"}}' \
  --region ap-south-1 | jq '.Item.status, .Item.deploymentStackName, .Item.deploymentOutputs'

# 4) Confirm the real stack + resource exist
aws cloudformation describe-stacks --stack-name "apex-gen-${GID:0:8}" --region ap-south-1 | jq '.Stacks[0].StackStatus'

# 5) Teardown deployed demo stack
aws cloudformation delete-stack --stack-name "apex-gen-${GID:0:8}" --region ap-south-1
```

---

## 13. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| LLM template creates dangerous/expensive real resources | High | High | **Scoped `DeploymentRole` allowlist (S3-first)**; security scan already gates high-severity flags before approval; manual approval required; billing alerts. |
| Deploy exceeds Lambda 15-min max | Medium | Medium | Demo scope = fast resources (S3); event-poll budget guard; if timeout, record `deploy_failed` with "timed out — check console"; (future: Step Functions for long deploys). |
| Stack stuck in `ROLLBACK_COMPLETE`/`REVIEW_IN_PROGRESS` blocks re-deploy | Medium | Medium | Detect + `DeleteStack` + wait before recreate. |
| WebSocket drops during long deploy → UI loses live logs | Medium | Low | DynamoDB status is source of truth; UI reconciles via `loadHistory` on reconnect/terminal; events de-duped by `EventId`. |
| `iam:PassRole` misconfiguration → deploy can't assume role | Medium | Medium | `deploy-infra.test.ts` asserts PassRole scoped to `DeploymentRole` ARN; synth-time check. |
| Concurrent approvals of same generation → double deploy | Low | Medium | Idempotency: approve only from `awaiting_approval`; DeployLambda re-checks `deploying`. |
| Real AWS cost during dev/testing | Medium | Low | `autoDeleteObjects` + `RemovalPolicy.DESTROY`; documented `delete-stack`; test with S3 only. |
| xterm.js SSR/Next.js build issues | Medium | Low | Client-only component (`'use client'`), dynamic import; consult `node_modules/next/dist/docs/` per `frontend/AGENTS.md`. |
| Cognito scope creep blocks core deploy | Medium | Medium | Feature-flagged (`ENABLE_COGNITO=false` default); off the critical path; ship deploy first. |
| Schema drift between Lambdas | Low | Medium | Single `shared/generation.ts`; all statuses additive/optional. |

---

## 14. Acceptance criteria

**Core (required):**
1. Approving a generation transitions it `awaiting_approval → deploying → deployed` and creates a **real CloudFormation stack** in `ap-south-1`.
2. The generated CloudFormation template is uploaded to `TemplatesBucket` and referenced by `templateS3Key`.
3. CloudFormation runs under `DeploymentRole` (not the Lambda role); DeployLambda has `iam:PassRole` on that role only.
4. Stack events stream live to the UI via WebSocket (`deploy_event`) and render in `DeployLogPanel`.
5. On success, `deploymentOutputs` + `deploymentStackId` are persisted and shown in `DeploymentOutputsPanel`.
6. On a failing template, CloudFormation rolls back automatically and the record ends in `deploy_failed` with `deploymentError`; no record is ever left stuck in `deploying`.
7. F5: a past generation can be **re-run** with one click (creates a new generation/stack).
8. All existing Phase 1–3 tests still pass; new `deploy.test.ts`, `deploy-infra.test.ts`, updated `approval.test.ts` pass.
9. `cdk synth`/`cdk diff` succeed; `npm run deploy` succeeds.
10. No high-severity security regression; IAM remains least-privilege.

**Ship (Day 27–28):**
11. `README.md` with setup + architecture + demo; `docs/architecture.md` diagram reflects deploy path; `progress.md` updated to Week 4.

**Optional (Day 25–26):**
12. With `ENABLE_COGNITO=true`, a Cognito-authenticated user can complete the flow with JWT-authenticated API calls. (Not required for Phase 4 sign-off.)

---

## 15. Verification checklist

- [ ] Phase 3 working tree committed as baseline.
- [ ] `shared/generation.ts` created; `orchestrate` + `approve` import it; infra tests green.
- [ ] `deploy_event` type added to `pipelineStream.ts`.
- [ ] `DeployLambda` implemented; `deploy.test.ts` covers success, no-change, and rollback paths.
- [ ] `approve` async-invokes deploy and returns `deploying`; `approval.test.ts` updated.
- [ ] `TemplatesBucket`, `DeploymentRole`, `DeployLambda` in `infra-stack.ts`; grants + outputs added.
- [ ] `deploy-infra.test.ts` asserts new resources, env vars, scoped `iam:PassRole`.
- [ ] `cd infra && npm run build && npm test` → all pass.
- [ ] `cd packages/changeset && npm test` → all pass.
- [ ] `npx cdk synth && npx cdk diff` → clean.
- [ ] `npm run deploy` → SandboxStack + InfraStack updated; new CfnOutputs printed.
- [ ] Frontend: xterm dep added; `DeployLogPanel`, `DeploymentOutputsPanel`, `deploy.ts` created; hook + `ApprovalBar` + `page.tsx` updated.
- [ ] `cd frontend && npm run build && npm run lint` → clean.
- [ ] `.env.local` updated with `NEXT_PUBLIC_WEBSOCKET_URL` from `WebSocketUrl` output.
- [ ] Manual E2E: generate S3 bucket → approve → live logs → `deployed` → outputs shown → stack visible in CloudFormation console.
- [ ] Rollback E2E: failing template → `deploy_failed` + rollback observed, record not stuck.
- [ ] Re-run (F5) creates a new generation + stack.
- [ ] Teardown: `delete-stack` for demo stacks; `cdk destroy` clean.
- [ ] Docs: `README.md`, `docs/architecture.md`, `docs/DEMO.md`, `progress.md`, `CODE_GUIDE.md` updated.
- [ ] (Optional) Cognito behind `ENABLE_COGNITO` verified or explicitly deferred.
- [ ] Clean, reviewable git history for Phase 4.
```
