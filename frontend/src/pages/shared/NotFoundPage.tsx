import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldQuestion } from 'lucide-react';
import { useAuth, homeForRole } from '../../context/AuthContext';
import { Logo } from '../../components/Logo';
import { buttonClasses } from '../../components/ui';

export function NotFoundPage() {
  const { user } = useAuth();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-5">
      <div className="w-full max-w-md text-center">
        <div className="flex justify-center"><Logo /></div>
        <div className="mx-auto mt-10 grid h-16 w-16 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-400 shadow-card">
          <ShieldQuestion className="h-8 w-8" />
        </div>
        <p className="mt-6 font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-brand-700">Error 404</p>
        <h1 className="mt-2 text-2xl font-bold text-ink-950">This page is outside the perimeter</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          The address does not exist or you followed an outdated link. No data was exposed.
        </p>
        <Link to={user ? homeForRole(user.role) : '/login'} className={buttonClasses('dark', 'md', 'mt-6')}>
          <ArrowLeft className="h-4 w-4" /> Return to your portal
        </Link>
      </div>
    </div>
  );
}
