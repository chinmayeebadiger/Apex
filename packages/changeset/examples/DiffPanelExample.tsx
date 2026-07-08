import type { DiffRenderModel } from '../src/index.js';

const colorClassByToken = {
  green: 'border-green-500 bg-green-50 text-green-900',
  blue: 'border-blue-500 bg-blue-50 text-blue-900',
  red: 'border-red-500 bg-red-50 text-red-900',
} as const;

export const DiffPanelExample = ({ diff }: { diff: DiffRenderModel }) => (
  <section aria-label="Infrastructure diff" className="space-y-3">
    <p className="text-sm font-medium text-slate-800">{diff.summary}</p>
    <div className="space-y-2">
      {diff.resources.map((resource) => (
        <article
          key={resource.logicalId}
          className={`border-l-4 px-3 py-2 ${colorClassByToken[resource.color]}`}
        >
          <div className="text-sm font-semibold">{resource.logicalId}</div>
          <div className="text-xs">
            {resource.action} · {resource.resourceType}
          </div>
        </article>
      ))}
    </div>
  </section>
);
