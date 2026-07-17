import { GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { createApprovalHandler } from '../lambda/approve/index';

describe('approval handler', () => {
  const previousEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...previousEnv,
      GENERATIONS_TABLE_NAME: 'Generations',
    };
  });

  afterEach(() => {
    process.env = previousEnv;
  });

  test('approves a generation awaiting approval', async () => {
    const stored = {
      conversationId: 'conversation-1',
      generationId: 'generation-1',
      originalRequest: 'Deploy an S3 bucket',
      generatedCdkCode: 'code',
      status: 'awaiting_approval',
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

    const handler = createApprovalHandler({
      dynamoDbClient: dynamoDbClient as never,
      now: () => new Date('2026-07-09T00:01:00.000Z'),
    });

    const result = await handler({
      conversationId: 'conversation-1',
      generationId: 'generation-1',
      action: 'approve',
    });

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual(expect.objectContaining({
      status: 'approved',
    }));
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
