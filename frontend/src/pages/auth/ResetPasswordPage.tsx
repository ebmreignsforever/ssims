import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { AuthLayout } from '../../layouts/AuthLayout';
import { Button, Input, PasswordStrength } from '../../components/ui';
import { api, ApiError, fieldErrors } from '../../api/client';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setErrors({});
    if (password !== confirmPassword) {
      setErrors({ confirmPassword: 'Passwords do not match' });
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/reset-password', { token, newPassword: password, confirmPassword });
      setComplete(true);
    } catch (caught) {
      setErrors(fieldErrors(caught));
      setError(caught instanceof ApiError ? caught.message : 'The password could not be reset.');
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <AuthLayout title="Invalid reset link" subtitle="No reset token was supplied.">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6">
          <p className="text-sm leading-6 text-rose-900">
            This link is incomplete. Request a new password reset link from the sign-in page.
          </p>
          <Link to="/forgot-password" className="mt-4 inline-block text-xs font-bold text-rose-900 underline">
            Request a reset link
          </Link>
        </div>
      </AuthLayout>
    );
  }

  if (complete) {
    return (
      <AuthLayout title="Password updated" subtitle="All previous sessions for your account have been revoked.">
        <div className="rounded-2xl border border-brand-200 bg-white p-7 text-center shadow-card">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-700">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-500">
            Your new password is active. Sign in again with your university email.
          </p>
          <Link to="/login" className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-700">
            Return to sign in
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password" subtitle="Your reset link is single-use and expires after 30 minutes.">
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-card sm:p-7">
        {error && <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{error}</p>}
        <form onSubmit={submit} className="space-y-4">
          <Input
            label="New password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={errors.newPassword}
            autoComplete="new-password"
            required
            autoFocus
          />
          <Input
            label="Confirm new password"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            error={errors.confirmPassword}
            autoComplete="new-password"
            required
          />
          <PasswordStrength password={password} />
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            Set new password
          </Button>
          <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-[10px] leading-4 text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            Reusing a recent password is blocked. Completing the reset invalidates every existing session.
          </div>
        </form>
      </div>
    </AuthLayout>
  );
}
