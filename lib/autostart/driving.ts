import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Platform } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { getJornadaAbierta } from "@/lib/local-storage";
import { changeDriverActivity, loadDriverActivities, saveDriverActivities } from "@/lib/driver-activities";
import { updateDrivingDetection, type DrivingDetection } from "./driving-activity-engine";

export const DRIVING_TASK = "tacoplan-driving-activity-v1";
const PREF_PREFIX = "@tacoplan/driving-autostart/v1:";
const OWNER_KEY = "@tacoplan/driving-autostart/active-owner";
type Fix = Location.LocationObject;
type Detection = DrivingDetection & { userId: string; shiftId: string };
let detection: Detection | null = null;
let foreground: Location.LocationSubscription | null = null;
let activeUser: string | null = null;
let pending = Promise.resolve();
let syncPending: Promise<void> | null = null;

const prefKey = (userId: string) => PREF_PREFIX + userId;
export async function isDrivingAutoStartEnabled(userId: string): Promise<boolean> {
  return (await AsyncStorage.getItem(prefKey(userId))) === "true";
}
export async function setDrivingAutoStartEnabled(userId: string, enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(prefKey(userId), String(enabled));
  if (enabled) await AsyncStorage.setItem(OWNER_KEY, userId);
  else if ((await AsyncStorage.getItem(OWNER_KEY)) === userId) await AsyncStorage.removeItem(OWNER_KEY);
  await syncDrivingMonitoring(userId);
}
function clearDetection() { detection = null; }
async function handleFixes(fixes: Fix[]): Promise<void> {
  const owner = activeUser || await AsyncStorage.getItem(OWNER_KEY);
  if (!owner || !await isDrivingAutoStartEnabled(owner)) return;
  const shift = await getJornadaAbierta();
  if (!shift?.id) { clearDetection(); return; }
  const userId = owner;
  const shiftId = String(shift.id);
  if (!detection || detection.userId !== userId || detection.shiftId !== shiftId) {
    detection = { userId, shiftId, movingSince: null, lastFix: 0 };
  }
  for (const fix of fixes.slice().sort((a, b) => a.timestamp - b.timestamp)) {
    const previous = detection!;
    const result = updateDrivingDetection(previous, fix);
    if (result.state === previous) continue;
    detection = { ...result.state, userId, shiftId };
    if (!result.transition) continue;

    const log = await loadDriverActivities(userId, shiftId);
    const active = log.segments.findLast(s => s.endedAt === null);
    const autoRestKey = `@tacoplan/driving-autostart/rest:${userId}:${shiftId}`;

    if (result.transition === "REST") {
      // Stop at the first valid GPS fix below 6 km/h. Only transition from
      // an actual active drive, never overwrite WORK, AVAILABLE or manual REST.
      if (active?.type !== "DRIVING") continue;
      const effectiveTime = new Date(Math.max(fix.timestamp, Date.parse(active.startedAt)));
      const next = changeDriverActivity(log, "REST", effectiveTime);
      if (next !== log) {
        await saveDriverActivities(userId, next);
        const startedAt = next.segments.findLast(s => s.endedAt === null)?.startedAt;
        if (startedAt) await AsyncStorage.setItem(autoRestKey, startedAt);
      }
      continue;
    }

    // >=15 km/h for 60 seconds. Backdate to confirmed moving start without
    // overlapping the current activity. Never close a manually selected REST.
    const marker = await AsyncStorage.getItem(autoRestKey);
    const autoRest = active?.type === "REST" && !!marker && marker === active.startedAt;
    if (active?.type === "DRIVING") continue;
    if (active && !autoRest && active.type !== "REST") continue;
    if (active?.type === "REST" && !autoRest) continue;
    const movementStart = result.movementStart ?? fix.timestamp;
    const earliest = active ? Date.parse(active.startedAt) : 0;
    const next = changeDriverActivity(log, "DRIVING", new Date(Math.max(movementStart, earliest)));
    if (next !== log) {
      await saveDriverActivities(userId, next);
      if (autoRest) await AsyncStorage.removeItem(autoRestKey);
    }
  }
}
function enqueue(fixes: Fix[]) {
  const next = pending.catch(() => {}).then(() => handleFixes(fixes));
  pending = next.catch(e => console.warn("[DRIVING-AUTO] Location processing failed", e));
  return next;
}
TaskManager.defineTask(DRIVING_TASK, ({ data, error }) => {
  if (error || !data) return Promise.resolve();
  const fixes = (data as { locations?: Fix[] }).locations || [];
  return enqueue(fixes);
});
export async function stopDrivingMonitoring(): Promise<void> {
  foreground?.remove();
  foreground = null;
  clearDetection();
  if (Platform.OS !== "web" && await Location.hasStartedLocationUpdatesAsync(DRIVING_TASK)) {
    await Location.stopLocationUpdatesAsync(DRIVING_TASK);
  }
  activeUser = null;
}
export async function syncDrivingMonitoring(userId: string): Promise<void> {
  // Serialize foreground navigation, toggles and session changes.
  const previous = syncPending || Promise.resolve();
  const run = previous.catch(() => {}).then(async () => {
    if (Platform.OS === "web" || !userId || !await isDrivingAutoStartEnabled(userId) ||
        !(await getJornadaAbierta())?.id) {
      await stopDrivingMonitoring();
      return;
    }
    const permissions = await Location.getForegroundPermissionsAsync();
    if (!permissions.granted) { await stopDrivingMonitoring(); return; }
    if (activeUser && activeUser !== userId) await stopDrivingMonitoring();
    activeUser = userId;
    await AsyncStorage.setItem(OWNER_KEY, userId);
    const background = await Location.getBackgroundPermissionsAsync();
    if (background.granted && await TaskManager.isAvailableAsync()) {
      foreground?.remove();
      foreground = null;
      if (!await Location.hasStartedLocationUpdatesAsync(DRIVING_TASK)) {
        await Location.startLocationUpdatesAsync(DRIVING_TASK, {
          accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 0,
          activityType: Location.ActivityType.AutomotiveNavigation,
          foregroundService: { notificationTitle: "Tacoplan · Conducción automática",
            notificationBody: "Detectando conducción durante la jornada" },
          pausesUpdatesAutomatically: false,
        });
      }
    } else {
      if (await Location.hasStartedLocationUpdatesAsync(DRIVING_TASK)) {
        await Location.stopLocationUpdatesAsync(DRIVING_TASK);
      }
      if (AppState.currentState === "active" && !foreground) {
        const subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 0 },
          fix => { void enqueue([fix]); },
        );
        if (activeUser !== userId || AppState.currentState !== "active") subscription.remove();
        else foreground = subscription;
      } else if (AppState.currentState !== "active") {
        foreground?.remove();
        foreground = null;
      }
    }
  });
  syncPending = run;
  try { await run; } finally { if (syncPending === run) syncPending = null; }
}
