/**
 * A conservative rule for automatically proposing a 60% arrival-day diet.
 * The original journey's diet (100%) remains attached to its start date.
 * This is a configurable product policy, not a statutory entitlement.
 */
export type ArrivalJourneyEvidence = {
  startDate: string; endDate: string; startTime?: string | null;
  endTime?: string | null; startAt: string; endAt?: string | null;
  isInternational: boolean; startsAwayFromBase: boolean;
  endsAtBase: boolean; startDayPercentage: number | null;
};

export function automaticReturnToBasePercentage(
  j: ArrivalJourneyEvidence
): 60 | null {
  const start = Date.parse(j.startAt || "");
  const end = Date.parse(j.endAt || "");
  const durationMin = (end - start) / 60000;
  const time = j.endTime || j.endAt?.slice(11,16) || "";
  const hhmm = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time.slice(0,5));
  if (!hhmm || !Number.isFinite(durationMin)) return null;
  if (!j.isInternational || !j.startsAwayFromBase || !j.endsAtBase) return null;
  if (j.startDayPercentage !== 100) return null;
  if (j.startDate >= j.endDate) return null;
  // The automatic rule covers one overnight driving/work period, not an
  // unverified multiday trip or a very brief midnight crossing.
  const startUtc = Date.parse(j.startDate + "T00:00:00");
  const endUtc = Date.parse(j.endDate + "T00:00:00");
  if (endUtc - startUtc !== 86400000) return null;
  if (durationMin < 8 * 60 || durationMin > 24 * 60) return null;
  const endMin = Number(hhmm[1]) * 60 + Number(hhmm[2]);
  if (endMin >= 12 * 60) return null;
  return 60;
}

export function isAutomaticNaturalDietId(id: string): boolean {
  return id.startsWith("auto_arrival_") || id.startsWith("auto_oob_");
}
