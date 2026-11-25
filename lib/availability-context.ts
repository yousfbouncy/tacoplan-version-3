import type { Jornada } from "./local-storage";
import { crearAvisosAmplitud, type Ampliacion15h } from "./alertasDisponibilidad";
import { isSplitDailyRestGapComplete } from "./legalEngine";

export interface AvailabilityContext {
  shiftId: string | null;
  ampliacion15h: Ampliacion15h;
  reducidosUsados: number;
  ampliacionesDisponibles: number | null;
  aplica13h15h: boolean;
}

/** Counts observed rests in the current cycle, including the rest before the open shift.
 * An absent cycle boundary or inconsistent history is uncertainty, never zero usage.
 * This is evidence from recorded shifts, not certification of unrecorded activity.
 */
export function getAvailabilityContext(jornadas: Jornada[]): AvailabilityContext {
  const ordered = [...jornadas].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  // Start at the latest observed weekly-rest boundary. An invalid older record
  // cannot invalidate a subsequent, complete weekly rest and its new cycle.
  let anchor = 0;
  for (let i = 1; i < ordered.length; i++) {
    const gap = Date.parse(ordered[i].startAt) - Date.parse(ordered[i-1].endAt || "");
    if (Number.isFinite(gap) && gap >= 24 * 3600000) anchor = i - 1;
  }
  const sorted = ordered.slice(anchor);
  const open = sorted.filter(j => !j.fechaFin && !j.endAt);
  const current = open.length === 1 ? open[0] : null;
  let known = false;
  let used = 0;
  const seen = new Set<string>();
  let previous: Jornada | undefined;
  for (const j of sorted) {
    if (seen.has(j.id) || !Number.isFinite(Date.parse(j.startAt))) {
      known = false;
      break;
    }
    seen.add(j.id);
    if (previous) {
      const gap = (Date.parse(j.startAt) - Date.parse(previous.endAt || "")) / 60000;
      // A short interruption resumes the same legal period; it is not
      // a completed daily rest and must not reset or consume an extension.
      if (!Number.isFinite(gap) || gap < 0) { known = false; break; }
      // Continue the same legal period, but do not certify extension eligibility
      // until a later qualifying daily/weekly rest establishes a safe boundary.
      if (gap < 9 * 60) known = false;
      if (gap >= 24 * 60) { known = true; used = 0; }
      else if (gap >= 9 * 60 && gap < 11 * 60 && !isSplitDailyRestGapComplete(gap, previous)) used++;
    }
    if (j.endAt && (!Number.isFinite(Date.parse(j.endAt)) || Date.parse(j.endAt) <= Date.parse(j.startAt))) {
      known = false;
      break;
    }
    previous = j;
  }
  // A completed shift still has a known rest count; alarms require a matched open shift separately.
  known = known && (open.length === 0 || (!!current && sorted.at(-1) === current));
  const remaining = known ? Math.max(0, 3 - used) : null;
  // A recorded first split-rest part does not establish all conditions for 3+9.
  const splitUncertain = (current?.splitRestFirstPartMin ?? 0) >= 180;
  return {
    shiftId: current?.id ?? null,
    reducidosUsados: used,
    ampliacionesDisponibles: remaining,
    aplica13h15h: !current?.isDoubleDriving,
    ampliacion15h: remaining === null || (remaining === 0 && splitUncertain)
      ? "desconocida" : remaining > 0 ? "disponible" : "agotada",
  };
}

export type AlarmShift = {
  id: string; fechaInicio: string; horaInicio: string;
  startAt?: string; fin?: string | null; fechaFin?: string | null; endAt?: string | null;
};

/** Shared adapter used by manual start and AutoStart; stale counters are unknown. */
export function planAvailabilityAlarms(shift: AlarmShift | null, context: AvailabilityContext | undefined, enabled: boolean, now = Date.now()) {
  if (!enabled || !shift || shift.fin || shift.fechaFin || shift.endAt) return [];
  const matched = context?.shiftId === shift.id ? context : undefined;
  if (matched && !matched.aplica13h15h) return [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(shift.fechaInicio) || !/^\d{2}:\d{2}(:\d{2})?$/.test(shift.horaInicio)) return [];
  const start = new Date(shift.startAt ?? `${shift.fechaInicio}T${shift.horaInicio.length === 5 ? shift.horaInicio + ":00" : shift.horaInicio}`);
  if (!Number.isFinite(start.getTime())) return [];
  return crearAvisosAmplitud({ id: shift.id, inicio: start.toISOString(), ampliacion15h: matched?.ampliacion15h ?? "desconocida" }, now);
}
