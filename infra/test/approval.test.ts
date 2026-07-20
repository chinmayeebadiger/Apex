import { GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { InvokeCommand } from '@aws-sdk/client-lambda';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { createApprovalHandler } from '../lambda/approve/index';

describe('approval handler', () => {
  const previousEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...previousEnv,
      GENERATIONS_TABLE_NAME: 'Generations',
      DEPLOY_FUNCTION_NAME: 'DeployLambda',
    };
  });

  afterEach(() => {
    process.env = previousEnv;
  });

  test('approves a generation by setting deploying and async-invoking deploy', async () => {
    const stored = {
      conversationId: 'conversation-1',
      generationId: 'generation-1',
      originalRequest: 'Deploy an S3 bucket',
      generatedCdkCode: 'code',
      status: 'awaiting_approval',
      createdAt: '2026-07-09T00:00:00.000Z',
      updatedAt: '2026-07-09T00:00:00.000Z',
    };

    const writes: Record<string, unknown>[] = [];
    const dynamoDbClient = {
      send: jest.fn(async (command: unknown) => {
        if (command instanceof GetItemCommand) {
          return { Item: marshall(stored) };
        }

        if (command instanceof PutItemCommand) {
          writes.push(unmarshall((command as PutItemCommand).input.Item ?? {}));
          return {};
        }

        return {};
      }),
    };

    const lambdaClient = {
      send: jest.fn(async (command: unknown) => {
        if (command instanceof InvokeCommand) {
          return {};
        }

        return {};
      }),
    };

    const handler = createApprovalHandler({
      dynamoDbClient: dynamoDbClient as never,
      lambdaClient: lambdaClient as never,
      now: () => new Date('2026-07-09T00:01:00.000Z'),
    });

    const result = await handler({
      conversationId: 'conversation-1',
      generationId: 'generation-1',
      action: 'approve',
      connectionId: 'conn-1',
    });

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual(expect.objectContaining({
      status: 'deploying',
    }));
    expect(writes[0]).toEqual(expect.objectContaining({
      status: 'deploying',
    }));

    expect(lambdaClient.send).toHaveBeenCalledTimes(1);
    const invokeCommand = lambdaClient.send.mock.calls[0][0] as InvokeCommand;
    expect(invokeCommand).toBeInstanceOf(InvokeCommand);
    expect(invokeCommand.input).toEqual(expect.objectContaining({
      FunctionName: 'DeployLambda',
      InvocationType: 'Event',
    }));
    expect(JSON.parse(Buffer.from(invokeCommand.input.Payload as Uint8Array).toString())).toEqual({
      conversationId: 'conversation-1',
      generationId: 'generation-1',
      connectionId: 'conn-1',
    });
  });

  test('reverts to awaiting_approval when deploy invoke fails', async () => {
    const stored = {
      conversationId: 'conversation-1',
      generationId: 'generation-1',
      originalRequest: 'Deploy an S3 bucket',
      status: 'awaiting_approval',
      createdAt: '2026-07-09T00:00:00.000Z',
      updatedAt: '2026-07-09T00:00:00.000Z',
    };

    const writes: Record<string, unknown>[] = [];
    const dynamoDbClient = {
      send: jest.fn(async (command: unknown) => {
        if (command instanceof GetItemCommand) {
          return { Item: marshall(stored) };
        }

        if (command instanceof PutItemCommand) {
          writes.push(unmarshall((command as PutItemCommand).input.Item ?? {}));
          return {};
        }

        return {};
      }),
    };

    const lambdaClient = {
      send: jest.fn(async () => {
        throw new Error('invoke failed');
      }),
    };

    const handler = createApprovalHandler({
      dynamoDbClient: dynamoDbClient as never,
      lambdaClient: lambdaClient as never,
      now: () => new Date('2026-07-09T00:01:00.000Z'),
    });

    const result = await handler({
      conversationId: 'conversation-1',
      generationId: 'generation-1',
      action: 'approve',
    });

    expect(result.statusCode).toBe(502);
    expect(writes[writes.length - 1]).toEqual(expect.objectContaining({
      status: 'awaiting_approval',
    }));
  });

  test('retries deploy from deploy_failed by async-invoking deploy again', async () => {
    const stored = {
      conversationId: 'conversation-1',
      generationId: 'generation-1',
      originalRequest: 'Deploy an S3 bucket',
      status: 'deploy_failed',
      deploymentError: 'previous failure',
      createdAt: '2026-07-09T00:00:00.000Z',
      updatedAt: '2026-07-09T00:00:00.000Z',
    };

    const dynamoDbClient = {
      send: jest.fn(async (command: unknown) => {
        if (command instanceof GetItemCommand) {
          return { Item: marshall(stored) };
        }

        if (command instanceof PutItemCommand) {
          return {};
        }

        return {};
      }),
    };

    const lambdaClient = {
      send: jest.fn(async () => ({})),
    };

    const handler = createApprovalHandler({
      dynamoDbClient: dynamoDbClient as never,
      lambdaClient: lambdaClient as never,
      now: () => new Date('2026-07-09T00:02:00.000Z'),
    });

    const result = await handler({
      conversationId: 'conversation-1',
      generationId: 'generation-1',
      action: 'approve',
    });

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual(expect.objectContaining({
      status: 'deploying',
    }));
    expect(lambdaClient.send).toHaveBeenCalledWith(expect.any(InvokeCommand));
  });

  test('cancels a generation awaiting approval', async () => {
    const stored = {
      conversationId: 'conversation-1',
      generationId: 'generation-1',
      originalRequest: 'Deploy an S3 bucket',
      status: 'awaiting_approval',
      createdAt: '2026-07-09T00:00:00.000Z',
      updatedAt: '2026-07-09T00:00:00.000Z',
    };

    const writes: Record<string, unknown>[] = [];
    const dynamoDbClient = {
      send: jest.fn(async (command: unknown) => {
        if (command instanceof GetItemCommand) {
          return { Item: marshall(stored) };
        }

        if (command instanceof PutItemCommand) {
          const putCommand = command as PutItemCommand;
          writes.push(unmarshall(putCommand.input.Item ?? {}));
          return {};
        }

        return {};
      }),
    };

    const handler = createApprovalHandler({
      dynamoDbClient: dynamoDbClient as never,
      lambdaClient: { send: jest.fn() } as never,
      now: () => new Date('2026-07-09T00:01:00.000Z'),
    });

    const result = await handler({
      conversationId: 'conversation-1',
      generationId: 'generation-1',
      action: 'cancel',
    });

    expect(result.statusCode).toBe(200);
    expect(writes[0]).toEqual(expect.objectContaining({
      status: 'cancelled',
      error: 'Deployment cancelled by user',
    }));
  });
});
