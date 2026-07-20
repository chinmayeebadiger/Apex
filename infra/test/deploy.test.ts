import {
  CreateChangeSetCommand,
  DescribeChangeSetCommand,
  DescribeStackEventsCommand,
  DescribeStacksCommand,
  ExecuteChangeSetCommand,
} from '@aws-sdk/client-cloudformation';
import { GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { createDeployHandler } from '../lambda/deploy/index';
import type { DeployEventMessage } from '../lambda/shared/pipelineStream';

describe('deploy handler', () => {
  const previousEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...previousEnv,
      GENERATIONS_TABLE_NAME: 'Generations',
      TEMPLATES_BUCKET_NAME: 'templates-bucket',
      DEPLOYMENT_ROLE_ARN: 'arn:aws:iam::123456789012:role/DeploymentRole',
      AWS_REGION: 'ap-south-1',
      WEBSOCKET_MANAGEMENT_ENDPOINT: 'https://example.execute-api.ap-south-1.amazonaws.com/prod',
    };
  });

  afterEach(() => {
    process.env = previousEnv;
  });

  const baseItem = {
    conversationId: 'conversation-1',
    generationId: 'generationabcdef12',
    originalRequest: 'Create an S3 bucket',
    cloudFormationTemplate: {
      Resources: {
        Bucket: { Type: 'AWS::S3::Bucket' },
      },
    },
    status: 'deploying',
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
  };

  const createDynamo = (item = baseItem) => {
    const writes: Record<string, unknown>[] = [];
    let current = { ...item };

    return {
      writes,
      client: {
        send: jest.fn(async (command: unknown) => {
          if (command instanceof GetItemCommand) {
            return { Item: marshall(current, { removeUndefinedValues: true }) };
          }

          if (command instanceof PutItemCommand) {
            current = unmarshall((command as PutItemCommand).input.Item ?? {}) as typeof current;
            writes.push(current);
            return {};
          }

          return {};
        }),
      },
    };
  };

  test('deploys successfully via change set create + execute and streams events', async () => {
    const { client: dynamoDbClient, writes } = createDynamo();
    const emitted: DeployEventMessage[] = [];
    let describeStacksCalls = 0;
    let describeChangeSetCalls = 0;
    let describeEventsCalls = 0;

    const cloudFormationClient = {
      send: jest.fn(async (command: unknown) => {
        if (command instanceof DescribeStacksCommand) {
          describeStacksCalls += 1;
          if (describeStacksCalls === 1) {
            const error = new Error('Stack with id apex-gen-generati does not exist');
            throw error;
          }

          return {
            Stacks: [{
              StackId: 'arn:aws:cloudformation:ap-south-1:123456789012:stack/apex-gen-generati/abc',
              StackName: 'apex-gen-generati',
              StackStatus: 'CREATE_COMPLETE',
              Outputs: [{ OutputKey: 'BucketName', OutputValue: 'my-bucket' }],
            }],
          };
        }

        if (command instanceof CreateChangeSetCommand) {
          return {};
        }

        if (command instanceof DescribeChangeSetCommand) {
          describeChangeSetCalls += 1;
          return { Status: describeChangeSetCalls >= 1 ? 'CREATE_COMPLETE' : 'CREATE_IN_PROGRESS' };
        }

        if (command instanceof ExecuteChangeSetCommand) {
          return {};
        }

        if (command instanceof DescribeStackEventsCommand) {
          describeEventsCalls += 1;
          return {
            StackEvents: [{
              EventId: 'event-1',
              Timestamp: new Date('2026-07-20T00:02:00.000Z'),
              ResourceStatus: 'CREATE_COMPLETE',
              LogicalResourceId: 'Bucket',
              ResourceType: 'AWS::S3::Bucket',
              ResourceStatusReason: 'Resource creation Initiated',
            }],
          };
        }

        return {};
      }),
    };

    const s3Client = {
      send: jest.fn(async (command: unknown) => {
        if (command instanceof PutObjectCommand) {
          return {};
        }

        return {};
      }),
    };

    const handler = createDeployHandler({
      dynamoDbClient: dynamoDbClient as never,
      cloudFormationClient: cloudFormationClient as never,
      s3Client: s3Client as never,
      emitDeployEvent: async (_connectionId, message) => {
        emitted.push(message);
      },
      now: () => new Date('2026-07-20T00:01:00.000Z'),
      sleep: async () => undefined,
      pollIntervalMs: 1,
      maxPollMs: 10_000,
    });

    const result = await handler({
      conversationId: 'conversation-1',
      generationId: 'generationabcdef12',
      connectionId: 'conn-1',
    });

    expect(result).toEqual(expect.objectContaining({
      status: 'deployed',
      stackName: 'apex-gen-generati',
      outputs: { BucketName: 'my-bucket' },
    }));

    expect(s3Client.send).toHaveBeenCalledWith(expect.any(PutObjectCommand));
    expect(cloudFormationClient.send).toHaveBeenCalledWith(expect.any(CreateChangeSetCommand));
    expect(cloudFormationClient.send).toHaveBeenCalledWith(expect.any(ExecuteChangeSetCommand));
    expect(describeEventsCalls).toBeGreaterThan(0);

    const finalWrite = writes[writes.length - 1];
    expect(finalWrite).toEqual(expect.objectContaining({
      status: 'deployed',
      deploymentStackName: 'apex-gen-generati',
      deploymentOutputs: { BucketName: 'my-bucket' },
      templateS3Key: 'templates/generationabcdef12.template.json',
    }));

    expect(emitted.some((event) => event.phase === 'preparing')).toBe(true);
    expect(emitted.some((event) => event.phase === 'complete' && event.status === 'deployed')).toBe(true);
    expect(emitted.some((event) => event.phase === 'polling' && event.logicalId === 'Bucket')).toBe(true);
  });

  test('short-circuits to deployed when change set has no changes', async () => {
    const { client: dynamoDbClient, writes } = createDynamo();

    const cloudFormationClient = {
      send: jest.fn(async (command: unknown) => {
        if (command instanceof DescribeStacksCommand) {
          return {
            Stacks: [{
              StackId: 'arn:aws:cloudformation:ap-south-1:123456789012:stack/apex-gen-generati/abc',
              StackName: 'apex-gen-generati',
              StackStatus: 'CREATE_COMPLETE',
              Outputs: [{ OutputKey: 'BucketName', OutputValue: 'existing-bucket' }],
            }],
          };
        }

        if (command instanceof CreateChangeSetCommand) {
          return {};
        }

        if (command instanceof DescribeChangeSetCommand) {
          return {
            Status: 'FAILED',
            StatusReason: "The submitted information didn't contain changes.",
          };
        }

        return {};
      }),
    };

    const s3Client = {
      send: jest.fn(async () => ({})),
    };

    const handler = createDeployHandler({
      dynamoDbClient: dynamoDbClient as never,
      cloudFormationClient: cloudFormationClient as never,
      s3Client: s3Client as never,
      emitDeployEvent: async () => undefined,
      now: () => new Date('2026-07-20T00:01:00.000Z'),
      sleep: async () => undefined,
      pollIntervalMs: 1,
      maxPollMs: 10_000,
    });

    const result = await handler({
      conversationId: 'conversation-1',
      generationId: 'generationabcdef12',
    });

    expect(result).toEqual(expect.objectContaining({
      status: 'deployed',
      outputs: { BucketName: 'existing-bucket' },
    }));
    expect(cloudFormationClient.send).not.toHaveBeenCalledWith(expect.any(ExecuteChangeSetCommand));
    expect(writes[writes.length - 1]).toEqual(expect.objectContaining({
      status: 'deployed',
    }));
  });

  test('records deploy_failed on rollback and never leaves status stuck in deploying', async () => {
    const { client: dynamoDbClient, writes } = createDynamo();
    const emitted: DeployEventMessage[] = [];
    let describeStacksCalls = 0;

    const cloudFormationClient = {
      send: jest.fn(async (command: unknown) => {
        if (command instanceof DescribeStacksCommand) {
          describeStacksCalls += 1;
          if (describeStacksCalls === 1) {
            throw new Error('Stack with id apex-gen-generati does not exist');
          }

          return {
            Stacks: [{
              StackId: 'arn:aws:cloudformation:ap-south-1:123456789012:stack/apex-gen-generati/abc',
              StackName: 'apex-gen-generati',
              StackStatus: 'ROLLBACK_COMPLETE',
              StackStatusReason: 'Resource failed',
            }],
          };
        }

        if (command instanceof CreateChangeSetCommand || command instanceof ExecuteChangeSetCommand) {
          return {};
        }

        if (command instanceof DescribeChangeSetCommand) {
          return { Status: 'CREATE_COMPLETE' };
        }

        if (command instanceof DescribeStackEventsCommand) {
          return {
            StackEvents: [{
              EventId: 'fail-1',
              Timestamp: new Date('2026-07-20T00:02:00.000Z'),
              ResourceStatus: 'CREATE_FAILED',
              LogicalResourceId: 'Bucket',
              ResourceType: 'AWS::S3::Bucket',
              ResourceStatusReason: 'Bucket already exists',
            }],
          };
        }

        return {};
      }),
    };

    const handler = createDeployHandler({
      dynamoDbClient: dynamoDbClient as never,
      cloudFormationClient: cloudFormationClient as never,
      s3Client: { send: jest.fn(async () => ({})) } as never,
      emitDeployEvent: async (_connectionId, message) => {
        emitted.push(message);
      },
      now: () => new Date('2026-07-20T00:01:00.000Z'),
      sleep: async () => undefined,
      pollIntervalMs: 1,
      maxPollMs: 10_000,
    });

    const result = await handler({
      conversationId: 'conversation-1',
      generationId: 'generationabcdef12',
      connectionId: 'conn-1',
    });

    expect(result).toEqual(expect.objectContaining({ status: 'deploy_failed' }));
    expect(writes[writes.length - 1]).toEqual(expect.objectContaining({
      status: 'deploy_failed',
      deploymentError: 'Bucket already exists',
    }));
    expect(writes.every((write) => write.status !== 'deploying' || writes.indexOf(write) < writes.length - 1)).toBe(true);
    expect(emitted.some((event) => event.phase === 'rolling_back')).toBe(true);
    expect(emitted.some((event) => event.phase === 'failed' && event.status === 'deploy_failed')).toBe(true);
  });

  test('skips when generation is not in deploying status', async () => {
    const { client: dynamoDbClient } = createDynamo({
      ...baseItem,
      status: 'awaiting_approval',
    });

    const handler = createDeployHandler({
      dynamoDbClient: dynamoDbClient as never,
      cloudFormationClient: { send: jest.fn() } as never,
      s3Client: { send: jest.fn() } as never,
      emitDeployEvent: async () => undefined,
    });

    const result = await handler({
      conversationId: 'conversation-1',
      generationId: 'generationabcdef12',
    });

    expect(result).toEqual(expect.objectContaining({ skipped: true }));
  });
});
