'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeployEventMessage } from '../lib/deploy';
import type { GenerationStatus } from '../lib/types';

export type PipelineStepId =
  | 'generating_code'
  | 'validating'
  | 'analyzing'
  | 'awaiting_approval'
  | 'failed';

export type PipelineStepStatus = 'running' | 'done' | 'error';

export interface PipelineStep {
  step: PipelineStepId;
  label: string;
  status: PipelineStepStatus;
  durationMs?: number;
  output?: string;
}

interface ConnectedMessage {
  type: 'connected';
  connectionId: string;
}

interface PipelineStepMessage extends PipelineStep {
  type: 'pipeline_step';
  conversationId: string;
  generationId: string;
}

const getWebSocketUrl = () => process.env.NEXT_PUBLIC_WEBSOCKET_URL ?? '';

export const usePipelineWebSocket = () => {
  const socketRef = useRef<WebSocket | null>(null);
  const [connectionId, setConnectionId] = useState<string | undefined>();
  const [isConnected, setIsConnected] = useState(false);
  const [steps, setSteps] = useState<PipelineStep[]>([]);
  const [deployEvents, setDeployEvents] = useState<DeployEventMessage[]>([]);
  const [deployStatus, setDeployStatus] = useState<GenerationStatus | undefined>();

  const resetSteps = useCallback(() => {
    setSteps([]);
  }, []);

  const resetDeploy = useCallback(() => {
    setDeployEvents([]);
    setDeployStatus(undefined);
  }, []);

  useEffect(() => {
    const url = getWebSocketUrl();
    if (!url) {
      return;
    }

    const socket = new WebSocket(url);
    socketRef.current = socket;

    socket.onopen = () => {
      setIsConnected(true);
      socket.send(JSON.stringify({ type: 'register' }));
    };

    socket.onmessage = (event) => {
      const payload = JSON.parse(event.data) as
        | ConnectedMessage
        | PipelineStepMessage
        | DeployEventMessage;

      if (payload.type === 'connected') {
        setConnectionId(payload.connectionId);
        return;
      }

      if (payload.type === 'pipeline_step') {
        setSteps((current) => {
          const next = current.filter((step) => step.step !== payload.step);
          next.push({
            step: payload.step,
            label: payload.label,
            status: payload.status,
            durationMs: payload.durationMs,
            output: payload.output,
          });
          return next.sort((left, right) => left.step.localeCompare(right.step));
        });
        return;
      }

      if (payload.type === 'deploy_event') {
        setDeployEvents((current) => [...current, payload]);
        setDeployStatus(payload.status);
      }
    };

    socket.onclose = () => {
      setIsConnected(false);
    };

    return () => {
      socket.close();
    };
  }, []);

  return {
    connectionId,
    isConnected,
    steps,
    resetSteps,
    deployEvents,
    deployStatus,
    resetDeploy,
  };
};
