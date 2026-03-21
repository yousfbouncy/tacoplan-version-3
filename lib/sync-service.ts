import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiUrl } from "@/lib/query-client";
import { getPendingSyncData, markAllSynced, mergeFromCloud } from "@/lib/local-storage";

const OFFLINE_QUEUE_KEY = "tacoplan_offline_queue";
const LAST_SYNC_KEY = "tacoplan_last_sync";
const DEVICE_ID_KEY = "tacoplan_device_id";
const SYNC_DEBOUNCE_MS = 2000;

type SyncAction = { type: "push"; timestamp: number } | { type: "delete"; jornadaId: string; timestamp: number };

export interface SyncResult {
  success: boolean;
  message: string;
  stats?: {
    pulled: number;
    pushed: number;
    merged: number;
  };
}

async function apiCall(path: string, method: string, token: string, body?: any) {
  const base = getApiUrl();
  const url = new URL(path, base).toString();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || `Sync error ${res.status}`);
  }
  return res.json();
}

function isOnline(): boolean {
  if (Platform.OS === "web" && typeof navigator !== "undefined") {
    return navigator.onLine;
  }
  return true;
}

async function getOfflineQueue(): Promise<SyncAction[]> {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveOfflineQueue(queue: SyncAction[]): Promise<void> {
  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
}

async function addToOfflineQueue(action: SyncAction): Promise<void> {
  const queue = await getOfflineQueue();
  queue.push(action);
  await saveOfflineQueue(queue);
}

async function clearOfflineQueue(): Promise<void> {
  await AsyncStorage.removeItem(OFFLINE_QUEUE_KEY);
}

export async function saveLastSyncTime(): Promise<void> {
  await AsyncStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
}

export async function getLastSyncTime(): Promise<string | null> {
  return AsyncStorage.getItem(LAST_SYNC_KEY);
}

export async function hasPendingData(): Promise<boolean> {
  const pending = await getPendingSyncData();
  const queue = await getOfflineQueue();
  return pending.jornadas.length > 0 || pending.compensaciones.length > 0 || queue.length > 0;
}

export async function isNewDevice(): Promise<boolean> {
  const deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    const newId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    await AsyncStorage.setItem(DEVICE_ID_KEY, newId);
    return true;
  }
  return false;
}

export async function hasLocalData(): Promise<boolean> {
  const jRaw = await AsyncStorage.getItem("tacoplan_jornadas");
  if (jRaw) {
    const parsed = JSON.parse(jRaw);
    if (parsed.length > 0) return true;
  }
  return false;
}

export async function checkCloudDataCount(getAccessToken: () => Promise<string | null>): Promise<{ jornadas: number; compensaciones: number }> {
  try {
    const token = await getAccessToken();
    if (!token) return { jornadas: 0, compensaciones: 0 };
    const cloud = await apiCall("/api/sync/pull", "GET", token);
    return {
      jornadas: (cloud.jornadas || []).length,
      compensaciones: (cloud.compensaciones || []).length,
    };
  } catch {
    return { jornadas: 0, compensaciones: 0 };
  }
}

async function applyDietasConfigLocally(dietasConfig: any): Promise<void> {
  if (!dietasConfig) return;

  const { rates, extras, holidays } = dietasConfig;

  if (rates && rates.length > 0) {
    const settingsRaw = await AsyncStorage.getItem("tacoplan_user_settings");
    const settings = settingsRaw ? JSON.parse(settingsRaw) : {};
    const sr = (type: string, pct: number, fb: string) => {
      const r = rates.find((r: any) => r.trip_type === type && r.percent === pct);
      return r != null ? String(r.amount) : fb;
    };
    settings.nac_100 = sr("NACIONAL", 100, settings.nac_100 ?? "54.30");
    settings.nac_60 = sr("NACIONAL", 60, settings.nac_60 ?? "32.58");
    settings.nac_30 = sr("NACIONAL", 30, settings.nac_30 ?? "16.29");
    settings.intl_100 = sr("INTERNACIONAL", 100, settings.intl_100 ?? "72.77");
    settings.intl_60 = sr("INTERNACIONAL", 60, settings.intl_60 ?? "43.66");
    settings.intl_30 = sr("INTERNACIONAL", 30, settings.intl_30 ?? "21.83");

    if (extras) {
      settings.extra_saturday = String(extras.extra_saturday ?? "10");
      settings.extra_sunday = String(extras.extra_sunday ?? "15");
      settings.extra_holiday = String(extras.extra_holiday ?? "20");
    }

    await AsyncStorage.setItem("tacoplan_user_settings", JSON.stringify(settings));
  }

  if (holidays) {
    await AsyncStorage.setItem("tacoplan_user_holidays_cache", JSON.stringify(holidays));
  }
}

