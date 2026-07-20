# Phase 4 Review — Real Deployment & Ship It

> **Reviewer role:** Senior reviewer, Phase 4 sign-off.
> **Scope reviewed:** All Phase 4 changes in the working tree (tracked diffs vs `HEAD` @ `2644d5b` + untracked new files).
> **Reference docs:** [`context.md`](../../context.md) (PRD v4, Week 4), [`docs/phase-plans/phase-04-plan.md`](../phase-plans/phase-04-plan.md).
> **Note on filename:** This file was requested as `phase-01-review.md`, but the content under review is **Phase 4**. Filename kept as requested; consider renaming to `phase-04-review.md` to avoid confusion.

---

## 1. Summary

Phase 4 delivers the real CloudFormation deploy path end-to-end: a new async `DeployLambda`, a shared generation schema, S3 template storage, a scoped `DeploymentRole`, WebSocket `deploy_event` streaming, and a frontend deploy log + outputs experience with re-run (F5) and retry. The implementation closely follows the plan's architecture (async invoke, service-role separation, `iam:PassRole` scoping, template-in-S3, rollback handling, idempotency guards).

**Verification results (all green):**

| Check | Command | Result |
|-------|---------|--------|
| Infra type-check | `cd infra && npm run build` (`tsc`) | Pass, no errors |
| Infra unit + CDK tests | `cd infra && npm test` | **7 suites / 17 tests pass** (~1414s; see IMPORTANT-3) |
| Changeset regression | `cd packages/changeset && npm test` | 3 suites / 7 tests pass |
| Frontend build (TS) | `cd frontend && npm run build` | Pass (`next build`, TS clean) |
| Frontend lint | `cd frontend && npm run lint` | Clean |
| TODO/placeholder scan | code-wide grep | None in code (only benign UI `placeholder=` attrs) |
| Docs present | README/architecture/DEMO/CODE_GUIDE/progress | All exist with real content |

No `cdk synth`/`cdk diff`/live deploy was run (requires AWS creds / out of review scope). CDK assertion tests provide synth-time coverage.

**No BLOCKING issues found.** Findings below are IMPORTANT (should fix soon) and OPTIONAL (nice-to-have).

---

## 2. Requirement & plan-compliance matrix (acceptance criteria §14)

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `awaiting_approval → deploying → deployed`, real CF stack | Met | `approve/index.ts` sets `deploying` + async-invokes; `deploy/index.ts` runs change set create/execute |
| 2 | Template uploaded to `TemplatesBucket`, `templateS3Key` recorded | Met | `deploy/index.ts:329,352-357` |
| 3 | CF runs under `DeploymentRole`, not Lambda role; `PassRole` on that role only | Met | `RoleARN` on `CreateChangeSet`; `infra-stack.ts` PassRole scoped to `deploymentRole.roleArn` |
| 4 | Stack events stream via `deploy_event` → `DeployLogPanel` | Met | `pipelineStream.ts` `emitDeployEvent`; polling loop de-dupes by `EventId` |
| 5 | `deploymentOutputs` + `deploymentStackId` persisted & shown | Met | success path writes; `DeploymentOutputsPanel.tsx` |
| 6 | Failing template → rollback → `deploy_failed` + `deploymentError`; never stuck `deploying` | Met | `failGeneration` on every terminal/throw path; test asserts no stuck `deploying` |
| 7 | F5 re-run in one click | Met | `handleRerun` → `handleGenerate(prompt)`; new `generationId` → new stack |
| 8 | All Phase 1–3 tests pass + new/updated tests | Met | 17 infra tests + changeset all green |
| 9 | `cdk synth`/`diff`/`deploy` succeed | Partially verified | Synth exercised via CDK assertion tests; live deploy not run in review |
| 10 | No high-sev security regression; least-privilege IAM | Mostly met | See IMPORTANT-2 (DeploymentRole `Resource: '*'`) |
| 11 | README/architecture/progress shipped | Met | Files present with content |
| 12 | Cognito (optional) | Deferred | Correctly gated/deferred per plan; not required for sign-off |

