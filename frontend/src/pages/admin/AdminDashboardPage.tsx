import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  Fingerprint,
  FlaskConical,
  LockKeyhole,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  UserCheck,
  Users,
  UserX,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  Badge,
  Card,
  EmptyState,
  ErrorAlert,
  PageHeader,
  PageLoader,
  ProgressBar,
  SectionHeader,
  SeverityBadge,
  StatCard,
  buttonClasses,
} from '../../components/ui';
import { formatDateTime, formatRole, greeting, timeAgo } from '../../utils/format';
import type { Severity } from '../../types';

interface DashboardData {
  metrics: {
    totalUsers: number;
    activeAccounts: number;
    lockedAccounts: number;
    suspendedAccounts: number;
    mfaUsers: number;
    failedLogins24h: number;
    suspiciousEvents24h: number;
    ungradedEnrollments: number;
  };
  loginTrend: { date: string; successful: number; failed: number }[];
  severity: { severity: Severity; count: number }[];
  roles: { role: string; count: number }[];
  recentEvents: {
    id: string;
    occurred_at: string;
    actor_email: string | null;
    ip: string | null;
    event_type: string;
    severity: Severity;
    description: string;
    full_name: string | null;
  }[];
  testResults: { id: string; test_key: string; name: string; status: string; mechanism: string; created_at: string }[];
  recentLogins: {
    email: string;
    successful: boolean;
    failure_reason: string | null;
    ip: string | null;
    created_at: string;
    full_name: string | null;
    role: string | null;
  }[];
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#be123c',
  high: '#e11d48',
  medium: '#d9a441',
  low: '#64748b',
  info: '#0ea5e9',
};

const ROLE_COLORS: Record<string, string> = {
  super_admin: '#7c3aed',
  administrator: '#0284c7',
  lecturer: '#d9a441',
  student: '#10b394',
};

