import { useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Code2,
  Database,
  FlaskConical,
  Gauge,
  Globe2,
  Info,
  KeyRound,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Webhook,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import type { LabTestDefinition, LabTestResult } from '../../types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorAlert,
  Modal,
  PageHeader,
  SectionHeader,
  buttonClasses,
} from '../../components/ui';
import { formatDateTime, timeAgo } from '../../utils/format';

const TEST_ICONS: Record<string, LucideIcon> = {
  'sql-injection': Database,
  'brute-force': KeyRound,
  xss: Code2,
  'unauthorized-access': ShieldX,
  mitm: Globe2,
  csrf: RefreshCw,
  'webhook-forgery': Webhook,
  ddos: Gauge,
};

interface RecentRun {
  id: string;
  test_key: string;
  name: string;
  status: 'passed' | 'failed' | 'info';
  actual: string;
  mechanism: string;
  evidence: Record<string, unknown>;
  created_at: string;
  run_by_name: string | null;
}

export function SecurityLabPage() {
  const { success, error: toastError } = useToast();
  const [catalog, setCatalog] = useState<LabTestDefinition[]>([]);
  const [results, setResults] = useState<Record<string, LabTestResult>>({});
  const [recent, setRecent] = useState<RecentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [suiteRunning, setSuiteRunning] = useState(false);
  const [selected, setSelected] = useState<LabTestResult | RecentRun | null>(null);
  const [suiteProgress, setSuiteProgress] = useState(0);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([api.get<LabTestDefinition[]>('/lab/catalog'), api.get<RecentRun[]>('/lab/results')])
      .then(([definitions, recentRuns]) => {
        setCatalog(definitions);
        setRecent(recentRuns);
      })
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const runOne = async (key: string, notify = true): Promise<LabTestResult | null> => {
    setRunning(key);
    try {
      const result = await api.post<LabTestResult>(`/lab/run/${key}`);
      setResults((current) => ({ ...current, [key]: result }));
      if (notify) {
        if (result.status === 'passed') success(`${result.name} passed`, result.actual.slice(0, 140));
        else if (result.status === 'info') toastError(`${result.name} returned information`, result.actual.slice(0, 140));
        else toastError(`${result.name} failed`, result.actual.slice(0, 140));
      }
      const latest = await api.get<RecentRun[]>('/lab/results');
      setRecent(latest);
      return result;
    } catch (caught) {
      if (notify) toastError('Test could not run', caught instanceof Error ? caught.message : undefined);
      return null;
    } finally {
      setRunning(null);
    }
  };

  const runSuite = async () => {
    setSuiteRunning(true);
    setSuiteProgress(0);
    for (const [index, test] of catalog.entries()) {
      await runOne(test.key, false);
      setSuiteProgress(index + 1);
    }
    setSuiteRunning(false);
    success('Security test suite complete', 'Review each result and the append-only evidence log.');
  };

  const resetAccount = async () => {
    try {
      await api.post('/lab/reset-account');
      success('Laboratory account restored', 'The isolated brute-force target is active again.');
    } catch (caught) {
      toastError('Reset failed', caught instanceof Error ? caught.message : undefined);
    }
  };

  const passed = Object.values(results).filter((result) => result.status === 'passed').length;
  const failed = Object.values(results).filter((result) => result.status === 'failed').length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Authorized adversary simulation"
        title="Security Testing Lab"
        description="Deliberately exercise the controls that protect SSIMS. Every test runs only against this local application and is recorded as evidence."
        actions={
          <>
            <Button variant="outline" leftIcon={RotateCcw} onClick={() => void resetAccount()}>Reset lab account</Button>
            <Button variant="dark" leftIcon={Play} loading={suiteRunning} onClick={() => void runSuite()} disabled={loading || Boolean(running)}>
              Run full suite
            </Button>
          </>
        }
      />

      <section className="security-panel relative overflow-hidden rounded-2xl border border-white/10 p-6 text-white sm:p-7">
        <div className="absolute inset-0 grid-overlay opacity-60" />
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-rose-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-accent-300">
              <FlaskConical className="h-4 w-4" /> Controlled environment · local only
            </div>
            <h2 className="mt-3 text-2xl font-bold tracking-tight">Test the controls. Prove the defence.</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Eight exercises map directly to SQL injection, brute force, XSS, broken access control, MITM, CSRF,
              forged webhooks and request flooding. Tests return the mechanism responsible and immutable evidence.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge tone="amber" className="border-accent-400/20 bg-accent-400/10 text-accent-200">Authorized academic testing</Badge>
              <Badge tone="slate" className="border-white/10 bg-white/5 text-slate-300">Low-volume only</Badge>
              <Badge tone="slate" className="border-white/10 bg-white/5 text-slate-300">No external targets</Badge>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Available', value: catalog.length, tone: 'text-white' },
              { label: 'Passed', value: passed, tone: 'text-brand-300' },
              { label: 'Failed', value: failed, tone: 'text-rose-300' },
            ].map((item) => (
              <div key={item.label} className="min-w-[82px] rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-center">
                <p className={clsx('text-2xl font-extrabold', item.tone)}>{item.value}</p>
                <p className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
        {suiteRunning && (
          <div className="relative mt-5 rounded-xl border border-white/10 bg-white/[0.04] p-3.5">
            <div className="flex items-center justify-between text-[10px] font-semibold text-slate-300">
              <span>Running the full test suite…</span>
              <span>{suiteProgress} / {catalog.length}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-brand-400 transition-all" style={{ width: `${catalog.length ? (suiteProgress / catalog.length) * 100 : 0}%` }} />
            </div>
          </div>
        )}
      </section>

      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <p className="text-[11px] leading-5 text-amber-900">
          <span className="font-bold">Authorized use only.</span> These simulations are restricted to the local SSIMS
          deployment and an isolated laboratory account. They must never be pointed at third-party systems. The brute-force
          test intentionally leaves its target account locked until restored.
        </p>
      </div>

      {error && <ErrorAlert title="The laboratory could not load" message={error} onRetry={load} />}

      <div className="grid gap-4 xl:grid-cols-2">
        {catalog.map((test, index) => {
          const Icon = TEST_ICONS[test.key] || ShieldCheck;
          const result = results[test.key];
          const isRunning = running === test.key;
          return (
            <Card key={test.key} className={clsx('relative overflow-hidden p-5 transition', result?.status === 'passed' && 'border-brand-200', result?.status === 'failed' && 'border-rose-200')}>
              <div className={clsx('absolute left-0 top-0 h-full w-1', result?.status === 'passed' ? 'bg-brand-500' : result?.status === 'failed' ? 'bg-rose-500' : result?.status === 'info' ? 'bg-sky-500' : 'bg-slate-200')} />
              <div className="flex items-start justify-between gap-3 pl-1">
                <div className="flex items-start gap-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-ink-950 text-brand-300">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[9px] font-bold text-slate-400">TEST {String(index + 1).padStart(2, '0')}</span>
                      <Badge tone="slate">{test.category}</Badge>
                    </div>
                    <h3 className="mt-1 text-sm font-bold text-ink-950">{test.name}</h3>
                  </div>
                </div>
                {result ? (
                  <Badge tone={result.status === 'passed' ? 'brand' : result.status === 'failed' ? 'rose' : 'blue'}>
                    {result.status === 'passed' ? <CheckCircle2 className="h-3 w-3" /> : result.status === 'failed' ? <XCircle className="h-3 w-3" /> : <Info className="h-3 w-3" />}
                    {result.status}
                  </Badge>
                ) : (
                  <Badge tone="outline">Ready</Badge>
                )}
              </div>

              <p className="mt-4 line-clamp-3 pl-1 text-xs leading-5 text-slate-500">{test.description}</p>

              <div className="mt-4 rounded-xl bg-slate-50 p-3 pl-4">
                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Defence under test</p>
                <p className="mt-1 text-[10.5px] leading-5 text-slate-600">{test.mechanism}</p>
              </div>

              {result && (
                <div className={clsx('mt-3 rounded-lg border p-3 text-[11px] leading-5', result.status === 'passed' ? 'border-brand-100 bg-brand-50/60 text-brand-900' : result.status === 'failed' ? 'border-rose-100 bg-rose-50/60 text-rose-900' : 'border-sky-100 bg-sky-50/60 text-sky-900')}>
                  {result.actual}
                </div>
              )}

              <div className="mt-4 flex items-center justify-between gap-2 pl-1">
                <span className="text-[9px] text-slate-400">Expected: {test.expected.slice(0, 70)}…</span>
                <div className="flex items-center gap-1.5">
                  {result && <Button size="sm" variant="ghost" onClick={() => setSelected(result)}>Evidence</Button>}
                  <Button size="sm" variant={result ? 'outline' : 'dark'} leftIcon={Play} loading={isRunning} onClick={() => void runOne(test.key)} disabled={suiteRunning || Boolean(running && !isRunning)}>
                    {result ? 'Run again' : 'Run test'}
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <SectionHeader title="Evidence ledger" description="Test runs are append-only and visible to administrators." />
          <Button size="sm" variant="outline" leftIcon={RefreshCw} onClick={load}>Refresh</Button>
        </div>
        {recent.length === 0 ? (
          <EmptyState icon={FlaskConical} title="No test runs yet" message="Run a laboratory exercise to create the first evidence record." compact />
        ) : (
          <div className="table-shell">
            <table>
              <thead><tr><th>Test</th><th>Status</th><th>Run by</th><th>Mechanism</th><th>Timestamp</th><th className="text-right">Evidence</th></tr></thead>
              <tbody>
                {recent.map((run) => (
                  <tr key={run.id}>
                    <td className="text-xs font-semibold text-ink-900">{run.name}</td>
                    <td><Badge tone={run.status === 'passed' ? 'brand' : run.status === 'failed' ? 'rose' : 'blue'}>{run.status}</Badge></td>
                    <td className="text-[11px]">{run.run_by_name || 'Administrator'}</td>
                    <td className="max-w-[260px] truncate text-[10px] text-slate-400">{run.mechanism}</td>
                    <td><p className="text-[11px]">{formatDateTime(run.created_at)}</p><p className="text-[9px] text-slate-400">{timeAgo(run.created_at)}</p></td>
                    <td className="text-right"><button type="button" onClick={() => setSelected(run)} className="rounded-lg px-2 py-1 text-[10px] font-bold text-brand-700 hover:bg-brand-50">View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.name || 'Test evidence'}
        description={selected && 'testKey' in selected ? `${selected.testKey} · ${formatDateTime(selected.createdAt)}` : selected ? `${selected.test_key} · ${formatDateTime(selected.created_at)}` : undefined}
        size="lg"
        footer={<Button variant="outline" onClick={() => setSelected(null)}>Close evidence</Button>}
      >
        {selected && <EvidenceView run={selected} />}
      </Modal>
    </div>
  );
}

function EvidenceView({ run }: { run: LabTestResult | RecentRun }) {
  const isResult = 'testKey' in run;
  const status = run.status;
  const evidence = run.evidence;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={status === 'passed' ? 'brand' : status === 'failed' ? 'rose' : 'blue'}>{status}</Badge>
        <Badge tone="outline">{run.mechanism}</Badge>
      </div>
      {isResult && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Test procedure</p>
            <p className="mt-1.5 text-[11px] leading-5 text-slate-600">{run.procedure}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Expected result</p>
            <p className="mt-1.5 text-[11px] leading-5 text-slate-600">{run.expected}</p>
          </div>
        </div>
      )}
      <div className="rounded-xl border border-slate-200 p-4">
        <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Actual result</p>
        <p className="mt-1.5 text-xs leading-6 text-slate-700">{run.actual}</p>
      </div>
      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-400"><Activity className="h-3 w-3" /> Structured evidence</p>
        <pre className="terminal max-h-[340px]">{JSON.stringify(evidence, null, 2)}</pre>
      </div>
      <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-[10px] leading-5 text-slate-500">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-700" />
        Evidence is stored in the append-only security_test_runs table and cannot be edited or deleted through application permissions.
      </div>
    </div>
  );
}
