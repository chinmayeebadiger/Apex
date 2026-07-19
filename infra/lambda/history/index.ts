import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { z } from 'zod';

const HistoryQuerySchema = z.object({
  conversationId: z.string().min(1),
});

const getTableName = () => {
  const tableName = process.env.GENERATIONS_TABLE_NAME;
  if (!tableName) {
    throw new Error('GENERATIONS_TABLE_NAME is not configured');
  }

  return tableName;
};

const response = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
  body: JSON.stringify(body),
});

const parseEvent = (event: unknown) => {
  if (typeof event === 'object' && event !== null) {
    const apiEvent = event as {
      queryStringParameters?: Record<string, string | undefined> | null;
      conversationId?: string;
    };

    if (apiEvent.queryStringParameters?.conversationId) {
      return { conversationId: apiEvent.queryStringParameters.conversationId };
    }

    if (apiEvent.conversationId) {
      return { conversationId: apiEvent.conversationId };
    }
  }

  return event;
};

export const createHistoryHandler = (dynamoDbClient = new DynamoDBClient({})) =>
  async (event: unknown) => {
    try {
      const query = HistoryQuerySchema.parse(parseEvent(event));
      const result = await dynamoDbClient.send(new QueryCommand({
        TableName: getTableName(),
        KeyConditionExpression: 'conversationId = :conversationId',
        ExpressionAttributeValues: {
          ':conversationId': { S: query.conversationId },
        },
      }));

      const items = (result.Items ?? [])
        .map((item) => unmarshall(item))
        .sort((left, right) => {
          const leftTime = String(left.createdAt ?? '');
          const rightTime = String(right.createdAt ?? '');
          return rightTime.localeCompare(leftTime);
        });

      return response(200, {
        conversationId: query.conversationId,
        items,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown history error';
      return response(400, { error: message });
    }
  };

export const handler = createHistoryHandler();
