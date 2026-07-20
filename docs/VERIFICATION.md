# Verification guide — is Apex working?

Use this checklist top-to-bottom. Each section must pass before moving on. Region: **`ap-south-1`**.

---

## 0. Prerequisites (5 minutes)

Run these from your machine:

```bash
node -v          # expect v20+
aws --version
aws sts get-caller-identity   # must return your account ID
cd /path/to/apex
```

| Check | Pass if |
|-------|---------|
| Node 20+ | Version prints |
| AWS CLI | Credentials valid |
| Repo | You are in the `apex` root |

---

## 1. Local tests (no AWS deploy required)

Confirms code compiles and unit tests pass.

```bash
# Changeset library (diff, cost, security)
cd packages/changeset
npm install
npm run build
npm test

# Infra (Lambdas, CDK stacks, handlers)
cd ../../infra
npm install
npm run build
npm test

# Frontend
cd ../frontend
npm install
npm run lint
npm run build
```

| Pass if |
|---------|
| All three `npm test` / `npm run build` exit **0** |
| Infra: **7 suites / 17 tests** (or current count — all green) |
| Changeset: **3 suites / 7 tests** |

If this fails, fix code before deploying to AWS.

---

## 2. Deploy backend to AWS

From repo root:

```bash
./scripts/build-sandbox-layer.sh
cd infra
npm run deploy
```

When prompted, approve IAM changes for **SandboxStack** and **InfraStack**.

### 2.1 Save CDK outputs

After deploy completes:

```bash
aws cloudformation describe-stacks --stack-name InfraStack --region ap-south-1 \
  --query 'Stacks[0].Outputs' --output table
```

Copy these values (names may vary slightly):

| Output | Used for |
|--------|----------|
| `OrchestrationFunctionUrl` | Frontend generate |
| `ApiUrl` | Approve + history |
| `WebSocketUrl` | Live pipeline + deploy logs |
| `GenerationsTableName` | DynamoDB checks |
| `TemplatesBucketName` | Deploy path |
| `DeployLambdaName` | Debugging |
| `DeploymentRoleArn` | Debugging |

Export for later steps:

```bash
export ORCH_URL="<OrchestrationFunctionUrl>"
export API_URL="<ApiUrl>"    # trailing slash OK
export WS_URL="<WebSocketUrl>"
export GEN_TABLE="<GenerationsTableName>"
export REGION="ap-south-1"
```

### 2.2 Set Anthropic API key in Secrets Manager

First deploy creates secret `anthropic-api-key` (empty). Put your key in:

```bash
aws secretsmanager put-secret-value \
  --secret-id anthropic-api-key \
  --secret-string "sk-ant-..." \
  --region ap-south-1
```

| Pass if |
|---------|
| `put-secret-value` succeeds |
| No error when you run a generation (step 4) |

---

## 3. Configure and run frontend

```bash
cd frontend
cp .env.example .env.local
```

Edit `.env.local`:

```env
NEXT_PUBLIC_ORCHESTRATION_URL=<OrchestrationFunctionUrl>
NEXT_PUBLIC_API_GATEWAY_URL=<ApiUrl>
NEXT_PUBLIC_WEBSOCKET_URL=<WebSocketUrl>
```

```bash
npm install
npm run dev
```

Open **http://localhost:3000**

| Pass if |
|---------|
| Page loads without console errors |
| Header shows **Pipeline stream connected** (green dot) |

If WebSocket shows **offline**, check `NEXT_PUBLIC_WEBSOCKET_URL` (must start with `wss://`).

---

## 4. End-to-end UI test (full product)

### 4.1 Generate + validate

1. Click example **Secure S3 Bucket with KMS** (or paste):
   ```
   Create a private encrypted S3 bucket
   ```
2. Click **Generate**
3. Wait up to ~90 seconds

| Pass if |
|---------|
| **Live Pipeline** steps appear: Generate → Synth → Analyze → Ready |
| CDK code appears in the editor |
| **Infrastructure Diff** shows green “create” resources |
| **Monthly Cost Estimate** shows a dollar amount |
| **Security Scan** is clean (or explains flags) |
| Status: **awaiting approval** |

### 4.2 Approve and deploy

1. Click **Approve & Deploy**
2. Watch **Deploy log** terminal fill with CloudFormation events
3. Wait until status is **deployed**

| Pass if |
|---------|
| Status becomes **deploying**, then **deployed** |
| Deploy log shows `CREATE_COMPLETE` (or similar) |
| **Deployment outputs** panel shows stack outputs |
| No stuck **deploying** after 5+ minutes |

### 4.3 Re-run

1. Click **Re-run generation** (or refine with follow-up prompt)
2. Confirm a **new** generation appears in sidebar history

