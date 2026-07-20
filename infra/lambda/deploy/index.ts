import {
  CloudFormationClient,
  CreateChangeSetCommand,
  DeleteStackCommand,
  DescribeChangeSetCommand,
  DescribeStackEventsCommand,
  DescribeStacksCommand,
  ExecuteChangeSetCommand,
  type Stack,
  type StackEvent,
} from '@aws-sdk/client-cloudformation';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { z } from 'zod';
import {
  buildStackName,
  getGeneration,
  putGeneration,
  type StoredGeneration,
} from '../shared/generation';
import {
  createPipelineStreamer,
  type DeployEventMessage,
  type DeployEventPhase,
  sleep,
} from '../shared/pipelineStream';

const DeployInvocationSchema = z.object({
  conversationId: z.string().min(1),
  generationId: z.string().min(1),
  connectionId: z.string().min(1).optional(),
});

export type DeployInvocation = z.infer<typeof DeployInvocationSchema>;

export interface DeployDependencies {
  dynamoDbClient?: DynamoDBClient;
  cloudFormationClient?: CloudFormationClient;
  s3Client?: S3Client;
  emitDeployEvent?: (
    connectionId: string | undefined,
    message: DeployEventMessage,
  ) => Promise<void>;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  pollIntervalMs?: number;
  maxPollMs?: number;
}

const getTemplatesBucketName = () => {
  const bucketName = process.env.TEMPLATES_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('TEMPLATES_BUCKET_NAME is not configured');
  }

  return bucketName;
};

const getDeploymentRoleArn = () => {
  const roleArn = process.env.DEPLOYMENT_ROLE_ARN;
  if (!roleArn) {
    throw new Error('DEPLOYMENT_ROLE_ARN is not configured');
  }

  return roleArn;
};

const getRegion = () => process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'ap-south-1';

const TERMINAL_STACK_STATUSES = new Set([
  'CREATE_COMPLETE',
  'UPDATE_COMPLETE',
  'CREATE_FAILED',
  'UPDATE_FAILED',
  'ROLLBACK_COMPLETE',
  'ROLLBACK_FAILED',
  'UPDATE_ROLLBACK_COMPLETE',
  'UPDATE_ROLLBACK_FAILED',
  'DELETE_COMPLETE',
  'DELETE_FAILED',
]);

const SUCCESS_STACK_STATUSES = new Set(['CREATE_COMPLETE', 'UPDATE_COMPLETE']);
const FAILURE_STACK_STATUSES = new Set([
  'CREATE_FAILED',
  'UPDATE_FAILED',
  'ROLLBACK_COMPLETE',
  'ROLLBACK_FAILED',
  'UPDATE_ROLLBACK_COMPLETE',
  'UPDATE_ROLLBACK_FAILED',
]);

const UNRECOVERABLE_STACK_STATUSES = new Set([
  'ROLLBACK_COMPLETE',
  'REVIEW_IN_PROGRESS',
  'DELETE_FAILED',
]);

const parseEvent = (event: unknown) => {
  if (typeof event === 'object' && event !== null && 'body' in event) {
    const body = (event as { body?: unknown }).body;
    return typeof body === 'string' ? JSON.parse(body || '{}') : body;
  }

  return event;
};

