import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink, MailCheck, ShieldCheck } from 'lucide-react';
import { AuthLayout } from '../../layouts/AuthLayout';
import { Button, Input } from '../../components/ui';
import { api, ApiError } from '../../api/client';

interface ForgotResponse {
  message: string;
  developmentResetUrl?: string;
  developmentNotice?: boolean;
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ForgotResponse | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(await api.post<ForgotResponse>('/auth/forgot-password', { email }));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not request a password reset.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We issue a single-use, 30-minute reset link without revealing whether an email is registered."
      footer={
        <Link to="/login" className="inline-flex items-center gap-1.5 font-bold text-brand-700 hover:text-brand-800">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
        </Link>
      }
    >
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-card sm:p-7">
        {result ? (
          <div>
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-brand-50 text-brand-700">
              <MailCheck className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-lg font-bold text-ink-950">Check your inbox</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">{result.message}</p>
            {result.developmentResetUrl && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-amber-800">Development delivery</p>
                <p className="mt-1 text-xs leading-5 text-amber-900">
                  Email delivery is disabled locally. This one-time link is shown only because EXPOSE_RESET_TOKEN is
                  enabled for the academic demo.
                </p>
                <a
                  href={result.developmentResetUrl}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-amber-900 underline underline-offset-2"
                >
                  Open password reset link <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
            <Button className="mt-5 w-full" variant="outline" onClick={() => setResult(null)}>
              Send another request
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {error && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{error}</p>}
            <Input
              label="University email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@ssims.edu"
              autoComplete="email"
              required
              autoFocus
              hint="Only an active account can complete the reset, but the response is identical for unknown emails."
            />
            <Button type="submit" size="lg" className="w-full" loading={busy}>
              Send reset link
            </Button>
            <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-[10px] leading-4 text-slate-500">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
              Reset tokens are stored only as keyed hashes, expire after 30 minutes and are invalidated after one use.
            </div>
          </form>
        )}
      </div>
    </AuthLayout>
  );
}
