import { FormEvent, useEffect, useState } from 'react';
import {
  KeyRound,
  LockKeyhole,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Unlock,
  UserCog,
  UserRound,
  Users,
} from 'lucide-react';
import { api, ApiError, fieldErrors, qs } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import type { AdminUserRow, Department, PaginatedMeta, Role, User } from '../../types';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  CopyButton,
  EmptyState,
  ErrorAlert,
  Input,
  Modal,
  PageHeader,
  Pagination,
  RoleBadge,
  Select,
  SkeletonTable,
  StatusBadge,
  TextArea,
} from '../../components/ui';
import { formatDate, formatDateTime, formatRole } from '../../utils/format';

interface UserDetail {
  user: User;
  enrollments: {
    enrollment_id: string;
    course_id: string;
    code: string;
    title: string;
    credits: number;
    semester: string;
    academic_year: string;
    score: string | null;
    letter_grade: string | null;
    lecturer_name: string | null;
  }[];
}

interface AccountForm {
  email: string;
  fullName: string;
  role: Role;
  studentId: string;
  staffId: string;
  departmentId: string;
  phone: string;
  address: string;
  programme: string;
  level: string;
  password: string;
  mustChangePassword: boolean;
}

const EMPTY_FORM: AccountForm = {
  email: '',
  fullName: '',
  role: 'student',
  studentId: '',
  staffId: '',
  departmentId: '',
  phone: '',
  address: '',
  programme: '',
  level: '',
  password: '',
  mustChangePassword: true,
};

type PendingAction = { type: 'status'; user: AdminUserRow; status: 'active' | 'suspended' | 'locked' } | { type: 'unlock'; user: AdminUserRow } | { type: 'reset'; user: AdminUserRow } | null;

