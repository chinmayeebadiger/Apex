# DevOps Copilot — Revised PRD v4

**NL-to-AWS Infrastructure**

A focused, first-AWS-project edition — production-grade AI tool that turns plain English into deployable AWS infrastructure, with live previews and one-click deploys.

| Build Time | Approach | AWS Services | AI Layer | Complexity |
|------------|----------|--------------|----------|------------|
| 4 Weeks | First-Timer Friendly | 4 Core Services | Direct Anthropic API + CDK | Mid-Senior Level |

**Revised Edition v4 · Scoped for first-time AWS builders · June 2026**

---

## 1. What Changed & Why (v4)

v3 routed the AI layer through AWS Bedrock. In practice, Bedrock model access turned out to be the single biggest blocker — AWS Marketplace subscription failures (`INVALID_PAYMENT_INSTRUMENT`, payment instrument verification issues common to India-billed AWS accounts) made the core feature impossible to test reliably. v4 removes that dependency entirely.

| Change | What it means |
|--------|---------------|
| **REMOVED — AWS Bedrock** | No Marketplace subscription, no model-access request flow, no Bedrock IAM permissions. |
| **ADDED — Direct Anthropic API** | The orchestration Lambda calls `api.anthropic.com` directly using the Anthropic TypeScript SDK and an API key. |
| **ADDED — Secrets Manager** | The Anthropic API key is stored in AWS Secrets Manager, not as a plaintext Lambda environment variable. |
| **CHANGED — AWS service count** | 5 core services → 4 core services (Lambda, API Gateway, DynamoDB, S3). The AI layer is external to AWS. |
| **UNCHANGED** | Sandboxed validation, live diff + cost preview, WebSocket streaming, deployment history. |

**Key insight:** Removing Bedrock doesn't weaken the resume story — it removes a fragile dependency and replaces it with a common production pattern: backend calling a model provider's API directly, with secrets management, retry logic, and rate limiting.

---

## 2. Executive Summary

DevOps Copilot is an AI-powered developer tool that translates plain English instructions into production-ready AWS infrastructure code. A developer types a single sentence — *"Deploy my Node.js app with a load balancer across 2 servers"* — and the system generates AWS CDK code, validates it in a sandboxed environment, shows a live diff of every resource that will be created or modified, estimates the monthly cost, and optionally deploys to AWS with a single approval click.

| | |
|---|---|
| **What it is** | An AI that turns English sentences into AWS infrastructure code |
| **Core tech** | Direct Anthropic API (Claude) + CDK + Lambda + WebSockets |
| **Build time** | 4 weeks with AI coding tools |
| **Resume signal** | LLM integration, real-time systems, cloud infra — all in one project |

---

## 3. Core Features

Five features. Build them in order — each one works without the next.

### F1 — Natural Language to CDK Code

The user types any infrastructure request in plain English. Claude generates production-ready AWS CDK TypeScript code following AWS best practices — least-privilege IAM, multi-AZ by default, encryption at rest.

- Supports ECS, Lambda, RDS, S3, API Gateway, VPC, ALB, and more
- Generates TypeScript CDK following the AWS Well-Architected Framework
- Handles ambiguous requests by asking clarifying questions
- Remembers conversation context for follow-up refinements

### F2 — Sandboxed Validation

Before any code runs against your real AWS account, it executes in an isolated Lambda environment.

- Runs `cdk synth` in isolated Lambda — zero risk to your AWS account
- Flags overly permissive IAM policies (e.g. `Action: '*'`)
- Detects public S3 buckets, unencrypted RDS, open security groups
- Returns pass/fail for each check with plain-English explanations

### F3 — Live Diff Preview + Cost Estimate

- Colour-coded diff: green = create, blue = modify, red = delete
- Resource count summary: *"4 new resources, 2 existing, 0 deletions"*
- Monthly cost estimate using AWS Pricing API
- One-click approve or cancel — nothing deploys without explicit approval

### F4 — Real-Time Streaming Pipeline

- WebSocket connection streams step-by-step progress to the UI
- Each pipeline step shows status, duration, and truncated output
- Error messages surface immediately with context and suggested fixes
- Live deployment logs stream in real time (Week 4 / stretch)

### F5 — Deployment History & Re-run

- Full history in DynamoDB: code, changeset, cost, timestamp
- Re-run any past generation with one click
- Rollback support: redeploy the previous version of any stack (stretch)

---

## 4. System Architecture

Four layers. Data flows top-to-bottom on the happy path, with real-time status streaming back to the UI via WebSocket at every step.

