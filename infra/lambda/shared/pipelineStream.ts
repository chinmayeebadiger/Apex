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

export type DeployEventPhase =
  | 'preparing'
  | 'change_set'
  | 'executing'
  | 'polling'
  | 'complete'
  | 'failed'
  | 'rolling_back';

export interface DeployEventMessage {
  type: 'deploy_event';
  conversationId: string;
  generationId: string;
  phase: DeployEventPhase;
  status: 'deploying' | 'deployed' | 'deploy_failed';
  resourceStatus?: string;
  logicalId?: string;
  resourceType?: string;
  message?: string;
  timestamp: string;
  outputs?: Record<string, string>;
  stackName?: string;
  stackId?: string;
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

  const post = async (
    connectionId: string | undefined,
    message: PipelineStepMessage | DeployEventMessage,
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

  const emitStep = async (
    connectionId: string | undefined,
    message: PipelineStepMessage,
  ) => post(connectionId, message);

  const emitDeployEvent = async (
    connectionId: string | undefined,
    message: DeployEventMessage,
  ) => post(connectionId, message);

  return { emitStep, emitDeployEvent };
};

export const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export const shouldSimulateSlowSteps = () =>
  process.env.SIMULATE_SLOW_STEPS === '1';
