/** Driving AutoStart GPS policy shared by Android and iOS.
 * A reliable fix below 6 km/h begins a candidate stop. Stop is confirmed
 * after >=60 seconds, backdated to that first fix. A shorter stop is removed
 * from driving totals without losing the active DRIVING selection.
 * New DRIVING requires 60 seconds of reliable movement and a fix >=6 km/h.
 * Movement at or above 6 km/h before confirmation is retained.
 */
export const STOP_SPEED_MPS = 6 / 3.6;
export const START_SPEED_MPS = 6 / 3.6;
export const START_CONFIRM_MS = 60_000;
export const STOP_CONFIRM_MS = 60_000;
export const MAX_FIX_GAP_MS = 90_000;
export const MAX_GPS_ACCURACY_METERS = 75;

export type DrivingDetection = {
  movingSince: number | null;
  slowSince?: number | null;
  stoppedSince?: number | null;
  lastFix: number;
};
export type DrivingFix = { timestamp: number; coords: { speed: number | null; accuracy: number | null } };
export type DrivingUpdate = {
  state: DrivingDetection;
  transition: "STOP" | "RESUME" | "DRIVING" | null;
  movementStart?: number;
  stopStart?: number;
};

export function updateDrivingDetection(state: DrivingDetection, fix: DrivingFix): DrivingUpdate {
  const ts = fix.timestamp;
  if (!Number.isFinite(ts) || ts <= state.lastFix) return { state, transition: null };
  const speed = fix.coords.speed;
  const accuracy = fix.coords.accuracy;
  const interrupted = state.lastFix > 0 && ts - state.lastFix > MAX_FIX_GAP_MS;
  const stoppedSince = interrupted ? null : (state.stoppedSince ?? null);
  if (typeof speed !== "number" || !Number.isFinite(speed) || speed < 0 ||
      typeof accuracy !== "number" || !Number.isFinite(accuracy) ||
      accuracy < 0 || accuracy > MAX_GPS_ACCURACY_METERS) {
    // Invalid/old GPS must never create a fictitious stop.
    return { state: { lastFix: ts, movingSince: null, slowSince: null, stoppedSince: null }, transition: null };
  }
  if (speed < STOP_SPEED_MPS) {
    const first = stoppedSince ?? ts;
    const confirmed = ts - first >= STOP_CONFIRM_MS;
    return {
      state: { lastFix: ts, movingSince: null, slowSince: null, stoppedSince: first },
      transition: confirmed && stoppedSince !== null ? "STOP" : null,
      ...(confirmed && stoppedSince !== null ? { stopStart: first } : {}),
    };
  }
  if (stoppedSince !== null) {
    const elapsed = ts - stoppedSince;
    if (elapsed < STOP_CONFIRM_MS) {
      return {
        state: { lastFix: ts, movingSince: speed >= START_SPEED_MPS ? ts : null, slowSince: ts, stoppedSince: null },
        transition: "RESUME", stopStart: stoppedSince,
      };
    }
    // A moving fix after a minute of stationary samples is also enough
    // to close DRIVING at the timestamp where the stop was first observed.
    return {
      state: { lastFix: ts, movingSince: speed >= START_SPEED_MPS ? ts : null, slowSince: ts, stoppedSince: null },
      transition: "STOP", stopStart: stoppedSince,
    };
  }
  // Require 60 seconds of reliable movement at or above 6 km/h.
  // Speeds below 6 km/h count toward a possible stop, not active driving.
  const slowSince = !interrupted && state.slowSince != null ? state.slowSince : ts;
  const movingSince = !interrupted && state.movingSince !== null
    ? state.movingSince : speed >= START_SPEED_MPS ? ts : null;
  const confirmed = movingSince !== null &&
    speed >= START_SPEED_MPS && ts - movingSince >= START_CONFIRM_MS;
  return {
    state: { lastFix: ts, movingSince, slowSince, stoppedSince: null },
    transition: confirmed ? "DRIVING" : null,
    ...(confirmed ? { movementStart: slowSince } : {}),
  };
}
