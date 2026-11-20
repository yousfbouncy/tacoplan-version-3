import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Platform } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { getJornadaAbierta } from "@/lib/local-storage";
import { changeDriverActivity, loadDriverActivities, pauseDriverActivity, saveDriverActivities } from "@/lib/driver-activities";
import {canRunPaidAutomation} from "@/lib/paid-automation-access";

export const DRIVING_TASK = "tacoplan-driving-activity-v1";
const PREF_PREFIX = "@tacoplan/driving-autostart/v1:";
const OWNER_KEY = "@tacoplan/driving-autostart/active-owner";
const PENDING_STOP_PREFIX = "@tacoplan/driving-autostart/pending-stop/v1:";
const MIN_SPEED = 6 / 3.6;
const STOP_SPEED = 1 / 3.6;
const CONFIRM_MS = 60_000;
const STOP_MS = 60_000;
const MAX_GAP_MS = 90_000;
type Fix = Location.LocationObject;
type Detection = { userId: string; shiftId: string; movingSince: number | null; slowSince: number | null; stoppedSince: number | null; lastFix: number };
let detection: Detection | null = null;
let foreground: Location.LocationSubscription | null = null;
let activeUser: string | null = null;
let pending = Promise.resolve();
let syncPending: Promise<void> | null = null;

const prefKey = (userId: string) => PREF_PREFIX + userId;
const pendingStopKey = (userId: string, shiftId: string) =>
  PENDING_STOP_PREFIX + userId + ":" + shiftId;
type PendingStop = { stoppedSince: number; lastFix: number };

