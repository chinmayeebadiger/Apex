import type { GenerationStatus } from './types';

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

export type DeployLogTone = 'complete' | 'failed' | 'progress' | 'neutral';

export const isDeployStatus = (status: GenerationStatus | undefined): boolean =>
  status === 'deploying' || status === 'deployed' || status === 'deploy_failed';

export const deployLogTone = (resourceStatus?: string): DeployLogTone => {
  if (!resourceStatus) {
    return 'neutral';
  }

  if (/FAILED|ROLLBACK/i.test(resourceStatus)) {
    return 'failed';
  }

  if (/COMPLETE/i.test(resourceStatus)) {
    return 'complete';
  }

  if (/IN_PROGRESS|PROGRESS/i.test(resourceStatus)) {
    return 'progress';
  }

  return 'neutral';
};

export const formatDeployLogLine = (event: DeployEventMessage): string => {
  if (event.message) {
    return event.message;
  }

  const parts = [
    event.timestamp,
    event.phase,
    event.resourceStatus,
    event.logicalId,
    event.resourceType,
  ].filter(Boolean);

  return parts.join(' ');
};

export const cloudFormationConsoleUrl = (stackId?: string, region = 'ap-south-1') => {
  if (!stackId) {
    return `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}`;
  }

  return `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/stackinfo?stackId=${encodeURIComponent(stackId)}`;
};

export const deriveDeployStatus = (
  events: DeployEventMessage[],
  fallback?: GenerationStatus,
): GenerationStatus | undefined => {
  const terminal = [...events].reverse().find((event) =>
    event.phase === 'complete' || event.phase === 'failed');

  if (terminal?.status) {
    return terminal.status;
  }

  if (events.length > 0) {
    return 'deploying';
  }

  return fallback;
};
