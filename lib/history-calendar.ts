export type CalendarDietType = "INTERNACIONAL" | "NACIONAL" | "REGIONAL";

export function getCalendarDietLabel(
  naturalType?: CalendarDietType | null,
  journeyRoute?: string | null,
): "INT" | "NAC" | "REG" | "" {
  if (naturalType === "INTERNACIONAL") return "INT";
  if (naturalType === "REGIONAL") return "REG";
  if (naturalType === "NACIONAL") return "NAC";

  if (
    journeyRoute === "INTERNACIONAL" ||
    journeyRoute === "REGIONAL_INTL" ||
    journeyRoute === "NAC_INTL"
  ) {
    return "INT";
  }
  if (journeyRoute === "REGIONAL") return "REG";
  if (journeyRoute) return "NAC";
  return "";
}

export function journeyTouchesCalendarDate(
  journey: { fechaInicio?: string | null; fechaFin?: string | null },
  date: string,
): boolean {
  const start = journey.fechaInicio || "";
  if (!start) return false;
  const end = journey.fechaFin || start;
  return start <= date && date <= end;
}
