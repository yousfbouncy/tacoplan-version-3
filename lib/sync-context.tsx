import React, { createContext, useContext, useCallback, useEffect, useRef, useState, useMemo, ReactNode } from "react";
import { AppState, Platform } from "react-native";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { getApiUrl } from "@/lib/query-client";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import {
  debouncedAutoSync,
  syncAll,
  processOfflineQueue,
  queueDeleteForSync,
  deleteFromCloud,
  queueDeleteDayExtraEntryForSync,
  deleteDayExtraEntryFromCloud,
  queueDeleteNaturalDayDietForSync,
  deleteNaturalDayDietFromCloud,
  getLastSyncTime,
  hasPendingData,
  isNewDevice,
  hasLocalData,
  restoreFromCloud,
  shouldOfferCloudRestorePrompt,
  setOnlineOverride,
} from "@/lib/sync-service";
import type { SyncResult } from "@/lib/sync-service";

type SyncStatus = "idle" | "syncing" | "synced" | "error" | "offline";

interface RestoreProgress {
  step: number;
  total: number;
  label: string;
}

interface SyncToast {
  message: string;
  type: "success" | "error" | "info";
  visible: boolean;
}

interface SyncContextValue {
  syncStatus: SyncStatus;
  lastSyncTime: string | null;
  hasPending: boolean;
  showRecoveryPrompt: boolean;
  isRestoring: boolean;
  restoreProgress: RestoreProgress | null;
  restoreComplete: boolean;
  restoreResult: { jornadasCount: number; compensacionesCount: number } | null;
  syncVersion: number;
  syncToast: SyncToast | null;
  triggerSync: () => void;
  triggerDeleteSync: (jornadaId: string) => void;
  triggerDeleteDayExtraEntrySync: (entryId: string) => void;
  triggerDeleteNaturalDayDietSync: (entryId: string) => void;
  startRestore: () => void;
  dismissRecovery: () => void;
  dismissRestoreComplete: () => void;
  dismissToast: () => void;
  refreshSyncInfo: () => void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { getAccessToken, isAuthenticated, user } = useAuth();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [hasPending, setHasPending] = useState(false);
  const [showRecoveryPrompt, setShowRecoveryPrompt] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<RestoreProgress | null>(null);
  const [restoreComplete, setRestoreComplete] = useState(false);
  const [restoreResult, setRestoreResult] = useState<{ jornadasCount: number; compensacionesCount: number } | null>(null);
  const [syncVersion, setSyncVersion] = useState(0);
  const [syncToast, setSyncToast] = useState<SyncToast | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkedDevice = useRef(false);
  const lastDiagAtRef = useRef<number>(0);
  const lastAutoSyncAtRef = useRef<number>(0);

  useEffect(() => {
    checkedDevice.current = false;
  }, [user?.id]);

