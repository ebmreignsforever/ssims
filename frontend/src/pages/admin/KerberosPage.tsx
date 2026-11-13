import { useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Fingerprint,
  KeyRound,
  Network,
  Play,
  Server,
  ShieldCheck,
  Ticket,
  UserRound,
  XCircle,
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { Badge, Button, Card, ErrorAlert, PageHeader, SectionHeader } from '../../components/ui';

interface KerberosStep {
  step: number;
  phase: string;
  from: string;
  to: string;
  title: string;
  detail: string;
  validation?: string;
  ticketPreview?: string;
  keyFingerprint?: string;
}

interface KerberosResult {
  simulation: true;
  notice: string;
  realm: string;
  client: string;
  service: string;
  steps: KerberosStep[];
  checks: {
    preAuthentication: boolean;
    tgtIssued: boolean;
    serviceTicketIssued: boolean;
    authenticatorFresh: boolean;
    mutualAuthentication: boolean;
    replayRejected: boolean;
  };
  result: 'passed' | 'failed';
  startedAt: string;
  completedAt: string;
  limitations: string[];
}

const FLOW = [
  { label: 'Client', sub: 'student principal', icon: UserRound },
  { label: 'Authentication Server', sub: 'verifies identity · issues TGT', icon: Server },
  { label: 'Ticket Granting Server', sub: 'issues service ticket', icon: Ticket },
  { label: 'File Service', sub: 'mutual authentication', icon: Network },
];

const CHECKS: { key: keyof KerberosResult['checks']; label: string }[] = [
  { key: 'preAuthentication', label: 'Pre-authentication' },
  { key: 'tgtIssued', label: 'TGT issued' },
  { key: 'serviceTicketIssued', label: 'Service ticket issued' },
  { key: 'authenticatorFresh', label: 'Authenticator fresh' },
  { key: 'mutualAuthentication', label: 'Mutual authentication' },
  { key: 'replayRejected', label: 'Replay rejected' },
];

export function KerberosPage() {
  const { error: toastError } = useToast();
  const [result, setResult] = useState<KerberosResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await api.post<KerberosResult>('/kerberos/simulate'));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'The simulation could not run.';
      setError(message);
      toastError('Kerberos simulation failed', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Centralised authentication education"
        title="Kerberos authentication simulation"
        description="Explore how a Kerberos realm uses an Authentication Server, Ticket Granting Server and service tickets to provide single sign-on with mutual authentication."
        actions={<Button leftIcon={Play} loading={loading} onClick={() => void run()}>Run simulation</Button>}
      />

      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <div className="text-[11px] leading-5 text-amber-900">
          <p className="font-bold uppercase tracking-wider">Educational simulation — not real Kerberos</p>
          <p className="mt-1">
            This module models Kerberos v5 message flow in-process with AES-256-GCM. It does not contact a KDC and is not
            wire-compatible with MIT krb5 or Active Directory. A real deployment requires a KDC, keytabs, service
            principals, reliable DNS and synchronised clocks.
          </p>
        </div>
      </div>

      {error && <ErrorAlert title="Simulation failed" message={error} onRetry={() => void run()} />}

      <Card className="overflow-hidden p-5 sm:p-6">
        <SectionHeader title="Protocol flow" description="Tickets are opaque to the client; long-term keys never travel across the network." />
        <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] lg:items-center">
          {FLOW.map((node, index) => {
            const Icon = node.icon;
            return (
              <div key={node.label} className="contents">
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-center">
                  <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-white text-brand-700 shadow-sm ring-1 ring-slate-200"><Icon className="h-5 w-5" /></div>
                  <p className="mt-2 text-[11px] font-bold text-ink-900">{node.label}</p>
                  <p className="mt-0.5 text-[9px] leading-4 text-slate-500">{node.sub}</p>
                </div>
                {index < FLOW.length - 1 && <ArrowRight className="mx-auto hidden h-4 w-4 text-slate-300 lg:block" />}
              </div>
            );
          })}
        </div>
        <div className="mt-4 grid gap-2 text-[10px] text-slate-500 sm:grid-cols-3">
          <div className="rounded-lg bg-slate-50 px-3 py-2"><span className="font-bold text-slate-700">TGT</span> — encrypted with the TGS long-term key, proves the client authenticated to the AS.</div>
          <div className="rounded-lg bg-slate-50 px-3 py-2"><span className="font-bold text-slate-700">Service ticket</span> — encrypted with the service key, grants access to one resource.</div>
          <div className="rounded-lg bg-slate-50 px-3 py-2"><span className="font-bold text-slate-700">Authenticator</span> — timestamp and nonce encrypted with a session key, defeats replay.</div>
        </div>
      </Card>

      {result && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CHECKS.map((check) => {
              const passed = result.checks[check.key];
              return (
                <div key={check.key} className={clsx('flex items-center gap-3 rounded-xl border p-4', passed ? 'border-brand-200 bg-brand-50/50' : 'border-rose-200 bg-rose-50/50')}>
                  <div className={clsx('grid h-9 w-9 place-items-center rounded-lg', passed ? 'bg-brand-100 text-brand-700' : 'bg-rose-100 text-rose-700')}>
                    {passed ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-slate-500">{check.label}</p>
                    <p className={clsx('text-xs font-bold', passed ? 'text-brand-800' : 'text-rose-800')}>{passed ? 'Verified' : 'Failed'}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-ink-950 px-5 py-4 text-white">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-300">Authentication transcript</p>
                <p className="mt-1 text-sm font-semibold">{result.client} → {result.service}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="amber" className="border-accent-400/20 bg-accent-400/10 text-accent-200">Simulated</Badge>
                <Badge tone={result.result === 'passed' ? 'brand' : 'rose'}>{result.result}</Badge>
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {result.steps.map((step) => (
                <div key={step.step} className="flex gap-4 px-5 py-4">
                  <div className="flex flex-col items-center">
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink-950 font-mono text-[10px] font-bold text-brand-300">{step.step}</div>
                    <div className="mt-1.5 flex-1 border-l border-dashed border-slate-200" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="slate">{step.phase}</Badge>
                      <span className="text-[9px] font-mono text-slate-400">{step.from} → {step.to}</span>
                    </div>
                    <p className="mt-1.5 text-xs font-bold text-ink-950">{step.title}</p>
                    <p className="mt-1 text-[11px] leading-5 text-slate-500">{step.detail}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {step.validation && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-1 text-[9px] font-semibold text-brand-800">
                          <ShieldCheck className="h-3 w-3" /> {step.validation}
                        </span>
                      )}
                      {step.keyFingerprint && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-2 py-1 font-mono text-[9px] text-slate-500">
                          <Fingerprint className="h-3 w-3" /> key {step.keyFingerprint}
                        </span>
                      )}
                    </div>
                    {step.ticketPreview && <p className="mt-1.5 truncate font-mono text-[9px] text-slate-400">{step.ticketPreview}</p>}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <SectionHeader title="Simulation boundaries" description="What this model does not prove." />
              <ul className="mt-3 space-y-2">
                {result.limitations.map((limitation) => (
                  <li key={limitation} className="flex items-start gap-2 text-[11px] leading-5 text-slate-600">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                    {limitation}
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="p-5">
              <SectionHeader title="Simulation vs real Kerberos" description="Clear separation prevents misleading claims." />
              <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 text-[10px]">
                <table className="w-full">
                  <thead className="bg-slate-50 text-left text-[9px] uppercase tracking-wider text-slate-400">
                    <tr><th className="px-3 py-2">Property</th><th className="px-3 py-2">This demo</th><th className="px-3 py-2">Real Kerberos</th></tr>
                  </thead>
                  <tbody>
                    {[
                      ['Key distribution', 'Derived in-process', 'KDC + principal keys'],
                      ['Wire protocol', 'None', 'AS/TGS/AP over UDP/TCP'],
                      ['Clock tolerance', '300 seconds', 'Configurable, DNS/NTP required'],
                      ['Service integration', 'Modelled', 'Keytab + SPNEGO'],
                      ['Replay cache', 'In-memory', 'Persistent per KDC'],
                    ].map((row) => (
                      <tr key={row[0]} className="border-t border-slate-100"><td className="px-3 py-2 font-medium text-slate-600">{row[0]}</td><td className="px-3 py-2 text-slate-500">{row[1]}</td><td className="px-3 py-2 text-slate-500">{row[2]}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[10px] text-slate-400">
            <span className="flex items-center gap-1.5"><Clock className="h-3 w-3" /> Started {new Date(result.startedAt).toLocaleString()} · completed {new Date(result.completedAt).toLocaleString()}</span>
            <span>Realm {result.realm}</span>
          </div>
        </>
      )}

      {!result && !loading && (
        <Card>
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-ink-950 text-brand-300"><KeyRound className="h-7 w-7" /></div>
            <h3 className="mt-4 text-base font-bold text-ink-950">Run the authentication exchange</h3>
            <p className="mt-1 max-w-md text-xs leading-5 text-slate-500">
              The simulation issues a TGT, requests a service ticket for the file server, performs mutual authentication
              and then attempts to replay a captured authenticator.
            </p>
            <Button className="mt-5" leftIcon={Play} loading={loading} onClick={() => void run()}>Start Kerberos simulation</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