const templateUrlFor = (bucketName: string, key: string, region: string) =>
  `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;

const stackOutputs = (stack: Stack | undefined): Record<string, string> => {
  const outputs: Record<string, string> = {};
  for (const output of stack?.Outputs ?? []) {
    if (output.OutputKey && output.OutputValue !== undefined) {
      outputs[output.OutputKey] = output.OutputValue;
    }
  }

  return outputs;
};

const describeStack = async (
  cloudFormationClient: CloudFormationClient,
  stackName: string,
): Promise<Stack | undefined> => {
  try {
    const result = await cloudFormationClient.send(new DescribeStacksCommand({
      StackName: stackName,
    }));
    return result.Stacks?.[0];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('does not exist')) {
      return undefined;
    }

    throw error;
  }
};

const waitForStackDeletion = async (
  cloudFormationClient: CloudFormationClient,
  stackName: string,
  sleepFn: (milliseconds: number) => Promise<void>,
  pollIntervalMs: number,
  deadline: number,
) => {
  while (Date.now() < deadline) {
    const stack = await describeStack(cloudFormationClient, stackName);
    if (!stack || stack.StackStatus === 'DELETE_COMPLETE') {
      return;
    }

    if (stack.StackStatus === 'DELETE_FAILED') {
      throw new Error(`Failed to delete stack ${stackName}: ${stack.StackStatusReason ?? 'unknown'}`);
    }

    await sleepFn(pollIntervalMs);
  }

  throw new Error(`Timed out waiting for stack ${stackName} deletion`);
};

const ensureStackReady = async (
  cloudFormationClient: CloudFormationClient,
  stackName: string,
  sleepFn: (milliseconds: number) => Promise<void>,
  pollIntervalMs: number,
  deadline: number,
) => {
  const existing = await describeStack(cloudFormationClient, stackName);
  if (!existing) {
    return { changeSetType: 'CREATE' as const, stack: undefined };
  }

  if (existing.StackStatus && UNRECOVERABLE_STACK_STATUSES.has(existing.StackStatus)) {
    await cloudFormationClient.send(new DeleteStackCommand({ StackName: stackName }));
    await waitForStackDeletion(
      cloudFormationClient,
      stackName,
      sleepFn,
      pollIntervalMs,
      deadline,
    );
    return { changeSetType: 'CREATE' as const, stack: undefined };
  }

  return { changeSetType: 'UPDATE' as const, stack: existing };
};

const waitForChangeSet = async (
  cloudFormationClient: CloudFormationClient,
  stackName: string,
  changeSetName: string,
  sleepFn: (milliseconds: number) => Promise<void>,
  pollIntervalMs: number,
  deadline: number,
) => {
  while (Date.now() < deadline) {
    const result = await cloudFormationClient.send(new DescribeChangeSetCommand({
      StackName: stackName,
      ChangeSetName: changeSetName,
    }));

    const status = result.Status;
    if (status === 'CREATE_COMPLETE') {
      return { status: 'CREATE_COMPLETE' as const, result };
    }

    if (status === 'FAILED') {
      const reason = result.StatusReason ?? 'Change set creation failed';
      if (/didn't contain changes|no updates are to be performed/i.test(reason)) {
        return { status: 'NO_CHANGES' as const, result };
      }

      throw new Error(reason);
    }

    await sleepFn(pollIntervalMs);
  }

  throw new Error('Timed out waiting for change set CREATE_COMPLETE');
};

const eventLine = (event: StackEvent) => {
  const parts = [
    event.Timestamp?.toISOString(),
    event.ResourceStatus,
    event.LogicalResourceId,
    event.ResourceType,
    event.ResourceStatusReason,
  ].filter(Boolean);

  return parts.join(' ');
};

const firstFailedReason = (events: StackEvent[]) => {
  const failed = events.find((event) =>
    event.ResourceStatus?.includes('FAILED') || event.ResourceStatus?.includes('ROLLBACK'));
  return failed?.ResourceStatusReason
    ?? failed?.ResourceStatus
    ?? 'CloudFormation deployment failed';
};

export const createDeployHandler = (dependencies: DeployDependencies = {}) => {
  const dynamoDbClient = dependencies.dynamoDbClient ?? new DynamoDBClient({});
  const cloudFormationClient = dependencies.cloudFormationClient ?? new CloudFormationClient({});
  const s3Client = dependencies.s3Client ?? new S3Client({});
  const emitDeployEvent = dependencies.emitDeployEvent
    ?? createPipelineStreamer().emitDeployEvent;
  const now = dependencies.now ?? (() => new Date());
  const sleepFn: (milliseconds: number) => Promise<void> = dependencies.sleep
    ?? (async (milliseconds) => {
      await sleep(milliseconds);
    });
  const pollIntervalMs = dependencies.pollIntervalMs ?? 4000;
  const maxPollMs = dependencies.maxPollMs ?? 14 * 60 * 1000;

  const emit = async (
    connectionId: string | undefined,
    partial: Omit<DeployEventMessage, 'type' | 'timestamp'> & { timestamp?: string },
  ) => {
    await emitDeployEvent(connectionId, {
      type: 'deploy_event',
      timestamp: partial.timestamp ?? now().toISOString(),
      ...partial,
    });
  };

  const failGeneration = async (
    item: StoredGeneration,
    connectionId: string | undefined,
    errorMessage: string,
    phase: DeployEventPhase = 'failed',
  ) => {
    const finishedAt = now().toISOString();
    const updated: StoredGeneration = {
      ...item,
      status: 'deploy_failed',
      deploymentError: errorMessage,
      error: errorMessage,
      deployFinishedAt: finishedAt,
      updatedAt: finishedAt,
    };

    await putGeneration(dynamoDbClient, updated);
    await emit(connectionId, {
      conversationId: item.conversationId,
      generationId: item.generationId,
      phase,
      status: 'deploy_failed',
      message: errorMessage,
      stackName: item.deploymentStackName,
      stackId: item.deploymentStackId,
    });

    return updated;
  };

  return async (event: unknown) => {
    const invocation = DeployInvocationSchema.parse(parseEvent(event));
    let item = await getGeneration(
      dynamoDbClient,
      invocation.conversationId,
      invocation.generationId,
    );

    if (!item) {
      throw new Error('Generation not found');
    }

    if (item.status !== 'deploying') {
      return {
        skipped: true,
        reason: `Generation is in status "${item.status}", expected deploying`,
      };
    }

    if (!item.cloudFormationTemplate) {
      await failGeneration(item, invocation.connectionId, 'Missing cloudFormationTemplate');
      return { status: 'deploy_failed' };
    }

    const startedAt = now().toISOString();
    const stackName = buildStackName(item.generationId);
    const deadline = Date.now() + maxPollMs;
    const region = getRegion();
    const bucketName = getTemplatesBucketName();
    const templateS3Key = `templates/${item.generationId}.template.json`;
    const changeSetName = `apex-cs-${item.generationId.slice(0, 8)}-${Date.now()}`;

    item = {
      ...item,
      deploymentStackName: stackName,
      templateS3Key,
      deployStartedAt: startedAt,
      deploymentError: undefined,
      updatedAt: startedAt,
    };
    await putGeneration(dynamoDbClient, item);

    try {
      await emit(invocation.connectionId, {
        conversationId: item.conversationId,
        generationId: item.generationId,
        phase: 'preparing',
        status: 'deploying',
        message: `Uploading template and preparing stack ${stackName}`,
        stackName,
      });

      await s3Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: templateS3Key,
        Body: JSON.stringify(item.cloudFormationTemplate),
        ContentType: 'application/json',
      }));

      const { changeSetType, stack: existingStack } = await ensureStackReady(
        cloudFormationClient,
        stackName,
        sleepFn,
        pollIntervalMs,
        deadline,
      );

      await emit(invocation.connectionId, {
        conversationId: item.conversationId,
        generationId: item.generationId,
        phase: 'change_set',
        status: 'deploying',
        message: `Creating ${changeSetType} change set ${changeSetName}`,
        stackName,
      });

      await cloudFormationClient.send(new CreateChangeSetCommand({
        StackName: stackName,
        ChangeSetName: changeSetName,
        ChangeSetType: changeSetType,
        TemplateURL: templateUrlFor(bucketName, templateS3Key, region),
        RoleARN: getDeploymentRoleArn(),
        Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM'],
      }));

      const changeSetWait = await waitForChangeSet(
        cloudFormationClient,
        stackName,
        changeSetName,
        sleepFn,
        pollIntervalMs,
        deadline,
      );

      if (changeSetWait.status === 'NO_CHANGES') {
        const stack = existingStack ?? await describeStack(cloudFormationClient, stackName);
        const outputs = stackOutputs(stack);
        const finishedAt = now().toISOString();
        const updated: StoredGeneration = {
          ...item,
          status: 'deployed',
          deploymentStackId: stack?.StackId,
          deploymentOutputs: outputs,
          deployFinishedAt: finishedAt,
          updatedAt: finishedAt,
        };
        await putGeneration(dynamoDbClient, updated);
        await emit(invocation.connectionId, {
          conversationId: item.conversationId,
          generationId: item.generationId,
          phase: 'complete',
          status: 'deployed',
          message: 'No changes to deploy — stack already up to date',
          stackName,
          stackId: stack?.StackId,
          outputs,
        });
        return { status: 'deployed', stackName, outputs };
      }

      await emit(invocation.connectionId, {
        conversationId: item.conversationId,
        generationId: item.generationId,
        phase: 'executing',
        status: 'deploying',
        message: `Executing change set ${changeSetName}`,
        stackName,
      });

      await cloudFormationClient.send(new ExecuteChangeSetCommand({
        StackName: stackName,
        ChangeSetName: changeSetName,
      }));

      const seenEventIds = new Set<string>();
      let terminalStack: Stack | undefined;

      while (Date.now() < deadline) {
        const eventsResult = await cloudFormationClient.send(new DescribeStackEventsCommand({
          StackName: stackName,
        }));
        const events = [...(eventsResult.StackEvents ?? [])]
          .sort((left, right) =>
            (left.Timestamp?.getTime() ?? 0) - (right.Timestamp?.getTime() ?? 0));

        for (const stackEvent of events) {
          if (!stackEvent.EventId || seenEventIds.has(stackEvent.EventId)) {
            continue;
          }

          seenEventIds.add(stackEvent.EventId);
          await emit(invocation.connectionId, {
            conversationId: item.conversationId,
            generationId: item.generationId,
            phase: 'polling',
            status: 'deploying',
            resourceStatus: stackEvent.ResourceStatus,
            logicalId: stackEvent.LogicalResourceId,
            resourceType: stackEvent.ResourceType,
            message: eventLine(stackEvent),
            stackName,
            timestamp: stackEvent.Timestamp?.toISOString() ?? now().toISOString(),
          });
        }

        const stack = await describeStack(cloudFormationClient, stackName);
        if (stack?.StackStatus && TERMINAL_STACK_STATUSES.has(stack.StackStatus)) {
          terminalStack = stack;
          break;
        }

        await sleepFn(pollIntervalMs);
      }

      if (!terminalStack) {
        await failGeneration(
          item,
          invocation.connectionId,
          'Deploy timed out — check CloudFormation console for stack status',
        );
        return { status: 'deploy_failed' };
      }

      if (SUCCESS_STACK_STATUSES.has(terminalStack.StackStatus ?? '')) {
        const outputs = stackOutputs(terminalStack);
        const finishedAt = now().toISOString();
        const updated: StoredGeneration = {
          ...item,
          status: 'deployed',
          deploymentStackId: terminalStack.StackId,
          deploymentOutputs: outputs,
          deployFinishedAt: finishedAt,
          updatedAt: finishedAt,
        };
        await putGeneration(dynamoDbClient, updated);
        await emit(invocation.connectionId, {
          conversationId: item.conversationId,
          generationId: item.generationId,
          phase: 'complete',
          status: 'deployed',
          message: `Stack ${stackName} reached ${terminalStack.StackStatus}`,
          stackName,
          stackId: terminalStack.StackId,
          outputs,
        });
        return { status: 'deployed', stackName, outputs };
      }

      if (FAILURE_STACK_STATUSES.has(terminalStack.StackStatus ?? '')) {
        const eventsResult = await cloudFormationClient.send(new DescribeStackEventsCommand({
          StackName: stackName,
        }));
        const reason = firstFailedReason(eventsResult.StackEvents ?? [])
          || terminalStack.StackStatusReason
          || `Stack entered ${terminalStack.StackStatus}`;

        if ((terminalStack.StackStatus ?? '').includes('ROLLBACK')) {
          await emit(invocation.connectionId, {
            conversationId: item.conversationId,
            generationId: item.generationId,
            phase: 'rolling_back',
            status: 'deploying',
            message: `Stack rolling back: ${terminalStack.StackStatus}`,
            stackName,
            stackId: terminalStack.StackId,
          });
        }

        await failGeneration(item, invocation.connectionId, reason);
        return { status: 'deploy_failed', reason };
      }

      await failGeneration(
        item,
        invocation.connectionId,
        `Unexpected terminal stack status: ${terminalStack.StackStatus}`,
      );
      return { status: 'deploy_failed' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown deploy error';
      await failGeneration(item, invocation.connectionId, message);
      return { status: 'deploy_failed', error: message };
    }
  };
};

export const handler = createDeployHandler();
