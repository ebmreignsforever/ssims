import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, GraduationCap, ShieldCheck } from 'lucide-react';
import { AuthLayout } from '../../layouts/AuthLayout';
import { Button, Input, PasswordStrength, Select, SecureNotice } from '../../components/ui';
import { api, ApiError, fieldErrors } from '../../api/client';
import type { Department, User } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { homeForRole } from '../../context/AuthContext';

export function RegisterPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    studentId: '',
    departmentId: '',
    phone: '',
    password: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);

  useEffect(() => {
    if (user) navigate(homeForRole(user.role), { replace: true });
  }, [user, navigate]);

  useEffect(() => {
    api
      .get<Department[]>('/public/departments')
      .then(setDepartments)
      .catch(() => setDepartments([]));
  }, []);

  const update = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: '' }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setErrors({});
    if (form.password !== form.confirmPassword) {
      setErrors({ confirmPassword: 'Passwords do not match' });
      return;
    }
    setBusy(true);
    try {
      await api.post<{ user: User }>('/auth/register', {
        fullName: form.fullName,
        email: form.email,
        studentId: form.studentId,
        departmentId: form.departmentId || undefined,
        phone: form.phone || undefined,
        password: form.password,
      });
      setCreated(true);
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : null;
      setErrors(fieldErrors(caught));
      setError(apiError?.message || 'Registration could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <AuthLayout title="Account created" subtitle="Your student identity has been provisioned securely.">
        <div className="rounded-2xl border border-brand-200 bg-white p-7 text-center shadow-card">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-700">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h2 className="mt-5 text-xl font-bold text-ink-950">Welcome to SSIMS</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Your student account is active. Sign in with your university email and the password you just created.
            You can enable authenticator-app MFA immediately after signing in.
          </p>
          <Button className="mt-6 w-full" size="lg" onClick={() => navigate('/login', { state: { email: form.email, registered: true } })} rightIcon={ArrowRight}>
            Continue to sign in
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      wide
      title="Create your student account"
      subtitle="Register once with your official student details. Administrator-created accounts follow a separate process."
      footer={
        <>
          Already registered?{' '}
          <Link to="/login" className="font-bold text-brand-700 hover:text-brand-800">
            Sign in
          </Link>
        </>
      }
    >
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-card sm:p-7">
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-white text-brand-700 ring-1 ring-slate-200">
            <GraduationCap className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs font-bold text-ink-900">Student self-registration</p>
            <p className="text-[10px] text-slate-500">Only the Student role is available through this public form.</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <p className="text-xs leading-5 text-rose-800">{error}</p>
          </div>
        )}

        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Full name"
            value={form.fullName}
            onChange={(event) => update('fullName', event.target.value)}
            placeholder="e.g. Ama Serwaa"
            error={errors.fullName}
            required
            autoComplete="name"
          />
          <Input
            label="University email"
            type="email"
            value={form.email}
            onChange={(event) => update('email', event.target.value)}
            placeholder="you@ssims.edu"
            error={errors.email}
            required
            autoComplete="email"
          />
          <Input
            label="Student ID"
            value={form.studentId}
            onChange={(event) => update('studentId', event.target.value.toUpperCase())}
            placeholder="STU-2026-0007"
            error={errors.studentId}
            required
            hint="Use the ID issued by the university registry."
          />
          <Select
            label="Department"
            value={form.departmentId}
            onChange={(event) => update('departmentId', event.target.value)}
            error={errors.departmentId}
          >
            <option value="">Select department (optional)</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.code} · {department.name}
              </option>
            ))}
          </Select>
          <Input
            label="Phone number"
            value={form.phone}
            onChange={(event) => update('phone', event.target.value)}
            placeholder="+233 20 000 0000"
            error={errors.phone}
            autoComplete="tel"
            containerClassName="sm:col-span-2"
          />
          <Input
            label="Password"
            type="password"
            value={form.password}
            onChange={(event) => update('password', event.target.value)}
            placeholder="Create a strong password"
            error={errors.password}
            required
            autoComplete="new-password"
            hint="Minimum 12 characters with upper/lowercase, number and special character."
          />
          <Input
            label="Confirm password"
            type="password"
            value={form.confirmPassword}
            onChange={(event) => update('confirmPassword', event.target.value)}
            placeholder="Repeat your password"
            error={errors.confirmPassword}
            required
            autoComplete="new-password"
          />
          <div className="sm:col-span-2">
            <PasswordStrength password={form.password} />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" size="lg" className="w-full" loading={busy} rightIcon={ArrowRight}>
              Create secure student account
            </Button>
          </div>
        </form>
      </div>
      <div className="mt-5">
        <SecureNotice>
          Passwords are hashed with Argon2id and checked against a compromised-password denylist. Your student ID is
          unique and registering does not grant access to staff or administrative data.
        </SecureNotice>
      </div>
    </AuthLayout>
  );
}
