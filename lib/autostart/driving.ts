import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Platform } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { getJornadaAbierta } from "@/lib/local-storage";
import { changeDriverActivity, loadDriverActivities, pauseDriverActivity, saveDriverActivities } from "@/lib/driver-activities";
import { updateDrivingDetection, type DrivingDetection } from "./driving-activity-engine";
import {canRunPaidAutomation} from "@/lib/paid-automation-access";

export const DRIVING_TASK = "tacoplan-driving-activity-v1";
const PREF_PREFIX = "@tacoplan/driving-autostart/v1:";
const OWNER_KEY = "@tacoplan/driving-autostart/active-owner";
const PENDING_STOP_PREFIX = "@tacoplan/driving-autostart/pending-stop/v1:";
type Fix = Location.LocationObject;
type Detection = DrivingDetection & { userId: string; shiftId: string };
let detection: Detection | null = null;
let foreground: Location.LocationSubscription | null = null;
let activeUser: string | null = null;
let pending = Promise.resolve();
let syncPending: Promise<void> | null = null;

const prefKey = (userId: string) => PREF_PREFIX + userId;
const pendingStopKey = (userId: string, shiftId: string) =>
  PENDING_STOP_PREFIX + userId + ":" + shiftId;
type PendingStop = { stoppedSince: number; lastFix: number };

export async function readPendingDrivingStop(userId: string, shiftId: string): Promise<PendingStop | null> {
  try {
    const raw = await AsyncStorage.getItem(pendingStopKey(userId, shiftId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingStop>;
    if (!Number.isFinite(value.stoppedSince) || !Number.isFinite(value.lastFix)) return null;
    const stoppedSince = Number(value.stoppedSince);
    const lastFix = Number(value.lastFix);
    if (lastFix < stoppedSince || Date.now() - lastFix > 90_000 || stoppedSince > Date.now()) return null;
    return { stoppedSince, lastFix };
  } catch { return null; }
}
async function clearPendingDrivingStop(userId: string, shiftId: string): Promise<void> {
  await AsyncStorage.removeItem(pendingStopKey(userId, shiftId));
}
export async function isDrivingAutoStartEnabled(userId: string): Promise<boolean> {
  return (await AsyncStorage.getItem(prefKey(userId))) === "true";
}
export async function setDrivingAutoStartEnabled(userId: string, enabled: boolean): Promise<void> {
  if(enabled && !(await canRunPaidAutomation(userId)))throw new Error("Conducción automática requiere Plus o Pro.");
  await AsyncStorage.setItem(prefKey(userId), String(enabled));
  if (enabled) await AsyncStorage.setItem(OWNER_KEY, userId);
  else if ((await AsyncStorage.getItem(OWNER_KEY)) === userId) await AsyncStorage.removeItem(OWNER_KEY);
  await syncDrivingMonitoring(userId);
}
function clearDetection() { detection = null; }
async function handleFixes(fixes: Fix[]): Promise<void> {
  const owner = activeUser || await AsyncStorage.getItem(OWNER_KEY);
  if (!owner || !await isDrivingAutoStartEnabled(owner)) return;
  if (!(await canRunPaidAutomation(owner))) { await stopDrivingMonitoring(); return; }
  const shift = await getJornadaAbierta();
  if (!shift?.id) { clearDetection(); return; }
  const userId = owner;
  const shiftId = String(shift.id);
  if (!detection || detection.userId !== userId || detection.shiftId !== shiftId) {
    detection = { userId, shiftId, movingSince: null, stoppedSince: null, lastFix: 0 };
    await clearPendingDrivingStop(userId, shiftId).catch(() => {});
  }
  for (const fix of fixes.slice().sort((a, b) => a.timestamp - b.timestamp)) {
    const previous: DrivingDetection = detection!;
    const result = updateDrivingDetection(previous, fix);
    if (result.state === previous) continue;
    detection = { ...result.state, userId, shiftId };
    // Keep driving selected during an unconfirmed GPS stop, but remove all
    // stationary seconds from the live counter from the first valid fix.
    const stopStart = result.state.stoppedSince ?? null;
    if (stopStart !== null && !result.transition && fix.timestamp - stopStart < 60_000) {
      const log = await loadDriverActivities(userId, shiftId);
      if (log.segments.findLast(seg => seg.endedAt === null)?.type === "DRIVING") {
        await AsyncStorage.setItem(pendingStopKey(userId, shiftId),
          JSON.stringify({ stoppedSince: stopStart, lastFix: fix.timestamp } satisfies PendingStop));
      }
    } else {
      await clearPendingDrivingStop(userId, shiftId).catch(() => {});
    }
    if (!result.transition) continue;

    const log = await loadDriverActivities(userId, shiftId);
    const active = log.segments.findLast(s => s.endedAt === null);
    if (result.transition === "STOP") {
      // A full minute at <1 km/h. Close the driving segment at the FIRST
      // stationary GPS fix, not after the confirmation delay. A stop never
      // creates a legal REST activity on its own.
      if (active?.type !== "DRIVING") continue;
      const effectiveTime = new Date(Math.max(result.stopStart ?? fix.timestamp, Date.parse(active.startedAt)));
      const next = pauseDriverActivity(log, effectiveTime);
      if (next !== log) await saveDriverActivities(userId, next);
      continue;
    }

    if (result.transition === "RESUME") {
      // The vehicle moved again in <60 s. Keep DRIVING active, but exclude
      // every stationary second by splitting the DRIVING segment around it.
      if (active?.type !== "DRIVING") continue;
      const stopTime = Math.max(result.stopStart ?? fix.timestamp, Date.parse(active.startedAt));
      if (fix.timestamp <= stopTime) continue;
      const paused = pauseDriverActivity(log, new Date(stopTime));
      const resumed = changeDriverActivity(paused, "DRIVING", new Date(fix.timestamp));
      if (resumed !== log) await saveDriverActivities(userId, resumed);
      continue;
    }

    // After 60 seconds at >=15 km/h, start driving from the first moving fix.
    // Backdate the activity switch to the first confirmed moving fix so a
    // short GPS confirmation delay does not falsely count as a rest.
    if (active?.type === "DRIVING") continue;
    const movementStart = result.movementStart ?? fix.timestamp;
    const earliest = active ? Date.parse(active.startedAt) : 0;
    const next = changeDriverActivity(log, "DRIVING", new Date(Math.max(movementStart, earliest)));
    if (next !== log) await saveDriverActivities(userId, next);
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
  if (detection) await clearPendingDrivingStop(detection.userId, detection.shiftId).catch(() => {});
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
        !(await canRunPaidAutomation(userId)) ||
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
      // Re-register an existing background task once after this update:
      // the previous APK may still have 10s/10m location options.
      const configKey = "@tacoplan/driving-autostart/location-config-v2";
      const started = await Location.hasStartedLocationUpdatesAsync(DRIVING_TASK);
      const currentConfig = await AsyncStorage.getItem(configKey);
      if (started && currentConfig !== "high-accuracy-v2") {
        await Location.stopLocationUpdatesAsync(DRIVING_TASK);
      }
      if (!await Location.hasStartedLocationUpdatesAsync(DRIVING_TASK)) {
        await Location.startLocationUpdatesAsync(DRIVING_TASK, {
          accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 0,
          activityType: Location.ActivityType.AutomotiveNavigation,
          foregroundService: { notificationTitle: "Tacoplan · Conducción automática",
            notificationBody: "Detectando conducción durante la jornada" },
          pausesUpdatesAutomatically: false,
        });
        await AsyncStorage.setItem(configKey, "high-accuracy-v2");
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
