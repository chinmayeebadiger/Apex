import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { InfraStack } from '../lib/infra-stack';

describe('orchestration infrastructure', () => {
  test('creates on-demand generation state table and scoped orchestration permissions', () => {
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
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: [
        { AttributeName: 'conversationId', KeyType: 'HASH' },
        { AttributeName: 'generationId', KeyType: 'RANGE' },
      ],
      BillingMode: 'PAY_PER_REQUEST',
    });

    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.handler',
      Runtime: 'nodejs20.x',
      Environment: {
        Variables: {
          SANDBOX_FUNCTION_NAME: 'SandboxLambda',
        },
      },
    });

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'lambda:InvokeFunction',
            Effect: 'Allow',
            Resource: Match.arrayWith([
              'arn:aws:lambda:ap-south-1:123456789012:function:SandboxLambda',
            ]),
          }),
        ]),
      },
    });
  });
});