export function AdminDashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .get<DashboardData>('/admin/dashboard')
      .then(setData)
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (loading) return <PageLoader label="Aggregating security telemetry…" />;
  if (error || !data) return <ErrorAlert title="Dashboard unavailable" message={error || undefined} onRetry={load} />;

  const { metrics } = data;
  const mfaCoverage = metrics.totalUsers ? Math.round((metrics.mfaUsers / metrics.totalUsers) * 100) : 0;
  const activeRate = metrics.totalUsers ? Math.round((metrics.activeAccounts / metrics.totalUsers) * 100) : 0;
  const postureScore = Math.min(
    98,
    Math.round(45 + mfaCoverage * 0.35 + activeRate * 0.1 + (metrics.suspiciousEvents24h === 0 ? 10 : 2)),
  );
  const totalSeverity = data.severity.reduce((sum, item) => sum + item.count, 0);
  const firstName = user?.fullName.split(' ')[0] || 'Administrator';

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administrator control centre"
        title={`${greeting()}, ${firstName}`}
        description="Monitor identity, academic operations and the security posture of the university information system."
        actions={
          <>
            <Link to="/admin/security" className={buttonClasses('outline', 'md')}>
              <ShieldAlert className="h-4 w-4" /> Security log
            </Link>
            <Link to="/admin/lab" className={buttonClasses('dark', 'md')}>
              <FlaskConical className="h-4 w-4" /> Open testing lab
            </Link>
          </>
        }
      />

      <section className="card relative overflow-hidden bg-ink-950 p-6 text-white sm:p-7">
        <div className="absolute inset-0 bg-grid-dark bg-[size:32px_32px] opacity-40" />
        <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-brand-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-300">
              <ShieldCheck className="h-4 w-4" /> Live security posture
            </div>
            <h2 className="mt-3 text-2xl font-bold tracking-tight">Controls are active and enforcing.</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              {metrics.suspiciousEvents24h === 0
                ? 'No high-severity events were recorded in the last 24 hours. Continue reviewing the audit trail and access policies.'
                : `${metrics.suspiciousEvents24h} high-severity security event${metrics.suspiciousEvents24h === 1 ? '' : 's'} recorded in the last 24 hours.`}{' '}
              MFA coverage is {mfaCoverage}% across {metrics.totalUsers} accounts.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Badge tone="brand" className="border-brand-400/20 bg-brand-400/10 text-brand-200">RBAC enforced</Badge>
              <Badge tone="brand" className="border-brand-400/20 bg-brand-400/10 text-brand-200">Audit append-only</Badge>
              <Badge tone="brand" className="border-brand-400/20 bg-brand-400/10 text-brand-200">TLS ready</Badge>
              <Badge tone={metrics.lockedAccounts > 0 ? 'amber' : 'slate'} className="border-white/10 bg-white/5 text-slate-300">
                {metrics.lockedAccounts} locked account{metrics.lockedAccounts === 1 ? '' : 's'}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <div
              className="relative grid h-24 w-24 place-items-center rounded-full"
              style={{ background: `conic-gradient(#2dd4ad ${postureScore * 3.6}deg, rgba(255,255,255,0.08) 0deg)` }}
            >
              <div className="grid h-[78px] w-[78px] place-items-center rounded-full bg-ink-950">
                <div className="text-center">
                  <p className="text-2xl font-extrabold text-white">{postureScore}</p>
                  <p className="text-[8px] font-bold uppercase tracking-wider text-slate-500">Score</p>
                </div>
              </div>
            </div>
            <div className="space-y-2 text-xs">
              <p className="font-semibold text-white">Security posture</p>
              <p className="text-slate-400">MFA coverage</p>
              <div className="w-32">
                <ProgressBar value={mfaCoverage} />
              </div>
              <p className="text-[10px] text-slate-500">{metrics.mfaUsers} of {metrics.totalUsers} accounts protected</p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Registered users" value={metrics.totalUsers} icon={Users} tone="blue" hint={`${metrics.activeAccounts} active`} />
        <StatCard label="Active accounts" value={metrics.activeAccounts} icon={UserCheck} tone="brand" hint={`${activeRate}% of all accounts`} />
        <StatCard label="MFA-enabled users" value={metrics.mfaUsers} icon={Fingerprint} tone="purple" hint={`${mfaCoverage}% coverage`} />
        <StatCard label="Failed logins · 24h" value={metrics.failedLogins24h} icon={LockKeyhole} tone={metrics.failedLogins24h > 10 ? 'rose' : 'amber'} hint="Authentication telemetry" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Locked accounts" value={metrics.lockedAccounts} icon={UserX} tone="rose" hint={`${metrics.suspendedAccounts} suspended`} />
        <StatCard label="Suspicious events · 24h" value={metrics.suspiciousEvents24h} icon={ShieldAlert} tone="rose" hint="High and critical severity" />
        <StatCard label="Ungraded enrollments" value={metrics.ungradedEnrollments} icon={BookOpen} tone="amber" hint="Academic operations" />
        <StatCard label="Lab tests completed" value={data.testResults.length} icon={FlaskConical} tone="brand" hint="Most recent runs" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
        <Card className="p-5 sm:p-6">
          <SectionHeader
            title="Authentication activity"
            description="Successful and failed login attempts over the last seven days."
            action={<Badge tone="brand"><Activity className="h-3 w-3" /> 7-day window</Badge>}
          />
          <div className="mt-5 h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.loginTrend} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="successGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b394" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#10b394" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="failedGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#e11d48" stopOpacity={0.24} />
                    <stop offset="100%" stopColor="#e11d48" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="date" tickFormatter={(value) => value.slice(5)} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12, boxShadow: '0 12px 30px -15px rgba(7,17,31,.3)' }}
                  labelStyle={{ fontWeight: 700, color: '#0b1829' }}
                />
                <Area type="monotone" dataKey="successful" name="Successful" stroke="#0b8f78" strokeWidth={2.2} fill="url(#successGradient)" />
                <Area type="monotone" dataKey="failed" name="Failed" stroke="#e11d48" strokeWidth={2} fill="url(#failedGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5 sm:p-6">
          <SectionHeader title="Event severity" description="Distribution across the last seven days." />
          <div className="relative mt-2 h-[210px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data.severity.filter((item) => item.count > 0)} dataKey="count" nameKey="severity" innerRadius={62} outerRadius={88} paddingAngle={3} stroke="none">
                  {data.severity.map((item) => (
                    <Cell key={item.severity} fill={SEVERITY_COLORS[item.severity] || '#94a3b8'} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-2xl font-bold text-ink-950">{totalSeverity}</p>
              <p className="text-[10px] uppercase tracking-wider text-slate-400">Events</p>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {data.severity.map((item) => (
              <div key={item.severity} className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-2">
                <span className="flex items-center gap-1.5 text-[10px] font-semibold capitalize text-slate-600">
                  <span className="h-2 w-2 rounded-full" style={{ background: SEVERITY_COLORS[item.severity] }} />
                  {item.severity}
                </span>
                <span className="text-[11px] font-bold text-ink-900">{item.count}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
        <Card>
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <SectionHeader title="Recent security events" description="Newest entries from the immutable audit trail." />
            <Link to="/admin/security" className="flex items-center gap-1 text-[11px] font-bold text-brand-700 hover:text-brand-800">
              View all <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          {data.recentEvents.length === 0 ? (
            <EmptyState title="No security events yet" message="Events appear as users authenticate and administrators act." compact />
          ) : (
            <div className="divide-y divide-slate-100">
              {data.recentEvents.slice(0, 7).map((event) => (
                <div key={event.id} className="flex items-start gap-3 px-5 py-3.5">
                  <div className="mt-1">
                    <SeverityBadge severity={event.severity} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-ink-900">{event.description}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-slate-400">
                      <span className="font-mono text-slate-500">{event.event_type}</span>
                      <span>·</span>
                      <span>{event.actor_email || event.full_name || 'System'}</span>
                      {event.ip && <><span>·</span><span className="font-mono">{event.ip}</span></>}
                    </div>
                  </div>
                  <span className="shrink-0 text-[10px] text-slate-400">{timeAgo(event.occurred_at)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <div className="border-b border-slate-100 px-5 py-4">
              <SectionHeader title="Role distribution" description="Accounts by access level." />
            </div>
            <div className="space-y-3 px-5 py-4">
              {data.roles.map((role) => (
                <div key={role.role}>
                  <div className="mb-1.5 flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-slate-600">{formatRole(role.role)}</span>
                    <span className="font-bold text-ink-900">{role.count}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${metrics.totalUsers ? (role.count / metrics.totalUsers) * 100 : 0}%`,
                        background: ROLE_COLORS[role.role] || '#94a3b8',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <SectionHeader title="Security lab" description="Latest authorised tests." />
              <Link to="/admin/lab" className="text-brand-700 hover:text-brand-800">
                <FlaskConical className="h-4 w-4" />
              </Link>
            </div>
            {data.testResults.length === 0 ? (
              <EmptyState title="No tests run" message="Run an attack simulation in the security lab." compact icon={FlaskConical} />
            ) : (
              <div className="divide-y divide-slate-100">
                {data.testResults.slice(0, 4).map((test) => (
                  <div key={test.id} className="flex items-center gap-3 px-5 py-3">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${test.status === 'passed' ? 'bg-brand-500' : test.status === 'failed' ? 'bg-rose-500' : 'bg-sky-500'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-semibold text-ink-900">{test.name}</p>
                      <p className="text-[9px] text-slate-400">{timeAgo(test.created_at)}</p>
                    </div>
                    <Badge tone={test.status === 'passed' ? 'brand' : test.status === 'failed' ? 'rose' : 'blue'}>{test.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <SectionHeader title="Recent sign-in telemetry" description="Source IP and outcome for the latest attempts." />
          <div className="flex gap-2">
            <Link to="/admin/users" className={buttonClasses('outline', 'sm')}>
              <Users className="h-3.5 w-3.5" /> Manage users
            </Link>
            <Link to="/admin/lab" className={buttonClasses('secondary', 'sm')}>
              <TrendingUp className="h-3.5 w-3.5" /> Test controls
            </Link>
          </div>
        </div>
        {data.recentLogins.length === 0 ? (
          <EmptyState title="No login telemetry" message="Authentication attempts will appear here." compact />
        ) : (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Outcome</th>
                  <th>Source IP</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {data.recentLogins.map((login, index) => (
                  <tr key={`${login.email}-${login.created_at}-${index}`}>
                    <td>
                      <p className="text-xs font-semibold text-ink-900">{login.full_name || login.email}</p>
                      <p className="text-[10px] text-slate-400">{login.email}</p>
                    </td>
                    <td>
                      {login.successful ? <Badge tone="brand">Success</Badge> : <Badge tone="rose">{login.failure_reason?.replace(/_/g, ' ') || 'Failed'}</Badge>}
                    </td>
                    <td className="font-mono text-[11px]">{login.ip || '—'}</td>
                    <td className="text-[11px]">{formatDateTime(login.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
