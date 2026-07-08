#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { InfraStack } from '../lib/infra-stack';
import { SandboxStack } from '../lib/sandbox-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: 'ap-south-1',
};

const sandboxStack = new SandboxStack(app, 'SandboxStack', { env });
new InfraStack(app, 'InfraStack', {
  env,
  sandboxFn: sandboxStack.sandboxFn,
});
