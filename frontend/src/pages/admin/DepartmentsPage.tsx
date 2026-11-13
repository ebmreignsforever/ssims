import { FormEvent, useEffect, useState } from 'react';
import { BookOpen, Building2, GraduationCap, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { api, ApiError, fieldErrors } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import type { Department } from '../../types';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorAlert,
  Input,
  Modal,
  PageHeader,
  PageLoader,
  TextArea,
} from '../../components/ui';

export function DepartmentsPage() {
  const { success, error: toastError } = useToast();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [form, setForm] = useState({ code: '', name: '', description: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Department | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    api.get<Department[]>('/departments').then(setDepartments).catch((caught: Error) => setError(caught.message)).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ code: '', name: '', description: '' });
    setErrors({});
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (department: Department) => {
    setEditing(department);
    setForm({ code: department.code, name: department.name, description: department.description });
    setErrors({});
    setFormError(null);
    setModalOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      if (editing) {
        await api.patch(`/departments/${editing.id}`, form);
        success('Department updated');
      } else {
        await api.post('/departments', form);
        success('Department created');
      }
      setModalOpen(false);
      load();
    } catch (caught) {
      setErrors(fieldErrors(caught));
      setFormError(caught instanceof ApiError ? caught.message : 'Could not save the department');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.delete(`/departments/${deleting.id}`);
      success('Department deleted');
      setDeleting(null);
      load();
    } catch (caught) {
      toastError('Department could not be deleted', caught instanceof Error ? caught.message : undefined);
    } finally {
      setDeleteBusy(false);
    }
  };

  if (loading) return <PageLoader label="Loading academic structure…" />;
  if (error) return <ErrorAlert title="Departments unavailable" message={error} onRetry={load} />;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Academic administration"
        title="Departments"
        description="Maintain the faculties and departments that anchor courses, staff and student records."
        actions={<Button leftIcon={Plus} onClick={openCreate}>Add department</Button>}
      />

      {departments.length === 0 ? (
        <Card>
          <EmptyState icon={Building2} title="No departments yet" message="Create the first academic department to begin assigning courses and staff." action={<Button onClick={openCreate}>Add department</Button>} />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {departments.map((department, index) => (
            <Card key={department.id} className="group relative overflow-hidden p-5 transition hover:border-brand-200 hover:shadow-float">
              <div className={`absolute inset-x-0 top-0 h-1 ${index % 3 === 0 ? 'bg-brand-500' : index % 3 === 1 ? 'bg-sky-500' : 'bg-accent-400'}`} />
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-700">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-mono text-[10px] font-bold tracking-wider text-brand-700">{department.code}</p>
                    <h2 className="mt-0.5 text-sm font-bold text-ink-900">{department.name}</h2>
                  </div>
                </div>
                <div className="flex gap-1 opacity-100 transition md:opacity-0 md:group-hover:opacity-100">
                  <button type="button" onClick={() => openEdit(department)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-ink-900" aria-label={`Edit ${department.name}`}>
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => setDeleting(department)} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Delete ${department.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <p className="mt-3 line-clamp-2 min-h-[40px] text-xs leading-5 text-slate-500">{department.description || 'No department description provided.'}</p>
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-4">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 text-slate-400"><Users className="h-3 w-3" /><span className="text-[9px] font-bold uppercase">Students</span></div>
                  <p className="mt-1 text-lg font-bold text-ink-900">{department.student_count ?? 0}</p>
                </div>
                <div className="border-x border-slate-100 text-center">
                  <div className="flex items-center justify-center gap-1 text-slate-400"><GraduationCap className="h-3 w-3" /><span className="text-[9px] font-bold uppercase">Staff</span></div>
                  <p className="mt-1 text-lg font-bold text-ink-900">{department.lecturer_count ?? 0}</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 text-slate-400"><BookOpen className="h-3 w-3" /><span className="text-[9px] font-bold uppercase">Courses</span></div>
                  <p className="mt-1 text-lg font-bold text-ink-900">{department.course_count ?? 0}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card className="flex flex-wrap items-center justify-between gap-3 bg-slate-50/50 px-5 py-4">
        <div>
          <p className="text-xs font-bold text-ink-900">Departments are referenced by courses and accounts.</p>
          <p className="mt-0.5 text-[11px] text-slate-500">A department with existing courses cannot be deleted until those courses are reassigned.</p>
        </div>
        <span className="text-xs font-bold text-brand-700">{departments.length} faculties</span>
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit department' : 'Add department'}
        description="Codes are unique and appear on course and staff records."
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit" form="department-form" loading={saving}>{editing ? 'Save changes' : 'Create department'}</Button>
          </>
        }
      >
        <form id="department-form" onSubmit={submit} className="space-y-4">
          {formError && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{formError}</p>}
          <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
            <Input label="Code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} error={errors.code} placeholder="CS" required />
            <Input label="Department name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} error={errors.name} placeholder="Computer Science" required />
          </div>
          <TextArea label="Description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} error={errors.description} placeholder="Brief description of the department and its programmes." />
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete department?"
        message={`This will permanently remove ${deleting?.name || 'the department'} if it has no courses. This action is audited.`}
        confirmLabel="Delete department"
        onCancel={() => setDeleting(null)}
        onConfirm={() => void remove()}
        loading={deleteBusy}
      />
    </div>
  );
}
