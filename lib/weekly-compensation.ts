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
