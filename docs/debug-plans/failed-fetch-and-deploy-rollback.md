# Debug Plan — "Generation Failed: Failed to fetch" + "Deployment failed and rolled back"

> **For:** the next agent. This is a **plan** grounded in live AWS evidence from 2026-07-29.
> **Screenshot symptoms:** toast `Generation Failed` / `Failed to fetch`, and banner `Deployment failed and rolled back` with **Retry deploy**, while `generated-stack.ts` still shows.
> **Related:** [kms-deployment-role-access-denied.md](./kms-deployment-role-access-denied.md) (root cause of the deploy rollback — code fixed, **not deployed**).

---

## 0. Verdict (read this first)

There are **two separate failures** on screen. Do not treat them as one bug.

| UI signal | Real meaning | Status |
|-----------|--------------|--------|
| **Deployment failed and rolled back** | CloudFormation rolled back under `DeploymentRole` — almost certainly `kms:CreateKey` AccessDenied on the KMS S3 example | **Code fixed in repo; live AWS still broken** |
| **Generation Failed / Failed to fetch** | Browser `TypeError: Failed to fetch` from `fetch()` — network / aborted / non-CORS error response. Toast title is misleading (always says "Generation Failed") | **Endpoint healthy now; likely transient or Retry-deploy path** |

**The deploy rollback is the durable product bug.** Fixing it requires **redeploying `InfraStack`**, not more local code changes for KMS/IAM (those already exist).

---

## 1. What was verified live (2026-07-29)

### Frontend env
- `frontend/.env.local` points at:
  - Orchestration Function URL: `*.lambda-url.ap-south-1.on.aws`
  - API Gateway: `8596tnvff0.execute-api.ap-south-1.amazonaws.com`
  - WebSocket: `gtfpskqrce.execute-api.ap-south-1.amazonaws.com`
- Dev server is running (`npm run dev` on `:3000`) and loading `.env.local`.

### Orchestration is reachable
- `OPTIONS` → HTTP 200 (~1.4s)
- `POST` with a trivial prompt → HTTP 200 (~27s), returns `status: "awaiting_approval"` + CDK code
- Function URL CORS: `AllowOrigins: *`, `AllowMethods: POST`, `AllowHeaders: content-type`, `BUFFERED`
- Orchestration Lambda timeout: **120s** (last modified **2026-07-20**)

### Deploy path is still the July 20 stack
- `InfraStack-DeployLambda…` last modified **2026-07-20** (timeout 900s)
- Live `DeploymentRole` inline policy actions: **S3 only** — **no `kms:*`**
- Repo already has KMS actions in `infra/lib/infra-stack.ts` and `findUnsupportedResourceTypes` in `infra/lambda/deploy/index.ts` — **these are not in AWS yet**

### Implication
Any Approve/Retry on a stack that creates `AWS::KMS::Key` will keep failing (or, once guardrail is live but before KMS IAM is live, fail-fast with a clear message). Today live behavior is still the raw CFN AccessDenied → rollback.

---

## 2. Symptom A — Deployment failed / rolled back

### Root cause (confirmed earlier; reconfirmed via live IAM)
1. User used (or used equivalent of) the built-in **Secure S3 + KMS** example.
2. Synth + diff + cost + security all succeed (sandbox does not check deploy-time IAM).
3. Approve → `DeployLambda` → CloudFormation under `DeploymentRole`.
4. Live role cannot `kms:CreateKey` → `CREATE_FAILED` → stack rollback → UI `deploy_failed`.

### Code already present (do not re-implement unless missing)
- `infra/lib/infra-stack.ts` — KMS actions on `DeploymentRole`
- `infra/lambda/shared/deployability.ts` — `SUPPORTED_RESOURCE_TYPES` includes S3 + KMS
- `infra/lambda/deploy/index.ts` — pre-deploy `findUnsupportedResourceTypes` guardrail
- Tests under `infra/test/deployability.test.ts`, `deploy.test.ts`, `deploy-infra.test.ts`

### What the agent must do (primary fix)
1. **Deploy infra** so live IAM + Lambda match the repo:
   ```bash
   ./scripts/build-sandbox-layer.sh
   cd infra && npm install && npm run build
   npx cdk deploy InfraStack --require-approval never
   # or: npm run deploy
   ```