  const showToast = useCallback((message: string, type: "success" | "error" | "info" = "success") => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setSyncToast({ message, type, visible: true });
    toastTimerRef.current = setTimeout(() => {
      setSyncToast(null);
    }, 3500);
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setSyncToast(null);
  }, []);

  const refreshSyncInfo = useCallback(async () => {
    const time = await getLastSyncTime();
    setLastSyncTime(time);
    const pending = await hasPendingData();
    setHasPending(pending);
  }, []);

  const logSyncDiagnostics = useCallback(async (source: string, result?: SyncResult) => {
    const now = Date.now();
    if (now - lastDiagAtRef.current < 8000) return;
    lastDiagAtRef.current = now;

    try {
      const apiUrl = getApiUrl();
      console.log("SYNC DIAG SOURCE:", source);
      console.log("SYNC DIAG API URL:", apiUrl);
      console.log("SYNC DIAG RESULT:", { success: result?.success, message: result?.message, stats: result?.stats });

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const session = sessionData?.session || null;
      console.log("SESSION DATA:", {
        session: session
          ? {
              userId: session.user?.id || null,
              expiresAt: (session as any).expires_at ?? null,
              tokenType: (session as any).token_type ?? null,
            }
          : null,
      });
      console.log("SESSION ERROR:", sessionError);

      const { data, error } = await supabase.from("profiles").select("*").limit(1);
      const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
      console.log("PROFILES DATA:", row ? { hasRow: true, keys: Object.keys(row) } : { hasRow: false });
      console.log("PROFILES ERROR:", error);
    } catch (error) {
      console.error("SYNC ERROR REAL:", error);
    }
  }, []);

  const updateStatus = useCallback((status: SyncStatus, result?: SyncResult) => {
    setSyncStatus(status);
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    if (status === "synced") {
      refreshSyncInfo();
      setSyncVersion((v) => v + 1);

      if (result?.stats) {
        const { pulled, pushed, merged } = result.stats;
        if (pulled > 0 || pushed > 0) {
          const parts: string[] = [];
          if (pushed > 0) parts.push(`${pushed} subidos`);
          if (pulled > 0) parts.push(`${pulled} descargados`);
          showToast(`Sincronización completada · ${parts.join(", ")}`, "success");
        } else {
          showToast("Sincronización completada", "success");
        }
      }

      statusTimerRef.current = setTimeout(() => setSyncStatus("idle"), 3000);
    } else if (status === "error") {
      const msg = `Error de sincronización · ${result?.message || "motivo desconocido"}`;
      showToast(msg, "error");
      logSyncDiagnostics("sync_error_banner", result);
      statusTimerRef.current = setTimeout(() => setSyncStatus("idle"), 3000);
    }
  }, [refreshSyncInfo, showToast, logSyncDiagnostics]);

  const triggerSync = useCallback(() => {
    if (!isAuthenticated) return;
    debouncedAutoSync(getAccessToken, (status, result) => {
      updateStatus(status as SyncStatus, result);
    });
  }, [getAccessToken, isAuthenticated, updateStatus]);

  const triggerDeleteSync = useCallback(async (jornadaId: string) => {
    if (!isAuthenticated) return;
    await queueDeleteForSync(jornadaId);
    try {
      await deleteFromCloud(jornadaId, getAccessToken);
    } catch {
      // Queda en cola para reintento cuando haya conexión.
    }
    triggerSync();
  }, [getAccessToken, isAuthenticated, triggerSync]);

  const triggerDeleteDayExtraEntrySync = useCallback(async (entryId: string) => {
    if (!isAuthenticated) return;
    await queueDeleteDayExtraEntryForSync(entryId);
    try {
      await deleteDayExtraEntryFromCloud(entryId, getAccessToken);
    } catch {
      // Queda en cola para reintento cuando haya conexión.
    }
    triggerSync();
  }, [getAccessToken, isAuthenticated, triggerSync]);

  const triggerDeleteNaturalDayDietSync = useCallback(async (entryId: string) => {
    if (!isAuthenticated) return;
    await queueDeleteNaturalDayDietForSync(entryId);
    try {
      await deleteNaturalDayDietFromCloud(entryId, getAccessToken);
    } catch {
      // La cola conserva el borrado y lo reintentará cuando haya conexión.
    }
    triggerSync();
  }, [getAccessToken, isAuthenticated, triggerSync]);

  const startRestore = useCallback(async () => {
    if (!isAuthenticated) return;
    setShowRecoveryPrompt(false);
    setIsRestoring(true);
    setRestoreProgress({ step: 0, total: 5, label: "Iniciando..." });
    setRestoreComplete(false);
    setRestoreResult(null);

    const result = await restoreFromCloud(getAccessToken, (step, total, label) => {
      setRestoreProgress({ step, total, label });
    });

    setIsRestoring(false);
    setRestoreProgress(null);

    if (result.success) {
      setRestoreResult({ jornadasCount: result.jornadasCount, compensacionesCount: result.compensacionesCount });
      setRestoreComplete(true);
      setSyncVersion((v) => v + 1);
      await refreshSyncInfo();
      showToast(`Restauración completada · ${result.jornadasCount} jornadas`, "success");
    } else {
      setRestoreResult(null);
      setRestoreComplete(true);
      showToast("Error al restaurar datos", "error");
    }
  }, [getAccessToken, isAuthenticated, refreshSyncInfo, showToast]);

  const dismissRecovery = useCallback(() => {
    setShowRecoveryPrompt(false);
  }, []);

  const dismissRestoreComplete = useCallback(() => {
    setRestoreComplete(false);
    setRestoreResult(null);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    refreshSyncInfo();
  }, [isAuthenticated, refreshSyncInfo]);

  useEffect(() => {
    if (!isAuthenticated || checkedDevice.current) return;
    checkedDevice.current = true;

    (async () => {
      const newDev = await isNewDevice();
      const hasData = await hasLocalData();

      if (newDev && !hasData) {
        const decision = await shouldOfferCloudRestorePrompt(getAccessToken);
        if (decision.shouldShow) {
          setShowRecoveryPrompt(true);
          setSyncStatus("idle");
          await refreshSyncInfo();
          return;
        }
      }

      setSyncStatus("syncing");
      try {
        const result = await syncAll(getAccessToken);
        updateStatus(result.success ? "synced" : "error", result);
      } catch (e: any) {
        updateStatus("error", { success: false, message: e?.message || String(e) });
      }
    })();
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    processOfflineQueue(getAccessToken, (status, result) => updateStatus(status as SyncStatus, result));
  }, [getAccessToken, isAuthenticated, updateStatus]);

  useEffect(() => {
    if (!isAuthenticated) return;

    if (Platform.OS === "web" && typeof window !== "undefined") {
      const handler = () => {
        if (navigator.onLine) {
          processOfflineQueue(getAccessToken, (status, result) => updateStatus(status as SyncStatus, result));
        }
      };
      window.addEventListener("online", handler);
      return () => window.removeEventListener("online", handler);
    }
  }, [getAccessToken, isAuthenticated, updateStatus]);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (Platform.OS === "web") return;
    const lastOnlineRef = { current: true };
    const sub = NetInfo.addEventListener((state: NetInfoState) => {
      const online = !!state.isConnected && (state.isInternetReachable !== false);
      setOnlineOverride(online);
      if (!online) {
        console.log("[NET] Offline detected");
        lastOnlineRef.current = false;
        setSyncStatus((s) => (s === "syncing" ? s : "offline"));
        return;
      }
      if (!lastOnlineRef.current) {
        console.log("[NET] Online detected");
        lastOnlineRef.current = true;
        processOfflineQueue(getAccessToken, (status, result) => updateStatus(status as SyncStatus, result));
      } else {
        lastOnlineRef.current = true;
      }
    });
    return () => sub();
  }, [getAccessToken, isAuthenticated, updateStatus]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const sub = AppState.addEventListener("change", (nextState: string) => {
      if (nextState === "active") {
        (async () => {
          try {
            const now = Date.now();
            if (Platform.OS === "web") {
              await refreshSyncInfo();
              return;
            }
            if (now - lastAutoSyncAtRef.current < 60_000) {
              await refreshSyncInfo();
              return;
            }

            const [pending, last] = await Promise.all([hasPendingData(), getLastSyncTime()]);
            const lastMs = last ? new Date(last).getTime() : 0;
            const stale = !lastMs || now - lastMs > 5 * 60_000;

            if (!pending && !stale) {
              await refreshSyncInfo();
              return;
            }

            lastAutoSyncAtRef.current = now;
            setSyncStatus("syncing");
            const result = await syncAll(getAccessToken);
            updateStatus(result.success ? "synced" : "error", result);
          } catch (e: any) {
            updateStatus("error", { success: false, message: e?.message || String(e) });
            await processOfflineQueue(getAccessToken, (status, result) => updateStatus(status as SyncStatus, result));
          }
          refreshSyncInfo();
        })();
      }
    });
    return () => sub.remove();
  }, [getAccessToken, isAuthenticated, updateStatus, refreshSyncInfo]);

  const value = useMemo(() => ({
    syncStatus,
    lastSyncTime,
    hasPending,
    showRecoveryPrompt,
    isRestoring,
    restoreProgress,
    restoreComplete,
    restoreResult,
    syncVersion,
    syncToast,
    triggerSync,
    triggerDeleteSync,
    triggerDeleteDayExtraEntrySync,
    triggerDeleteNaturalDayDietSync,
    startRestore,
    dismissRecovery,
    dismissRestoreComplete,
    dismissToast,
    refreshSyncInfo,
  }), [syncStatus, lastSyncTime, hasPending, showRecoveryPrompt, isRestoring, restoreProgress, restoreComplete, restoreResult, syncVersion, syncToast, triggerSync, triggerDeleteSync, triggerDeleteDayExtraEntrySync, triggerDeleteNaturalDayDietSync, startRestore, dismissRecovery, dismissRestoreComplete, dismissToast, refreshSyncInfo]);

  return React.createElement(SyncContext.Provider, { value }, children);
}

export function useSync() {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used within SyncProvider");
  return ctx;
}
