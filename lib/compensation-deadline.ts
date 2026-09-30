function extractDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function formatUtcDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Art. 8.6 ter del Reglamento 561/2006: una reducción semanal debe
 * compensarse antes de finalizar la tercera semana siguiente a la semana
 * del descanso reducido. El resultado es el domingo de esa tercera semana.
 */
export function calculateCompensationDeadline(params: {
  sourceRestStartAt?: string | null;
  sourceRestEndAt?: string | null;
  jornadaPreviousRestEndAt?: string | null;
  fechaInicioJornada?: string | null;
  hoyStr?: string;
}): string {
  const candidate =
    extractDate(params.sourceRestStartAt) ??
    extractDate(params.sourceRestEndAt) ??
    extractDate(params.jornadaPreviousRestEndAt) ??
    extractDate(params.fechaInicioJornada) ??
    params.hoyStr ??
    formatUtcDate(new Date());

  const date = new Date(`${candidate}T00:00:00Z`);
  const day = date.getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  const deadline = new Date(date);
  deadline.setUTCDate(date.getUTCDate() - daysSinceMonday + 27);
  return formatUtcDate(deadline);
}