export function UsersPage() {
  const { user: me } = useAuth();
  const { success, error: toastError } = useToast();
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [meta, setMeta] = useState<PaginatedMeta>({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<AccountForm>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);

  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<AccountForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [roleDraft, setRoleDraft] = useState<Role>('student');

  const canManageAdmins = me?.role === 'super_admin';

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .getWithMeta<AdminUserRow[]>(`/admin/users${qs({ page, limit: 10, search, role: roleFilter, status: statusFilter })}`)
      .then((response) => {
        setRows(response.data);
        if (response.meta) setMeta(response.meta as unknown as PaginatedMeta);
      })
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [page, search, roleFilter, statusFilter]);

  useEffect(() => {
    api.get<Department[]>('/departments').then(setDepartments).catch(() => setDepartments([]));
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  const openDetail = async (row: AdminUserRow) => {
    setDetailLoading(true);
    setDetail(null);
    setRoleDraft(row.role);
    try {
      const result = await api.get<UserDetail>(`/admin/users/${row.id}`);
      setDetail(result);
    } catch (caught) {
      toastError('Could not load account', caught instanceof Error ? caught.message : undefined);
    } finally {
      setDetailLoading(false);
    }
  };

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    setFormErrors({});
    try {
      const result = await api.post<{ user: User; temporaryPassword?: string }>('/admin/users', {
        email: form.email,
        fullName: form.fullName,
        role: form.role,
        studentId: form.role === 'student' ? form.studentId : undefined,
        staffId: form.role !== 'student' ? form.staffId || undefined : undefined,
        departmentId: form.departmentId || null,
        phone: form.phone || undefined,
        address: form.address || undefined,
        programme: form.role === 'student' ? form.programme || undefined : undefined,
        level: form.role === 'student' ? form.level || undefined : undefined,
        password: form.password || undefined,
      });
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      setCredentials({ email: result.user.email, password: result.temporaryPassword || form.password });
      setPage(1);
      load();
      success('Account created', `${result.user.fullName} can now sign in.`);
    } catch (caught) {
      setFormErrors(fieldErrors(caught));
      setFormError(caught instanceof ApiError ? caught.message : 'Could not create the account');
    } finally {
      setSaving(false);
    }
  };

  const beginEdit = async (row: AdminUserRow) => {
    try {
      const result = await api.get<UserDetail>(`/admin/users/${row.id}`);
      const target = result.user;
      setEditingId(row.id);
      setEditForm({
        email: target.email,
        fullName: target.fullName,
        role: target.role,
        studentId: target.studentId || '',
        staffId: target.staffId || '',
        departmentId: target.departmentId || '',
        phone: target.phone || '',
        address: target.address || '',
        programme: target.programme || '',
        level: target.level || '',
        password: '',
        mustChangePassword: target.mustChangePassword,
      });
      setFormErrors({});
      setFormError(null);
      setEditOpen(true);
    } catch (caught) {
      toastError('Could not open account', caught instanceof Error ? caught.message : undefined);
    }
  };

  const submitEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingId) return;
    setSaving(true);
    setFormError(null);
    setFormErrors({});
    try {
      await api.patch(`/admin/users/${editingId}`, {
        email: editForm.email,
        fullName: editForm.fullName,
        studentId: editForm.role === 'student' ? editForm.studentId : editForm.studentId || null,
        staffId: editForm.role !== 'student' ? editForm.staffId : editForm.staffId || null,
        departmentId: editForm.departmentId || null,
        phone: editForm.phone || null,
        address: editForm.address || null,
        programme: editForm.role === 'student' ? editForm.programme || null : null,
        level: editForm.role === 'student' ? editForm.level || null : null,
        mustChangePassword: editForm.mustChangePassword,
      });
      setEditOpen(false);
      setDetail(null);
      load();
      success('Account updated');
    } catch (caught) {
      setFormErrors(fieldErrors(caught));
      setFormError(caught instanceof ApiError ? caught.message : 'Could not update the account');
    } finally {
      setSaving(false);
    }
  };

  const changeRole = async () => {
    if (!detail) return;
    if (roleDraft === detail.user.role) return;
    setActionLoading(true);
    try {
      await api.patch(`/admin/users/${detail.user.id}/role`, { role: roleDraft });
      success('Role updated', `${detail.user.fullName} is now ${formatRole(roleDraft)}.`);
      const target = rows.find((row) => row.id === detail.user.id);
      if (target) await openDetail({ ...target, role: roleDraft });
      load();
    } catch (caught) {
      toastError('Role change rejected', caught instanceof Error ? caught.message : undefined);
    } finally {
      setActionLoading(false);
    }
  };

  const runPending = async () => {
    if (!pending) return;
    setActionLoading(true);
    try {
      if (pending.type === 'status') {
        await api.patch(`/admin/users/${pending.user.id}/status`, { status: pending.status });
        success('Account status updated');
      } else if (pending.type === 'unlock') {
        await api.post(`/admin/users/${pending.user.id}/unlock`);
        success('Account unlocked');
      } else if (pending.type === 'reset') {
        const result = await api.post<{ temporaryPassword: string }>(`/admin/users/${pending.user.id}/reset-password`);
        setCredentials({ email: pending.user.email, password: result.temporaryPassword });
        success('Temporary password issued');
      }
      setPending(null);
      setDetail(null);
      load();
    } catch (caught) {
      toastError('Action rejected', caught instanceof Error ? caught.message : undefined);
    } finally {
      setActionLoading(false);
    }
  };

  const availableRoles: Role[] = canManageAdmins ? ['super_admin', 'administrator', 'lecturer', 'student'] : ['lecturer', 'student'];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Identity administration"
        title="Users & student records"
        description="Create accounts, assign roles, enforce restrictions and review the people who can access university data."
        actions={
          <Button leftIcon={Plus} onClick={() => { setForm(EMPTY_FORM); setFormErrors({}); setFormError(null); setCreateOpen(true); }}>
            Create account
          </Button>
        }
      />

      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search name, email, student or staff ID…"
              className="field-input pl-10"
              aria-label="Search accounts"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <select value={roleFilter} onChange={(event) => { setRoleFilter(event.target.value); setPage(1); }} className="field-select w-full sm:w-44" aria-label="Filter by role">
              <option value="">All roles</option>
              <option value="super_admin">Super Administrator</option>
              <option value="administrator">Administrator</option>
              <option value="lecturer">Lecturer</option>
              <option value="student">Student</option>
            </select>
            <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }} className="field-select w-full sm:w-40" aria-label="Filter by status">
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="locked">Locked</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>
        </div>
      </Card>

      {error && <ErrorAlert title="Could not load accounts" message={error} onRetry={load} />}

      <Card className="overflow-hidden">
        {loading ? (
          <SkeletonTable rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No accounts match those filters"
            message="Try a different search term or create a new account."
            action={<Button variant="secondary" leftIcon={Plus} onClick={() => setCreateOpen(true)}>Create account</Button>}
          />
        ) : (
          <>
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Role</th>
                    <th>Identifier</th>
                    <th>Department</th>
                    <th>MFA</th>
                    <th>Status</th>
                    <th>Last sign-in</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={row.full_name} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-ink-900">{row.full_name}</p>
                            <p className="truncate text-[10px] text-slate-400">{row.email}</p>
                          </div>
                        </div>
                      </td>
                      <td><RoleBadge role={row.role} /></td>
                      <td className="font-mono text-[11px]">{row.student_id || row.staff_id || '—'}</td>
                      <td className="text-[11px]">{row.department_name || '—'}</td>
                      <td>
                        {row.mfa_enabled ? (
                          <Badge tone="brand"><ShieldCheck className="h-3 w-3" /> Enabled</Badge>
                        ) : (
                          <Badge tone="slate">Off</Badge>
                        )}
                      </td>
                      <td><StatusBadge status={row.status} /></td>
                      <td className="text-[11px]">{row.last_login_at ? formatDate(row.last_login_at) : 'Never'}</td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <button type="button" onClick={() => void openDetail(row)} className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-ink-900" title="View account" aria-label={`View ${row.full_name}`}>
                            <UserRound className="h-4 w-4" />
                          </button>
                          <button type="button" onClick={() => void beginEdit(row)} className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-ink-900" title="Edit account" aria-label={`Edit ${row.full_name}`}>
                            <Pencil className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={meta.page} totalPages={meta.totalPages} total={meta.total} onChange={setPage} />
          </>
        )}
      </Card>

      {/* Create account */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create an account"
        description="New accounts receive a temporary credential and must change it after first sign-in."
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button type="submit" form="create-account-form" loading={saving} leftIcon={Plus}>Create account</Button>
          </>
        }
      >
        <form id="create-account-form" onSubmit={submitCreate} className="grid gap-4 sm:grid-cols-2">
          {formError && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 sm:col-span-2">{formError}</p>}
          <Input label="Full name" value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} error={formErrors.fullName} required />
          <Input label="University email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} error={formErrors.email} required />
          <Select label="Role" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Role })} error={formErrors.role}>
            {availableRoles.map((role) => <option key={role} value={role}>{formatRole(role)}</option>)}
          </Select>
          <Select label="Department" value={form.departmentId} onChange={(event) => setForm({ ...form, departmentId: event.target.value })} error={formErrors.departmentId}>
            <option value="">No department</option>
            {departments.map((department) => <option key={department.id} value={department.id}>{department.code} · {department.name}</option>)}
          </Select>
          {form.role === 'student' ? (
            <>
              <Input label="Student ID" value={form.studentId} onChange={(event) => setForm({ ...form, studentId: event.target.value.toUpperCase() })} error={formErrors.studentId} required />
              <Input label="Programme" value={form.programme} onChange={(event) => setForm({ ...form, programme: event.target.value })} error={formErrors.programme} placeholder="BSc Computer Science" />
              <Input label="Level" value={form.level} onChange={(event) => setForm({ ...form, level: event.target.value })} error={formErrors.level} placeholder="300" />
            </>
          ) : (
            <Input label="Staff ID" value={form.staffId} onChange={(event) => setForm({ ...form, staffId: event.target.value.toUpperCase() })} error={formErrors.staffId} placeholder="LEC-0003" />
          )}
          <Input label="Phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} error={formErrors.phone} />
          <Input
            label="Initial password"
            type="password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            error={formErrors.password}
            hint="Leave blank to generate a one-time temporary password."
            autoComplete="new-password"
          />
          <TextArea label="Address" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} error={formErrors.address} containerClassName="sm:col-span-2" />
        </form>
      </Modal>

      {/* Created credentials */}
      <Modal
        open={Boolean(credentials)}
        onClose={() => setCredentials(null)}
        title="Account credentials"
        description="This temporary password is shown only once."
        size="sm"
        footer={<Button onClick={() => setCredentials(null)}>I have stored it securely</Button>}
      >
        {credentials && (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
              Share this credential through an approved secure channel. The account is required to change it at first login.
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Email</p>
              <p className="mt-1 break-all font-mono text-sm text-ink-900">{credentials.email}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Temporary password</p>
              <div className="mt-1 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <code className="min-w-0 flex-1 break-all text-xs text-ink-900">{credentials.password}</code>
                <CopyButton value={credentials.password} />
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Detail / manage */}
      <Modal
        open={Boolean(detail) || detailLoading}
        onClose={() => { setDetail(null); setDetailLoading(false); }}
        title={detail ? detail.user.fullName : 'Loading account…'}
        description={detail ? `${formatRole(detail.user.role)} · ${detail.user.email}` : undefined}
        size="lg"
        footer={detail ? <Button variant="outline" onClick={() => { setDetail(null); setDetailLoading(false); }}>Close</Button> : undefined}
      >
        {detailLoading ? (
          <div className="flex min-h-[200px] items-center justify-center text-sm text-slate-500">Retrieving account record…</div>
        ) : detail ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <RoleBadge role={detail.user.role} />
              <StatusBadge status={detail.user.status} />
              {detail.user.mfaEnabled ? <Badge tone="brand"><ShieldCheck className="h-3 w-3" /> MFA enabled</Badge> : <Badge tone="amber">MFA not enabled</Badge>}
              {detail.user.mustChangePassword && <Badge tone="amber">Password change required</Badge>}
            </div>

            <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:grid-cols-2">
              {[
                ['Email', detail.user.email],
                ['Student ID', detail.user.studentId || '—'],
                ['Staff ID', detail.user.staffId || '—'],
                ['Department', detail.user.departmentName || '—'],
                ['Programme', detail.user.programme || '—'],
                ['Level', detail.user.level || '—'],
                ['Last sign-in', formatDateTime(detail.user.lastLoginAt)],
                ['MFA backup codes left', String(detail.user.backupCodesRemaining)],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
                  <p className="mt-0.5 break-all text-xs text-slate-700">{value}</p>
                </div>
              ))}
            </div>

            <div>
              <h3 className="text-xs font-bold text-ink-900">Registered courses & grades</h3>
              {detail.enrollments.length === 0 ? (
                <p className="mt-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">No course enrollments recorded.</p>
              ) : (
                <div className="mt-2 overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-slate-50 text-[9px] uppercase tracking-wider text-slate-400">
                      <tr><th className="px-3 py-2">Course</th><th className="px-3 py-2">Credits</th><th className="px-3 py-2">Score</th><th className="px-3 py-2">Grade</th></tr>
                    </thead>
                    <tbody>
                      {detail.enrollments.map((enrollment) => (
                        <tr key={enrollment.enrollment_id} className="border-t border-slate-100">
                          <td className="px-3 py-2"><span className="font-semibold text-ink-900">{enrollment.code}</span> · {enrollment.title}</td>
                          <td className="px-3 py-2">{enrollment.credits}</td>
                          <td className="px-3 py-2">{enrollment.score ?? '—'}</td>
                          <td className="px-3 py-2 font-semibold">{enrollment.letter_grade ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <h3 className="flex items-center gap-2 text-xs font-bold text-ink-900"><UserCog className="h-4 w-4 text-brand-700" /> Access controls</h3>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                <Select label="Assigned role" value={roleDraft} onChange={(event) => setRoleDraft(event.target.value as Role)} containerClassName="sm:w-56">
                  {availableRoles.map((role) => <option key={role} value={role}>{formatRole(role)}</option>)}
                </Select>
                <Button variant="secondary" onClick={() => void changeRole()} loading={actionLoading} disabled={roleDraft === detail.user.role}>Apply role</Button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {detail.user.status === 'active' ? (
                  <>
                    <Button size="sm" variant="outline" leftIcon={LockKeyhole} onClick={() => setPending({ type: 'status', user: rows.find((row) => row.id === detail.user.id)!, status: 'locked' })}>Lock account</Button>
                    <Button size="sm" variant="outline" leftIcon={UserCog} onClick={() => setPending({ type: 'status', user: rows.find((row) => row.id === detail.user.id)!, status: 'suspended' })}>Suspend</Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="secondary" leftIcon={Unlock} onClick={() => setPending({ type: 'unlock', user: rows.find((row) => row.id === detail.user.id)! })}>Unlock</Button>
                    <Button size="sm" variant="outline" onClick={() => setPending({ type: 'status', user: rows.find((row) => row.id === detail.user.id)!, status: 'active' })}>Activate</Button>
                  </>
                )}
                <Button size="sm" variant="outline" leftIcon={KeyRound} onClick={() => setPending({ type: 'reset', user: rows.find((row) => row.id === detail.user.id)! })}>Reset password</Button>
                <Button size="sm" variant="outline" leftIcon={Pencil} onClick={() => void beginEdit(rows.find((row) => row.id === detail.user.id)!)}>Edit details</Button>
              </div>
              <p className="mt-3 text-[10px] leading-5 text-slate-400">
                Locking or suspending revokes all active sessions immediately. Backend role checks remain authoritative even if UI controls are bypassed.
              </p>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Edit */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit account details"
        description="Role and status are managed separately to preserve an explicit audit trail."
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button type="submit" form="edit-account-form" loading={saving} leftIcon={Pencil}>Save changes</Button>
          </>
        }
      >
        <form id="edit-account-form" onSubmit={submitEdit} className="grid gap-4 sm:grid-cols-2">
          {formError && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 sm:col-span-2">{formError}</p>}
          <Input label="Full name" value={editForm.fullName} onChange={(event) => setEditForm({ ...editForm, fullName: event.target.value })} error={formErrors.fullName} required />
          <Input label="University email" type="email" value={editForm.email} onChange={(event) => setEditForm({ ...editForm, email: event.target.value })} error={formErrors.email} required />
          <Input label="Student ID" value={editForm.studentId} onChange={(event) => setEditForm({ ...editForm, studentId: event.target.value.toUpperCase() })} error={formErrors.studentId} />
          <Input label="Staff ID" value={editForm.staffId} onChange={(event) => setEditForm({ ...editForm, staffId: event.target.value.toUpperCase() })} error={formErrors.staffId} />
          <Select label="Department" value={editForm.departmentId} onChange={(event) => setEditForm({ ...editForm, departmentId: event.target.value })}>
            <option value="">No department</option>
            {departments.map((department) => <option key={department.id} value={department.id}>{department.code} · {department.name}</option>)}
          </Select>
          <Input label="Phone" value={editForm.phone} onChange={(event) => setEditForm({ ...editForm, phone: event.target.value })} />
          <Input label="Programme" value={editForm.programme} onChange={(event) => setEditForm({ ...editForm, programme: event.target.value })} />
          <Input label="Level" value={editForm.level} onChange={(event) => setEditForm({ ...editForm, level: event.target.value })} />
          <TextArea label="Address" value={editForm.address} onChange={(event) => setEditForm({ ...editForm, address: event.target.value })} containerClassName="sm:col-span-2" />
          <label className="flex items-center gap-2 text-xs text-slate-600 sm:col-span-2">
            <input type="checkbox" checked={editForm.mustChangePassword} onChange={(event) => setEditForm({ ...editForm, mustChangePassword: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
            Require a password change at next sign-in
          </label>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(pending)}
        title={
          pending?.type === 'reset' ? 'Reset account password?' : pending?.type === 'unlock' ? 'Unlock account?' : 'Change account status?'
        }
        message={
          pending?.type === 'reset'
            ? 'A new temporary password will be issued, all active sessions revoked and the user required to change it. Continue?'
            : pending?.type === 'unlock'
              ? 'This clears the failed-login counter and removes the temporary lock. Continue?'
              : `Set this account to ${pending?.type === 'status' ? pending.status : ''}? Active sessions will be revoked if the account is restricted.`
        }
        confirmLabel={pending?.type === 'reset' ? 'Issue temporary password' : pending?.type === 'unlock' ? 'Unlock' : 'Apply status'}
        onCancel={() => setPending(null)}
        onConfirm={() => void runPending()}
        loading={actionLoading}
        danger={pending?.type !== 'unlock'}
      />

    </div>
  );
}
