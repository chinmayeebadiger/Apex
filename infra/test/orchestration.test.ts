import { InvokeCommand } from '@aws-sdk/client-lambda';
import { PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { createOrchestrationHandler } from '../lambda/orchestrate/index';

describe('orchestration handler', () => {
  const previousEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...previousEnv,
      GENERATIONS_TABLE_NAME: 'Generations',
      SANDBOX_FUNCTION_NAME: 'SandboxLambda',
    };
  });

  afterEach(() => {
    process.env = previousEnv;
  });

  test('runs generate, sandbox synth, analysis, and stores awaiting approval state', async () => {
    const writes: Record<string, unknown>[] = [];
    const dynamoDbClient = {
      send: jest.fn(async (command: unknown) => {
        if (command instanceof PutItemCommand) {
          const putCommand = command as PutItemCommand;
          writes.push(unmarshall(putCommand.input.Item ?? {}));
          return {};
        }

        return {
          Item: writes[1] ? marshall(writes[1], { removeUndefinedValues: true }) : undefined,
        };
      }),
    };

    const template = {
      Resources: {
        Bucket: {
          Type: 'AWS::S3::Bucket',
          Properties: {
            BucketEncryption: {
              ServerSideEncryptionConfiguration: [{
                ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' },
              }],
            },
            PublicAccessBlockConfiguration: {
              BlockPublicAcls: true,
              BlockPublicPolicy: true,
              IgnorePublicAcls: true,
              RestrictPublicBuckets: true,
            },
          },
        },
      },
    };

    const lambdaClient = {
      send: jest.fn(async (command: unknown) => {
        expect(command).toBeInstanceOf(InvokeCommand);
        return {
          Payload: Buffer.from(JSON.stringify({ success: true, template })),
        };
      }),
    };

    const handler = createOrchestrationHandler({
      dynamoDbClient: dynamoDbClient as never,
      lambdaClient: lambdaClient as never,
      anthropicFactory: () => ({} as never),
      getApiKey: async () => 'test-api-key',
      generate: async () => ({
        code: 'import * as cdk from "aws-cdk-lib";',
        explanation: 'Creates an encrypted S3 bucket.',
      }),
      analyze: async () => ({
        changeset: {
          resources: [{
            logicalId: 'Bucket',
            resourceType: 'AWS::S3::Bucket',
            action: 'create',
            properties: template.Resources.Bucket.Properties,
          }],
        },
        costEstimate: {
          resourceEstimates: [{
            logicalId: 'Bucket',
            monthlyCostUSD: 0.23,
            basis: 'Estimate: assumes 10 GB S3 Standard storage before request and data-transfer charges.',
          }],
          totalMonthlyCostUSD: 0.23,
        },
        securityScan: {
          flags: [],
        },
      }),
      now: () => new Date('2026-07-09T00:00:00.000Z'),
    });

    const result = await handler({
      conversationId: 'conversation-1',
      generationId: 'generation-1',
      request: 'Deploy an S3 bucket',
    });

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual(expect.objectContaining({
      status: 'awaiting_approval',
      code: 'import * as cdk from "aws-cdk-lib";',
      explanation: 'Creates an encrypted S3 bucket.',
      changeset: expect.any(Object),
      costEstimate: expect.any(Object),
      securityFlags: [],
      diff: expect.objectContaining({
        summary: expect.any(String),
        resources: expect.any(Array),
      }),
    }));
    expect(writes).toHaveLength(2);
    expect(writes[0]).toEqual(expect.objectContaining({
      conversationId: 'conversation-1',
      generationId: 'generation-1',
      originalRequest: 'Deploy an S3 bucket',
      status: 'generating',
    }));
    expect(writes[1]).toEqual(expect.objectContaining({
      conversationId: 'conversation-1',
      generationId: 'generation-1',
      originalRequest: 'Deploy an S3 bucket',
      generatedCdkCode: 'import * as cdk from "aws-cdk-lib";',
      status: 'awaiting_approval',
      changeset: expect.any(Object),
      costEstimate: expect.any(Object),
      securityFlags: [],
    }));
  });
});
