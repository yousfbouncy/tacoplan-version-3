export const MIN_SPEED_MPS = 2 / 3.6;
export const MIN_DURATION_MS = 2 * 1000;
export const MAX_SAMPLE_GAP_MS = 90 * 1000;
export const MAX_ACCURACY_METERS = 75;
export const AUTO_CONFIRM_WINDOW_MS = 20 * 60 * 1000;
export const AUTO_CONFIRM_MIN_SEGMENTS = 3;
export const AUTO_CONFIRM_LONG_SEGMENT_MS = 60 * 1000;
export type Fix = { timestamp: number; coords: { speed: number | null; accuracy: number | null } };
export type Candidate = { startedAt: number; lastAt: number } | null;
export type MovementSegment = { startedAt: number; durationMs: number };
export function advanceCandidate(current: Candidate, fix: Fix): { candidate: Candidate; segment?: MovementSegment } {
  const { speed, accuracy } = fix.coords;
  const good = typeof speed === "number" && Number.isFinite(speed) && speed >= MIN_SPEED_MPS &&
    typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy <= MAX_ACCURACY_METERS;
  if (!Number.isFinite(fix.timestamp)) return { candidate: current };
  if (current && fix.timestamp <= current.lastAt) return { candidate: current };
  if (!good) {
    const endedAt = current ? Math.min(fix.timestamp, current.lastAt + MAX_SAMPLE_GAP_MS) : 0;
    const durationMs = current ? endedAt - current.startedAt : 0;
    return { candidate: null, ...(durationMs >= MIN_DURATION_MS ? { segment: { startedAt: current!.startedAt, durationMs } } : {}) };
  }
  if (!current) return { candidate: { startedAt: fix.timestamp, lastAt: fix.timestamp } };
  if (fix.timestamp - current.lastAt > MAX_SAMPLE_GAP_MS) {
    const durationMs = current.lastAt - current.startedAt;
    return {
      candidate: { startedAt: fix.timestamp, lastAt: fix.timestamp },
      ...(durationMs >= MIN_DURATION_MS ? { segment: { startedAt: current.startedAt, durationMs } } : {}),
    };
  }
  return { candidate: { ...current, lastAt: fix.timestamp } };
}

export function shouldAutoConfirm(segments: MovementSegment[], now: number): boolean {
  const recent = segments.filter((s) => Number.isFinite(s.startedAt) && Number.isFinite(s.durationMs) &&
    s.durationMs >= MIN_DURATION_MS && now >= s.startedAt && now - s.startedAt <= AUTO_CONFIRM_WINDOW_MS);
  return recent.length >= AUTO_CONFIRM_MIN_SEGMENTS && recent.some((s) => s.durationMs >= AUTO_CONFIRM_LONG_SEGMENT_MS);
}
