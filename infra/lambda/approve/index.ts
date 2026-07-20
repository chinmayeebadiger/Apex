import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { z } from 'zod';
import {
  getGeneration,
  putGeneration,
  type StoredGeneration,
} from '../shared/generation';

const ApprovalRequestSchema = z.object({
  conversationId: z.string().min(1),
  generationId: z.string().min(1),
  action: z.enum(['approve', 'cancel']),
  connectionId: z.string().min(1).optional(),
});

export type { StoredGeneration };

export interface ApprovalDependencies {
  dynamoDbClient?: DynamoDBClient;
  lambdaClient?: LambdaClient;
  now?: () => Date;
}

const getDeployFunctionName = () => {
  const functionName = process.env.DEPLOY_FUNCTION_NAME;
  if (!functionName) {
    throw new Error('DEPLOY_FUNCTION_NAME is not configured');
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

export const createApprovalHandler = (dependencies: ApprovalDependencies = {}) => {
  const dynamoDbClient = dependencies.dynamoDbClient ?? new DynamoDBClient({});
  const lambdaClient = dependencies.lambdaClient ?? new LambdaClient({});
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

      const canCancel = existing.status === 'awaiting_approval';
      const canApprove = existing.status === 'awaiting_approval'
        || existing.status === 'deploy_failed';

      if (request.action === 'cancel' && !canCancel) {
        return response(409, {
          error: `Generation is in status "${existing.status}" and cannot be cancelled`,
          status: existing.status,
        });
      }

      if (request.action === 'approve' && !canApprove) {
        return response(409, {
          error: `Generation is in status "${existing.status}" and cannot be approved`,
          status: existing.status,
        });
      }

      const updatedAt = now().toISOString();

      if (request.action === 'cancel') {
        const updatedItem: StoredGeneration = {
          ...existing,
          status: 'cancelled',
          error: 'Deployment cancelled by user',
          updatedAt,
        };

        await putGeneration(dynamoDbClient, updatedItem);

        return response(200, {
          conversationId: request.conversationId,
          generationId: request.generationId,
          status: 'cancelled',
          item: updatedItem,
        });
      }

      const deployingItem: StoredGeneration = {
        ...existing,
        status: 'deploying',
        error: undefined,
        deploymentError: undefined,
        updatedAt,
      };

      await putGeneration(dynamoDbClient, deployingItem);

      try {
        await lambdaClient.send(new InvokeCommand({
          FunctionName: getDeployFunctionName(),
          InvocationType: 'Event',
          Payload: Buffer.from(JSON.stringify({
            conversationId: request.conversationId,
            generationId: request.generationId,
            connectionId: request.connectionId,
          })),
        }));
      } catch (invokeError) {
        const reverted: StoredGeneration = {
          ...existing,
          status: 'awaiting_approval',
          updatedAt: now().toISOString(),
        };
        await putGeneration(dynamoDbClient, reverted);

        const message = invokeError instanceof Error
          ? invokeError.message
          : 'Failed to start deployment';
        return response(502, { error: message, status: 'awaiting_approval' });
      }

      return response(200, {
        conversationId: request.conversationId,
        generationId: request.generationId,
        status: 'deploying',
        item: deployingItem,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown approval error';
      return response(400, { error: message });
    }
  };
};

export const handler = createApprovalHandler();
