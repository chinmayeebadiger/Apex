# Phase 1 — Natural Language to CDK Code

> **Status:** Complete · **PRD:** Week 1, Days 1–7 · **Feature:** F1  
> **Last updated:** July 21, 2026

---

## Phase Overview

### Goal of the phase

Prove the core product loop: **plain English in → valid AWS CDK TypeScript out**. No sandbox, no deploy, no persistence — just a working AI integration and a UI that displays generated code.

### Problems this phase solves

- Developers spend hours translating infra requirements into CDK boilerplate.
- The PRD v4 removed AWS Bedrock (Marketplace/payment blockers in some regions); we needed a reliable AI path.
- Without a minimal vertical slice, later phases (sandbox, diff, deploy) have nothing to validate against.

### Expected outcome

A user types *"Create a private encrypted S3 bucket"* and sees syntax-highlighted CDK TypeScript plus a one-line explanation, backed by Claude via the Anthropic API and an API key stored in Secrets Manager.

---

## Architecture Decisions

| Decision | Why | Alternatives considered | Tradeoffs |
|----------|-----|-------------------------|-----------|
| **Direct Anthropic API** (`api.anthropic.com`) | Bedrock model access failed for India-billed accounts; direct API is a common production pattern | AWS Bedrock | Key management is on us; no AWS Marketplace dependency |
| **Secrets Manager for API key** | Avoid plaintext env vars; rotate without redeploying code | Lambda env var, SSM Parameter Store | Small monthly cost; one extra IAM permission |
| **Lambda Function URL (120s)** for orchestration later; **60s** for legacy generate | API Gateway REST has a **29s hard limit** — Claude + synth can exceed that | API Gateway only | Function URLs are public unless you add auth (deferred) |
| **Structured JSON output from Claude** | Parse failures are easier to handle than free-form markdown | Markdown code fences | Requires prompt discipline + Zod validation |
| **Zod runtime validation** | LLMs occasionally return malformed JSON; fail fast with clear errors | JSON.parse only | Small bundle size in Lambda |
| **Region `ap-south-1` hardcoded** | Author's AWS account region; keeps sandbox synth env consistent | Parameterized region | Not multi-region yet |
| **Next.js 15+ App Router + Tailwind** | PRD stack; fast UI iteration | CRA, Vite | Next.js version in repo may differ from training data — check `frontend/AGENTS.md` |

---

## Implementation Walkthrough

### Task 1 — Project scaffolding

**What:** Next.js frontend, AWS CDK infra project, two stacks (`SandboxStack` + `InfraStack`).

**Why:** Separate sandbox compute from orchestration/API so LLM-generated code never inherits production IAM.

**Files:**

- `frontend/` — UI
- `infra/bin/infra.ts` — CDK app entry; wires stacks
- `infra/lib/infra-stack.ts` — API Gateway, Lambdas, Secrets Manager, DynamoDB (added in Phase 2)

**Interaction:** `infra/bin/infra.ts` creates `SandboxStack` first, passes `sandboxFn` into `InfraStack`.

### Task 2 — Anthropic integration

**What:** Fetch API key from Secrets Manager (cached per warm container), call `claude-sonnet-4-6`, validate `{ code, explanation }`.

**Why:** This is the product's brain; retry logic handles rate limits without user-facing failures.

**Files:**

- `infra/lambda/shared/anthropicApiKey.ts` — module-level cache + `GetSecretValue`
- `infra/lambda/shared/prompt.ts` — system prompt, `generateCdkCode()`, retry on 429/529
- `infra/lambda/generate/index.ts` — legacy HTTP handler (generate only, no sandbox)

**Interaction:** Handler → `getAnthropicApiKey()` → `new Anthropic({ apiKey })` → `generateCdkCode()`.

### Task 3 — Basic chat UI

**What:** Prompt input, loading state, code panel with syntax highlighting.

**Why:** Validates end-to-end latency and output quality before investing in sandbox/deploy.

**Files:**

- `frontend/src/app/page.tsx` — main workspace (grew in later phases)
- `frontend/src/components/CodeHighlight.tsx` — rendered CDK display

---

## Important Code

### System prompt + generation (`infra/lambda/shared/prompt.ts`)

```typescript
export const GeneratedCdkCodeSchema = z.object({
  code: z.string().min(1),
  explanation: z.string().min(1),
  files: z.record(z.string(), z.string()).optional(),
});
```

- **`code`** — single entry file executed as `app.ts` in the sandbox (Phase 2).
- **`files`** — optional extra paths if the model splits stack vs. entry (must not use relative imports without including files).
- **System prompt rules** — JSON-only response, no `Action: '*'`, encryption defaults.

Retry helper:

```typescript
await delay(250 * 2 ** (attempt - 1)); // exponential backoff on 429/529
```

### API key cache (`infra/lambda/shared/anthropicApiKey.ts`)

Module-level variable survives **warm** Lambda invocations — avoids Secrets Manager on every request within the same container.

### CDK infra (Phase 1 subset)

- `secretsmanager.Secret` — name `anthropic-api-key` (value set manually after first deploy)
- `GenerateLambda` + Function URL — legacy path
- `OrchestrationLambda` — added in Phase 2 but shares prompt module

### Environment variables (Lambda, set by CDK)

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY_SECRET_ARN` | ARN of Secrets Manager secret |

### Frontend env (`.env.local`)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_ORCHESTRATION_URL` | Primary generate endpoint (Phase 2+) |
| `NEXT_PUBLIC_API_GATEWAY_URL` | Approve/history (Phase 2+) |
| `NEXT_PUBLIC_WEBSOCKET_URL` | Phase 3 |

Phase 1 alone only needed a generate URL.

---

## Important Commands

| Command | What it does | When to run again |
|---------|--------------|-------------------|
| `cd frontend && npm install` | Install Next.js deps | After clone or package.json change |
| `cd infra && npm install` | Install CDK + Lambda deps | After clone |
| `cd infra && npm run build` | TypeScript compile for infra | Before deploy or tests |
| `cd infra && npm run deploy` | Build sandbox layer + `cdk deploy` both stacks | After infra code changes |
| `aws secretsmanager put-secret-value --secret-id anthropic-api-key --secret-string "sk-ant-..."` | Store Anthropic key | Once per account/rotation |
| `cd frontend && npm run dev` | Local UI at localhost:3000 | Daily development |

```bash
# Phase-1-style test (legacy generate Function URL)
curl -s -X POST "$LEGACY_GENERATE_URL" \
  -H "Content-Type: application/json" \
  -d '{"message":"Create an encrypted S3 bucket"}' | jq '{code, explanation}'
```

---

## Key Concepts Learned

### Anthropic Messages API

Claude is called via `@anthropic-ai/sdk` with `messages.create({ model, system, messages })`. The assistant's reply is in `content[]` text blocks — not a single string field.

### AWS Secrets Manager

Secrets are created empty by CDK; you **put the value** after deploy. Lambdas read with `GetSecretValue` — never commit keys to git.

### Lambda Function URL

HTTPS endpoint directly on a Lambda — no API Gateway in the middle. CORS is configured on the URL resource. Used because generation can run **60–120 seconds**.

### Zod

Runtime schema validation in TypeScript. `GeneratedCdkCodeSchema.parse(json)` throws if the LLM returns `{ code: "" }` or missing fields.

### AWS CDK (for Apex's own infra)

TypeScript defines CloudFormation; `cdk deploy` creates real AWS resources. This is separate from the CDK code Apex **generates** for users.

---

## Common Pitfalls

| Symptom | Root cause | Fix |
|---------|------------|-----|
| Generate returns 500 | Empty `anthropic-api-key` secret | `put-secret-value` after first deploy |
| Claude returns markdown instead of JSON | Prompt drift or model ignore | System prompt enforces JSON-only; Zod catches failures |
| API Gateway timeout at 29s | Long Claude + synth on REST route | Use **Orchestration Function URL** (120s), not `/orchestrate` |
| `INVALID_PAYMENT_INSTRUMENT` on Bedrock | AWS Marketplace billing | PRD v4 switched to direct Anthropic API |

---

## Design Notes

- **`generate` vs `orchestrate`:** Phase 1 used `GenerateLambda`. Phase 2 added `OrchestrationLambda` with the full pipeline. Both remain deployed; the UI uses orchestration exclusively today.
- **Self-contained CDK in `code` field:** Sandbox runs one file as `app.ts`. Relative imports to `./lib/` fail unless `files` includes those paths — enforced in the system prompt.
- **No DynamoDB in Phase 1:** History was localStorage-only until Phase 2/3.

---

## Phase Summary

### What was completed

- Next.js chat UI with code highlighting
- CDK project with Secrets Manager + Generate Lambda + Function URL
- Anthropic SDK integration with retry and Zod validation
- End-to-end: sentence → CDK on screen

### Remaining TODOs (this phase)

- None — phase is complete. Legacy `/generate` kept for debugging.

### Dependencies for Phase 2

- Working Claude output that roughly compiles as CDK TypeScript
- Deployed Lambda + Function URL
- Anthropic key in Secrets Manager

### Knowledge required before Phase 2

- How CloudFormation templates relate to CDK (`cdk synth` output)
- Lambda invoke permissions (orchestrator will call sandbox)
- DynamoDB composite keys (`partition` + `sort`)