async function applyProfileLocally(profile: any): Promise<void> {
  if (!profile) return;

  if (profile.display_name) {
    const settingsRaw = await AsyncStorage.getItem("tacoplan_user_settings");
    const settings = settingsRaw ? JSON.parse(settingsRaw) : {};
    settings.driver_name = profile.display_name;
    await AsyncStorage.setItem("tacoplan_user_settings", JSON.stringify(settings));
  }

  if (profile.language) {
    await AsyncStorage.setItem("tacoplan_language", profile.language);
  }

  if (profile.period_type) {
    const periodRaw = await AsyncStorage.getItem("tacoplan_period_config");
    const period = periodRaw ? JSON.parse(periodRaw) : {};
    period.type = profile.period_type;
    if (profile.period_start_day) period.startDay = profile.period_start_day;
    if (profile.period_end_day) period.endDay = profile.period_end_day;
    await AsyncStorage.setItem("tacoplan_period_config", JSON.stringify(period));
  }
}

async function collectLocalSettings(): Promise<{ profile: any; dietasRates: any[]; extras: any } | null> {
  try {
    const settingsRaw = await AsyncStorage.getItem("tacoplan_user_settings");
    const periodRaw = await AsyncStorage.getItem("tacoplan_period_config");
    const langRaw = await AsyncStorage.getItem("tacoplan_language");

    const settings = settingsRaw ? JSON.parse(settingsRaw) : {};
    const period = periodRaw ? JSON.parse(periodRaw) : {};

    const profile = {
      display_name: settings.driver_name || null,
      language: langRaw || "es",
      period_type: period.type || "AUTO_01_30",
      period_start_day: period.startDay || 1,
      period_end_day: period.endDay || 30,
    };

    const rates: any[] = [];
    const addRate = (type: string, pct: number, key: string, def: string) => {
      const val = parseFloat(settings[key] ?? def);
      if (!isNaN(val)) rates.push({ trip_type: type, percent: pct, amount: val });
    };
    addRate("NACIONAL", 100, "nac_100", "54.30");
    addRate("NACIONAL", 60, "nac_60", "32.58");
    addRate("NACIONAL", 30, "nac_30", "16.29");
    addRate("INTERNACIONAL", 100, "intl_100", "72.77");
    addRate("INTERNACIONAL", 60, "intl_60", "43.66");
    addRate("INTERNACIONAL", 30, "intl_30", "21.83");

    const extras = {
      extra_saturday: parseFloat(settings.extra_saturday ?? "10"),
      extra_sunday: parseFloat(settings.extra_sunday ?? "15"),
      extra_holiday: parseFloat(settings.extra_holiday ?? "20"),
    };

    return { profile, dietasRates: rates, extras };
  } catch {
    return null;
  }
}

export async function syncAll(
  getAccessToken: () => Promise<string | null>,
): Promise<SyncResult> {
  const token = await getAccessToken();
  if (!token) {
    return { success: false, message: "No autenticado" };
  }

  let pushed = 0;
  let pulled = 0;
  let merged = 0;

  try {
    const pending = await getPendingSyncData();
    const hasPendingLocal = pending.jornadas.length > 0 || pending.compensaciones.length > 0;

    if (hasPendingLocal) {
      await apiCall("/api/sync/push", "POST", token, {
        jornadas: pending.jornadas,
        compensaciones: pending.compensaciones,
      });
      pushed = pending.jornadas.length + pending.compensaciones.length;
    }

    let profilePushOk = true;
    let dietasPushOk = true;
    const localSettings = await collectLocalSettings();
    if (localSettings) {
      try {
        await apiCall("/api/sync/profile", "PUT", token, localSettings.profile);
      } catch {
        profilePushOk = false;
      }
      try {
        await apiCall("/api/sync/dietas-config", "PUT", token, {
          rates: localSettings.dietasRates,
          extras: localSettings.extras,
        });
      } catch {
        dietasPushOk = false;
      }
    }

    const queue = await getOfflineQueue();
    const deleteActions = queue.filter((a): a is Extract<SyncAction, { type: "delete" }> => a.type === "delete");
    let allDeletesOk = true;
    for (const action of deleteActions) {
      try {
        await deleteFromCloud(action.jornadaId, getAccessToken);
      } catch {
        allDeletesOk = false;
      }
    }

    let cloud: any;
    let pullSuccess = false;
    try {
      cloud = await apiCall("/api/sync/all", "POST", token);
      pullSuccess = true;
    } catch {
      try {
        cloud = await apiCall("/api/sync/pull", "GET", token);
        cloud.profile = null;
        cloud.dietasConfig = null;
        pullSuccess = true;
      } catch {
        cloud = { jornadas: [], compensaciones: [], profile: null, dietasConfig: null };
      }
    }

    if (!pullSuccess) {
      return {
        success: false,
        message: "Error al descargar datos",
        stats: { pulled: 0, pushed, merged: 0 },
      };
    }

    const cloudJ = cloud.jornadas || [];
    const cloudC = cloud.compensaciones || [];
    pulled = cloudJ.length + cloudC.length;

    if (cloudJ.length > 0 || cloudC.length > 0) {
      await mergeFromCloud(cloudJ, cloudC);
    }

    merged = Math.max(0, pulled - pushed);

    if (cloud.profile && profilePushOk) {
      await applyProfileLocally(cloud.profile);
    }

    if (cloud.dietasConfig && dietasPushOk) {
      await applyDietasConfigLocally(cloud.dietasConfig);
    }

    if (hasPendingLocal && pushed > 0) {
      await markAllSynced();
    } else {
      await markAllSynced();
    }

    if (allDeletesOk) {
      await clearOfflineQueue();
    } else {
      const remaining = queue.filter((a) => a.type !== "delete" || deleteActions.every(d => d.jornadaId !== (a as any).jornadaId));
      await saveOfflineQueue(remaining.length > 0 ? remaining : []);
    }

    await saveLastSyncTime();

    return {
      success: true,
      message: "Sincronizado",
      stats: { pulled, pushed, merged },
    };
  } catch (e: any) {
    return { success: false, message: e.message || "Error de sincronización" };
  }
}

