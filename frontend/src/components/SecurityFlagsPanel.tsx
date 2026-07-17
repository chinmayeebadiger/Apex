import { ShieldAlert } from 'lucide-react';
import type { SecurityFlag } from '../lib/types';

interface SecurityFlagsPanelProps {
  flags?: SecurityFlag[];
}

export function SecurityFlagsPanel({ flags }: SecurityFlagsPanelProps) {
  if (!flags || flags.length === 0) {
    return (
      <section className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Security Scan</h3>
        <p className="mt-2 text-xs text-emerald-600">No high-risk misconfigurations detected.</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 space-y-2">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-amber-600" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-800">Security Scan</h3>
      </div>
      <ul className="space-y-2 max-h-40 overflow-y-auto">
        {flags.map((flag, index) => (
          <li key={`${flag.logicalId}-${index}`} className="text-xs rounded-lg bg-white/80 border border-amber-100 px-3 py-2">
            <div className="font-semibold text-slate-800">
              {flag.logicalId}
              <span className={`ml-2 uppercase text-[10px] ${flag.severity === 'high' ? 'text-rose-600' : 'text-amber-600'}`}>
                {flag.severity}
              </span>
            </div>
            <p className="text-slate-600 mt-0.5">{flag.message}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
