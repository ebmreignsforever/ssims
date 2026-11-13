import { FormEvent, useEffect, useState } from 'react';
import {
  Database,
  Download,
  Eye,
  FileWarning,
  Filter,
  Globe,
  Info,
  LogIn,
  Network,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { api, ApiError, downloadSecurityCsv, fieldErrors, qs } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import type { PaginatedMeta, SecurityEvent, Severity } from '../../types';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorAlert,
  Input,
  Modal,
  PageHeader,
  Pagination,
  SectionHeader,
  Select,
  SeverityBadge,
  SkeletonTable,
  Tab,
  Tabs,
  TextArea,
} from '../../components/ui';
import { formatDateTime, timeAgo, titleCase } from '../../utils/format';

const EVENT_TYPES = [
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'MFA_VERIFICATION_FAILED',
  'ACCOUNT_LOCKED',
  'UNAUTHORIZED_ACCESS',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET_REQUESTED',
  'CSRF_REJECTED',
  'RATE_LIMIT_TRIGGERED',
  'WEBHOOK_SIGNATURE_REJECTED',
  'SQL_INJECTION_ATTEMPT',
  'XSS_PAYLOAD_BLOCKED',
  'IP_ACCESS_BLOCKED',
  'ROLE_CHANGED',
  'ACCOUNT_STATUS_CHANGED',
  'SECURITY_POLICY_UPDATED',
  'SECURITY_TEST_RUN',
];

export function SecurityMonitoringPage() {
  const [tab, setTab] = useState('events');
  const { user } = useAuth();
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Security operations centre"
        title="Monitoring & audit"
        description="Investigate authentication activity, administrative actions and database-level changes. Security records are append-only."
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge tone="brand"><ShieldCheck className="h-3 w-3" /> Immutable audit</Badge>
            <Badge tone="amber"><FileWarning className="h-3 w-3" /> Admin only</Badge>
          </div>
        }
      />
      <Tabs value={tab} onChange={setTab}>
        <Tab value="events" icon={ShieldAlert}>Security events</Tab>
        <Tab value="logins" icon={LogIn}>Login attempts</Tab>
        <Tab value="audit" icon={Database}>Database audit</Tab>
        <Tab value="policies" icon={SlidersHorizontal}>Access policy</Tab>
        <Tab value="network" icon={Network}>IP restrictions</Tab>
      </Tabs>
      {tab === 'events' && <EventsTab />}
      {tab === 'logins' && <LoginAttemptsTab />}
      {tab === 'audit' && <AuditTab />}
      {tab === 'policies' && <PoliciesTab canEdit={user?.role === 'super_admin'} />}
      {tab === 'network' && <IpRulesTab />}
    </div>
  );
}

