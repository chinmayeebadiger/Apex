import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { z } from 'zod';

export const GenerationStatusSchema = z.enum([
  'generating',
  'awaiting_approval',
  'approved',
  'deploying',
  'deployed',
  'deploy_failed',
  'cancelled',
  'failed',
]);

export const StoredGenerationSchema = z.object({
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
  deploymentStackName: z.string().optional(),
  deploymentStackId: z.string().optional(),
  deploymentOutputs: z.record(z.string(), z.string()).optional(),
  deploymentError: z.string().optional(),
  templateS3Key: z.string().optional(),
  deployStartedAt: z.string().optional(),
  deployFinishedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type GenerationStatus = z.infer<typeof GenerationStatusSchema>;
export type StoredGeneration = z.infer<typeof StoredGenerationSchema>;

export const getTableName = () => {
  const tableName = process.env.GENERATIONS_TABLE_NAME;
  if (!tableName) {
    throw new Error('GENERATIONS_TABLE_NAME is not configured');
  }

  return tableName;
};

export const getGeneration = async (
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

export const putGeneration = async (
  dynamoDbClient: DynamoDBClient,
  item: StoredGeneration,
) => {
  await dynamoDbClient.send(new PutItemCommand({
    TableName: getTableName(),
    Item: marshall(StoredGenerationSchema.parse(item), { removeUndefinedValues: true }),
  }));
};

export const buildStackName = (generationId: string) =>
  `apex-gen-${generationId.slice(0, 8).toLowerCase()}`;
