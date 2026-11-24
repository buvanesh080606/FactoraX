import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, clearTokens, getAccessToken, getRefreshToken, saveTokens } from "../api/client";
import type { CompanySetting, User } from "../types/erp";

interface AuthContextValue {
  user: User | null;
  company: CompanySetting | null;
  loading: boolean;
  login: (identifier: string, password: string, remember: boolean) => Promise<string>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [company, setCompany] = useState<CompanySetting | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const res = await api.get("/auth/me/");
      setUser(res.data.user);
      setCompany(res.data.company);
    } catch {
      clearTokens();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshProfile();
    const onExpired = () => {
      setUser(null);
    };
    window.addEventListener("sf:session-expired", onExpired);
    return () => window.removeEventListener("sf:session-expired", onExpired);
  }, [refreshProfile]);

  const login = async (identifier: string, password: string, remember: boolean) => {
    const res = await api.post("/auth/login/", { identifier, password });
    saveTokens(res.data.access, res.data.refresh, remember);
    setUser(res.data.user);
    setCompany(res.data.company);
    return res.data.redirect_to as string;
  };

  const logout = async () => {
    const refresh = getRefreshToken();
    try {
      if (refresh) {
        await api.post("/auth/logout/", { refresh });
      }
    } catch {
      // Ignore logout network errors
    } finally {
      clearTokens();
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, company, loading, login, logout, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
