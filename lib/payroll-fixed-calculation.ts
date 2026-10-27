/** Shared fixed salary computation used by the Dietas preview and full payslip. */
export const PAYROLL_FIXED_KEYS = ["salario_base_bruto", "plus_convenio", "complemento", "pagas_prorrateadas", "productividad_fija", "otros_conceptos_fijos"] as const;
export const payrollNumber = (value: unknown): number => {
  const n = parseFloat(String(value ?? "0").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
export function getPayrollFixedTotal(
  config: Record<string, unknown>,
  daysComputed: number,
  daysWorked: number,
  baseDays: number,
): number {
  const unit = config.fixed_unit === "month" ? "month" : "day";
  let total = 0;
  for (const key of PAYROLL_FIXED_KEYS) {
    const amount = payrollNumber(config[key]);
    if (amount <= 0) continue;
    if (unit === "day") {
      total += amount * daysWorked;
    } else {
      const multiplier = key === "complemento" || key === "productividad_fija" ? daysWorked : daysComputed;
      total += amount / Math.max(1, baseDays) * multiplier;
    }
  }
  return Math.round(total * 100) / 100;
}