| Layer | Description |
|-------|-------------|
| **1 · User Interface** | Next.js 15 (App Router) frontend. Chat interface with real-time pipeline viewer, code diff renderer, and deployment history sidebar. WebSocket connection to the backend. Deployed on Vercel. |
| **2 · Edge / API** | AWS API Gateway — REST for standard requests, WebSocket API for real-time streaming. Simple API key authentication for v1 (Cognito as stretch goal). |
| **3 · Orchestration Lambda** | Single Lambda drives the pipeline: (1) fetch Anthropic API key from Secrets Manager, (2) call Anthropic API, (3) run sandbox validation, (4) compute cdk synth + diff, (5) emit each step via WebSocket, (6) wait for user approval, (7) trigger CloudFormation deploy. DynamoDB stores conversation state and generation history. |
| **4 · Sandbox + Storage** | Isolated Lambda runs CDK CLI (`synth`, `diff`) with zero production AWS permissions. CloudFormation templates stored in S3. DynamoDB stores history. AWS Pricing API provides cost estimates. |

### Data Flow Summary

1. User types: *"Deploy a Node.js app behind an ALB with Fargate"*
2. API Gateway receives the message, validates the API key
3. Orchestration Lambda starts — writes initial state to DynamoDB
4. Lambda retrieves Anthropic API key from Secrets Manager (cached across warm invocations)
5. Claude generates CDK TypeScript code
6. Sandbox Lambda runs `cdk synth` in an isolated environment
7. AWS Pricing API computes cost estimate; changeset is parsed
8. Result streams back via WebSocket: code, diff, cost, security flags
9. User reviews and clicks "Approve & Deploy"
10. Orchestration Lambda resumes; CloudFormation executes the changeset
11. Deployment logs stream live; final status written to DynamoDB

**Networking note:** The orchestration Lambda must reach the public internet for `api.anthropic.com`. Default (no VPC) works with no extra configuration.

---

## 5. AWS Services — The 4 You Actually Need

| Service | Category | Purpose |
|---------|----------|---------|
| **AWS Lambda** | Compute | Orchestration Lambda + sandboxed CDK execution environment |
| **API Gateway + WebSocket** | Networking | REST + persistent WebSocket for live streaming |
| **Amazon DynamoDB** | Storage | Conversation history, generation records, changesets, cost estimates |
| **Amazon S3** | Storage | Generated CloudFormation templates and CDK output artifacts |
| **AWS Secrets Manager** *(supporting)* | Security | Anthropic API key storage |
| **AWS CloudFormation** *(Stretch — Week 4)* | Deployment | Executes approved infrastructure changesets |
| **AWS Cognito** *(Stretch)* | Auth | User authentication with hosted UI and JWT |

**AI Layer (outside AWS):** Anthropic API via official TypeScript SDK. Model: `claude-sonnet-4-6`.

---

## 6. Tech Stack

### Frontend
- Next.js 15 (App Router), TypeScript, Tailwind CSS
- xterm.js — terminal emulator for live deployment log streams

### Backend / API
- Node.js / TypeScript — Lambda functions
- AWS CDK (TypeScript) — DevOps Copilot's own infra
- AWS SDK v3 — Lambda, DynamoDB, S3, Secrets Manager, API Gateway Management
- Zod — runtime schema validation for LLM-generated CDK output

### AI / ML
- `@anthropic-ai/sdk` — direct Claude API integration
- Prompt engineering — structured system prompts with CDK examples
- Output validation — JSON Schema + Zod validate all LLM outputs

### Infrastructure
- AWS CDK, AWS Secrets Manager, Vercel, Amazon CloudWatch

---

## 7. 4-Week Build Plan

Each week has one clear goal. Assumes 15–20 hours per week.

### Week 1 — Get the AI writing real CDK code

**Day 1–2: Project setup**
- Initialise Next.js 15 project with TypeScript and Tailwind
- Set up AWS CDK project for DevOps Copilot's own infrastructure
- Configure AWS credentials, regions, and environment variables
- Deploy a skeleton API Gateway + Lambda stack — confirm it works

**Day 3–4: Anthropic API integration**
- Get Anthropic API key; store in AWS Secrets Manager
- Install `@anthropic-ai/sdk`; write Lambda helper that fetches key and caches it
- Design system prompt: role, CDK examples, output format (JSON)
- Build prompt function — calls `anthropic.messages.create()`, returns CDK code
- Test with 10 common requests: S3, Lambda, ECS, RDS, API Gateway
- Add basic retry logic for rate limits / transient API errors

**Day 5–7: Basic UI**
- Build chat interface — message input, response display
- Add syntax highlighting for generated CDK code (Prism.js / Shiki)
- Basic API route that calls the orchestration Lambda and returns generated code
- **Goal:** type a sentence, see real CDK code on screen

### Week 2 — Make it safe: sandboxing and validation

**Day 8–9: Lambda sandbox**
- Create isolated Lambda with CDK CLI installed
- Lambda receives generated CDK code, runs `cdk synth`, returns CloudFormation template
- Strict IAM — sandbox Lambda has zero production AWS permissions
- Add timeout and memory limits to prevent runaway executions

