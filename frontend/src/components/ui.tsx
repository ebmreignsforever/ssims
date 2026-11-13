import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Inbox,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  X,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import {
  ButtonHTMLAttributes,
  createContext,
  forwardRef,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  useContext,
  useEffect,
  useId,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { AccountStatus, Role, Severity } from '../types';
import { formatRole, initials } from '../utils/format';

export { clsx as cn };

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300 focus-visible:ring-brand-500',
  secondary:
    'bg-brand-50 text-brand-800 border border-brand-100 hover:bg-brand-100 active:bg-brand-200 disabled:text-brand-400',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-ink-900 active:bg-slate-200 disabled:text-slate-300',
  danger: 'bg-rose-600 text-white shadow-sm hover:bg-rose-700 active:bg-rose-800 disabled:bg-rose-300',
  dark: 'bg-ink-900 text-white shadow-sm hover:bg-ink-800 active:bg-ink-950 disabled:bg-ink-600',
  outline: 'border border-slate-200 bg-white text-ink-800 hover:border-slate-300 hover:bg-slate-50 disabled:text-slate-300',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-5 text-sm gap-2 rounded-xl',
};

export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string): string {
  return clsx(
    'inline-flex select-none items-center justify-center font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed',
    BUTTON_VARIANTS[variant],
    BUTTON_SIZES[size],
    className,
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: LucideIcon;
  rightIcon?: LucideIcon;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, leftIcon: LeftIcon, rightIcon: RightIcon, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={buttonClasses(variant, size, className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : LeftIcon ? <LeftIcon className="h-4 w-4" /> : null}
      {children}
      {!loading && RightIcon ? <RightIcon className="h-4 w-4" /> : null}
    </button>
  );
});

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------
interface FieldWrapperProps {
  id: string;
  label?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

function FieldWrapper({ id, label, error, hint, required, children, className }: FieldWrapperProps) {
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="field-label">
          {label}
          {required && <span className="ml-1 text-rose-500">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p id={`${id}-error`} className="field-error" role="alert">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs leading-5 text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: LucideIcon;
  rightElement?: ReactNode;
  containerClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, leftIcon: LeftIcon, rightElement, className, containerClassName, id, required, ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  return (
    <FieldWrapper id={fieldId} label={label} error={error} hint={hint} required={required} className={containerClassName}>
      <div className="relative">
        {LeftIcon && <LeftIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />}
        <input
          ref={ref}
          id={fieldId}
          required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          className={clsx('field-input', LeftIcon && 'pl-10', rightElement && 'pr-11', error && 'border-rose-300 focus:border-rose-500 focus:ring-rose-500/10', className)}
          {...props}
        />
        {rightElement && <div className="absolute right-2 top-1/2 -translate-y-1/2">{rightElement}</div>}
      </div>
    </FieldWrapper>
  );
});

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  containerClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, hint, className, containerClassName, id, children, required, ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  return (
    <FieldWrapper id={fieldId} label={label} error={error} hint={hint} required={required} className={containerClassName}>
      <select
        ref={ref}
        id={fieldId}
        required={required}
        aria-invalid={Boolean(error)}
        className={clsx('field-select', error && 'border-rose-300', className)}
        {...props}
      >
        {children}
      </select>
    </FieldWrapper>
  );
});

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
  containerClassName?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, error, hint, className, containerClassName, id, required, ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  return (
    <FieldWrapper id={fieldId} label={label} error={error} hint={hint} required={required} className={containerClassName}>
      <textarea
        ref={ref}
        id={fieldId}
        required={required}
        aria-invalid={Boolean(error)}
        className={clsx('field-input min-h-[96px] resize-y', error && 'border-rose-300', className)}
        {...props}
      />
    </FieldWrapper>
  );
});

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------
type BadgeTone = 'brand' | 'slate' | 'amber' | 'rose' | 'blue' | 'purple' | 'outline';

const BADGE_TONES: Record<BadgeTone, string> = {
  brand: 'bg-brand-50 text-brand-700 border-brand-200',
  slate: 'bg-slate-100 text-slate-600 border-slate-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
  blue: 'bg-sky-50 text-sky-700 border-sky-200',
  purple: 'bg-violet-50 text-violet-700 border-violet-200',
  outline: 'bg-transparent text-slate-600 border-slate-300',
};

export function Badge({
  tone = 'slate',
  children,
  className,
  dot,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold', BADGE_TONES[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />}
      {children}
    </span>
  );
}

const SEVERITY_STYLES: Record<Severity, { tone: BadgeTone; icon: LucideIcon }> = {
  info: { tone: 'blue', icon: ShieldQuestion },
  low: { tone: 'slate', icon: ShieldCheck },
  medium: { tone: 'amber', icon: ShieldAlert },
  high: { tone: 'rose', icon: ShieldAlert },
  critical: { tone: 'rose', icon: ShieldAlert },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const config = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.info;
  const Icon = config.icon;
  return (
    <Badge tone={config.tone} className={severity === 'critical' ? 'border-rose-300 bg-rose-100' : undefined}>
      <Icon className="h-3 w-3" />
      {severity.toUpperCase()}
    </Badge>
  );
}

