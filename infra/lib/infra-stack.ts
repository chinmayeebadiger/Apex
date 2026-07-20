import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
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

    const templatesBucket = new s3.Bucket(this, 'TemplatesBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const deploymentRole = new iam.Role(this, 'DeploymentRole', {
      assumedBy: new iam.ServicePrincipal('cloudformation.amazonaws.com'),
      description: 'Least-privilege role assumed by CloudFormation for Apex-generated stacks (S3-allowlisted)',
    });

    deploymentRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:CreateBucket',
        's3:DeleteBucket',
        's3:DeleteBucketPolicy',
        's3:DeleteObject',
        's3:DeleteObjectVersion',
        's3:GetBucket*',
        's3:GetEncryptionConfiguration',
        's3:GetObject',
        's3:ListBucket',
        's3:PutBucket*',
        's3:PutEncryptionConfiguration',
        's3:PutLifecycleConfiguration',
        's3:PutObject',
      ],
      resources: ['*'],
    }));

    const wsConnectLambda = new NodejsFunction(this, 'WebSocketConnectLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../lambda/ws-connect/index.ts'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
    });

    const wsDisconnectLambda = new NodejsFunction(this, 'WebSocketDisconnectLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../lambda/ws-disconnect/index.ts'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
    });

    const wsDefaultLambda = new NodejsFunction(this, 'WebSocketDefaultLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../lambda/ws-default/index.ts'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      bundling: {
        externalModules: ['@aws-sdk/client-apigatewaymanagementapi'],
      },
    });

    const webSocketApi = new apigatewayv2.WebSocketApi(this, 'PipelineWebSocketApi', {
      connectRouteOptions: {
        integration: new WebSocketLambdaIntegration('ConnectIntegration', wsConnectLambda),
      },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration('DisconnectIntegration', wsDisconnectLambda),
      },
      defaultRouteOptions: {
        integration: new WebSocketLambdaIntegration('DefaultIntegration', wsDefaultLambda),
      },
    });

    const webSocketStage = new apigatewayv2.WebSocketStage(this, 'PipelineWebSocketStage', {
      webSocketApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    const webSocketManagementEndpoint = `https://${webSocketApi.apiId}.execute-api.${this.region}.amazonaws.com/${webSocketStage.stageName}`;

    const webSocketConnectionPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['execute-api:ManageConnections'],
      resources: [
        `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.apiId}/${webSocketStage.stageName}/POST/@connections/*`,
      ],
    });

    wsConnectLambda.addToRolePolicy(webSocketConnectionPolicy);
    wsDefaultLambda.addToRolePolicy(webSocketConnectionPolicy);

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

    const deployLambda = new NodejsFunction(this, 'DeployLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../lambda/deploy/index.ts'),
      timeout: cdk.Duration.minutes(15),
      memorySize: 512,
      bundling: {
        externalModules: [
          '@aws-sdk/client-cloudformation',
          '@aws-sdk/client-dynamodb',
          '@aws-sdk/client-s3',
          '@aws-sdk/client-apigatewaymanagementapi',
          '@aws-sdk/util-dynamodb',
        ],
      },
      environment: {
        GENERATIONS_TABLE_NAME: generationsTable.tableName,
        TEMPLATES_BUCKET_NAME: templatesBucket.bucketName,
        WEBSOCKET_MANAGEMENT_ENDPOINT: webSocketManagementEndpoint,
        DEPLOYMENT_ROLE_ARN: deploymentRole.roleArn,
        AWS_ACCOUNT_ID: this.account,
      },
    });

    const approvalLambda = new NodejsFunction(this, 'ApprovalLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../lambda/approve/index.ts'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      bundling: {
        externalModules: [
          '@aws-sdk/client-dynamodb',
          '@aws-sdk/client-lambda',
          '@aws-sdk/util-dynamodb',
        ],
      },
      environment: {
        GENERATIONS_TABLE_NAME: generationsTable.tableName,
        DEPLOY_FUNCTION_NAME: deployLambda.functionName,
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
    generationsTable.grantReadWriteData(deployLambda);
    generationsTable.grantReadData(historyLambda);
    templatesBucket.grantReadWrite(deployLambda);
    anthropicApiKeySecret.grantRead(orchestrationLambda);
    deployLambda.grantInvoke(approvalLambda);

    webSocketApi.grantManageConnections(orchestrationLambda);
    webSocketApi.grantManageConnections(deployLambda);

    deployLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'cloudformation:CreateChangeSet',
        'cloudformation:DescribeChangeSet',
        'cloudformation:ExecuteChangeSet',
        'cloudformation:DescribeStacks',
        'cloudformation:DescribeStackEvents',
        'cloudformation:DeleteStack',
      ],
      resources: [
        `arn:aws:cloudformation:${this.region}:${this.account}:stack/apex-gen-*/*`,
        `arn:aws:cloudformation:${this.region}:${this.account}:changeSet/apex-cs-*/*`,
      ],
    }));

    deployLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['iam:PassRole'],
      resources: [deploymentRole.roleArn],
    }));

    templatesBucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowCloudFormationReadTemplates',
      principals: [new iam.ServicePrincipal('cloudformation.amazonaws.com')],
      actions: ['s3:GetObject'],
      resources: [templatesBucket.arnForObjects('templates/*')],
    }));

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

    new cdk.CfnOutput(this, 'TemplatesBucketName', {
      value: templatesBucket.bucketName,
      description: 'S3 bucket for CloudFormation templates',
    });

    new cdk.CfnOutput(this, 'DeployLambdaName', {
      value: deployLambda.functionName,
      description: 'Deploy Lambda that runs CloudFormation change sets',
    });

    new cdk.CfnOutput(this, 'DeploymentRoleArn', {
      value: deploymentRole.roleArn,
      description: 'IAM role assumed by CloudFormation for generated stacks',
    });
  }
}
