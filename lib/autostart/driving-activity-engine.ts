/** GPS-triggered activity transitions during an already open shift.
 * A stop is immediate upon a reliable sample below 6 km/h.
 * Driving requires 60 seconds of reliable >=15 km/h samples; the
 * activity starts at the first confirmed movement timestamp.
 */
export const STOP_SPEED_MPS = 6 / 3.6;
export const START_SPEED_MPS = 15 / 3.6;
export const START_CONFIRM_MS = 60_000;
export const MAX_FIX_GAP_MS = 90_000;
export const MAX_GPS_ACCURACY_METERS = 75;

export type DrivingDetection = {
  movingSince: number | null;
  lastFix: number;
};
export type DrivingFix = { timestamp: number; coords: { speed: number | null; accuracy: number | null } };
export type DrivingUpdate = {
  state: DrivingDetection;
  transition: "REST" | "DRIVING" | null;
  movementStart?: number;
};

export function updateDrivingDetection(state: DrivingDetection, fix: DrivingFix): DrivingUpdate {
  const ts = fix.timestamp;
  if (!Number.isFinite(ts) || ts <= state.lastFix) return { state, transition: null };
  const speed = fix.coords.speed;
  const accuracy = fix.coords.accuracy;
  if (typeof speed !== "number" || !Number.isFinite(speed) || speed < 0 ||
      typeof accuracy !== "number" || !Number.isFinite(accuracy) ||
      accuracy > MAX_GPS_ACCURACY_METERS) {
    return { state: { lastFix: ts, movingSince: null }, transition: null };
  }
  if (speed < STOP_SPEED_MPS) {
    return { state: { lastFix: ts, movingSince: null }, transition: "REST" };
  }
  if (speed < START_SPEED_MPS) {
    // Hysteresis: do not toggle at 6–15 km/h. Wait for a real drive.
    return { state: { lastFix: ts, movingSince: null }, transition: null };
  }
  const movingSince = state.movingSince !== null &&
      ts - state.lastFix <= MAX_FIX_GAP_MS ? state.movingSince : ts;
  const confirmed = ts - movingSince >= START_CONFIRM_MS;
  return {
    state: { lastFix: ts, movingSince },
    transition: confirmed ? "DRIVING" : null,
    ...(confirmed ? { movementStart: movingSince } : {}),
  };
}
