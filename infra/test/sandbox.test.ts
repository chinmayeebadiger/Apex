import {
  detectMissingRelativeImports,
  resolveSandboxEntryPoint,
} from '../lambda/sandbox/workspace';

describe('sandbox workspace helpers', () => {
  test('detects missing relative imports in single-file output', () => {
    const code = `
      import { MyStack } from '../lib/my-stack';
      const app = new cdk.App();
    `;

    expect(detectMissingRelativeImports(code)).toEqual(['../lib/my-stack']);
  });

  test('allows relative imports when companion files are provided', () => {
    const code = `
      import { MyStack } from './lib/my-stack';
      const app = new cdk.App();
    `;

    expect(detectMissingRelativeImports(code, {
      'lib/my-stack.ts': 'export class MyStack {}',
    })).toEqual([]);
  });

  test('allows bin/lib layout when companion files are provided', () => {
    const code = `
      import { MyStack } from '../lib/my-stack';
      const app = new cdk.App();
    `;

    expect(detectMissingRelativeImports(code, {
      'bin/app.ts': code,
      'lib/my-stack.ts': 'export class MyStack {}',
    })).toEqual([]);
  });

  test('does not false-positive on self-contained single-file output', () => {
    const code = `
      import * as cdk from 'aws-cdk-lib';
      import { Construct } from 'constructs';
      import * as s3 from 'aws-cdk-lib/aws-s3';

      class BucketStack extends cdk.Stack {
        constructor(scope: Construct, id: string) {
          super(scope, id);
          new s3.Bucket(this, 'Bucket');
        }
      }

      const app = new cdk.App();
      new BucketStack(app, 'BucketStack');
      app.synth();
    `;

    expect(detectMissingRelativeImports(code)).toEqual([]);
  });

  test('prefers bin/app.ts as the synth entry point', () => {
    expect(resolveSandboxEntryPoint('ignored', {
      'bin/app.ts': 'entry',
      'lib/stack.ts': 'stack',
    })).toBe('bin/app.ts');
  });

  test('defaults to app.ts when no files map is provided', () => {
    expect(resolveSandboxEntryPoint('entry')).toBe('app.ts');
  });
});
