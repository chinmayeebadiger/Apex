# Phase 1 — Natural language to CDK code

**PRD:** Week 1, Days 1–7  
**Status:** Complete  
**Feature:** F1 — NL → CDK

---

## What this phase delivers

You type a sentence in plain English; Apex returns **production-style AWS CDK TypeScript** plus a one-line explanation. No deploy, no sandbox yet — just prove the AI → code loop works.

**Demo prompt:** `Create a private encrypted S3 bucket`

---

## Architecture (Phase 1 only)

```text
Browser → Lambda Function URL → Anthropic API (Claude)
                ↓
         { code, explanation } JSON
```

---

## Key components

| Component | Location | Role |
|-----------|----------|------|
| Next.js UI | `frontend/src/app/page.tsx` | Chat input, code display, history (localStorage) |
| Code highlighting | `frontend/src/components/CodeHighlight.tsx` | TS syntax colors |
| Generate Lambda | `infra/lambda/generate/index.ts` | HTTP handler (legacy; still deployed) |
| System prompt | `infra/lambda/shared/prompt.ts` | Rules: JSON-only, least-privilege IAM, encryption |
| Anthropic retry | `infra/lambda/shared/prompt.ts` | 429/529 backoff, 3 attempts |
| API key | `infra/lambda/shared/anthropicApiKey.ts` | Secrets Manager + in-memory cache |
| CDK infra | `infra/lib/infra-stack.ts` | API Gateway, Lambda, Secrets Manager secret |
| CDK app entry | `infra/bin/infra.ts` | `SandboxStack` + `InfraStack`, region `ap-south-1` |

---

## Important design decisions

1. **Direct Anthropic API** — not Bedrock (PRD v4). Simpler for India-billed accounts; key in Secrets Manager.
2. **Structured output** — Claude must return `{ "code", "explanation" }` JSON; validated with Zod.
3. **Function URL** — 60s timeout; avoids API Gateway 29s limit for long Claude responses.
4. **System prompt guardrails** — no `Action: '*'`, encryption at rest, multi-AZ RDS in generated code.

---

## What is NOT in Phase 1

- Sandbox `cdk synth`
- Diff / cost / security panels
- DynamoDB persistence
- WebSocket streaming
- CloudFormation deploy

---

## How to verify Phase 1 in isolation

Today the UI uses the **orchestration** path (Phase 2+). To test Phase-1-style behavior only:

```bash
curl -s -X POST "$LEGACY_GENERATE_FUNCTION_URL" \
  -H "Content-Type: application/json" \
  -d '{"message":"Create an encrypted S3 bucket"}' | jq '{code, explanation}'
```

Or call legacy `POST /generate` on API Gateway.

| Pass if |
|---------|
| Response contains non-empty `code` with `aws-cdk-lib` imports |
| `explanation` is a short string |

Full stack verification: [VERIFICATION.md](../VERIFICATION.md) sections 1–4.1 (code panel only).

---

## Dependencies

- Node.js 20+
- AWS account + `ap-south-1`
- Anthropic API key in Secrets Manager (`anthropic-api-key`)
- `@anthropic-ai/sdk`, `aws-cdk-lib` (infra), Next.js + Tailwind (frontend)

---

## Next phase

→ [Phase 2 — Sandbox & orchestration](./phase-02-sandbox-orchestration.md): validate code safely before any real deploy.