Interfaces (§6) match: approve request/response codes (404/409/502), `DeployInvocation`, `deploy_event` shape, shared `StoredGenerationSchema` with additive optional fields, and stack naming `apex-gen-<gen8>`.

---

## 3. Findings

### BLOCKING

*None.*

### IMPORTANT

**IMPORTANT-1 — Frontend deploy state is global and leaks across history items.**
`usePipelineWebSocket` stores `deployEvents`/`deployStatus` globally (not keyed by `generationId`), and `page.tsx` derives:

```
const currentStatus = (deployStatus && activeItem) ? deployStatus : (activeItem?.status ...)
```

`resetDeploy()` is called on new-generate, new-stack, and approve, but **not** when the user selects a different history item (`page.tsx:497-501`). Repro: deploy stack A (→ `deployStatus='deployed'`), then click an unrelated history item B. B now renders "Deployed successfully", and `DeployLogPanel`/`DeploymentOutputsPanel` show **A's** logs, outputs, and stack ID because `terminalDeployEvent` and the panels read the global `deployEvents`. Also the incoming `deploy_event.generationId` is never checked against the active item.
- **Impact:** Clearly misleading UI — a never-deployed generation appears deployed with another stack's outputs. Data is unaffected (DynamoDB remains source of truth) and it is session-scoped/recoverable, so not blocking.
- **Fix:** Call `resetDeploy()` in the history-item `onClick`, and/or ignore `deploy_event`s whose `generationId !== activeItem.generationId`, and scope `currentStatus`/panels to the active generation.

**IMPORTANT-2 — `DeploymentRole` S3 policy uses `Resource: '*'`.**
`infra-stack.ts` grants S3 write/delete actions (`CreateBucket`, `DeleteBucket`, `DeleteBucketPolicy`, `PutBucket*`, …) on `Resource: ['*']`. Actions are S3-scoped (good, matches the plan's "S3-first allowlist"), but the wildcard resource means a hallucinated/hostile LLM template executed by CloudFormation could act on **any** bucket in the account (e.g. `DeleteBucketPolicy`). Mitigated by manual approval, the security scan gate, and CF-only trust — hence IMPORTANT, not BLOCKING.
- **Fix (later phase acceptable):** constrain to a bucket name prefix (e.g. `apex-*`) where the action set allows resource-level scoping, and drop bucket-wide destructive actions that aren't needed for the demo.

**IMPORTANT-3 — Infra test suite is very slow and leaks a worker handle.**
`npm test` took ~1414s because each CDK assertion test (`deploy-infra.test.ts` × 5 + `orchestration-infra.test.ts`) instantiates a fresh `InfraStack` and re-bundles all ~7 NodejsFunctions with esbuild (no asset caching across `App`s). Jest also logged: *"A worker process has failed to exit gracefully … tests leaking due to improper teardown."*
- **Impact:** CI cost/time and a latent open-handle (likely module-load AWS SDK clients / timers). Tests still pass.
- **Fix:** Build the `Template` once in a `beforeAll` shared across assertions; consider `jest --detectOpenHandles` to locate the leak and `--forceExit` only as a stopgap.

### OPTIONAL

- **OPT-1 — `DeployEventMessage` duplicated** in `infra/lambda/shared/pipelineStream.ts` and `frontend/src/lib/deploy.ts`. Acceptable given the backend/frontend boundary, but the two can drift; consider a shared type package or a comment cross-linking them.
- **OPT-2 — `AWS_ACCOUNT_ID` env var** is set on `DeployLambda` (and asserted in tests) but never read by `deploy/index.ts`. Remove it or use it (e.g. to construct ARNs) to avoid dead config.
- **OPT-3 — `CAPABILITY_NAMED_IAM` declared but `DeploymentRole` has no `iam:*` permissions.** Consistent with the S3-only guardrail (any IAM-containing template will fail at deploy by design), but this means only pure-S3 templates can currently deploy. Worth documenting explicitly as a known Phase 4 limitation so it isn't mistaken for a bug during the demo.
- **OPT-4 — `TemplatesBucket` resource policy granting `cloudformation.amazonaws.com` `s3:GetObject`** is likely redundant: CloudFormation fetches `TemplateURL` using the caller's (DeployLambda's) credentials, which already have bucket read via `grantReadWrite`. Harmless, but can be removed for clarity.
- **OPT-5 — `.env.example` note** for deploy events on the shared socket (plan §5) was not verified in the diff; confirm it's updated.

