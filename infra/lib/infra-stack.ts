import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';

export class InfraStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const generateLambda = new NodejsFunction(this, 'GenerateLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../lambda/generate/index.ts'),
      timeout: cdk.Duration.seconds(30),
    });

    // Grant this Lambda permission to call Bedrock
    generateLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:GetInferenceProfile',
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
      ],
      resources: [
        'arn:aws:bedrock:ap-south-1:437040615496:inference-profile/global.anthropic.claude-opus-4-5-20251101-v1:0',
        'arn:aws:bedrock:*::foundation-model/anthropic.claude-opus-4-5-20251101-v1:0',
      ],
    }));

    generateLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'aws-marketplace:Subscribe',
        'aws-marketplace:ViewSubscriptions',
      ],
      resources: ['*'],
    }));

    const api = new apigateway.RestApi(this, 'DevopsCopilotApi', {
      restApiName: 'DevOps Copilot API',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    const generate = api.root.addResource('generate');
    generate.addMethod('POST', new apigateway.LambdaIntegration(generateLambda));

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway URL',
    });
  }
}
