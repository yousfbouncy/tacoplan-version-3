// Motor de detección: la velocidad proviene de GPS; los sensores sin GPS no miden km/h.
export const MIN_SPEED_MPS = 3 / 3.6;
export const MIN_DURATION_MS = 15_000;
export const MAX_SAMPLE_GAP_MS = 30_000;
export const MAX_ACCURACY_METERS = 50;
export const AUTO_CONFIRM_BURSTS = 3;
export const AUTO_CONFIRM_WINDOW_MS = 20 * 60_000;
export const AUTO_CONFIRM_LONG_MOVEMENT_MS = 60_000;

export type Fix = { timestamp: number; coords: { speed: number | null; accuracy: number | null } };
export type Candidate = { startedAt: number; lastAt: number } | null;
export function advanceCandidate(current: Candidate, fix: Fix): { candidate: Candidate; detectedAt?: number } {
  const { speed, accuracy } = fix.coords;
  const valid = typeof speed === "number" && Number.isFinite(speed) && speed > MIN_SPEED_MPS &&
    typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy <= MAX_ACCURACY_METERS;
  if (!valid || !Number.isFinite(fix.timestamp)) return { candidate: null };
  if (current && fix.timestamp <= current.lastAt) return { candidate: current };
  const candidate = !current || fix.timestamp - current.lastAt > MAX_SAMPLE_GAP_MS
    ? { startedAt: fix.timestamp, lastAt: fix.timestamp }
    : { ...current, lastAt: fix.timestamp };
  if (candidate.lastAt - candidate.startedAt >= MIN_DURATION_MS) return { candidate: null, detectedAt: candidate.startedAt };
  return { candidate };
}

// Tras la primera propuesta sin respuesta se conservan los movimientos válidos.
// Tres tramos detectados dentro de 20 minutos + movimiento continuo de 60 s
// autorizan una confirmación automática, con hora del PRIMER tramo válido.
export type AutoStartEvidence = {
  firstMovementAt: number;
  confirmedMovements: number[];
  continuousStartAt: number | null;
  lastFixAt: number | null;
  autoConfirmed: boolean;
} | null;
export function advanceAutoStartEvidence(state: AutoStartEvidence, fix: Fix): {
  state: AutoStartEvidence; shouldAutoConfirm: boolean; startAt?: number;
} {
  const { speed, accuracy } = fix.coords;
  const valid = Number.isFinite(fix.timestamp) &&
    typeof speed === "number" && Number.isFinite(speed) && speed > MIN_SPEED_MPS &&
    typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy <= MAX_ACCURACY_METERS;
  if (!valid) return { state: state ? { ...state, continuousStartAt: null, lastFixAt: fix.timestamp } : null, shouldAutoConfirm: false };
  if (state?.autoConfirmed || (state?.lastFixAt != null && fix.timestamp <= state.lastFixAt))
    return { state, shouldAutoConfirm: false };
  const fresh = !state || fix.timestamp - state.firstMovementAt > AUTO_CONFIRM_WINDOW_MS;
  const firstMovementAt = fresh ? fix.timestamp : state.firstMovementAt;
  const confirmedMovements = fresh ? [] : state.confirmedMovements.filter(t => t >= fix.timestamp - AUTO_CONFIRM_WINDOW_MS);
  const continuousStartAt = fresh || state?.continuousStartAt == null ||
    state.lastFixAt == null || fix.timestamp - state.lastFixAt > MAX_SAMPLE_GAP_MS
    ? fix.timestamp : state.continuousStartAt;
  const elapsed = fix.timestamp - continuousStartAt;
  // Cada 15 s de continuidad aporta una prueba; no supone que sean viajes distintos.
  const nextCount = Math.max(confirmedMovements.length, Math.floor(elapsed / MIN_DURATION_MS));
  while (confirmedMovements.length < nextCount) confirmedMovements.push(continuousStartAt + (confirmedMovements.length + 1) * MIN_DURATION_MS);
  const shouldAutoConfirm = confirmedMovements.length >= AUTO_CONFIRM_BURSTS &&
    elapsed >= AUTO_CONFIRM_LONG_MOVEMENT_MS;
  return {
    state: { firstMovementAt, confirmedMovements, continuousStartAt, lastFixAt: fix.timestamp, autoConfirmed: shouldAutoConfirm },
    shouldAutoConfirm,
    startAt: shouldAutoConfirm ? firstMovementAt : undefined,
  };
}