| Pass if |
|---------|
| New `generationId` in sidebar |
| New stack name pattern `apex-gen-<8 chars>` in outputs |

---

## 5. API checks (curl)

Use IDs from the orchestration response or browser DevTools → Network.

```bash
# 1) Generate (orchestration)
curl -s -X POST "$ORCH_URL" \
  -H "Content-Type: application/json" \
  -d '{"message":"Create a private encrypted S3 bucket"}' | tee /tmp/orch.json | jq .

export CID=$(jq -r .conversationId /tmp/orch.json)
export GID=$(jq -r .generationId /tmp/orch.json)
```

| Pass if |
|---------|
| `status` is `"awaiting_approval"` |
| `code`, `diff`, `costEstimate` present |

```bash
# 2) History
curl -s "${API_URL%/}/history?conversationId=$CID" | jq '.items | length'
```

| Pass if |
|---------|
| Returns ≥ 1 item |

```bash
# 3) Approve (starts deploy)
curl -s -X POST "${API_URL%/}/approve" \
  -H "Content-Type: application/json" \
  -d "{\"conversationId\":\"$CID\",\"generationId\":\"$GID\",\"action\":\"approve\"}" | jq .
```

| Pass if |
|---------|
| `status` is `"deploying"` |

Wait ~1–2 minutes, then:

```bash
# 4) DynamoDB terminal state
aws dynamodb get-item --table-name "$GEN_TABLE" --region "$REGION" \
  --key "{\"conversationId\":{\"S\":\"$CID\"},\"generationId\":{\"S\":\"$GID\"}}" \
  | jq -r '.Item.status.S, .Item.deploymentStackName.S'
```

| Pass if |
|---------|
| Status is `deployed` (or `deploy_failed` with clear error — investigate) |
| `deploymentStackName` like `apex-gen-xxxxxxxx` |

```bash
# 5) CloudFormation stack exists
STACK=$(aws dynamodb get-item --table-name "$GEN_TABLE" --region "$REGION" \
  --key "{\"conversationId\":{\"S\":\"$CID\"},\"generationId\":{\"S\":\"$GID\"}}" \
  | jq -r '.Item.deploymentStackName.S')

aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query 'Stacks[0].StackStatus' --output text
```

| Pass if |
|---------|
| `CREATE_COMPLETE` or `UPDATE_COMPLETE` |

---

## 6. WebSocket smoke test (optional)

With `websocat` or similar:

```bash
websocat "$WS_URL"
```

You should receive `{"type":"connected","connectionId":"..."}`.

During a generate/deploy with that `connectionId` in the POST body, you should see `pipeline_step` and `deploy_event` JSON messages.

---

## 7. Sandbox isolation check (optional)

Confirm sandbox Lambda has **no** broad AWS permissions:

```bash
aws lambda get-function-configuration \
  --function-name $(aws cloudformation describe-stack-resources \
    --stack-name SandboxStack --region $REGION \
    --query "StackResources[?ResourceType=='AWS::Lambda::Function'].PhysicalResourceId" \
    --output text) \
  --region $REGION \
  --query 'Role'
```

Review the role in IAM — it should only allow CloudWatch logs, not `s3:*`, `iam:*`, etc.

---

## 8. Teardown (after testing)

```bash
aws cloudformation delete-stack --stack-name "$STACK" --region $REGION
# Optional: destroy dev infra
cd infra && npx cdk destroy SandboxStack InfraStack
```

---

## Quick “everything OK” summary

| Layer | Verified by |
|-------|-------------|
| **Code** | Section 1 — tests pass |
| **Infra** | Section 2 — CDK deploy + outputs |
| **AI + sandbox** | Section 4.1 — code + synth + panels |
| **Orchestration + DB** | Section 5 — curl + DynamoDB |
| **Deploy** | Section 4.2 + 5 — CFN stack `CREATE_COMPLETE` |
| **Streaming** | Section 4 — pipeline steps + deploy log |
| **UI** | Section 4 — full flow in browser |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Generate 500 | Missing Anthropic key | Section 2.2 |
| WebSocket offline | Wrong `NEXT_PUBLIC_WEBSOCKET_URL` | Must match CDK `WebSocketUrl` |
| Approve 502 | Deploy Lambda invoke failed | CloudWatch → ApprovalLambda / DeployLambda |
| Stuck `deploying` | Deploy Lambda timeout/error | CloudWatch → DeployLambda; check `deploymentError` in DynamoDB |
| Empty diff | Sandbox synth failed | Check orchestration response `error` / sandbox stderr |
| `deploy_failed` | Template not S3-only | Phase 4 allowlist is S3-first; use S3 bucket prompts for demo |

More detail: [architecture.md](./architecture.md), [phases/](./phases/README.md).
