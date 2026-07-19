import { QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { createHistoryHandler } from '../lambda/history/index';

describe('history handler', () => {
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

  test('returns generations for a conversation sorted newest first', async () => {
    const dynamoDbClient = {
      send: jest.fn(async (command: unknown) => {
        expect(command).toBeInstanceOf(QueryCommand);
        return {
          Items: [
            marshall({
              conversationId: 'conversation-1',
              generationId: 'generation-old',
              originalRequest: 'Old stack',
              status: 'approved',
              createdAt: '2026-07-08T00:00:00.000Z',
              updatedAt: '2026-07-08T00:00:00.000Z',
            }),
            marshall({
              conversationId: 'conversation-1',
              generationId: 'generation-new',
              originalRequest: 'New stack',
              status: 'awaiting_approval',
              createdAt: '2026-07-09T00:00:00.000Z',
              updatedAt: '2026-07-09T00:00:00.000Z',
            }),
          ],
        };
      }),
    };

    const handler = createHistoryHandler(dynamoDbClient as never);
    const result = await handler({
      queryStringParameters: { conversationId: 'conversation-1' },
    });

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.items[0].generationId).toBe('generation-new');
    expect(body.items[1].generationId).toBe('generation-old');
  });
});
