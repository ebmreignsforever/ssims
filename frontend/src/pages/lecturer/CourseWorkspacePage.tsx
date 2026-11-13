import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ClipboardCheck, GraduationCap, Pencil, Search, ShieldCheck, TrendingUp, Users } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorAlert,
  Input,
  Modal,
  PageHeader,
  PageLoader,
  SectionHeader,
  StatCard,
  TextArea,
} from '../../components/ui';
import { formatDate } from '../../utils/format';

interface CourseDetail {
  id: string;
  code: string;
  title: string;
  description: string;
  credits: number;
  semester: string;
  academic_year: string;
  department_name: string;
  lecturer_id: string | null;
  lecturer_name: string | null;
  student_count: number;
  is_active: boolean;
}

interface RosterRow {
  enrollment_id: string;
  student_id: string;
  full_name: string;
  email: string;
  student_number: string;
  programme: string | null;
  level: string | null;
  score: string | null;
  letter_grade: string | null;
  remarks: string | null;
  grade_updated_at: string | null;
}

interface StudentRecord {
  student: {
    id: string;
    full_name: string;
    email: string;
    student_number: string;
    programme: string | null;
    level: string | null;
    department_name: string | null;
  };
  results: { code: string; title: string; credits: number; semester: string; academic_year: string; score: string | null; letter_grade: string | null; remarks: string | null }[];
}

