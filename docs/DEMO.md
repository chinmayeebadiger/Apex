# 90-second demo script

## Goal

Show NL → validated CDK → approve → real CloudFormation deploy with live logs.

## Setup (before recording)

1. Backend deployed (`cd infra && npm run deploy`).
2. Frontend `.env.local` has `NEXT_PUBLIC_ORCHESTRATION_URL`, `NEXT_PUBLIC_API_GATEWAY_URL`, `NEXT_PUBLIC_WEBSOCKET_URL`.
3. Header shows **Pipeline stream connected**.
4. Close unrelated browser tabs; use a clean workspace (**New** in the sidebar).

## Script (~90s)

| Time | Action | Narration |
|------|--------|-----------|
| 0:00–0:10 | Open Apex, click the S3 example (or paste prompt) | “Apex turns plain English into AWS CDK.” |
| 0:10–0:35 | Click **Generate**, watch pipeline steps | “Claude writes CDK, sandbox runs `cdk synth`, then we analyze diff, cost, and security.” |
| 0:35–0:50 | Point at Diff / Cost / Security panels | “Nothing deploys until approval. Security scan is clean for a private encrypted bucket.” |
| 0:50–1:05 | Click **Approve & Deploy** | “Approve kicks off a real CloudFormation change set under a least-privilege deploy role.” |
| 1:05–1:25 | Show deploy log terminal filling with events | “Live stack events stream over the same WebSocket.” |
| 1:25–1:30 | Show **deployed** + outputs + optional CFN console link | “Stack is live in ap-south-1. Re-run creates a new generation and stack.” |

**Suggested prompt:** `Create a private encrypted S3 bucket`

## Recording tips

- Capture browser only (or browser + short terminal teardown at the end).
- If deploy is slow, keep the camera on the log panel — motion sells the realtime story.
- Optional curl fallback if UI is flaky (see Phase 4 plan §12).

## Teardown after demo

```bash
aws cloudformation delete-stack \
  --stack-name "apex-gen-<first-8-of-generationId>" \
  --region ap-south-1
```

## Failure path (optional second take)

Force a bad template / unsupported resource → expect `deploy_failed`, rollback, and a record that is **not** stuck in `deploying`. Use **Retry deploy** or **Re-run generation**.
