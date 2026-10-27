import { haversineDistanceKm, type BaseLocationConfig } from "./base-location";

const normalize = (s?: string | null) => (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const aliases: Record<string, string> = {
  es: "ES", espana: "ES", spain: "ES", espagne: "ES",
  fr: "FR", francia: "FR", france: "FR", de: "DE", alemania: "DE", germany: "DE", deutschland: "DE",
  pt: "PT", portugal: "PT", pl: "PL", polonia: "PL", poland: "PL", cz: "CZ", chequia: "CZ", "republica checa": "CZ", czechia: "CZ",
  it: "IT", italia: "IT", italy: "IT", lu: "LU", luxemburgo: "LU", luxembourg: "LU",
  be: "BE", belgica: "BE", belgium: "BE", nl: "NL", "paises bajos": "NL", netherlands: "NL",
  ma: "MA", marruecos: "MA", morocco: "MA", maroc: "MA",
};
function country(text?: string | null): string | null {
  const value = normalize(text);
  return aliases[value] ?? aliases[value.split(",").at(-1)!.trim()] ?? null;
}
export type DietSuggestion = { tipoRuta: "NACIONAL" | "INTERNACIONAL" | null; pernocta: boolean | null; percentage: 100 | null };
export function suggestClosingDiet(input: {
  base: Partial<BaseLocationConfig> | null;
  endPlace: string;
  startPlace?: string | null;
  countries?: string[] | null;
  gps?: { label: string; countryCode: string | null; latitude: number; longitude: number } | null;
}): DietSuggestion {
  const empty: DietSuggestion = { tipoRuta: null, pernocta: null, percentage: null };
  const { base } = input;
  if (!base?.baseCity || !base.baseCountry || !input.endPlace.trim()) return empty;
  const gps = input.gps?.label === input.endPlace ? input.gps : null;
  const homeCountry = country(base.baseCountry);
  const endCountry = country(gps?.countryCode) ?? country(input.endPlace);
  const countries = [country(input.startPlace), endCountry, ...(input.countries ?? []).map(country)].filter(Boolean);
  const tipoRuta = !homeCountry ? null : countries.some(c => c !== homeCountry) ? "INTERNACIONAL" : endCountry === homeCountry ? "NACIONAL" : null;
  let pernocta: boolean | null = null;
  if (gps && typeof base.baseLatitude === "number" && Number.isFinite(base.baseLatitude) && typeof base.baseLongitude === "number" && Number.isFinite(base.baseLongitude)) {
    pernocta = haversineDistanceKm(base.baseLatitude, base.baseLongitude, gps.latitude, gps.longitude) > (base.baseRadiusKm ?? 20);
  } else {
    const city = normalize(input.endPlace.split(",")[0]);
    if (city === normalize(base.baseCity) && (!endCountry || endCountry === homeCountry)) pernocta = false;
    else if (endCountry && city && country(city) == null) pernocta = true;
  }
  return { tipoRuta, pernocta, percentage: pernocta === true ? 100 : null };
}

export function applyClosingDietSuggestion(
  current: { tipoRuta: string; pernocta: boolean; percentage: number },
  suggestion: DietSuggestion,
  manual: { route: boolean; overnight: boolean; percentage: boolean },
) {
  return {
    tipoRuta: manual.route ? current.tipoRuta : suggestion.tipoRuta ?? current.tipoRuta,
    pernocta: manual.overnight ? current.pernocta : suggestion.pernocta ?? current.pernocta,
    percentage: manual.percentage || manual.overnight ? current.percentage : suggestion.percentage ?? current.percentage,
  };
}
