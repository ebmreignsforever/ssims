import { ReactNode } from 'react';
import { Fingerprint, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react';
import { Logo } from '../components/Logo';

const FEATURES = [
  { icon: Fingerprint, title: 'Identity-first access', text: 'TOTP MFA, Argon2id passwords and rotating sessions.' },
  { icon: ShieldCheck, title: 'Verified every request', text: 'Server-enforced RBAC and append-only audit trails.' },
  { icon: LockKeyhole, title: 'Encrypted end to end', text: 'HTTPS at the edge and TLS to PostgreSQL.' },
];

export function AuthLayout({
  children,
  title,
  subtitle,
  footer,
  wide = false,
}: {
  children: ReactNode;
  title: string;
  subtitle: string;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="flex min-h-screen bg-canvas">
      <aside className="relative hidden w-[43%] flex-col overflow-hidden bg-ink-950 p-10 lg:flex xl:w-[45%] xl:p-14">
        <div className="absolute inset-0 bg-grid-dark bg-[size:36px_36px] opacity-60" />
        <div className="absolute -left-20 top-1/4 h-80 w-80 rounded-full bg-brand-500/10 blur-3xl" />
        <div className="absolute -right-24 bottom-0 h-96 w-96 rounded-full bg-accent-500/10 blur-3xl" />
        <div className="relative z-10 flex h-full flex-col">
          <Logo dark />
          <div className="my-auto max-w-lg py-16">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-brand-200">
              <Sparkles className="h-3.5 w-3.5 text-accent-400" />
              Cyber-secured academic platform
            </div>
            <h2 className="text-balance text-[34px] font-bold leading-[1.15] tracking-tight text-white xl:text-[40px]">
              Student records.
              <br />
              <span className="text-brand-300">Protected by design.</span>
            </h2>
            <p className="mt-5 max-w-md text-sm leading-7 text-slate-400">
              A university information system where every login, change and sensitive record access is authenticated,
              authorised and audited.
            </p>
            <div className="mt-10 space-y-5">
              {FEATURES.map((feature) => {
                const Icon = feature.icon;
                return (
                  <div key={feature.title} className="flex items-start gap-3.5">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5">
                      <Icon className="h-4 w-4 text-brand-300" />
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold text-white">{feature.title}</p>
                      <p className="mt-0.5 text-xs leading-5 text-slate-400">{feature.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="relative z-10 flex items-center justify-between border-t border-white/10 pt-5 text-[10px] uppercase tracking-[0.16em] text-slate-500">
            <span>SSIMS University · IT Security</span>
            <span className="flex items-center gap-1.5 text-brand-300">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
              Systems operational
            </span>
          </div>
        </div>
      </aside>

      <main className="flex flex-1 flex-col px-5 py-6 sm:px-10 lg:px-14">
        <div className="flex items-center justify-between lg:hidden">
          <Logo />
          <span className="rounded-full border border-brand-100 bg-brand-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-brand-700">
            Secure portal
          </span>
        </div>
        <div className={`mx-auto flex w-full flex-1 flex-col justify-center py-10 ${wide ? 'max-w-2xl' : 'max-w-[430px]'}`}>
          <div className="mb-8">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-brand-700">SSIMS Identity Portal</p>
            <h1 className="text-3xl font-bold tracking-tight text-ink-950">{title}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">{subtitle}</p>
          </div>
          {children}
          {footer && <div className="mt-8 text-center text-sm text-slate-500">{footer}</div>}
        </div>
        <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 text-[10px] text-slate-400">
          <span>© {new Date().getFullYear()} SSIMS University</span>
          <span className="flex items-center gap-1.5">
            <LockKeyhole className="h-3 w-3" /> Encrypted session · SameSite cookies · CSRF protected
          </span>
        </div>
      </main>
    </div>
  );
}
