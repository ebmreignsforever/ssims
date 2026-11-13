import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, BookOpen, ClipboardCheck, GraduationCap, TrendingUp, Users } from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Badge, Card, EmptyState, ErrorAlert, PageHeader, PageLoader, ProgressBar, SectionHeader, StatCard, buttonClasses } from '../../components/ui';
import { formatDate, greeting } from '../../utils/format';

interface LecturerDashboardData {
  summary: { courseCount: number; studentCount: number; gradedCount: number; averageScore: number | null };
  courses: { id: string; code: string; title: string; credits: number; semester: string; academic_year: string; student_count: number; graded_count: number }[];
  recentGrades: { id: string; score: string; letter_grade: string; updated_at: string; course_code: string; course_title: string; student_name: string; student_number: string }[];
}

export function LecturerDashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<LecturerDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.get<LecturerDashboardData>('/lecturer/dashboard').then(setData).catch((caught: Error) => setError(caught.message)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  if (loading) return <PageLoader label="Loading your teaching workspace…" />;
  if (error || !data) return <ErrorAlert title="Teaching dashboard unavailable" message={error || undefined} onRetry={load} />;

  const { summary } = data;
  const completion = summary.studentCount ? Math.round((summary.gradedCount / summary.studentCount) * 100) : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Lecturer workspace"
        title={`${greeting()}, ${user?.fullName.split(' ')[0] || 'Lecturer'}`}
        description="Manage your assigned courses, record grades and access only the students within your teaching scope."
        actions={<Link to="/lecturer/courses" className={buttonClasses('dark', 'md')}><BookOpen className="h-4 w-4" /> My courses</Link>}
      />

      <section className="relative overflow-hidden rounded-2xl bg-ink-950 p-6 text-white sm:p-7">
        <div className="absolute inset-0 bg-grid-dark bg-[size:32px_32px] opacity-40" />
        <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-brand-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-brand-300"><GraduationCap className="h-4 w-4" /> Academic year 2025 / 2026</div>
            <h2 className="mt-3 text-2xl font-bold tracking-tight">Grade with confidence. Every change is audited.</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">You can only view and grade students enrolled in courses assigned to your lecturer account. Cross-course access is blocked by the API.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:min-w-[260px]">
            <div className="flex items-center justify-between text-[10px] text-slate-400"><span>Grading completion</span><span className="font-bold text-white">{completion}%</span></div>
            <div className="mt-2"><ProgressBar value={completion} /></div>
            <p className="mt-2 text-[9px] text-slate-500">{summary.gradedCount} of {summary.studentCount} student-course enrollments graded</p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Assigned courses" value={summary.courseCount} icon={BookOpen} tone="blue" hint="Active teaching load" />
        <StatCard label="Students" value={summary.studentCount} icon={Users} tone="brand" hint="Across all courses" />
        <StatCard label="Grades recorded" value={summary.gradedCount} icon={ClipboardCheck} tone="amber" hint={`${completion}% complete`} />
        <StatCard label="Average score" value={summary.averageScore === null ? '—' : summary.averageScore.toFixed(1)} icon={TrendingUp} tone="purple" hint="Graded submissions" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        <Card>
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <SectionHeader title="Your courses" description="Open a course to manage its roster and grades." />
            <Link to="/lecturer/courses" className="flex items-center gap-1 text-[11px] font-bold text-brand-700">View all <ArrowUpRight className="h-3 w-3" /></Link>
          </div>
          {data.courses.length === 0 ? (
            <EmptyState icon={BookOpen} title="No assigned courses" message="An administrator must assign courses to your account." compact />
          ) : (
            <div className="divide-y divide-slate-100">
              {data.courses.map((course) => (
                <Link key={course.id} to={`/lecturer/courses/${course.id}`} className="flex items-center gap-4 px-5 py-4 transition hover:bg-slate-50/70">
                  <span className="rounded-lg bg-ink-950 px-2.5 py-1.5 font-mono text-[10px] font-bold text-brand-200">{course.code}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-ink-900">{course.title}</p>
                    <p className="text-[10px] text-slate-400">{course.semester} · {course.student_count} students</p>
                  </div>
                  <div className="w-20"><ProgressBar value={course.student_count ? (course.graded_count / course.student_count) * 100 : 0} /></div>
                  <span className="text-[10px] font-semibold text-slate-500">{course.graded_count}/{course.student_count}</span>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <SectionHeader title="Recent grade activity" description="Last recorded changes." />
            <Link to="/lecturer/gradebook" className="text-brand-700"><ArrowUpRight className="h-4 w-4" /></Link>
          </div>
          {data.recentGrades.length === 0 ? (
            <EmptyState icon={ClipboardCheck} title="No grades yet" message="Open a course to record the first result." compact />
          ) : (
            <div className="divide-y divide-slate-100">
              {data.recentGrades.slice(0, 6).map((grade) => (
                <div key={grade.id} className="flex items-center gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-semibold text-ink-900">{grade.student_name}</p>
                    <p className="text-[9px] text-slate-400">{grade.course_code} · {grade.student_number}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-ink-900">{Number(grade.score).toFixed(0)}</p>
                    <p className="text-[9px] text-slate-400">{formatDate(grade.updated_at)}</p>
                  </div>
                  <Badge tone={grade.letter_grade === 'F' ? 'rose' : 'brand'}>{grade.letter_grade}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
