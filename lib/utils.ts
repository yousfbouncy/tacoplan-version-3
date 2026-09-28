export function getPeriodo2020(date?: Date, startDay: number = 20, endDay?: number): { from: string; to: string; label: string } {
  const d = date || new Date();
  const year = d.getFullYear();
  const month0 = d.getMonth();
  const day = d.getDate();

  const ed = endDay != null ? endDay : startDay - 1;
  const sameMonth = ed >= startDay;

  let fromMonth0: number, fromYear: number;

  if (sameMonth) {
    if (day >= startDay && day <= ed) {
      fromMonth0 = month0;
      fromYear = year;
    } else if (day > ed) {
      fromMonth0 = month0 + 1;
      fromYear = year;
      if (fromMonth0 > 11) { fromMonth0 = 0; fromYear++; }
    } else {
      fromMonth0 = month0 - 1;
      fromYear = year;
      if (fromMonth0 < 0) { fromMonth0 = 11; fromYear--; }
    }
  } else {
    if (day >= startDay) {
      fromMonth0 = month0;
      fromYear = year;
    } else {
      fromMonth0 = month0 - 1;
      fromYear = year;
      if (fromMonth0 < 0) { fromMonth0 = 11; fromYear--; }
    }
  }

  let toMonth0: number, toYear: number;
  if (sameMonth) {
    toMonth0 = fromMonth0;
    toYear = fromYear;
  } else {
    toMonth0 = fromMonth0 + 1;
    toYear = fromYear;
    if (toMonth0 > 11) { toMonth0 = 0; toYear++; }
  }

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const fromDate = `${fromYear}-${pad2(fromMonth0 + 1)}-${pad2(startDay)}`;
  const toDate = `${toYear}-${pad2(toMonth0 + 1)}-${pad2(ed)}`;

  const label = `${pad2(startDay)}/${pad2(fromMonth0 + 1)}/${fromYear} - ${pad2(ed)}/${pad2(toMonth0 + 1)}/${toYear}`;

  return { from: fromDate, to: toDate, label };
}

export const WEB_HIDE_BILLING_UI = (process.env.EXPO_PUBLIC_TACOPLAN_HIDE_BILLING_UI ?? "true") === "true";

export function formatDescanso(minutos: number | null | undefined): string {
  if (minutos == null) return "-";
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${h}h ${m}m`;
}

export function formatMinutosHoras(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function tipoDescansoLabel(tipo: string | null | undefined): string {
  if (!tipo) return "-";
  const map: Record<string, string> = {
    DESCANSO_DIARIO_COMPLETO: "Diario completo",
    DESCANSO_DIARIO_REDUCIDO: "Diario reducido",
    DESCANSO_SEMANAL_COMPLETO: "Semanal completo",
    DESCANSO_SEMANAL_REDUCIDO: "Semanal reducido",
    INFRACCION_DESCANSO: "Infraccion (<9h)",
  };
  return map[tipo] || tipo;
}

export function tipoRutaLabel(tipo: string | null | undefined): string {
  if (!tipo) return "-";
  const map: Record<string, string> = {
    REGIONAL_INTL: "Regional Intl.",
    NAC_INTL: "Nac. + Intl.",
    NACIONAL: "Nacional",
    INTERNACIONAL: "Internacional",
    NAC_REGIONAL: "Nac. Regional",
    NINGUNO: "Ninguno",
    REGIONAL: "Regional",
  };
  return map[tipo] || tipo;
}

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function nowTimeStr(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function formatFecha(fecha: string | null | undefined): string {
  if (!fecha) return "-";
  const [y, m, d] = fecha.split("-");
  return `${d}/${m}/${y}`;
}

export function formatFechaCorta(fecha: string | null | undefined): string {
  if (!fecha) return "-";
  const [, m, d] = fecha.split("-");
  return `${d}/${m}`;
}

export function formatDateForDisplay(fecha: string | null | undefined): string {
  if (!fecha) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return formatFecha(fecha);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(fecha)) return fecha;
  return fecha;
}

export function parseDisplayDateToISO(displayDate: string | null | undefined): string | null {
  const raw = (displayDate || "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (!Number.isFinite(d) || !Number.isFinite(mo) || !Number.isFinite(y)) return null;
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > 31) return null;
  const iso = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const dt = new Date(iso + "T12:00:00");
  if (Number.isNaN(dt.getTime())) return null;
  if (dt.getFullYear() !== y || dt.getMonth() + 1 !== mo || dt.getDate() !== d) return null;
  return iso;
}

export function dietaTipoLabel(tipo: string): string {
  const map: Record<string, string> = {
    INTERNACIONAL_100: "Intl. 100%",
    INTERNACIONAL_60: "Intl. 60%",
    INTERNACIONAL_30: "Intl. 30%",
    NACIONAL_100: "Nac. 100%",
    NACIONAL_60: "Nac. 60%",
    NACIONAL_30: "Nac. 30%",
    NAC_INTL_AUTO: "Nac.+Intl. Auto",
  };
  return map[tipo] || tipo;
}

export function dayFlagLabel(flag: string | null | undefined): string {
  if (!flag) return "";
  const map: Record<string, string> = {
    SABADO: "Sabado",
    DOMINGO: "Domingo",
    FESTIVO: "Festivo",
  };
  return map[flag] || flag;
}

export function isSpainSummerTime(dateStr: string): boolean {
  const d = new Date(dateStr + "T12:00:00");
  const month = d.getMonth();
  if (month > 2 && month < 9) return true;
  if (month === 2) {
    const lastSun = new Date(d.getFullYear(), 2, 31);
    lastSun.setDate(lastSun.getDate() - lastSun.getDay());
    return d.getDate() >= lastSun.getDate();
  }
  if (month === 9) {
    const lastSun = new Date(d.getFullYear(), 9, 31);
    lastSun.setDate(lastSun.getDate() - lastSun.getDay());
    return d.getDate() < lastSun.getDate();
  }
  return false;
}

export function detectCrossSundayMonday(fechaInicio: string, fechaFin: string): boolean {
  if (!fechaInicio || !fechaFin) return false;
  const startDate = new Date(fechaInicio + "T12:00:00");
  const endDate = new Date(fechaFin + "T12:00:00");
  return startDate.getDay() === 0 && endDate.getDay() === 1 && fechaInicio !== fechaFin;
}

export function minutosToStr(min: number | null): string {
  if (min == null) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (m === 0) return String(h);
  return `${h}:${String(m).padStart(2, "0")}`;
}
