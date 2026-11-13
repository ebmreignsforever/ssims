import { ShieldCheck } from 'lucide-react';
import clsx from 'clsx';

export function Logo({ dark = false, compact = false }: { dark?: boolean; compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={clsx(
          'relative grid h-10 w-10 shrink-0 place-items-center rounded-xl',
          dark ? 'bg-white/10 ring-1 ring-white/15' : 'bg-ink-950 shadow-glow',
        )}
      >
        <ShieldCheck className="h-5 w-5 text-brand-300" strokeWidth={2.2} />
        {!compact && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-ink-950 bg-accent-400" />}
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className={clsx('text-lg font-extrabold tracking-tight', dark ? 'text-white' : 'text-ink-950')}>SSIMS</span>
          <span className={clsx('hidden rounded px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.12em] xl:inline', dark ? 'bg-brand-400/15 text-brand-200' : 'bg-brand-50 text-brand-700')}>
            Secure
          </span>
        </div>
        <p className={clsx('max-w-[190px] truncate text-[10px] font-medium tracking-wide', dark ? 'text-slate-400' : 'text-slate-500')}>
          Student Information System
        </p>
      </div>
    </div>
  );
}
