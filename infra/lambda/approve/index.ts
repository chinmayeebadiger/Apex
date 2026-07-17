import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { z } from 'zod';

const ApprovalRequestSchema = z.object({
  conversationId: z.string().min(1),
  generationId: z.string().min(1),
  action: z.enum(['approve', 'cancel']),
});

const GenerationStatusSchema = z.enum([
  'generating',
  'awaiting_approval',
  'approved',
  'cancelled',
  'failed',
]);

const StoredGenerationSchema = z.object({
  conversationId: z.string(),
  generationId: z.string(),
  originalRequest: z.string(),
  generatedCdkCode: z.string().optional(),
  generatedExplanation: z.string().optional(),
  cloudFormationTemplate: z.unknown().optional(),
  changeset: z.unknown().optional(),
  costEstimate: z.unknown().optional(),
  securityFlags: z.unknown().optional(),
  status: GenerationStatusSchema,
  error: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type StoredGeneration = z.infer<typeof StoredGenerationSchema>;

export interface ApprovalDependencies {
  dynamoDbClient?: DynamoDBClient;
  now?: () => Date;
}

const getTableName = () => {
  const tableName = process.env.GENERATIONS_TABLE_NAME;
  if (!tableName) {
    throw new Error('GENERATIONS_TABLE_NAME is not configured');
  }

  return tableName;
};

const response = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const parseEvent = (event: unknown) => {
  if (typeof event === 'object' && event !== null && 'body' in event) {
    const body = (event as { body?: unknown }).body;
    return typeof body === 'string' ? JSON.parse(body || '{}') : body;
  }

  return event;
};

const getGeneration = async (
  dynamoDbClient: DynamoDBClient,
  conversationId: string,
  generationId: string,
) => {
  const result = await dynamoDbClient.send(new GetItemCommand({
    TableName: getTableName(),
    Key: marshall({ conversationId, generationId }),
  }));

  return result.Item ? StoredGenerationSchema.parse(unmarshall(result.Item)) : undefined;
};

const putGeneration = async (
  dynamoDbClient: DynamoDBClient,
  item: StoredGeneration,
) => {
  await dynamoDbClient.send(new PutItemCommand({
    TableName: getTableName(),
    Item: marshall(StoredGenerationSchema.parse(item), { removeUndefinedValues: true }),
  }));
};

export const createApprovalHandler = (dependencies: ApprovalDependencies = {}) => {
  const dynamoDbClient = dependencies.dynamoDbClient ?? new DynamoDBClient({});
  const now = dependencies.now ?? (() => new Date());

  return async (event: unknown) => {
    try {
      const request = ApprovalRequestSchema.parse(parseEvent(event));
      const existing = await getGeneration(
        dynamoDbClient,
        request.conversationId,
        request.generationId,
      );

      if (!existing) {
        return response(404, { error: 'Generation not found' });
      }

      if (existing.status !== 'awaiting_approval') {
        return response(409, {
          error: `Generation is in status "${existing.status}" and cannot be ${request.action}d`,
          status: existing.status,
        });
      }

      const updatedAt = now().toISOString();
      const nextStatus = request.action === 'approve' ? 'approved' : 'cancelled';
      const updatedItem: StoredGeneration = {
        ...existing,
        status: nextStatus,
        error: request.action === 'cancel' ? 'Deployment cancelled by user' : undefined,
        updatedAt,
      };

      await putGeneration(dynamoDbClient, updatedItem);

      return response(200, {
        conversationId: request.conversationId,
        generationId: request.generationId,
        status: nextStatus,
        item: updatedItem,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown approval error';
      return response(400, { error: message });
    }
  };
};

export const handler = createApprovalHandler();
