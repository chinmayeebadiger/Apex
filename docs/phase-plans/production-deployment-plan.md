# Production Deployment & Go-Live Plan — "Ship It" (Week 4, Days 27–28)

> Scope: **the last part** — take Apex *itself* to production. This is **not** the in-product CloudFormation deploy feature (that is built and documented in [phase-04-deploy-ship.md](../phases/phase-04-deploy-ship.md) / [phase-04-plan.md](./phase-04-plan.md)). This plan covers **deploying the Apex application to production**: hardening + `cdk deploy` the AWS backend, deploying the Next.js frontend to **Vercel** (context.md §4 — "Deployed on Vercel"), wiring prod config, smoke-testing, and shipping (README, demo, GitHub, release tag).
>
> Maps to PRD ([context.md](../../context.md) §7) **Week 4 · Day 27–28 "Ship it"**, and closes the production-hardening items in [phase-04-deploy-ship.md](../phases/phase-04-deploy-ship.md) "After Phase 4".

---

## 1. Current repository state

### Application: feature-complete (Phases 1–4)

| Area | State |
|------|-------|
| Backend (F1–F5) | Implemented; `cd infra && npm test` green (7 suites / 17 tests per VERIFICATION.md) |
| In-product deploy (CloudFormation) | Implemented — `DeployLambda`, `TemplatesBucket`, `DeploymentRole`, `deploy_event` streaming |
| Frontend | Next.js 16.2.7 / React 19 / Turbopack; xterm deploy log; runs at `localhost:3000` |
| Docs | README, VERIFICATION, architecture, DEMO, LAYERS, phase guides all present |

### What is NOT yet production-ready (this plan fixes)

| Gap | Evidence | Impact |
|-----|----------|--------|
| **Frontend never deployed to a host** | VERIFICATION.md §3 uses `npm run dev`; no `vercel.json`, no Vercel project | No public URL — PRD says Vercel |
| **CORS wide open** | `infra/lib/infra-stack.ts`: Function URLs `allowedOrigins: ['*']`; RestApi `Cors.ALL_ORIGINS` | Any origin can call prod endpoints |
| **Endpoints unauthenticated** | Function URL `authType: FunctionUrlAuthType.NONE`; API key auth not enforced | Open orchestration URL can burn Anthropic credits |
| **No API rate limiting / throttling** | No usage plan / throttle on RestApi (PRD Day 20–21, "After Phase 4") | Abuse / runaway cost |
| **DeploymentRole S3 `Resource: '*'`** | phase-04 doc review note IMPORTANT-2 | Broader than needed for prod |
| **Deploy UI stale on history switch** | phase-04 doc / phase-03 doc IMPORTANT-1 | Minor UX bug to fix before demo |
| **No log retention / alarms on prod Lambdas** | Only sandbox log group sets retention | Cost + observability gap |
| **README/docs assume localhost** | README §"Configure frontend" | Needs prod URLs + Vercel steps |
| **No release artifacts** | No git tag, no demo recording linked | "Ship it" not done |

### Region / stacks

- `ap-south-1`, hardcoded in `infra/bin/infra.ts`.
- `SandboxStack` → `InfraStack` (consumes `sandboxFn`).
- Frontend env contract: `NEXT_PUBLIC_ORCHESTRATION_URL`, `NEXT_PUBLIC_API_GATEWAY_URL`, `NEXT_PUBLIC_WEBSOCKET_URL`.

---

## 2. What this plan delivers

1. A **hardened production backend** deployed via `cdk deploy` (CORS locked, throttled, log retention, tightened DeploymentRole, optional lightweight auth).
2. The **frontend live on Vercel** with production env vars pointing at the deployed AWS outputs.
3. **End-to-end production smoke test** proving generate → approve → real deploy works from the public URL.
4. **Ship artifacts**: updated README with the live URL, recorded demo, clean git history, tagged release.

**Non-goals (explicitly out):** Cognito auth (deferred — [phase-04 §Cognito]), custom domain/Route 53 (optional stretch), GitHub Actions CI/CD (PRD §10 stretch), multi-region, expanding DeploymentRole beyond S3.

---

## 3. Architecture (production topology)

