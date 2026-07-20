import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { InfraStack } from '../lib/infra-stack';

describe('deploy infrastructure', () => {
  const createTemplate = () => {
    const app = new cdk.App();
    const sandboxStack = new cdk.Stack(app, 'SandboxImportStack', {
      env: {
        account: '123456789012',
        region: 'ap-south-1',
      },
    });
    const sandboxFn = lambda.Function.fromFunctionArn(
      sandboxStack,
      'ImportedSandboxFn',
      'arn:aws:lambda:ap-south-1:123456789012:function:SandboxLambda',
    );

    const stack = new InfraStack(app, 'TestInfraStack', {
      env: {
        account: '123456789012',
        region: 'ap-south-1',
      },
      sandboxFn,
    });

    return Template.fromStack(stack);
  };

  test('creates TemplatesBucket with encryption, public access block, and auto-delete', () => {
    const template = createTemplate();

    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: Match.arrayWith([
          Match.objectLike({
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: 'AES256',
            },
          }),
        ]),
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  test('creates DeploymentRole assumed by CloudFormation with S3 allowlist', () => {
    const template = createTemplate();

    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Principal: { Service: 'cloudformation.amazonaws.com' },
            Action: 'sts:AssumeRole',
          }),
        ]),
      },
    });

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              's3:CreateBucket',
              's3:DeleteBucket',
              's3:PutBucket*',
            ]),
            Effect: 'Allow',
            Resource: '*',
          }),
        ]),
      },
    });
  });

  test('creates DeployLambda with required env vars and PassRole scoped to DeploymentRole', () => {
    const template = createTemplate();

    template.hasResourceProperties('AWS::Lambda::Function', {
      Timeout: 900,
      MemorySize: 512,
      Environment: {
        Variables: Match.objectLike({
          TEMPLATES_BUCKET_NAME: Match.anyValue(),
          DEPLOYMENT_ROLE_ARN: Match.anyValue(),
          WEBSOCKET_MANAGEMENT_ENDPOINT: Match.anyValue(),
          GENERATIONS_TABLE_NAME: Match.anyValue(),
          AWS_ACCOUNT_ID: '123456789012',
        }),
      },
    });

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'iam:PassRole',
            Effect: 'Allow',
            Resource: Match.anyValue(),
          }),
        ]),
      },
    });
  });

  test('approval Lambda can invoke DeployLambda and has DEPLOY_FUNCTION_NAME', () => {
    const template = createTemplate();

    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          DEPLOY_FUNCTION_NAME: Match.anyValue(),
          GENERATIONS_TABLE_NAME: Match.anyValue(),
        }),
      },
    });

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'lambda:InvokeFunction',
            Effect: 'Allow',
          }),
        ]),
      },
    });
  });

  test('emits TemplatesBucketName, DeployLambdaName, and DeploymentRoleArn outputs', () => {
    const template = createTemplate();

    template.hasOutput('TemplatesBucketName', {});
    template.hasOutput('DeployLambdaName', {});
    template.hasOutput('DeploymentRoleArn', {});
  });
});
