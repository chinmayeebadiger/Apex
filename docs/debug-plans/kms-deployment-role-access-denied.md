# Debug Plan — `CreateKey` AccessDenied on KMS during deploy

> **For:** the next agent picking this up. This is a **plan only** — no code has been changed for this issue yet.
> **Symptom reported by user:** deploy log shows `CREATE_FAILED BucketKmsKey179C7F42 AWS::KMS::Key ... Access denied for operation 'CreateKey'`, stack rolls back.
> **Related:** [phase-04.md](../explanations/phase-04.md) (deploy pipeline), [phase-04-deploy-ship.md](../phases/phase-04-deploy-ship.md) (safety model, IMPORTANT-2 note already flags this exact gap).

---

## 1. Root cause (already confirmed — do not re-diagnose)

The deploy failed for a **different reason than the previous SSM bootstrap bug** (that one is already fixed via `stripCdkBootstrap()`). This is a **second, separate** permissions gap.

### The chain of events

1. User prompt: *"Create a private S3 bucket with versioning enabled and customer-managed KMS key encryption"* — this is literally the **built-in example card** "Secure S3 Bucket with KMS" in `frontend/src/app/page.tsx` (`EXAMPLE_PROMPTS`, line ~87–89). Any user who clicks that card will hit this bug.
2. The system prompt in `infra/lambda/shared/prompt.ts` (line 22) instructs Claude: *"Always enable encryption at rest for S3, RDS, and DynamoDB."* It does **not** say "prefer S3-managed encryption over customer-managed KMS," so for a prompt that explicitly says "KMS key," Claude generates a `kms.Key` construct → CloudFormation resource `AWS::KMS::Key` (logical ID `BucketKmsKey179C7F42`).
3. Sandbox `cdk synth` succeeds (synth doesn't check deploy-time IAM).
4. On approve, `DeployLambda` uploads the template and CloudFormation deploys it under **`DeploymentRole`** (`infra/lib/infra-stack.ts`, lines 46–69).
5. `DeploymentRole`'s policy grants **only `s3:*` actions** (`resources: ['*']`, but action list is S3-only — no `kms:*` anywhere). It was deliberately scoped this way per the Phase 4 plan ("S3-first" safety model — see `docs/phases/phase-04-deploy-ship.md` "Safety model" table and `docs/phase-plans/phase-04-plan.md` §8 IAM section).
6. CloudFormation calls `kms:CreateKey` under that role → `AccessDenied` → resource `CREATE_FAILED` → automatic rollback → `CDKMetadata` shows `CREATE_FAILED`/"Resource creation cancelled" **only because the stack is rolling back**, not because `AWS::CDK::Metadata` itself needs any permission (it's a no-op pseudo-resource; ignore it as a red herring).
7. `DeployLambda`'s `firstFailedReason()` (in `infra/lambda/deploy/index.ts`) correctly captures the KMS `AccessDenied` reason and writes `status: 'deploy_failed'` + `deploymentError` to DynamoDB — this part of the pipeline is working as designed.

### This is NOT a bug in the deploy mechanics

Approve → DeployLambda → CreateChangeSet → ExecuteChangeSet → event polling → rollback handling all worked correctly. The **only** problem is: **`DeploymentRole` cannot create the resource types the LLM is allowed to generate**, and there is currently **no guardrail** that catches this mismatch before a real deploy attempt.

---

## 2. Why this will keep happening (scope of the real problem)

`DeploymentRole` is S3-only by design (documented, intentional demo scope). But:

- The **system prompt** has no restriction telling Claude to stay within S3-only resource types.
- The **security scanner** (`packages/changeset/src/securityScanner.ts`) only flags IAM wildcards / public S3 / RDS encryption / open security groups — it has **no concept of "will this resource type be deployable under DeploymentRole."**
- The **UI** actively suggests a KMS example prompt that cannot deploy today.
- The **only signal** the user gets is a raw CloudFormation `AccessDenied` message surfaced verbatim in the deploy log — technically correct, but not actionable/friendly, and it happens *after* diff/cost/security review already told the user things looked fine.

So: any prompt that produces IAM roles, KMS keys, Lambda functions, DynamoDB tables, RDS, ECS, VPC, ALB, etc. (i.e. almost everything except a plain S3 bucket) will fail identically at deploy time. This is a systemic gap, not a one-off.

---

## 3. Fix options (pick one or combine — trade-offs below)

### Option A — Expand `DeploymentRole` to cover KMS (minimal, narrow fix)

Add KMS actions needed for CDK-managed-key S3 buckets: `kms:CreateKey`, `kms:DescribeKey`, `kms:EnableKeyRotation`, `kms:PutKeyPolicy`, `kms:ScheduleKeyDeletion`, `kms:TagResource`, `kms:CreateAlias`, `kms:DeleteAlias`, `kms:UpdateAlias`, `kms:DisableKey`, `kms:EnableKey`. Also add these to the `Resource` allowlist thinking (currently `resources: ['*']` for S3 actions per IMPORTANT-2 — KMS actions arguably need `resources: ['*']` too since key ARNs don't exist before creation).

- **Pros:** Fixes this exact reported error immediately; small diff.
- **Cons:** Only fixes KMS. The same class of failure will resurface for the *next* resource type a user's prompt happens to generate (Lambda, DynamoDB, IAM roles for ECS tasks, etc.). Doesn't address the systemic gap in §2.

### Option B — Constrain the system prompt to only emit S3-deployable stacks (narrows the product, not the bug)

Change `SYSTEM_PROMPT` in `infra/lambda/shared/prompt.ts` to explicitly say: *"Use `s3.BucketEncryption.S3_MANAGED` for encryption — do not create customer-managed KMS keys unless explicitly required and only S3-related resources are supported for real deployment today."*

- **Pros:** Reduces likelihood of hitting unsupported resource types for common phrasing like "encryption at rest."
- **Cons:** LLM instructions are not a hard guarantee — a user can still explicitly ask for KMS/Lambda/RDS and get code that passes sandbox+security review, then fails at deploy. Also silently degrades the product's stated scope ("15+ AWS services supported at launch" per PRD §8) if taken too far. **Do not remove the KMS example card as a side effect without also deciding whether the product should support it.**

### Option C — Pre-deploy "deployability" guardrail (systemic fix — recommended primary fix)

Add a check, similar in spirit to `stripCdkBootstrap()`, that runs **before** `CreateChangeSet` in `infra/lambda/deploy/index.ts`:

1. Walk `item.cloudFormationTemplate.Resources`, collect the set of `Type` values used.
2. Compare against a `SUPPORTED_RESOURCE_TYPES` allowlist that exactly matches what `DeploymentRole`'s policy actually grants (single source of truth — see §4).
3. If any resource type is unsupported, **skip the deploy attempt entirely**, write `status: 'deploy_failed'` with a clear message like: `"Deploy not attempted: AWS::KMS::Key is not yet supported by the deployment role. Supported today: S3. See docs/phases/phase-04-deploy-ship.md."` and emit a `deploy_event` with the same friendly message.
4. This turns a confusing raw IAM stack trace into an actionable, expected error — and makes the boundary self-documenting in code instead of only in docs.

- **Pros:** Fixes the *category* of bug, not just KMS. Fails fast (no CFN round trip). Message is user-friendly. Forces the allowlist docs and the IAM policy to be checked together (reduces future drift between "what docs say is supported" and "what the role actually allows").
- **Cons:** Doesn't make KMS *work* — it just fails clearly instead of confusingly. Should be combined with Option A if the goal is "KMS prompts should actually deploy," or with Option B if the goal is "steer away from unsupported prompts."
- **Where to add the allowlist:** `infra/lambda/shared/generation.ts` is a reasonable shared location (it already centralizes cross-Lambda constants), or a new `infra/lambda/shared/deployability.ts`. Whichever file owns the list, the CDK IAM policy in `infra/lib/infra-stack.ts` should be generated from — or at minimum commented with a pointer to — the same list, so they can't silently drift apart again (this is exactly how the current KMS gap happened: the two were never linked).

### Option D — Change the security scanner to flag "not deployable under current DeploymentRole" (complementary, optional)

Extend `packages/changeset/src/securityScanner.ts` (or add a sibling `deployabilityScanner.ts` used by `analyzer.ts`) to flag non-S3 resource types as an informational/medium flag **before** approval, e.g.: `"AWS::KMS::Key is not supported for real deployment yet (S3-only demo scope) — approving will fail at deploy time."`

- **Pros:** User sees this *before* clicking Approve, in the same panel where they already review diff/cost/security — better UX than discovering it after approving and waiting through change-set creation.
- **Cons:** Adds another flag type; needs new severity handling (`info` vs `high`/`medium`) so it doesn't look like a security vulnerability when it's actually a scope limitation.

### Recommended combination

**Option C (pre-deploy guardrail, fail fast with clear message) + Option A scoped narrowly (grant the specific KMS actions needed for CDK's default S3-KMS pattern) is the best balance**: it immediately unblocks the exact reported example prompt (KMS bucket) while also preventing the *next* unsupported-resource-type prompt from producing a confusing raw AWS error. Option D is a nice-to-have follow-up once C/A are in place. Option B (prompt tweak) is optional polish, not a substitute for C.

---

## 4. Exact files to touch (whichever option(s) are chosen)

| File | Change needed |
|------|----------------|
| `infra/lib/infra-stack.ts` (lines 46–69, `DeploymentRole` policy) | **Option A:** add KMS actions to the policy statement (or a second `PolicyStatement` scoped to KMS actions). Keep IAM tests in sync. |
| `infra/lambda/deploy/index.ts` | **Option C:** add a resource-type allowlist check before `CreateChangeSetCommand` (near where `stripCdkBootstrap` is already applied, ~line 391). Reuse the existing `failGeneration()` helper to write `deploy_failed` + emit a `deploy_event` without ever calling `CreateChangeSet`. |
| `infra/lambda/shared/generation.ts` (or new `infra/lambda/shared/deployability.ts`) | **Option C:** define `SUPPORTED_RESOURCE_TYPES` as the single source of truth; import it in both `infra-stack.ts`-adjacent docs/comments and `deploy/index.ts`. |
| `infra/lambda/shared/prompt.ts` (`SYSTEM_PROMPT`, lines 12–27) | **Option B (optional):** add a line steering Claude toward `S3_MANAGED` encryption by default. |
| `packages/changeset/src/securityScanner.ts` or new file + `analyzer.ts` | **Option D (optional, follow-up):** add a "not deployable" informational flag. |
| `infra/test/deploy-infra.test.ts` | Update/add CDK assertion for the new `DeploymentRole` KMS statement (Option A) and/or that unsupported types never reach `CreateChangeSetCommand` in a unit test (Option C — mock CFN client, assert `send` never called with `CreateChangeSetCommand` when template has `AWS::KMS::Key` and KMS isn't yet allowlisted, or assert it *is* called once KMS actions are added). |
| `infra/test/deploy.test.ts` | Add a test case: template with an unsupported resource type → handler returns `{status: 'deploy_failed'}` without invoking `cloudFormationClient.send` for change-set creation (Option C). |
| `docs/phases/phase-04-deploy-ship.md` (Safety model table, "Resource allowlist" row) | Update to reflect the actual allowlist (S3 + KMS if Option A is taken) and mention the new pre-deploy guardrail (Option C) explicitly failing fast instead of relying on CFN to reject. |
| `docs/explanations/phase-04.md` (Common Pitfalls section) | Add this KMS incident as a documented pitfall, same pattern as the existing "SSM AccessDenied" entry — include the exact error text and fix, per that file's own conventions. |
| `frontend/src/app/page.tsx` (`EXAMPLE_PROMPTS`, ~line 87–89) | Decide: keep the "Secure S3 Bucket with KMS" example card **only if** Option A makes it actually deployable end-to-end. If deferring KMS support, either remove/relabel the card or add a UI note that it will demo generate+diff+cost+security but not real deploy yet. |

---

## 5. Implementation order (suggested)

1. Reproduce locally: re-run the exact prompt from the example card, confirm the same `CreateKey AccessDenied` in a fresh generation (don't retry the already-failed one — start a new generation, since `deploy_failed` records can be retried but a fresh repro is cleaner for testing the fix).
2. Implement **Option C** first (fail-fast guardrail) — this alone converts today's confusing raw IAM error into a clear, testable, documented outcome, and is safe to ship even if KMS support is deferred.
3. Add unit tests for the guardrail in `infra/test/deploy.test.ts` (template with unsupported type → `deploy_failed`, no CFN change-set call).
4. Decide (with the user, if ambiguous) whether KMS should be **supported** (do Option A: expand `DeploymentRole`, add KMS to the allowlist, remove the guardrail block for KMS) or **explicitly deferred** (leave KMS out of the allowlist, so the guardrail now correctly blocks it with a friendly message instead of a CFN failure).
5. If Option A is chosen: add the minimal KMS action set to `DeploymentRole`, update `deploy-infra.test.ts`, redeploy (`cd infra && npx cdk deploy InfraStack`), and manually verify the exact KMS example prompt deploys to `deployed` with a real KMS key + S3 bucket in the account.
6. Update `docs/phases/phase-04-deploy-ship.md` and `docs/explanations/phase-04.md` to match whatever the final allowlist is.
7. Re-run full test suite (`cd infra && npm test`, `cd packages/changeset && npm test`) before considering this closed.

---

## 6. Testing / verification checklist for whoever implements this

- [ ] `infra/test/deploy.test.ts` — new test: unsupported resource type short-circuits to `deploy_failed` without calling `CreateChangeSetCommand`.
- [ ] `infra/test/deploy.test.ts` — existing `stripCdkBootstrap` test still passes (don't regress the earlier SSM fix).
- [ ] `infra/test/deploy-infra.test.ts` — asserts `DeploymentRole` policy contents match whatever allowlist is decided (KMS actions present or absent, matching the guardrail list exactly).
- [ ] `cd infra && npm run build && npm test` — all suites green.
- [ ] Manual: fresh generation from the **exact** "Secure S3 Bucket with KMS" example card → Approve & Deploy → either (a) deploys to `deployed` with real KMS key + bucket visible in AWS console (if Option A taken), or (b) fails fast with a clear, non-IAM-jargon message before any CloudFormation call (if deferred).
- [ ] Manual: a plain "Create a private encrypted S3 bucket" (no KMS) prompt still deploys successfully — confirm no regression from any guardrail changes.
- [ ] Confirm CloudWatch logs for `DeployLambda` show the guardrail decision (add a `console.log`/`console.error` similar to the existing catch-block logging added for the SSM fix), so future failures are diagnosable without a DynamoDB scan.
- [ ] Update `docs/explanations/phase-04.md` Common Pitfalls + `docs/phases/phase-04-deploy-ship.md` Safety model table to reflect the true, current allowlist — these two docs must not drift from the actual IAM policy again.

---

## 7. Non-goals for this fix

- Do **not** widen `DeploymentRole` to a broad set of services "just in case" — every added action should map to a specific, tested, documented use case (this is exactly the discipline that was skipped when the KMS example prompt was added to the UI without a matching IAM grant).
- Do **not** remove the S3-only safety model wholesale — Cognito auth and rate limiting are still deferred (see `docs/phases/phase-04-deploy-ship.md` "After Phase 4"); expanding `DeploymentRole` broadly before those land increases blast radius from an already-open, unauthenticated Function URL.
