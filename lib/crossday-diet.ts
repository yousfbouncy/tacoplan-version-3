/**
 * Provisional out-of-base diet for the calendar day on which a cross-midnight
 * international journey ends. This is a product rule (not a statutory rate):
 * only after closing the shift and selecting a daily/weekly rest.
 * If a new shift begins that calendar day, the provisional day is revoked.
 */
export const CROSSDAY_AUTO_DIET_PREFIX = "auto_oob_crossday_";

export type CrossDayJourney = {
  id: string;
  fechaInicio: string;
  fechaFin?: string | null;
  startAt: string;
  endAt?: string | null;
  tipoRuta?: string | null;
  plannedRestType?: "daily" | "weekly" | null;
  paymentMode?: "dietas" | "km" | "viaje" | null;
};

export function crossDayAutoDietDate(j: CrossDayJourney, all: CrossDayJourney[]): string | null {
  const date = j.fechaFin;
  if (!date || !j.endAt || !j.startAt || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (date <= j.fechaInicio || j.startAt.slice(0,10) !== j.fechaInicio || j.endAt.slice(0,10) !== date) return null;
  if (j.plannedRestType !== "daily" && j.plannedRestType !== "weekly") return null;
  if ((j.paymentMode || "dietas") !== "dietas") return null;
  if (!["INTERNACIONAL", "REGIONAL_INTL", "NAC_INTL"].includes(j.tipoRuta || "")) return null;
  // Never create a second day diet when a working shift already starts on
  // the end date, even if that shift has not yet been closed.
  if (all.some(other => other.id !== j.id && other.fechaInicio === date)) return null;
  return date;
}

export function isProvisionalCrossDayDietForNewStart(
  diet: { id: string; date: string; previousJourneyId?: string | null },
  newShift: CrossDayJourney,
): boolean {
  return diet.id.startsWith(CROSSDAY_AUTO_DIET_PREFIX) &&
    diet.date === newShift.fechaInicio &&
    diet.previousJourneyId !== newShift.id;
}

/** Configured product rule for an international crossing ending at the home base. */
export function crossDayAutoDietPercentage(endLocation:string|null|undefined,baseCity:string|null|undefined):100|60 {
  const norm=(v:string|null|undefined)=>String(v||"").normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase().trim();
  const end=norm(endLocation),city=norm(baseCity);
  if(!city||!end)return 100;
  const tokens=end.split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.includes(city)||end===city||end.startsWith(city+",")?60:100;
}

/** A confirmed natural-day diet can originate from a cross-midnight journey,
 * even when its ID is a normal saved ID rather than our provisional prefix.
 * Prefer its stable previousJourneyId over the ID format. */
export function isCrossDayContinuationDiet(
  diet:{id:string;date:string;previousJourneyId?:string|null},
  previous?:CrossDayJourney|null,
):boolean {
  if(diet.id.startsWith(CROSSDAY_AUTO_DIET_PREFIX))return true;
  if(!diet.previousJourneyId||!previous||diet.previousJourneyId!==previous.id)return false;
  return !!previous.startAt&&!!previous.endAt&&
    previous.fechaInicio<diet.date&&previous.fechaFin===diet.date&&
    previous.startAt.slice(0,10)===previous.fechaInicio&&
    previous.endAt.slice(0,10)===diet.date;
}
