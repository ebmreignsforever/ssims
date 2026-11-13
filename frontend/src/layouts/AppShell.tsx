import {
  BookOpen,
  Building2,
  ChevronDown,
  ClipboardList,
  FlaskConical,
  GraduationCap,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  Settings2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Avatar, Button, RoleBadge } from '../components/ui';
import { Logo } from '../components/Logo';
import { formatRole } from '../utils/format';

interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  end?: boolean;
  accent?: boolean;
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

function navForRole(role: string): NavSection[] {
  if (role === 'super_admin' || role === 'administrator') {
    return [
      {
        items: [
          { label: 'Overview', to: '/admin', icon: LayoutDashboard, end: true },
          { label: 'Users & Students', to: '/admin/users', icon: Users },
          { label: 'Departments', to: '/admin/departments', icon: Building2 },
          { label: 'Courses', to: '/admin/courses', icon: BookOpen },
        ],
      },
      {
        title: 'Security operations',
        items: [
          { label: 'Security Monitoring', to: '/admin/security', icon: ShieldAlert },
          { label: 'Security Testing Lab', to: '/admin/lab', icon: FlaskConical, accent: true },
          { label: 'Kerberos Simulation', to: '/admin/kerberos', icon: KeyRound },
        ],
      },
      {
        title: 'Account',
        items: [{ label: 'Security Settings', to: '/settings/security', icon: Settings2 }],
      },
    ];
  }
  if (role === 'lecturer') {
    return [
      {
        items: [
          { label: 'Teaching Overview', to: '/lecturer', icon: LayoutDashboard, end: true },
          { label: 'My Courses', to: '/lecturer/courses', icon: BookOpen },
          { label: 'Gradebook', to: '/lecturer/gradebook', icon: ClipboardList },
        ],
      },
      {
        title: 'Account',
        items: [{ label: 'Security Settings', to: '/settings/security', icon: Settings2 }],
      },
    ];
  }
  return [
    {
      items: [
        { label: 'My Overview', to: '/student', icon: LayoutDashboard, end: true },
        { label: 'My Courses', to: '/student/courses', icon: BookOpen },
        { label: 'Academic Results', to: '/student/results', icon: GraduationCap },
      ],
    },
    {
      title: 'Account',
      items: [
        { label: 'Profile & Security', to: '/settings/security', icon: UserRound },
      ],
    },
  ];
}