```text
 Users ── https ──► Vercel (Next.js static/SSR)
                        │  NEXT_PUBLIC_* (build-time env)
                        ▼
         ┌──────────────────────────────────────────────┐
         │ AWS ap-south-1                                 │
         │  Orchestration Function URL (CORS: Vercel)     │
         │  API Gateway REST /approve /history (throttled)│
         │  API Gateway WebSocket wss (pipeline+deploy)   │
         │  Lambdas → DynamoDB, S3, Secrets, CFN          │
         └──────────────────────────────────────────────┘
```

Key contract: the browser calls AWS **directly** (Function URL + API Gateway + WebSocket), so **CORS origin must be the Vercel domain(s)**, and env vars must be present **at Vercel build time** (they are `NEXT_PUBLIC_*`, inlined into the bundle).

---

## 4. Exact files to CREATE

| File | Purpose |
|------|---------|
| `frontend/vercel.json` | Vercel build config: framework `nextjs`, region hint, headers (optional security headers). |
| `frontend/.env.production.example` | Documents the three `NEXT_PUBLIC_*` prod values set in the Vercel dashboard. |
| `docs/DEPLOYMENT.md` | The go-live **runbook**: backend hardening → `cdk deploy` → secrets → Vercel setup → smoke test → rollback. |
| `docs/RELEASE-CHECKLIST.md` | One-page pre-flight/ship checklist (mirrors §14–15 here). |

> Note: `README.md`, `docs/VERIFICATION.md`, `docs/DEMO.md`, `docs/architecture.md` already exist and are **modified**, not created.

---

## 5. Exact files to MODIFY

### Backend hardening

| File | Change |
|------|--------|
| `infra/lib/infra-stack.ts` | (a) Replace `allowedOrigins: ['*']` on both Function URLs and `Cors.ALL_ORIGINS` on `RestApi` with an **allowlist from context/env** (`ALLOWED_ORIGINS`, default `*` for dev, exact Vercel origin(s) for prod). (b) Add API Gateway **throttling** (stage-level `throttlingRateLimit`/`throttlingBurstLimit`, or a `UsagePlan` + API key). (c) Add `logRetention`/explicit `LogGroup` (e.g. `ONE_MONTH`) for Orchestration/Approve/Deploy/History/WS Lambdas. (d) Tighten `DeploymentRole` S3 policy from `Resource: '*'` to `arn:aws:s3:::apex-*` (+ `/*`) per IMPORTANT-2. (e) Optional: add a shared-secret header check env (`APP_ACCESS_TOKEN`) if enabling lightweight auth. |
| `infra/bin/infra.ts` | Pass `allowedOrigins`/prod flags into `InfraStack` via `app.node.tryGetContext('allowedOrigins')` or env, so `cdk deploy -c allowedOrigins=https://<app>.vercel.app` works without code edits. |
| `infra/lambda/orchestrate/index.ts` (+ approve/history) | If lightweight auth is enabled: validate `x-app-token` header against `APP_ACCESS_TOKEN` env; return 401 otherwise. Behind a flag so it stays optional. |
| `infra/test/orchestration-infra.test.ts` (+ `deploy-infra.test.ts`) | Assert CORS is not `*` when prod context set; assert throttling present; assert DeploymentRole S3 resource is scoped to `apex-*`. |

### Frontend / UX

| File | Change |
|------|--------|
| `frontend/src/app/page.tsx` (+ hook) | Fix **IMPORTANT-1**: reset/guard deploy UI state (`deployEvents`, deploy status) when switching history items so a past item doesn't show a live/stale deploy terminal. |
| `frontend/next.config.ts` | Optional: add production security headers (CSP/HSTS) and confirm no config blocks static export/SSR on Vercel. |
| `frontend/.env.example` | Add note that production values live in Vercel project settings (not committed). |

### Docs / release

