# Welcome to your CDK TypeScript project

This is a blank project for CDK development with TypeScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template

## Day 10-11 Changeset Module

The standalone changeset/diff/cost/security module lives in `../packages/changeset`.
It accepts synthesized CloudFormation JSON from the sandbox Lambda and returns
Zod-validated contracts for later orchestration wiring:

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

If no previous deployed template is supplied, the parser treats every resource
in the new template as `create`. If a previous template is supplied, matching is
by CloudFormation logical ID; logical ID renames appear as one deletion and one
creation.

Run it independently:

```bash
cd ../packages/changeset
npm install
npm run build
npm test
```
