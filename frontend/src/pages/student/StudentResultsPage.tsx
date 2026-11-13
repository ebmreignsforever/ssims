import { useEffect, useState } from 'react';
import { Award, BookOpen, GraduationCap, TrendingUp } from 'lucide-react';
import { api } from '../../api/client';
import { Badge, Card, EmptyState, ErrorAlert, PageHeader, PageLoader, PageHeader as Header, ProgressBar } from '../../components/ui';
import { formatDate } from '../../utils/format';

interface Result {
  id: string;
  code: string;
  title: string;
  credits: number;
  semester: string;
  academic_year: string;
  score: string;
  letter_grade: string;
  remarks: string;
  updated_at: string;
  lecturer_name: string | null;
}

export function StudentResultsPage() {
  const [results, setResults] = useState<Result[]>([]);
  const [gpa, setGpa] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api
      .getWithMeta<Result[]>('/student/results')
      .then((response) => { setResults(response.data); setGpa(Number(response.meta?.gpa ?? 0)); })
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  if (loading) return <PageLoader label="Assembling academic transcript…" />;
  if (error) return <ErrorAlert title="Results unavailable" message={error} onRetry={load} />;

  const credits = results.reduce((sum, result) => sum + result.credits, 0);
  const best = results.reduce<Result | null>((current, result) => (!current || Number(result.score) > Number(current.score) ? result : current), null);
  const distribution = ['A', 'B', 'C', 'D', 'F'].map((grade) => ({ grade, count: results.filter((result) => result.letter_grade === grade).length }));

  return (
    <div className="space-y-5">
      <Header eyebrow="Official academic record" title="Academic results" description="Published grades and cumulative grade point average for your registered courses." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-5"><div className="flex items-center justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Cumulative GPA</p><p className="mt-1 text-3xl font-extrabold text-ink-950">{gpa.toFixed(2)}</p></div><div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-700"><Award className="h-5 w-5" /></div></div><p className="mt-3 text-[10px] text-slate-400">Quality-point weighted average</p></Card>
        <Card className="p-5"><div className="flex items-center justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Results published</p><p className="mt-1 text-3xl font-extrabold text-ink-950">{results.length}</p></div><div className="grid h-11 w-11 place-items-center rounded-xl bg-sky-50 text-sky-700"><BookOpen className="h-5 w-5" /></div></div><p className="mt-3 text-[10px] text-slate-400">{credits} graded credits</p></Card>
        <Card className="p-5"><div className="flex items-center justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Best result</p><p className="mt-1 text-2xl font-extrabold text-ink-950">{best ? best.letter_grade : '—'}</p></div><div className="grid h-11 w-11 place-items-center rounded-xl bg-amber-50 text-amber-700"><TrendingUp className="h-5 w-5" /></div></div><p className="mt-3 truncate text-[10px] text-slate-400">{best ? best.code : 'No grades yet'}</p></Card>
        <Card className="p-5"><div className="flex items-center justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Pass rate</p><p className="mt-1 text-3xl font-extrabold text-ink-950">{results.length ? Math.round((results.filter((result) => result.letter_grade !== 'F').length / results.length) * 100) : 0}%</p></div><div className="grid h-11 w-11 place-items-center rounded-xl bg-violet-50 text-violet-700"><GraduationCap className="h-5 w-5" /></div></div><p className="mt-3 text-[10px] text-slate-400">Non-failing grades</p></Card>
      </div>

      {results.length === 0 ? (
        <Card><EmptyState icon={GraduationCap} title="No published results" message="Your lecturers have not yet recorded grades for your courses." /></Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[2fr_1fr]">
          <Card className="overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-bold text-ink-900">Transcript</h2><p className="mt-0.5 text-[10px] text-slate-400">Only your own results are returned by this endpoint.</p></div>
            <div className="table-shell">
              <table>
                <thead><tr><th>Course</th><th>Term</th><th>Credits</th><th>Score</th><th>Grade</th><th>Published</th></tr></thead>
                <tbody>
                  {results.map((result) => (
                    <tr key={result.id}>
                      <td><span className="font-mono text-[10px] font-bold text-brand-700">{result.code}</span><p className="mt-0.5 text-xs font-semibold text-ink-900">{result.title}</p></td>
                      <td className="text-[11px]">{result.semester}<p className="text-[9px] text-slate-400">{result.academic_year}</p></td>
                      <td className="text-[11px]">{result.credits}</td>
                      <td className="text-sm font-bold text-ink-950">{Number(result.score).toFixed(1)}</td>
                      <td><Badge tone={result.letter_grade === 'F' ? 'rose' : result.letter_grade === 'A' ? 'brand' : 'amber'}>{result.letter_grade}</Badge></td>
                      <td className="text-[10px] text-slate-400">{formatDate(result.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="space-y-4">
            <Card className="p-5">
              <h2 className="text-sm font-bold text-ink-900">Grade distribution</h2>
              <div className="mt-4 space-y-3">
                {distribution.map((item) => (
                  <div key={item.grade}>
                    <div className="mb-1 flex justify-between text-[10px]"><span className="font-semibold text-slate-600">Grade {item.grade}</span><span className="text-slate-400">{item.count}</span></div>
                    <ProgressBar value={results.length ? (item.count / results.length) * 100 : 0} tone={item.grade === 'F' ? 'rose' : item.grade === 'A' ? 'brand' : 'amber'} />
                  </div>
                ))}
              </div>
            </Card>
            <Card className="border-brand-100 bg-brand-50/40 p-5">
              <p className="text-xs font-bold text-brand-900">Academic integrity</p>
              <p className="mt-1 text-[10.5px] leading-5 text-brand-800/80">Results are visible only to you, authorised lecturers for their own courses, and administrators. Every grade change is captured in the database audit log.</p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
