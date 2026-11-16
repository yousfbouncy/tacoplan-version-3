/** Calendar-day vacation window. Inclusive end; reminders resume the following day. */
export type VacationPeriod = { startDate: string; endDate: string };
export function validVacationDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
export function validateVacationPeriod(startDate: string, endDate: string): string | null {
  if (!validVacationDate(startDate) || !validVacationDate(endDate)) return "Introduce fechas válidas en formato AAAA-MM-DD.";
  if (endDate < startDate) return "El final de vacaciones no puede ser anterior al inicio.";
  return null;
}
export function isVacationDay(period: VacationPeriod | null, day: string): boolean {
  return !!period && validVacationDate(day) && day >= period.startDate && day <= period.endDate;
}
export function calendarDateInTimeZone(date: Date, timeZone = "Europe/Madrid"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
