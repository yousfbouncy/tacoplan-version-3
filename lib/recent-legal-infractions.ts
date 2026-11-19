import { supabase } from "@/lib/supabase";

export type RecentLegalInfraction = {
  jornada_id: string;
  occurred_on: string;
  code: string;
  severity: string;
  description: string;
  incident_index: number;
};

export function isRecentLegalInfraction(
  value: Pick<RecentLegalInfraction, "occurred_on">,
  now = new Date(),
): boolean {
  // Date-only timestamps avoid confusing a journey's creation/edit date with
  // the actual date when the infraction occurred.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.occurred_on)) return false;
  const day = Date.parse(value.occurred_on + "T00:00:00Z");
  if (!Number.isFinite(day)) return false;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const ageDays = Math.round((today - day) / 86_400_000);
  return ageDays >= 0 && ageDays <= 56;
}

export function filterRecentLegalInfractions(
  values: RecentLegalInfraction[],
  now = new Date(),
): RecentLegalInfraction[] {
  const seen = new Set<string>();
  return values.filter(value => {
    if (!isRecentLegalInfraction(value, now)) return false;
    const key = [value.jornada_id, value.incident_index, value.code].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The stored legal_summary field of the original jornada is the single source
 * of truth in Supabase. The RPC is authenticated, respects journey RLS, and
 * returns only the last 56 days, without deleting older historical records.
 */
export async function fetchRecentLegalInfractions(): Promise<RecentLegalInfraction[]> {
  const { data, error } = await supabase.rpc("tacoplan_recent_legal_infractions");
  if (error) throw error;
  return filterRecentLegalInfractions((data ?? []) as RecentLegalInfraction[]);
}
