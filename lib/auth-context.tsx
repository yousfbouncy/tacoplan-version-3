import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode, useCallback } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";
import Constants from "expo-constants";
import { getInstalledAppVersion } from "@/lib/update-service";
import {
  shouldOfferCloudRestorePrompt,
  restoreFromCloud,
  autoSync as syncServiceAutoSync,
} from "@/lib/sync-service";

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
  deleteAccount: () => Promise<void>;
  logout: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
  recoveryTokens: { access_token: string; refresh_token: string } | null;
  isAdmin: boolean;
  isAdminLoading: boolean;
  refreshAdminStatus: () => Promise<boolean>;
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

function sameUser(a: AuthUser | null, b: AuthUser | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.email === b.email && a.name === b.name;
}

async function getOrCreateDeviceId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem("tacoplan_device_id");
    if (existing) return existing;
  } catch {}
  const id =
    (globalThis as any)?.crypto?.randomUUID?.() ??
    `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  try {
    await AsyncStorage.setItem("tacoplan_device_id", id);
  } catch {}
  return id;
}

function getExpoProjectId(): string | undefined {
  return (
    (Constants as any)?.expoConfig?.extra?.eas?.projectId ||
    (Constants as any)?.easConfig?.projectId ||
    (Constants as any)?.expoConfig?.extra?.projectId ||
    undefined
  );
}

function getBuildNumber(): string | null {
  try {
    if (Platform.OS === "ios") {
      const v = (Constants as any)?.expoConfig?.ios?.buildNumber;
      return v != null ? String(v) : null;
    }
    if (Platform.OS === "android") {
      const v = (Constants as any)?.expoConfig?.android?.versionCode;
      return v != null ? String(v) : null;
    }
  } catch {}
  return null;
}

async function upsertDevicePresence(userId: string): Promise<void> {
  try {
    if (!userId) return;
    const deviceId = await getOrCreateDeviceId();
    const nowIso = new Date().toISOString();
    const appVersion = getInstalledAppVersion();
    const buildNumber = getBuildNumber();
    const row: any = {
      user_id: userId,
      device_id: deviceId,
      platform: Platform.OS,
      app_version: String(appVersion || ""),
      build_number: buildNumber,
      last_seen_at: nowIso,
      updated_at: nowIso,
    };
    await supabase.from("app_user_devices").upsert(row, { onConflict: "user_id,device_id" });
  } catch {}
}

export async function registerPushToken(): Promise<{
  ok: boolean;
  message?: string;
  permissionStatus?: string;
  expoPushToken?: string;
}> {
  if (Platform.OS === "web") {
    return { ok: false, message: "Las notificaciones push no están disponibles en web.", permissionStatus: "unavailable" };
  }

  const Notifications = await import("expo-notifications");
  if (!Notifications?.getPermissionsAsync || !Notifications?.requestPermissionsAsync || !Notifications?.getExpoPushTokenAsync) {
    return { ok: false, message: "expo-notifications no está disponible." };
  }

  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr) {
    console.log("Supabase session error:", sessionErr);
  }
  const session = sessionData?.session;
  const userId = session?.user?.id;
  console.log("User ID:", userId);
  if (!userId) {
    return { ok: false, message: "Usuario no autenticado" };
  }

  if (Platform.OS === "android") {
    try {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    } catch (e) {
      console.log("Android notification channel error:", e);
    }
  }

  const current = await Notifications.getPermissionsAsync().catch((e: any) => {
    console.log("Push getPermissionsAsync error:", e);
    return null as any;
  });
  let finalStatus = current?.status;
  if (finalStatus !== "granted") {
    const req = await Notifications.requestPermissionsAsync().catch((e: any) => {
      console.log("Push requestPermissionsAsync error:", e);
      return null as any;
    });
    finalStatus = req?.status;
  }
  console.log("Push permission:", finalStatus);
  if (finalStatus !== "granted") {
    try {
      await supabase.from("profiles").update({ notifications_enabled: false } as any).eq("id", userId);
    } catch (e) {
      console.log("Supabase profile notifications_enabled update error:", e);
    }
    return { ok: false, message: "Permiso denegado", permissionStatus: String(finalStatus || "unknown") };
  }

  const projectId = getExpoProjectId();
  console.log("Expo projectId:", projectId);
  if (!projectId) {
    return {
      ok: false,
      message: "projectId no encontrado. Revisa app.json > expo.extra.eas.projectId (EAS Project ID).",
      permissionStatus: String(finalStatus || "unknown"),
    };
  }

  let expoPushToken = "";
  try {
    const tokenRes = await Notifications.getExpoPushTokenAsync({ projectId });
    expoPushToken = tokenRes?.data;
  } catch (e) {
    console.log("Push getExpoPushTokenAsync error:", e);
    const msg = (e as any)?.message ? String((e as any).message) : "";
    return {
      ok: false,
      message: msg
        ? `No se pudo obtener el token push: ${msg}`
        : "No se pudo obtener el token push",
      permissionStatus: String(finalStatus || "unknown"),
    };
  }

  console.log("Expo push token:", expoPushToken);
  if (!expoPushToken || typeof expoPushToken !== "string") {
    return { ok: false, message: "No se pudo obtener el token push", permissionStatus: String(finalStatus || "unknown") };
  }

  const deviceId = await getOrCreateDeviceId();
  const nowIso = new Date().toISOString();
  const payload = {
    user_id: userId,
    expo_push_token: expoPushToken,
    platform: Platform.OS,
    device_id: deviceId,
    notifications_enabled: true,
    last_token_update: nowIso,
    updated_at: nowIso,
  } as any;

  try {
    await supabase
      .from("push_tokens")
      .delete()
      .eq("user_id", userId)
      .eq("device_id", deviceId)
      .neq("expo_push_token", expoPushToken);
  } catch {}

  const upsertWithConflict = async (onConflict: string) => {
    return await supabase
      .from("push_tokens")
      .upsert(payload, { onConflict })
      .select("id,user_id,expo_push_token,platform,device_id,updated_at")
      .maybeSingle();
  };

  let upsertRes = await upsertWithConflict("user_id,expo_push_token");
  if (upsertRes.error) {
    const msg = String(upsertRes.error.message || "");
    if (msg.toLowerCase().includes("no unique") || msg.toLowerCase().includes("constraint")) {
      upsertRes = await upsertWithConflict("expo_push_token");
    }
  }

  if (upsertRes.error) {
    console.log("Supabase push token error:", upsertRes.error);
    return {
      ok: false,
      message: upsertRes.error.message || "Error guardando token push",
      permissionStatus: String(finalStatus || "unknown"),
      expoPushToken,
    };
  }

  console.log("Supabase push token saved:", upsertRes.data);
  try {
    await supabase.from("profiles").update({ notifications_enabled: true } as any).eq("id", userId);
  } catch (e) {
    console.log("Supabase profile notifications_enabled set true error:", e);
  }

  return { ok: true, permissionStatus: String(finalStatus || "unknown"), expoPushToken };
}

async function syncPushTokenForUser(userId: string): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    try {
      const { data } = await supabase
        .from("profiles")
        .select("notifications_enabled")
        .eq("id", userId)
        .maybeSingle();
      if ((data as any)?.notifications_enabled === false) return;
    } catch {}

    const Notifications = await import("expo-notifications");
    if (!Notifications?.getPermissionsAsync) return;

    if (Platform.OS === "android") {
      try {
        await Notifications.setNotificationChannelAsync("default", {
          name: "default",
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      } catch {}
    }

    const deviceId = await getOrCreateDeviceId();
    const projectId =
      (Constants as any)?.expoConfig?.extra?.eas?.projectId ||
      (Constants as any)?.easConfig?.projectId ||
      (Constants as any)?.expoConfig?.extra?.projectId ||
      undefined;

    if (!projectId) return;

    const current = await Notifications.getPermissionsAsync();
    let finalStatus = current?.status;
    if (finalStatus !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      finalStatus = req?.status;
    }

    if (finalStatus !== "granted") {
      try {
        await supabase.from("profiles").update({ notifications_enabled: false } as any).eq("id", userId);
      } catch {}
      return;
    }

    const tokenRes = await Notifications.getExpoPushTokenAsync({ projectId });
    const expoPushToken = tokenRes?.data;
    if (!expoPushToken || typeof expoPushToken !== "string") return;

    const nowIso = new Date().toISOString();
    try {
      await supabase
        .from("push_tokens")
        .delete()
        .eq("user_id", userId)
        .eq("device_id", deviceId)
        .neq("expo_push_token", expoPushToken);
    } catch {}
    await supabase
      .from("push_tokens")
      .upsert(
        {
          user_id: userId,
          expo_push_token: expoPushToken,
          platform: Platform.OS,
          device_id: deviceId,
          notifications_enabled: true,
          last_token_update: nowIso,
          updated_at: nowIso,
        } as any,
        { onConflict: "expo_push_token" },
      );

    try {
      await supabase
        .from("profiles")
        .update({ notifications_enabled: true } as any)
        .eq("id", userId);
    } catch {}
  } catch {}
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [recoveryTokens, setRecoveryTokens] = useState<{ access_token: string; refresh_token: string } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAdminLoading, setIsAdminLoading] = useState(false);
  const prevUserIdRef = React.useRef<string | null>(null);
  const bootstrapInProgressRef = React.useRef<Set<string>>(new Set());

  const getAccessTokenFactory = useCallback((): Promise<string | null> => {
    return (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) return null;
        const s = data.session;
        if (!s?.access_token) return null;
        const nowSec = Math.floor(Date.now() / 1000);
        const exp = s.expires_at ?? nowSec;
        if (exp <= nowSec + 60) {
          try {
            const r = await supabase.auth.refreshSession();
            return r.data.session?.access_token ?? null;
          } catch {
            return s.access_token ?? null;
          }
        }
        return s.access_token;
      } catch {
        return null;
      }
    })();
  }, []);

  /**
   * Orquesta lo que pasa cuando ACABA de autenticarse un usuario (signin / onAuthStateChange
   * user nuevo / loadSession / OAuth / etc).
   *
   * Política de datos multi-dispositivo (regla VERBATIM usuario):
   *   - Los datos scoped por usuario (tacoplan_*_<userId>) NUNCA se borran en logout
   *     ni en user switch (solo volatile: queue / last_sync).
   *   - Si el dispositivo NO tiene datos locales para este usuario y HAY datos en
   *     la nube → auto-restoreFromCloud (trae settings, perfil, jornadas).
   *   - Después dispara autoSync() para bidireccional: merge local<->remoto.
   */
  const bootstrapUserDataOnDevice = useCallback(async (userId: string) => {
    if (!userId) return;
    if (bootstrapInProgressRef.current.has(userId)) return;
    bootstrapInProgressRef.current.add(userId);

    try {
      // 1. ¿Tenemos datos locales de este usuario?
      const jKey = `tacoplan_jornadas_${userId}`;
      const sKey = `tacoplan_user_settings_${userId}`;
      let localJornadasCount = 0;
      let hasLocalSettings = false;
      try {
        const jRaw = await AsyncStorage.getItem(jKey);
        if (jRaw) {
          try {
            const parsed = JSON.parse(jRaw);
            if (Array.isArray(parsed)) localJornadasCount = parsed.length;
          } catch {}
        }
        const sRaw = await AsyncStorage.getItem(sKey);
        if (sRaw) hasLocalSettings = true;
      } catch {}

      // 2. Miramos si la nube tiene datos y decide si restaurar sin prompt.
      try {
        const cloudRestore = await shouldOfferCloudRestorePrompt(getAccessTokenFactory);
        if (cloudRestore.shouldShow && localJornadasCount === 0 && !hasLocalSettings) {
          // Dispositivo nuevo para este usuario sin datos locales → restaurar
          // silenciosamente desde la nube. Así no se le pide de nuevo la
          // configuración ni desaparece el historial al cambiar de móvil.
          await restoreFromCloud(getAccessTokenFactory, () => {});
        } else {
          // Si no necesitamos restore, al menos arrancamos sync bidireccional
          // para emparejar lo de local con lo que hubiera en nube más reciente.
          try {
            await syncServiceAutoSync(getAccessTokenFactory, undefined);
          } catch {}
        }
      } catch (e) {
        // Falla online o similar: sin decisión; el sync normal lo arreglará.
        try { await syncServiceAutoSync(getAccessTokenFactory, undefined); } catch {}
      }
    } catch (e) {
      console.log("[AUTH] bootstrapUserDataOnDevice failed", e);
    } finally {
      bootstrapInProgressRef.current.delete(userId);
    }
  }, [getAccessTokenFactory]);

  /**
   * Limpia la información de SESIÓN del usuario al cambiar de cuenta,
   * PERO CONSERVA los datos de negocio scoped por usuario (jornadas, settings,
   * device_id, compensaciones). Así, si vuelve a iniciar sesión en el mismo
   * dispositivo con el mismo usuario, no tiene que reconfigurar nada ni
   * desaparece el historial.
   *
   * También evita que al hacer logout se borren los datos:
   * al volver a entrar se restablece vía restoreFromCloud si el dispositivo
   * es nuevo, o bien usamos los datos locales scoped que ya estaban guardados.
   */
  const clearLocalOnUserSwitch = useCallback(async (prevId: string | null) => {
    try {
      const volatileKeys = [
        "tacoplan_last_sync",
        "tacoplan_offline_queue",
      ];

      const keysToClear = [
        ...volatileKeys,
        ...(prevId ? volatileKeys.map((k) => `${k}_${prevId}`) : []),
      ];

      for (const k of keysToClear) {
        try {
          await AsyncStorage.removeItem(k);
        } catch (e) {
          console.log("[USER SWITCH] Failed to clear AsyncStorage key", { key: k, error: e });
        }
      }

      if (typeof window !== "undefined" && window.localStorage) {
        for (const k of keysToClear) {
          try {
            window.localStorage.removeItem(k);
          } catch (e) {
            console.log("[USER SWITCH] Failed to clear localStorage key", { key: k, error: e });
          }
        }
      }
      if (__DEV__) console.log("[USER SWITCH] Volatile keys cleared (user-scoped business data preserved)", { prevId, cleared: keysToClear });
    } catch (e) {
      console.log("[USER SWITCH] Failed to clear volatile caches", e);
    }
  }, []);

  useEffect(() => {
    (async () => {
      if (Platform.OS === "web") {
        await checkWebOAuthCallback();
        await checkWebRecoveryCallback();
      }
      await loadSession();
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, supaSession) => {
      if (supaSession) {
        const nextUser = mapUser(supaSession.user);
        let userActuallyChanged = false;
        setUser((prev) => {
          const changed = !sameUser(prev, nextUser);
          if (changed) {
            userActuallyChanged = true;
            if (prev?.id && prev.id !== nextUser.id) {
              clearLocalOnUserSwitch(prev.id);
            }
            prevUserIdRef.current = nextUser.id;
          }
          return changed ? nextUser : prev;
        });
        setSession(mapSession(supaSession));
        AsyncStorage.setItem("tacoplan_last_user_id", nextUser.id).catch(() => {});
        syncPushTokenForUser(nextUser.id).catch(() => {});
        if (userActuallyChanged) {
          bootstrapUserDataOnDevice(String(nextUser.id)).catch(() => {});
        }
      } else {
        console.log("Auth session lost (null session from Supabase).");
        setUser(null);
        setSession(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const checkWebOAuthCallback = async () => {
    try {
      if (typeof window === "undefined") return;
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const err = url.searchParams.get("error");
      const errCode = url.searchParams.get("error_code");
      const errDesc = url.searchParams.get("error_description");

      if (!code && !err && !errCode) return;

      console.error("[OAUTH] web callback detected", {
        href: url.toString(),
        codePresent: !!code,
        error: err,
        errorCode: errCode,
      });

      const clean = () => {
        try {
          window.history.replaceState(null, "", url.pathname || "/");
        } catch {}
      };

      if (err || errCode) {
        console.error("[OAUTH] web callback error params", {
          error: err,
          errorCode: errCode,
          errorDescription: errDesc,
        });
        clean();
        return;
      }

      if (!code) {
        console.error("[OAUTH] web callback missing code");
        clean();
        return;
      }

      console.error("[OAUTH] web exchanging code for session");
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        console.error("[OAUTH] web exchangeCodeForSession error", { message: error.message });
        clean();
        return;
      }

      console.error("[OAUTH] web exchange success", { userId: data.user?.id });
      if (data.user?.id) {
        prevUserIdRef.current = String(data.user.id);
        upsertDevicePresence(String(data.user.id)).catch(() => {});
        bootstrapUserDataOnDevice(String(data.user.id)).catch(() => {});
      }
      clean();
    } catch (e) {
      console.error("[OAUTH] web callback handler failed", e);
    }
  };

  const checkWebRecoveryCallback = async () => {
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
    } catch (e) {
      console.error("OAuth callback error:", e);
    }
  };

  const loadSession = async () => {
    try {
      const { data: { session: supaSession }, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (supaSession) {
        setUser(mapUser(supaSession.user));
        setSession(mapSession(supaSession));
        prevUserIdRef.current = String(supaSession.user.id);
        upsertDevicePresence(String(supaSession.user.id)).catch(() => {});
        bootstrapUserDataOnDevice(String(supaSession.user.id)).catch(() => {});
      }
    } catch (e) {
      console.error("Error loading auth:", e);
    }
    setIsLoading(false);
  };

  const refreshAdminStatus = useCallback(async (): Promise<boolean> => {
    const uid = user?.id;
    if (!uid) {
      setIsAdmin(false);
      return false;
    }
    setIsAdminLoading(true);
    try {
      const { data, error } = await supabase
        .from("admin_users")
        .select("user_id,is_active")
        .eq("user_id", uid)
        .maybeSingle();
      if (error) {
        setIsAdmin(false);
        return false;
      }
      const ok = !!data?.user_id && (data as any)?.is_active !== false;
      setIsAdmin(ok);
      return ok;
    } catch {
      setIsAdmin(false);
      return false;
    } finally {
      setIsAdminLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    refreshAdminStatus().catch(() => {});
  }, [refreshAdminStatus]);

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
      prevUserIdRef.current = String(data.user.id);
      setUser(u);
      setSession(s);
      upsertDevicePresence(String(data.user.id)).catch(() => {});
      bootstrapUserDataOnDevice(String(data.user.id)).catch(() => {});
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
      prevUserIdRef.current = String(data.user.id);
      setUser(u);
      setSession(s);
      bootstrapUserDataOnDevice(String(data.user.id)).catch(() => {});
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
      prevUserIdRef.current = String(data.user.id);
      setUser(u);
      setSession(s);
      bootstrapUserDataOnDevice(String(data.user.id)).catch(() => {});
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
        prevUserIdRef.current = String(data.user.id);
        setUser(u);
        setSession(s);
        upsertDevicePresence(String(data.user.id)).catch(() => {});
        bootstrapUserDataOnDevice(String(data.user.id)).catch(() => {});
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
    try {
      await clearLocalOnUserSwitch(prevUserIdRef.current);
    } catch {}
    try {
      await AsyncStorage.removeItem("tacoplan_last_user_id");
    } catch {}
  }, []);

  const deleteAccount = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    if (!accessToken) throw new Error("No autenticado");
    const { data, error } = await supabase.functions.invoke("delete-account", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (error) {
      const ctx = (error as any)?.context;
      const status = ctx?.status != null ? String(ctx.status) : "";
      const body = ctx?.body != null ? (typeof ctx.body === "string" ? ctx.body : JSON.stringify(ctx.body)) : "";
      const parts = [
        error.message || "No se pudo eliminar la cuenta",
        status ? `status=${status}` : "",
        body ? `body=${body}` : "",
      ].filter(Boolean);
      throw new Error(parts.join(" · "));
    }
    if ((data as any)?.ok !== true) {
      const msg =
        typeof (data as any)?.message === "string"
          ? (data as any).message
          : "No se pudo eliminar la cuenta";
      throw new Error(msg);
    }
    await logout();
  }, [logout]);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      let supaSession = data.session;
      if (!supaSession) return null;

      const nowSec = Math.floor(Date.now() / 1000);
      const exp = supaSession.expires_at ?? nowSec;
      if (exp <= nowSec + 60) {
        const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) throw refreshError;
        if (refreshed.session) supaSession = refreshed.session;
      }

      if (supaSession?.access_token) {
        const u = mapUser(supaSession.user);
        const s = mapSession(supaSession);
        setUser(u);
        setSession(s);
        upsertDevicePresence(String(supaSession.user.id)).catch(() => {});
        return supaSession.access_token;
      }
    } catch (e) {
      console.error("getAccessToken error:", e);
    }
    return null;
  }, []);

  const value = useMemo(
    () => ({
      user,
      session,
      isLoading,
      isAuthenticated: !!user,
      signIn,
      signUp,
      verifyEmail,
      resendVerification,
      resetPassword,
      updatePassword,
      handleOAuthTokens,
      deleteAccount,
      logout,
      getAccessToken,
      recoveryTokens,
      isAdmin,
      isAdminLoading,
      refreshAdminStatus,
    }),
    [user, session, isLoading, signIn, signUp, verifyEmail, resendVerification, resetPassword, updatePassword, handleOAuthTokens, deleteAccount, logout, getAccessToken, recoveryTokens, isAdmin, isAdminLoading, refreshAdminStatus],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
