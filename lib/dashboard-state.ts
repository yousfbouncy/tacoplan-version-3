/** Stable per-account cache keys: sync refreshes data without resetting the screen. */
export function dashboardQueryKey(name: string, userId: string | undefined) {
  return [name, userId ?? null] as const;
}

export function restCountdown(last: {
  endAt?: string | null;
  plannedRestMin?: number | null;
  ferryPending?: boolean;
  ferryRestCompleted?: boolean;
} | null | undefined, active: boolean, now: number) {
  if (active || !last?.endAt || (last.ferryPending && !last.ferryRestCompleted)) return null;
  const end = Date.parse(last.endAt);
  if (!Number.isFinite(end) || end > now) return null;
  const elapsedMin = Math.floor((now - end) / 60000);
  const totalMin = typeof last.plannedRestMin === "number" && Number.isFinite(last.plannedRestMin) && last.plannedRestMin > 0
    ? last.plannedRestMin : null;
  const target = totalMin === null ? null : end + totalMin * 60000;
  return { elapsedMin, totalMin, target, remainingMin: target === null ? null : Math.max(0, Math.ceil((target - now) / 60000)) };
}
