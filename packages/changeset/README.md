# Changeset Module

Standalone Day 10-11 module for parsing synthesized CloudFormation templates into validated changesets, rendering frontend diff data, estimating rough monthly cost, and scanning basic IAM/security issues.

## Contract

`parseChangeset(nextTemplate, previousTemplate?)` accepts a CDK-synthesized CloudFormation template and an optional previous deployed template. If the previous template is omitted, every resource in the next template is treated as `create`.

```ts
type Changeset = {
  resources: Array<{
    logicalId: string;
    resourceType: string;
    action: 'create' | 'modify' | 'delete';
    properties: Record<string, unknown>;
  }>;
};
```

All outputs are validated with Zod before returning:

- `ChangesetSchema`
- `CostEstimateSchema`
- `SecurityScanSchema`
- `DiffRenderModelSchema`

## Assumption

Previous-template diffing assumes both inputs are full synthesized CloudFormation templates keyed by stable logical IDs. If a CDK logical ID changes between versions, the parser will report one deletion and one creation rather than a rename.

## Commands

```bash
npm install
npm run build
npm test
```

## Cost Estimates

`estimateChangesetCost` uses the AWS SDK v3 Pricing client for service/region metadata lookups and caches those lookups in memory for the lifetime of the estimator instance. Monthly dollar values are intentionally heuristic for usage-based services:

- Lambda: no standing charge, usage varies by requests, memory, and duration.
- DynamoDB: assumes a small on-demand table.
- S3: assumes 10 GB S3 Standard storage.
- API Gateway: assumes 1 million monthly requests.

The `basis` field marks these as estimates so the frontend can explain them clearly.
