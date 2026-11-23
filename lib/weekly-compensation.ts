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


/**
 * Art. 8(6) y 8(6b), Reglamento 561/2006.
 * El lugar relevante es el INICIO de cada descanso, no solamente estar
 * fuera de la base o tener una dieta internacional.
 * No inferimos residencia ni pais a partir de una dirección libre.
 */
export type InternationalWeeklyRestInput = {
  startAt: string;
  durationMin: number;
  startCountry: string | null | undefined; // ISO 3166-1 alpha-2 confirmado
};
export type InternationalWeeklyPairAssessment = {
  status: "eligible" | "ineligible" | "unverified";
  compensationMin: number;
  requiredNextRestMin: number;
  reasons: string[];
};

export function assessInternationalReducedWeeklyPair(
  first: InternationalWeeklyRestInput,
  second: InternationalWeeklyRestInput,
  employerCountry: string | null | undefined,
  residenceCountry: string | null | undefined,
): InternationalWeeklyPairAssessment {
  const compensationMin = weeklyReductionDebtMin(first.durationMin) +
    weeklyReductionDebtMin(second.durationMin);
  const result = (
    status: InternationalWeeklyPairAssessment["status"],
    reasons: string[],
  ): InternationalWeeklyPairAssessment => ({
    status, reasons, compensationMin,
    requiredNextRestMin: compensationMin + 45 * 60,
  });
  if (!weeklyReductionDebtMin(first.durationMin) ||
      !weeklyReductionDebtMin(second.durationMin)) {
    return result("ineligible", ["No son dos descansos semanales reducidos válidos (24 a menos de 45 horas)."]);
  }
  const week1 = mondayOfIsoWeek(first.startAt);
  const week2 = mondayOfIsoWeek(second.startAt);
  if (!Number.isFinite(week1) || !Number.isFinite(week2) ||
      week2 - week1 !== 7 * 86400000) {
    return result("unverified", ["Comprobar la atribución de cada descanso a semanas consecutivas; los descansos que cruzan el lunes pueden asignarse a una de dos semanas."]);
  }
  const countries = [first.startCountry, second.startCountry, employerCountry, residenceCountry];
  const valid = countries.map(c => typeof c === "string" && /^[A-Za-z]{2}$/.test(c.trim()) ? c.trim().toUpperCase() : null);
  if (valid.some(c => !c)) {
    return result("unverified", ["Falta confirmar el país de inicio de ambos descansos, el país de establecimiento de la empresa o el país de residencia."]);
  }
  const [country1, country2, employer, residence] = valid;
  if ([country1, country2].some(c => c === employer || c === residence)) {
    return result("ineligible", ["Uno de los descansos empezó en el país de establecimiento de la empresa o en el país de residencia."]);
  }
  return result("eligible", ["Dos descansos reducidos iniciados fuera de ambos países: ambas compensaciones deben preceder al siguiente descanso semanal normal."]);
}

/** Alerta preventiva de planificación semanal; no declara una infracción automática. */
export function checkWeeklyRestSequence(
  rests: ReadonlyArray<{startAt: string; endAt: string; durationMin: number}>,
): Array<{code: "WEEKLY_REST_144H" | "CONSECUTIVE_REDUCED_WEEKLY_RESTS"; message: string}> {
  // The six-24-hour rule measures the time FROM THE END of one weekly rest
  // TO THE START of the next. Hours spent resting never count toward that gap.
  // Invalid intervals and duplicate records must not trigger legal warnings.
  const items = rests
    .filter(r => {
      const start = Date.parse(r.startAt);
      const end = Date.parse(r.endAt);
      return Number.isFinite(start) && Number.isFinite(end) && end > start &&
        Number.isFinite(r.durationMin) && r.durationMin >= 24 * 60 &&
        (end - start) >= 24 * 60 * 60000;
    })
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));

  const alerts: Array<{code: "WEEKLY_REST_144H" | "CONSECUTIVE_REDUCED_WEEKLY_RESTS"; message: string}> = [];
  for (let i = 1; i < items.length; i++) {
    const before = items[i - 1], current = items[i];
    const previousEnd = Date.parse(before.endAt);
    const nextStart = Date.parse(current.startAt);
    // Overlap indicates duplicated or inconsistent records, not time worked.
    if (nextStart < previousEnd) continue;
    const elapsedMin = (nextStart - previousEnd) / 60000;
    if (elapsedMin > 144 * 60) {
      const hours = Math.floor(elapsedMin / 60);
      const minutes = Math.round(elapsedMin % 60);
      alerts.push({
        code: "WEEKLY_REST_144H",
        message: `Intervalo de ${hours} h ${String(minutes).padStart(2, "0")} min desde el fin del descanso semanal (${before.endAt}) hasta el inicio del siguiente (${current.startAt}). Comprobar si faltan descansos registrados; no se trata de horas acumuladas de descanso.`,
      });
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
