import { AppState, Platform } from "react-native";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { supabase } from "@/lib/supabase";
import { getJornadaAbierta } from "@/lib/local-storage";
import { AUTOSTART_TASK, deliverAutoStartLocations, readAutoStartState, setAutoStartState } from "./task";

const PERIOD_MS = 5 * 60_000;
const WINDOW_MS = 60_000;
let windowInterval: ReturnType<typeof setInterval> | null = null;
let windowTimeout: ReturnType<typeof setTimeout> | null = null;
let foreground: Location.LocationSubscription | null = null;
let currentMode: "off" | "foreground" | "background" = "off";
let currentUser: string | null = null;
let activeSync: Promise<void> | null = null;

async function clearForeground(): Promise<void> {
  if (windowInterval) clearInterval(windowInterval);
  if (windowTimeout) clearTimeout(windowTimeout);
  windowInterval = null;
  windowTimeout = null;
  foreground?.remove();
  foreground = null;
}
async function clearBackground(): Promise<void> {
  if (Platform.OS !== "web" && await Location.hasStartedLocationUpdatesAsync(AUTOSTART_TASK)) {
    await Location.stopLocationUpdatesAsync(AUTOSTART_TASK);
  }
}
async function beginWindow(userId: string): Promise<void> {
  if (currentMode !== "foreground" || currentUser !== userId || foreground) return;
  if ((await getJornadaAbierta())?.id || !(await readAutoStartState()).enabled) {
    await clearForeground();
    currentMode = "off";
    return;
  }
  foreground = await Location.watchPositionAsync({
    accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 0,
  }, location => { void deliverAutoStartLocations([location]); });
  windowTimeout = setTimeout(() => {
    foreground?.remove();
    foreground = null;
    windowTimeout = null;
  }, WINDOW_MS);
}
/**
 * Foreground: 60-second GPS sample each 5 minutes.
 * Background: OS-managed low-power delivery; iOS/Android cannot guarantee
 * exact 60s/5min scheduling when the JS runtime is suspended.
 */
export async function syncAutoStartMonitoring(userId: string): Promise<void> {
  if (activeSync) await activeSync.catch(()=>{});
  const work = (async () => {
    if (Platform.OS === "web") return;
    const state = await readAutoStartState();
    const open = await getJornadaAbierta();
    if (!state.enabled || state.userId !== userId || !!open?.id) {
      await clearForeground();
      await clearBackground();
      currentMode = "off";
      currentUser = null;
      return;
    }
    const foregroundPermission = await Location.getForegroundPermissionsAsync();
    if (!foregroundPermission.granted) {
      await clearForeground(); await clearBackground();
      currentMode = "off"; currentUser = null;
      return;
    }
    currentUser = userId;
    if (AppState.currentState === "active") {
      if (currentMode !== "foreground") {
        await clearForeground();
        await clearBackground();
        currentMode = "foreground";
        await beginWindow(userId);
        windowInterval = setInterval(() => {
          void beginWindow(userId).catch(e => console.warn("[AUTOSTART] GPS window failed",e));
        }, PERIOD_MS);
      }
    } else {
      await clearForeground();
      currentMode = "background";
      const backgroundPermission = await Location.getBackgroundPermissionsAsync();
      if (backgroundPermission.granted && await TaskManager.isAvailableAsync()) {
        if (!await Location.hasStartedLocationUpdatesAsync(AUTOSTART_TASK)) {
          await Location.startLocationUpdatesAsync(AUTOSTART_TASK, {
            accuracy: Location.Accuracy.Balanced, timeInterval: 60000, distanceInterval: 50,
            pausesUpdatesAutomatically: true,
            activityType: Location.ActivityType.AutomotiveNavigation,
            foregroundService: { notificationTitle: "Tacoplan AutoStart activo",
              notificationBody: "Detección de jornada en segundo plano" },
          });
        }
      } else await clearBackground();
    }
  })();
  activeSync = work;
  try { await work; } finally { if (activeSync === work) activeSync = null; }
}
export async function enableAutoStart(userId: string): Promise<void> {
  if (Platform.OS === "web") throw new Error("AutoStart solo está disponible en Android e iOS");
  if (!(await TaskManager.isAvailableAsync())) throw new Error("Hace falta una compilación nativa");
  const foregroundPermission = await Location.requestForegroundPermissionsAsync();
  if (foregroundPermission.status !== "granted") throw new Error("Autoriza ubicación precisa");
  // Background access is optional. Without it the 5-minute sampling only works
  // while Tacoplan is in the foreground.
  await Location.requestBackgroundPermissionsAsync().catch(()=>{});
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("autostart", {
      name: "AutoStart", importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  await Notifications.requestPermissionsAsync();
  const previous = await readAutoStartState();
  if (previous.userId && previous.userId !== userId) throw new Error("Desactiva AutoStart de la otra cuenta");
  await setAutoStartState({ ...previous, userId, enabled: true });
  await syncAutoStartMonitoring(userId);
}
export async function suspendAutoStartMonitoring(): Promise<void> {
  await clearForeground();
  await clearBackground();
  currentMode = "off";
  currentUser = null;
}
export async function disableAutoStart(): Promise<void> {
  const state = await readAutoStartState();
  await setAutoStartState({
    ...state, enabled: false, candidate: null, userId: null,
    movementSegments: [], firstMovementAt: null,
  });
  await suspendAutoStartMonitoring();
}
export async function syncAutoStartProposals(userId: string): Promise<void> {
  const state = await readAutoStartState();
  if (!state.enabled || state.userId !== userId) return;
  for (const proposal of state.proposals.filter(p => p.userId === userId)) {
    const { error } = await supabase.from("autostart_proposals").upsert({
      id: proposal.id, user_id: userId, detected_at: proposal.detectedAt,
      source: "location", status: "pending",
    }, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw error;
  }
}
