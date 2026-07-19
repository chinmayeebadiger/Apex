import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';

export type PipelineStepId =
  | 'generating_code'
  | 'validating'
  | 'analyzing'
  | 'awaiting_approval'
  | 'failed';

export type PipelineStepStatus = 'running' | 'done' | 'error';

export interface PipelineStepMessage {
  type: 'pipeline_step';
  conversationId: string;
  generationId: string;
  step: PipelineStepId;
  label: string;
  status: PipelineStepStatus;
  durationMs?: number;
  output?: string;
}

const getManagementEndpoint = () => {
  const endpoint = process.env.WEBSOCKET_MANAGEMENT_ENDPOINT;
  if (!endpoint) {
    throw new Error('WEBSOCKET_MANAGEMENT_ENDPOINT is not configured');
  }

  return endpoint;
};

export const createPipelineStreamer = (
  managementClient?: ApiGatewayManagementApiClient,
) => {
  let client = managementClient;

  const getClient = () => {
    if (!client) {
      client = new ApiGatewayManagementApiClient({
        endpoint: getManagementEndpoint(),
      });
    }

    return client;
  };

  const emitStep = async (
    connectionId: string | undefined,
    message: PipelineStepMessage,
  ) => {
    if (!connectionId) {
      return;
    }

    try {
      await getClient().send(new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(JSON.stringify(message)),
      }));
    } catch (error) {
      const statusCode = (error as { statusCode?: number })?.statusCode;
      if (statusCode === 410) {
        return;
      }

      throw error;
    }
  };

  return { emitStep };
};

export const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export const shouldSimulateSlowSteps = () =>
  process.env.SIMULATE_SLOW_STEPS === '1';