function EventsTab() {
  const { success, error: toastError } = useToast();
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [meta, setMeta] = useState<PaginatedMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [severity, setSeverity] = useState('');
  const [eventType, setEventType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<SecurityEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  const params = (includePage: boolean) => ({
    ...(includePage ? { page, limit: 20 } : { limit: 5000 }),
    severity,
    eventType,
    search,
    from: from ? new Date(`${from}T00:00:00`).toISOString() : '',
    to: to ? new Date(`${to}T23:59:59`).toISOString() : '',
  });

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .getWithMeta<SecurityEvent[]>(`/security/events${qs(params(true))}`)
      .then((response) => {
        setEvents(response.data);
        if (response.meta) setMeta(response.meta as unknown as PaginatedMeta);
      })
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [page, severity, eventType, search, from, to]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadSecurityCsv(`/security/events/export.csv${qs(params(false))}`);
      success('Security log exported');
    } catch (caught) {
      toastError('Export failed', caught instanceof Error ? caught.message : undefined);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <label className="field-label">Search</label>
            <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} className="field-input pl-10" placeholder="Description, actor, IP or event type…" />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:w-auto">
            <Select label="Severity" value={severity} onChange={(event) => { setSeverity(event.target.value); setPage(1); }} containerClassName="min-w-[120px]">
              <option value="">All</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="info">Info</option>
            </Select>
            <Select label="Event type" value={eventType} onChange={(event) => { setEventType(event.target.value); setPage(1); }} containerClassName="min-w-[160px]">
              <option value="">All types</option>
              {EVENT_TYPES.map((type) => <option key={type} value={type}>{titleCase(type)}</option>)}
            </Select>
            <Input label="From" type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} />
            <Input label="To" type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} />
          </div>
          <Button variant="outline" leftIcon={Download} loading={exporting} onClick={() => void exportCsv()} className="shrink-0">Export CSV</Button>
        </div>
      </Card>

      {error && <ErrorAlert title="Could not load security events" message={error} onRetry={load} />}

      <Card className="overflow-hidden">
        {loading ? (
          <SkeletonTable rows={7} />
        ) : events.length === 0 ? (
          <EmptyState icon={Filter} title="No events match the filters" message="Adjust the severity, event type, date range or search text." />
        ) : (
          <>
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>Severity</th>
                    <th>Event</th>
                    <th>Actor</th>
                    <th>Source IP</th>
                    <th>Timestamp</th>
                    <th className="text-right">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id}>
                      <td><SeverityBadge severity={event.severity} /></td>
                      <td>
                        <p className="text-xs font-semibold text-ink-900">{event.event_type.replace(/_/g, ' ')}</p>
                        <p className="mt-0.5 max-w-md truncate text-[10px] text-slate-400">{event.description}</p>
                      </td>
                      <td>
                        <p className="text-[11px] text-slate-700">{event.full_name || event.actor_email || 'System'}</p>
                        {event.full_name && <p className="text-[9px] text-slate-400">{event.actor_email}</p>}
                      </td>
                      <td className="font-mono text-[11px]">{event.ip || '—'}</td>
                      <td>
                        <p className="text-[11px]">{formatDateTime(event.occurred_at)}</p>
                        <p className="text-[9px] text-slate-400">{timeAgo(event.occurred_at)}</p>
                      </td>
                      <td className="text-right">
                        <button type="button" onClick={() => setSelected(event)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-ink-900" aria-label="View event">
                          <Eye className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={meta.page} totalPages={meta.totalPages} total={meta.total} onChange={setPage} />
          </>
        )}
      </Card>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.event_type.replace(/_/g, ' ') || 'Security event'}
        description={selected ? formatDateTime(selected.occurred_at) : undefined}
        size="md"
        footer={<Button variant="outline" onClick={() => setSelected(null)}>Close</Button>}
      >
        {selected && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={selected.severity} />
              <Badge tone="slate">Event #{selected.id}</Badge>
              {selected.request_id && <Badge tone="outline">Req {selected.request_id.slice(0, 8)}</Badge>}
            </div>
            <p className="text-sm leading-6 text-slate-700">{selected.description}</p>
            <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
              {[
                ['Actor', selected.full_name || selected.actor_email || 'System'],
                ['Email', selected.actor_email || '—'],
                ['Source IP', selected.ip || '—'],
                ['User ID', selected.user_id || '—'],
                ['Request ID', selected.request_id || '—'],
                ['User-agent', selected.user_agent || '—'],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
                  <p className="mt-0.5 break-all text-[11px] text-slate-700">{value}</p>
                </div>
              ))}
            </div>
            <div>
              <p className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">Structured metadata</p>
              <pre className="max-h-72 overflow-auto rounded-xl bg-ink-950 p-4 font-mono text-[11px] leading-5 text-brand-200">{JSON.stringify(selected.metadata, null, 2)}</pre>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 text-[10px] leading-5 text-slate-500">
              This record is append-only. The database rejects UPDATE and DELETE operations on security events, even from the application role.
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function LoginAttemptsTab() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [meta, setMeta] = useState<PaginatedMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api
      .getWithMeta<Record<string, unknown>[]>(`/security/login-attempts${qs({ page, limit: 20 })}`)
      .then((response) => { setRows(response.data); if (response.meta) setMeta(response.meta as unknown as PaginatedMeta); })
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [page]);

  return (
    <div className="space-y-4">
      <Card className="flex items-start gap-3 border-sky-100 bg-sky-50/50 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
        <p className="text-[11px] leading-5 text-sky-900">
          Every authentication attempt is recorded with its source IP and failure reason. Passwords and tokens are never
          included. Repeated failures drive progressive challenge and account lockout.
        </p>
      </Card>
      {error && <ErrorAlert title="Could not load login attempts" message={error} onRetry={load} />}
      <Card className="overflow-hidden">
        {loading ? <SkeletonTable rows={6} /> : rows.length === 0 ? <EmptyState title="No login attempts recorded" compact icon={LogIn} /> : (
          <>
            <div className="table-shell">
              <table>
                <thead><tr><th>Account</th><th>Result</th><th>Reason</th><th>Source IP</th><th>Timestamp</th></tr></thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={String(row.id)}>
                      <td>
                        <p className="text-xs font-semibold text-ink-900">{String(row.full_name || row.email)}</p>
                        <p className="text-[10px] text-slate-400">{String(row.email)}</p>
                      </td>
                      <td>{row.successful ? <Badge tone="brand"><UserCheck className="h-3 w-3" /> Success</Badge> : <Badge tone="rose">Failed</Badge>}</td>
                      <td className="text-[11px] capitalize">{String(row.failure_reason || '—').replace(/_/g, ' ')}</td>
                      <td className="font-mono text-[11px]">{row.ip ? String(row.ip) : '—'}</td>
                      <td className="text-[11px]">{formatDateTime(String(row.created_at))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={meta.page} totalPages={meta.totalPages} total={meta.total} onChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}

function AuditTab() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [meta, setMeta] = useState<PaginatedMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);

  const load = () => {
    setLoading(true);
    api
      .getWithMeta<Record<string, unknown>[]>(`/security/audit-log${qs({ page, limit: 20 })}`)
      .then((response) => { setRows(response.data); if (response.meta) setMeta(response.meta as unknown as PaginatedMeta); })
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [page]);

  return (
    <div className="space-y-4">
      <Card className="flex items-start gap-3 border-amber-100 bg-amber-50/50 p-4">
        <Database className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <p className="text-[11px] leading-5 text-amber-900">
          PostgreSQL triggers capture row-level changes to users, grades, courses, enrollments and departments. Sensitive
          columns such as password hashes and MFA secrets are redacted before an audit record is written.
        </p>
      </Card>
      {error && <ErrorAlert title="Could not load the database audit trail" message={error} onRetry={load} />}
      <Card className="overflow-hidden">
        {loading ? <SkeletonTable rows={7} /> : rows.length === 0 ? <EmptyState title="No database audit records" compact icon={Database} /> : (
          <>
            <div className="table-shell">
              <table>
                <thead><tr><th>Table</th><th>Operation</th><th>Row</th><th>Changed by</th><th>Timestamp</th><th className="text-right">Changes</th></tr></thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={String(row.id)}>
                      <td className="font-mono text-[11px]">{String(row.table_name)}</td>
                      <td><Badge tone={row.operation === 'DELETE' ? 'rose' : row.operation === 'INSERT' ? 'brand' : 'amber'}>{String(row.operation)}</Badge></td>
                      <td className="max-w-[160px] truncate font-mono text-[10px]">{String(row.row_pk || '—')}</td>
                      <td className="max-w-[180px] truncate font-mono text-[10px]">{String(row.changed_by || 'database')}</td>
                      <td className="text-[11px]">{formatDateTime(String(row.changed_at))}</td>
                      <td className="text-right"><button type="button" onClick={() => setSelected(row)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-ink-900" aria-label="View row changes"><Eye className="h-4 w-4" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={meta.page} totalPages={meta.totalPages} total={meta.total} onChange={setPage} />
          </>
        )}
      </Card>
      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title="Database row changes" description={selected ? `${selected.table_name} · ${selected.operation}` : undefined} size="lg" footer={<Button variant="outline" onClick={() => setSelected(null)}>Close</Button>}>
        {selected && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div><p className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">Before</p><pre className="max-h-80 overflow-auto rounded-xl bg-slate-50 p-4 font-mono text-[11px] leading-5 text-slate-700">{JSON.stringify(selected.old_data, null, 2) || '—'}</pre></div>
            <div><p className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">After</p><pre className="max-h-80 overflow-auto rounded-xl bg-ink-950 p-4 font-mono text-[11px] leading-5 text-brand-200">{JSON.stringify(selected.new_data, null, 2) || '—'}</pre></div>
          </div>
        )}
      </Modal>
    </div>
  );
}

interface PolicyData {
  max_login_attempts: number;
  lockout_minutes: number;
  challenge_after_failures: number;
  password_history_count: number;
  session_timeout_minutes: number;
  require_mfa_for_admins: boolean;
  require_mfa_for_lecturers: boolean;
  password_max_age_days: number;
  updated_at?: string;
}

function PoliciesTab({ canEdit }: { canEdit: boolean }) {
  const { success, error: toastError } = useToast();
  const { refreshUser } = useAuth();
  const [policy, setPolicy] = useState<PolicyData | null>(null);
  const [form, setForm] = useState<PolicyData | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<PolicyData>('/security/policies')
      .then((data) => { setPolicy(data); setForm(data); })
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setErrors({});
    try {
      const updated = await api.patch<PolicyData>('/security/policies', {
        maxLoginAttempts: form.max_login_attempts,
        lockoutMinutes: form.lockout_minutes,
        challengeAfterFailures: form.challenge_after_failures,
        passwordHistoryCount: form.password_history_count,
        sessionTimeoutMinutes: form.session_timeout_minutes,
        requireMfaForAdmins: form.require_mfa_for_admins,
        requireMfaForLecturers: form.require_mfa_for_lecturers,
        passwordMaxAgeDays: form.password_max_age_days,
      });
      setPolicy(updated);
      setForm(updated);
      success('Security policy updated', 'The new limits apply to the next authentication attempt.');
      // Refresh the current user so a newly enforced MFA policy immediately
      // redirects the acting administrator to the enrollment screen.
      await refreshUser();
    } catch (caught) {
      setErrors(fieldErrors(caught));
      toastError('Policy update rejected', caught instanceof Error ? caught.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonTable rows={6} />;
  if (error || !form) return <ErrorAlert title="Could not load security policy" message={error || undefined} />;

  return (
    <form onSubmit={submit} className="space-y-4">
      {!canEdit && (
        <Card className="flex items-start gap-3 border-amber-100 bg-amber-50/60 p-4">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <p className="text-[11px] leading-5 text-amber-900">Only the Super Administrator can modify access policy. You have read-only access.</p>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <SectionHeader title="Authentication thresholds" description="Applied by the API on every login and refresh." />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Input label="Max failed login attempts" type="number" min={3} max={20} value={form.max_login_attempts} onChange={(event) => setForm({ ...form, max_login_attempts: Number(event.target.value) })} disabled={!canEdit} error={errors.maxLoginAttempts} />
            <Input label="Lockout duration (minutes)" type="number" min={1} max={1440} value={form.lockout_minutes} onChange={(event) => setForm({ ...form, lockout_minutes: Number(event.target.value) })} disabled={!canEdit} error={errors.lockoutMinutes} />
            <Input label="Challenge after failures" type="number" min={1} max={10} value={form.challenge_after_failures} onChange={(event) => setForm({ ...form, challenge_after_failures: Number(event.target.value) })} disabled={!canEdit} error={errors.challengeAfterFailures} />
            <Input label="Session idle timeout (minutes)" type="number" min={5} max={1440} value={form.session_timeout_minutes} onChange={(event) => setForm({ ...form, session_timeout_minutes: Number(event.target.value) })} disabled={!canEdit} error={errors.sessionTimeoutMinutes} />
          </div>
        </Card>
        <Card className="p-5">
          <SectionHeader title="Password governance" description="Applies to new passwords and forced rotations." />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Input label="Password history depth" type="number" min={1} max={20} value={form.password_history_count} onChange={(event) => setForm({ ...form, password_history_count: Number(event.target.value) })} disabled={!canEdit} error={errors.passwordHistoryCount} />
            <Input label="Maximum password age (days)" type="number" min={30} max={3650} value={form.password_max_age_days} onChange={(event) => setForm({ ...form, password_max_age_days: Number(event.target.value) })} disabled={!canEdit} error={errors.passwordMaxAgeDays} />
          </div>
          <div className="mt-4 space-y-3">
            {[
              { key: 'require_mfa_for_admins' as const, label: 'Require MFA for administrators', note: 'Non-compliant sessions are restricted to MFA enrollment.' },
              { key: 'require_mfa_for_lecturers' as const, label: 'Require MFA for lecturers', note: 'Non-compliant sessions are restricted to MFA enrollment.' },
            ].map((item) => (
              <label key={item.key} className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-slate-200 p-3">
                <div>
                  <p className="text-xs font-semibold text-ink-900">{item.label}</p>
                  <p className="mt-0.5 text-[10px] text-slate-500">{item.note}</p>
                </div>
                <input type="checkbox" checked={form[item.key]} onChange={(event) => setForm({ ...form, [item.key]: event.target.checked })} disabled={!canEdit} className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
              </label>
            ))}
          </div>
        </Card>
      </div>
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-[10px] leading-5 text-slate-500">Policy changes are written to the security event log with the acting administrator, timestamp and changed fields.</p>
        <Button type="submit" loading={saving} disabled={!canEdit}>Save policy</Button>
      </Card>
    </form>
  );
}

interface IpRule {
  id: string;
  cidr: string;
  action: 'allow' | 'deny';
  reason: string;
  expires_at: string | null;
  created_at: string;
}

function IpRulesTab() {
  const { success, error: toastError } = useToast();
  const [rules, setRules] = useState<IpRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ cidr: '', action: 'deny' as 'allow' | 'deny', reason: '' });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<IpRule | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api.get<IpRule[]>('/security/ip-rules').then(setRules).catch((caught: Error) => setError(caught.message)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFormErrors({});
    try {
      await api.post('/security/ip-rules', form);
      success('Network rule created', 'The rule cache refreshes within 30 seconds.');
      setForm({ cidr: '', action: 'deny', reason: '' });
      load();
    } catch (caught) {
      setFormErrors(fieldErrors(caught));
      toastError('Rule could not be created', caught instanceof Error ? caught.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.delete(`/security/ip-rules/${deleting.id}`);
      success('Network rule removed');
      setDeleting(null);
      load();
    } catch (caught) {
      toastError('Rule could not be removed', caught instanceof Error ? caught.message : undefined);
    } finally {
      setDeleteBusy(false);
    }
  };

  const allowRules = rules.filter((rule) => rule.action === 'allow').length;

  return (
    <div className="space-y-4">
      <Card className="flex items-start gap-3 border-amber-100 bg-amber-50/60 p-4">
        <Globe className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <div className="text-[11px] leading-5 text-amber-900">
          <p className="font-bold">Network access control</p>
          <p>Deny rules always take precedence. If any allow rule exists, the API switches to default-deny and only listed networks can connect. Add an allow rule for your own network before relying on allow-list mode.</p>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
        <Card className="p-5">
          <SectionHeader title="Add network rule" description="Use IPv4 or IPv6 CIDR notation." />
          <form onSubmit={add} className="mt-4 space-y-3">
            <Input label="CIDR range" value={form.cidr} onChange={(event) => setForm({ ...form, cidr: event.target.value })} placeholder="203.0.113.0/24" error={formErrors.cidr} required />
            <Select label="Action" value={form.action} onChange={(event) => setForm({ ...form, action: event.target.value as 'allow' | 'deny' })}>
              <option value="deny">Deny access</option>
              <option value="allow">Allow access</option>
            </Select>
            <TextArea label="Reason" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Why is this rule required?" error={formErrors.reason} />
            <Button type="submit" leftIcon={Plus} loading={saving} className="w-full">Create rule</Button>
          </form>
        </Card>
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <SectionHeader title="Active rules" description={allowRules > 0 ? 'Allow-list mode is active (default deny).' : 'No allow rules; only explicit denials are enforced.'} />
            <Badge tone={allowRules > 0 ? 'amber' : 'slate'}>{rules.length} rules</Badge>
          </div>
          {loading ? <SkeletonTable rows={4} /> : error ? <ErrorAlert title="Could not load rules" message={error} onRetry={load} /> : rules.length === 0 ? (
            <EmptyState icon={Network} title="No network restrictions" message="Add deny rules to block abusive networks or allow rules for an allow-list." compact />
          ) : (
            <div className="divide-y divide-slate-100">
              {rules.map((rule) => (
                <div key={rule.id} className="flex items-start gap-3 px-5 py-3.5">
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${rule.action === 'deny' ? 'bg-rose-500' : 'bg-brand-500'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="text-xs font-semibold text-ink-900">{rule.cidr}</code>
                      <Badge tone={rule.action === 'deny' ? 'rose' : 'brand'}>{rule.action}</Badge>
                    </div>
                    <p className="mt-0.5 text-[10px] text-slate-500">{rule.reason || 'No reason supplied'}</p>
                    <p className="mt-0.5 text-[9px] text-slate-400">Created {formatDateTime(rule.created_at)}{rule.expires_at ? ` · expires ${formatDateTime(rule.expires_at)}` : ''}</p>
                  </div>
                  <button type="button" onClick={() => setDeleting(rule)} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete network rule"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <ConfirmDialog open={Boolean(deleting)} title="Delete network rule?" message={`Remove the ${deleting?.action} rule for ${deleting?.cidr}? The change is audited.`} confirmLabel="Delete rule" onCancel={() => setDeleting(null)} onConfirm={() => void remove()} loading={deleteBusy} />
    </div>
  );
}
