import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Eye, EyeOff, Fingerprint, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';
import { AuthLayout } from '../../layouts/AuthLayout';
import { Button, Input, PasswordStrength, SecureNotice } from '../../components/ui';
import { ApiError, fieldErrors } from '../../api/client';
import { landingFor, useAuth } from '../../context/AuthContext';

interface Challenge {
  challengeId: string;
  prompt: string;
}

type Stage = 'credentials' | 'mfa' | 'challenge';

export function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const prefill = (location.state as { email?: string; registered?: boolean; passwordChanged?: boolean } | null) || null;
  const [email, setEmail] = useState(prefill?.email || '');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [challengeAnswer, setChallengeAnswer] = useState('');
  const [stage, setStage] = useState<Stage>('credentials');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(prefill?.registered ? null : null);
  const [notice, setNotice] = useState<string | null>(
    prefill?.registered
      ? 'Your student account was created. Sign in to continue.'
      : prefill?.passwordChanged
        ? 'Your password was changed and every previous session was revoked. Sign in again.'
        : null,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (user) navigate(landingFor(user), { replace: true });
  }, [user, navigate]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    setError(null);
    setErrors({});
    setBusy(true);
    try {
      const signedIn = await login({
        email: email.trim(),
        password,
        ...(stage !== 'credentials' && mfaCode ? { mfaCode } : {}),
        ...(stage !== 'credentials' && useBackup && backupCode ? { backupCode } : {}),
        ...(challenge ? { challengeId: challenge.challengeId, challengeAnswer } : {}),
      });
      navigate(landingFor(signedIn), { replace: true });
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : null;
      if (apiError?.code === 'MFA_REQUIRED') {
        setStage('mfa');
        setNotice('Enter the six-digit code from your authenticator application.');
        return;
      }
      if (apiError?.code === 'CHALLENGE_REQUIRED') {
        const details = apiError.details as Challenge | undefined;
        if (details?.challengeId) {
          setChallenge({ challengeId: details.challengeId, prompt: details.prompt });
          setStage('challenge');
          setNotice('Unusual sign-in activity was detected. Complete the verification to continue.');
          return;
        }
      }
      if (apiError?.code === 'CHALLENGE_FAILED') {
        setChallenge(null);
        setChallengeAnswer('');
        setStage('challenge');
        setError('The verification challenge expired or was incorrect. Submit again to receive a new challenge.');
        return;
      }
      if (apiError?.code === 'ACCOUNT_LOCKED') {
        const retry = (apiError.details as { retryAfterMinutes?: number } | undefined)?.retryAfterMinutes;
        setError(`This account is temporarily locked${retry ? ` for about ${retry} minute${retry === 1 ? '' : 's'}` : ''} after repeated failed attempts. Contact an administrator.`);
        setStage('credentials');
        return;
      }
      if (apiError?.code === 'RATE_LIMITED') {
        setError('Too many sign-in requests. Wait a few minutes before trying again.');
        return;
      }
      if (stage === 'challenge' && apiError?.status === 401) {
        setChallenge(null);
        setChallengeAnswer('');
      }
      setErrors(fieldErrors(caught));
      setError(apiError?.message || 'Sign-in failed. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const resetFlow = () => {
    setStage('credentials');
    setChallenge(null);
    setChallengeAnswer('');
    setMfaCode('');
    setBackupCode('');
    setUseBackup(false);
    setError(null);
    setNotice(null);
  };

  return (
    <AuthLayout
      title="Sign in to your portal"
      subtitle="Use your university account. Access is granted by role and every session is monitored."
      footer={
        <>
          New student?{' '}
          <Link to="/register" className="font-bold text-brand-700 hover:text-brand-800">
            Create an account
          </Link>
        </>
      }
    >
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-card sm:p-7">
        {notice && (
          <div className="mb-5 rounded-xl border border-brand-100 bg-brand-50/70 px-3.5 py-3 text-xs leading-5 text-brand-900">
            {notice}
          </div>
        )}

        {error && (
          <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <p className="text-xs leading-5 text-rose-800">{error}</p>
          </div>
        )}

        {stage !== 'credentials' && (
          <div className="mb-5 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-white text-brand-700 ring-1 ring-slate-200">
              {stage === 'mfa' ? <Fingerprint className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-ink-900">{stage === 'mfa' ? 'Second factor required' : 'Human verification'}</p>
              <p className="truncate text-[10px] text-slate-500">{email}</p>
            </div>
            <button type="button" onClick={resetFlow} className="text-[10px] font-semibold text-slate-500 underline underline-offset-2 hover:text-ink-900">
              Start over
            </button>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          {stage === 'credentials' && (
            <>
              <Input
                label="University email"
                type="email"
                name="email"
                autoComplete="username"
                autoFocus
                placeholder="you@ssims.edu"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                error={errors.email}
                required
              />
              <div>
                <Input
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  error={errors.password}
                  required
                  rightElement={
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="rounded-md p-2 text-slate-400 transition hover:text-slate-700"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  }
                />
                <div className="mt-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[10px] text-slate-400">
                    <LockKeyhole className="h-3 w-3" /> Stored as Argon2id hash
                  </span>
                  <Link to="/forgot-password" className="text-[11px] font-semibold text-brand-700 hover:text-brand-800">
                    Forgot password?
                  </Link>
                </div>
              </div>
              {password.length > 0 && <PasswordStrength password={password} />}
            </>
          )}

          {stage === 'mfa' && (
            <div className="space-y-4">
              {!useBackup ? (
                <Input
                  label="Authenticator code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  autoFocus
                  placeholder="000000"
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  hint="Open your authenticator app and enter the current 6-digit code."
                  className="text-center text-xl font-bold tracking-[0.4em]"
                />
              ) : (
                <Input
                  label="Backup recovery code"
                  autoComplete="one-time-code"
                  autoFocus
                  placeholder="XXXXX-XXXXX"
                  value={backupCode}
                  onChange={(event) => setBackupCode(event.target.value.toUpperCase())}
                  hint="Each backup code works once. It will be invalidated after use."
                />
              )}
              <button
                type="button"
                onClick={() => {
                  setUseBackup((current) => !current);
                  setMfaCode('');
                  setBackupCode('');
                }}
                className="text-xs font-semibold text-brand-700 hover:text-brand-800"
              >
                {useBackup ? 'Use authenticator app instead' : 'Use a backup recovery code'}
              </button>
            </div>
          )}

          {stage === 'challenge' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="flex items-center gap-2 text-xs font-bold text-amber-900">
                  <ShieldCheck className="h-4 w-4" /> Additional verification
                </p>
                <p className="mt-2 text-xl font-bold tracking-tight text-ink-950">
                  {challenge?.prompt || 'Press continue to receive a new challenge.'}
                </p>
              </div>
              <Input
                label="Your answer"
                inputMode="numeric"
                autoFocus
                maxLength={10}
                placeholder="Answer"
                value={challengeAnswer}
                onChange={(event) => setChallengeAnswer(event.target.value.replace(/\D/g, ''))}
                hint="This challenge is rate-limited and expires after five minutes."
              />
              {mfaCode && <p className="text-[11px] text-slate-500">Your authenticator code will be submitted with this verification.</p>}
              {backupCode && <p className="text-[11px] text-slate-500">Your backup recovery code will be submitted with this verification.</p>}
            </div>
          )}

          <Button type="submit" size="lg" className="w-full" loading={busy} rightIcon={ArrowRight}>
            {stage === 'credentials' ? 'Sign in securely' : stage === 'mfa' ? 'Verify and continue' : 'Complete verification'}
          </Button>
        </form>

        <div className="mt-5 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-[10px] leading-5 text-slate-500">
          <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span>
            This portal never asks for your password by email. Sessions use HttpOnly refresh cookies, CSRF tokens and
            server-enforced role permissions.
          </span>
        </div>
      </div>

      <div className="mt-6">
        <SecureNotice>
          <span className="font-semibold">Authorized access only.</span> All sign-in attempts, MFA results and account
          restrictions are recorded in the append-only security log.
        </SecureNotice>
      </div>
    </AuthLayout>
  );
}
