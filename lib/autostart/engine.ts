export const MIN_SPEED_MPS = 2 / 3.6;
export const MIN_DURATION_MS = 2 * 1000;
export const MAX_SAMPLE_GAP_MS = 90 * 1000;
export const MAX_ACCURACY_METERS = 75;
export type Fix = { timestamp: number; coords: { speed: number | null; accuracy: number | null } };
export type Candidate = { startedAt: number; lastAt: number } | null;
export function advanceCandidate(current: Candidate, fix: Fix): { candidate: Candidate; detectedAt?: number } {
  const { speed, accuracy } = fix.coords;
  const good = typeof speed === "number" && Number.isFinite(speed) && speed >= MIN_SPEED_MPS &&
    typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy <= MAX_ACCURACY_METERS;
  if (!good || !Number.isFinite(fix.timestamp)) return { candidate: null };
  if (current && fix.timestamp <= current.lastAt) return { candidate: current };
  const candidate = !current || fix.timestamp - current.lastAt > MAX_SAMPLE_GAP_MS
    ? { startedAt: fix.timestamp, lastAt: fix.timestamp }
    : { ...current, lastAt: fix.timestamp };
  if (candidate.lastAt - candidate.startedAt >= MIN_DURATION_MS) return { candidate: null, detectedAt: candidate.startedAt };
  return { candidate };
}
