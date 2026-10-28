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
  const sorted = [...jornadas].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
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
      if (!Number.isFinite(gap) || gap < 9 * 60) { known = false; break; }
      if (gap >= 24 * 60) { known = true; used = 0; }
      else if (gap >= 9 * 60 && gap < 11 * 60 && !isSplitDailyRestGapComplete(gap, previous)) used++;
    }
    if (j.endAt && (!Number.isFinite(Date.parse(j.endAt)) || Date.parse(j.endAt) <= Date.parse(j.startAt))) {
      known = false;
      break;
    }
    previous = j;
  }
  known = known && !!current && sorted.at(-1) === current;
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
