import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode, useCallback } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";

const AUTH_STORAGE_KEY = "tacoplan_auth";

interface AuthUser {
  id: string;
  email: string;
  name?: string;
}

interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

interface AuthState {
  user: AuthUser | null;
  session: AuthSession | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<{ ok: boolean; message?: string }>;
  signUp: (name: string, email: string, password: string) => Promise<{ ok: boolean; needsVerification: boolean; message: string; emailExists?: boolean }>;
  verifyEmail: (email: string, code: string) => Promise<boolean>;
  resendVerification: (email: string) => Promise<{ ok: boolean; message: string }>;
  resetPassword: (email: string) => Promise<{ ok: boolean; message: string }>;
  updatePassword: (accessToken: string, newPassword: string) => Promise<{ ok: boolean; message: string }>;
  handleOAuthTokens: (accessToken: string, refreshToken: string) => Promise<boolean>;
  logout: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
  skipAuth: () => void;
  isGuest: boolean;
  recoveryTokens: { access_token: string; refresh_token: string } | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function mapUser(supaUser: any): AuthUser {
  return {
    id: supaUser.id,
    email: supaUser.email ?? "",
    name: supaUser.user_metadata?.name ?? supaUser.user_metadata?.full_name ?? undefined,
  };
}

function mapSession(supaSession: any): AuthSession {
  return {
    access_token: supaSession.access_token,
    refresh_token: supaSession.refresh_token,
    expires_at: supaSession.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);
  const [recoveryTokens, setRecoveryTokens] = useState<{ access_token: string; refresh_token: string } | null>(null);

  useEffect(() => {
    loadSession();
    if (Platform.OS === "web") {
      checkWebOAuthCallback();
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, supaSession) => {
      if (supaSession) {
        setUser(mapUser(supaSession.user));
        setSession(mapSession(supaSession));
        setIsGuest(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const checkWebOAuthCallback = async () => {
    try {
      if (typeof window === "undefined") return;
      const hash = window.location.hash;
      if (!hash || !hash.includes("access_token")) return;

      const params = new URLSearchParams(hash.substring(1));
      const tokenType = params.get("type");

      if (tokenType === "recovery") {
        const at = params.get("access_token");
        const rt = params.get("refresh_token");
        if (at && rt) {
          setRecoveryTokens({ access_token: at, refresh_token: rt });
          window.history.replaceState(null, "", window.location.pathname);
        }
        return;
      }

      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");

      if (accessToken && refreshToken) {
        window.history.replaceState(null, "", window.location.pathname);
        const { data, error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (data.session && data.user) {
          setUser(mapUser(data.user));
          setSession(mapSession(data.session));
          setIsGuest(false);
          await persistAuth(mapUser(data.user), mapSession(data.session));
        }
      }
    } catch (e) {
      console.error("OAuth callback error:", e);
    }
  };

  const loadSession = async () => {
    try {
      const stored = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.guest) {
          setIsGuest(true);
          setIsLoading(false);
          return;
        }
      }

      const { data: { session: supaSession } } = await supabase.auth.getSession();
      if (supaSession) {
        setUser(mapUser(supaSession.user));
        setSession(mapSession(supaSession));
        setIsGuest(false);
        await persistAuth(mapUser(supaSession.user), mapSession(supaSession));
      }
    } catch (e) {
      console.error("Error loading auth:", e);
    }
    setIsLoading(false);
  };

  const persistAuth = async (u: AuthUser | null, s: AuthSession | null) => {
    if (u && s) {
      await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: u, session: s }));
    } else {
      await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
    }
  };

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const msg = error.message === "Invalid login credentials"
        ? "Email o contrasena incorrectos"
        : error.message;
      return { ok: false, message: msg };
    }
    if (data.user && data.session) {
      const u = mapUser(data.user);
      const s = mapSession(data.session);
      setUser(u);
      setSession(s);
      setIsGuest(false);
      await persistAuth(u, s);
      return { ok: true };
    }
    return { ok: false, message: "No se pudo iniciar sesion" };
  }, []);

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    });

    if (error) {
      if (error.message.includes("already registered") || error.message.includes("already been registered")) {
        return { ok: false, needsVerification: false, message: "Este email ya esta registrado", emailExists: true };
      }
      throw new Error(error.message);
    }

    if (data.user && !data.session) {
      return { ok: true, needsVerification: true, message: "Revisa tu email para verificar tu cuenta" };
    }

    if (data.user && data.session) {
      const u = mapUser(data.user);
      const s = mapSession(data.session);
      setUser(u);
      setSession(s);
      setIsGuest(false);
      await persistAuth(u, s);
      return { ok: true, needsVerification: false, message: "Cuenta creada" };
    }

    return { ok: true, needsVerification: true, message: "Revisa tu email" };
  }, []);

  const verifyEmail = useCallback(async (email: string, code: string) => {
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "signup",
    });
    if (error) return false;
    if (data.user && data.session) {
      const u = mapUser(data.user);
      const s = mapSession(data.session);
      setUser(u);
      setSession(s);
      setIsGuest(false);
      await persistAuth(u, s);
    }
    return true;
  }, []);

  const resendVerification = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resend({ type: "signup", email });
    if (error) throw new Error(error.message);
    return { ok: true, message: "Codigo reenviado a tu email" };
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw new Error(error.message);
    return { ok: true, message: "Te hemos enviado un enlace para restablecer tu contrasena" };
  }, []);

  const updatePassword = useCallback(async (accessToken: string, newPassword: string) => {
    await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: recoveryTokens?.refresh_token ?? "",
    });
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message);
    setRecoveryTokens(null);
    return { ok: true, message: "Contrasena actualizada correctamente" };
  }, [recoveryTokens]);

  const handleOAuthTokens = useCallback(async (accessToken: string, refreshToken: string) => {
    try {
      const { data, error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) throw error;
      if (data.user && data.session) {
        const u = mapUser(data.user);
        const s = mapSession(data.session);
        setUser(u);
        setSession(s);
        setIsGuest(false);
        await persistAuth(u, s);
        return true;
      }
    } catch (e) {
      console.error("OAuth token handling failed:", e);
    }
    return false;
  }, []);

  const logout = useCallback(async () => {
    try { await supabase.auth.signOut(); } catch {}
    setUser(null);
    setSession(null);
    setIsGuest(false);
    await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
  }, []);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    const { data: { session: supaSession } } = await supabase.auth.getSession();
    if (supaSession) {
      const s = mapSession(supaSession);
      setSession(s);
      return supaSession.access_token;
    }
    return null;
  }, []);

  const skipAuth = useCallback(async () => {
    setIsGuest(true);
    await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ guest: true }));
  }, []);

  const value = useMemo(
    () => ({
      user,
      session,
      isLoading,
      isAuthenticated: !!user || isGuest,
      signIn,
      signUp,
      verifyEmail,
      resendVerification,
      resetPassword,
      updatePassword,
      handleOAuthTokens,
      logout,
      getAccessToken,
      skipAuth,
      isGuest,
      recoveryTokens,
    }),
    [user, session, isLoading, isGuest, signIn, signUp, verifyEmail, resendVerification, resetPassword, updatePassword, handleOAuthTokens, logout, getAccessToken, skipAuth, recoveryTokens],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