async function getAllJornadasCount(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem("tacoplan_jornadas");
    return raw ? JSON.parse(raw).length : 0;
  } catch {
    return 0;
  }
}

export async function syncFromCloud(getAccessToken: () => Promise<string | null>): Promise<SyncResult> {
  return syncAll(getAccessToken);
}

export async function syncWithCloud(getAccessToken: () => Promise<string | null>): Promise<SyncResult> {
  return syncAll(getAccessToken);
}

export async function deleteFromCloud(
  jornadaId: string,
  getAccessToken: () => Promise<string | null>,
): Promise<void> {
  const token = await getAccessToken();
  if (!token) return;

  try {
    await apiCall(`/api/sync/jornada/${jornadaId}`, "DELETE", token);
  } catch {}
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let syncInProgress = false;

export async function autoSync(
  getAccessToken: () => Promise<string | null>,
  onStatus?: (status: "syncing" | "synced" | "error" | "offline") => void,
): Promise<void> {
  if (!isOnline()) {
    await addToOfflineQueue({ type: "push", timestamp: Date.now() });
    onStatus?.("offline");
    return;
  }

  if (syncInProgress) return;
  syncInProgress = true;
  onStatus?.("syncing");

  try {
    const result = await syncAll(getAccessToken);
    onStatus?.(result.success ? "synced" : "error");
  } catch {
    onStatus?.("error");
  } finally {
    syncInProgress = false;
  }
}

export function debouncedAutoSync(
  getAccessToken: () => Promise<string | null>,
  onStatus?: (status: "syncing" | "synced" | "error" | "offline") => void,
): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    autoSync(getAccessToken, onStatus);
  }, SYNC_DEBOUNCE_MS);
}

export async function processOfflineQueue(
  getAccessToken: () => Promise<string | null>,
  onStatus?: (status: "syncing" | "synced" | "error" | "offline") => void,
): Promise<void> {
  const queue = await getOfflineQueue();
  if (queue.length === 0) return;
  if (!isOnline()) return;
  await autoSync(getAccessToken, onStatus);
}

export async function queueDeleteForSync(jornadaId: string): Promise<void> {
  await addToOfflineQueue({ type: "delete", jornadaId, timestamp: Date.now() });
}

export async function restoreFromCloud(
  getAccessToken: () => Promise<string | null>,
  onProgress?: (step: number, total: number, label: string) => void,
): Promise<{ success: boolean; message: string; jornadasCount: number; compensacionesCount: number }> {
  const token = await getAccessToken();
  if (!token) {
    return { success: false, message: "No autenticado", jornadasCount: 0, compensacionesCount: 0 };
  }

  const totalSteps = 5;

  try {
    onProgress?.(1, totalSteps, "Conectando con la nube...");
    await new Promise((r) => setTimeout(r, 400));

    onProgress?.(2, totalSteps, "Descargando jornadas y perfil...");

    let cloud: any;
    try {
      cloud = await apiCall("/api/sync/all", "POST", token);
    } catch {
      cloud = await apiCall("/api/sync/pull", "GET", token);
      cloud.profile = null;
      cloud.dietasConfig = null;
    }

    await new Promise((r) => setTimeout(r, 300));

    onProgress?.(3, totalSteps, "Aplicando configuración...");

    if (cloud.profile) {
      await applyProfileLocally(cloud.profile);
    }

    if (cloud.dietasConfig) {
      await applyDietasConfigLocally(cloud.dietasConfig);
    }

    await new Promise((r) => setTimeout(r, 300));

    onProgress?.(4, totalSteps, "Guardando datos en el dispositivo...");
    const cloudJornadas = cloud.jornadas || [];
    const cloudCompensaciones = cloud.compensaciones || [];

    if (cloudJornadas.length > 0 || cloudCompensaciones.length > 0) {
      await mergeFromCloud(cloudJornadas, cloudCompensaciones);
    }
    await markAllSynced();
    await saveLastSyncTime();
    await new Promise((r) => setTimeout(r, 300));

    onProgress?.(5, totalSteps, "Completado");
    await new Promise((r) => setTimeout(r, 200));

    return {
      success: true,
      message: "Datos restaurados correctamente",
      jornadasCount: cloudJornadas.length,
      compensacionesCount: cloudCompensaciones.length,
    };
  } catch (e: any) {
    return { success: false, message: e.message || "Error al restaurar", jornadasCount: 0, compensacionesCount: 0 };
  }
}