| File | Change |
|------|--------|
| `README.md` | Add a **"Deploy to production"** section (Vercel steps + prod CORS), link `docs/DEPLOYMENT.md`, add the live app URL + demo GIF once recorded. |
| `docs/VERIFICATION.md` | Add a short **§9 Production smoke test** (same flow, but against the Vercel URL + hardened backend). |
| `docs/architecture.md` | Add the Vercel ⇆ AWS production topology (from §3). |
| `docs/DEMO.md` | Confirm script targets the live URL; note recording output path for the README GIF. |
| `docs/phases/README.md` | Add this plan to the "Plans & reviews" table. |
| `progress.md` | Flip Week 4 Day 27–28 to complete; record live URL + release tag. |

---

## 6. Interfaces & contracts

### 6.1 Env-var contract (Vercel build-time → AWS)

| Vercel env (Production + Preview) | Value source (CDK output) | Consumed by |
|-----------------------------------|---------------------------|-------------|
| `NEXT_PUBLIC_ORCHESTRATION_URL` | `OrchestrationFunctionUrl` | Generate |
| `NEXT_PUBLIC_API_GATEWAY_URL` | `ApiUrl` | `/approve`, `/history` |
| `NEXT_PUBLIC_WEBSOCKET_URL` | `WebSocketUrl` (`wss://…`) | pipeline + deploy events |
| `NEXT_PUBLIC_APP_TOKEN` *(only if lightweight auth on)* | value set in `APP_ACCESS_TOKEN` secret/env | sent as `x-app-token` header |

Rule: these are **inlined at build time** — changing them requires a **Vercel redeploy**, not just an env edit.

### 6.2 CORS contract

- Backend `ALLOWED_ORIGINS` **must include** the exact Vercel production origin (e.g. `https://apex.vercel.app`).
- **Preview deployments** use dynamic `*.vercel.app` subdomains. Lambda Function URL CORS supports exact origins or `*` only (no subdomain wildcard). Decision: production origin only; if previews must work, either keep `*` (accept risk) or add each preview origin manually. Documented in `docs/DEPLOYMENT.md`.

### 6.3 Deploy order dependency

Backend **must** deploy first (CDK outputs exist) → set Vercel env from outputs → Vercel build. Reversing breaks the frontend (empty URLs → "Pipeline stream offline", generate fails).

---

## 7. Database changes

**None.** No schema, key, index, or record changes. Production uses the same `GenerationsTable` and `TemplatesBucket` as dev (or a fresh deploy of the same definitions). Existing `RemovalPolicy.DESTROY` on the table/bucket is acceptable for a portfolio prod; note in runbook that destroying the stack deletes history.

---

## 8. Backend changes (detail)

1. **CORS lockdown** — parameterize origins; default `*` (dev), exact Vercel origin(s) for prod via `-c allowedOrigins=`. Apply to both Function URLs and RestApi `defaultCorsPreflightOptions`.
2. **Throttling / abuse control** — stage throttle (e.g. rate 10 rps, burst 20) on the REST API; document Anthropic console spend cap as the backstop for the open orchestration Function URL. (Optional stronger control: `x-app-token` shared-secret check.)
3. **DeploymentRole tightening** — S3 actions scoped to `arn:aws:s3:::apex-*` and `arn:aws:s3:::apex-*/*` instead of `*` (IMPORTANT-2). Verify demo prompt "private encrypted S3 bucket" still deploys (bucket name prefix may need `apex-` — confirm generated template or relax to a documented prefix).
4. **Observability** — explicit `LogGroup` + `RetentionDays` for each prod Lambda; optional CloudWatch alarms (Deploy/Orchestration error rate, DeployLambda duration approaching timeout).
5. **Deploy** — `./scripts/build-sandbox-layer.sh` then `cd infra && npm run deploy` (or `cdk deploy -c allowedOrigins=https://<app>.vercel.app SandboxStack InfraStack`). Populate `anthropic-api-key` secret post-deploy.

---

## 9. Frontend changes (detail)

1. **Vercel project** — import the repo, set **Root Directory = `frontend`**, framework auto-detected (Next.js). Build `next build`, output managed by Vercel.
2. **Env vars** — add the three (four with auth) `NEXT_PUBLIC_*` in Vercel → Settings → Environment Variables for **Production** (and Preview if used). Redeploy after any change.
3. **`vercel.json`** — pin framework/region and optional headers; ensures reproducible builds.
4. **IMPORTANT-1 fix** — clear deploy terminal + deploy status when `activeItem` changes so historical items never show a stale/live deploy log.
5. **Build sanity** — `npm run build` locally with prod env to catch inlining/SSR issues (xterm is client-only `'use client'` — confirm no SSR import error on Vercel).

