/**
 * A working-time segment can be closed without ending the driver's legal
 * driving/rest cycle. Never mutate or combine segment IDs to find the cycle.
 * A gap under 9 consecutive hours cannot by itself be a completed daily rest.
 * A >=9h gap is only a candidate legal reset: entitlement to reduced rests,
 * split rests and other restrictions remain the legal engine's responsibility.
 */
export type TimedShift = { id: string; startAt: string; endAt?: string | null };

const REST_MINIMUM_MS = 9 * 60 * 60 * 1000;
const WINDOW_MS = 56 * 24 * 60 * 60 * 1000;

function ms(value: string | null | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/**
 * Returns the original start of the current period when successive recorded
 * working segments are separated by less than 9 hours.
 * Unknown or overlapping records never reset the cycle.
 */
export function legalPeriodStartAt(shifts: TimedShift[], currentId: string): string | null {
  const ordered = shifts.filter(s => ms(s.startAt) !== null)
    .sort((a,b) => ms(a.startAt)! - ms(b.startAt)!);
  let index = ordered.findIndex(s => s.id === currentId);
  if (index < 0) return null;
  let earliest = ordered[index].startAt;
  while (index > 0) {
    const prev = ordered[index - 1];
    const previousEnd = ms(prev.endAt);
    const nextStart = ms(ordered[index].startAt)!;
    // If prior end is not known, continuity is uncertain: keep the earlier
    // start instead of incorrectly presenting a fresh legal allowance.
    if (previousEnd !== null && nextStart - previousEnd >= REST_MINIMUM_MS) break;
    earliest = prev.startAt;
    index--;
  }
  return earliest;
}

/** Interval overlap, not "two records on the same calendar day". */
export function overlappingShiftPairs(shifts: TimedShift[], now = Date.now()): [string,string][] {
  const rows = shifts.map(s => ({ id:s.id,start:ms(s.startAt),end:ms(s.endAt) }))
    .filter((s): s is {id:string;start:number;end:number|null} =>
      s.start !== null && s.start >= now - WINDOW_MS)
    .sort((a,b) => a.start - b.start);
  const conflicts: [string,string][] = [];
  for (let i=0;i<rows.length;i++) {
    for (let j=i+1;j<rows.length;j++) {
      const a=rows[i],b=rows[j];
      const aEnd=a.end ?? now;
      if (b.start >= aEnd) break;
      if (a.id !== b.id && b.start < aEnd && a.start < (b.end ?? now)) {
        conflicts.push([a.id,b.id]);
      }
    }
  }
  return conflicts;
}
