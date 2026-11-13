import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  BookOpen,
  Fingerprint,
  GraduationCap,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
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
  StatCard,
  buttonClasses,
} from '../../components/ui';
import { greeting } from '../../utils/format';

interface StudentDashboardData {
  summary: {
    fullName: string;
    studentId: string;
    programme: string | null;
    courseCount: number;
    gradedCount: number;
    gpa: number;
    credits: number;
  };
  recentResults: { code: string; title: string; score: string; letter_grade: string; updated_at: string }[];
}

export function StudentDashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<StudentDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.get<StudentDashboardData>('/student/dashboard').then(setData).catch((caught: Error) => setError(caught.message)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  if (loading) return <PageLoader label="Loading your academic record…" />;
  if (error || !data) return <ErrorAlert title="Could not load your dashboard" message={error || undefined} onRetry={load} />;

  const { summary } = data;
  const progress = summary.courseCount ? Math.round((summary.gradedCount / summary.courseCount) * 100) : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Student portal"
        title={`${greeting()}, ${summary.fullName.split(' ')[0]}`}
        description="Your courses, results and account security in one protected workspace."
        actions={
          <Link to="/student/results" className={buttonClasses('dark', 'md')}>
            <GraduationCap className="h-4 w-4" /> View full results
          </Link>
        }
      />

      <section className="relative overflow-hidden rounded-2xl bg-ink-950 p-6 text-white sm:p-7">
        <div className="absolute inset-0 bg-grid-dark bg-[size:32px_32px] opacity-40" />
        <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-brand-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <Badge tone="brand" className="border-brand-400/20 bg-brand-400/10 text-brand-200">
              <Sparkles className="h-3 w-3" /> {summary.programme || 'Student record'}
            </Badge>
            <h2 className="mt-3 text-2xl font-bold tracking-tight">Your academic journey is on track.</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">
              Student ID <span className="font-mono text-slate-200">{summary.studentId}</span> · {summary.courseCount} registered
              courses · {summary.credits} graded credits.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link to="/student/courses" className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-semibold text-slate-300 transition hover:bg-white/10">My courses</Link>
              <Link to="/settings/security" className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-semibold text-slate-300 transition hover:bg-white/10">Secure my account</Link>
            </div>
          </div>
          <div className="flex items-end gap-5 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-500">Cumulative GPA</p>
              <p className="mt-1 text-4xl font-extrabold tracking-tight text-brand-300">{summary.gpa.toFixed(2)}</p>
              <p className="mt-1 text-[9px] text-slate-500">Based on graded courses</p>
            </div>
            <div className="w-20 pb-1">
              <ProgressBar value={progress} />
              <p className="mt-2 text-[9px] text-slate-500">{progress}% graded</p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Registered courses" value={summary.courseCount} icon={BookOpen} tone="blue" hint="This academic year" />
        <StatCard label="Courses graded" value={summary.gradedCount} icon={GraduationCap} tone="brand" hint={`${progress}% complete`} />
        <StatCard label="Credits earned" value={summary.credits} icon={TrendingUp} tone="amber" hint="Graded credits" />
        <StatCard label="Account protection" value={user?.mfaEnabled ? 'MFA on' : 'MFA off'} icon={Fingerprint} tone={user?.mfaEnabled ? 'brand' : 'rose'} hint={user?.mfaEnabled ? 'Authenticator enabled' : 'Enable in security settings'} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <SectionHeader title="Recent results" description="Latest grades recorded by your lecturers." />
            <Link to="/student/results" className="flex items-center gap-1 text-[11px] font-bold text-brand-700 hover:text-brand-800">All results <ArrowUpRight className="h-3 w-3" /></Link>
          </div>
          {data.recentResults.length === 0 ? (
            <EmptyState icon={GraduationCap} title="No results published" message="Your grades will appear here once lecturers record them." compact />
          ) : (
            <div className="divide-y divide-slate-100">
              {data.recentResults.map((result) => (
                <div key={`${result.code}-${result.updated_at}`} className="flex items-center gap-4 px-5 py-4">
                  <span className="hidden rounded-lg bg-ink-950 px-2.5 py-1.5 font-mono text-[10px] font-bold text-brand-200 sm:inline">{result.code}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-ink-900">{result.title}</p>
                    <p className="text-[10px] text-slate-400">{result.code}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-ink-950">{Number(result.score).toFixed(0)}<span className="text-[10px] text-slate-400">/100</span></p>
                    <Badge tone={result.letter_grade === 'F' ? 'rose' : result.letter_grade === 'A' ? 'brand' : 'amber'}>Grade {result.letter_grade}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <SectionHeader title="Account security" description="Your sign-in protection at a glance." />
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand-50 text-brand-700"><LockKeyhole className="h-4 w-4" /></div>
                <div className="flex-1"><p className="text-[11px] font-bold text-ink-900">Password</p><p className="text-[9px] text-slate-400">Argon2id hash · 12+ character policy</p></div>
                <Badge tone="brand">Protected</Badge>
              </div>
              <div className={`flex items-center gap-3 rounded-xl border p-3 ${user?.mfaEnabled ? 'border-brand-200 bg-brand-50/40' : 'border-amber-200 bg-amber-50/50'}`}>
                <div className={`grid h-9 w-9 place-items-center rounded-lg ${user?.mfaEnabled ? 'bg-brand-100 text-brand-700' : 'bg-amber-100 text-amber-700'}`}><Fingerprint className="h-4 w-4" /></div>
                <div className="flex-1"><p className="text-[11px] font-bold text-ink-900">Multi-factor authentication</p><p className="text-[9px] text-slate-400">{user?.mfaEnabled ? `${user.backupCodesRemaining} backup codes remaining` : 'Add a second factor for stronger protection'}</p></div>
                <Link to="/settings/security" className="text-[10px] font-bold text-brand-700 underline underline-offset-2">{user?.mfaEnabled ? 'Manage' : 'Enable'}</Link>
              </div>
            </div>
          </Card>

          <Card className="border-brand-100 bg-brand-50/40 p-5">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-brand-700 shadow-sm"><ShieldCheck className="h-5 w-5" /></div>
              <div>
                <p className="text-xs font-bold text-brand-900">Your data is access-controlled</p>
                <p className="mt-1 text-[10.5px] leading-5 text-brand-800/80">Lecturers can only view students enrolled in their own courses. Administrators access records under audit. Your session expires automatically after inactivity.</p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
