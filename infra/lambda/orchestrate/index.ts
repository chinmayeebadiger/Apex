import Anthropic from '@anthropic-ai/sdk';
import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { analyzeTemplate, TemplateAnalysisSchema } from '../../../packages/changeset/src/analyzer';
import { buildDiffRenderModel } from '../../../packages/changeset/src/diffRenderer';
import { getAnthropicApiKey } from '../shared/anthropicApiKey';
import { GeneratedCdkCodeSchema, generateCdkCode } from '../shared/prompt';

const OrchestrationRequestSchema = z
  .object({
    conversationId: z.string().min(1).optional(),
    generationId: z.string().min(1).optional(),
    request: z.string().min(1).optional(),
    message: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.request ?? value.message), {
    message: 'request or message is required',
  })
  .transform((value) => ({
    conversationId: value.conversationId ?? randomUUID(),
    generationId: value.generationId ?? randomUUID(),
    request: value.request ?? value.message!,
  }));

const SandboxSuccessSchema = z.object({
  success: z.literal(true),
  template: z.unknown(),
});

const SandboxFailureSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  stderr: z.string().default(''),
});

const SandboxResponseSchema = z.discriminatedUnion('success', [
  SandboxSuccessSchema,
  SandboxFailureSchema,
]);

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

export type OrchestrationRequest = z.input<typeof OrchestrationRequestSchema>;
export type StoredGeneration = z.infer<typeof StoredGenerationSchema>;

export interface OrchestrationDependencies {
  dynamoDbClient?: DynamoDBClient;
  lambdaClient?: LambdaClient;
  anthropicFactory?: (apiKey: string) => Anthropic;
  getApiKey?: () => Promise<string>;
  generate?: (anthropic: Anthropic, request: string) => Promise<z.infer<typeof GeneratedCdkCodeSchema>>;
  analyze?: typeof analyzeTemplate;
  now?: () => Date;
}

const getTableName = () => {
  const tableName = process.env.GENERATIONS_TABLE_NAME;
  if (!tableName) {
    throw new Error('GENERATIONS_TABLE_NAME is not configured');
  }

  return tableName;
};

const getSandboxFunctionName = () => {
  const functionName = process.env.SANDBOX_FUNCTION_NAME;
  if (!functionName) {
    throw new Error('SANDBOX_FUNCTION_NAME is not configured');
  }

  return functionName;
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

const toDynamoItem = (item: StoredGeneration) =>
  marshall(StoredGenerationSchema.parse(item), { removeUndefinedValues: true });

const putGeneration = async (
  dynamoDbClient: DynamoDBClient,
  item: StoredGeneration,
) => {
  await dynamoDbClient.send(new PutItemCommand({
    TableName: getTableName(),
    Item: toDynamoItem(item),
  }));
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

const invokeSandbox = async (
  lambdaClient: LambdaClient,
  code: string,
) => {
  const invokeResult = await lambdaClient.send(new InvokeCommand({
    FunctionName: getSandboxFunctionName(),
    InvocationType: 'RequestResponse',
    Payload: Buffer.from(JSON.stringify({ code })),
  }));

  if (invokeResult.FunctionError) {
    throw new Error(`Sandbox Lambda invocation failed: ${invokeResult.FunctionError}`);
  }

  if (!invokeResult.Payload) {
    throw new Error('Sandbox Lambda returned an empty payload');
  }

  return SandboxResponseSchema.parse(JSON.parse(new TextDecoder().decode(invokeResult.Payload)));
};

export const createOrchestrationHandler = (dependencies: OrchestrationDependencies = {}) => {
  const dynamoDbClient = dependencies.dynamoDbClient ?? new DynamoDBClient({});
  const lambdaClient = dependencies.lambdaClient ?? new LambdaClient({});
  const anthropicFactory = dependencies.anthropicFactory ?? ((apiKey: string) => new Anthropic({ apiKey }));
  const getApiKey = dependencies.getApiKey ?? getAnthropicApiKey;
  const generate = dependencies.generate ?? generateCdkCode;
  const analyze = dependencies.analyze ?? analyzeTemplate;
  const now = dependencies.now ?? (() => new Date());

  return async (event: unknown) => {
    const request = OrchestrationRequestSchema.parse(parseEvent(event));
    const createdAt = now().toISOString();

    const initialItem: StoredGeneration = {
      conversationId: request.conversationId,
      generationId: request.generationId,
      originalRequest: request.request,
      status: 'generating',
      createdAt,
      updatedAt: createdAt,
    };

    await putGeneration(dynamoDbClient, initialItem);

    try {
      const anthropic = anthropicFactory(await getApiKey());
      const generated = GeneratedCdkCodeSchema.parse(await generate(anthropic, request.request));
      const sandboxResponse = await invokeSandbox(lambdaClient, generated.code);

      if (!sandboxResponse.success) {
        throw new Error(`Sandbox synthesis failed: ${sandboxResponse.error}${sandboxResponse.stderr ? `\n${sandboxResponse.stderr}` : ''}`);
      }

      const analysis = TemplateAnalysisSchema.parse(await analyze(sandboxResponse.template));
      const updatedAt = now().toISOString();
      const finalItem: StoredGeneration = {
        ...initialItem,
        generatedCdkCode: generated.code,
        generatedExplanation: generated.explanation,
        cloudFormationTemplate: sandboxResponse.template,
        changeset: analysis.changeset,
        costEstimate: analysis.costEstimate,
        securityFlags: analysis.securityScan.flags,
        status: 'awaiting_approval',
        updatedAt,
      };

      await putGeneration(dynamoDbClient, finalItem);

      const diff = buildDiffRenderModel(analysis.changeset);

      return response(200, {
        conversationId: request.conversationId,
        generationId: request.generationId,
        status: finalItem.status,
        code: finalItem.generatedCdkCode,
        explanation: finalItem.generatedExplanation,
        changeset: finalItem.changeset,
        costEstimate: finalItem.costEstimate,
        securityFlags: finalItem.securityFlags,
        diff,
        item: await getGeneration(dynamoDbClient, request.conversationId, request.generationId),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown orchestration error';
      const failedAt = now().toISOString();

      await putGeneration(dynamoDbClient, {
        ...initialItem,
        status: 'failed',
        error: message,
        updatedAt: failedAt,
      });

      return response(500, {
        conversationId: request.conversationId,
        generationId: request.generationId,
        status: 'failed',
        error: message,
      });
    }
  };
};

export const handler = createOrchestrationHandler();