// Exclude stationary time from live counters while keeping DRIVING selected
// until a continuous one-minute stop is confirmed; never invent REST time.
export async function readPendingDrivingStop(userId: string, shiftId: string): Promise<PendingStop | null> {
  try {
    const raw = await AsyncStorage.getItem(pendingStopKey(userId, shiftId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingStop>;
    if (!Number.isFinite(value.stoppedSince) || !Number.isFinite(value.lastFix)) return null;
    const stoppedSince = Number(value.stoppedSince);
    const lastFix = Number(value.lastFix);
    if (lastFix < stoppedSince || Date.now() - lastFix > MAX_GAP_MS || stoppedSince > Date.now()) return null;
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
    detection = { userId, shiftId, movingSince: null, slowSince: null, stoppedSince: null, lastFix: 0 };
    await clearPendingDrivingStop(userId, shiftId).catch(() => {});
  }
  for (const fix of fixes.slice().sort((a, b) => a.timestamp - b.timestamp)) {
    const ts = fix.timestamp;
    if (!Number.isFinite(ts) || ts <= detection.lastFix) continue;
    const previousFix = detection.lastFix;
    detection.lastFix = ts;
    if (previousFix && ts - previousFix > MAX_GAP_MS) {
      // Do not infer a full minute of stationary time from missing GPS samples.
      detection.movingSince = null;
      detection.slowSince = null;
      detection.stoppedSince = null;
      await clearPendingDrivingStop(userId, shiftId).catch(() => {});
    }
    const speed = fix.coords.speed;
    const accuracy = fix.coords.accuracy;
    const good = typeof speed === "number" && Number.isFinite(speed) && speed >= 0 &&
      typeof accuracy === "number" && Number.isFinite(accuracy) &&
      accuracy >= 0 && accuracy <= 75;
    if (!good) {
      // An unreliable fix cannot confirm a stop or a restart.
      detection.movingSince = null;
      detection.slowSince = null;
      detection.stoppedSince = null;
      await clearPendingDrivingStop(userId, shiftId).catch(() => {});
      continue;
    }
    if (speed < STOP_SPEED) {
      detection.movingSince = null;
      detection.slowSince = null;
      if (detection.stoppedSince === null) detection.stoppedSince = ts;
      // The counter stops at the first reliable stationary sample, without
      // closing the driving segment before the full minute is confirmed.
      if (ts - detection.stoppedSince < STOP_MS) {
        const log = await loadDriverActivities(userId, shiftId);
        if (log.segments.findLast(seg => seg.endedAt === null)?.type === "DRIVING") {
          await AsyncStorage.setItem(pendingStopKey(userId, shiftId),
            JSON.stringify({ stoppedSince: detection.stoppedSince, lastFix: ts } satisfies PendingStop));
        }
      }
      // Keep DRIVING selected during the first minute; only then close the
      // driving segment retroactively at the FIRST stationary GPS fix.
      if (ts - detection.stoppedSince >= STOP_MS) {
        const log = await loadDriverActivities(userId, shiftId);
        const active = log.segments.findLast(seg => seg.endedAt === null);
        if (active?.type !== "DRIVING") continue;
        const startedAt = Date.parse(active.startedAt);
        const pauseAt = new Date(Math.max(detection.stoppedSince, startedAt));
        const next = pauseDriverActivity(log, pauseAt);
        if (next !== log) await saveDriverActivities(userId, next);
        await clearPendingDrivingStop(userId, shiftId).catch(() => {});
      }
      continue;
    }

    // Above 1 km/h before the minute has elapsed: keep driving selected but
    // subtract the COMPLETE short stop (even 20 s) from the driving total.
    // The gap stays unclassified; it is not a legal REST activity.
    const stoppedSince = detection.stoppedSince;
    detection.stoppedSince = null;
    if (stoppedSince !== null) await clearPendingDrivingStop(userId, shiftId).catch(() => {});
    if (stoppedSince !== null && ts - stoppedSince >= STOP_MS) {
      // A stationary fix may be followed by the first moving fix after the
      // full minute; honor the original stop timestamp, not the restart time.
      const log = await loadDriverActivities(userId, shiftId);
      const active = log.segments.findLast(seg => seg.endedAt === null);
      if (active?.type === "DRIVING") {
        const next = pauseDriverActivity(log, new Date(Math.max(stoppedSince, Date.parse(active.startedAt))));
        if (next !== log) await saveDriverActivities(userId, next);
      }
    }
    if (stoppedSince !== null && ts - stoppedSince < STOP_MS) {
      const log = await loadDriverActivities(userId, shiftId);
      const active = log.segments.findLast(seg => seg.endedAt === null);
      if (active?.type === "DRIVING") {
        const endAt = Math.max(stoppedSince, Date.parse(active.startedAt));
        if (ts > endAt) {
          const paused = pauseDriverActivity(log, new Date(endAt));
          const resumed = changeDriverActivity(paused, "DRIVING", new Date(ts));
          if (resumed !== log) await saveDriverActivities(userId, resumed);
        }
        detection.movingSince = null;
        detection.slowSince = null;
        continue;
      }
    }

    // Keep the earliest reliable low-speed maneuver (above 1 km/h).
    // The 60-second confirmation starts only after first reaching 6 km/h.
    // STOP and short-stop RESUME handling above must remain unchanged.
    if (detection.slowSince === null) detection.slowSince = ts;
    if (speed >= MIN_SPEED) {
      if (detection.movingSince === null) detection.movingSince = ts;
      if (ts - detection.movingSince >= CONFIRM_MS) {
        const log = await loadDriverActivities(userId, shiftId);
        if (log.segments.findLast(seg => seg.endedAt === null)?.type !== "DRIVING") {
          const currentStart = log.segments.findLast(seg => seg.endedAt === null)?.startedAt;
          const effectiveStart = Math.max(detection.slowSince ?? detection.movingSince, currentStart ? Date.parse(currentStart) : 0);
          const next = changeDriverActivity(log, "DRIVING", new Date(effectiveStart));
          if (next !== log) await saveDriverActivities(userId, next);
        }
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
      if (!await Location.hasStartedLocationUpdatesAsync(DRIVING_TASK)) {
        await Location.startLocationUpdatesAsync(DRIVING_TASK, {
          accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 0,
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
          { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 0 },
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
