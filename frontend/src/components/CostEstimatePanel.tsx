import type { CostEstimate } from '../lib/types';

interface CostEstimatePanelProps {
  costEstimate?: CostEstimate;
}

export function CostEstimatePanel({ costEstimate }: CostEstimatePanelProps) {
  if (!costEstimate) {
    return null;
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Monthly Cost Estimate</h3>
        <span className="text-sm font-bold text-teal-700">
          ${costEstimate.totalMonthlyCostUSD.toFixed(2)}/mo
        </span>
      </div>
      <ul className="space-y-2 max-h-40 overflow-y-auto">
        {costEstimate.resourceEstimates.map((estimate) => (
          <li key={estimate.logicalId} className="text-xs border-b border-slate-100 pb-2 last:border-0">
            <div className="flex justify-between font-medium text-slate-700">
              <span>{estimate.logicalId}</span>
              <span>${estimate.monthlyCostUSD.toFixed(2)}</span>
            </div>
            <p className="text-[10px] text-slate-400 mt-0.5">{estimate.basis}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
