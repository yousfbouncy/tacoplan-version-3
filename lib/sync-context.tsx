import React, { createContext, useContext, useCallback, useEffect, useRef, useState, useMemo, ReactNode } from "react";
import { AppState, Platform } from "react-native";
import { useAuth } from "@/lib/auth-context";
import {
  debouncedAutoSync,
  syncAll,
  processOfflineQueue,
  queueDeleteForSync,
  deleteFromCloud,
  getLastSyncTime,
  hasPendingData,
  isNewDevice,
  hasLocalData,
  restoreFromCloud,
  checkCloudDataCount,
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
  startRestore: () => void;
  dismissRecovery: () => void;
  dismissRestoreComplete: () => void;
  dismissToast: () => void;
  refreshSyncInfo: () => void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { getAccessToken, isGuest, isAuthenticated } = useAuth();
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
      showToast("Error de sincronización", "error");
      statusTimerRef.current = setTimeout(() => setSyncStatus("idle"), 3000);
    }
  }, [refreshSyncInfo, showToast]);

  const triggerSync = useCallback(() => {
    if (isGuest || !isAuthenticated) return;
    debouncedAutoSync(getAccessToken, (status) => {
      updateStatus(status);
    });
  }, [getAccessToken, isGuest, isAuthenticated, updateStatus]);

  const triggerDeleteSync = useCallback(async (jornadaId: string) => {
    if (isGuest || !isAuthenticated) return;
    await queueDeleteForSync(jornadaId);
    await deleteFromCloud(jornadaId, getAccessToken);
    triggerSync();
  }, [getAccessToken, isGuest, isAuthenticated, triggerSync]);

  const startRestore = useCallback(async () => {
    if (isGuest || !isAuthenticated) return;
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
  }, [getAccessToken, isGuest, isAuthenticated, refreshSyncInfo, showToast]);

  const dismissRecovery = useCallback(() => {
    setShowRecoveryPrompt(false);
  }, []);

  const dismissRestoreComplete = useCallback(() => {
    setRestoreComplete(false);
    setRestoreResult(null);
  }, []);

  useEffect(() => {
    if (isGuest || !isAuthenticated) return;
    refreshSyncInfo();
  }, [isGuest, isAuthenticated, refreshSyncInfo]);

  useEffect(() => {
    if (isGuest || !isAuthenticated || checkedDevice.current) return;
    checkedDevice.current = true;

    (async () => {
      const newDev = await isNewDevice();
      const hasData = await hasLocalData();

      setSyncStatus("syncing");

      try {
        const result = await syncAll(getAccessToken);
        updateStatus(result.success ? "synced" : "error", result);
      } catch {
        updateStatus("error");
      }
    })();
  }, [isGuest, isAuthenticated]);

  useEffect(() => {
    if (isGuest || !isAuthenticated) return;
    processOfflineQueue(getAccessToken, (status) => updateStatus(status));
  }, [getAccessToken, isGuest, isAuthenticated, updateStatus]);

  useEffect(() => {
    if (isGuest || !isAuthenticated) return;

    if (Platform.OS === "web" && typeof window !== "undefined") {
      const handler = () => {
        if (navigator.onLine) {
          processOfflineQueue(getAccessToken, (status) => updateStatus(status));
        }
      };
      window.addEventListener("online", handler);
      return () => window.removeEventListener("online", handler);
    }
  }, [getAccessToken, isGuest, isAuthenticated, updateStatus]);

  useEffect(() => {
    if (isGuest || !isAuthenticated) return;

    const sub = AppState.addEventListener("change", (nextState: string) => {
      if (nextState === "active") {
        (async () => {
          try {
            setSyncStatus("syncing");
            const result = await syncAll(getAccessToken);
            updateStatus(result.success ? "synced" : "error", result);
          } catch {
            await processOfflineQueue(getAccessToken, (status) => updateStatus(status));
          }
          refreshSyncInfo();
        })();
      }
    });
    return () => sub.remove();
  }, [getAccessToken, isGuest, isAuthenticated, updateStatus, refreshSyncInfo]);

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
    startRestore,
    dismissRecovery,
    dismissRestoreComplete,
    dismissToast,
    refreshSyncInfo,
  }), [syncStatus, lastSyncTime, hasPending, showRecoveryPrompt, isRestoring, restoreProgress, restoreComplete, restoreResult, syncVersion, syncToast, triggerSync, triggerDeleteSync, startRestore, dismissRecovery, dismissRestoreComplete, dismissToast, refreshSyncInfo]);

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync() {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used within SyncProvider");
  return ctx;
}
