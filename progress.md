# DevOps Copilot — Implementation Progress

Last updated: **July 18, 2026**

Tracks implementation against [context.md](./context.md) (PRD v4). For code walkthroughs see [CODE_GUIDE.md](./CODE_GUIDE.md).

---

## Summary — Day 14 status: **Complete**

| Milestone | Status |
|-----------|--------|
| Week 1 (Day 1–7) | ✅ Complete |
| Week 2 Day 8–9 (Sandbox) | ✅ Complete |
| Week 2 Day 10–11 (Diff/Cost/Security) | ✅ Complete (backend + UI) |
| Week 2 Day 12–14 (Orchestration + DynamoDB + Approval) | ✅ Complete |

**Not in Day 14 scope (Week 3+):** WebSockets, S3 storage, CloudFormation deploy, Cognito, DynamoDB-backed history sidebar.

---

## How to verify everything yourself

### Prerequisites

- AWS CLI configured for `ap-south-1`
- Anthropic API key stored in Secrets Manager (`anthropic-api-key`)
- Node.js 20+

### Step 1 — Build and deploy backend

From the **repo root**:

```bash
./scripts/build-sandbox-layer.sh
cd infra
npm run deploy
```

Note the CDK outputs:

- `OrchestrationFunctionUrl` — copy to frontend env
- `ApiUrl` — copy to frontend env (for approve endpoint)

### Step 2 — Configure frontend

```bash
cd frontend
cp .env.example .env.local
```

Edit `.env.local`:

```env
NEXT_PUBLIC_ORCHESTRATION_URL=<OrchestrationFunctionUrl from CDK output>
NEXT_PUBLIC_API_GATEWAY_URL=<ApiUrl from CDK output>
```

### Step 3 — Run frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000

### Step 4 — Test the full Day 14 flow in the UI

1. Enter prompt: **"Create a private S3 bucket with encryption"**
2. Click **Generate** — wait up to ~60s (Claude + sandbox synth + analysis)
3. Verify you see:
   - Generated CDK code in the editor
   - **Infrastructure Diff** panel (green "create" resources)
   - **Monthly Cost Estimate** panel
   - **Security Scan** panel (should be clean for a well-formed bucket)
   - **Approve / Cancel** buttons
4. Click **Approve** — status should change to "Approved — saved in DynamoDB"
5. Click **Cancel** on a new generation — status should show cancelled

### Step 5 — Test API directly (curl)

Replace URLs with your deployed values.

**Orchestration (full pipeline):**

```bash
curl -s -X POST "$ORCHESTRATION_URL" \
  -H "Content-Type: application/json" \
  -d '{"message":"Create an encrypted S3 bucket"}' | jq .
```

Expected response fields: `status: "awaiting_approval"`, `code`, `explanation`, `diff`, `costEstimate`, `securityFlags`.

**Approve:**

```bash
curl -s -X POST "$API_URL/approve" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "<from orchestration response>",
    "generationId": "<from orchestration response>",
    "action": "approve"
  }' | jq .
```

Expected: `status: "approved"`.

### Step 6 — Verify DynamoDB record

```bash
aws dynamodb get-item \
  --table-name <GenerationsTableName from CDK output> \
  --key '{"conversationId":{"S":"<id>"},"generationId":{"S":"<id>"}}' \
  --region ap-south-1 | jq .
```

Expected fields: `generatedCdkCode`, `changeset`, `costEstimate`, `securityFlags`, `status`.

### Step 7 — Run automated tests

```bash
# Changeset module (diff, cost, security)
cd packages/changeset && npm run build && npm test

# Infra (orchestration, approval, CDK assertions)
cd infra && npm run build && npm test
```

All tests should pass.

### Step 8 — Test security scanner catches bad configs

Use a prompt that generates open security groups or wildcard IAM, e.g.:

**"Create an EC2 security group that allows SSH from anywhere"**

The **Security Scan** panel should show a high-severity flag for `0.0.0.0/0`.

---

## Week 1 checklist (Day 1–7)

| Item | Status | Location |
|------|--------|----------|
| Next.js + TypeScript + Tailwind | ✅ | `frontend/` |
| CDK project | ✅ | `infra/` |
| API Gateway + Lambda | ✅ | `infra/lib/infra-stack.ts` |
| Secrets Manager for API key | ✅ | `infra/lib/infra-stack.ts:18-20` |
| Anthropic SDK + retry | ✅ | `infra/lambda/shared/prompt.ts` |
| Chat UI + syntax highlighting | ✅ | `frontend/src/app/page.tsx`, `CodeHighlight.tsx` |
| Type sentence → see CDK code | ✅ | Via orchestration pipeline |

---

## Week 2 checklist (Day 8–14)

### Day 8–9: Sandbox

| Item | Status | Location |
|------|--------|----------|
| Isolated sandbox Lambda | ✅ | `infra/lambda/sandbox/index.ts` |
| CDK layer with pinned versions | ✅ | `scripts/build-sandbox-layer.sh` |
| Strict IAM (no AWS API access) | ✅ | `infra/lib/sandbox-stack.ts` |
| Timeout + memory limits | ✅ | 60s, 1024MB |

### Day 10–11: Diff + cost + security

| Item | Status | Location |
|------|--------|----------|
| Parse CF template → changeset | ✅ | `packages/changeset/src/parser.ts` |
| Colour-coded diff in UI | ✅ | `frontend/src/components/DiffPanel.tsx` |
| AWS Pricing API + heuristics | ✅ | `packages/changeset/src/costEstimator.ts` |
| IAM wildcard scan | ✅ | `packages/changeset/src/securityScanner.ts:58-76` |
| Public S3 / unencrypted RDS | ✅ | `securityScanner.ts:78-115` |
| Open security groups | ✅ | `securityScanner.ts:117-133` |

### Day 12–14: Orchestration + DynamoDB

| Item | Status | Location |
|------|--------|----------|
| Orchestration Lambda pipeline | ✅ | `infra/lambda/orchestrate/index.ts` |
| DynamoDB workflow state | ✅ | `infra/lib/infra-stack.ts:22-33` |
| Orchestration exposed via Function URL | ✅ | `infra/lib/infra-stack.ts:103-111` |
| Approve/cancel endpoint | ✅ | `infra/lambda/approve/index.ts`, `POST /approve` |
| Frontend uses orchestration | ✅ | `frontend/src/app/page.tsx` |
| Full e2e without WebSockets | ✅ | UI + curl tests above |
| Unit tests | ✅ | `infra/test/orchestration.test.ts`, `approval.test.ts` |

---

## Known limitations (post-Day 14)

| Item | Notes |
|------|-------|
| History sidebar | Still uses `localStorage`; DynamoDB is write-only from backend today |
| S3 template storage | Not implemented — templates live in DynamoDB records |
| CloudFormation deploy | Approve saves state only; actual deploy is Week 4 |
| WebSocket streaming | Week 3 |
| API Gateway `/orchestrate` | Exists but has 29s timeout — use Function URL for generation |

---

## Deploy commands (quick reference)

```bash
# From repo root
./scripts/build-sandbox-layer.sh

# From infra/
npm run deploy
```
