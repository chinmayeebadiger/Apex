import { CheckCircle2, Loader2, RotateCcw, XCircle } from 'lucide-react';
import type { GenerationStatus } from '../lib/types';

interface ApprovalBarProps {
  status: GenerationStatus;
  onApprove: () => void;
  onCancel: () => void;
  onRetryDeploy?: () => void;
  isSubmitting: boolean;
}

export function ApprovalBar({
  status,
  onApprove,
  onCancel,
  onRetryDeploy,
  isSubmitting,
}: ApprovalBarProps) {
  if (status === 'deploying') {
    return (
      <div className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 flex items-center gap-2 text-teal-800 text-xs font-medium">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        Deploying… CloudFormation change set is running. Live events stream below.
      </div>
    );
  }

  if (status === 'deployed') {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-2 text-emerald-800 text-xs font-medium">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        Deployed successfully. Stack outputs are shown below.
      </div>
    );
  }

  if (status === 'deploy_failed') {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2 text-rose-800 text-xs font-medium">
          <XCircle className="h-4 w-4 shrink-0" />
          Deployment failed and rolled back. Review the logs, then retry if needed.
        </div>
        {onRetryDeploy && (
          <button
            type="button"
            onClick={onRetryDeploy}
            disabled={isSubmitting}
            className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 disabled:opacity-50 flex items-center gap-1.5 shrink-0"
          >
            {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            Retry deploy
          </button>
        )}
      </div>
    );
  }

  if (status === 'approved') {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-2 text-emerald-800 text-xs font-medium">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        Approved — waiting for deployment to start.
      </div>
    );
  }

  if (status === 'cancelled') {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 flex items-center gap-2 text-slate-600 text-xs font-medium">
        <XCircle className="h-4 w-4 shrink-0" />
        Deployment cancelled. You can edit the prompt and generate again.
      </div>
    );
  }

  if (status !== 'awaiting_approval') {
    return null;
  }

  return (
    <div className="rounded-xl border border-teal-200 bg-teal-50/60 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <p className="text-xs text-teal-900 font-medium">
        Review the diff, cost estimate, and security scan below. Nothing deploys until you approve.
      </p>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onApprove}
          disabled={isSubmitting}
          className="px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 disabled:opacity-50 flex items-center gap-1.5"
        >
          {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          Approve & Deploy
        </button>
      </div>
    </div>
  );
}
