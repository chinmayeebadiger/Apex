import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const sandboxSourceDir = path.join(__dirname, '../lambda/sandbox');

const bundleSandboxLambda = (outputDir: string): void => {
  execSync('npm install && npx tsc', {
    cwd: sandboxSourceDir,
    stdio: 'inherit',
  });

  const distDir = path.join(sandboxSourceDir, 'dist');
  for (const entry of fs.readdirSync(distDir)) {
    fs.cpSync(path.join(distDir, entry), path.join(outputDir, entry), { recursive: true });
  }
};

export class SandboxStack extends cdk.Stack {
  public readonly sandboxFn: lambda.Function;

  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const sandboxLayer = new lambda.LayerVersion(this, 'SandboxLayer', {
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/sandbox-layer')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
    });

    const sandboxRole = new iam.Role(this, 'SandboxRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    const sandboxLogGroup = new logs.LogGroup(this, 'SandboxLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    sandboxRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: [`${sandboxLogGroup.logGroupArn}:*`],
    }));

    this.sandboxFn = new lambda.Function(this, 'SandboxLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(sandboxSourceDir, {
        bundling: {
          image: lambda.Runtime.NODEJS_20_X.bundlingImage,
          command: [
            'bash',
            '-c',
            'npm install && npx tsc && cp -r dist/* /asset-output/',
          ],
          local: {
            tryBundle(outputDir: string): boolean {
              bundleSandboxLambda(outputDir);
              return true;
            },
          },
        },
      }),
      layers: [sandboxLayer],
      role: sandboxRole,
      logGroup: sandboxLogGroup,
      timeout: cdk.Duration.seconds(60),
      memorySize: 1024,
      ephemeralStorageSize: cdk.Size.mebibytes(1024),
      environment: {
        CDK_DISABLE_VERSION_CHECK: '1',
        NODE_ENV: 'production',
      },
    });
  }
}
