/**
 * Conserva siempre el descanso que exige la norma antes de utilizar el resto
 * como compensación. No se puede reutilizar el mismo tramo como descanso
 * semanal mínimo y como compensación. Art. 8.6 y 8.7 CE 561/2006.
 *
 * Los descansos de 24 a <45 h no se usan para autocompensar: podrían
 * ser descansos semanales reducidos que generan su propia deuda.
 * Las compensaciones explícitas/manuales siguen siendo posibles.
 */
export function automaticCompensationCapacityMin(restMin: number): number {
  if (!Number.isFinite(restMin) || restMin < 9 * 60) return 0;
  if (restMin >= 45 * 60) return Math.max(0, Math.floor(restMin) - 45 * 60);
  if (restMin >= 24 * 60) return 0;
  // Un descanso diario normal necesita 11 h; uno reducido, al menos 9 h.
  if (restMin >= 11 * 60) return Math.max(0, Math.floor(restMin) - 11 * 60);
  return Math.max(0, Math.floor(restMin) - 9 * 60);
}

export function weeklyReductionDebtMin(restMin: number): number {
  return Number.isFinite(restMin) && restMin >= 24 * 60 && restMin < 45 * 60
    ? 45 * 60 - Math.floor(restMin)
    : 0;
}

/** Devuelve índices pagables sin fragmentar deudas, una sola vez por descanso. */
export function allocateWholeCompensations(
  debts: ReadonlyArray<{min: number; id: string}>,
  capacityMin: number,
): string[] {
  let left = Math.max(0, Math.floor(capacityMin));
  const paid: string[] = [];
  for (const debt of debts) {
    if (!Number.isFinite(debt.min) || debt.min <= 0) continue;
    if (debt.min > left) continue;
    paid.push(debt.id);
    left -= debt.min;
  }
  return paid;
}
