import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ClipboardCheck, Search, TrendingUp } from 'lucide-react';
import { api } from '../../api/client';
import { Badge, Card, EmptyState, ErrorAlert, PageHeader, PageLoader, ProgressBar, SectionHeader } from '../../components/ui';
import { formatDateTime } from '../../utils/format';

interface GradeRow {
  id: string;
  score: string;
  letter_grade: string;
  remarks: string;
  updated_at: string;
  course_code: string;
  course_title: string;
  student_name: string;
  student_number: string;
}

export function GradebookPage() {
  const [rows, setRows] = useState<GradeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = () => {
    setLoading(true);
    api.get<GradeRow[]>('/lecturer/grades/recent').then(setRows).catch((caught: Error) => setError(caught.message)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => `${row.student_name} ${row.student_number} ${row.course_code} ${row.course_title}`.toLowerCase().includes(term));
  }, [rows, search]);

  if (loading) return <PageLoader label="Loading gradebook…" />;
  if (error) return <ErrorAlert title="Gradebook unavailable" message={error} onRetry={load} />;

  const average = rows.length ? rows.reduce((sum, row) => sum + Number(row.score), 0) / rows.length : 0;
  const failing = rows.filter((row) => row.letter_grade === 'F').length;
  const distribution = ['A', 'B', 'C', 'D', 'F'].map((grade) => ({ grade, count: rows.filter((row) => row.letter_grade === grade).length }));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Teaching record"
        title="Gradebook"
        description="A consolidated view of grade changes across your assigned courses. Open a course workspace to edit a result."
        actions={<Link to="/lecturer/courses" className="inline-flex items-center gap-1.5 rounded-xl bg-ink-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-800">My courses <ArrowRight className="h-4 w-4" /></Link>}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5"><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Graded records</p><p className="mt-1 text-3xl font-extrabold text-ink-950">{rows.length}</p><p className="mt-2 flex items-center gap-1 text-[10px] text-brand-700"><ClipboardCheck className="h-3 w-3" /> Across your courses</p></Card>
        <Card className="p-5"><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Average score</p><p className="mt-1 text-3xl font-extrabold text-ink-950">{rows.length ? average.toFixed(1) : '—'}</p><p className="mt-2 flex items-center gap-1 text-[10px] text-slate-400"><TrendingUp className="h-3 w-3" /> Latest 50 records</p></Card>
        <Card className="p-5"><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Failing grades</p><p className={`mt-1 text-3xl font-extrabold ${failing ? 'text-rose-600' : 'text-ink-950'}`}>{failing}</p><p className="mt-2 text-[10px] text-slate-400">Grade F records</p></Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <SectionHeader title="Recent grade activity" description="Only records from courses assigned to you." />
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} className="field-input pl-9" placeholder="Search student or course…" aria-label="Search grades" />
            </div>
          </div>
          {filtered.length === 0 ? (
            <EmptyState icon={ClipboardCheck} title="No grade records" message={search ? 'No record matches your search.' : 'Grades you record will appear here.'} />
          ) : (
            <div className="table-shell">
              <table>
                <thead><tr><th>Student</th><th>Course</th><th>Score</th><th>Grade</th><th>Updated</th></tr></thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.id}>
                      <td><p className="text-xs font-semibold text-ink-900">{row.student_name}</p><p className="font-mono text-[9px] text-slate-400">{row.student_number}</p></td>
                      <td><span className="font-mono text-[10px] font-bold text-brand-700">{row.course_code}</span><p className="text-[9px] text-slate-400">{row.course_title}</p></td>
                      <td className="text-sm font-bold text-ink-950">{Number(row.score).toFixed(1)}</td>
                      <td><Badge tone={row.letter_grade === 'F' ? 'rose' : row.letter_grade === 'A' ? 'brand' : 'amber'}>{row.letter_grade}</Badge></td>
                      <td className="text-[10px] text-slate-400">{formatDateTime(row.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card className="p-5">
          <SectionHeader title="Grade distribution" description="All gradebook records." />
          <div className="mt-4 space-y-3">
            {distribution.map((item) => (
              <div key={item.grade}>
                <div className="mb-1 flex justify-between text-[10px]"><span className="font-semibold text-slate-600">Grade {item.grade}</span><span className="text-slate-400">{item.count}</span></div>
                <ProgressBar value={rows.length ? (item.count / rows.length) * 100 : 0} tone={item.grade === 'F' ? 'rose' : item.grade === 'A' ? 'brand' : 'amber'} />
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-xl bg-slate-50 p-3.5 text-[10px] leading-5 text-slate-500">
            Grade changes are recorded with the acting lecturer, timestamp, previous and new scores in the security audit
            trail. Students can see their own published results.
          </div>
        </Card>
      </div>
    </div>
  );
}
