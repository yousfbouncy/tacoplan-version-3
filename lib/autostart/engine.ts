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

// Señales de tramos SEPARADOS (no muestras repetidas del mismo desplazamiento).
// Primera detección >=15 s: propuesta manual. Si no se confirma, tras al menos
// tres tramos separados, el último continuo >=60 s, se permite autoconfirmar.
// Conservamos el inicio del primer tramo que cumpla la velocidad mínima.
export type AutoStartEvidence = {
  firstMovementAt: number;
  segments: number[];
  segmentStartAt: number | null;
  lastFixAt: number | null;
  autoConfirmed: boolean;
} | null;

export function advanceAutoStartEvidence(state: AutoStartEvidence, fix: Fix): {
  state: AutoStartEvidence; shouldAutoConfirm: boolean; shouldPrompt: boolean; startAt?: number;
} {
  if (!Number.isFinite(fix.timestamp)) return { state, shouldAutoConfirm: false, shouldPrompt: false };
  if (state?.lastFixAt != null && fix.timestamp <= state.lastFixAt)
    return { state, shouldAutoConfirm: false, shouldPrompt: false };
  const valid = typeof fix.coords.speed === "number" && Number.isFinite(fix.coords.speed) &&
    fix.coords.speed > MIN_SPEED_MPS && typeof fix.coords.accuracy === "number" &&
    Number.isFinite(fix.coords.accuracy) && fix.coords.accuracy <= MAX_ACCURACY_METERS;
  const expired = state != null && fix.timestamp - state.firstMovementAt > AUTO_CONFIRM_WINDOW_MS;
  const base = !state || expired ? {
    firstMovementAt: fix.timestamp, segments: [] as number[],
    segmentStartAt: null as number | null, lastFixAt: null as number | null, autoConfirmed: false,
  } : { ...state, segments: [...state.segments] };
  if (base.autoConfirmed) return { state: base, shouldAutoConfirm: false, shouldPrompt: false };
  const interrupted = base.lastFixAt != null && fix.timestamp - base.lastFixAt > MAX_SAMPLE_GAP_MS;
  if (!valid) {
    return { state: { ...base, segmentStartAt: null, lastFixAt: fix.timestamp }, shouldAutoConfirm: false, shouldPrompt: false };
  }
  const segmentStartAt = base.segmentStartAt == null || interrupted ? fix.timestamp : base.segmentStartAt;
  const elapsed = fix.timestamp - segmentStartAt;
  const isNewSegment = !base.segments.includes(segmentStartAt) && elapsed >= MIN_DURATION_MS;
  const segments = isNewSegment ? [...base.segments, segmentStartAt] : base.segments;
  const shouldPrompt = segments.length === 1 && isNewSegment;
  const shouldAutoConfirm = segments.length >= AUTO_CONFIRM_BURSTS &&
    elapsed >= AUTO_CONFIRM_LONG_MOVEMENT_MS;
  const firstMovementAt = segments[0] ?? base.firstMovementAt;
  return {
    state: { firstMovementAt, segments, segmentStartAt, lastFixAt: fix.timestamp, autoConfirmed: shouldAutoConfirm },
    shouldAutoConfirm, shouldPrompt, startAt: shouldAutoConfirm ? firstMovementAt : undefined,
  };
}
