import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';

export interface InfraStackProps extends cdk.StackProps {
  sandboxFn: lambda.IFunction;
}

export class InfraStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props: InfraStackProps) {
    super(scope, id, props);

    const anthropicApiKeySecret = new secretsmanager.Secret(this, 'AnthropicApiKeySecret', {
      secretName: 'anthropic-api-key',
    });

    const generationsTable = new dynamodb.Table(this, 'GenerationsTable', {
      partitionKey: {
        name: 'conversationId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'generationId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const wsConnectLambda = new NodejsFunction(this, 'WebSocketConnectLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../lambda/ws-connect/index.ts'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      bundling: {
        externalModules: ['@aws-sdk/client-apigatewaymanagementapi'],
      },
    });

    const wsDisconnectLambda = new NodejsFunction(this, 'WebSocketDisconnectLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../lambda/ws-disconnect/index.ts'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
    });

    const webSocketApi = new apigatewayv2.WebSocketApi(this, 'PipelineWebSocketApi', {
      connectRouteOptions: {
        integration: new WebSocketLambdaIntegration('ConnectIntegration', wsConnectLambda),
      },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration('DisconnectIntegration', wsDisconnectLambda),
      },
    });

    const webSocketStage = new apigatewayv2.WebSocketStage(this, 'PipelineWebSocketStage', {
      webSocketApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    const webSocketManagementEndpoint = `https://${webSocketApi.apiId}.execute-api.${this.region}.amazonaws.com/${webSocketStage.stageName}`;

    wsConnectLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['execute-api:ManageConnections'],
      resources: [
        `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.apiId}/${webSocketStage.stageName}/POST/@connections/*`,
      ],
    }));

    const generateLambda = new NodejsFunction(this, 'GenerateLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../lambda/generate/index.ts'),
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      bundling: {
        externalModules: ['@aws-sdk/client-lambda'],
      },
      environment: {
        ANTHROPIC_API_KEY_SECRET_ARN: anthropicApiKeySecret.secretArn,
        SANDBOX_FUNCTION_NAME: props.sandboxFn.functionName,
      },
    });

    const orchestrationLambda = new NodejsFunction(this, 'OrchestrationLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../lambda/orchestrate/index.ts'),
      timeout: cdk.Duration.seconds(120),
      memorySize: 768,
      bundling: {
        externalModules: [
          '@aws-sdk/client-lambda',
          '@aws-sdk/client-apigatewaymanagementapi',
        ],
      },
      environment: {
        ANTHROPIC_API_KEY_SECRET_ARN: anthropicApiKeySecret.secretArn,
        SANDBOX_FUNCTION_NAME: props.sandboxFn.functionName,
        GENERATIONS_TABLE_NAME: generationsTable.tableName,
        WEBSOCKET_MANAGEMENT_ENDPOINT: webSocketManagementEndpoint,
        SIMULATE_SLOW_STEPS: '0',
      },
    });

    const approvalLambda = new NodejsFunction(this, 'ApprovalLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../lambda/approve/index.ts'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        GENERATIONS_TABLE_NAME: generationsTable.tableName,
      },
    });

    const historyLambda = new NodejsFunction(this, 'HistoryLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../lambda/history/index.ts'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        GENERATIONS_TABLE_NAME: generationsTable.tableName,
      },
    });

    props.sandboxFn.grantInvoke(generateLambda);
    props.sandboxFn.grantInvoke(orchestrationLambda);
    generationsTable.grantReadWriteData(orchestrationLambda);
    generationsTable.grantReadWriteData(approvalLambda);
    generationsTable.grantReadData(historyLambda);
    anthropicApiKeySecret.grantRead(orchestrationLambda);

    webSocketApi.grantManageConnections(orchestrationLambda);

    generateLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'secretsmanager:GetSecretValue',
      ],
      resources: [anthropicApiKeySecret.secretArn],
    }));

    orchestrationLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'pricing:GetProducts',
      ],
      resources: ['*'],
    }));

    generateLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'aws-marketplace:Subscribe',
        'aws-marketplace:ViewSubscriptions',
      ],
      resources: ['*'],
    }));

    const fnUrl = generateLambda.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.POST],
        allowedHeaders: ['Content-Type'],
      },
    });

    const orchestrationFnUrl = orchestrationLambda.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.POST],
        allowedHeaders: ['Content-Type'],
      },
    });

    const api = new apigateway.RestApi(this, 'DevopsCopilotApi', {
      restApiName: 'DevOps Copilot API',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    const generate = api.root.addResource('generate');
    generate.addMethod('POST', new apigateway.LambdaIntegration(generateLambda));

    const orchestrate = api.root.addResource('orchestrate');
    orchestrate.addMethod('POST', new apigateway.LambdaIntegration(orchestrationLambda, {
      timeout: cdk.Duration.seconds(29),
    }));

    const approve = api.root.addResource('approve');
    approve.addMethod('POST', new apigateway.LambdaIntegration(approvalLambda));

    const history = api.root.addResource('history');
    history.addMethod('GET', new apigateway.LambdaIntegration(historyLambda));

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway URL (29s timeout limit)',
    });

    new cdk.CfnOutput(this, 'FunctionUrl', {
      value: fnUrl.url,
      description: 'Legacy generate Lambda Function URL (60s timeout)',
    });

    new cdk.CfnOutput(this, 'OrchestrationFunctionUrl', {
      value: orchestrationFnUrl.url,
      description: 'Orchestration Lambda Function URL (120s timeout — use this from the frontend)',
    });

    new cdk.CfnOutput(this, 'WebSocketUrl', {
      value: webSocketStage.url,
      description: 'WebSocket URL for live pipeline streaming',
    });

    new cdk.CfnOutput(this, 'OrchestrationLambdaName', {
      value: orchestrationLambda.functionName,
      description: 'Generation orchestration Lambda name',
    });

    new cdk.CfnOutput(this, 'GenerationsTableName', {
      value: generationsTable.tableName,
      description: 'DynamoDB table for generation state',
    });
  }
}
