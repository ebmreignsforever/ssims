import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import clsx from 'clsx';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
}

interface ToastContextValue {
  toast: (input: { type?: ToastType; title: string; message?: string }) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (input: { type?: ToastType; title: string; message?: string }) => {
      const id = crypto.randomUUID();
      setToasts((current) => [...current.slice(-3), { id, type: input.type || 'info', title: input.title, message: input.message }]);
      window.setTimeout(() => dismiss(id), 5500);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (title, message) => toast({ type: 'success', title, message }),
      error: (title, message) => toast({ type: 'error', title, message }),
      info: (title, message) => toast({ type: 'info', title, message }),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6" aria-live="polite">
        {toasts.map((item) => {
          const Icon = ICONS[item.type];
          return (
            <div
              key={item.id}
              className={clsx(
                'pointer-events-auto flex w-full max-w-sm animate-fade-up items-start gap-3 rounded-xl border bg-white p-4 shadow-float',
                item.type === 'success' && 'border-brand-200',
                item.type === 'error' && 'border-rose-200',
                item.type === 'warning' && 'border-amber-200',
                item.type === 'info' && 'border-slate-200',
              )}
              role="status"
            >
              <Icon
                className={clsx(
                  'mt-0.5 h-5 w-5 shrink-0',
                  item.type === 'success' && 'text-brand-600',
                  item.type === 'error' && 'text-rose-600',
                  item.type === 'warning' && 'text-amber-600',
                  item.type === 'info' && 'text-sky-600',
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-900">{item.title}</p>
                {item.message && <p className="mt-1 text-xs leading-5 text-slate-500">{item.message}</p>}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
