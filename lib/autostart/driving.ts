import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Platform } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { getJornadaAbierta } from "@/lib/local-storage";
import { changeDriverActivity, loadDriverActivities, pauseDriverActivity, saveDriverActivities } from "@/lib/driver-activities";

export const DRIVING_TASK = "tacoplan-driving-activity-v1";
const PREF_PREFIX = "@tacoplan/driving-autostart/v1:";
const MIN_SPEED = 15 / 3.6;
const CONFIRM_MS = 3 * 60_000;
const STOP_MS = 60_000;
const MAX_GAP_MS = 90_000;
type Fix = Location.LocationObject;
type Detection = { userId: string; shiftId: string; movingSince: number | null; stoppedSince: number | null; lastFix: number };
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
  await syncDrivingMonitoring(userId);
}
function clearDetection() { detection = null; }
async function handleFixes(fixes: Fix[]): Promise<void> {
  if (!activeUser || !await isDrivingAutoStartEnabled(activeUser)) return;
  const shift = await getJornadaAbierta();
  if (!shift?.id) { clearDetection(); return; }
  const userId = activeUser;
  const shiftId = String(shift.id);
  if (!detection || detection.userId !== userId || detection.shiftId !== shiftId) {
    detection = { userId, shiftId, movingSince: null, stoppedSince: null, lastFix: 0 };
  }
  for (const fix of fixes.slice().sort((a, b) => a.timestamp - b.timestamp)) {
    const ts = fix.timestamp;
    if (!Number.isFinite(ts) || ts <= detection.lastFix) continue;
    const previous = detection.lastFix;
    detection.lastFix = ts;
    if (previous && ts - previous > MAX_GAP_MS) {
      detection.movingSince = null;
      detection.stoppedSince = null;
    }
    const speed = fix.coords.speed;
    const good = typeof speed === "number" && Number.isFinite(speed) &&
      typeof fix.coords.accuracy === "number" && fix.coords.accuracy <= 75;
    if (!good) { detection.movingSince = null; continue; }
    if (speed >= MIN_SPEED) {
      detection.stoppedSince = null;
      if (detection.movingSince === null) detection.movingSince = ts;
      if (ts - detection.movingSince >= CONFIRM_MS) {
        const log = await loadDriverActivities(userId, shiftId);
        if (log.segments.findLast(s => s.endedAt === null)?.type !== "DRIVING") {
          await saveDriverActivities(userId, changeDriverActivity(log, "DRIVING", new Date(ts)));
        }
      }
    } else {
      detection.movingSince = null;
      if (detection.stoppedSince === null) detection.stoppedSince = ts;
      if (ts - detection.stoppedSince >= STOP_MS) {
        const log = await loadDriverActivities(userId, shiftId);
        const next = pauseDriverActivity(log, new Date(ts));
        if (next !== log) await saveDriverActivities(userId, next);
      }
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
  if (syncPending) await syncPending.catch(() => {});
  const run = (async () => {
    if (Platform.OS === "web" || !userId || !await isDrivingAutoStartEnabled(userId) ||
        !(await getJornadaAbierta())?.id) {
      await stopDrivingMonitoring();
      return;
    }
    const permissions = await Location.getForegroundPermissionsAsync();
    if (!permissions.granted) { await stopDrivingMonitoring(); return; }
    if (activeUser && activeUser !== userId) await stopDrivingMonitoring();
    activeUser = userId;
    const background = await Location.getBackgroundPermissionsAsync();
    if (background.granted && await TaskManager.isAvailableAsync()) {
      foreground?.remove();
      foreground = null;
      if (!await Location.hasStartedLocationUpdatesAsync(DRIVING_TASK)) {
        await Location.startLocationUpdatesAsync(DRIVING_TASK, {
          accuracy: Location.Accuracy.Balanced, timeInterval: 10000, distanceInterval: 10,
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
        foreground = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 10000, distanceInterval: 10 },
          fix => { void enqueue([fix]); },
        );
      } else if (AppState.currentState !== "active") {
        foreground?.remove();
        foreground = null;
      }
    }
  })();
  syncPending = run;
  try { await run; } finally { if (syncPending === run) syncPending = null; }
}