export function CourseWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const { success, error: toastError } = useToast();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [grading, setGrading] = useState<RosterRow | null>(null);
  const [gradeForm, setGradeForm] = useState({ score: '', remarks: '' });
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [studentRecord, setStudentRecord] = useState<StudentRecord | null>(null);
  const [studentLoading, setStudentLoading] = useState(false);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [courseData, rosterData] = await Promise.all([
        api.get<CourseDetail>(`/courses/${id}`),
        api.get<RosterRow[]>(`/courses/${id}/students`),
      ]);
      setCourse(courseData);
      setRoster(rosterData);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load the course workspace.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return roster;
    return roster.filter((row) => `${row.full_name} ${row.student_number} ${row.email}`.toLowerCase().includes(term));
  }, [roster, search]);

  const openGrade = (row: RosterRow) => {
    setGrading(row);
    setGradeForm({ score: row.score ? String(Number(row.score)) : '', remarks: row.remarks || '' });
    setGradeError(null);
  };

  const submitGrade = async (event: FormEvent) => {
    event.preventDefault();
    if (!grading) return;
    const score = Number(gradeForm.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      setGradeError('Enter a score between 0 and 100.');
      return;
    }
    setSaving(true);
    setGradeError(null);
    try {
      await api.post('/lecturer/grades', { enrollmentId: grading.enrollment_id, score, remarks: gradeForm.remarks });
      success('Grade saved', `${grading.full_name} · ${course?.code}`);
      setGrading(null);
      await load();
    } catch (caught) {
      setGradeError(caught instanceof ApiError ? caught.message : 'The grade could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const openStudent = async (studentId: string) => {
    setStudentLoading(true);
    setStudentRecord(null);
    try {
      setStudentRecord(await api.get<StudentRecord>(`/lecturer/students/${studentId}`));
    } catch (caught) {
      toastError('Student record unavailable', caught instanceof Error ? caught.message : undefined);
    } finally {
      setStudentLoading(false);
    }
  };

  if (loading) return <PageLoader label="Opening course workspace…" />;
  if (error || !course) return <ErrorAlert title="Course unavailable" message={error || undefined} onRetry={() => void load()} />;

  const graded = roster.filter((row) => row.score !== null).length;
  const average = graded ? roster.reduce((sum, row) => sum + Number(row.score), 0) / graded : null;
  const passRate = graded ? Math.round((roster.filter((row) => row.letter_grade !== 'F').length / graded) * 100) : null;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link to="/lecturer/courses" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:text-ink-900">
          <ArrowLeft className="h-3.5 w-3.5" /> All courses
        </Link>
        <Badge tone="brand"><ShieldCheck className="h-3 w-3" /> Lecturer scope enforced</Badge>
      </div>

      <PageHeader
        title={`${course.code} · ${course.title}`}
        description={course.description}
        eyebrow={`${course.department_name} · ${course.semester} · ${course.academic_year}`}
        actions={<Button variant="outline" leftIcon={ClipboardCheck} onClick={() => roster.length > 0 && openGrade(roster.find((row) => !row.score) || roster[0])}>Record grade</Button>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Enrolled students" value={roster.length} icon={Users} tone="blue" hint={`${course.credits} credit course`} />
        <StatCard label="Grades recorded" value={graded} icon={ClipboardCheck} tone="brand" hint={`${roster.length - graded} pending`} />
        <StatCard label="Class average" value={average === null ? '—' : average.toFixed(1)} icon={TrendingUp} tone="amber" hint="Graded students" />
        <StatCard label="Pass rate" value={passRate === null ? '—' : `${passRate}%`} icon={GraduationCap} tone="purple" hint="A–D grades" />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <SectionHeader title="Course roster" description="Only students enrolled in this assigned course are returned." />
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} className="field-input pl-9" placeholder="Search roster…" aria-label="Search roster" />
          </div>
        </div>
        {filtered.length === 0 ? (
          <EmptyState icon={Users} title={search ? 'No student matches your search' : 'No students enrolled'} message={search ? 'Try a different name or student ID.' : 'An administrator must enroll students in this course.'} />
        ) : (
          <div className="table-shell">
            <table>
              <thead><tr><th>Student</th><th>Programme</th><th>Grade</th><th>Score</th><th>Last updated</th><th className="text-right">Actions</th></tr></thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.enrollment_id}>
                    <td>
                      <button type="button" onClick={() => void openStudent(row.student_id)} className="flex items-center gap-2.5 text-left">
                        <Avatar name={row.full_name} size="sm" />
                        <span>
                          <span className="block text-xs font-semibold text-ink-900 hover:text-brand-700">{row.full_name}</span>
                          <span className="block font-mono text-[9px] text-slate-400">{row.student_number}</span>
                        </span>
                      </button>
                    </td>
                    <td><p className="text-[11px]">{row.programme || '—'}</p><p className="text-[9px] text-slate-400">Level {row.level || '—'}</p></td>
                    <td>{row.letter_grade ? <Badge tone={row.letter_grade === 'F' ? 'rose' : row.letter_grade === 'A' ? 'brand' : 'amber'}>{row.letter_grade}</Badge> : <Badge tone="slate">Pending</Badge>}</td>
                    <td className="text-sm font-bold text-ink-950">{row.score !== null ? Number(row.score).toFixed(1) : '—'}</td>
                    <td className="text-[10px] text-slate-400">{row.grade_updated_at ? formatDate(row.grade_updated_at) : 'Not graded'}</td>
                    <td className="text-right">
                      <Button size="sm" variant={row.score === null ? 'primary' : 'outline'} leftIcon={Pencil} onClick={() => openGrade(row)}>
                        {row.score === null ? 'Grade' : 'Edit'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(grading)}
        onClose={() => setGrading(null)}
        title={grading ? `Record grade · ${grading.full_name}` : 'Record grade'}
        description={grading ? `${grading.student_number} · ${course.code}` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setGrading(null)}>Cancel</Button>
            <Button type="submit" form="grade-form" loading={saving}>Save grade</Button>
          </>
        }
      >
        <form id="grade-form" onSubmit={submitGrade} className="space-y-4">
          <div className="rounded-xl bg-slate-50 p-3 text-[10px] leading-5 text-slate-500">
            The letter grade is calculated by a PostgreSQL trigger. This action is written to the database audit log with
            your user ID.
          </div>
          {gradeError && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{gradeError}</p>}
          <Input
            label="Score (0–100)"
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={gradeForm.score}
            onChange={(event) => setGradeForm({ ...gradeForm, score: event.target.value })}
            required
            autoFocus
            hint="90+ A · 80+ B · 70+ C · 60+ D · below 60 F"
          />
          <TextArea label="Remarks (optional)" value={gradeForm.remarks} onChange={(event) => setGradeForm({ ...gradeForm, remarks: event.target.value })} placeholder="Feedback visible to the student" />
        </form>
      </Modal>

      <Modal
        open={Boolean(studentRecord) || studentLoading}
        onClose={() => { setStudentRecord(null); setStudentLoading(false); }}
        title={studentRecord?.student.full_name || 'Student record'}
        description={studentRecord ? `${studentRecord.student.student_number} · ${studentRecord.student.programme || 'Programme not set'}` : undefined}
        size="md"
        footer={<Button variant="outline" onClick={() => { setStudentRecord(null); setStudentLoading(false); }}>Close</Button>}
      >
        {studentLoading ? (
          <p className="py-10 text-center text-xs text-slate-500">Loading authorised student record…</p>
        ) : studentRecord ? (
          <div className="space-y-4">
            <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
              <div><p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Email</p><p className="mt-0.5 text-[11px]">{studentRecord.student.email}</p></div>
              <div><p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Department</p><p className="mt-0.5 text-[11px]">{studentRecord.student.department_name || '—'}</p></div>
              <div><p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Programme</p><p className="mt-0.5 text-[11px]">{studentRecord.student.programme || '—'}</p></div>
              <div><p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Level</p><p className="mt-0.5 text-[11px]">{studentRecord.student.level || '—'}</p></div>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-slate-50 text-[9px] uppercase tracking-wider text-slate-400"><tr><th className="px-3 py-2">Course</th><th className="px-3 py-2">Term</th><th className="px-3 py-2">Score</th><th className="px-3 py-2">Grade</th></tr></thead>
                <tbody>
                  {studentRecord.results.map((result) => (
                    <tr key={result.code} className="border-t border-slate-100">
                      <td className="px-3 py-2"><p className="font-semibold text-ink-900">{result.code}</p><p className="text-[9px] text-slate-400">{result.title}</p></td>
                      <td className="px-3 py-2 text-[10px]">{result.semester}</td>
                      <td className="px-3 py-2">{result.score !== null ? Number(result.score).toFixed(1) : '—'}</td>
                      <td className="px-3 py-2">{result.letter_grade ? <Badge tone={result.letter_grade === 'F' ? 'rose' : 'brand'}>{result.letter_grade}</Badge> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] leading-5 text-slate-400">This view is limited to results from courses assigned to you. Other academic records are not accessible.</p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