**Day 10–11: Diff + cost + basic security**
- Parse CloudFormation template into a structured changeset
- Render colour-coded diff in the UI (green/blue/red resources)
- AWS Pricing API integration for monthly cost estimates
- Basic IAM policy scan: flag `Action:'*'` and `Resource:'*'`

**Day 12–14: Orchestration Lambda + DynamoDB**
- Build orchestration Lambda: Generate → Validate → Diff → Await Approval
- Add error handling and retry logic for transient Anthropic API failures
- Connect DynamoDB for workflow state + generation history
- Test the full workflow end-to-end (without WebSockets yet)

### Week 3 — Make it feel live: streaming and polish

- Set up API Gateway WebSocket API with connect/disconnect/message routes
- Each orchestration step pushes progress to the WebSocket connection
- Update UI to receive WebSocket messages and animate pipeline steps
- Test streaming with simulated slow steps

**Day 17–19: UI polish + history**
- Refine chat interface — timestamps, copy code button, follow-up prompts
- Build generation history sidebar with search and filter
- Add cost estimate card and security scan results panel
- Mobile-responsive layout

**Day 20–21: Reliability + error handling**
- Rate limiting on API Gateway
- Improve LLM output validation — handle malformed CDK code gracefully
- Handle Anthropic 429/529 with backoff
- User-friendly error messages for all failure states
- Write tests for orchestration Lambda core paths

### Week 4 — Real deployment + ship it

**Day 22–24: CloudFormation deploy**
- Add deploy step to orchestration Lambda
- CloudFormation CreateChangeSet + ExecuteChangeSet
- Stream CloudFormation events back via WebSocket
- Test with real S3 bucket deployment
- Automatic rollback on failure

**Day 25–26: Auth upgrade (optional)**
- AWS Cognito user pool
- Replace API key auth with JWT tokens
- Scope generations to Cognito identity

**Day 27–28: Ship it**
- Deploy full stack to production via CDK
- Comprehensive README with architecture diagram, demo GIF, setup guide
- 90-second demo video
- Push to GitHub with clean commit history

---

## 8. Success Metrics

### Technical
- CDK code accuracy: 90%+ pass `cdk synth` on first attempt
- End-to-end latency: request to diff preview under 15 seconds
- Streaming reliability: WebSocket maintained for 99%+ of pipeline sessions
- Error recovery: all error states surface actionable messages

### Product
- 15+ AWS services supported at launch
- Conversation follow-up: 3+ follow-up turns
- Mobile usable: core flow works on phone-sized screen
- History re-run: one-click re-run of past generations

---

## 9. Resume & Hiring Impact

- **LLM integration beyond chatbots** — sandboxed `cdk synth` + Zod validation + retry loop
- **Direct API integration** — Secrets Manager, retry/backoff, no Bedrock overhead
- **AWS architecture depth** — 4 AWS services wired with purpose
- **Real-time systems** — WebSocket reconnect with DynamoDB state store
- **System design thinking** — CloudFormation rollback, plain-English error surfacing
- **Full-stack ownership** — Next.js, Lambda, CDK, Anthropic integration

---

## 10. Stretch Goals (Post-Launch)

| Feature | Priority | Description |
|---------|----------|-------------|
| AWS Cognito auth | HIGH | Replace API key auth |
| Real CloudFormation deploy | HIGH | Actual deployments |
| Slack bot interface | MED | `/deploy` from Slack |
| Auto-generated runbooks | MED | Plain-English runbook after each generation |
| GitHub Actions integration | MED | CI/CD YAML on push to main |
| Prompt caching | MED | Anthropic prompt caching for system prompt |
| Cost anomaly detection | LOW | Cost Explorer alerts |
| Multi-account support | LOW | Cross-account/region deployments |

---

## 11. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| LLM generates invalid CDK code | High | Medium | Zod validation, sandbox `cdk synth`, retry loop (max 3) |
| Anthropic API key exposure | Medium | High | Secrets Manager only, scoped IAM, rotate if exposed |
| Anthropic API rate limits / cost | Medium | Medium | Console usage limits, API Gateway rate limiting, caching |
| AWS costs spiral during dev | Medium | Low | Billing alerts, `cdk destroy`, LocalStack |
| WebSocket drops mid-pipeline | Low | Medium | DynamoDB state store, client reconnect with last-seen step |
| CloudFormation deploy fails | Low | High | Change sets, automatic rollback, plain-English errors |
| CDK CLI version conflicts in Lambda | Medium | Medium | Pin CDK version in sandbox layer |
| Scope creep | High | High | Stick to weekly goals; F1 + F2 are non-optional |

---

*DevOps Copilot Revised PRD v4 · Direct API Edition · June 2026*
