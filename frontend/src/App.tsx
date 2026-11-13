import { Component, ErrorInfo, ReactNode } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { AuthProvider, homeForRole, landingFor, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { AppShell } from './layouts/AppShell';
import { Logo } from './components/Logo';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage';
import { UsersPage } from './pages/admin/UsersPage';
import { DepartmentsPage } from './pages/admin/DepartmentsPage';
import { CoursesPage } from './pages/admin/CoursesPage';
import { SecurityMonitoringPage } from './pages/admin/SecurityMonitoringPage';
import { SecurityLabPage } from './pages/admin/SecurityLabPage';
import { KerberosPage } from './pages/admin/KerberosPage';
import { LecturerDashboardPage } from './pages/lecturer/LecturerDashboardPage';
import { LecturerCoursesPage } from './pages/lecturer/LecturerCoursesPage';
import { CourseWorkspacePage } from './pages/lecturer/CourseWorkspacePage';
import { GradebookPage } from './pages/lecturer/GradebookPage';
import { StudentDashboardPage } from './pages/student/StudentDashboardPage';
import { StudentCoursesPage } from './pages/student/StudentCoursesPage';
import { StudentResultsPage } from './pages/student/StudentResultsPage';
import { SettingsPage } from './pages/shared/SettingsPage';
import { NotFoundPage } from './pages/shared/NotFoundPage';
import type { Role } from './types';

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-ink-950">
      <div className="relative">
        <div className="absolute inset-0 animate-pulse-ring rounded-2xl" />
        <div className="relative grid h-16 w-16 place-items-center rounded-2xl border border-white/10 bg-white/5">
          <ShieldCheck className="h-8 w-8 text-brand-300" />
        </div>
      </div>
      <p className="mt-5 text-xs font-semibold uppercase tracking-[0.2em] text-brand-300">Establishing secure session</p>
      <p className="mt-1 text-[10px] text-slate-500">SSIMS identity services</p>
    </div>
  );
}

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  return <Navigate to={user ? landingFor(user) : '/login'} replace />;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (user) return <Navigate to={landingFor(user)} replace />;
  return <>{children}</>;
}

function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

function RoleGate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.mfaEnrollmentRequired || user.mustChangePassword) return <Navigate to="/settings/security" replace />;
  if (!roles.includes(user.role)) return <Navigate to={homeForRole(user.role)} replace />;
  return <>{children}</>;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The API records server-side failures; this prevents a blank UI on a client
    // rendering error without exposing stack traces to the user.
    console.error('SSIMS UI error', error.message, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-canvas px-5">
          <div className="card max-w-md p-8 text-center">
            <Logo />
            <h1 className="mt-6 text-xl font-bold text-ink-950">This view could not be rendered</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Refresh the page to restore your secure session. No credential or token has been exposed.
            </p>
            <button type="button" onClick={() => window.location.reload()} className="mt-5 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
              Reload SSIMS
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              <Route path="/" element={<RootRedirect />} />
              <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
              <Route path="/register" element={<PublicOnly><RegisterPage /></PublicOnly>} />
              <Route path="/forgot-password" element={<PublicOnly><ForgotPasswordPage /></PublicOnly>} />
              <Route path="/reset-password" element={<PublicOnly><ResetPasswordPage /></PublicOnly>} />

              <Route element={<RequireAuth />}>
                <Route element={<AppShell />}>
                  <Route
                    path="/admin"
                    element={
                      <RoleGate roles={['super_admin', 'administrator']}>
                        <AdminDashboardPage />
                      </RoleGate>
                    }
                  />
                  <Route
                    path="/admin/users"
                    element={
                      <RoleGate roles={['super_admin', 'administrator']}>
                        <UsersPage />
                      </RoleGate>
                    }
                  />
                  <Route
                    path="/admin/departments"
                    element={
                      <RoleGate roles={['super_admin', 'administrator']}>
                        <DepartmentsPage />
                      </RoleGate>
                    }
                  />
                  <Route
                    path="/admin/courses"
                    element={
                      <RoleGate roles={['super_admin', 'administrator']}>
                        <CoursesPage />
                      </RoleGate>
                    }
                  />
                  <Route
                    path="/admin/security"
                    element={
                      <RoleGate roles={['super_admin', 'administrator']}>
                        <SecurityMonitoringPage />
                      </RoleGate>
                    }
                  />
                  <Route
                    path="/admin/lab"
                    element={
                      <RoleGate roles={['super_admin', 'administrator']}>
                        <SecurityLabPage />
                      </RoleGate>
                    }
                  />
                  <Route
                    path="/admin/kerberos"
                    element={
                      <RoleGate roles={['super_admin', 'administrator']}>
                        <KerberosPage />
                      </RoleGate>
                    }
                  />
                  <Route
                    path="/lecturer"
                    element={
                      <RoleGate roles={['lecturer']}>
                        <LecturerDashboardPage />
                      </RoleGate>
                    }
                  />
                  <Route
                    path="/lecturer/courses"
                    element={
                      <RoleGate roles={['lecturer']}>
                        <LecturerCoursesPage />
                      </RoleGate>
                    }
                  />
                  <Route
                    path="/lecturer/courses/:id"
                    element={
                      <RoleGate roles={['lecturer']}>
                        <CourseWorkspacePage />
                      </RoleGate>
                    }
                  />
                  <Route
                    path="/lecturer/gradebook"
                    element={
                      <RoleGate roles={['lecturer']}>
                        <GradebookPage />
                      </RoleGate>
                    }
                  />
                  <Route path="/student" element={<RoleGate roles={['student']}><StudentDashboardPage /></RoleGate>} />
                  <Route path="/student/courses" element={<RoleGate roles={['student']}><StudentCoursesPage /></RoleGate>} />
                  <Route path="/student/results" element={<RoleGate roles={['student']}><StudentResultsPage /></RoleGate>} />
                  <Route path="/settings/security" element={<SettingsPage />} />
                </Route>
              </Route>

              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
