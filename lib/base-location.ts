export type BaseLocationConfig = {
  baseName: string | null;
  baseCity: string | null;
  baseCountry: string | null;
  baseAddress: string | null;
  baseLatitude: number | null;
  baseLongitude: number | null;
  baseRadiusKm: number | null;
  baseConfiguredAt: string | null;
  baseUpdatedAt: string | null;
};

export type BaseLocationMatch = {
  status: "in_base" | "out_of_base" | "unknown";
  distanceKm: number | null;
  matchedBy: "coordinates" | "city_country" | "name" | "address" | null;
  normalizedLocation: string | null;
};

export const DEFAULT_BASE_RADIUS_KM = 20;

function normalizeText(value: string | null | undefined): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hasValue(value: string | null | undefined): boolean {
  return normalizeText(value).length > 0;
}

function safeNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function buildBaseLocationConfig(input?: Partial<BaseLocationConfig> | null): BaseLocationConfig {
  return {
    baseName: input?.baseName?.trim() || null,
    baseCity: input?.baseCity?.trim() || null,
    baseCountry: input?.baseCountry?.trim() || null,
    baseAddress: input?.baseAddress?.trim() || null,
    baseLatitude: safeNumber(input?.baseLatitude),
    baseLongitude: safeNumber(input?.baseLongitude),
    baseRadiusKm: safeNumber(input?.baseRadiusKm) ?? DEFAULT_BASE_RADIUS_KM,
    baseConfiguredAt: input?.baseConfiguredAt || null,
    baseUpdatedAt: input?.baseUpdatedAt || null,
  };
}

export function isBaseLocationConfigured(base: Partial<BaseLocationConfig> | null | undefined): boolean {
  return hasValue(base?.baseName) && hasValue(base?.baseCity) && hasValue(base?.baseCountry);
}

export function formatBaseLocationSummary(base: Partial<BaseLocationConfig> | null | undefined): string {
  const parts = [base?.baseName, base?.baseCity, base?.baseCountry].filter((part) => hasValue(part));
  return parts.join(" · ");
}

export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

export function matchLocationAgainstBase(
  baseInput: Partial<BaseLocationConfig> | null | undefined,
  locationText: string | null | undefined,
  coords?: { latitude?: number | null; longitude?: number | null } | null,
): BaseLocationMatch {
  const base = buildBaseLocationConfig(baseInput);
  const normalizedLocation = normalizeText(locationText);
  if (!isBaseLocationConfigured(base) || !normalizedLocation) {
    return { status: "unknown", distanceKm: null, matchedBy: null, normalizedLocation: normalizedLocation || null };
  }

  const lat = safeNumber(coords?.latitude);
  const lng = safeNumber(coords?.longitude);
  if (base.baseLatitude != null && base.baseLongitude != null && lat != null && lng != null) {
    const distanceKm = haversineDistanceKm(base.baseLatitude, base.baseLongitude, lat, lng);
    return {
      status: distanceKm <= (base.baseRadiusKm ?? DEFAULT_BASE_RADIUS_KM) ? "in_base" : "out_of_base",
      distanceKm: Math.round(distanceKm * 10) / 10,
      matchedBy: "coordinates",
      normalizedLocation,
    };
  }

  const city = normalizeText(base.baseCity);
  const country = normalizeText(base.baseCountry);
  const name = normalizeText(base.baseName);
  const address = normalizeText(base.baseAddress);

  if (city && country && normalizedLocation.includes(city) && normalizedLocation.includes(country)) {
    return { status: "in_base", distanceKm: 0, matchedBy: "city_country", normalizedLocation };
  }

  if (name && normalizedLocation.includes(name)) {
    return { status: "in_base", distanceKm: 0, matchedBy: "name", normalizedLocation };
  }

  if (address && normalizedLocation.includes(address)) {
    return { status: "in_base", distanceKm: 0, matchedBy: "address", normalizedLocation };
  }

  if ((city && normalizedLocation.includes(city)) || (country && normalizedLocation.includes(country))) {
    return { status: "unknown", distanceKm: null, matchedBy: null, normalizedLocation };
  }

  return { status: "out_of_base", distanceKm: null, matchedBy: null, normalizedLocation };
}
