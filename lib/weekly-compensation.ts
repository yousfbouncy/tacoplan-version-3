/** Motor de compensaciones. Minutos enteros, 1 deuda por DSR. */
export type RestCompensationKind = "weekly_reduced" | "weekly_normal" | "daily";
export type CompensationDebt = { id: string; min: number; deadline?: string; sourceEndAt?: string | null };

export function weeklyReductionDebtMin(restMin: number): number {
  return Number.isFinite(restMin) && restMin >= 24 * 60 && restMin < 45 * 60
    ? 45 * 60 - Math.floor(restMin)
    : 0;
}

/**
 * Usa el tipo REAL de descanso, no sólo las horas.
 * Así un bloque de 24 h clasificado como diario puede aportar 13 h
 * con base 11, pero un DSR de 24-44 h nunca paga deuda antigua.
 */
export function automaticCompensationCapacityMin(
  restMin: number,
  options: { kind?: RestCompensationKind; dailyBaseMin?: 540 | 660 } = {},
): number {
  if (!Number.isFinite(restMin) || restMin < 9 * 60) return 0;
  const kind = options.kind ?? (restMin >= 45 * 60 ? "weekly_normal" : restMin >= 24 * 60 ? "weekly_reduced" : "daily");
  if (kind === "weekly_reduced") return 0;
  const base = kind === "weekly_normal" ? 45 * 60 : options.dailyBaseMin ?? 11 * 60;
  if (restMin < base) return 0;
  return Math.max(0, Math.floor(restMin) - base);
}

/** Cola FIFO estricta por fecha de vencimiento, SIN saltarse la deuda más antigua.
 * Una compensación no se fracciona ni puede pagarse con minutos reutilizados.
 */
export function allocateWholeCompensations(
  debts: ReadonlyArray<{min: number; id: string}>,
  capacityMin: number,
): string[] {
  let available = Math.max(0, Math.floor(capacityMin));
  const paid: string[] = [];
  for (const debt of debts) {
    if (!Number.isFinite(debt.min) || debt.min <= 0) continue;
    if (debt.min > available) break;
    paid.push(debt.id);
    available -= debt.min;
  }
  return paid;
}

/** Cierre del domingo de la tercera semana: la fecha del día límite inclusive. */
export function isCompensationInTime(restEndAt: string, deadline: string): boolean {
  const day = restEndAt.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    /^\d{4}-\d{2}-\d{2}$/.test(deadline) && day <= deadline;
}

/** Only unexpired compensation deadlines belong to the actionable pending list.
 * The deadline day itself is inclusive. Expiry does not erase the legal history.
 */
export function isActiveCompensationDeadline(deadline: string | null | undefined, today: string): boolean {
  return typeof deadline === "string" && /^\d{4}-\d{2}-\d{2}$/.test(deadline) &&
    /^\d{4}-\d{2}-\d{2}$/.test(today) && deadline >= today;
}

/** Filtro visual, NO prescripción legal ni borrado. Inicio del día, UTC. */
export function isWithinAlertWindow56Days(
  sourceDate: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!sourceDate) return false;
  const day = sourceDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const midnight = Date.parse(day + "T00:00:00Z");
  if (!Number.isFinite(midnight)) return false;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return midnight >= today - 56 * 86400000 && midnight <= today;
}

/** Alerta preventiva de planificación semanal; no declara una infracción automática. */
export function checkWeeklyRestSequence(
  rests: ReadonlyArray<{startAt: string; endAt: string; durationMin: number}>,
): Array<{code: "WEEKLY_REST_144H" | "CONSECUTIVE_REDUCED_WEEKLY_RESTS"; message: string}> {
  const items = rests
    .filter(r => Number.isFinite(r.durationMin) && r.durationMin >= 24 * 60 &&
      Number.isFinite(Date.parse(r.startAt)) && Number.isFinite(Date.parse(r.endAt)))
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const alerts: Array<{code: "WEEKLY_REST_144H" | "CONSECUTIVE_REDUCED_WEEKLY_RESTS"; message: string}> = [];
  for (let i = 1; i < items.length; i++) {
    const before = items[i - 1], current = items[i];
    const elapsedMin = (Date.parse(current.startAt) - Date.parse(before.endAt)) / 60000;
    if (elapsedMin > 144 * 60) {
      alerts.push({code:"WEEKLY_REST_144H", message:"Han transcurrido más de 144 horas entre descansos semanales. Revisar planificación."});
    }
    const firstWeek = mondayOfIsoWeek(before.startAt);
    const nextWeek = mondayOfIsoWeek(current.startAt);
    if (nextWeek - firstWeek === 7 * 86400000 &&
        before.durationMin < 45 * 60 && current.durationMin < 45 * 60) {
      alerts.push({code:"CONSECUTIVE_REDUCED_WEEKLY_RESTS", message:"Dos descansos semanales reducidos en semanas consecutivas: comprobar condiciones del transporte internacional y compensaciones."});
    }
  }
  return alerts;
}

function mondayOfIsoWeek(iso: string): number {
  const d = new Date(iso);
  const days = d.getUTCDay() === 0 ? 6 : d.getUTCDay() - 1;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - days);
}
