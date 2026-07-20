'use client';

import { ExternalLink } from 'lucide-react';
import { cloudFormationConsoleUrl } from '../lib/deploy';
import type { GenerationStatus } from '../lib/types';

interface DeploymentOutputsPanelProps {
  status?: GenerationStatus;
  stackName?: string;
  stackId?: string;
  outputs?: Record<string, string>;
  deploymentError?: string;
}

export function DeploymentOutputsPanel({
  status,
  stackName,
  stackId,
  outputs,
  deploymentError,
}: DeploymentOutputsPanelProps) {
  if (!status || !['deployed', 'deploy_failed', 'deploying'].includes(status)) {
    return null;
  }

  const entries = Object.entries(outputs ?? {});

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Deployment outputs
          </p>
          {stackName && (
            <p className="text-xs font-medium text-slate-800 mt-0.5">{stackName}</p>
          )}
        </div>
        <a
          href={cloudFormationConsoleUrl(stackId)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700 hover:text-teal-900"
        >
          CloudFormation
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <div className="p-3 space-y-2">
        {status === 'deploy_failed' && deploymentError && (
          <p className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
            {deploymentError}
          </p>
        )}

        {status === 'deploying' && entries.length === 0 && (
          <p className="text-xs text-slate-500">Waiting for stack outputs…</p>
        )}

        {status === 'deployed' && entries.length === 0 && (
          <p className="text-xs text-slate-500">Stack deployed with no outputs.</p>
        )}

        {entries.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-slate-400 uppercase tracking-wider text-[10px]">
                  <th className="pb-1.5 font-semibold">Output</th>
                  <th className="pb-1.5 font-semibold">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map(([key, value]) => (
                  <tr key={key}>
                    <td className="py-1.5 pr-3 font-medium text-slate-700 whitespace-nowrap">{key}</td>
                    <td className="py-1.5 font-mono text-slate-600 break-all">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {stackId && (
          <p className="text-[10px] text-slate-400 font-mono break-all pt-1">{stackId}</p>
        )}
      </div>
    </div>
  );
}
