import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, clearSessionTokens, refreshAccessToken, SessionPayload, setSessionTokens } from '../api/client';
import type { User } from '../types';

interface LoginInput {
  email: string;
  password: string;
  mfaCode?: string;
  backupCode?: string;
  challengeId?: string;
  challengeAnswer?: string;
}

interface MeResponse {
  user: User;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  authenticated: boolean;
  login: (input: LoginInput) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    // /auth/me wraps the user as { data: { user } }; the API client unwraps only
    // the outer data envelope, so read the nested user explicitly.
    const response = await api.get<MeResponse>('/auth/me');
    if (!response?.user) throw new Error('The session response did not contain a user');
    setUser(response.user);
  }, []);

  useEffect(() => {
    let active = true;
    const restore = async () => {
      try {
        const refreshed = await refreshAccessToken();
        if (!refreshed) return;
        const response = await api.get<MeResponse>('/auth/me');
        if (!response?.user) throw new Error('The session response did not contain a user');
        if (active) setUser(response.user);
      } catch {
        if (active) setUser(null);
      } finally {
        if (active) setLoading(false);
      }
    };
    void restore();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      setLoading(false);
    };
    window.addEventListener('ssims:session-expired', onExpired);
    return () => window.removeEventListener('ssims:session-expired', onExpired);
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    const session = await api.post<SessionPayload>('/auth/login', input, {
      auth: false,
      retryOn401: false,
    });
    setSessionTokens(session.accessToken, session.csrfToken);
    setUser(session.user);
    return session.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Local state must be cleared even if the network call fails.
    } finally {
      clearSessionTokens();
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, authenticated: Boolean(user), login, logout, refreshUser, setUser }),
    [user, loading, login, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

export function homeForRole(role: User['role']): string {
  switch (role) {
    case 'super_admin':
    case 'administrator':
      return '/admin';
    case 'lecturer':
      return '/lecturer';
    case 'student':
      return '/student';
    default:
      return '/login';
  }
}

/** Policy-required MFA enrollment and forced password changes take precedence. */
export function landingFor(user: User): string {
  if (user.mfaEnrollmentRequired || user.mustChangePassword) return '/settings/security';
  return homeForRole(user.role);
}
