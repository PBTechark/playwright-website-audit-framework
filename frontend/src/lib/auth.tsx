import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api, setUnauthorizedHandler } from './api';

interface AuthState {
  /** undefined while the existing session is being checked. */
  userId: string | null | undefined;
  login: (userId: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    setUnauthorizedHandler(() => setUserId(null));
    api
      .session()
      .then((session) => setUserId(session.userId))
      .catch(() => setUserId(null));
  }, []);

  const login = useCallback(async (id: string, password: string) => {
    const session = await api.login(id, password);
    setUserId(session.userId);
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setUserId(null);
  }, []);

  return <AuthContext.Provider value={{ userId, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