---

## 10. Infrastructure changes (summary)

| Resource | Change | Notes |
|----------|--------|-------|
| Function URLs (orchestration, generate) | CORS origin allowlist | from `*` → Vercel origin |
| REST API | CORS allowlist + stage throttling | rate/burst limits |
| Prod Lambdas | explicit LogGroup + retention (+ optional alarms) | observability/cost |
| `DeploymentRole` | S3 `Resource` scoped to `apex-*` | IMPORTANT-2 |
| Frontend hosting | **new: Vercel project** | public URL |
| (optional) shared-secret auth | `APP_ACCESS_TOKEN` env + header check | gated by flag |

No new AWS service types; WebSocket API, DynamoDB, S3, Secrets Manager unchanged in shape.

---

## 11. Implementation order

1. Fix frontend **IMPORTANT-1** (deploy UI reset) + local `npm run build`/`lint`.
2. Backend hardening in `infra-stack.ts` (CORS param, throttle, log retention, DeploymentRole scope) + update infra tests; `npm test`, `cdk synth`, `cdk diff`.
3. `cdk deploy` to `ap-south-1` with prod context; capture outputs; set `anthropic-api-key`.
4. Backend production smoke test via curl (VERIFICATION §5) against hardened stack.
5. Create Vercel project (root `frontend`), add env vars from outputs, deploy.
6. Set backend `ALLOWED_ORIGINS` to the now-known Vercel origin; re-`cdk deploy`; redeploy Vercel if env changed.
7. **Production E2E** from the live URL: generate → approve → live deploy log → `deployed` → outputs; teardown demo stack.
8. Record demo (DEMO.md); add GIF + live URL to README; update VERIFICATION §9, architecture, progress.md, phases README.
9. Clean git history, commit, **tag release** (`v1.0.0`), push to GitHub.

Steps 1–4 are backend-only and reversible before any public exposure.

---

## 12. Testing commands

```bash
# Pre-deploy: full local gate
cd packages/changeset && npm ci && npm run build && npm test
cd ../../infra && npm ci && npm run build && npm test
cd ../frontend && npm ci && npm run lint && npm run build

# CDK validation with prod CORS
cd ../infra
npx cdk synth -c allowedOrigins=https://<app>.vercel.app
npx cdk diff  -c allowedOrigins=https://<app>.vercel.app

# Deploy backend (prod)
cd .. && ./scripts/build-sandbox-layer.sh
cd infra && npx cdk deploy -c allowedOrigins=https://<app>.vercel.app SandboxStack InfraStack

# Set the Anthropic key (once)
aws secretsmanager put-secret-value --secret-id anthropic-api-key \
  --secret-string "sk-ant-..." --region ap-south-1

# Frontend production build locally (prod env inlined)
cd ../frontend && npm run build

# Vercel deploy (CLI path)
npx vercel --prod        # from frontend/, after `vercel link` + env set
```

### Production smoke test (against live URL)

```bash
export ORCH_URL="<OrchestrationFunctionUrl>"; export API_URL="<ApiUrl>"; export REGION=ap-south-1
curl -s -X POST "$ORCH_URL" -H 'Content-Type: application/json' \
  -d '{"message":"Create a private encrypted S3 bucket"}' | tee /tmp/o.json | jq '.status'
CID=$(jq -r .conversationId /tmp/o.json); GID=$(jq -r .generationId /tmp/o.json)
curl -s -X POST "${API_URL%/}/approve" -H 'Content-Type: application/json' \
  -d "{\"conversationId\":\"$CID\",\"generationId\":\"$GID\",\"action\":\"approve\"}" | jq '.status'  # deploying
# then confirm deployed in DynamoDB + CloudFormation (VERIFICATION §5)
```

---

