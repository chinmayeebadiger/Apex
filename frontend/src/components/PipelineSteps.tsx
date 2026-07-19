import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import type { PipelineStep } from '../hooks/usePipelineWebSocket';

const STEP_ORDER = [
  'generating_code',
  'validating',
  'analyzing',
  'awaiting_approval',
  'failed',
] as const;

interface PipelineStepsProps {
  steps: PipelineStep[];
  isActive: boolean;
}

export function PipelineSteps({ steps, isActive }: PipelineStepsProps) {
  if (!isActive && steps.length === 0) {
    return null;
  }

  const orderedSteps = [...steps].sort(
    (left, right) => STEP_ORDER.indexOf(left.step) - STEP_ORDER.indexOf(right.step),
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Live Pipeline</h3>
      <ol className="space-y-2">
        {orderedSteps.map((step) => (
          <li key={step.step} className="flex items-start gap-2 text-xs">
            {step.status === 'running' ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-teal-600 mt-0.5" />
            ) : step.status === 'error' ? (
              <XCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
            )}
            <div className="min-w-0">
              <div className="font-medium text-slate-800">{step.label}</div>
              {step.durationMs !== undefined && (
                <div className="text-[10px] text-slate-400">{step.durationMs}ms</div>
              )}
              {step.output && (
                <div className="text-[10px] text-slate-500 mt-0.5 truncate">{step.output}</div>
              )}
            </div>
          </li>
        ))}
        {isActive && orderedSteps.every((step) => step.status !== 'running') && (
          <li className="flex items-center gap-2 text-[10px] text-slate-400">
            <Circle className="h-3 w-3" />
            Waiting for next step...
          </li>
        )}
      </ol>
    </section>
  );
}
