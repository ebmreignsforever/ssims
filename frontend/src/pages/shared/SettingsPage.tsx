import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  Download,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  Mail,
  ShieldCheck,
  ShieldOff,
  ShieldQuestion,
  Smartphone,
  UserRound,
} from 'lucide-react';
import { api, ApiError, fieldErrors } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import type { User } from '../../types';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CopyButton,
  Input,
  Modal,
  PageHeader,
  PasswordStrength,
  RoleBadge,
  SectionHeader,
  TextArea,
} from '../../components/ui';
import { formatDateTime, formatRole } from '../../utils/format';

type MfaMode = 'setup' | 'disable' | 'regenerate' | null;

interface MfaSetupData {
  qrCodeDataUrl: string;
  otpauthUrl: string;
  secret: string;
}

export function SettingsPage() {
  const { user, setUser, refreshUser, logout } = useAuth();
  const { success, error: toastError } = useToast();
  const navigate = useNavigate();

  const [phone, setPhone] = useState(user?.phone || '');
  const [address, setAddress] = useState(user?.address || '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});

  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);

  const [mfaMode, setMfaMode] = useState<MfaMode>(null);
  const [mfaPassword, setMfaPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaBusy, setMfaBusy] = useState(false);
  const [setupData, setSetupData] = useState<MfaSetupData | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  useEffect(() => {
    setPhone(user?.phone || '');
    setAddress(user?.address || '');
  }, [user]);

  if (!user) return null;

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (user.role !== 'student') return;
    setProfileSaving(true);
    setProfileErrors({});
    try {
      const result = await api.patch<{ user: User }>('/student/profile', { phone, address });
      setUser(result.user);
      success('Profile updated', 'Only permitted contact fields were changed.');
    } catch (caught) {
      setProfileErrors(fieldErrors(caught));
      toastError('Profile update failed', caught instanceof Error ? caught.message : undefined);
    } finally {
      setProfileSaving(false);
    }
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordError(null);
    setPasswordErrors({});
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordErrors({ confirmPassword: 'Passwords do not match' });
      return;
    }
    setPasswordSaving(true);
    try {
      await api.post('/auth/change-password', passwordForm);
      success('Password changed', 'All sessions have been revoked. Sign in with your new password.');
      await logout();
      navigate('/login', { replace: true, state: { passwordChanged: true } });
    } catch (caught) {
      setPasswordErrors(fieldErrors(caught));
      setPasswordError(caught instanceof ApiError ? caught.message : 'Password change failed.');
    } finally {
      setPasswordSaving(false);
    }
  };

  const openMfa = (mode: MfaMode) => {
    setMfaMode(mode);
    setMfaPassword('');
    setMfaCode('');
    setMfaError(null);
    setSetupData(null);
    setBackupCodes(null);
  };

  const startSetup = async () => {
    setMfaBusy(true);
    setMfaError(null);
    try {
      const result = await api.post<MfaSetupData>('/auth/mfa/setup', { currentPassword: mfaPassword });
      setSetupData(result);
    } catch (caught) {
      setMfaError(caught instanceof ApiError ? caught.message : 'Could not start MFA setup.');
    } finally {
      setMfaBusy(false);
    }
  };

  const enableMfa = async () => {
    setMfaBusy(true);
    setMfaError(null);
    try {
      const result = await api.post<{ backupCodes: string[] }>('/auth/mfa/enable', { code: mfaCode });
      setBackupCodes(result.backupCodes);
      await refreshUser();
      success('MFA enabled', 'Store your backup recovery codes securely.');
    } catch (caught) {
      setMfaError(caught instanceof ApiError ? caught.message : 'The authenticator code was rejected.');
    } finally {
      setMfaBusy(false);
    }
  };

  const disableMfa = async () => {
    setMfaBusy(true);
    setMfaError(null);
    try {
      await api.post('/auth/mfa/disable', { currentPassword: mfaPassword, code: mfaCode });
      await refreshUser();
      success('MFA disabled', 'Consider re-enabling it to protect your account.');
      setMfaMode(null);
    } catch (caught) {
      setMfaError(caught instanceof ApiError ? caught.message : 'MFA could not be disabled.');
    } finally {
      setMfaBusy(false);
    }
  };

  const regenerateCodes = async () => {
    setMfaBusy(true);
    setMfaError(null);
    try {
      const result = await api.post<{ backupCodes: string[] }>('/auth/mfa/backup-codes', { currentPassword: mfaPassword, code: mfaCode });
      setBackupCodes(result.backupCodes);
      await refreshUser();
      success('Backup codes regenerated', 'Your previous codes are no longer valid.');
    } catch (caught) {
      setMfaError(caught instanceof ApiError ? caught.message : 'Backup codes could not be regenerated.');
    } finally {
      setMfaBusy(false);
    }
  };

  const downloadCodes = () => {
    if (!backupCodes) return;
    const text = `SSIMS UNIVERSITY — MFA BACKUP RECOVERY CODES\nAccount: ${user.email}\nGenerated: ${new Date().toISOString()}\nEach code can be used once. Store offline in a secure location.\n\n${backupCodes.join('\n')}\n`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'ssims-mfa-backup-codes.txt';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const copyAllCodes = async () => {
    if (!backupCodes) return;
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'));
      success('Backup codes copied', 'Paste them into your password manager immediately.');
    } catch {
      toastError('Clipboard unavailable', 'Select and copy the codes manually.');
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Identity & access"
        title="Profile & security settings"
        description="Manage the information you are permitted to change and strengthen how you authenticate to SSIMS."
      />

      <Card className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Avatar name={user.fullName} size="lg" />
            <div>
              <h2 className="text-lg font-bold text-ink-950">{user.fullName}</h2>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500"><Mail className="h-3.5 w-3.5" /> {user.email}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <RoleBadge role={user.role} />
                <Badge tone={user.mfaEnabled ? 'brand' : 'amber'}>{user.mfaEnabled ? 'MFA enabled' : 'MFA not enabled'}</Badge>
                {user.mustChangePassword && <Badge tone="rose">Password change required</Badge>}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-right sm:block">
            <div><p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Last sign-in</p><p className="text-[11px] font-medium text-slate-700">{formatDateTime(user.lastLoginAt)}</p></div>
            <div className="mt-0 sm:mt-2"><p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Member since</p><p className="text-[11px] font-medium text-slate-700">{formatDateTime(user.createdAt)}</p></div>
          </div>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_1fr]">
        <div className="space-y-5">
          <Card className="p-5 sm:p-6">
            <SectionHeader title="Profile information" description={user.role === 'student' ? 'You may update your contact details. Academic identifiers are read-only.' : 'Academic identifiers are controlled by the registry.'} />
            <form onSubmit={saveProfile} className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label="Full name" value={user.fullName} disabled />
                <Input label="University email" value={user.email} disabled leftIcon={Mail} />
                <Input label="Student / staff ID" value={user.studentId || user.staffId || '—'} disabled />
                <Input label="Department" value={user.departmentName || '—'} disabled />
                <Input label="Programme" value={user.programme || '—'} disabled />
                <Input label="Level" value={user.level || '—'} disabled />
                <Input label="Phone" value={phone} onChange={(event) => setPhone(event.target.value)} disabled={user.role !== 'student'} error={profileErrors.phone} leftIcon={Smartphone} />
                <TextArea label="Address" value={address} onChange={(event) => setAddress(event.target.value)} disabled={user.role !== 'student'} error={profileErrors.address} />
              </div>
              {user.role === 'student' ? (
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-slate-400">Changes are logged as PROFILE_UPDATED security events.</p>
                  <Button type="submit" loading={profileSaving} leftIcon={UserRound}>Save contact details</Button>
                </div>
              ) : (
                <p className="rounded-lg bg-slate-50 p-3 text-[10px] leading-5 text-slate-500">Contact the university registry to change staff or administrative account details. This restriction is enforced by the API.</p>
              )}
            </form>
          </Card>

          <Card className="p-5 sm:p-6">
            <SectionHeader title="Change password" description="Changing your password revokes every active session, including this one." />
            <form onSubmit={changePassword} className="mt-4 space-y-4">
              {passwordError && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{passwordError}</p>}
              <Input
                label="Current password"
                type="password"
                value={passwordForm.currentPassword}
                onChange={(event) => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })}
                error={passwordErrors.currentPassword}
                autoComplete="current-password"
                required
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="New password"
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })}
                  error={passwordErrors.newPassword}
                  autoComplete="new-password"
                  required
                />
                <Input
                  label="Confirm new password"
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(event) => setPasswordForm({ ...passwordForm, confirmPassword: event.target.value })}
                  error={passwordErrors.confirmPassword}
                  autoComplete="new-password"
                  required
                />
              </div>
              <PasswordStrength password={passwordForm.newPassword} />
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-slate-400">Argon2id · reuse check · strength policy</p>
                <Button type="submit" loading={passwordSaving} leftIcon={LockKeyhole}>Update password</Button>
              </div>
            </form>
          </Card>
        </div>

        <div className="space-y-5">
          <Card className={`p-5 sm:p-6 ${user.mfaEnabled ? 'border-brand-200' : 'border-amber-200'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className={`grid h-11 w-11 place-items-center rounded-xl ${user.mfaEnabled ? 'bg-brand-50 text-brand-700' : 'bg-amber-50 text-amber-700'}`}>
                  {user.mfaEnabled ? <Fingerprint className="h-5 w-5" /> : <ShieldQuestion className="h-5 w-5" />}
                </div>
                <div>
                  <h2 className="text-sm font-bold text-ink-950">Multi-factor authentication</h2>
                  <p className="mt-0.5 text-[10px] text-slate-500">TOTP via any authenticator application</p>
                  {user.mfaEnrollmentRequired && <p className="mt-1 text-[10px] font-semibold text-rose-600">Required by security policy — portal access is restricted until enabled.</p>}
                </div>
              </div>
              <Badge tone={user.mfaEnabled ? 'brand' : 'amber'}>{user.mfaEnabled ? 'Enabled' : 'Not enabled'}</Badge>
            </div>
            <p className="mt-4 text-[11px] leading-5 text-slate-500">
              {user.mfaEnabled
                ? `Your account requires a time-based one-time code at sign-in. ${user.backupCodesRemaining} single-use recovery codes remain.`
                : 'Add a second factor so a stolen password alone cannot access your academic record. You will need an authenticator app.'}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {user.mfaEnabled ? (
                <>
                  <Button variant="outline" leftIcon={KeyRound} onClick={() => openMfa('regenerate')}>Regenerate backup codes</Button>
                  <Button variant="ghost" leftIcon={ShieldOff} onClick={() => openMfa('disable')} className="text-rose-600 hover:bg-rose-50">Disable MFA</Button>
                </>
              ) : (
                <Button leftIcon={Fingerprint} onClick={() => openMfa('setup')}>Enable MFA</Button>
              )}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-4 text-center">
              <div><p className="text-lg font-bold text-ink-950">{user.backupCodesRemaining}</p><p className="text-[8px] font-bold uppercase tracking-wider text-slate-400">Backup codes</p></div>
              <div><p className="text-lg font-bold text-ink-950">30s</p><p className="text-[8px] font-bold uppercase tracking-wider text-slate-400">TOTP window</p></div>
              <div><p className="text-lg font-bold text-ink-950">AES</p><p className="text-[8px] font-bold uppercase tracking-wider text-slate-400">Secret at rest</p></div>
            </div>
          </Card>

          <Card className="p-5 sm:p-6">
            <SectionHeader title="Session security" description="How SSIMS protects your authenticated session." />
            <div className="mt-4 space-y-3">
              {[
                { icon: LockKeyhole, title: 'Access token', value: '15-minute JWT held in memory', tone: 'brand' },
                { icon: KeyRound, title: 'Refresh token', value: 'HttpOnly · SameSite=Strict · rotated', tone: 'brand' },
                { icon: ShieldCheck, title: 'CSRF defence', value: 'HMAC double-submit token', tone: 'brand' },
                { icon: Fingerprint, title: 'Idle timeout', value: 'Configured by security policy', tone: 'amber' },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="flex items-center gap-3">
                    <div className={`grid h-8 w-8 place-items-center rounded-lg ${item.tone === 'amber' ? 'bg-amber-50 text-amber-700' : 'bg-brand-50 text-brand-700'}`}><Icon className="h-4 w-4" /></div>
                    <div className="flex-1"><p className="text-[10px] font-bold text-ink-900">{item.title}</p><p className="text-[9px] text-slate-400">{item.value}</p></div>
                    <CheckCircle2 className="h-4 w-4 text-brand-500" />
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="bg-ink-950 p-5 text-white">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-300" />
              <div>
                <p className="text-xs font-bold">Security reminders</p>
                <ul className="mt-2 space-y-1.5 text-[10px] leading-5 text-slate-400">
                  <li>• SSIMS staff will never ask for your password or MFA code.</li>
                  <li>• Report suspicious sign-in activity to IT Security immediately.</li>
                  <li>• Store backup codes separately from your authenticator device.</li>
                </ul>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Modal
        open={Boolean(mfaMode)}
        onClose={() => setMfaMode(null)}
        title={mfaMode === 'setup' ? 'Set up authenticator MFA' : mfaMode === 'disable' ? 'Disable multi-factor authentication' : 'Regenerate backup codes'}
        description={
          mfaMode === 'setup'
            ? 'Scan the QR code with Google Authenticator, Microsoft Authenticator or another TOTP app.'
            : 'Confirm this sensitive change with your password and a current authenticator code.'
        }
        size="md"
        footer={
          backupCodes ? (
            <Button onClick={() => setMfaMode(null)}>I have stored the codes</Button>
          ) : mfaMode === 'setup' ? (
            setupData ? (
              <>
                <Button variant="outline" onClick={() => setMfaMode(null)}>Cancel</Button>
                <Button onClick={() => void enableMfa()} loading={mfaBusy} disabled={mfaCode.length !== 6}>Verify & enable</Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setMfaMode(null)}>Cancel</Button>
                <Button onClick={() => void startSetup()} loading={mfaBusy} disabled={!mfaPassword}>Continue</Button>
              </>
            )
          ) : (
            <>
              <Button variant="outline" onClick={() => setMfaMode(null)}>Cancel</Button>
              <Button variant={mfaMode === 'disable' ? 'danger' : 'primary'} onClick={() => void (mfaMode === 'disable' ? disableMfa() : regenerateCodes())} loading={mfaBusy} disabled={!mfaPassword || mfaCode.length !== 6}>
                {mfaMode === 'disable' ? 'Disable MFA' : 'Generate new codes'}
              </Button>
            </>
          )
        }
      >
        {backupCodes ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
              <span className="font-bold">Store these codes now.</span> They are shown only once. Each code can be used a
              single time if you lose access to your authenticator.
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-sm text-ink-900">
              {backupCodes.map((code) => <span key={code} className="rounded bg-white px-2 py-1.5 text-center ring-1 ring-slate-200">{code}</span>)}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" leftIcon={Download} onClick={downloadCodes}>Download .txt</Button>
              <Button variant="outline" leftIcon={KeyRound} onClick={() => void copyAllCodes()}>Copy all</Button>
            </div>
          </div>
        ) : mfaMode === 'setup' && setupData ? (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-200 p-5">
              <img src={setupData.qrCodeDataUrl} alt="Authenticator QR code" className="h-56 w-56 rounded-lg" />
              <p className="text-center text-[10px] text-slate-500">Scan with your authenticator app, then enter the generated code.</p>
              <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Secret</span>
                <code className="text-[10px] text-slate-700">{setupData.secret}</code>
                <CopyButton value={setupData.secret} />
              </div>
            </div>
            {mfaError && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{mfaError}</p>}
            <Input label="Six-digit code" inputMode="numeric" maxLength={6} value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))} autoFocus className="text-center text-xl font-bold tracking-[0.4em]" placeholder="000000" />
          </div>
        ) : mfaMode === 'setup' ? (
          <div className="space-y-4">
            {mfaError && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{mfaError}</p>}
            <div className="rounded-xl bg-slate-50 p-3 text-[10px] leading-5 text-slate-500">
              Confirm your password before viewing the new TOTP secret. The secret is encrypted with AES-256-GCM before storage.
            </div>
            <Input label="Current password" type="password" value={mfaPassword} onChange={(event) => setMfaPassword(event.target.value)} autoComplete="current-password" autoFocus required />
          </div>
        ) : (
          <div className="space-y-4">
            {mfaError && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{mfaError}</p>}
            <Input label="Current password" type="password" value={mfaPassword} onChange={(event) => setMfaPassword(event.target.value)} autoComplete="current-password" required />
            <Input label="Authenticator code" inputMode="numeric" maxLength={6} value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" className="text-center text-xl font-bold tracking-[0.4em]" required />
            {mfaMode === 'disable' && <p className="text-[10px] leading-5 text-rose-600">Disabling MFA weakens account protection. Existing backup codes will be deleted.</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
