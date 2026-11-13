import { FormEvent, useEffect, useMemo, useState } from 'react';
import { BookOpen, GraduationCap, Pencil, Plus, Search, UserPlus, Users, X } from 'lucide-react';
import { api, ApiError, fieldErrors, qs } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import type { AdminUserRow, Course, Department } from '../../types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorAlert,
  Input,
  Modal,
  PageHeader,
  PageLoader,
  ProgressBar,
  Select,
  TextArea,
} from '../../components/ui';


interface CourseForm {
  code: string;
  title: string;
  description: string;
  departmentId: string;
  lecturerId: string;
  credits: string;
  semester: string;
  academicYear: string;
  isActive: boolean;
}

const EMPTY_FORM: CourseForm = {
  code: '',
  title: '',
  description: '',
  departmentId: '',
  lecturerId: '',
  credits: '3',
  semester: 'Semester 1',
  academicYear: '2025/2026',
  isActive: true,
};

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
}

export function CoursesPage() {
  const { success, error: toastError } = useToast();
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [lecturers, setLecturers] = useState<AdminUserRow[]>([]);
  const [students, setStudents] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Course | null>(null);
  const [form, setForm] = useState<CourseForm>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [rosterCourse, setRosterCourse] = useState<Course | null>(null);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState('');
  const [enrolling, setEnrolling] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.get<Course[]>('/courses'),
      api.get<Department[]>('/departments'),
      api.getWithMeta<AdminUserRow[]>(`/admin/users${qs({ role: 'lecturer', limit: 100 })}`),
      api.getWithMeta<AdminUserRow[]>(`/admin/users${qs({ role: 'student', limit: 100 })}`),
    ])
      .then(([courseData, departmentData, lecturerData, studentData]) => {
        setCourses(courseData);
        setDepartments(departmentData);
        setLecturers(lecturerData.data);
        setStudents(studentData.data);
      })
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return courses;
    return courses.filter((course) => `${course.code} ${course.title} ${course.department_name} ${course.lecturer_name || ''}`.toLowerCase().includes(term));
  }, [courses, search]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, departmentId: departments[0]?.id || '', lecturerId: lecturers[0]?.id || '' });
    setFormErrors({});
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (course: Course) => {
    setEditing(course);
    setForm({
      code: course.code,
      title: course.title,
      description: course.description,
      departmentId: course.department_id,
      lecturerId: course.lecturer_id || '',
      credits: String(course.credits),
      semester: course.semester,
      academicYear: course.academic_year,
      isActive: course.is_active,
    });
    setFormErrors({});
    setFormError(null);
    setModalOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFormErrors({});
    setFormError(null);
    const payload = {
      ...form,
      credits: Number(form.credits),
      lecturerId: form.lecturerId || null,
    };
    try {
      if (editing) {
        await api.patch(`/courses/${editing.id}`, payload);
        success('Course updated');
      } else {
        await api.post('/courses', payload);
        success('Course created');
      }
      setModalOpen(false);
      load();
    } catch (caught) {
      setFormErrors(fieldErrors(caught));
      setFormError(caught instanceof ApiError ? caught.message : 'Could not save the course');
    } finally {
      setSaving(false);
    }
  };

  const openRoster = async (course: Course) => {
    setRosterCourse(course);
    setSelectedStudent('');
    setRosterLoading(true);
    try {
      setRoster(await api.get<RosterRow[]>(`/courses/${course.id}/students`));
    } catch (caught) {
      toastError('Could not load roster', caught instanceof Error ? caught.message : undefined);
    } finally {
      setRosterLoading(false);
    }
  };

  const refreshRoster = async (courseId: string) => {
    setRoster(await api.get<RosterRow[]>(`/courses/${courseId}/students`));
    load();
  };

  const enroll = async () => {
    if (!rosterCourse || !selectedStudent) return;
    setEnrolling(true);
    try {
      await api.post(`/courses/${rosterCourse.id}/enrollments`, { studentId: selectedStudent });
      success('Student enrolled');
      setSelectedStudent('');
      await refreshRoster(rosterCourse.id);
    } catch (caught) {
      toastError('Enrollment rejected', caught instanceof Error ? caught.message : undefined);
    } finally {
      setEnrolling(false);
    }
  };

  const unenroll = async (enrollmentId: string) => {
    if (!rosterCourse) return;
    try {
      await api.delete(`/courses/${rosterCourse.id}/enrollments/${enrollmentId}`);
      success('Enrollment removed');
      await refreshRoster(rosterCourse.id);
    } catch (caught) {
      toastError('Could not remove enrollment', caught instanceof Error ? caught.message : undefined);
    }
  };

  if (loading) return <PageLoader label="Loading course catalogue…" />;
  if (error) return <ErrorAlert title="Courses unavailable" message={error} onRetry={load} />;

  const availableStudents = students.filter((student) => !roster.some((entry) => entry.student_id === student.id));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Academic operations"
        title="Course catalogue"
        description="Assign lecturers, manage enrollments and keep the university course structure current."
        actions={<Button leftIcon={Plus} onClick={openCreate}>Add course</Button>}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="flex items-center gap-4 p-4">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><BookOpen className="h-5 w-5" /></div>
          <div><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Courses</p><p className="mt-0.5 text-xl font-bold text-ink-950">{courses.length}</p></div>
        </Card>
        <Card className="flex items-center gap-4 p-4">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-sky-50 text-sky-700"><Users className="h-5 w-5" /></div>
          <div><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Enrollments</p><p className="mt-0.5 text-xl font-bold text-ink-950">{courses.reduce((sum, course) => sum + course.student_count, 0)}</p></div>
        </Card>
        <Card className="flex items-center gap-4 p-4">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-700"><GraduationCap className="h-5 w-5" /></div>
          <div><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Grades recorded</p><p className="mt-0.5 text-xl font-bold text-ink-950">{courses.reduce((sum, course) => sum + course.graded_count, 0)}</p></div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="field-input pl-10" placeholder="Search course code, title or lecturer…" aria-label="Search courses" />
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card><EmptyState icon={BookOpen} title="No courses found" message={search ? 'No course matches your search.' : 'Create a course to begin assigning lecturers and students.'} action={<Button onClick={openCreate} leftIcon={Plus}>Add course</Button>} /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Course</th>
                  <th>Department</th>
                  <th>Lecturer</th>
                  <th>Semester</th>
                  <th>Enrollment</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((course) => (
                  <tr key={course.id}>
                    <td>
                      <div>
                        <span className="rounded bg-ink-950 px-1.5 py-0.5 font-mono text-[10px] font-bold text-brand-200">{course.code}</span>
                        <p className="mt-1.5 text-xs font-semibold text-ink-900">{course.title}</p>
                        <p className="text-[10px] text-slate-400">{course.credits} credits · {course.academic_year}</p>
                      </div>
                    </td>
                    <td className="text-[11px]">{course.department_name}</td>
                    <td className="text-[11px]">{course.lecturer_name || <span className="text-amber-600">Unassigned</span>}</td>
                    <td className="text-[11px]">{course.semester}</td>
                    <td>
                      <div className="w-32">
                        <div className="mb-1 flex justify-between text-[10px]"><span className="text-slate-500">{course.student_count} students</span><span className="text-slate-400">{course.graded_count} graded</span></div>
                        <ProgressBar value={course.student_count ? (course.graded_count / course.student_count) * 100 : 0} tone={course.graded_count === course.student_count && course.student_count > 0 ? 'brand' : 'amber'} />
                      </div>
                    </td>
                    <td><Badge tone={course.is_active ? 'brand' : 'slate'}>{course.is_active ? 'Active' : 'Archived'}</Badge></td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <button type="button" onClick={() => void openRoster(course)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-ink-900" title="Manage roster" aria-label={`Manage roster for ${course.code}`}>
                          <Users className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => openEdit(course)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-ink-900" title="Edit course" aria-label={`Edit ${course.code}`}>
                          <Pencil className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.code}` : 'Add course'}
        description="Course assignments control which lecturer can view and grade enrolled students."
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit" form="course-form" loading={saving}>{editing ? 'Save changes' : 'Create course'}</Button>
          </>
        }
      >
        <form id="course-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          {formError && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 sm:col-span-2">{formError}</p>}
          <Input label="Course code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} error={formErrors.code} placeholder="CS205" required />
          <Input label="Course title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} error={formErrors.title} placeholder="Database Systems" required />
          <Select label="Department" value={form.departmentId} onChange={(event) => setForm({ ...form, departmentId: event.target.value })} error={formErrors.departmentId} required>
            <option value="">Select department</option>
            {departments.map((department) => <option key={department.id} value={department.id}>{department.code} · {department.name}</option>)}
          </Select>
          <Select label="Assigned lecturer" value={form.lecturerId} onChange={(event) => setForm({ ...form, lecturerId: event.target.value })} error={formErrors.lecturerId}>
            <option value="">Unassigned</option>
            {lecturers.map((lecturer) => <option key={lecturer.id} value={lecturer.id}>{lecturer.full_name} · {lecturer.staff_id || lecturer.email}</option>)}
          </Select>
          <Input label="Credits" type="number" min={1} max={12} value={form.credits} onChange={(event) => setForm({ ...form, credits: event.target.value })} error={formErrors.credits} required />
          <Select label="Semester" value={form.semester} onChange={(event) => setForm({ ...form, semester: event.target.value })}>
            <option>Semester 1</option>
            <option>Semester 2</option>
            <option>Summer</option>
          </Select>
          <Input label="Academic year" value={form.academicYear} onChange={(event) => setForm({ ...form, academicYear: event.target.value })} error={formErrors.academicYear} placeholder="2025/2026" required />
          <label className="flex items-center gap-2 pt-6 text-xs font-medium text-slate-600">
            <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
            Active course
          </label>
          <TextArea label="Description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} error={formErrors.description} containerClassName="sm:col-span-2" />
        </form>
      </Modal>

      <Modal
        open={Boolean(rosterCourse)}
        onClose={() => setRosterCourse(null)}
        title={rosterCourse ? `${rosterCourse.code} roster` : 'Course roster'}
        description={`${rosterCourse?.title || ''} · ${roster.length} enrolled student${roster.length === 1 ? '' : 's'}`}
        size="lg"
        footer={<Button variant="outline" onClick={() => setRosterCourse(null)}>Close</Button>}
      >
        {rosterCourse && (
          <div className="space-y-4">
            <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-end">
              <Select label="Add a student" value={selectedStudent} onChange={(event) => setSelectedStudent(event.target.value)} containerClassName="flex-1">
                <option value="">Select a student</option>
                {availableStudents.map((student) => <option key={student.id} value={student.id}>{student.full_name} · {student.student_id}</option>)}
              </Select>
              <Button onClick={() => void enroll()} loading={enrolling} disabled={!selectedStudent} leftIcon={UserPlus}>Enroll</Button>
            </div>

            {rosterLoading ? (
              <p className="py-8 text-center text-xs text-slate-500">Loading roster…</p>
            ) : roster.length === 0 ? (
              <EmptyState icon={Users} title="No students enrolled" message="Enroll a student using the selector above." compact />
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-slate-50 text-[9px] uppercase tracking-wider text-slate-400">
                    <tr><th className="px-3 py-2.5">Student</th><th className="px-3 py-2.5">Student ID</th><th className="px-3 py-2.5">Grade</th><th className="px-3 py-2.5" /></tr>
                  </thead>
                  <tbody>
                    {roster.map((student) => (
                      <tr key={student.enrollment_id} className="border-t border-slate-100">
                        <td className="px-3 py-2.5">
                          <p className="font-semibold text-ink-900">{student.full_name}</p>
                          <p className="text-[9px] text-slate-400">{student.programme || '—'} · Level {student.level || '—'}</p>
                        </td>
                        <td className="px-3 py-2.5 font-mono">{student.student_number}</td>
                        <td className="px-3 py-2.5">{student.letter_grade ? <Badge tone="brand">{student.letter_grade} · {student.score}</Badge> : <Badge tone="slate">Not graded</Badge>}</td>
                        <td className="px-3 py-2.5 text-right">
                          <button type="button" onClick={() => void unenroll(student.enrollment_id)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Remove enrollment" aria-label={`Remove ${student.full_name}`}>
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[10px] text-slate-400">Removing an enrollment also removes its grade through the database cascade. The operation is audited.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}

