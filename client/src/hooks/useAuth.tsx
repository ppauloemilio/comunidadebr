import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { api, setToken, clearToken, getToken } from '@/lib/api';
import {
  clearCachedAvatar,
  pickBestAvatar,
  readCachedAvatar,
  writeCachedAvatar,
} from '@/lib/avatarCache';

export type User = {
  id: string;
  email: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  is_admin?: boolean;
  is_premium?: boolean;
};

type AuthContextType = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; password: string; username: string; full_name: string; country?: string }) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  patchUser: (patch: Partial<User>) => void;
};

const AuthContext = createContext<AuthContextType | null>(null);

function withCachedAvatar(user: User): User {
  const avatar_url = pickBestAvatar(user.avatar_url, readCachedAvatar(user.id));
  if (avatar_url) writeCachedAvatar(user.id, avatar_url);
  return { ...user, avatar_url };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      return;
    }
    try {
      const me = await api<User & { profile?: unknown }>('/auth/me');
      setUser((current) => {
        const merged = withCachedAvatar({
          ...me,
          avatar_url: pickBestAvatar(me.avatar_url, current?.avatar_url, readCachedAvatar(me.id)),
        });
        return merged;
      });
    } catch {
      setUser((current) => {
        if (current) return current;
        clearToken();
        return null;
      });
    }
  }, []);

  const patchUser = useCallback((patch: Partial<User>) => {
    setUser((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      if (patch.avatar_url !== undefined) {
        writeCachedAvatar(current.id, patch.avatar_url);
        next.avatar_url = pickBestAvatar(patch.avatar_url, current.avatar_url);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, [refreshUser]);

  const login = async (email: string, password: string) => {
    const res = await api<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setToken(res.token);
    setUser(withCachedAvatar(res.user));
  };

  const register = async (data: { email: string; password: string; username: string; full_name: string; country?: string }) => {
    const res = await api<{ token: string; user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    setToken(res.token);
    setUser(withCachedAvatar(res.user));
  };

  const logout = () => {
    clearCachedAvatar(user?.id);
    clearToken();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser, patchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
