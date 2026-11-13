import { useEffect, useState } from 'react';
import { BookOpen, Calendar, GraduationCap, UserRound } from 'lucide-react';
import { api } from '../../api/client';
import { Badge, Card, EmptyState, ErrorAlert, PageHeader, PageLoader, ProgressBar } from '../../components/ui';

interface StudentCourse {
  id: string;
  code: string;
  title: string;
  description: string;
  credits: number;
  semester: string;
  academic_year: string;
  department_name: string;
  lecturer_name: string | null;
  score: string | null;
  letter_grade: string | null;
  remarks: string | null;
}

export function StudentCoursesPage() {
  const [courses, setCourses] = useState<StudentCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.get<StudentCourse[]>('/student/courses').then(setCourses).catch((caught: Error) => setError(caught.message)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  if (loading) return <PageLoader label="Loading registered courses…" />;
  if (error) return <ErrorAlert title="Courses unavailable" message={error} onRetry={load} />;

  const graded = courses.filter((course) => course.letter_grade).length;
  const credits = courses.reduce((sum, course) => sum + course.credits, 0);

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Academic record" title="My courses" description="Every course you are registered for, together with the lecturer and published result." />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="flex items-center gap-4 p-4"><div className="grid h-10 w-10 place-items-center rounded-xl bg-sky-50 text-sky-700"><BookOpen className="h-5 w-5" /></div><div><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Registered</p><p className="text-xl font-bold text-ink-950">{courses.length} courses</p></div></Card>
        <Card className="flex items-center gap-4 p-4"><div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><GraduationCap className="h-5 w-5" /></div><div><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Results published</p><p className="text-xl font-bold text-ink-950">{graded} / {courses.length}</p></div></Card>
        <Card className="flex items-center gap-4 p-4"><div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-700"><Calendar className="h-5 w-5" /></div><div><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Credit load</p><p className="text-xl font-bold text-ink-950">{credits} credits</p></div></Card>
      </div>

      {courses.length === 0 ? (
        <Card><EmptyState icon={BookOpen} title="No registered courses" message="Contact the academic registry if you believe this is an error." /></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {courses.map((course) => (
            <Card key={course.id} className="relative overflow-hidden p-5">
              <div className={`absolute inset-x-0 top-0 h-1 ${course.letter_grade === 'F' ? 'bg-rose-500' : course.letter_grade ? 'bg-brand-500' : 'bg-slate-200'}`} />
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="rounded bg-ink-950 px-2 py-1 font-mono text-[10px] font-bold text-brand-200">{course.code}</span>
                  <h2 className="mt-2 text-sm font-bold text-ink-950">{course.title}</h2>
                  <p className="mt-0.5 text-[10px] text-slate-400">{course.department_name} · {course.academic_year}</p>
                </div>
                {course.letter_grade ? (
                  <div className="text-right">
                    <p className="text-2xl font-extrabold text-ink-950">{Number(course.score).toFixed(0)}</p>
                    <Badge tone={course.letter_grade === 'F' ? 'rose' : course.letter_grade === 'A' ? 'brand' : 'amber'}>Grade {course.letter_grade}</Badge>
                  </div>
                ) : (
                  <Badge tone="slate">Awaiting grade</Badge>
                )}
              </div>
              <p className="mt-3 line-clamp-2 text-[11px] leading-5 text-slate-500">{course.description}</p>
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-[10px] text-slate-500">
                <span className="flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" /> {course.lecturer_name || 'Lecturer to be assigned'}</span>
                <span>{course.semester}</span>
                <span>{course.credits} credits</span>
              </div>
              {course.remarks && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[10px] text-slate-500">Lecturer note: {course.remarks}</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
