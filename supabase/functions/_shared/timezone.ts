const DEFAULT_TIMEZONE = "Europe/Madrid";

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

const weekdayMap: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function isValidTimeZone(timeZone: string | null | undefined) {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timeZone || DEFAULT_TIMEZONE }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimeZone(timeZone: string | null | undefined) {
  const value = typeof timeZone === "string" ? timeZone.trim() : "";
  return value && isValidTimeZone(value) ? value : DEFAULT_TIMEZONE;
}

export function getZonedParts(date: Date, timeZone: string | null | undefined): ZonedParts {
  const safeTimeZone = normalizeTimeZone(timeZone);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const raw = formatter.formatToParts(date);
  const read = (type: string) => Number(raw.find((part) => part.type === type)?.value || "0");
  const weekdayLabel = raw.find((part) => part.type === "weekday")?.value || "Sun";
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
    weekday: weekdayMap[weekdayLabel] ?? 0,
  };
}

export function zonedLocalDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string | null | undefined,
) {
  const safeTimeZone = normalizeTimeZone(timeZone);
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  for (let index = 0; index < 6; index += 1) {
    const parts = getZonedParts(guess, safeTimeZone);
    const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    const actualUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
    const diff = desiredUtc - actualUtc;
    if (diff === 0) return guess;
    guess = new Date(guess.getTime() + diff);
  }
  return guess;
}

function addDays(parts: Pick<ZonedParts, "year" | "month" | "day">, days: number) {
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 0, 0, 0, 0));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function localDateTimeToUtcIso(
  dateStr: string,
  timeStr: string,
  timeZone: string | null | undefined,
) {
  const match = `${dateStr} ${timeStr}`.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (!match) return "";
  const utc = zonedLocalDateTimeToUtc(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    timeZone,
  );
  return Number.isNaN(utc.getTime()) ? "" : utc.toISOString();
}

export function getLocalHourInTimeZone(date: Date, timeZone: string | null | undefined) {
  return getZonedParts(date, timeZone).hour;
}

export function getLocalHHmmInTimeZone(date: Date, timeZone: string | null | undefined) {
  const parts = getZonedParts(date, timeZone);
  return { hh: parts.hour, mm: parts.minute };
}

export function nextDailyLocal(from: Date, time: { hh: number; mm: number }, timeZone: string | null | undefined) {
  const parts = getZonedParts(from, timeZone);
  const nextDate = addDays(parts, 1);
  return zonedLocalDateTimeToUtc(nextDate.year, nextDate.month, nextDate.day, time.hh, time.mm, timeZone);
}

export function nextWeeklyLocal(
  from: Date,
  time: { hh: number; mm: number },
  weekDays: number[],
  timeZone: string | null | undefined,
) {
  const parts = getZonedParts(from, timeZone);
  const sorted = Array.from(new Set((weekDays || []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0 && n <= 6))).sort((a, b) => a - b);
  const currentWeekday = parts.weekday;
  const fallback = addDays(parts, 7);
  if (sorted.length === 0) {
    return zonedLocalDateTimeToUtc(fallback.year, fallback.month, fallback.day, time.hh, time.mm, timeZone);
  }
  for (let add = 1; add <= 7; add += 1) {
    const candidateWeekday = (currentWeekday + add) % 7;
    if (sorted.includes(candidateWeekday)) {
      const nextDate = addDays(parts, add);
      return zonedLocalDateTimeToUtc(nextDate.year, nextDate.month, nextDate.day, time.hh, time.mm, timeZone);
    }
  }
  return zonedLocalDateTimeToUtc(fallback.year, fallback.month, fallback.day, time.hh, time.mm, timeZone);
}

export function nextMonthlyLocal(
  from: Date,
  time: { hh: number; mm: number },
  dayOfMonth: number,
  timeZone: string | null | undefined,
) {
  const parts = getZonedParts(from, timeZone);
  let year = parts.year;
  let month = parts.month + 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  const day = Math.min(Math.max(1, Number(dayOfMonth || 1)), lastDayOfMonth(year, month));
  return zonedLocalDateTimeToUtc(year, month, day, time.hh, time.mm, timeZone);
}

export function formatLocalHourLabel(hour: number | null | undefined) {
  if (hour == null || !Number.isFinite(hour)) return "";
  return `${pad2(Number(hour))}:00`;
}