## 13. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| **Open orchestration Function URL abused** → Anthropic bill | Medium | High | Anthropic console spend cap; API throttling; optional `x-app-token` shared secret; keep URL unadvertised; monitor. |
| CORS misconfig blocks the live UI | Medium | High | Test preflight from the exact Vercel origin; keep dev `*` fallback; document preview-domain trade-off. |
| `NEXT_PUBLIC_*` not set before Vercel build → blank endpoints | Medium | High | Deploy backend first; set env then trigger build; verify header "Pipeline stream connected". |
| DeploymentRole `apex-*` scope breaks demo deploy | Medium | Medium | Confirm generated bucket names / relax to documented prefix; test the S3 prompt post-tightening. |
| CloudFormation `RemovalPolicy.DESTROY` wipes prod history on `cdk destroy` | Low | Medium | Document in runbook; consider `RETAIN` for prod table/bucket if history must persist. |
| Vercel SSR breaks on client-only libs (xterm/confetti) | Low | Medium | Client components already `'use client'`; run `npm run build` before deploy; dynamic import if needed. |
| Secret not set → generate 500 at launch | Low | High | Runbook step + VERIFICATION §2.2; smoke test before sharing URL. |
| Region/env mismatch (frontend points at wrong stack) | Low | Medium | Single source: copy env strictly from `describe-stacks` outputs. |
| Stale deploy UI on history switch during demo | Low | Low | Fix IMPORTANT-1 before recording. |

---

## 14. Acceptance criteria

1. Backend deployed to `ap-south-1`; all CDK outputs present; `anthropic-api-key` populated.
2. **CORS restricted** to the Vercel production origin (not `*`) on Function URLs + REST API; requests from other origins are rejected.
3. REST API has **throttling** configured (or a documented equivalent abuse control).
4. `DeploymentRole` S3 permissions scoped to `apex-*` (no `Resource: '*'` for object/bucket actions).
5. Prod Lambdas have **log retention** set.
6. Frontend is **live on a public Vercel URL**, loads without console errors, shows **"Pipeline stream connected."**
7. **Production E2E** from the live URL succeeds: generate → approve → live deploy log → status `deployed` → outputs shown → real CloudFormation stack `CREATE_COMPLETE`.
8. IMPORTANT-1 fixed: switching history items never shows a stale/live deploy terminal.
9. All tests green: `changeset`, `infra` (incl. updated CORS/throttle/role assertions), frontend `lint` + `build`.
10. **Ship artifacts** done: README updated with live URL + demo GIF; `docs/DEPLOYMENT.md` runbook; VERIFICATION §9; `progress.md` marked complete; git tagged `v1.0.0` and pushed.

---

## 15. Verification checklist

- [ ] `packages/changeset`, `infra`, `frontend` all build + test green locally.
- [ ] `cdk synth`/`cdk diff` with `-c allowedOrigins=<vercel>` clean.
- [ ] `cdk deploy SandboxStack InfraStack` succeeds; outputs captured.
- [ ] `anthropic-api-key` secret set; backend curl generate returns `awaiting_approval`.
- [ ] CORS: request from Vercel origin passes preflight; request from a random origin is blocked.
- [ ] REST API throttle verified (or documented control in place).
- [ ] DeploymentRole S3 resource = `apex-*` (asserted in infra test + IAM console spot-check).
- [ ] Prod Lambda log groups show retention.
- [ ] Vercel project: root `frontend`, 3 (or 4) `NEXT_PUBLIC_*` env vars set for Production.
- [ ] Vercel production build succeeds; live URL loads; WebSocket shows connected.
- [ ] Live E2E: generate → approve → deploy log → `deployed` → outputs → CFN `CREATE_COMPLETE`.
- [ ] IMPORTANT-1 deploy-UI reset verified by switching history items mid/after deploy.
- [ ] Teardown: demo `apex-gen-*` stack deleted after smoke test.
- [ ] README live URL + demo GIF; `docs/DEPLOYMENT.md` + `docs/RELEASE-CHECKLIST.md` added; VERIFICATION §9; architecture topology; `progress.md` Day 27–28 complete.
- [ ] Clean git history; release tagged `v1.0.0`; pushed to GitHub.
- [ ] (Deferred, noted) Cognito auth, custom domain, CI/CD explicitly recorded as post-launch.
```
