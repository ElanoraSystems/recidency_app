import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, tokenStore } from "../api/client";
import type { Me } from "../types";

interface AuthState {
  user: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  hasModule: (module: string) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadMe() {
    if (!tokenStore.getAccess()) {
      setLoading(false);
      return;
    }
    try {
      const res = await api.get<Me>("/auth/me");
      setUser(res.data);
    } catch {
      tokenStore.clear();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login(email: string, password: string) {
    const res = await api.post("/auth/login", { email, password });
    tokenStore.set(res.data.access_token, res.data.refresh_token);
    await loadMe();
  }

  function logout() {
    tokenStore.clear();
    setUser(null);
  }

  function hasModule(module: string) {
    if (!user) return false;
    return user.allowed_modules.includes("*") || user.allowed_modules.includes(module);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, hasModule }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
