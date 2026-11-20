/** Driving AutoStart GPS policy shared by Android and iOS.
 * A reliable fix below 1 km/h begins a candidate stop. Stop is confirmed
 * after >=60 seconds, backdated to that first fix. A shorter stop is removed
 * from driving totals without losing the active DRIVING selection.
 * New DRIVING requires 60 seconds of reliable movement and a fix >=6 km/h.
 * Slow movement above 1 km/h preceding confirmation is retained, so short
 * low-speed maneuvers are not discarded from the start of driving.
 */
export const STOP_SPEED_MPS = 1 / 3.6;
export const START_SPEED_MPS = 6 / 3.6;
export const START_CONFIRM_MS = 60_000;
export const STOP_CONFIRM_MS = 60_000;
export const MAX_FIX_GAP_MS = 90_000;
export const MAX_GPS_ACCURACY_METERS = 75;

export type DrivingDetection = {
  movingSince: number | null;
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
    return { state: { lastFix: ts, movingSince: null, stoppedSince: null }, transition: null };
  }
  if (speed < STOP_SPEED_MPS) {
    const first = stoppedSince ?? ts;
    const confirmed = ts - first >= STOP_CONFIRM_MS;
    return {
      state: { lastFix: ts, movingSince: null, stoppedSince: first },
      transition: confirmed && stoppedSince !== null ? "STOP" : null,
      ...(confirmed && stoppedSince !== null ? { stopStart: first } : {}),
    };
  }
  if (stoppedSince !== null) {
    const elapsed = ts - stoppedSince;
    if (elapsed < STOP_CONFIRM_MS) {
      return {
        state: { lastFix: ts, movingSince: null, stoppedSince: null },
        transition: "RESUME", stopStart: stoppedSince,
      };
    }
    // A moving fix after a minute of stationary samples is also enough
    // to close DRIVING at the timestamp where the stop was first observed.
    return {
      state: { lastFix: ts, movingSince: speed >= START_SPEED_MPS ? ts : null, stoppedSince: null },
      transition: "STOP", stopStart: stoppedSince,
    };
  }
  // Remember initial slow movement (1–6 km/h) and only commit a new
  // DRIVING segment after one minute of reliable movement reaching 6 km/h.
  // The <1 km/h stop branch above and all RESUME handling remain unchanged.
  const movingSince = state.movingSince !== null &&
      !interrupted ? state.movingSince : ts;
  const confirmed = speed >= START_SPEED_MPS && ts - movingSince >= START_CONFIRM_MS;
  return {
    state: { lastFix: ts, movingSince, stoppedSince: null },
    transition: confirmed ? "DRIVING" : null,
    ...(confirmed ? { movementStart: movingSince } : {}),
  };
}
