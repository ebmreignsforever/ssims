import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, ClipboardCheck, Users } from 'lucide-react';
import { api } from '../../api/client';
import { Badge, Card, EmptyState, ErrorAlert, PageHeader, PageLoader, ProgressBar } from '../../components/ui';
import type { Course } from '../../types';

export function LecturerCoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.get<Course[]>('/courses').then(setCourses).catch((caught: Error) => setError(caught.message)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  if (loading) return <PageLoader label="Loading assigned courses…" />;
  if (error) return <ErrorAlert title="Courses unavailable" message={error} onRetry={load} />;

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Teaching scope" title="My courses" description="Only courses assigned to your lecturer account are visible. Open a course to manage grades." />

      {courses.length === 0 ? (
        <Card><EmptyState icon={BookOpen} title="No courses assigned" message="Contact the academic administrator to assign a course to your account." /></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {courses.map((course) => {
            const percent = course.student_count ? Math.round((course.graded_count / course.student_count) * 100) : 0;
            return (
              <Card key={course.id} className="p-5 transition hover:border-brand-200 hover:shadow-float">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-lg bg-ink-950 px-2.5 py-1.5 font-mono text-[10px] font-bold text-brand-200">{course.code}</span>
                      <Badge tone={course.is_active ? 'brand' : 'slate'}>{course.is_active ? 'Active' : 'Archived'}</Badge>
                    </div>
                    <h2 className="mt-2 text-sm font-bold text-ink-950">{course.title}</h2>
                    <p className="mt-0.5 text-[10px] text-slate-400">{course.department_name} · {course.semester} · {course.academic_year}</p>
                  </div>
                  <span className="text-xs font-bold text-slate-500">{course.credits} cr</span>
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-500"><Users className="h-3.5 w-3.5" /> {course.student_count} students</div>
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-500"><ClipboardCheck className="h-3.5 w-3.5" /> {course.graded_count} graded</div>
                  <div className="ml-auto w-20"><ProgressBar value={percent} tone={percent === 100 ? 'brand' : 'amber'} /></div>
                </div>
                <Link to={`/lecturer/courses/${course.id}`} className="mt-4 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-[11px] font-semibold text-ink-900 transition hover:border-brand-200 hover:bg-brand-50">
                  Open course workspace
                  <ArrowRight className="h-4 w-4 text-brand-700" />
                </Link>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