const STATUS_STYLES: Record<AccountStatus, { tone: BadgeTone; label: string }> = {
  active: { tone: 'brand', label: 'Active' },
  locked: { tone: 'amber', label: 'Locked' },
  suspended: { tone: 'rose', label: 'Suspended' },
  pending: { tone: 'slate', label: 'Pending' },
};

export function StatusBadge({ status }: { status: AccountStatus | string }) {
  const config = STATUS_STYLES[status as AccountStatus] ?? { tone: 'slate' as BadgeTone, label: String(status) };
  return (
    <Badge tone={config.tone} dot>
      {config.label}
    </Badge>
  );
}

const ROLE_TONES: Record<Role, BadgeTone> = {
  super_admin: 'purple',
  administrator: 'blue',
  lecturer: 'amber',
  student: 'brand',
};

export function RoleBadge({ role }: { role: Role | string }) {
  return <Badge tone={ROLE_TONES[role as Role] ?? 'slate'}>{formatRole(role)}</Badge>;
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('card', className)}>{children}</div>;
}

export function SectionHeader({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('flex flex-wrap items-start justify-between gap-3', className)}>
      <div>
        <h2 className="text-base font-bold text-ink-900">{title}</h2>
        {description && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow && <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-700">{eyebrow}</p>}
        <h1 className="text-2xl font-bold tracking-tight text-ink-950 sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const STAT_TONES = {
  brand: 'bg-brand-50 text-brand-700',
  blue: 'bg-sky-50 text-sky-700',
  amber: 'bg-amber-50 text-amber-700',
  rose: 'bg-rose-50 text-rose-700',
  purple: 'bg-violet-50 text-violet-700',
  slate: 'bg-slate-100 text-slate-600',
};

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'brand',
  hint,
  trend,
  loading,
}: {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  tone?: keyof typeof STAT_TONES;
  hint?: string;
  trend?: { value: string; positive?: boolean };
  loading?: boolean;
}) {
  return (
    <div className="card relative overflow-hidden p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">{label}</p>
          {loading ? (
            <div className="skeleton mt-3 h-8 w-20" />
          ) : (
            <p className="mt-2 text-[28px] font-bold leading-none tracking-tight text-ink-950">{value}</p>
          )}
          {(hint || trend) && (
            <div className="mt-3 flex items-center gap-2">
              {trend && (
                <span className={clsx('text-[11px] font-semibold', trend.positive === false ? 'text-rose-600' : 'text-brand-700')}>
                  {trend.value}
                </span>
              )}
              {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
            </div>
          )}
        </div>
        <div className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', STAT_TONES[tone])}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('h-5 w-5 animate-spin text-brand-600', className)} />;
}

export function PageLoader({ label = 'Loading secure data…' }: { label?: string }) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center gap-3" role="status">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
      </div>
      <p className="text-sm font-medium text-slate-500">{label}</p>
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-4">
          <div className="skeleton h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3.5 w-2/5" />
            <div className="skeleton h-3 w-1/4" />
          </div>
          <div className="skeleton h-6 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  message,
  icon: Icon = Inbox,
  action,
  compact,
}: {
  title: string;
  message?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={clsx('flex flex-col items-center justify-center px-6 text-center', compact ? 'py-10' : 'py-16')}>
      <div className="grid h-12 w-12 place-items-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-400">
        <Icon className="h-6 w-6" />
      </div>
      <p className="mt-4 text-sm font-semibold text-ink-900">{title}</p>
      {message && <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorAlert({ title = 'Something went wrong', message, onRetry }: { title?: string; message?: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4" role="alert">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-rose-900">{title}</p>
        {message && <p className="mt-1 text-xs leading-5 text-rose-700">{message}</p>}
      </div>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal & confirm
// ---------------------------------------------------------------------------
const MODAL_SIZES = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' };

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof MODAL_SIZES;
  closeOnBackdrop?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-6" aria-live="polite">
      <div
        className="absolute inset-0 bg-ink-950/55 backdrop-blur-[2px]"
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={clsx(
          'relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-float sm:rounded-2xl',
          MODAL_SIZES[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
          <div>
            <h2 id="modal-title" className="text-lg font-bold text-ink-950">
              {title}
            </h2>
            {description && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-4 sm:px-6">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
  loading,
  danger = true,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  danger?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-6 text-slate-600">{message}</p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Pagination, tabs, misc
// ---------------------------------------------------------------------------
export function Pagination({
  page,
  totalPages,
  total,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) {
    return <p className="px-4 py-3 text-xs text-slate-500">{total} record{total === 1 ? '' : 's'}</p>;
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
      <p className="text-xs text-slate-500">
        Page <span className="font-semibold text-slate-700">{page}</span> of {totalPages} · {total} records
      </p>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => onChange(page - 1)} disabled={page <= 1} leftIcon={ChevronLeft}>
          Previous
        </Button>
        <Button size="sm" variant="outline" onClick={() => onChange(page + 1)} disabled={page >= totalPages} rightIcon={ChevronRight}>
          Next
        </Button>
      </div>
    </div>
  );
}

const TabsContext = createContext<{ value: string; onChange: (value: string) => void } | null>(null);

export function Tabs({ value, onChange, children, className }: { value: string; onChange: (value: string) => void; children: ReactNode; className?: string }) {
  return (
    <TabsContext.Provider value={{ value, onChange }}>
      <div className={clsx('flex gap-1 overflow-x-auto border-b border-slate-200', className)} role="tablist">
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export function Tab({ value, children, icon: Icon }: { value: string; children: ReactNode; icon?: LucideIcon }) {
  const context = useContext(TabsContext);
  if (!context) throw new Error('Tab must be inside Tabs');
  const active = context.value === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => context.onChange(value)}
      className={clsx(
        'relative flex shrink-0 items-center gap-2 px-3.5 py-3 text-xs font-semibold transition',
        active ? 'text-brand-700' : 'text-slate-500 hover:text-ink-800',
      )}
    >
      {Icon && <Icon className="h-4 w-4" />}
      {children}
      {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-600" />}
    </button>
  );
}

export function Avatar({ name, size = 'md', tone = 'brand' }: { name?: string | null; size?: 'sm' | 'md' | 'lg'; tone?: 'brand' | 'dark' | 'amber'; }) {
  return (
    <span
      className={clsx(
        'inline-grid shrink-0 place-items-center rounded-full font-bold',
        size === 'sm' && 'h-8 w-8 text-[10px]',
        size === 'md' && 'h-10 w-10 text-xs',
        size === 'lg' && 'h-14 w-14 text-base',
        tone === 'brand' && 'bg-brand-50 text-brand-700 ring-1 ring-brand-100',
        tone === 'dark' && 'bg-white/10 text-white ring-1 ring-white/15',
        tone === 'amber' && 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
      )}
    >
      {initials(name)}
    </span>
  );
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 hover:text-ink-900">
      {copied ? <Check className="h-3.5 w-3.5 text-brand-600" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : label}
    </button>
  );
}

export function ProgressBar({ value, tone = 'brand', className }: { value: number; tone?: 'brand' | 'amber' | 'rose' | 'blue'; className?: string }) {
  return (
    <div className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-slate-100', className)}>
      <div
        className={clsx(
          'h-full rounded-full transition-all duration-500',
          tone === 'brand' && 'bg-brand-500',
          tone === 'amber' && 'bg-amber-500',
          tone === 'rose' && 'bg-rose-500',
          tone === 'blue' && 'bg-sky-500',
        )}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

const PASSWORD_RULES = [
  { label: '12+ characters', test: (value: string) => value.length >= 12 },
  { label: 'Uppercase letter', test: (value: string) => /[A-Z]/.test(value) },
  { label: 'Lowercase letter', test: (value: string) => /[a-z]/.test(value) },
  { label: 'Number', test: (value: string) => /\d/.test(value) },
  { label: 'Special character', test: (value: string) => /[^A-Za-z0-9]/.test(value) },
  { label: 'No common pattern', test: (value: string) => !/password|12345|qwerty|welcome|admin/i.test(value) },
];

export function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const score = PASSWORD_RULES.filter((rule) => rule.test(password)).length;
  const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong'];
  const tone = score <= 2 ? 'rose' : score <= 4 ? 'amber' : 'brand';
  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-slate-600">Password strength</span>
        <span className={clsx('text-[11px] font-bold', tone === 'rose' ? 'text-rose-600' : tone === 'amber' ? 'text-amber-600' : 'text-brand-700')}>
          {labels[Math.max(0, score - 1)]}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-6 gap-1">
        {Array.from({ length: 6 }).map((_, index) => (
          <span
            key={index}
            className={clsx(
              'h-1.5 rounded-full',
              index < score
                ? tone === 'rose'
                  ? 'bg-rose-400'
                  : tone === 'amber'
                    ? 'bg-amber-400'
                    : 'bg-brand-500'
                : 'bg-slate-200',
            )}
          />
        ))}
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1">
        {PASSWORD_RULES.map((rule) => {
          const passes = rule.test(password);
          return (
            <span key={rule.label} className={clsx('flex items-center gap-1 text-[10px]', passes ? 'text-brand-700' : 'text-slate-400')}>
              {passes ? <CheckCircle2 className="h-3 w-3" /> : <span className="h-1 w-1 rounded-full bg-current" />}
              {rule.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function SecureNotice({ children, tone = 'brand' }: { children: ReactNode; tone?: 'brand' | 'amber' }) {
  return (
    <div className={clsx('flex items-start gap-3 rounded-xl border p-3.5 text-xs leading-5', tone === 'brand' ? 'border-brand-100 bg-brand-50/60 text-brand-900' : 'border-amber-200 bg-amber-50 text-amber-900')}>
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