const PAGE_TITLES: Record<string, string> = {
  '/admin': 'Security overview',
  '/admin/users': 'Users & students',
  '/admin/departments': 'Academic departments',
  '/admin/courses': 'Course catalogue',
  '/admin/security': 'Security monitoring',
  '/admin/lab': 'Security testing lab',
  '/admin/kerberos': 'Kerberos authentication',
  '/lecturer': 'Teaching overview',
  '/lecturer/courses': 'My courses',
  '/lecturer/gradebook': 'Gradebook',
  '/student': 'My overview',
  '/student/courses': 'My courses',
  '/student/results': 'Academic results',
  '/settings/security': 'Profile & security',
};

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if ((user?.mfaEnrollmentRequired || user?.mustChangePassword) && location.pathname !== '/settings/security') {
      navigate('/settings/security', { replace: true });
    }
  }, [user?.mfaEnrollmentRequired, user?.mustChangePassword, location.pathname, navigate]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) setProfileOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!user) return null;
  const sections = navForRole(user.role);
  const currentTitle =
    PAGE_TITLES[location.pathname] ||
    (location.pathname.startsWith('/lecturer/courses/') ? 'Course workspace' : 'SSIMS Portal');

  const signOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const Sidebar = (
    <aside className="flex h-full w-[268px] shrink-0 flex-col bg-ink-950 text-white">
      <div className="flex h-[76px] items-center justify-between border-b border-white/[0.07] px-6">
        <Logo dark />
        <button type="button" onClick={() => setMobileOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 lg:hidden" aria-label="Close navigation">
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3.5 py-5">
        {sections.map((section, sectionIndex) => (
          <div key={section.title || sectionIndex} className={sectionIndex > 0 ? 'mt-6' : ''}>
            {section.title && (
              <p className="mb-2 px-3 text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500">{section.title}</p>
            )}
            <div className="space-y-1">
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      clsx(
                        'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition',
                        isActive
                          ? item.accent
                            ? 'bg-accent-400/15 text-accent-200'
                            : 'bg-white/[0.08] text-white'
                          : item.accent
                            ? 'text-amber-200/70 hover:bg-white/[0.06] hover:text-amber-100'
                            : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-100',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && <span className={clsx('absolute left-0 h-5 w-0.5 rounded-r-full', item.accent ? 'bg-accent-400' : 'bg-brand-400')} />}
                        <Icon className={clsx('h-[18px] w-[18px] shrink-0', isActive ? (item.accent ? 'text-accent-300' : 'text-brand-300') : 'text-slate-500 group-hover:text-slate-300')} />
                        <span className="truncate">{item.label}</span>
                        {item.accent && <span className="ml-auto rounded border border-accent-400/30 bg-accent-400/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-accent-300">Lab</span>}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="mx-3.5 mb-3 rounded-xl border border-white/[0.08] bg-white/[0.035] p-3.5">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-brand-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" />
          Protected session
        </div>
        <p className="mt-1.5 text-[10.5px] leading-4 text-slate-500">JWT · RBAC · CSRF · TLS · Audit trail</p>
      </div>

      <div className="border-t border-white/[0.07] p-3.5">
        <div className="flex items-center gap-3 rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/[0.05]">
          <Avatar name={user.fullName} size="sm" tone="dark" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-white">{user.fullName}</p>
            <p className="truncate text-[10px] text-slate-500">{formatRole(user.role)}</p>
          </div>
          <button type="button" onClick={() => void signOut()} className="rounded-lg p-2 text-slate-500 transition hover:bg-white/10 hover:text-white" title="Sign out" aria-label="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen bg-canvas">
      <div className="fixed inset-y-0 left-0 z-40 hidden lg:block">{Sidebar}</div>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <div className="relative h-full w-[280px] shadow-float">{Sidebar}</div>
        </div>
      )}

      <div className="lg:pl-[268px]">
        <header className="sticky top-0 z-30 flex h-[68px] items-center justify-between gap-3 border-b border-slate-200/80 bg-white/85 px-4 backdrop-blur-md sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={() => setMobileOpen(true)} className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 lg:hidden" aria-label="Open navigation">
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-bold text-ink-950">{currentTitle}</p>
              <p className="hidden text-[10px] text-slate-400 sm:block">Secure Student Information Management System</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden items-center gap-1.5 rounded-full border border-brand-100 bg-brand-50 px-3 py-1.5 text-[10px] font-semibold text-brand-700 sm:flex">
              <ShieldCheck className="h-3.5 w-3.5" />
              Session protected
            </span>
            <div className="relative" ref={profileRef}>
              <button
                type="button"
                onClick={() => setProfileOpen((current) => !current)}
                className="flex items-center gap-2 rounded-xl p-1.5 pr-2 transition hover:bg-slate-100"
                aria-haspopup="menu"
                aria-expanded={profileOpen}
              >
                <Avatar name={user.fullName} size="sm" />
                <div className="hidden text-left md:block">
                  <p className="max-w-[150px] truncate text-xs font-semibold text-ink-900">{user.fullName}</p>
                  <p className="text-[10px] text-slate-500">{formatRole(user.role)}</p>
                </div>
                <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
              </button>
              {profileOpen && (
                <div className="absolute right-0 mt-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-float" role="menu">
                  <div className="border-b border-slate-100 px-3 py-2.5">
                    <p className="text-xs font-bold text-ink-900">{user.fullName}</p>
                    <p className="mt-0.5 truncate text-[10px] text-slate-500">{user.email}</p>
                    <div className="mt-2">
                      <RoleBadge role={user.role} />
                    </div>
                  </div>
                  <Link to="/settings/security" onClick={() => setProfileOpen(false)} className="mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50" role="menuitem">
                    <Settings2 className="h-4 w-4" /> Profile & security
                  </Link>
                  <button type="button" onClick={() => void signOut()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50" role="menuitem">
                    <LogOut className="h-4 w-4" /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {user.mfaEnrollmentRequired && location.pathname !== '/settings/security' && (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
              <div className="flex items-start gap-2.5">
                <Shield className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
                <p className="text-xs leading-5 text-rose-900">
                  <span className="font-bold">MFA enrollment required.</span> Security policy restricts portal access until you enable an authenticator app.
                </p>
              </div>
              <Link to="/settings/security" className="text-xs font-bold text-rose-800 underline underline-offset-2 hover:text-rose-950">
                Enroll now
              </Link>
            </div>
          )}
          {user.mustChangePassword && location.pathname !== '/settings/security' && (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <div className="flex items-start gap-2.5">
                <Shield className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <p className="text-xs leading-5 text-amber-900">
                  <span className="font-bold">Password change required.</span> Your bootstrap or temporary credential must be replaced.
                </p>
              </div>
              <Link to="/settings/security" className="text-xs font-bold text-amber-800 underline underline-offset-2 hover:text-amber-950">
                Update password
              </Link>
            </div>
          )}
          <div key={location.pathname} className="animate-fade-up">
            <Outlet />
          </div>
        </main>
        <footer className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-2 border-t border-slate-200/70 px-4 py-5 text-[10px] text-slate-400 sm:px-6 lg:px-8">
          <span>SSIMS University · Authorized academic use only</span>
          <span className="flex items-center gap-1.5">
            <LockKeyhole className="h-3 w-3" /> Security events are recorded and immutable
          </span>
        </footer>
      </div>
    </div>
  );
}
