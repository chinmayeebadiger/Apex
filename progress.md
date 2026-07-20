# DevOps Copilot — Implementation Progress

Last updated: **July 20, 2026**

Tracks implementation against [context.md](./context.md) (PRD v4). For code walkthroughs see [CODE_GUIDE.md](./CODE_GUIDE.md).

---

## Summary — Week 4 / Phase 4 status: **Implemented (pending review)**

| Milestone | Status |
|-----------|--------|
| Week 1 (Day 1–7) | ✅ Complete |
| Week 2 Day 8–14 (Sandbox + Orchestration) | ✅ Complete |
| Week 3 Day 15–19 (WebSocket + UI polish + history) | ✅ Complete |
| Week 4 Day 22–24 (Real CFN deploy + live logs) | ✅ Implemented |
| Week 4 Day 25–26 (Cognito) | ⏸ Deferred (`ENABLE_COGNITO` not enabled) |
| Week 4 Day 27–28 (Docs + ship checklist) | ✅ Docs updated |

**Status machine:**

```text
generating → awaiting_approval → deploying → deployed | deploy_failed
                               → cancelled
           → failed
```

---

## How to verify Phase 4 (deploy)

### Prerequisites

- AWS CLI configured for `ap-south-1`
- Anthropic API key in Secrets Manager (`anthropic-api-key`)
- Node.js 20+

### Step 1 — Build and deploy backend

```bash
./scripts/build-sandbox-layer.sh
cd infra
npm run deploy
```

Note outputs: `OrchestrationFunctionUrl`, `ApiUrl`, `WebSocketUrl`, `TemplatesBucketName`, `DeployLambdaName`, `DeploymentRoleArn`.

### Step 2 — Configure frontend

```bash
cd frontend
cp .env.example .env.local
```

```env
NEXT_PUBLIC_ORCHESTRATION_URL=<OrchestrationFunctionUrl>
NEXT_PUBLIC_API_GATEWAY_URL=<ApiUrl>
NEXT_PUBLIC_WEBSOCKET_URL=<WebSocketUrl>
```

### Step 3 — Run frontend

```bash
cd frontend && npm install && npm run dev
```

### Step 4 — UI deploy flow

1. Prompt: **Create a private encrypted S3 bucket**
2. Wait for diff / cost / security + **Approve & Deploy**
3. Approve → status **deploying**, live events in deploy log panel
4. Terminal status **deployed** with outputs + CloudFormation console link
5. **Re-run generation** creates a new generation/stack

### Step 5 — API / DynamoDB checks

```bash
# Approve → deploying
curl -s -X POST "$API_URL/approve" -H 'Content-Type: application/json' \
  -d '{"conversationId":"'"$CID"'","generationId":"'"$GID"'","action":"approve"}' | jq .

# Confirm terminal state
aws dynamodb get-item --table-name "$GEN_TABLE" \
  --key '{"conversationId":{"S":"'"$CID"'"},"generationId":{"S":"'"$GID"'"}}' \
  --region ap-south-1 | jq '.Item.status, .Item.deploymentStackName, .Item.deploymentOutputs'
```

### Step 6 — Automated tests

```bash
cd packages/changeset && npm run build && npm test
cd infra && npm run build && npm test
cd frontend && npm run lint && npm run build
```

---

## Week 4 checklist

| Item | Status | Location |
|------|--------|----------|
| Shared generation schema | ✅ | `infra/lambda/shared/generation.ts` |
| DeployLambda + CFN change sets | ✅ | `infra/lambda/deploy/index.ts` |
| Approve async-invokes deploy | ✅ | `infra/lambda/approve/index.ts` |
| TemplatesBucket + DeploymentRole | ✅ | `infra/lib/infra-stack.ts` |
| `deploy_event` WebSocket messages | ✅ | `infra/lambda/shared/pipelineStream.ts` |
| Deploy log + outputs UI | ✅ | `DeployLogPanel.tsx`, `DeploymentOutputsPanel.tsx` |
| Re-run (F5) | ✅ | `frontend/src/app/page.tsx` |
| Unit + infra tests | ✅ | `infra/test/deploy*.test.ts`, `approval.test.ts` |
| README / architecture / DEMO | ✅ | `README.md`, `docs/` |
| Cognito | ⏸ | Optional; deferred |

---

## Known limitations

| Item | Notes |
|------|-------|
| DeploymentRole allowlist | S3-first demo scope; expand deliberately for other resource types |
| Cognito | Not enabled; APIs remain open Function URL / API Gateway |
| Long deploys | Bounded by Lambda 15 min; demo resources (S3) stay fast |
| History sidebar | Loads from DynamoDB when API configured; local cache still used for snappy UI |

---

## Deploy commands (quick reference)

```bash
./scripts/build-sandbox-layer.sh
cd infra && npm run deploy
```
