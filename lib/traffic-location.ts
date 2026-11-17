import * as Location from "expo-location";
import { AppState, Platform } from "react-native";
import { supabase } from "@/lib/supabase";
import { getJornadaAbierta } from "@/lib/local-storage";

const API = "https://tacoplan.es/api/empresas/driver-location";
let inFlight = false;
let lastHandledId: string | null = null;

async function request(method: "GET" | "POST", body?: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(API, {
      method,
      headers: {
        Authorization: "Bearer " + session.access_token,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || "Error de localización");
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function getTrafficLocationConsent(): Promise<boolean> {
  const data = await request("GET");
  return data?.enabled === true;
}

export async function setTrafficLocationConsent(enabled: boolean): Promise<boolean> {
  const result = await request("POST", { action: "consent", enabled });
  if (!result?.ok) throw new Error("No se pudo actualizar el permiso de Tráfico");
  return result.enabled === true;
}

async function getFreshPosition(): Promise<{ latitude: number; longitude: number; accuracy_m: number | null }> {
  const last = await Location.getLastKnownPositionAsync().catch(() => null);
  const recent = last && (Date.now() - last.timestamp) <= 60000 && (last.coords.accuracy ?? Infinity) <= 150;
  const position = recent ? last : await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  if (!position || !Number.isFinite(position.coords.latitude) || !Number.isFinite(position.coords.longitude)) {
    throw new Error("GPS no disponible");
  }
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy_m: position.coords.accuracy ?? null,
  };
}

/** Foreground-on-demand only. Never changes a jornada or records continuous tracking. */
export async function pollTrafficLocationRequest(): Promise<void> {
  if (Platform.OS === "web" || AppState.currentState !== "active" || inFlight) return;
  inFlight = true;
  try {
    const data = await request("GET");
    if (!data?.enabled || !data?.activeDuty || !data.request?.id) return;
    const id = String(data.request.id);
    if (id === lastHandledId) return;
    // A remote jornada must not override the driver's local closed state.
    const opened = await getJornadaAbierta();
    if (!opened) return;
    const permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted) {
      await request("POST", { action: "respond", requestId: id, status: "denied" });
      lastHandledId = id;
      return;
    }
    try {
      const gps = await getFreshPosition();
      await request("POST", { action: "respond", requestId: id, status: "received", ...gps });
      lastHandledId = id;
    } catch (error) {
      // A networking error must not be misreported as a GPS failure.
      if (error instanceof Error && /fetch|network|timeout|abort|HTTP/i.test(error.message)) throw error;
      await request("POST", { action: "respond", requestId: id, status: "failed" });
      lastHandledId = id;
    }
  } catch (error) {
    if (__DEV__) console.warn("[TRAFFIC LOCATION] Retry on next active poll", error);
  } finally {
    inFlight = false;
  }
}
