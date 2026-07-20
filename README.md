# Apex — DevOps Copilot

Natural-language AWS infrastructure: type a sentence, get CDK + CloudFormation, review diff/cost/security, approve, and deploy for real in `ap-south-1`.

## Features

- **F1** — NL → AWS CDK (Claude via Anthropic API, key in Secrets Manager)
- **F2** — Sandboxed `cdk synth` (isolated Lambda, zero AWS API access)
- **F3** — Changeset diff, monthly cost estimate, security scan
- **F4** — Live CloudFormation deploy logs over WebSocket
- **F5** — Deployment history + one-click re-run

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full diagram and data flow.

```text
UI → OrchestrationLambda → Claude + Sandbox → DynamoDB (awaiting_approval)
UI → Approve → DeployLambda → S3 template + CFN change set → WebSocket deploy_event
```

## Prerequisites

- Node.js 20+
- AWS CLI configured for account deploy to `ap-south-1`
- Anthropic API key stored as Secrets Manager secret `anthropic-api-key` (created by the stack; put the value after first deploy)

## Deploy backend

From the repo root:

```bash
./scripts/build-sandbox-layer.sh
cd infra
npm install
npm run deploy
```

Note CDK outputs:

| Output | Use |
|--------|-----|
| `OrchestrationFunctionUrl` | Frontend generate endpoint |
| `ApiUrl` | Approve + history (`/approve`, `/history`) |
| `WebSocketUrl` | Live pipeline + deploy events |
| `TemplatesBucketName` | CFN templates storage |
| `DeployLambdaName` / `DeploymentRoleArn` | Deploy path diagnostics |

## Configure frontend

```bash
cd frontend
cp .env.example .env.local
npm install
```

Fill `.env.local` from CDK outputs:

```env
NEXT_PUBLIC_ORCHESTRATION_URL=<OrchestrationFunctionUrl>
NEXT_PUBLIC_API_GATEWAY_URL=<ApiUrl>
NEXT_PUBLIC_WEBSOCKET_URL=<WebSocketUrl>
```

```bash
npm run dev
```

Open http://localhost:3000

## Demo flow

1. Prompt: **Create a private encrypted S3 bucket**
2. Wait for sandbox synth + diff / cost / security panels
3. Click **Approve & Deploy**
4. Watch live CFN events in the deploy log terminal
5. Confirm **deployed** status, stack outputs, and the stack in the CloudFormation console
6. Use **Re-run generation** to create a new generation/stack from the same prompt

Detailed script: [docs/DEMO.md](docs/DEMO.md)

## Tests

```bash
cd packages/changeset && npm run build && npm test
cd infra && npm run build && npm test
cd frontend && npm run lint && npm run build
```

## Safety notes

- CloudFormation runs under a dedicated **DeploymentRole** allowlisted to S3 (demo scope)
- Approve is required before any real deploy
- Generated stacks are named `apex-gen-<generationId-first-8>`
- Tear down demo stacks: `aws cloudformation delete-stack --stack-name apex-gen-<id> --region ap-south-1`

## Docs

| Doc | Purpose |
|-----|---------|
| **[docs/VERIFICATION.md](docs/VERIFICATION.md)** | **Start here** — step-by-step “is everything working?” |
| [docs/LAYERS.md](docs/LAYERS.md) | Four architecture layers explained |
| [docs/phases/README.md](docs/phases/README.md) | Phase 1–4 guides (what each week built) |
| [context.md](context.md) | PRD |
| [docs/architecture.md](docs/architecture.md) | Diagrams + deploy path |
| [docs/DEMO.md](docs/DEMO.md) | 90-second demo script |
| [CODE_GUIDE.md](CODE_GUIDE.md) | Code walkthrough with line numbers |
| [progress.md](progress.md) | Implementation status |
| [docs/phase-plans/phase-04-plan.md](docs/phase-plans/phase-04-plan.md) | Phase 4 plan |
| [docs/phase-reviews/phase-01-review.md](docs/phase-reviews/phase-01-review.md) | Phase 4 review sign-off |
