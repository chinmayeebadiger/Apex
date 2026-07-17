import type { DiffRenderModel } from '../lib/types';

const colorClassByToken = {
  green: 'border-green-500 bg-green-50 text-green-900',
  blue: 'border-blue-500 bg-blue-50 text-blue-900',
  red: 'border-red-500 bg-red-50 text-red-900',
} as const;

interface DiffPanelProps {
  diff?: DiffRenderModel;
}

export function DiffPanel({ diff }: DiffPanelProps) {
  if (!diff || diff.resources.length === 0) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Infrastructure Diff</h3>
        <p className="mt-2 text-xs text-slate-400">No resource changes to preview.</p>
      </section>
    );
  }

  return (
    <section aria-label="Infrastructure diff" className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Infrastructure Diff</h3>
      <p className="text-sm font-medium text-slate-800">{diff.summary}</p>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {diff.resources.map((resource) => (
          <article
            key={resource.logicalId}
            className={`border-l-4 px-3 py-2 rounded-r-lg ${colorClassByToken[resource.color]}`}
          >
            <div className="text-sm font-semibold">{resource.logicalId}</div>
            <div className="text-xs capitalize">
              {resource.action} · {resource.resourceType}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