2. **Verify live IAM** after deploy:
   ```bash
   aws iam get-role-policy \
     --role-name InfraStack-DeploymentRoleC7BBCF2C-8S1nO1sXc19H \
     --policy-name DeploymentRoleDefaultPolicyB30A6D11 \
     --query 'PolicyDocument.Statement[].Action' --output json
   ```
   Expect `kms:CreateKey` (and related) present.
3. Confirm DeployLambda `LastModified` is today, not `2026-07-20`.
4. **Manual E2E:** New generation from the KMS example card → Approve & Deploy → expect `deployed` (not rollback).
5. If still AccessDenied after deploy: dump CFN stack events for the failed stack name and re-check policy attachment (wrong role / stale change set / wrong account/region).

### Do not
- Do not rewrite the KMS debug plan from scratch — extend verification only.
- Do not widen `DeploymentRole` to unrelated services.
- Do not “fix” by only changing the UI error copy without deploying.

---

## 3. Symptom B — Toast: Generation Failed / Failed to fetch

### What the UI actually does
- `frontend/src/app/page.tsx` catch blocks set `error` to `err.message`.
- The toast **always** titles the banner **"Generation Failed"** even when the failure came from **approval / Retry deploy** (`submitApproval`).
- So a failed Retry can look identical to a failed Generate.

### Likely causes (ordered)
1. **Mislabelled toast on Retry deploy** — user clicked Retry while offline / API blip → `Failed to fetch` under “Generation Failed”. Underlying stack is still the old `deploy_failed` (Symptom A).
2. **Transient browser network** — orchestration is healthy from curl; intermittent laptop Wi‑Fi / sleep mid-request produces the same TypeError.
3. **Hard failure without CORS headers** — if Lambda/Function URL returns a gateway error body without CORS, the browser surfaces `Failed to fetch` instead of HTTP status. Less likely for success paths (CORS is configured); more likely on rare 502/timeout edge cases past 120s.
4. **Wrong env URL** — currently correct; only re-check if `.env.local` was edited or stack was recreated (Function URL changes).

### What the agent should do (secondary)
1. Reproduce:
   - Hard-refresh localhost:3000.
   - Run a short prompt (e.g. “empty CDK stack named Ping”). If this works, orchestration is fine.
   - Retry the KMS example generate. Time it; if it approaches **120s**, consider raising Orchestration timeout or streaming.
2. If toast appears on **Retry deploy**, check Network tab for `POST` to API Gateway `/approve` (or equivalent) — not orchestration.
3. UX polish (optional, small): rename toast title based on context (`Generation Failed` vs `Approval Failed` vs `Request Failed`).
4. Optional hardening: wrap `fetch` with clearer errors (`AbortError`, offline, non-OK without JSON body).

### What is NOT the primary fix
Do not spend a day chasing CORS if curl OPTIONS/POST already succeed and a short prompt works in the UI. Ship the infra deploy first; retest generate + approve after.

---

## 4. Recommended execution order for the agent

```text
1. Confirm repo has KMS IAM + deployability guardrail (already true as of main).
2. Build sandbox layer + cdk deploy InfraStack.
3. Re-verify live DeploymentRole includes kms:CreateKey.
4. Fresh UI generation (KMS example) → Approve → expect deployed.
5. Only if generate still shows Failed to fetch: DevTools Network + Orchestration CloudWatch REPORT Status.
6. Optional: fix misleading "Generation Failed" toast title for approval errors.
7. Update docs/explanations/phase-04.md pitfall if deploy verification succeeds — mark "must redeploy InfraStack" as the resolution step.
```

---

## 5. Success criteria

- [ ] Live `DeploymentRole` lists KMS actions.
- [ ] DeployLambda `LastModified` is after this deploy.
- [ ] KMS S3 example reaches `deployed` with real bucket + key in account (ap-south-1).
- [ ] Plain S3 (no CMK) still deploys (no regression).
- [ ] Short prompt generate succeeds in UI without toast.
- [ ] If toast remains intermittent only: document as transient/network; do not block on it.

---

## 6. Non-goals

- Reworking the three-column UI layout.
- Expanding deploy allowlist beyond S3 + KMS.
- Cognito / rate limiting / Vercel production cutover (separate production plan).