---

## 4. Correctness deep-dive (positives worth recording)

- **No-stuck-`deploying` invariant holds:** every terminal branch and the outer `catch` route through `failGeneration`, and the timeout path (`!terminalStack`) writes `deploy_failed`. Verified by `deploy.test.ts` "never leaves status stuck in deploying".
- **Idempotency:** approve transitions only from `awaiting_approval`/`deploy_failed`; `DeployLambda` re-checks `status === 'deploying'` and returns `{skipped:true}` otherwise (guards double-invoke).
- **Stuck-stack recovery:** `ensureStackReady` deletes + waits on `ROLLBACK_COMPLETE`/`REVIEW_IN_PROGRESS`/`DELETE_FAILED` before recreating — enables clean retry from `deploy_failed`.
- **No-change short-circuit:** `waitForChangeSet` detects "didn't contain changes" → `deployed` with existing outputs, avoiding a spurious failure.
- **Event de-dupe & ordering:** `seenEventIds` + timestamp sort produce stable, non-duplicated streamed logs.
- **Approve failure recovery:** if the async invoke call throws, status is reverted to `awaiting_approval` and 502 is returned (test-covered).
- **Schema unification:** `shared/generation.ts` removes the duplicated Zod schema from orchestrate/approve and adds the new statuses/fields as additive-optional → backward compatible; existing records still parse, follow-up reads of deployed records won't fail enum parsing.
- **Least-privilege CFN actions** scoped to `stack/apex-gen-*` and `changeSet/apex-cs-*`; `PassRole` scoped to the single `DeploymentRole` ARN (asserted in `deploy-infra.test.ts`).
- **DB integrity:** no key/GSI change; `putGeneration` uses `removeUndefinedValues`; `history` sort remains by `createdAt` desc.

---

## 5. Test quality

- **Good coverage of DeployLambda:** success + streaming, no-change short-circuit, rollback→`deploy_failed`, and skip-when-not-deploying.
- **Approval tests** cover approve→`deploying`+invoke, invoke-failure revert (502), retry from `deploy_failed`, and cancel.
- **CDK assertions** verify bucket encryption/public-access-block, DeploymentRole trust + S3 allowlist, DeployLambda timeout/mem/env, scoped `PassRole`, approval invoke grant + `DEPLOY_FUNCTION_NAME`, and all three new outputs.
- **Gaps (non-blocking):** no test for the deploy **timeout** branch (`!terminalStack`), no test that `ensureStackReady` deletes an unrecoverable stack before recreate, and no frontend test for the deploy-state-leakage scenario (IMPORTANT-1).

---

## 6. Recommendation

Core Phase 4 is functionally complete, matches the plan's architecture and interfaces, is data-safe, and passes all builds/lints/tests. The strongest issue (IMPORTANT-1) is a display-only, session-scoped UI leak that does not affect deployment correctness or stored state, and the security note (IMPORTANT-2) is an explicitly plan-sanctioned demo posture. None rise to BLOCKING. Please address IMPORTANT-1 and IMPORTANT-2 before/at the demo, and IMPORTANT-3 to keep CI healthy.

---

STATUS: APPROVED
