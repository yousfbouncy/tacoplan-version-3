import AsyncStorage from "@react-native-async-storage/async-storage";
import { evaluateJornada, getJornadaDrivingForWeek, jornadaOverlapsWeek, computeReducedRestsInUtcWeek, isSplitDailyRestGapComplete, type LegalSummary } from "./legalEngine";
import { buildBaseLocationConfig, type BaseLocationConfig } from "@/lib/base-location";
import { assessWeeklyRest, type WeeklyRestAssessment } from "@/lib/weekly-rest";
import { userScopedKey } from "@/lib/user-scope";
import { normalizeLocationText } from "@/lib/location-normalization";
import { supabase } from "@/lib/supabase";

const JORNADAS_KEY = "tacoplan_jornadas";
const COMPENSACIONES_KEY = "tacoplan_compensaciones";
const RECENT_PLACES_KEY = "tacoplan_recent_places";
const MOROCCO_TRIPS_KEY = "tacoplan_morocco_trips";
const FERRY_RESTS_KEY = "tacoplan_ferry_rests";
const ACTIVE_FERRY_REST_KEY = "tacoplan_active_ferry_rest";
const DAY_EXTRA_ENTRIES_KEY = "tacoplan_day_extra_entries";
const NATURAL_DAY_DIETS_KEY = "tacoplan_natural_day_diets";
const NATURAL_DAY_DIETS_DISMISSED_KEY = "tacoplan_natural_day_diets_dismissed";
const PDF_DIETS_DEBUG_URL = "http://127.0.0.1:7777/event";
const PDF_DIETS_DEBUG_SESSION = "pdf-diets-not-saved";
const PDF_DIETS_DEBUG_RUN = "pre-fix";
const JORNADA_DATE_DEBUG_URL = "http://127.0.0.1:7777/event";
const JORNADA_DATE_DEBUG_SESSION = "jornada-date-drift";
const JORNADA_DATE_DEBUG_RUN = "pre-fix";

function reportPdfDietDebug(hypothesisId: string, location: string, msg: string, data: Record<string, unknown>): void {
  if (typeof fetch !== "function") return;
  fetch(PDF_DIETS_DEBUG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: PDF_DIETS_DEBUG_SESSION,
      runId: PDF_DIETS_DEBUG_RUN,
      hypothesisId,
      location,
      msg: `[DEBUG] ${msg}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
}

function reportJornadaDateDebug(hypothesisId: string, location: string, msg: string, data: Record<string, unknown>): void {
  if (typeof fetch !== "function") return;
  let timezone: string | null = null;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {}
  fetch(JORNADA_DATE_DEBUG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: JORNADA_DATE_DEBUG_SESSION,
      runId: JORNADA_DATE_DEBUG_RUN,
      hypothesisId,
      location,
      msg: `[JORNADA_DATE_DEBUG] ${msg}`,
      data: {
        timezone,
        timezoneOffset: new Date().getTimezoneOffset(),
        ...data,
      },
      ts: Date.now(),
    }),
  }).catch(() => {});
}

async function getItemScoped(base: string): Promise<string | null> {
  return AsyncStorage.getItem(await userScopedKey(base));
}

async function setItemScoped(base: string, value: string): Promise<void> {
  await AsyncStorage.setItem(await userScopedKey(base), value);
}

async function removeItemScoped(base: string): Promise<void> {
  await AsyncStorage.removeItem(await userScopedKey(base));
}

export interface DietaItem {
  tipo: string;
  pct: string;
  importe: number;
}

export interface PlusItem {
  concepto: string;
  importe: number;
}

export interface UserDietRate {
  trip_type: string;
  percent: number;
  amount: number;
}

export interface UserDayExtras {
  extra_saturday: number;
  extra_sunday: number;
  extra_holiday: number;
  offsite_weekly_reduced_nacional: number;
  offsite_weekly_reduced_internacional: number;
  offsite_weekly_complete_nacional: number;
  offsite_weekly_complete_internacional: number;
}

export type DayExtraEntryType = "day_extra" | "offsite_weekly_rest";

export interface DayExtraEntry {
  id: string;
  date: string;
  entryType: DayExtraEntryType;
  dayFlag: "SABADO" | "DOMINGO" | "FESTIVO" | null;
  offsiteRestType: "WEEKLY_REDUCED" | "WEEKLY_COMPLETE" | null;
  offsiteBase: "NACIONAL" | "INTERNACIONAL" | null;
  plusSunday: boolean;
  plusHoliday: boolean;
  locationStart?: string | null;
  locationEnd?: string | null;
  inBase?: boolean | null;
  distanceToBaseKm?: number | null;
  amount: number | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  syncStatus: "pending" | "synced" | "local";
}

export type NaturalDayDietType = "INTERNACIONAL" | "NACIONAL" | "REGIONAL";
export interface NaturalDayDietEntry {
  id: string;
  date: string;
  type: NaturalDayDietType;
  percentage: 100 | 60 | 30;
  amount: number;
  location?: string | null;
  source: "NATURAL_DAY_OUT_OF_BASE";
  previousJourneyId?: string | null;
  nextJourneyId?: string | null;
  confirmedByUser: boolean;
  dismissedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  syncStatus: "pending" | "synced" | "local";
  plusItems?: Array<{ concepto: string; amount: number; id: string }> | null;
  isDomingo?: boolean | null;
  isFestivo?: boolean | null;
}
export type DetectedMissingNaturalDay = {
  date: string;
  type: NaturalDayDietType;
  percentage: 100 | 60 | 30;
  amount: number;
  location?: string | null;
  previousJourneyId?: string | null;
  nextJourneyId?: string | null;
  isBaseArrivalDay?: boolean;

  // Campos nueva mejora UI:
  previousJourneyStartAt?: string | null;        // ISO inicio jornada anterior (fecha+hora)
  previousJourneyEndAt?: string | null;          // ISO fin jornada anterior (fecha+hora)
  previousJourneyLugarInicio?: string | null;    // Origen jornada anterior
  previousJourneyLugarFin?: string | null;       // Destino jornada anterior
  arrivesAtBase?: boolean;                       // Llegada a base: Sí/No
  arrivalHHMM?: string | null;                   // Hora llegada a base (si arrivesAtBase=true)
  nextJourneyStartAt?: string | null;
  nextJourneyLugarInicio?: string | null;
  isDomingo?: boolean;
  isFestivo?: boolean;
  motivo?: string;
  // Pluses asociados al día (fuera de base):
  plusItems?: Array<{ concepto: string; amount: number; id: string; selected?: boolean }>;
  // Campos user-editable dentro del modal:
  userPercentage?: 100 | 60 | 30 | null;         // pct elegido por usuario (override 100 default non-arrival)
  userAmount?: number;                           // amount recalculado según userPercentage o arrival choice
  removed?: boolean;                             // true si user elimina la fila (no crea entrada)
};

export interface Jornada {
  id: string;
  fechaInicio: string;
  horaInicio: string;
  lugarInicio: string;
  fechaFin: string | null;
  horaFin: string | null;
  lugarFin: string | null;
  startAt: string;
  endAt: string | null;
  conduccionMin: number | null;
  conduccionDomingoMin: number | null;
  conduccionLunesMin: number | null;
  tipoRuta: string | null;
  pernocta: boolean | null;
  dietaModo: string | null;
  dietaManualTipo: string | null;
  dietaManualPct: string | null;
  dietaImporteEur: string | null;
  dietasItems: DietaItem[] | null;
  dietaPercent: number | null;
  dayFlag: string | null;
  dayExtraEur: string | null;
  dietBaseEur: string | null;
  dietRule: string | null;
  dietCalculatedAt: string | null;
  descansoAnteriorMin: number | null;
  tipoDescansoAnterior: string | null;
  previousRestSource: "normal_gap" | "ferry_rest" | null;
  previousRestId: string | null;
  previousRestValid: boolean | null;
  previousRestStartAt?: string | null;
  previousRestEndAt?: string | null;
  previousRestLegalType?: "weekly_normal" | "weekly_reduced" | "weekly_invalid" | null;
  previousRestStartLocation?: string | null;
  previousRestEndLocation?: string | null;
  previousRestInBase?: "in_base" | "out_of_base" | "unknown" | null;
  previousRestDistanceKm?: number | null;
  previousRestPerformedInVehicle?: boolean | null;
  previousRestAccommodation?: boolean | null;
  previousRestCompGeneratedMin?: number | null;
  previousRestCompUsedMin?: number | null;
  previousRestObservations?: string | null;
  duracionJornadaMin: number | null;
  countsAsDailyReduced: boolean;
  plannedRestMin: number | null;
  plannedRestType: "daily" | "weekly" | null;
  splitRestDetected: boolean;
  splitRestFirstPartMin: number | null;
  splitRestSecondPartMin: number | null;
  countsAsReducedRest: boolean;
  paymentMode: "dietas" | "km" | "viaje" | null;
  kmInicio: number | null;
  kmFin: number | null;
  kmTotal: number | null;
  pricePerKm: number | null;
  importeKm: number | null;
  pricePerTrip: number | null;
  importeViaje: number | null;
  reportHideAmounts: boolean;
  reportHidePluses: boolean;
  plusItems: PlusItem[] | null;
  observaciones: string | null;
  moroccoPaymentMode: "morocco_trip" | "morocco_pernight" | "morocco_diet" | null;
  moroccoTripRate: number | null;
  moroccoPernightRate: number | null;
  ferryPending: boolean;
  ferryDestination: string | null;
  ferryExtras: FerryExtras | null;
  ferryInterruptions: FerryInterruption[] | null;
  ferryRestCompleted: boolean;
  ferryRestType: "9h" | "11h" | null;
  legalSummary: LegalSummaryStored | null;
  tachoDailySummaryId?: string | null;
  tachoDrivingMin?: number | null;
  tachoWorkMin?: number | null;
  tachoAvailableMin?: number | null;
  tachoRestMin?: number | null;
  tachoCountries?: string[] | null;
  tachoCountryEntries?: number | null;
  tachoKmTotal?: number | null;
  tachoFirstActivityAt?: string | null;
  tachoLastActivityAt?: string | null;
  tachoDisconnections?: number | null;
  tachoDataQuality?: "low" | "medium" | "high" | null;
  isDoubleDriving: boolean;
  secondDriverName: string | null;
  updatedAt: string;
  syncStatus: "synced" | "pending" | "local";
}

export interface FerryExtras {
  transitDiet: number;
  cabinOvernight: number;
  countryChange: boolean;
}

export interface FerryInterruption {
  start: string;
  end: string | null;
}

export interface LegalSummaryStored {
  status: "legal" | "advertencia" | "infraccion";
  infractions: Array<{ code: string; severity: string; description: string }>;
  warnings: Array<{ code: string; description: string }>;
  conduccionSemanalMin: number;
  conduccionBisemanalMin: number;
  extensiones10hSemana: number;
  descansosReducidosSemana: number;
  splitRestDetected?: boolean;
  splitRestFirstPartMin?: number | null;
  splitRestSecondPartMin?: number | null;
  countsAsReducedRest?: boolean;
}

export interface Compensacion {
  id: string;
  jornadaId: string | null;
  horasDeuda: number;
  minutosDeuda: number;
  fechaLimite: string;
  compensada: boolean;
  fechaCompensacion: string | null;
  sourceRestStartAt?: string | null;
  sourceRestEndAt?: string | null;
  sourceRestDurationMin?: number | null;
  sourceRestLegalType?: "weekly_normal" | "weekly_reduced" | "weekly_invalid" | null;
  sourceRestLocationStart?: string | null;
  sourceRestLocationEnd?: string | null;
  sourceRestInBase?: "in_base" | "out_of_base" | "unknown" | null;
  sourceRestDistanceKm?: number | null;
  sourceRestObservations?: string | null;
  recoveredInJornadaId?: string | null;
  recoveryRestStartAt?: string | null;
  recoveryRestEndAt?: string | null;
  recoveryRestDurationMin?: number | null;
  updatedAt: string;
  syncStatus: "synced" | "pending" | "local";
}

export interface CompensacionAgregada {
  ids: string[];
  totalDeudaHoras: number;
  totalDeudaMinutos: number;
  fechaPrimerReducido: string | null;
  fechaLimite: string;
  vencida: boolean;
  detalle: Array<{
    id: string;
    horasDeuda: number;
    minutosDeuda: number;
    fechaDescanso: string;
  }>;
}

export interface EstadoLegal {
  conduccionSemanalMin: number;
  conduccionBisemanalMin: number;
  maxSemanalMin: number;
  maxBisemanalMin: number;
  restanteSemanalMin: number;
  restanteBisemanalMin: number;
  extensiones10h: number;
  maxExtensiones: number;
  descansosReducidos: number;
  maxDescansosReducidos: number;
  disponibilidadMin: number;
  compensacionAgregada: CompensacionAgregada | null;
  alertas: Array<{
    tipo: "info" | "warning" | "danger";
    mensaje: string;
  }>;
}

const DIETAS = {
  INTERNACIONAL: { "100": 72.77, "60": 43.66, "30": 21.83 },
  NACIONAL: { "100": 54.3, "60": 32.58, "30": 16.29 },
} as const;

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function formatDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatFechaES(dateStr: string): string {
  const m = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(dateStr || "");
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return formatDateStr(d);
}

/**
 * Extrae "YYYY-MM-DD" de cualquier string de fecha/ISO (puede ser
 * "2026-08-31" solo fecha o "2026-08-31T22:15:00.000Z" ISO completo).
 * Úsalo para obtener la fecha base del FIN de descanso y sumar 14 días
 * (plazo legal Art. 8.6 Reg. 561/2006 según última regla del usuario).
 */
export function extractYyyyMmDd(isoOrDate: string | null | undefined): string | null {
  if (!isoOrDate) return null;
  const m = String(isoOrDate).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * Calcula la FECHA LÍMITE canónica para compensar un descanso semanal reducido,
 * según regla VERBATIM del usuario:
 *   "la fecha limite para compensacion es 14 dias desde el fin descanso
 *    que ha generado la compensacion"
 *
 * Orden de preferencia para el origen (fin descanso):
 *   1. sourceRestEndAt          (campo Compensacion)
 *   2. previousRestEndAt        (campo Jornada, si tenemos la jornada ligada)
 *   3. fechaInicio de la jornada (fallback lo más cercano posible si se desconoce
 *                                 el fin del descanso)
 *   4. hoy+14d                  (si no hay nada más, no penalizar vencida al instante)
 */
function calculateCompensationDeadline(params: {
  sourceRestEndAt?: string | null;
  jornadaPreviousRestEndAt?: string | null;
  fechaInicioJornada?: string | null;
  hoyStr?: string;
}): string {
  const candidate =
    extractYyyyMmDd(params.sourceRestEndAt) ??
    extractYyyyMmDd(params.jornadaPreviousRestEndAt) ??
    extractYyyyMmDd(params.fechaInicioJornada) ??
    params.hoyStr ??
    extractYyyyMmDd(new Date().toISOString())!;
  return addDays(candidate, 14);
}

/**
 * Ventana retrospectiva de inspección/policía (52 días hacia atrás).
 * Cualquier compensación con LA JORNADA ASOCIADA (fechaInicio) ANTERIOR a este umbral
 * se considera FUERA DE VIGILANCIA ACTIVA:
 *   → NO suma en "Total a compensar"
 *   → NO muestra infracción/advertencia en banner/dashboard
 *   → SI se conserva en base de datos (consulta manual por el usuario).
 *
 * Coincide con lo que dice el usuario: "...en un control la policia revisa
 * 52dias hacia atras."
 */
const POLICIA_VENTANA_DIAS = 52;
function policeWindowStart(dateRef: Date = new Date()): string {
  const iso = formatUTCDateStr(dateRef);
  return addDays(iso, -POLICIA_VENTANA_DIAS);
}
function isCompWithinPoliceWindow(
  c: Compensacion,
  allJornadas: Jornada[],
  dateRef: Date = new Date(),
): boolean {
  if (c.compensada) return false;
  const start = policeWindowStart(dateRef);
  if (c.jornadaId) {
    const j = allJornadas.find((x) => x.id === c.jornadaId);
    if (j) return j.fechaInicio >= start;
  }
  // fallback: si no hay jornada asociada, usamos fechaLimite para no perder
  return c.fechaLimite >= start;
}

/**
 * Semana natural UTC (lunes 00:00 -> domingo 23:59).
 * Usado para agrupar descansos semanales reducidos: dentro de una MISMA SEMANA
 * solo el ÚLTIMO de ellos genera deuda compensable.
 */
function getUtcWeekMonday(iso: string): string {
  const d = new Date(iso);
  const day = d.getUTCDay(); // 0=domingo, 1=lunes, ..., 6=sábado
  const offset = day === 0 ? 6 : day - 1; // days since monday
  const monday = new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() - offset,
  ));
  return formatUTCDateStr(monday);
}
function sameUtcWeek(aIso: string, bIso: string): boolean {
  return getUtcWeekMonday(aIso) === getUtcWeekMonday(bIso);
}

async function loadBaseLocationConfigFromSettings(): Promise<BaseLocationConfig> {
  try {
    const raw = await getItemScoped("tacoplan_user_settings");
    const settings = raw ? JSON.parse(raw) : {};
    return buildBaseLocationConfig({
      baseName: settings.base_name ?? null,
      baseCity: settings.base_city ?? null,
      baseCountry: settings.base_country ?? null,
      baseAddress: settings.base_address ?? null,
      baseLatitude: settings.base_latitude ?? null,
      baseLongitude: settings.base_longitude ?? null,
      baseRadiusKm: settings.base_radius_km ?? null,
      baseConfiguredAt: settings.base_configured_at ?? null,
      baseUpdatedAt: settings.base_updated_at ?? null,
    });
  } catch {
    return buildBaseLocationConfig();
  }
}

function buildPreviousRestFields(params: {
  restStartAt: string | null;
  restEndAt: string | null;
  restStartLocation?: string | null;
  restEndLocation?: string | null;
  assessment?: WeeklyRestAssessment | null;
}): Pick<
  Jornada,
  | "previousRestStartAt"
  | "previousRestEndAt"
  | "previousRestLegalType"
  | "previousRestStartLocation"
  | "previousRestEndLocation"
  | "previousRestInBase"
  | "previousRestDistanceKm"
  | "previousRestCompGeneratedMin"
  | "previousRestCompUsedMin"
  | "previousRestObservations"
> {
  return {
    previousRestStartAt: params.restStartAt,
    previousRestEndAt: params.restEndAt,
    previousRestLegalType: params.assessment?.legalType ?? null,
    previousRestStartLocation: params.restStartLocation?.trim() || null,
    previousRestEndLocation: params.restEndLocation?.trim() || null,
    previousRestInBase: params.assessment?.locationStatus ?? null,
    previousRestDistanceKm: params.assessment?.distanceKm ?? null,
    previousRestCompGeneratedMin: params.assessment?.compensationGeneratedMin ?? null,
    previousRestCompUsedMin: 0,
    previousRestObservations: params.assessment?.warning ?? null,
  };
}

function buildIsoTimestamp(fecha: string, hora: string): string {
  return `${fecha}T${hora}:00`;
}

function parseTimeToMinutes(hhmm: string | null | undefined): number | null {
  const raw = (hhmm || "").trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h < 0 || h > 23) return null;
  if (min < 0 || min > 59) return null;
  return h * 60 + min;
}

function calcMinutesBetween(isoStart: string, isoEnd: string): number {
  const start = new Date(isoStart);
  const end = new Date(isoEnd);
  return Math.round((end.getTime() - start.getTime()) / 60000);
}

function clasificarDescanso(minutos: number): string {
  if (minutos < 9 * 60) return "INFRACCION_DESCANSO";
  if (minutos < 11 * 60) return "DESCANSO_DIARIO_REDUCIDO";
  if (minutos < 24 * 60) return "DESCANSO_DIARIO_COMPLETO";
  if (minutos < 45 * 60) return "DESCANSO_SEMANAL_REDUCIDO";
  return "DESCANSO_SEMANAL_COMPLETO";
}

export function calcDietaAuto(tipoRuta: string, pernocta: boolean): { items: DietaItem[]; total: number } {
  switch (tipoRuta) {
    case "NACIONAL":
      return pernocta
        ? { items: [{ tipo: "NACIONAL", pct: "100", importe: 54.30 }], total: 54.30 }
        : { items: [{ tipo: "NACIONAL", pct: "60", importe: 32.58 }], total: 32.58 };
    case "INTERNACIONAL":
      return pernocta
        ? { items: [{ tipo: "INTERNACIONAL", pct: "100", importe: 72.77 }], total: 72.77 }
        : { items: [{ tipo: "INTERNACIONAL", pct: "60", importe: 43.66 }], total: 43.66 };
    case "REGIONAL_INTL":
      return pernocta
        ? { items: [{ tipo: "INTERNACIONAL", pct: "100", importe: 72.77 }], total: 72.77 }
        : { items: [{ tipo: "INTERNACIONAL", pct: "60", importe: 43.66 }], total: 43.66 };
    case "NAC_INTL":
      return pernocta
        ? {
            items: [
              { tipo: "NACIONAL", pct: "60", importe: 32.58 },
              { tipo: "INTERNACIONAL", pct: "100", importe: 72.77 },
            ],
            total: 105.35,
          }
        : {
            items: [
              { tipo: "NACIONAL", pct: "60", importe: 32.58 },
              { tipo: "INTERNACIONAL", pct: "60", importe: 43.66 },
            ],
            total: 76.24,
          };
    case "NAC_REGIONAL":
      return pernocta
        ? {
            items: [
              { tipo: "NACIONAL", pct: "60", importe: 32.58 },
              { tipo: "REGIONAL", pct: "100", importe: 0 },
            ],
            total: 32.58,
          }
        : {
            items: [
              { tipo: "NACIONAL", pct: "60", importe: 32.58 },
              { tipo: "REGIONAL", pct: "60", importe: 0 },
            ],
            total: 32.58,
          };
    case "NINGUNO":
      return { items: [], total: 0 };
    case "REGIONAL":
      return pernocta
        ? { items: [{ tipo: "REGIONAL", pct: "100", importe: 0 }], total: 0 }
        : { items: [{ tipo: "REGIONAL", pct: "60", importe: 0 }], total: 0 };
    default:
      return { items: [], total: 0 };
  }
}

function calcDietaManual(
  tipo: "NACIONAL" | "INTERNACIONAL",
  pct: "100" | "60" | "30",
): { items: DietaItem[]; total: number } {
  const importe = DIETAS[tipo][pct];
  return {
    items: [{ tipo, pct, importe }],
    total: importe,
  };
}

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getSundayOfWeek(date: Date): Date {
  const monday = getMondayOfWeek(date);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return sunday;
}

function getMondayOfUtcWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  d.setUTCDate(diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function getSundayOfUtcWeek(date: Date): Date {
  const monday = getMondayOfUtcWeek(date);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);
  return sunday;
}

function formatUTCDateStr(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function getJornadaUtcStartDateStr(j: Jornada): string {
  return formatUTCDateStr(new Date(j.startAt || `${j.fechaInicio}T${j.horaInicio || "00:00"}:00`));
}

async function getAllJornadas(): Promise<Jornada[]> {
  const raw = await getItemScoped(JORNADAS_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return parsed.map(migrateJornada);
}

function migrateJornada(j: any): Jornada {
  const migrated: Jornada = {
    ...j,
    lugarInicio: normalizeLocationText(j.lugarInicio || ""),
    lugarFin: j.lugarFin ? normalizeLocationText(j.lugarFin) : null,
    startAt: j.startAt || buildIsoTimestamp(j.fechaInicio, j.horaInicio),
    endAt: j.endAt || (j.fechaFin && j.horaFin ? buildIsoTimestamp(j.fechaFin, j.horaFin) : null),
    dietasItems: j.dietasItems || null,
    dietaPercent: j.dietaPercent ?? null,
    dayFlag: j.dayFlag ?? null,
    dayExtraEur: j.dayExtraEur ?? null,
    dietBaseEur: j.dietBaseEur ?? null,
    dietRule: j.dietRule ?? null,
    dietCalculatedAt: j.dietCalculatedAt ?? null,
    conduccionDomingoMin: j.conduccionDomingoMin ?? null,
    conduccionLunesMin: j.conduccionLunesMin ?? null,
    countsAsDailyReduced: j.countsAsDailyReduced || false,
    observaciones: j.observaciones ?? null,
    legalSummary: j.legalSummary || null,
    moroccoPaymentMode: j.moroccoPaymentMode ?? null,
    moroccoTripRate: j.moroccoTripRate ?? null,
    moroccoPernightRate: j.moroccoPernightRate ?? null,
    ferryPending: j.ferryPending ?? false,
    ferryDestination: j.ferryDestination ?? null,
    ferryExtras: j.ferryExtras ?? null,
    ferryInterruptions: j.ferryInterruptions ?? null,
    ferryRestCompleted: j.ferryRestCompleted ?? false,
    ferryRestType: j.ferryRestType ?? null,
    splitRestDetected: j.splitRestDetected ?? false,
    splitRestFirstPartMin: j.splitRestFirstPartMin ?? null,
    splitRestSecondPartMin: j.splitRestSecondPartMin ?? null,
    countsAsReducedRest: j.countsAsReducedRest ?? true,
    paymentMode: j.paymentMode ?? null,
    kmInicio: j.kmInicio ?? null,
    kmFin: j.kmFin ?? null,
    kmTotal: j.kmTotal ?? null,
    pricePerKm: j.pricePerKm ?? null,
    importeKm: j.importeKm ?? null,
    pricePerTrip: j.pricePerTrip ?? null,
    importeViaje: j.importeViaje ?? null,
    reportHideAmounts: j.reportHideAmounts ?? false,
    reportHidePluses: j.reportHidePluses ?? false,
    previousRestStartAt: j.previousRestStartAt ?? null,
    previousRestEndAt: j.previousRestEndAt ?? null,
    previousRestLegalType: j.previousRestLegalType ?? null,
    previousRestStartLocation: j.previousRestStartLocation ?? null,
    previousRestEndLocation: j.previousRestEndLocation ?? null,
    previousRestInBase: j.previousRestInBase ?? null,
    previousRestDistanceKm: j.previousRestDistanceKm ?? null,
    previousRestPerformedInVehicle: j.previousRestPerformedInVehicle ?? null,
    previousRestAccommodation: j.previousRestAccommodation ?? null,
    previousRestCompGeneratedMin: j.previousRestCompGeneratedMin ?? null,
    previousRestCompUsedMin: j.previousRestCompUsedMin ?? null,
    previousRestObservations: j.previousRestObservations ?? null,
    updatedAt: j.updatedAt || new Date().toISOString(),
    syncStatus: j.syncStatus || "local",
  };

  if (migrated.fechaFin && migrated.dietaImporteEur && !migrated.dietCalculatedAt) {
    const base = migrated.dietaImporteEur;
    const extra = migrated.dayExtraEur || "0";
    migrated.dietBaseEur = (parseFloat(base) - parseFloat(extra)).toFixed(2);
    const rParts: string[] = [];
    if (migrated.dietaModo === "MANUAL" && migrated.dietaManualTipo) {
      rParts.push(`${migrated.dietaManualTipo} ${migrated.dietaManualPct || "100"}%`);
    } else if (migrated.tipoRuta) {
      rParts.push(`${migrated.tipoRuta} ${migrated.dietaPercent ?? 100}%`);
    }
    if (migrated.dayFlag) rParts.push(`+ ${migrated.dayFlag}`);
    migrated.dietRule = rParts.join(" ") || null;
    migrated.dietCalculatedAt = migrated.updatedAt || new Date().toISOString();
  }

  // #region debug-point D:local-migrate
  if (
    migrated.fechaInicio !== j?.fechaInicio ||
    migrated.horaInicio !== j?.horaInicio ||
    migrated.fechaFin !== j?.fechaFin ||
    migrated.horaFin !== j?.horaFin ||
    migrated.startAt !== j?.startAt ||
    migrated.endAt !== j?.endAt
  ) {
    reportJornadaDateDebug("D", "local-storage:migrateJornada", "migrated jornada changed date-related fields", {
      jornadaId: migrated.id,
      before: {
        fechaInicio: j?.fechaInicio ?? null,
        horaInicio: j?.horaInicio ?? null,
        fechaFin: j?.fechaFin ?? null,
        horaFin: j?.horaFin ?? null,
        startAt: j?.startAt ?? null,
        endAt: j?.endAt ?? null,
      },
      after: {
        fechaInicio: migrated.fechaInicio,
        horaInicio: migrated.horaInicio,
        fechaFin: migrated.fechaFin,
        horaFin: migrated.horaFin,
        startAt: migrated.startAt,
        endAt: migrated.endAt,
      },
    });
  }
  // #endregion

  return migrated;
}

async function saveAllJornadas(list: Jornada[]): Promise<void> {
  await setItemScoped(JORNADAS_KEY, JSON.stringify(list));
}

export async function replaceImportedJornadas(list: Jornada[]): Promise<void> {
  await saveAllJornadas(list);
}

function buildStoredLegalSummary(jornada: Jornada, legalResult: ReturnType<typeof evaluateJornada>): LegalSummaryStored {
  return {
    status: legalResult.status,
    infractions: legalResult.infractions,
    warnings: legalResult.warnings,
    conduccionSemanalMin: legalResult.conduccionSemanalMin,
    conduccionBisemanalMin: legalResult.conduccionBisemanalMin,
    extensiones10hSemana: legalResult.extensiones10hSemana,
    descansosReducidosSemana: legalResult.descansosReducidosSemana,
    splitRestDetected: jornada.splitRestDetected,
    splitRestFirstPartMin: jornada.splitRestFirstPartMin,
    splitRestSecondPartMin: jornada.splitRestSecondPartMin,
    countsAsReducedRest: jornada.countsAsReducedRest,
  };
}

export async function loadDietDerivationContext(): Promise<{
  customRates: UserDietRate[] | null;
  dayExtras: UserDayExtras;
  holidays: string[];
}> {
  const defaults: UserDayExtras = {
    extra_saturday: 0,
    extra_sunday: 0,
    extra_holiday: 0,
    offsite_weekly_reduced_nacional: 0,
    offsite_weekly_reduced_internacional: 0,
    offsite_weekly_complete_nacional: 0,
    offsite_weekly_complete_internacional: 0,
  };
  const parseNumberSafe = (value: unknown): number => {
    const parsed = parseFloat(String(value ?? "0").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  let settings: Record<string, unknown> = {};
  let holidays: string[] = [];

  try {
    const settingsRaw = await getItemScoped("tacoplan_user_settings");
    settings = settingsRaw ? JSON.parse(settingsRaw) : {};
  } catch {}

  try {
    const holidaysRaw = await getItemScoped("tacoplan_user_holidays_cache");
    const parsed = holidaysRaw ? JSON.parse(holidaysRaw) : [];
    holidays = Array.isArray(parsed)
      ? parsed
          .map((item) => (typeof item === "string" ? item : item?.date))
          .filter((item): item is string => /^\d{4}-\d{2}-\d{2}$/.test(String(item || "")))
      : [];
  } catch {}

  const parseRate = (value: unknown, fallback: number): number => {
    if (value === null || value === undefined || String(value).trim() === "") return fallback;
    const parsed = parseFloat(String(value).replace(",", "."));
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const customRates: UserDietRate[] = [
    { trip_type: "NACIONAL", percent: 100, amount: parseRate(settings.nac_100, 54.30) },
    { trip_type: "NACIONAL", percent: 60, amount: parseRate(settings.nac_60, 32.58) },
    { trip_type: "NACIONAL", percent: 30, amount: parseRate(settings.nac_30, 16.29) },
    { trip_type: "INTERNACIONAL", percent: 100, amount: parseRate(settings.intl_100, 72.77) },
    { trip_type: "INTERNACIONAL", percent: 60, amount: parseRate(settings.intl_60, 43.66) },
    { trip_type: "INTERNACIONAL", percent: 30, amount: parseRate(settings.intl_30, 21.83) },
    { trip_type: "REGIONAL", percent: 100, amount: parseRate(settings.reg_100, 0) },
    { trip_type: "REGIONAL", percent: 60, amount: parseRate(settings.reg_60, 0) },
    { trip_type: "REGIONAL", percent: 30, amount: parseRate(settings.reg_30, 0) },
  ];

  return {
    customRates,
    dayExtras: {
      ...defaults,
      extra_saturday: parseNumberSafe(settings.extra_saturday),
      extra_sunday: parseNumberSafe(settings.extra_sunday),
      extra_holiday: parseNumberSafe(settings.extra_holiday),
      offsite_weekly_reduced_nacional: parseNumberSafe(settings.offsite_weekly_reduced_nacional),
      offsite_weekly_reduced_internacional: parseNumberSafe(settings.offsite_weekly_reduced_internacional),
      offsite_weekly_complete_nacional: parseNumberSafe(settings.offsite_weekly_complete_nacional),
      offsite_weekly_complete_internacional: parseNumberSafe(settings.offsite_weekly_complete_internacional),
    },
    holidays,
  };
}

function shouldBackfillImportedDiet(jornada: Jornada): boolean {
  const paymentMode = jornada.paymentMode || "dietas";
  if (paymentMode !== "dietas") return false;
  if (!jornada.fechaFin || !jornada.horaFin || !jornada.lugarFin) return false;
  const hasItems = Array.isArray(jornada.dietasItems) && jornada.dietasItems.length > 0;
  return !jornada.dietaImporteEur || !jornada.dietBaseEur || !hasItems;
}

export async function prepareImportedJornadasForStorage(imported: Jornada[], existingBase?: Jornada[]): Promise<Jornada[]> {
  const base = (existingBase || await getAllJornadas()).map(migrateJornada);
  const comps = await getAllCompensaciones();
  const dietContext = await loadDietDerivationContext();
  const ordered = [...imported].map(migrateJornada).sort((a, b) => a.startAt.localeCompare(b.startAt));
  const prepared: Jornada[] = [];

  for (const raw of ordered) {
    let jornada: Jornada = {
      ...raw,
      lugarInicio: normalizeLocationText(raw.lugarInicio || ""),
      lugarFin: raw.lugarFin ? normalizeLocationText(raw.lugarFin) : null,
      updatedAt: raw.updatedAt || new Date().toISOString(),
      syncStatus: "pending",
    };

    const previous = findPreviousClosed([...base, ...prepared], jornada.startAt);
    if (previous && previous.endAt) {
      jornada.descansoAnteriorMin = calcMinutesBetween(previous.endAt, jornada.startAt);
      if (isSplitDailyRestGapComplete(jornada.descansoAnteriorMin, previous)) {
        jornada.tipoDescansoAnterior = "DESCANSO_DIARIO_COMPLETO";
      } else {
        jornada.tipoDescansoAnterior = clasificarDescanso(jornada.descansoAnteriorMin);
      }
      jornada.previousRestSource = "normal_gap";
      jornada.previousRestId = null;
      jornada.previousRestValid = null;
    } else {
      jornada.descansoAnteriorMin = null;
      jornada.tipoDescansoAnterior = null;
      jornada.previousRestSource = "normal_gap";
      jornada.previousRestId = null;
      jornada.previousRestValid = null;
    }

    if (shouldBackfillImportedDiet(jornada)) {
      const derived = computeDerivedFields(jornada, [...base, ...prepared], {
        fechaFin: jornada.fechaFin!,
        horaFin: jornada.horaFin!,
        lugarFin: jornada.lugarFin!,
        tipoRuta: jornada.tipoRuta || undefined,
        pernocta: jornada.pernocta ?? false,
        dietaModo: jornada.dietaModo || undefined,
        dietaManualTipo: jornada.dietaManualTipo || undefined,
        dietaManualPct: jornada.dietaManualPct || undefined,
        conduccionMin: jornada.conduccionMin ?? undefined,
        conduccionDomingoMin: jornada.conduccionDomingoMin ?? undefined,
        conduccionLunesMin: jornada.conduccionLunesMin ?? undefined,
        dietaPercent: jornada.dietaPercent ?? undefined,
        dayFlag: jornada.dayFlag ?? "NINGUNO",
        customRates: dietContext.customRates ?? undefined,
        dayExtras: dietContext.dayExtras,
        holidays: dietContext.holidays,
        observaciones: jornada.observaciones || undefined,
        paymentMode: jornada.paymentMode ?? undefined,
        kmInicio: jornada.kmInicio ?? null,
        kmFin: jornada.kmFin ?? null,
        pricePerKm: jornada.pricePerKm ?? null,
        pricePerTrip: jornada.pricePerTrip ?? null,
        importeViaje: jornada.importeViaje ?? null,
      });
      jornada = {
        ...jornada,
        dietaModo: jornada.dietaModo ?? derived.dietaModo ?? null,
        dietaImporteEur: jornada.dietaImporteEur ?? derived.dietaImporteEur ?? null,
        dietasItems: (Array.isArray(jornada.dietasItems) && jornada.dietasItems.length > 0)
          ? jornada.dietasItems
          : (derived.dietasItems ?? null),
        dietaPercent: jornada.dietaPercent ?? derived.dietaPercent ?? null,
        dayFlag: jornada.dayFlag ?? derived.dayFlag ?? null,
        dayExtraEur: jornada.dayExtraEur ?? derived.dayExtraEur ?? null,
        dietBaseEur: jornada.dietBaseEur ?? derived.dietBaseEur ?? null,
        dietRule: jornada.dietRule ?? derived.dietRule ?? null,
        dietCalculatedAt: jornada.dietCalculatedAt ?? derived.dietCalculatedAt ?? null,
      };
    }

    const legalResult = evaluateJornada(jornada, [...base, ...prepared], comps);
    jornada.legalSummary = buildStoredLegalSummary(jornada, legalResult);
    prepared.push(jornada);
  }

  return prepared;
}

export async function upsertJornadasImported(jornadas: Jornada[]): Promise<{ added: number; skipped: number }> {
  if (jornadas.length === 0) return { added: 0, skipped: 0 };
  const all = await getAllJornadas();
  const map = new Map<string, Jornada>();
  for (const j of all) map.set(j.id, j);
  let added = 0;
  let skipped = 0;
  let changed = false;

  for (const j of jornadas) {
    if (!j.id) continue;
    if (map.has(j.id)) {
      skipped++;
      continue;
    }
    map.set(j.id, j);
    added++;
    changed = true;
  }

  if (changed) await saveAllJornadas(Array.from(map.values()));
  return { added, skipped };
}

async function getAllCompensaciones(): Promise<Compensacion[]> {
  const raw = await getItemScoped(COMPENSACIONES_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  const list: Compensacion[] = parsed.map(migrateCompensacion);

  // ================================================================
  // MIGRACIÓN one-shot compensaciones históricas mal calculadas.
  // Una vez corrige, guarda y no vuelve a tocar si ya están OK.
  // ================================================================
  let changed = false;
  const now = new Date().toISOString();

  // 1) Desmarcar compensaciones "compensadas=true" SOLAMENTE SI FUERON
  //    MARCADAS POR EL ALGORITMO ANTIGUO ERRÓNEO.
  //    CRITERIO DE INVIOLABILIDAD:
  //      Si recoveredInJornadaId == null → MARCADA MANUALMENTE POR USUARIO.
  //                                           NUNCA LA TOCAMOS (prevalece el usuario).
  //      Si recoveredInJornadaId != null → marcada por el código automático.
  //    Umbral LEGAL correcto: recoveryRestDurationMin >= 24h + deudaMin de C/U.
  for (const c of list) {
    if (!c.compensada) continue;
    // 👉 MARCA MANUAL DE USUARIO: NO TOCAR NUNCA.
    if (c.recoveredInJornadaId == null) continue;
    // 👉 Aquí sólo llega lo marcado automáticamente.
    const deudaMin = c.horasDeuda * 60 + c.minutosDeuda;
    const umbralLegalMin = 24 * 60 + deudaMin;  // semanal minimo (24h) + deuda que compensa
    if (deudaMin > 0 && (c.recoveryRestDurationMin == null || c.recoveryRestDurationMin < umbralLegalMin)) {
      c.compensada = false;
      c.fechaCompensacion = null;
      c.recoveredInJornadaId = null;
      c.recoveryRestStartAt = null;
      c.recoveryRestEndAt = null;
      c.recoveryRestDurationMin = null;
      c.updatedAt = now;
      c.syncStatus = "pending";
      changed = true;
    }
  }

  // 2) Mergear compensaciones PENDIENTES duplicadas: misma fechaLimite →
  //    conservar la más antigua, acumular horasDeuda y minutosDeuda, borrar resto.
  //    NO TOCAMOS LAS COMPENSADAS (ni manuales ni automáticas).
  const byFechaLimite = new Map<string, Compensacion[]>();
  for (const c of list) {
    if (c.compensada) continue;
    const key = c.fechaLimite;
    const arr = byFechaLimite.get(key) ?? [];
    arr.push(c);
    byFechaLimite.set(key, arr);
  }
  const mergedIdsToRemove = new Set<string>();
  for (const [, group] of byFechaLimite) {
    if (group.length <= 1) continue;
    // Ordenamos por updatedAt ASC (primero = más viejo)
    group.sort((a, b) => (a.updatedAt ?? "").localeCompare(b.updatedAt ?? ""));
    const keeper = group[0];
    let totalMin = keeper.horasDeuda * 60 + keeper.minutosDeuda;
    for (let i = 1; i < group.length; i++) {
      totalMin += group[i].horasDeuda * 60 + group[i].minutosDeuda;
      mergedIdsToRemove.add(group[i].id);
    }
    keeper.horasDeuda = Math.floor(totalMin / 60);
    keeper.minutosDeuda = totalMin % 60;
    keeper.updatedAt = now;
    keeper.syncStatus = "pending";
    changed = true;
  }
  const mergedCleaned: Compensacion[] = list.filter(c => !mergedIdsToRemove.has(c.id));

  // 3) Recalcular TODAS las compensaciones pendientes al nuevo cálculo VERBATIM:
  //    "fecha limite para compensacion es 14 dias desde el fin descanso
  //     que ha generado la compensacion".
  //
  //    Esto corrige tanto los viejos "fechaInicio+14d" como los posteriores
  //    "fechaInicio+21d" (fases anteriores). NO TOCAMOS COMPENSADAS (manual o
  //    algoritmo, su fecha límite no es relevante).
  const hoy = formatUTCDateStr(new Date());
  let jornadasForDeadline: Jornada[] | null = null;
  for (const c of mergedCleaned) {
    if (c.compensada) continue;
    let jPrevRestEndAt: string | null = null;
    let jFechaInicio: string | null = null;
    if (c.jornadaId) {
      if (jornadasForDeadline === null) {
        try { jornadasForDeadline = await getAllJornadas(); } catch { jornadasForDeadline = []; }
      }
      const j = jornadasForDeadline.find(x => x.id === c.jornadaId);
      if (j) {
        jPrevRestEndAt = j.previousRestEndAt ?? null;
        jFechaInicio = j.fechaInicio ?? null;
      }
    }
    const nuevoLimite = calculateCompensationDeadline({
      sourceRestEndAt: c.sourceRestEndAt,
      jornadaPreviousRestEndAt: jPrevRestEndAt,
      fechaInicioJornada: jFechaInicio,
      hoyStr: hoy,
    });
    if (nuevoLimite !== c.fechaLimite) {
      c.fechaLimite = nuevoLimite;
      c.updatedAt = now;
      c.syncStatus = "pending";
      changed = true;
    }
  }

  // 4) SANITY CHECK fechaLimite ABSURDA (bug 2028 detectado en UI):
  //    Si fechaLimite > hoy + 90 días → claramente un cálculo erróneo histórico.
  //    Forzamos calculateCompensationDeadline (14d desde fin descanso).
  //    NO TOCAMOS COMPENSADAS.
  const hoyDate = new Date();
  const hoyStr = formatUTCDateStr(hoyDate);
  const futuro90d = new Date(hoyDate.getTime() + 90 * 24 * 3600 * 1000);
  const futuro90dStr = formatUTCDateStr(futuro90d);
  let loadedJornadasForNorm: Jornada[] | null = jornadasForDeadline; // reutilizar carga si ya la hicimos

  for (const c of mergedCleaned) {
    if (c.compensada) continue;
    if (c.fechaLimite > futuro90dStr) {
      if (loadedJornadasForNorm === null) {
        try { loadedJornadasForNorm = await getAllJornadas(); } catch { loadedJornadasForNorm = []; }
      }
      let jPrevRestEndAt: string | null = null;
      let jFechaInicio: string | null = null;
      if (c.jornadaId) {
        const j = loadedJornadasForNorm.find(x => x.id === c.jornadaId);
        if (j) {
          jPrevRestEndAt = j.previousRestEndAt ?? null;
          jFechaInicio = j.fechaInicio ?? null;
        }
      }
      const nuevoLimite = calculateCompensationDeadline({
        sourceRestEndAt: c.sourceRestEndAt,
        jornadaPreviousRestEndAt: jPrevRestEndAt,
        fechaInicioJornada: jFechaInicio,
        hoyStr: hoyStr,
      });
      if (nuevoLimite !== c.fechaLimite) {
        c.fechaLimite = nuevoLimite;
        c.updatedAt = now;
        c.syncStatus = "pending";
        changed = true;
      }
    }
  }

  // 5) NORMALIZACIÓN MISMA SEMANA + PRIMERO-EN-BASE:
  //    Ejecutamos aquí para que el dashboard lea la lista limpia SIN necesidad
  //    de cerrar una jornada (antes esto sólo ocurría en processCompensaciones).
  if (loadedJornadasForNorm === null) {
    try { loadedJornadasForNorm = await getAllJornadas(); } catch { loadedJornadasForNorm = []; }
  }
  const normalized = await normalizeHistoricalCompensaciones(mergedCleaned, loadedJornadasForNorm);
  if (normalized) changed = true;

  if (changed) {
    await saveAllCompensaciones(mergedCleaned);
    return mergedCleaned;
  }
  return mergedCleaned;
}

export async function listarCompensaciones(): Promise<Compensacion[]> {
  return getAllCompensaciones();
}

function migrateCompensacion(c: any): Compensacion {
  return {
    ...c,
    sourceRestStartAt: c.sourceRestStartAt ?? null,
    sourceRestEndAt: c.sourceRestEndAt ?? null,
    sourceRestDurationMin: c.sourceRestDurationMin ?? null,
    sourceRestLegalType: c.sourceRestLegalType ?? null,
    sourceRestLocationStart: c.sourceRestLocationStart ?? null,
    sourceRestLocationEnd: c.sourceRestLocationEnd ?? null,
    sourceRestInBase: c.sourceRestInBase ?? null,
    sourceRestDistanceKm: c.sourceRestDistanceKm ?? null,
    sourceRestObservations: c.sourceRestObservations ?? null,
    recoveredInJornadaId: c.recoveredInJornadaId ?? null,
    recoveryRestStartAt: c.recoveryRestStartAt ?? null,
    recoveryRestEndAt: c.recoveryRestEndAt ?? null,
    recoveryRestDurationMin: c.recoveryRestDurationMin ?? null,
    updatedAt: c.updatedAt || new Date().toISOString(),
    syncStatus: c.syncStatus || "local",
  };
}

async function saveAllCompensaciones(list: Compensacion[]): Promise<void> {
  await setItemScoped(COMPENSACIONES_KEY, JSON.stringify(list));
}

function findPreviousClosed(allJornadas: Jornada[], beforeStartAt: string): Jornada | null {
  const closed = allJornadas
    .filter((j) => j.endAt && j.startAt < beforeStartAt)
    .sort((a, b) => (b.endAt || "").localeCompare(a.endAt || ""));
  return closed[0] || null;
}

export function findRate(customRates: UserDietRate[] | null, scope: string, pct: number): number {
  if (customRates && customRates.length > 0) {
    const found = customRates.find(r => r.trip_type === scope && r.percent === pct);
    if (found) return Number(found.amount);
  }
  const fallback: Record<string, Record<number, number>> = {
    NACIONAL: { 100: 54.30, 60: 32.58, 30: 16.29 },
    INTERNACIONAL: { 100: 72.77, 60: 43.66, 30: 21.83 },
    REGIONAL: { 100: 0, 60: 0, 30: 0 },
  };
  return fallback[scope]?.[pct] ?? 0;
}

export function resolveNaturalDayDietFinancials(
  nd: NaturalDayDietEntry,
  jornadas: Jornada[],
  customRates: UserDietRate[] | null,
  extrasCfg?: UserDayExtras | null,
): {
  dietAmount: number;
  plusItems: Array<{ concepto: string; amount: number; id: string }>;
  plusTotal: number;
} {
  const configured = findRate(customRates, nd.type, nd.percentage);
  const explicitPluses = Array.isArray(nd.plusItems)
    ? nd.plusItems
        .filter((p) => p && Number.isFinite(Number(p.amount)) && Number(p.amount) > 0)
        .map((p) => ({
          concepto: String(p.concepto || "Plus").trim() || "Plus",
          amount: Math.round(Number(p.amount) * 100) / 100,
          id: String(p.id || `${nd.date}_${p.concepto || "plus"}`),
        }))
    : [];

  const explicitPlusTotal = Math.round(
    explicitPluses.reduce((sum, p) => sum + p.amount, 0) * 100,
  ) / 100;

  const rawAmount = Number.isFinite(Number(nd.amount)) ? Number(nd.amount) : 0;
  const dietAmount =
    Number.isFinite(configured) && configured > 0
      ? Math.round(configured * 100) / 100
      : Math.max(0, Math.round((rawAmount - explicitPlusTotal) * 100) / 100);

  // Compatibilidad con registros antiguos: algunas dietas naturales guardaron
  // dieta + plus dentro de amount y dejaron plusItems vacío. Solo recuperamos
  // ese plus cuando la diferencia coincide con conceptos reales vinculados al
  // día (jornada anterior/siguiente o Domingo/Festivo). Nunca inventamos pluses.
  if (explicitPluses.length === 0) {
    const legacyExcess = Math.round((rawAmount - dietAmount) * 100) / 100;
    if (legacyExcess > 0.009) {
      const candidates: Array<{ concepto: string; amount: number; id: string }> = [];
      const linkedIds = new Set(
        [nd.previousJourneyId, nd.nextJourneyId].filter((id): id is string => Boolean(id)),
      );
      for (const j of jornadas) {
        if (!linkedIds.has(j.id)) continue;
        for (const p of j.plusItems || []) {
          const concepto = String(p.concepto || "Plus").trim() || "Plus";
          const normalizedConcept = concepto
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
          const isSecondDriverTraining =
            normalizedConcept.includes("formacion") &&
            (normalizedConcept.includes("seg") || normalizedConcept.includes("conductor"));
          if (!isSecondDriverTraining) continue;

          const amount = Math.round((Number(p.importe) || 0) * 100) / 100;
          if (amount <= 0) continue;
          candidates.push({
            concepto,
            amount,
            id: `legacy_${nd.date}_${j.id}_${String(p.concepto || "plus")}`,
          });
        }
      }
      if (nd.isDomingo === true && Number(extrasCfg?.extra_sunday || 0) > 0) {
        candidates.push({
          concepto: "Domingo",
          amount: Math.round(Number(extrasCfg!.extra_sunday) * 100) / 100,
          id: `legacy_${nd.date}_domingo`,
        });
      }
      if (nd.isFestivo === true && Number(extrasCfg?.extra_holiday || 0) > 0) {
        candidates.push({
          concepto: "Festivo",
          amount: Math.round(Number(extrasCfg!.extra_holiday) * 100) / 100,
          id: `legacy_${nd.date}_festivo`,
        });
      }

      // Busca una combinación pequeña que cuadre exactamente con el exceso.
      // Normalmente será un único plus (p.ej. Formación 14 €).
      const maxMask = Math.min(1 << Math.min(candidates.length, 12), 1 << 12);
      for (let mask = 1; mask < maxMask; mask++) {
        let sum = 0;
        const picked: typeof candidates = [];
        for (let i = 0; i < Math.min(candidates.length, 12); i++) {
          if ((mask & (1 << i)) === 0) continue;
          sum += candidates[i].amount;
          picked.push(candidates[i]);
        }
        if (Math.abs(sum - legacyExcess) < 0.011) {
          const plusTotal = Math.round(sum * 100) / 100;
          return { dietAmount, plusItems: picked, plusTotal };
        }
      }
    }
  }

  return {
    dietAmount,
    plusItems: explicitPluses,
    plusTotal: explicitPlusTotal,
  };
}

export function calcDietaWithCustomRates(
  tipoRuta: string,
  pernocta: boolean,
  dietaPercent: number | null,
  customRates: UserDietRate[] | null,
): { items: DietaItem[]; total: number } {
  switch (tipoRuta) {
    case "NACIONAL": {
      const pct = pernocta ? 100 : 60;
      const amount = findRate(customRates, "NACIONAL", pct);
      return { items: [{ tipo: "NACIONAL", pct: String(pct), importe: amount }], total: amount };
    }
    case "INTERNACIONAL": {
      const requested = dietaPercent || 100;
      const pct = pernocta ? requested : requested === 100 ? 60 : requested;
      const amount = findRate(customRates, "INTERNACIONAL", pct);
      return { items: [{ tipo: "INTERNACIONAL", pct: String(pct), importe: amount }], total: amount };
    }
    case "REGIONAL_INTL": {
      const amount = findRate(customRates, "INTERNACIONAL", 60);
      return { items: [{ tipo: "INTERNACIONAL", pct: "60", importe: amount }], total: amount };
    }
    case "NAC_INTL": {
      const nacAmount = findRate(customRates, "NACIONAL", 60);
      const intlAmount = findRate(customRates, "INTERNACIONAL", 60);
      return {
        items: [
          { tipo: "NACIONAL", pct: "60", importe: nacAmount },
          { tipo: "INTERNACIONAL", pct: "60", importe: intlAmount },
        ],
        total: nacAmount + intlAmount,
      };
    }
    case "NAC_REGIONAL": {
      const nacAmount = findRate(customRates, "NACIONAL", 60);
      const regPct = pernocta ? 100 : 60;
      const regAmount = findRate(customRates, "REGIONAL", regPct);
      return {
        items: [
          { tipo: "NACIONAL", pct: "60", importe: nacAmount },
          { tipo: "REGIONAL", pct: String(regPct), importe: regAmount },
        ],
        total: nacAmount + regAmount,
      };
    }
    case "NINGUNO":
      return { items: [], total: 0 };
    case "REGIONAL": {
      const pct = pernocta ? 100 : 60;
      const amount = findRate(customRates, "REGIONAL", pct);
      return { items: [{ tipo: "REGIONAL", pct: String(pct), importe: amount }], total: amount };
    }
    default:
      return { items: [], total: 0 };
  }
}

export function calcDietaManualWithRates(
  scope: "NACIONAL" | "INTERNACIONAL",
  pct: "100" | "60" | "30",
  customRates: UserDietRate[] | null,
): { items: DietaItem[]; total: number } {
  const amount = findRate(customRates, scope, Number(pct));
  return {
    items: [{ tipo: scope, pct, importe: amount }],
    total: amount,
  };
}

export function calcDayExtra(
  dayFlag: string | null,
  extras: UserDayExtras | null,
): number {
  if (!dayFlag || !extras) return 0;
  const safe = (v: any) => { const n = Number(v); return isNaN(n) ? 0 : n; };
  switch (dayFlag) {
    case "SABADO": return safe(extras.extra_saturday);
    case "DOMINGO": return safe(extras.extra_sunday);
    case "FESTIVO": return safe(extras.extra_holiday);
    default: return 0;
  }
}

function calcOffsiteWeeklyBaseRate(
  restType: DayExtraEntry["offsiteRestType"],
  base: DayExtraEntry["offsiteBase"],
  extras: UserDayExtras | null,
): number {
  if (!extras || !restType || !base) return 0;
  const safe = (v: any) => { const n = Number(v); return isNaN(n) ? 0 : n; };
  if (restType === "WEEKLY_REDUCED") {
    return base === "INTERNACIONAL"
      ? safe(extras.offsite_weekly_reduced_internacional)
      : safe(extras.offsite_weekly_reduced_nacional);
  }
  return base === "INTERNACIONAL"
    ? safe(extras.offsite_weekly_complete_internacional)
    : safe(extras.offsite_weekly_complete_nacional);
}

export function splitOffsiteWeeklyRestEntry(
  entry: DayExtraEntry,
  extras: UserDayExtras | null,
): { restAmount: number; plusAmount: number; totalAmount: number } {
  const stored = Number(entry.amount) || 0;
  const plusAmount =
    (entry.plusSunday ? calcDayExtra("DOMINGO", extras) : 0) +
    (entry.plusHoliday ? calcDayExtra("FESTIVO", extras) : 0);

  const baseRate = calcOffsiteWeeklyBaseRate(entry.offsiteRestType, entry.offsiteBase, extras);
  const totalRate = Math.round((baseRate + plusAmount) * 100) / 100;
  const storedRounded = Math.round(stored * 100) / 100;
  const diffBase = Math.abs(storedRounded - Math.round(baseRate * 100) / 100);
  const diffTotal = Math.abs(storedRounded - totalRate);

  if (storedRounded > 0 && plusAmount > 0 && baseRate > 0) {
    const candidateBase = Math.round((storedRounded - plusAmount) * 100) / 100;

    if (diffBase < 0.02) {
      const restAmount = storedRounded;
      const totalAmount = Math.round((restAmount + plusAmount) * 100) / 100;
      return { restAmount, plusAmount, totalAmount };
    }

    if (candidateBase > 0 && (Math.abs(candidateBase - baseRate) < 0.5 || storedRounded > baseRate + 0.02)) {
      const restAmount = Math.round(Math.max(0, candidateBase) * 100) / 100;
      return { restAmount, plusAmount, totalAmount: storedRounded };
    }

    if (diffTotal < diffBase && diffTotal < 0.02) {
      const restAmount = Math.round(Math.max(0, candidateBase) * 100) / 100;
      return { restAmount, plusAmount, totalAmount: storedRounded };
    }
  }

  const restAmount = storedRounded;
  const totalAmount = Math.round((restAmount + plusAmount) * 100) / 100;
  return { restAmount, plusAmount, totalAmount };
}

export function detectDayFlag(
  fechaFin: string,
  holidays: string[],
): string | null {
  const d = new Date(fechaFin + "T12:00:00");
  const dow = d.getDay();
  if (holidays.includes(fechaFin)) return "FESTIVO";
  if (dow === 6) return "SABADO";
  if (dow === 0) return "DOMINGO";
  return null;
}

function computeDerivedFields(
  jornada: Jornada,
  allOther: Jornada[],
  closeData: {
    fechaFin: string;
    horaFin: string;
    lugarFin: string;
    tipoRuta?: string;
    pernocta?: boolean;
    dietaModo?: string;
    dietaManualTipo?: string;
    dietaManualPct?: string;
    conduccionMin?: number | null;
    conduccionDomingoMin?: number | null;
    conduccionLunesMin?: number | null;
    dietaPercent?: number;
    dayFlag?: string;
    customRates?: UserDietRate[];
    dayExtras?: UserDayExtras;
    holidays?: string[];
    observaciones?: string | null;
    paymentMode?: "dietas" | "km" | "viaje";
    kmInicio?: number | null;
    kmFin?: number | null;
    kmTotal?: number | null;
    pricePerKm?: number | null;
    importeKm?: number | null;
    pricePerTrip?: number | null;
    importeViaje?: number | null;
  },
): Partial<Jornada> {
  const startAt = jornada.startAt;

  let resolvedFechaFin = closeData.fechaFin;
  if (resolvedFechaFin === jornada.fechaInicio) {
    const finMin = parseTimeToMinutes(closeData.horaFin);
    const startMin = parseTimeToMinutes(jornada.horaInicio);
    if (finMin != null && startMin != null && finMin < startMin) {
      resolvedFechaFin = addDays(resolvedFechaFin, 1);
    }
  }

  const endAt = buildIsoTimestamp(resolvedFechaFin, closeData.horaFin);
  const duracionJornadaMin = calcMinutesBetween(startAt, endAt);

  let descansoAnteriorMin: number | null = jornada.descansoAnteriorMin ?? null;
  let tipoDescansoAnterior: string | null = jornada.tipoDescansoAnterior ?? null;
  let previousRestSource = jornada.previousRestSource ?? null;
  let previousRestId = jornada.previousRestId ?? null;
  let previousRestValid = jornada.previousRestValid ?? null;

  if (previousRestSource !== "ferry_rest") {
    const anterior = findPreviousClosed(allOther, startAt);
    descansoAnteriorMin = null;
    tipoDescansoAnterior = null;
    previousRestSource = "normal_gap";
    previousRestId = null;
    previousRestValid = null;

    if (anterior && anterior.endAt) {
      descansoAnteriorMin = calcMinutesBetween(anterior.endAt, startAt);
      if (isSplitDailyRestGapComplete(descansoAnteriorMin, anterior)) {
        tipoDescansoAnterior = "DESCANSO_DIARIO_COMPLETO";
      } else {
        tipoDescansoAnterior = clasificarDescanso(descansoAnteriorMin);
      }
    }
  }

  const countsAsDailyReduced = false;

  let dietaResult: { items: DietaItem[]; total: number };
  if (closeData.dietaModo === "MANUAL" && closeData.dietaManualTipo && closeData.dietaManualPct) {
    dietaResult = calcDietaManualWithRates(
      closeData.dietaManualTipo as "NACIONAL" | "INTERNACIONAL",
      closeData.dietaManualPct as "100" | "60" | "30",
      closeData.customRates || null,
    );
  } else {
    dietaResult = calcDietaWithCustomRates(
      closeData.tipoRuta || "NINGUNO",
      closeData.pernocta ?? false,
      closeData.dietaPercent ?? null,
      closeData.customRates || null,
    );
  }

  let effectiveDietaPercent: number | null = closeData.dietaPercent ?? null;
  if (closeData.dietaModo !== "MANUAL") {
    if (dietaResult.items.length === 1) {
      const p = parseInt(dietaResult.items[0]?.pct || "", 10);
      effectiveDietaPercent = Number.isFinite(p) ? p : null;
    } else {
      effectiveDietaPercent = null;
    }
  }

  let resolvedDayFlag: string | null = null;
  if (closeData.dayFlag === "NINGUNO") {
    resolvedDayFlag = null;
  } else if (closeData.dayFlag) {
    resolvedDayFlag = closeData.dayFlag;
  } else {
    resolvedDayFlag = detectDayFlag(resolvedFechaFin, closeData.holidays || []);
  }

  const dayExtraAmount = calcDayExtra(resolvedDayFlag, closeData.dayExtras || null);
  const totalDieta = dietaResult.total + dayExtraAmount;

  const ruleParts: string[] = [];
  if (closeData.dietaModo === "MANUAL" && closeData.dietaManualTipo) {
    ruleParts.push(`${closeData.dietaManualTipo} ${closeData.dietaManualPct || "100"}%`);
  } else {
    if (dietaResult.items.length > 0) {
      ruleParts.push(dietaResult.items.map((it) => `${it.tipo} ${it.pct}%`).join(" + "));
    } else {
      ruleParts.push(`${closeData.tipoRuta} ${effectiveDietaPercent ?? 100}%`);
    }
  }
  if (resolvedDayFlag) {
    const flagLabels: Record<string, string> = { SABADO: "SABADO", DOMINGO: "DOMINGO", FESTIVO: "FESTIVO" };
    ruleParts.push(`+ ${flagLabels[resolvedDayFlag] || resolvedDayFlag}`);
  }
  const dietRule = ruleParts.join(" ");

  const resolvedKmInicio =
    closeData.kmInicio != null && Number.isFinite(closeData.kmInicio)
      ? closeData.kmInicio
      : (jornada.kmInicio != null && Number.isFinite(jornada.kmInicio) ? jornada.kmInicio : null);

  return {
    fechaFin: resolvedFechaFin,
    horaFin: closeData.horaFin,
    lugarFin: closeData.lugarFin,
    endAt,
    tipoRuta: closeData.tipoRuta || "NINGUNO",
    pernocta: closeData.pernocta ?? false,
    dietaModo: closeData.dietaModo || "spain_diet",
    dietaManualTipo: closeData.dietaManualTipo || null,
    dietaManualPct: closeData.dietaManualPct || null,
    dietaImporteEur: totalDieta.toFixed(2),
    dietasItems: dietaResult.items,
    dietaPercent: effectiveDietaPercent,
    dayFlag: resolvedDayFlag,
    dayExtraEur: resolvedDayFlag ? dayExtraAmount.toFixed(2) : null,
    dietBaseEur: dietaResult.total.toFixed(2),
    dietRule,
    dietCalculatedAt: new Date().toISOString(),
    descansoAnteriorMin,
    tipoDescansoAnterior,
    previousRestSource,
    previousRestId,
    previousRestValid,
    previousRestStartAt: jornada.previousRestStartAt ?? null,
    previousRestEndAt: jornada.previousRestEndAt ?? null,
    previousRestLegalType: jornada.previousRestLegalType ?? null,
    previousRestStartLocation: jornada.previousRestStartLocation ?? null,
    previousRestEndLocation: jornada.previousRestEndLocation ?? null,
    previousRestInBase: jornada.previousRestInBase ?? null,
    previousRestDistanceKm: jornada.previousRestDistanceKm ?? null,
    previousRestPerformedInVehicle: jornada.previousRestPerformedInVehicle ?? null,
    previousRestAccommodation: jornada.previousRestAccommodation ?? null,
    previousRestCompGeneratedMin: jornada.previousRestCompGeneratedMin ?? null,
    previousRestCompUsedMin: jornada.previousRestCompUsedMin ?? null,
    previousRestObservations: jornada.previousRestObservations ?? null,
    duracionJornadaMin,
    countsAsDailyReduced,
    paymentMode: closeData.paymentMode ?? jornada.paymentMode ?? null,
    kmInicio: resolvedKmInicio,
    kmFin: closeData.kmFin ?? null,
    kmTotal: closeData.kmFin != null && resolvedKmInicio != null ? (closeData.kmFin - resolvedKmInicio) : null,
    pricePerKm: closeData.pricePerKm ?? jornada.pricePerKm ?? null,
    importeKm:
      (closeData.importeKm != null && Number.isFinite(closeData.importeKm)) ? closeData.importeKm :
      (closeData.kmFin != null && resolvedKmInicio != null && (closeData.pricePerKm ?? jornada.pricePerKm) != null
        ? Math.round(((closeData.kmFin - resolvedKmInicio) * (closeData.pricePerKm ?? (jornada.pricePerKm as number ?? 0))) * 100) / 100
        : null),
    pricePerTrip: closeData.pricePerTrip ?? jornada.pricePerTrip ?? null,
    importeViaje:
      (closeData.importeViaje != null && Number.isFinite(closeData.importeViaje)) ? closeData.importeViaje :
      ((closeData.pricePerTrip ?? jornada.pricePerTrip) ?? null),
    conduccionMin: closeData.conduccionMin != null && Number.isFinite(closeData.conduccionMin) ? closeData.conduccionMin : null,
    conduccionDomingoMin: closeData.conduccionDomingoMin != null && Number.isFinite(closeData.conduccionDomingoMin) ? closeData.conduccionDomingoMin : null,
    conduccionLunesMin: closeData.conduccionLunesMin != null && Number.isFinite(closeData.conduccionLunesMin) ? closeData.conduccionLunesMin : null,
    observaciones: (closeData.observaciones != null && String(closeData.observaciones).trim().length > 0) ? String(closeData.observaciones).trim() : null,
    updatedAt: new Date().toISOString(),
    syncStatus: "pending" as const,
  };
}

/**
 * Normalización histórica de compensaciones: se ejecuta tanto al cerrar jornada
 * (processCompensaciones) como al leer la lista (getAllCompensaciones) para que
 * el dashboard vea la vista limpia SIN que el usuario tenga que cerrar una jornada.
 *
 * Aplica dos reglas del usuario:
 *   REGLA MISMA SEMANA: En una semana natural con 2+ descansos semanales reducidos
 *                       (≥24h y <45h), SÓLO EL ÚLTIMO genera deuda compensable.
 *                       Los PRIMEROS (no-últimos) → ELIMINAR su compensación.
 *   REGLA PRIMERO EN BASE: Primer reducido de la semana + previousRestInBase="in_base"
 *                          + duración >= 9h + total pendientes de semanas anteriores
 *                          → marcar compensadas automáticamente con flag inviolable
 *                            (recoveredInJornadaId = null, como marca de usuario).
 *
 * @returns true si hubo mutaciones en `comps` (el llamante debe persistir).
 */
async function normalizeHistoricalCompensaciones(
  comps: Compensacion[],
  allJornadas: Jornada[],
): Promise<boolean> {
  const now = new Date().toISOString();

  // PASO 0: Construir todos los WeeklyRestSlot históricos a partir de jornadas.
  type WeeklyRestSlot = {
    jornadaId: string;
    fechaInicioJornada: string;
    restStartAt: string;
    restEndAt: string;
    restDurationMin: number;
    isReduced: boolean;
    inBase: boolean;
  };
  const slots: WeeklyRestSlot[] = [];

  for (const j of allJornadas) {
    if (!j.previousRestStartAt || !j.previousRestEndAt) continue;
    const gap = j.descansoAnteriorMin ??
      Math.max(0, Math.round((new Date(j.previousRestEndAt).getTime() - new Date(j.previousRestStartAt).getTime()) / 60000));
    const tipo = j.tipoDescansoAnterior ?? clasificarDescanso(gap);
    slots.push({
      jornadaId: j.id,
      fechaInicioJornada: j.fechaInicio,
      restStartAt: j.previousRestStartAt,
      restEndAt: j.previousRestEndAt,
      restDurationMin: gap,
      isReduced: tipo === "DESCANSO_SEMANAL_REDUCIDO",
      inBase: j.previousRestInBase === "in_base",
    });
  }

  if (slots.length === 0) return false;

  // 0.2) Agrupar reducidos por SEMANA NATURAL UTC:
  const byWeek = new Map<string, WeeklyRestSlot[]>();
  for (const s of slots) {
    if (!s.isReduced) continue;
    const key = getUtcWeekMonday(s.restStartAt);
    const arr = byWeek.get(key) ?? [];
    arr.push(s);
    byWeek.set(key, arr);
  }

  let changed = false;
  type PrimerEnBaseToCheck = {
    slot: WeeklyRestSlot;
    semanaMondayStr: string;
  };
  const primerosEnBaseCheck: PrimerEnBaseToCheck[] = [];

  // 0.3) Para cada semana con >=2 reducidos: borrar compensaciones de PRIMEROS,
  //      registrar PRIMERO-EN-BASE.
  for (const [semanaMondayStr, weekSlots] of byWeek) {
    if (weekSlots.length <= 1) continue;
    const sorted = [...weekSlots].sort((a, b) => a.restStartAt.localeCompare(b.restStartAt));
    const primeros = sorted.slice(0, sorted.length - 1);

    // a) PRIMEROS (no-últimos): eliminar su compensación si existe.
    for (const p of primeros) {
      const idx = comps.findIndex(c => c.jornadaId === p.jornadaId);
      if (idx >= 0) {
        comps.splice(idx, 1);
        changed = true;
      }
    }

    // b) PRIMERO + inBase: apuntar para regla PRIMERO-EN-BASE.
    const primero = sorted[0];
    if (primero && primero.inBase) {
      primerosEnBaseCheck.push({ slot: primero, semanaMondayStr });
    }
  }

  // PASO 0-BIS: REGLA PRIMERO-EN-BASE
  if (primerosEnBaseCheck.length > 0) {
    primerosEnBaseCheck.sort(
      (a, b) => a.slot.restStartAt.localeCompare(b.slot.restStartAt),
    );
    for (const { slot: primerSlot, semanaMondayStr } of primerosEnBaseCheck) {
      const pendientes: Compensacion[] = comps.filter(c => !c.compensada);
      const pendientesAntesSemana: Compensacion[] = [];
      for (const c of pendientes) {
        const j = allJornadas.find(x => x.id === c.jornadaId);
        if (!j) { pendientesAntesSemana.push(c); continue; }
        if (!j.previousRestStartAt) continue;
        const week = getUtcWeekMonday(j.previousRestStartAt);
        if (week < semanaMondayStr) pendientesAntesSemana.push(c);
      }
      if (pendientesAntesSemana.length === 0) continue;
      const totalAntesMin = pendientesAntesSemana.reduce(
        (s, c) => s + c.horasDeuda * 60 + c.minutosDeuda, 0,
      );
      const umbralPrimeroMin = 9 * 60 + totalAntesMin;
      if (primerSlot.restDurationMin >= umbralPrimeroMin && totalAntesMin > 0) {
        for (const c of pendientesAntesSemana) {
          c.compensada = true;
          c.fechaCompensacion = primerSlot.fechaInicioJornada;
          c.recoveredInJornadaId = null; // marca inviolable (como usuario manual)
          c.recoveryRestStartAt = primerSlot.restStartAt;
          c.recoveryRestEndAt = primerSlot.restEndAt;
          c.recoveryRestDurationMin = primerSlot.restDurationMin;
          c.updatedAt = now;
          c.syncStatus = "pending";
        }
        changed = true;
      }
    }
  }

  return changed;
}

async function processCompensaciones(
  descansoAnteriorMin: number | null,
  tipoDescansoAnterior: string | null,
  jornadaId: string,
  fechaInicio: string,
  restMeta?: Pick<
    Jornada,
    | "previousRestStartAt"
    | "previousRestEndAt"
    | "previousRestLegalType"
    | "previousRestStartLocation"
    | "previousRestEndLocation"
    | "previousRestInBase"
    | "previousRestDistanceKm"
    | "previousRestObservations"
  > | null,
): Promise<void> {
  let comps = await getAllCompensaciones();
  const allJornadas = await getAllJornadas();
  const now = new Date().toISOString();

  // ======================================================================
  // PASO 0: NORMALIZAR SEMANAS NATURALES (REGLA MISMA SEMANA).
  //   Dentro de una MISMA semana UTC (lunes-domingo) puede haber 2 o más
  //   descansos semanales reducidos (24h ≤ d <45h).
  //   - SOLO el ÚLTIMO (más reciente) de esa semana GENERA deuda/compensación.
  //   - Los PRIMEROS de esa semana:
  //       a) NO generan deuda NUEVA.
  //       b) Si ya generaron deuda en un cierre anterior → la ELIMINAMOS
  //          (el usuario lo creía bueno en su momento pero no lo es).
  //       c) Adicional: si el PRIMERO de la semana fue EN BASE y hay
  //          compensaciones PENDIENTES de SEMANAS ANTERIORES y
  //          duracionEsePrimerDescanso >= 9h + totalPendientes → MARCAMOS
  //          COMPENSADAS automáticamente.
  // ======================================================================

  // 0.1) Construir listado global de descansos reducidos semanales:
  //      por cada jornada cerrada su previousRestStartAt / previousRestEndAt /
  //      previousRestInBase / duración / tipo.
  type WeeklyRestSlot = {
    jornadaId: string;
    fechaInicioJornada: string;
    restStartAt: string;
    restEndAt: string;
    restDurationMin: number;
    isReduced: boolean; // 24h <= d < 45h
    inBase: boolean;
  };
  const slots: WeeklyRestSlot[] = [];

  for (const j of allJornadas) {
    if (!j.previousRestStartAt || !j.previousRestEndAt) continue;
    const gap = j.descansoAnteriorMin ??
      Math.max(0, Math.round((new Date(j.previousRestEndAt).getTime() - new Date(j.previousRestStartAt).getTime()) / 60000));
    const tipo = j.tipoDescansoAnterior ?? clasificarDescanso(gap);
    const inBase = j.previousRestInBase === "in_base";
    slots.push({
      jornadaId: j.id,
      fechaInicioJornada: j.fechaInicio,
      restStartAt: j.previousRestStartAt,
      restEndAt: j.previousRestEndAt,
      restDurationMin: gap,
      isReduced: tipo === "DESCANSO_SEMANAL_REDUCIDO",
      inBase,
    });
  }

  // Añadir también el descanso ANTERIOR de ESTA jornada (que acaba de cerrarse)
  // si el usuario lo clasificó como semanal reducido y aún no está en slots.
  if (
    descansoAnteriorMin != null &&
    restMeta?.previousRestStartAt &&
    restMeta.previousRestEndAt &&
    tipoDescansoAnterior === "DESCANSO_SEMANAL_REDUCIDO" &&
    !slots.find(s => s.jornadaId === jornadaId)
  ) {
    slots.push({
      jornadaId,
      fechaInicioJornada: fechaInicio,
      restStartAt: restMeta.previousRestStartAt,
      restEndAt: restMeta.previousRestEndAt,
      restDurationMin: descansoAnteriorMin,
      isReduced: true,
      inBase: restMeta.previousRestInBase === "in_base",
    });
  }

  // 0.2) Agrupar reducidos por SEMANA NATURAL UTC:
  const byWeek = new Map<string, WeeklyRestSlot[]>();
  for (const s of slots) {
    if (!s.isReduced) continue;
    const key = getUtcWeekMonday(s.restStartAt);
    const arr = byWeek.get(key) ?? [];
    arr.push(s);
    byWeek.set(key, arr);
  }

  // 0.3) Para cada semana con >=2 reducidos: marcar ÚLTIMO y PRIMEROS, y
  //      borrar compensaciones asociadas a los PRIMEROS (no-últimos).
  let normalizationChanged = false;
  type PrimerEnBaseToCheck = {
    slot: WeeklyRestSlot;
    semanaMondayStr: string;
  };
  const primerosEnBaseCheck: PrimerEnBaseToCheck[] = [];

  for (const [semanaMondayStr, weekSlots] of byWeek) {
    if (weekSlots.length <= 1) continue;
    // Ordenar ASC por restStartAt: 0=PRIMERO, length-1=ÚLTIMO
    const sorted = [...weekSlots].sort((a, b) => a.restStartAt.localeCompare(b.restStartAt));
    const ultimo = sorted[sorted.length - 1];
    const primeros = sorted.slice(0, sorted.length - 1);

    // a) PRIMEROS: borrar sus compensaciones asociadas si existen.
    for (const p of primeros) {
      const idx = comps.findIndex(c => c.jornadaId === p.jornadaId);
      if (idx >= 0) {
        comps.splice(idx, 1);
        normalizationChanged = true;
      }
    }

    // b) PRIMERO de la semana + inBase => apuntar para comprobación REGLA PRIMERO-EN-BASE.
    const primero = sorted[0];
    if (primero && primero.inBase) {
      primerosEnBaseCheck.push({ slot: primero, semanaMondayStr });
    }

    // c) ÚLTIMO: no tocar aquí; se procesará normalmente en el bloque GENERAR DEUDA de abajo.
    //    (Su compensación, si ya existía, se conserva).
  }

  if (normalizationChanged) {
    await saveAllCompensaciones(comps);
  }

  // Recargamos pendientes después de la normalización:
  let pendientesExistentes = comps
    .filter((c) => !c.compensada)
    .sort((a, b) => a.fechaLimite.localeCompare(b.fechaLimite));
  let totalPendienteMin = pendientesExistentes.reduce(
    (sum, c) => sum + c.horasDeuda * 60 + c.minutosDeuda,
    0,
  );

  // ======================================================================
  // PASO 0-BIS: REGLA PRIMER DESC. SEMANAL REDUCIDO EN BASE.
  //   El PRIMER descanso reducido de una semana natural que es EN BASE,
  //   si había compensaciones pendientes de SEMANAS ANTERIORES a ésta, y
  //   duraciónPrimerDescanso >= 9h + totalPendientesAnteriores → MARCA
  //   COMPENSADAS automáticamente.
  // ======================================================================
  if (primerosEnBaseCheck.length > 0) {
    // Re-ordenamos por fecha: procesamos de más antiguo a más nuevo,
    // y cada compensación marcada NO se usa en el siguiente check.
    primerosEnBaseCheck.sort(
      (a, b) => a.slot.restStartAt.localeCompare(b.slot.restStartAt),
    );
    for (const { slot: primerSlot, semanaMondayStr } of primerosEnBaseCheck) {
      // PENDIENTES ANTERIORES a la semana de este primer descanso:
      // una compensación "anterior" es aquella cuyo SU DESCANSO GENERADOR
      // (jornada.fechaInicio) pertenece a una semana ANTERIOR a semanaMondayStr.
      const pendientesAntesSemana: Compensacion[] = [];
      for (const c of pendientesExistentes) {
        const j = allJornadas.find(x => x.id === c.jornadaId);
        if (!j) continue; // sin jornada ligada → la tratamos como "anterior" por defecto
        if (!j.previousRestStartAt) continue;
        const week = getUtcWeekMonday(j.previousRestStartAt);
        if (week < semanaMondayStr) pendientesAntesSemana.push(c);
      }
      if (pendientesAntesSemana.length === 0) continue;
      const totalAntesMin = pendientesAntesSemana.reduce(
        (s, c) => s + c.horasDeuda * 60 + c.minutosDeuda, 0,
      );
      const umbralPrimeroMin = 9 * 60 + totalAntesMin;
      if (primerSlot.restDurationMin >= umbralPrimeroMin && totalAntesMin > 0) {
        for (const c of pendientesAntesSemana) {
          c.compensada = true;
          c.fechaCompensacion = primerSlot.fechaInicioJornada;
          // Como es una marcación "regla primero en base", NO ponemos
          // recoveredInJornadaId (identificamos esta marca como si fuera
          // manual de usuario => no se desmarcará en migraciones futuras).
          c.recoveredInJornadaId = null;
          c.recoveryRestStartAt = primerSlot.restStartAt;
          c.recoveryRestEndAt = primerSlot.restEndAt;
          c.recoveryRestDurationMin = primerSlot.restDurationMin;
          c.updatedAt = now;
          c.syncStatus = "pending";
        }
        normalizationChanged = true;
      }
    }
    if (normalizationChanged) await saveAllCompensaciones(comps);
  }

  // Recargamos pendientes tras la regla PRIMERO-EN-BASE:
  comps = await getAllCompensaciones();
  pendientesExistentes = comps
    .filter((c) => !c.compensada)
    .sort((a, b) => a.fechaLimite.localeCompare(b.fechaLimite));
  totalPendienteMin = pendientesExistentes.reduce(
    (sum, c) => sum + c.horasDeuda * 60 + c.minutosDeuda,
    0,
  );

  // ======================================================================
  // BLOQUE COMPENSAR: cada vez que hacemos UN descanso, revisamos si
  // este descanso "completa 45h semanal regular + horas pendientes".
  // REGLA 3-B / 3-C.
  // ======================================================================
  if (descansoAnteriorMin != null && descansoAnteriorMin > 0 && pendientesExistentes.length > 0) {
    // REGLA 3-C: Umbral = 24h (mín semanal) + deuda pendiente
    //            Equivale a: "semanal completo regular + horas extra que compensan la deuda".
    const umbralCompensarMin = 24 * 60 + totalPendienteMin;

    if (descansoAnteriorMin >= umbralCompensarMin) {
      // REGLA 3-C: marcar TODO como compensado.
      for (const c of pendientesExistentes) {
        c.compensada = true;
        c.fechaCompensacion = fechaInicio;
        c.recoveredInJornadaId = jornadaId;
        c.recoveryRestStartAt = restMeta?.previousRestStartAt ?? null;
        c.recoveryRestEndAt = restMeta?.previousRestEndAt ?? null;
        c.recoveryRestDurationMin = descansoAnteriorMin;
        c.updatedAt = now;
        c.syncStatus = "pending";
      }
      await saveAllCompensaciones(comps);
    } else {
      // REGLA 3-B: semanal completo (o descanso largo) PERO sin llegar a umbralCompensarMin
      // => NO creamos nada, NO tocamos deuda, NO sumamos ni restamos nada a pendientes.
      comps = await getAllCompensaciones();
    }
  }

  // ======================================================================
  // BLOQUE GENERAR DEUDA: SOLO si el descanso que acabo de hacer ANTES de
  // esta jornada fue un DESCANSO SEMANAL REDUCIDO (24h ≤ duración < 45h)
  // Y además, después de NORMALIZACIÓN MISMA SEMANA, este descanso ES EL
  // ÚLTIMO de su semana natural (los PRIMEROS no generan).
  // BUG 1 / BUG 2 / REGLA 3-A / REGLA MISMA SEMANA.
  // ======================================================================
  if (
    tipoDescansoAnterior === "DESCANSO_SEMANAL_REDUCIDO" &&
    descansoAnteriorMin != null &&
    restMeta?.previousRestStartAt
  ) {
    // 1) Comprobar MISMA SEMANA: ¿es el ÚLTIMO reducido de su semana natural?
    const myWeekMonday = getUtcWeekMonday(restMeta.previousRestStartAt);
    const myWeekSlots = (byWeek.get(myWeekMonday) ?? []).filter(s => s.isReduced);
    const sortedWeek = [...myWeekSlots].sort((a, b) => a.restStartAt.localeCompare(b.restStartAt));
    const soyElUltimo = sortedWeek.length <= 1 ||
      sortedWeek[sortedWeek.length - 1].jornadaId === jornadaId ||
      sortedWeek[sortedWeek.length - 1].restStartAt === restMeta.previousRestStartAt;

    // 👉 LOS PRIMEROS de la semana NO GENERAN compensación (saltamos este bloque).
    if (soyElUltimo) {
      // Art. 8.6 CE 561/2006: deuda VARIABLE = 45h − duración REAL del descanso reducido.
      // Ej: 44h 9m → 51m deuda; 34h → 11h deuda.
      const deudaMin = descansoAnteriorMin < 24 * 60 ? 0 : 45 * 60 - descansoAnteriorMin;

      if (deudaMin > 0) {
        comps = await getAllCompensaciones();
        const existingPending = comps
          .filter((c) => !c.compensada)
          .sort((a, b) => a.fechaLimite.localeCompare(b.fechaLimite));

        if (existingPending.length > 0) {
          // REGLA 3-A: SI HAY PENDIENTES EXISTENTES → NO creamos fila nueva.
          // Acumulamos la nueva deuda EN EL PRIMER pendiente (fecha límite más antigua).
          const primero = existingPending[0];
          const actualMin = primero.horasDeuda * 60 + primero.minutosDeuda;
          const nuevoMin = actualMin + deudaMin;
          primero.horasDeuda = Math.floor(nuevoMin / 60);
          primero.minutosDeuda = nuevoMin % 60;
          primero.updatedAt = now;
          primero.syncStatus = "pending";
          // fechaLimite NO cambia: conservamos la FECHA MÁS ANTIGUA.
        } else {
          // REGLA 3-A sin pendientes → creamos la COMPENSACIÓN NUEVA.
          // Plazo VERBATIM usuario: "14 dias desde el fin descanso que ha
          // generado la compensacion". Origen de fecha: previousRestEndAt.
          const fechaLimite = calculateCompensationDeadline({
            sourceRestEndAt: restMeta?.previousRestEndAt ?? null,
            jornadaPreviousRestEndAt: restMeta?.previousRestEndAt ?? null,
            fechaInicioJornada: fechaInicio,
          });

          const newComp: Compensacion = {
            id: generateId(),
            jornadaId,
            horasDeuda: Math.floor(deudaMin / 60),
            minutosDeuda: deudaMin % 60,
            fechaLimite,
            compensada: false,
            fechaCompensacion: null,
            sourceRestStartAt: restMeta.previousRestStartAt ?? null,
            sourceRestEndAt: restMeta.previousRestEndAt ?? null,
            sourceRestDurationMin: descansoAnteriorMin,
            sourceRestLegalType: restMeta.previousRestLegalType ?? null,
            sourceRestLocationStart: restMeta.previousRestStartLocation ?? null,
            sourceRestLocationEnd: restMeta.previousRestEndLocation ?? null,
            sourceRestInBase: restMeta.previousRestInBase ?? null,
            sourceRestDistanceKm: restMeta.previousRestDistanceKm ?? null,
            sourceRestObservations: restMeta.previousRestObservations ?? null,
            recoveredInJornadaId: null,
            recoveryRestStartAt: null,
            recoveryRestEndAt: null,
            recoveryRestDurationMin: null,
            updatedAt: now,
            syncStatus: "pending",
          };

          comps.push(newComp);
        }
        await saveAllCompensaciones(comps);
      }
    }
  }
}

export async function getJornadaAbierta(): Promise<Jornada | null> {
  const all = await getAllJornadas();
  return all.find((j) => !j.fechaFin) || null;
}

export async function crearJornadaInicio(data: {
  fechaInicio: string;
  horaInicio: string;
  lugarInicio: string;
  paymentMode?: "dietas" | "km" | "viaje";
  kmInicio?: number;
  pricePerKm?: number;
  pricePerTrip?: number;
  isDoubleDriving?: boolean;
  secondDriverName?: string;
  ferryRest?: {
    id: string;
    accumulatedRestMin: number;
    restType: "9h" | "11h";
    isValid: boolean;
  };
}): Promise<Jornada> {
  const all = await getAllJornadas();
  const existing = all.find((j) => !j.fechaFin);
  if (existing) throw new Error("Ya existe una jornada abierta");

  const startAt = buildIsoTimestamp(data.fechaInicio, data.horaInicio);
  const baseConfig = await loadBaseLocationConfigFromSettings();

  let descansoAnteriorMin: number | null = null;
  let tipoDescansoAnterior: string | null = null;
  let previousRestSource: "normal_gap" | "ferry_rest" | null = null;
  let previousRestId: string | null = null;
  let previousRestValid: boolean | null = null;
  let previousRestFields = buildPreviousRestFields({
    restStartAt: null,
    restEndAt: null,
    assessment: null,
  });

  if (data.ferryRest) {
    descansoAnteriorMin = data.ferryRest.accumulatedRestMin;
    tipoDescansoAnterior = clasificarDescanso(descansoAnteriorMin);
    previousRestSource = "ferry_rest";
    previousRestId = data.ferryRest.id;
    previousRestValid = data.ferryRest.isValid;
  } else {
    const anterior = findPreviousClosed(all, startAt);
    previousRestSource = "normal_gap";
    if (anterior && anterior.endAt) {
      descansoAnteriorMin = calcMinutesBetween(anterior.endAt, startAt);
      if (isSplitDailyRestGapComplete(descansoAnteriorMin, anterior)) {
        tipoDescansoAnterior = "DESCANSO_DIARIO_COMPLETO";
      } else {
        tipoDescansoAnterior = clasificarDescanso(descansoAnteriorMin);
      }
      previousRestFields = buildPreviousRestFields({
        restStartAt: anterior.endAt,
        restEndAt: startAt,
        restStartLocation: anterior.lugarFin || anterior.lugarInicio || null,
        restEndLocation: data.lugarInicio || null,
        assessment: assessWeeklyRest({
          durationMin: descansoAnteriorMin,
          base: baseConfig,
          startLocation: anterior.lugarFin || anterior.lugarInicio || null,
          endLocation: data.lugarInicio || null,
        }),
      });
    }
  }

  const jornada: Jornada = {
    id: generateId(),
    fechaInicio: data.fechaInicio,
    horaInicio: data.horaInicio,
    lugarInicio: data.lugarInicio,
    fechaFin: null,
    horaFin: null,
    lugarFin: null,
    startAt,
    endAt: null,
    conduccionMin: null,
    conduccionDomingoMin: null,
    conduccionLunesMin: null,
    tipoRuta: null,
    pernocta: null,
    dietaModo: null,
    dietaManualTipo: null,
    dietaManualPct: null,
    dietaImporteEur: null,
    dietasItems: null,
    dietaPercent: null,
    dayFlag: null,
    dayExtraEur: null,
    dietBaseEur: null,
    dietRule: null,
    dietCalculatedAt: null,
    descansoAnteriorMin,
    tipoDescansoAnterior,
    previousRestSource,
    previousRestId,
    previousRestValid,
    ...previousRestFields,
    duracionJornadaMin: null,
    countsAsDailyReduced: false,
    plannedRestMin: null,
    plannedRestType: null,
    splitRestDetected: false,
    splitRestFirstPartMin: null,
    splitRestSecondPartMin: null,
    countsAsReducedRest: true,
    paymentMode: data.paymentMode ?? null,
    kmInicio: data.kmInicio ?? null,
    kmFin: null,
    kmTotal: null,
    pricePerKm: data.pricePerKm ?? null,
    importeKm: null,
    pricePerTrip: data.pricePerTrip ?? null,
    importeViaje: null,
    reportHideAmounts: false,
    reportHidePluses: false,
    plusItems: null,
    observaciones: null,
    moroccoPaymentMode: null,
    moroccoTripRate: null,
    moroccoPernightRate: null,
    ferryPending: false,
    ferryDestination: null,
    ferryExtras: null,
    ferryInterruptions: null,
    ferryRestCompleted: false,
    ferryRestType: null,
    tachoDailySummaryId: null,
    tachoDrivingMin: null,
    tachoWorkMin: null,
    tachoAvailableMin: null,
    tachoRestMin: null,
    tachoCountries: [],
    tachoCountryEntries: 0,
    tachoKmTotal: null,
    tachoFirstActivityAt: null,
    tachoLastActivityAt: null,
    tachoDisconnections: 0,
    tachoDataQuality: null,
    isDoubleDriving: data.isDoubleDriving === true,
    secondDriverName: data.secondDriverName?.trim() || null,
    legalSummary: null,
    updatedAt: new Date().toISOString(),
    syncStatus: "pending",
  };

  // #region debug-point B:start-local-save
  reportJornadaDateDebug("B", "local-storage:crearJornadaInicio", "open jornada before local save", {
    jornadaId: jornada.id,
    fechaInicioSeleccionada: data.fechaInicio,
    horaInicioSeleccionada: data.horaInicio,
    fechaFinSeleccionada: null,
    horaFinSeleccionada: null,
    fechaInicio: jornada.fechaInicio,
    horaInicio: jornada.horaInicio,
    fechaFin: jornada.fechaFin,
    horaFin: jornada.horaFin,
    startAt: jornada.startAt,
    endAt: jornada.endAt,
    paymentMode: jornada.paymentMode,
  });
  // #endregion

  all.push(jornada);
  await saveAllJornadas(all);
  return jornada;
}

export async function cerrarJornada(
  id: string,
  data: {
    fechaFin: string;
    horaFin: string;
    lugarFin: string;
    tipoRuta?: string;
    pernocta?: boolean;
    dietaModo?: string;
    dietaManualTipo?: string;
    dietaManualPct?: string;
    conduccionMin?: number;
    conduccionDomingoMin?: number;
    conduccionLunesMin?: number;
    dietaPercent?: number;
    dayFlag?: string;
    customRates?: UserDietRate[];
    dayExtras?: UserDayExtras;
    holidays?: string[];
    plannedRestMin?: number;
    plannedRestType?: "daily" | "weekly";
    plusItems?: PlusItem[];
    observaciones?: string;
    moroccoPaymentMode?: "morocco_trip" | "morocco_pernight" | "morocco_diet";
    moroccoTripRate?: number;
    moroccoPernightRate?: number;
    ferryPending?: boolean;
    ferryRestType?: "9h" | "11h";
    paymentMode?: "dietas" | "km" | "viaje";
    kmInicio?: number;
    kmFin?: number;
    kmTotal?: number;
    pricePerKm?: number;
    pricePerTrip?: number;
    importeViaje?: number;
    tachoDailySummaryId?: string | null;
    tachoDrivingMin?: number | null;
    tachoWorkMin?: number | null;
    tachoAvailableMin?: number | null;
    tachoRestMin?: number | null;
    tachoCountries?: string[] | null;
    tachoCountryEntries?: number | null;
    tachoKmTotal?: number | null;
    tachoFirstActivityAt?: string | null;
    tachoLastActivityAt?: string | null;
    tachoDisconnections?: number | null;
    tachoDataQuality?: "low" | "medium" | "high" | null;
    isDoubleDriving?: boolean;
    secondDriverName?: string;
  },
): Promise<Jornada> {
  const all = await getAllJornadas();
  const idx = all.findIndex((j) => j.id === id);
  if (idx === -1) throw new Error("Jornada no encontrada");
  if (all[idx].fechaFin) throw new Error("Jornada ya cerrada");

  const jornada = all[idx];
  const others = all.filter((j) => j.id !== id);
  const derived = computeDerivedFields(jornada, others, data);

  const merged: Jornada = { ...jornada, ...derived };
  const tachoFields = [
    "tachoDailySummaryId",
    "tachoDrivingMin",
    "tachoWorkMin",
    "tachoAvailableMin",
    "tachoRestMin",
    "tachoCountries",
    "tachoCountryEntries",
    "tachoKmTotal",
    "tachoFirstActivityAt",
    "tachoLastActivityAt",
    "tachoDisconnections",
    "tachoDataQuality",
  ] as const;
  for (const f of tachoFields) {
    if ((data as any)[f] !== undefined) (merged as any)[f] = (data as any)[f];
  }
  if (typeof data.kmTotal === "number" && merged.kmTotal == null) {
    merged.kmTotal = data.kmTotal;
  }
  if (data.plannedRestMin != null) {
    merged.plannedRestMin = data.plannedRestMin;
    merged.plannedRestType = data.plannedRestType || null;
  }
  if (data.plusItems && data.plusItems.length > 0) {
    merged.plusItems = data.plusItems;
  }
  if (data.ferryPending) {
    merged.ferryPending = true;
    merged.ferryRestType = data.ferryRestType || "11h";
    merged.ferryInterruptions = [];
    merged.ferryExtras = null;
    merged.ferryDestination = null;
    merged.ferryRestCompleted = false;
    console.log("[cerrarJornada] Ferry fields set: ferryPending=true, ferryRestType=", merged.ferryRestType, "id=", id);
  }
  if (data.moroccoPaymentMode) {
    merged.moroccoPaymentMode = data.moroccoPaymentMode;
    merged.moroccoTripRate = data.moroccoTripRate ?? null;
    merged.moroccoPernightRate = data.moroccoPernightRate ?? null;
    if (data.moroccoPaymentMode === "morocco_trip" && data.moroccoTripRate != null) {
      merged.dietaImporteEur = data.moroccoTripRate.toFixed(2);
      merged.dietBaseEur = data.moroccoTripRate.toFixed(2);
      merged.dietRule = `MOROCCO_TRIP ${data.moroccoTripRate.toFixed(2)}€`;
      merged.dietasItems = [{ tipo: "MOROCCO_TRIP", pct: "100", importe: data.moroccoTripRate }];
    }
  }
  if (typeof data.isDoubleDriving === "boolean") {
    merged.isDoubleDriving = data.isDoubleDriving;
    merged.secondDriverName = data.secondDriverName?.trim() || null;
  } else if (typeof data.secondDriverName === "string") {
    merged.secondDriverName = data.secondDriverName.trim() || null;
  }

  // #region debug-point B:finish-local-save
  reportJornadaDateDebug("B", "local-storage:cerrarJornada", "closed jornada before local save", {
    jornadaId: merged.id,
    fechaInicioSeleccionada: jornada.fechaInicio,
    horaInicioSeleccionada: jornada.horaInicio,
    fechaFinSeleccionada: data.fechaFin,
    horaFinSeleccionada: data.horaFin,
    fechaInicio: merged.fechaInicio,
    horaInicio: merged.horaInicio,
    fechaFin: merged.fechaFin,
    horaFin: merged.horaFin,
    startAt: merged.startAt,
    endAt: merged.endAt,
    resolvedFechaFin: derived.fechaFin ?? null,
    derivedStartAt: jornada.startAt,
    derivedEndAt: derived.endAt ?? null,
  });
  // #endregion
  const comps = await getAllCompensaciones();
  const legalResult = evaluateJornada(merged, others, comps);
  merged.legalSummary = {
    status: legalResult.status,
    infractions: legalResult.infractions,
    warnings: legalResult.warnings,
    conduccionSemanalMin: legalResult.conduccionSemanalMin,
    conduccionBisemanalMin: legalResult.conduccionBisemanalMin,
    extensiones10hSemana: legalResult.extensiones10hSemana,
    descansosReducidosSemana: legalResult.descansosReducidosSemana,
    splitRestDetected: merged.splitRestDetected,
    splitRestFirstPartMin: merged.splitRestFirstPartMin,
    splitRestSecondPartMin: merged.splitRestSecondPartMin,
    countsAsReducedRest: merged.countsAsReducedRest,
  };

  all[idx] = merged;
  await saveAllJornadas(all);
  await processCompensaciones(
    derived.descansoAnteriorMin!,
    derived.tipoDescansoAnterior!,
    id,
    jornada.fechaInicio,
    merged,
  );

  return all[idx];
}

export async function crearJornadaCompleta(data: {
  id?: string;
  fechaInicio: string;
  horaInicio: string;
  lugarInicio: string;
  fechaFin: string;
  horaFin: string;
  lugarFin: string;
  tipoRuta: string;
  pernocta: boolean;
  dietaModo?: string;
  dietaManualTipo?: string;
  dietaManualPct?: string;
  conduccionMin?: number;
  conduccionDomingoMin?: number;
  conduccionLunesMin?: number;
  dietaPercent?: number;
  dayFlag?: string;
  customRates?: UserDietRate[];
  dayExtras?: UserDayExtras;
  holidays?: string[];
  plusItems?: PlusItem[];
  observaciones?: string;
  ferryPending?: boolean;
  ferryRestCompleted?: boolean;
  ferryRestType?: "9h" | "11h";
  ferryDestination?: string;
  ferryExtras?: FerryExtras;
  ferryInterruptions?: FerryInterruption[];
}): Promise<Jornada> {
  const all = await getAllJornadas();
  const startAt = buildIsoTimestamp(data.fechaInicio, data.horaInicio);

  const jornada: Jornada = {
    id: data.id || generateId(),
    fechaInicio: data.fechaInicio,
    horaInicio: data.horaInicio,
    lugarInicio: data.lugarInicio,
    fechaFin: null,
    horaFin: null,
    lugarFin: null,
    startAt,
    endAt: null,
    conduccionMin: null,
    conduccionDomingoMin: null,
    conduccionLunesMin: null,
    tipoRuta: null,
    pernocta: null,
    dietaModo: null,
    dietaManualTipo: null,
    dietaManualPct: null,
    dietaImporteEur: null,
    dietasItems: null,
    dietaPercent: null,
    dayFlag: null,
    dayExtraEur: null,
    dietBaseEur: null,
    dietRule: null,
    dietCalculatedAt: null,
    descansoAnteriorMin: null,
    tipoDescansoAnterior: null,
    previousRestSource: null,
    previousRestId: null,
    previousRestValid: null,
    duracionJornadaMin: null,
    countsAsDailyReduced: false,
    plannedRestMin: null,
    plannedRestType: null,
    splitRestDetected: false,
    splitRestFirstPartMin: null,
    splitRestSecondPartMin: null,
    countsAsReducedRest: true,
    paymentMode: null,
    kmInicio: null,
    kmFin: null,
    kmTotal: null,
    pricePerKm: null,
    importeKm: null,
    pricePerTrip: null,
    importeViaje: null,
    reportHideAmounts: false,
    reportHidePluses: false,
    plusItems: null,
    observaciones: data.observaciones || null,
    moroccoPaymentMode: null,
    moroccoTripRate: null,
    moroccoPernightRate: null,
    ferryPending: data.ferryPending ?? false,
    ferryDestination: data.ferryDestination || null,
    ferryExtras: data.ferryExtras || null,
    ferryInterruptions: data.ferryInterruptions || null,
    ferryRestCompleted: data.ferryRestCompleted ?? false,
    ferryRestType: data.ferryRestType || null,
    tachoDailySummaryId: null,
    tachoDrivingMin: null,
    tachoWorkMin: null,
    tachoAvailableMin: null,
    tachoRestMin: null,
    tachoCountries: [],
    tachoCountryEntries: 0,
    tachoKmTotal: null,
    tachoFirstActivityAt: null,
    tachoLastActivityAt: null,
    tachoDisconnections: 0,
    tachoDataQuality: null,
    isDoubleDriving: false,
    secondDriverName: null,
    legalSummary: null,
    updatedAt: new Date().toISOString(),
    syncStatus: "pending",
  };

  const derived = computeDerivedFields(jornada, all, data);
  const completed = { ...jornada, ...derived };
  if (data.conduccionDomingoMin != null) {
    completed.conduccionDomingoMin = data.conduccionDomingoMin;
  }
  if (data.conduccionLunesMin != null) {
    completed.conduccionLunesMin = data.conduccionLunesMin;
  }
  if (data.plusItems && data.plusItems.length > 0) {
    completed.plusItems = data.plusItems;
  }

  // #region debug-point D:manual-save
  reportPdfDietDebug("D", "local-storage:crearJornadaCompleta:completed", "manual jornada completed before persistence", {
    jornada: completed,
  });
  // #endregion

  const comps = await getAllCompensaciones();
  const legalResult = evaluateJornada(completed, all, comps);
  completed.legalSummary = {
    status: legalResult.status,
    infractions: legalResult.infractions,
    warnings: legalResult.warnings,
    conduccionSemanalMin: legalResult.conduccionSemanalMin,
    conduccionBisemanalMin: legalResult.conduccionBisemanalMin,
    extensiones10hSemana: legalResult.extensiones10hSemana,
    descansosReducidosSemana: legalResult.descansosReducidosSemana,
  };

  all.push(completed);
  await saveAllJornadas(all);
  await processCompensaciones(
    derived.descansoAnteriorMin!,
    derived.tipoDescansoAnterior!,
    completed.id,
    data.fechaInicio,
    completed,
  );

  return completed;
}

export async function editarJornada(
  id: string,
  data: {
    fechaInicio: string;
    horaInicio: string;
    lugarInicio: string;
    fechaFin: string;
    horaFin: string;
    lugarFin: string;
    tipoRuta: string;
    pernocta: boolean;
    dietaModo: string;
    dietaManualTipo?: string;
    dietaManualPct?: string;
    conduccionMin?: number;
    conduccionDomingoMin?: number;
    conduccionLunesMin?: number;
    dietaPercent?: number;
    dayFlag?: string;
    customRates?: UserDietRate[];
    dayExtras?: UserDayExtras;
    holidays?: string[];
    recalcDiet?: boolean;
    plusItems?: PlusItem[];
    observaciones?: string;
    paymentMode?: "dietas" | "km" | "viaje";
    kmInicio?: number | null;
    kmFin?: number | null;
    kmTotal?: number | null;
    pricePerKm?: number | null;
    importeKm?: number | null;
    pricePerTrip?: number | null;
    importeViaje?: number | null;
    splitRestDetected?: boolean;
    splitRestFirstPartMin?: number | null;
    splitRestSecondPartMin?: number | null;
    countsAsReducedRest?: boolean;
  },
): Promise<Jornada> {
  const all = await getAllJornadas();
  const idx = all.findIndex((j) => j.id === id);
  if (idx === -1) throw new Error("Jornada no encontrada");

  const original = all[idx];
  const startAt = buildIsoTimestamp(data.fechaInicio, data.horaInicio);

  const updated: Jornada = {
    ...original,
    fechaInicio: data.fechaInicio,
    horaInicio: data.horaInicio,
    lugarInicio: data.lugarInicio,
    startAt,
    fechaFin: null,
    horaFin: null,
    lugarFin: null,
    endAt: null,
    updatedAt: new Date().toISOString(),
    syncStatus: "pending",
  };

  const others = all.filter((j) => j.id !== id);
  const derived = computeDerivedFields(updated, others, data);

  if (!data.recalcDiet && original.dietCalculatedAt) {
    derived.dietaImporteEur = original.dietaImporteEur;
    derived.dietasItems = original.dietasItems;
    derived.dietaPercent = original.dietaPercent;
    derived.dayFlag = original.dayFlag;
    derived.dayExtraEur = original.dayExtraEur;
    derived.dietBaseEur = original.dietBaseEur;
    derived.dietRule = original.dietRule;
    derived.dietCalculatedAt = original.dietCalculatedAt;
    derived.dietaModo = original.dietaModo;
    derived.dietaManualTipo = original.dietaManualTipo;
    derived.dietaManualPct = original.dietaManualPct;
  }

  const editMerged = { ...updated, ...derived };
  if (data.conduccionDomingoMin != null) {
    editMerged.conduccionDomingoMin = data.conduccionDomingoMin;
  } else {
    editMerged.conduccionDomingoMin = null;
  }
  if (data.conduccionLunesMin != null) {
    editMerged.conduccionLunesMin = data.conduccionLunesMin;
  } else {
    editMerged.conduccionLunesMin = null;
  }
  if (data.plusItems !== undefined) {
    editMerged.plusItems = data.plusItems && data.plusItems.length > 0 ? data.plusItems : null;
  }
  if (data.observaciones !== undefined) {
    editMerged.observaciones = data.observaciones || null;
  }
  if (data.paymentMode !== undefined) editMerged.paymentMode = data.paymentMode;
  if (data.kmInicio !== undefined) editMerged.kmInicio = data.kmInicio;
  if (data.kmFin !== undefined) editMerged.kmFin = data.kmFin;
  if (data.kmTotal !== undefined) editMerged.kmTotal = data.kmTotal;
  if (data.pricePerKm !== undefined) editMerged.pricePerKm = data.pricePerKm;
  if (data.importeKm !== undefined) editMerged.importeKm = data.importeKm;
  if (data.pricePerTrip !== undefined) editMerged.pricePerTrip = data.pricePerTrip;
  if (data.importeViaje !== undefined) editMerged.importeViaje = data.importeViaje;
  if (data.splitRestDetected === true) {
    editMerged.splitRestDetected = true;
    editMerged.splitRestFirstPartMin = data.splitRestFirstPartMin ?? null;
    editMerged.splitRestSecondPartMin = data.splitRestSecondPartMin ?? null;
    editMerged.countsAsReducedRest = data.countsAsReducedRest ?? false;
  } else if (data.splitRestDetected === false) {
    editMerged.splitRestDetected = false;
    editMerged.splitRestFirstPartMin = null;
    editMerged.splitRestSecondPartMin = null;
    editMerged.countsAsReducedRest = true;
  }

  if ((editMerged.paymentMode || "dietas") === "km") {
    const kmStart = editMerged.kmInicio;
    const kmEnd = editMerged.kmFin;
    if (kmStart != null && kmEnd != null && Number.isFinite(kmStart) && Number.isFinite(kmEnd)) {
      const kmTotal = editMerged.kmTotal != null && Number.isFinite(editMerged.kmTotal) ? editMerged.kmTotal : (kmEnd - kmStart);
      editMerged.kmTotal = kmTotal;
      if (data.importeKm === undefined && editMerged.pricePerKm != null && Number.isFinite(editMerged.pricePerKm)) {
        editMerged.importeKm = Math.round((kmTotal * editMerged.pricePerKm) * 100) / 100;
      }
    }
  }
  if ((editMerged.paymentMode || "dietas") === "viaje") {
    if (data.importeViaje === undefined && editMerged.pricePerTrip != null && Number.isFinite(editMerged.pricePerTrip)) {
      editMerged.importeViaje = editMerged.pricePerTrip;
    }
  }

  // #region debug-point B:edit-local-save
  reportJornadaDateDebug("B", "local-storage:editarJornada", "edited jornada before local save", {
    jornadaId: editMerged.id,
    fechaInicioSeleccionada: data.fechaInicio,
    horaInicioSeleccionada: data.horaInicio,
    fechaFinSeleccionada: data.fechaFin,
    horaFinSeleccionada: data.horaFin,
    original: {
      fechaInicio: original.fechaInicio,
      horaInicio: original.horaInicio,
      fechaFin: original.fechaFin,
      horaFin: original.horaFin,
      startAt: original.startAt,
      endAt: original.endAt,
    },
    next: {
      fechaInicio: editMerged.fechaInicio,
      horaInicio: editMerged.horaInicio,
      fechaFin: editMerged.fechaFin,
      horaFin: editMerged.horaFin,
      startAt: editMerged.startAt,
      endAt: editMerged.endAt,
    },
  });
  // #endregion
  let comps = await getAllCompensaciones();
  const compsFiltered = comps.filter((c) => c.jornadaId !== id);
  const legalResult = evaluateJornada(editMerged, others, compsFiltered);
  editMerged.legalSummary = {
    status: legalResult.status,
    infractions: legalResult.infractions,
    warnings: legalResult.warnings,
    conduccionSemanalMin: legalResult.conduccionSemanalMin,
    conduccionBisemanalMin: legalResult.conduccionBisemanalMin,
    extensiones10hSemana: legalResult.extensiones10hSemana,
    descansosReducidosSemana: legalResult.descansosReducidosSemana,
    splitRestDetected: editMerged.splitRestDetected,
    splitRestFirstPartMin: editMerged.splitRestFirstPartMin,
    splitRestSecondPartMin: editMerged.splitRestSecondPartMin,
    countsAsReducedRest: editMerged.countsAsReducedRest,
  };

  all[idx] = editMerged;
  await saveAllJornadas(all);

  await saveAllCompensaciones(compsFiltered);

  await processCompensaciones(
    derived.descansoAnteriorMin!,
    derived.tipoDescansoAnterior!,
    id,
    data.fechaInicio,
    editMerged,
  );

  return all[idx];
}

export async function getJornadaById(id: string): Promise<Jornada | null> {
  const all = await getAllJornadas();
  return all.find((j) => j.id === id) || null;
}

export async function updateJornadaPlannedRest(
  id: string,
  plannedRestMin: number,
  plannedRestType: "daily" | "weekly",
  extra?: {
    splitRestDetected?: boolean;
    splitRestFirstPartMin?: number | null;
    splitRestSecondPartMin?: number | null;
    countsAsReducedRest?: boolean;
  },
): Promise<void> {
  const all = await getAllJornadas();
  const idx = all.findIndex((j) => j.id === id);
  if (idx === -1) return;
  all[idx].plannedRestMin = plannedRestMin;
  all[idx].plannedRestType = plannedRestType;
  if (plannedRestType === "daily" && extra?.splitRestDetected) {
    all[idx].splitRestDetected = true;
    all[idx].splitRestFirstPartMin = extra.splitRestFirstPartMin ?? null;
    all[idx].splitRestSecondPartMin = extra.splitRestSecondPartMin ?? plannedRestMin;
    all[idx].countsAsReducedRest = extra.countsAsReducedRest ?? false;
  } else {
    all[idx].splitRestDetected = false;
    all[idx].splitRestFirstPartMin = null;
    all[idx].splitRestSecondPartMin = null;
    all[idx].countsAsReducedRest = true;
  }

  try {
    const comps = await getAllCompensaciones();
    const others = all.filter((j) => j.id !== id);
    const legalResult = evaluateJornada(all[idx], others, comps);
    all[idx].legalSummary = {
      status: legalResult.status,
      infractions: legalResult.infractions,
      warnings: legalResult.warnings,
      conduccionSemanalMin: legalResult.conduccionSemanalMin,
      conduccionBisemanalMin: legalResult.conduccionBisemanalMin,
      extensiones10hSemana: legalResult.extensiones10hSemana,
      descansosReducidosSemana: legalResult.descansosReducidosSemana,
      splitRestDetected: all[idx].splitRestDetected,
      splitRestFirstPartMin: all[idx].splitRestFirstPartMin,
      splitRestSecondPartMin: all[idx].splitRestSecondPartMin,
      countsAsReducedRest: all[idx].countsAsReducedRest,
    };
  } catch {}

  all[idx].updatedAt = new Date().toISOString();
  all[idx].syncStatus = all[idx].syncStatus === "synced" ? "pending" : all[idx].syncStatus;
  await saveAllJornadas(all);
}

export async function listarJornadas(from?: string, to?: string): Promise<Jornada[]> {
  const allJornadas = await getAllJornadas();

  let filtered = [...allJornadas];
  if (from) filtered = filtered.filter((j) => j.fechaInicio >= from);
  if (to) filtered = filtered.filter((j) => j.fechaInicio <= to);

  filtered.sort((a, b) => b.startAt.localeCompare(a.startAt));

  for (const j of filtered) {
    if (!j.endAt) continue;
    const anterior = findPreviousClosed(
      allJornadas.filter((o) => o.id !== j.id),
      j.startAt,
    );
    if (anterior && anterior.endAt) {
      j.descansoAnteriorMin = calcMinutesBetween(anterior.endAt, j.startAt);
      if (isSplitDailyRestGapComplete(j.descansoAnteriorMin, anterior)) {
        j.tipoDescansoAnterior = "DESCANSO_DIARIO_COMPLETO";
      } else {
        j.tipoDescansoAnterior = clasificarDescanso(j.descansoAnteriorMin);
      }
    } else {
      j.descansoAnteriorMin = null;
      j.tipoDescansoAnterior = null;
    }
  }

  return filtered;
}

export async function eliminarJornada(id: string): Promise<void> {
  let all = await getAllJornadas();
  all = all.filter((j) => j.id !== id);
  await saveAllJornadas(all);

  let comps = await getAllCompensaciones();
  comps = comps.filter((c) => c.jornadaId !== id);
  await saveAllCompensaciones(comps);
}


export type PeriodAuditIssue = {
  id: string;
  severity: "warning" | "error";
  date?: string | null;
  title: string;
  detail: string;
};

export type PeriodAuditResult = {
  from: string;
  to: string;
  checkedJourneys: number;
  checkedNaturalDays: number;
  issues: PeriodAuditIssue[];
};

export async function auditPeriodConsistency(from: string, to: string): Promise<PeriodAuditResult> {
  const all = await getAllJornadas();
  const periodJourneys = all.filter((j) => j.fechaInicio >= from && j.fechaInicio <= to);
  const natural = (await getAllNaturalDayDiets()).filter(
    (n) => n.date >= from && n.date <= to && n.confirmedByUser && !n.dismissedAt,
  );
  const { customRates, dayExtras, holidays } = await loadDietDerivationContext();
  const issues: PeriodAuditIssue[] = [];

  const push = (issue: PeriodAuditIssue) => {
    if (!issues.some((x) => x.id === issue.id)) issues.push(issue);
  };

  // 1) Días fuera de base que todavía faltan.
  try {
    const missing = await detectMissingOutOfBaseDietDays({ fromDate: from, toDate: to });
    for (const item of missing) {
      push({
        id: `missing-oob-${item.date}`,
        severity: "warning",
        date: item.date,
        title: "Jornada fuera de base pendiente",
        detail: item.isBaseArrivalDay
          ? "Día de llegada a base pendiente de elegir 100%, 60%, 30% o sin dieta."
          : "Día completo fuera de base sin registrar.",
      });
    }
  } catch {}

  // 2) Duplicados por fecha en jornadas naturales.
  const byNaturalDate = new Map<string, NaturalDayDietEntry[]>();
  for (const n of natural) {
    const arr = byNaturalDate.get(n.date) || [];
    arr.push(n);
    byNaturalDate.set(n.date, arr);
  }
  for (const [date, entries] of byNaturalDate.entries()) {
    if (entries.length > 1) {
      push({
        id: `dup-natural-${date}`,
        severity: "error",
        date,
        title: "Jornada fuera de base duplicada",
        detail: `Hay ${entries.length} registros confirmados para el mismo día.`,
      });
    }
  }

  // Una Jornada fuera de base representa un día natural sin jornada propia.
  const journeyStartsInPeriod = new Map(
    periodJourneys.map((journey) => [journey.fechaInicio, journey] as const),
  );
  for (const n of natural) {
    const sameDateJourney = journeyStartsInPeriod.get(n.date);
    if (sameDateJourney) {
      push({
        id: `natural-overlap-${n.date}`,
        severity: "error",
        date: n.date,
        title: "Jornada fuera de base solapada",
        detail: "Existe también una jornada iniciada este mismo día. Revisa cuál de los dos registros corresponde.",
      });
    }
  }

  // 3) Importes de jornadas naturales: dieta base separada de pluses.
  for (const n of natural) {
    const configured = findRate(customRates, n.type, n.percentage);
    const resolved = resolveNaturalDayDietFinancials(n, all, customRates, dayExtras);
    const rawAmount = Number(n.amount) || 0;
    if (configured > 0 && Math.abs(rawAmount - configured) > 0.011) {
      const excess = Math.round((rawAmount - configured) * 100) / 100;
      push({
        id: `natural-raw-mix-${n.id}`,
        severity: "warning",
        date: n.date,
        title: "Posible mezcla de dieta y plus",
        detail: excess > 0
          ? `El registro guarda ${rawAmount.toFixed(2)} € en dieta; la tarifa base es ${configured.toFixed(2)} € (diferencia ${excess.toFixed(2)} €).`
          : `El registro guarda ${rawAmount.toFixed(2)} € y la tarifa configurada es ${configured.toFixed(2)} €.`,
      });
    }
    if (configured > 0 && Math.abs(resolved.dietAmount - configured) > 0.011) {
      push({
        id: `natural-rate-${n.id}`,
        severity: "warning",
        date: n.date,
        title: "Importe de dieta fuera de tarifa",
        detail: `Guardado ${resolved.dietAmount.toFixed(2)} € · tarifa ${configured.toFixed(2)} €.`,
      });
    }
    if (!n.location || !String(n.location).trim()) {
      push({
        id: `natural-location-${n.id}`,
        severity: "warning",
        date: n.date,
        title: "Ubicación no registrada",
        detail: "La jornada fuera de base no tiene ubicación fiable.",
      });
    }
  }

  // Pluses repetidos dentro del mismo registro suelen ser un doble alta accidental.
  const normalizedPlusConcept = (value: unknown) =>
    String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  for (const n of natural) {
    const seen = new Set<string>();
    for (const plus of n.plusItems || []) {
      const key = normalizedPlusConcept(plus.concepto);
      if (!key) continue;
      if (seen.has(key)) {
        push({
          id: `dup-natural-plus-${n.id}-${key}`,
          severity: "warning",
          date: n.date,
          title: "Plus duplicado",
          detail: `El concepto "${plus.concepto}" aparece más de una vez en la Jornada fuera de base.`,
        });
      }
      seen.add(key);
    }
  }

  for (const j of periodJourneys) {
    const seen = new Set<string>();
    for (const plus of j.plusItems || []) {
      const key = normalizedPlusConcept(plus.concepto);
      if (!key) continue;
      if (seen.has(key)) {
        push({
          id: `dup-journey-plus-${j.id}-${key}`,
          severity: "warning",
          date: j.fechaInicio,
          title: "Plus duplicado",
          detail: `El concepto "${plus.concepto}" aparece más de una vez en la jornada.`,
        });
      }
      seen.add(key);
    }

    const full = Number(j.dietaImporteEur);
    const dayExtra = Number(j.dayExtraEur || 0);
    const storedBase = Number(j.dietBaseEur);
    if (Number.isFinite(full) && Number.isFinite(storedBase) && Math.abs((full - dayExtra) - storedBase) > 0.011) {
      push({
        id: `journey-diet-structure-${j.id}`,
        severity: "error",
        date: j.fechaInicio,
        title: "Importe de dieta mezclado",
        detail: `Dieta total ${full.toFixed(2)} € · extra de día ${dayExtra.toFixed(2)} € · base guardada ${storedBase.toFixed(2)} €.`,
      });
    }

    if (j.dayFlag) {
      const flagKey = normalizedPlusConcept(j.dayFlag);
      const duplicateDayPlus = (j.plusItems || []).some((plus) => {
        const concept = normalizedPlusConcept(plus.concepto);
        return concept.includes(flagKey);
      });
      if (duplicateDayPlus) {
        push({
          id: `dayflag-plus-overlap-${j.id}`,
          severity: "warning",
          date: j.fechaInicio,
          title: "Domingo/festivo duplicado",
          detail: "La jornada tiene un extra de día y además un plus con el mismo concepto.",
        });
      }
    }
  }

  // 4) Jornadas normales: revisar solo cálculos automáticos; respetamos manuales.
  for (const j of periodJourneys) {
    if (!j.fechaFin) {
      push({
        id: `open-${j.id}`,
        severity: "warning",
        date: j.fechaInicio,
        title: "Jornada sin cerrar",
        detail: "La jornada está abierta y no entra en un cálculo definitivo.",
      });
      continue;
    }
    if ((j.paymentMode || "dietas") !== "dietas") continue;
    if (j.dietaModo === "MANUAL") continue;

    const expected = computeDerivedFields(
      j,
      all.filter((o) => o.id !== j.id),
      {
        fechaFin: j.fechaFin,
        horaFin: j.horaFin || "00:00",
        lugarFin: j.lugarFin || "",
        tipoRuta: j.tipoRuta || "NINGUNO",
        pernocta: !!j.pernocta,
        dietaModo: j.dietaModo || "spain_diet",
        dietaPercent: j.dietaPercent ?? undefined,
        // Conserva la clasificación ya decidida al cerrar/editar la jornada.
        // Un null puede ser un "NINGUNO" elegido por el usuario; no debemos
        // convertirlo después en Domingo/Festivo y duplicar un plus manual.
        dayFlag: j.dayFlag || "NINGUNO",
        customRates: customRates || undefined,
        dayExtras,
        holidays,
        conduccionMin: j.conduccionMin,
        conduccionDomingoMin: j.conduccionDomingoMin,
        conduccionLunesMin: j.conduccionLunesMin,
        paymentMode: j.paymentMode || "dietas",
        kmInicio: j.kmInicio,
        kmFin: j.kmFin,
        kmTotal: j.kmTotal,
        pricePerKm: j.pricePerKm,
        importeKm: j.importeKm,
        pricePerTrip: j.pricePerTrip,
        importeViaje: j.importeViaje,
        observaciones: j.observaciones,
      },
    );
    const actual = Number(j.dietaImporteEur || 0);
    const expectedAmount = Number(expected.dietaImporteEur || 0);
    if (Math.abs(actual - expectedAmount) > 0.011) {
      push({
        id: `journey-rate-${j.id}`,
        severity: "warning",
        date: j.fechaInicio,
        title: "Dieta automática desactualizada",
        detail: `Guardado ${actual.toFixed(2)} € · recalculado ${expectedAmount.toFixed(2)} €.`,
      });
    }
  }

  issues.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  return {
    from,
    to,
    checkedJourneys: periodJourneys.length,
    checkedNaturalDays: natural.length,
    issues,
  };
}

export async function recalculatePeriodSafely(from: string, to: string): Promise<{
  recalculatedJourneys: number;
  normalizedNaturalDays: number;
  autoAddedOutOfBaseDays: number;
  manualArrivalDays: DetectedMissingNaturalDay[];
}> {
  let all = await getAllJornadas();
  const { customRates, dayExtras, holidays } = await loadDietDerivationContext();
  let recalculatedJourneys = 0;

  // Recalcula solo jornadas cerradas con cálculo automático. Las dietas MANUAL
  // y los pluses/observaciones del usuario se preservan.
  const nextAll = all.map((j) => {
    if (
      !j.fechaFin ||
      j.fechaInicio < from ||
      j.fechaInicio > to ||
      (j.paymentMode || "dietas") !== "dietas" ||
      j.dietaModo === "MANUAL"
    ) {
      return j;
    }

    const derived = computeDerivedFields(
      j,
      all.filter((o) => o.id !== j.id),
      {
        fechaFin: j.fechaFin,
        horaFin: j.horaFin || "00:00",
        lugarFin: j.lugarFin || "",
        tipoRuta: j.tipoRuta || "NINGUNO",
        pernocta: !!j.pernocta,
        dietaModo: j.dietaModo || "spain_diet",
        dietaPercent: j.dietaPercent ?? undefined,
        dayFlag: j.dayFlag || "NINGUNO",
        customRates: customRates || undefined,
        dayExtras,
        holidays,
        conduccionMin: j.conduccionMin,
        conduccionDomingoMin: j.conduccionDomingoMin,
        conduccionLunesMin: j.conduccionLunesMin,
        paymentMode: j.paymentMode || "dietas",
        kmInicio: j.kmInicio,
        kmFin: j.kmFin,
        kmTotal: j.kmTotal,
        pricePerKm: j.pricePerKm,
        importeKm: j.importeKm,
        pricePerTrip: j.pricePerTrip,
        importeViaje: j.importeViaje,
        observaciones: j.observaciones,
      },
    );

    recalculatedJourneys++;
    return {
      ...j,
      ...derived,
      plusItems: j.plusItems,
      observaciones: j.observaciones,
      isDoubleDriving: j.isDoubleDriving,
      secondDriverName: j.secondDriverName,
      syncStatus: "pending" as const,
    };
  });

  if (recalculatedJourneys > 0) {
    await saveAllJornadas(nextAll);
    all = nextAll;
  }

  // Normaliza registros antiguos que guardaron dieta + plus dentro de amount.
  // Solo se corrigen automáticamente cuando la diferencia puede explicarse
  // exactamente por pluses reconocidos; los casos ambiguos quedan para Revisar.
  let normalizedNaturalDays = 0;
  const naturalAll = await getAllNaturalDayDiets();
  const naturalUpdated: NaturalDayDietEntry[] = [];
  for (const entry of naturalAll) {
    if (entry.date < from || entry.date > to || !entry.confirmedByUser || entry.dismissedAt) {
      naturalUpdated.push(entry);
      continue;
    }

    const configured = findRate(customRates, entry.type, entry.percentage);
    const raw = Number(entry.amount) || 0;
    const resolved = resolveNaturalDayDietFinancials(entry, all, customRates, dayExtras);
    const excess = Math.round((raw - configured) * 100) / 100;
    const explained = excess > 0.009 && Math.abs(excess - resolved.plusTotal) < 0.011;

    if (configured > 0 && Math.abs(raw - configured) > 0.011 && explained) {
      naturalUpdated.push({
        ...entry,
        amount: Math.round(configured * 100) / 100,
        plusItems: resolved.plusItems.length > 0 ? resolved.plusItems : entry.plusItems,
        updatedAt: new Date().toISOString(),
        syncStatus: "pending",
      });
      normalizedNaturalDays++;
    } else {
      naturalUpdated.push(entry);
    }
  }
  if (normalizedNaturalDays > 0) {
    await replaceImportedNaturalDayDiets(naturalUpdated);
  }

  // Detecta días completos intermedios y los crea automáticamente. Los días de
  // llegada a base siguen siendo manuales porque requieren elegir porcentaje.
  const missing = await detectMissingOutOfBaseDietDays({ fromDate: from, toDate: to });
  const autoDays = missing.filter((item) => item.isBaseArrivalDay !== true);
  const manualArrivalDays = missing.filter((item) => item.isBaseArrivalDay === true);
  const created = await autoConfirmOutOfBaseDietDays(autoDays);

  return {
    recalculatedJourneys,
    normalizedNaturalDays,
    autoAddedOutOfBaseDays: created.length,
    manualArrivalDays,
  };
}

export async function getResumenDietas(
  from: string,
  to: string,
): Promise<{
  total: number;
  desglose: Array<{ tipo: string; cantidad: number; total: number }>;
  extras: { totalExtras: number; desglose: Array<{ tipo: string; cantidad: number; total: number }> };
  plus: { totalPlus: number; desglose: Array<{ tipo: string; cantidad: number; total: number }> };
}> {
  const all = await getAllJornadas();
  const jornadasPeriodo = all.filter(
    (j) =>
      j.fechaFin &&
      j.fechaInicio >= from &&
      j.fechaInicio <= to &&
      (j.paymentMode || "dietas") === "dietas",
  );

  const desglose: Record<string, { cantidad: number; total: number }> = {};
  const extrasDesglose: Record<string, { cantidad: number; total: number }> = {};
  let totalGeneral = 0;
  let totalExtras = 0;
  let totalPlus = 0;
  const plusDesglose: Record<string, { cantidad: number; total: number }> = {};
  let extrasCfg: UserDayExtras = {
    extra_saturday: 0,
    extra_sunday: 0,
    extra_holiday: 0,
    offsite_weekly_reduced_nacional: 0,
    offsite_weekly_reduced_internacional: 0,
    offsite_weekly_complete_nacional: 0,
    offsite_weekly_complete_internacional: 0,
  };
  try {
    const raw = await AsyncStorage.getItem(await userScopedKey("tacoplan_user_settings"));
    if (raw) {
      const s = JSON.parse(raw);
      const pf = (v: any, fb: number) => { const n = parseFloat(v); return Number.isFinite(n) ? n : fb; };
      extrasCfg = {
        extra_saturday: pf(s.extra_saturday, 0),
        extra_sunday: pf(s.extra_sunday, 0),
        extra_holiday: pf(s.extra_holiday, 0),
        offsite_weekly_reduced_nacional: pf(s.offsite_weekly_reduced_nacional, 0),
        offsite_weekly_reduced_internacional: pf(s.offsite_weekly_reduced_internacional, 0),
        offsite_weekly_complete_nacional: pf(s.offsite_weekly_complete_nacional, 0),
        offsite_weekly_complete_internacional: pf(s.offsite_weekly_complete_internacional, 0),
      };
    }
  } catch {}

  for (const j of jornadasPeriodo) {
    if (j.plusItems && j.plusItems.length > 0) {
      for (const pi of j.plusItems) {
        totalPlus = Math.round((totalPlus + pi.importe) * 100) / 100;
        if (!plusDesglose[pi.concepto]) plusDesglose[pi.concepto] = { cantidad: 0, total: 0 };
        plusDesglose[pi.concepto].cantidad++;
        plusDesglose[pi.concepto].total = Math.round((plusDesglose[pi.concepto].total + pi.importe) * 100) / 100;
      }
    }
    if (j.dayFlag) {
      let extraImporte = j.dayExtraEur ? parseFloat(j.dayExtraEur) : 0;
      if (!Number.isFinite(extraImporte) || extraImporte <= 0) {
        extraImporte = calcDayExtra(j.dayFlag, extrasCfg);
      }
      if (extraImporte > 0) {
        const extraKey = j.dayFlag;
        if (!extrasDesglose[extraKey]) extrasDesglose[extraKey] = { cantidad: 0, total: 0 };
        extrasDesglose[extraKey].cantidad++;
        extrasDesglose[extraKey].total = Math.round((extrasDesglose[extraKey].total + extraImporte) * 100) / 100;
        totalExtras = Math.round((totalExtras + extraImporte) * 100) / 100;
      }
    }

    if (!j.dietaImporteEur) continue;
    const importe = parseFloat(j.dietaImporteEur);
    const dayExtraInDieta = j.dayExtraEur ? parseFloat(j.dayExtraEur) : 0;
    totalGeneral += (importe - dayExtraInDieta);

    if (j.dietasItems && j.dietasItems.length > 0) {
      for (const item of j.dietasItems) {
        const key = `${item.tipo}_${item.pct}`;
        if (!desglose[key]) desglose[key] = { cantidad: 0, total: 0 };
        desglose[key].cantidad++;
        desglose[key].total = Math.round((desglose[key].total + item.importe) * 100) / 100;
      }
    } else {
      let key: string;
      if (j.dietaModo === "MANUAL" && j.dietaManualTipo && j.dietaManualPct) {
        key = `${j.dietaManualTipo}_${j.dietaManualPct}`;
      } else if (j.tipoRuta === "NAC_INTL") {
        key = "NAC_INTL_AUTO";
      } else if (j.tipoRuta === "NACIONAL" || j.tipoRuta === "NAC_REGIONAL") {
        key = "NACIONAL_100";
      } else if (j.tipoRuta === "INTERNACIONAL") {
        key = "INTERNACIONAL_100";
      } else {
        key = "INTERNACIONAL_60";
      }
      if (!desglose[key]) desglose[key] = { cantidad: 0, total: 0 };
      desglose[key].cantidad++;
      desglose[key].total = Math.round((desglose[key].total + (importe - dayExtraInDieta)) * 100) / 100;
    }
  }

  const naturalDayDiets = await getAllNaturalDayDiets();
  const { customRates: naturalDayRates } = await loadDietDerivationContext();
  for (const nd of naturalDayDiets) {
    if (nd.date < from || nd.date > to) continue;
    if (!nd.confirmedByUser || nd.dismissedAt) continue;

    const resolved = resolveNaturalDayDietFinancials(nd, all, naturalDayRates, extrasCfg);
    const dietAmount = resolved.dietAmount;

    totalGeneral = Math.round((totalGeneral + dietAmount) * 100) / 100;
    const key = `${nd.type}_${nd.percentage}`;
    if (!desglose[key]) desglose[key] = { cantidad: 0, total: 0 };
    desglose[key].cantidad++;
    desglose[key].total = Math.round((desglose[key].total + dietAmount) * 100) / 100;

    for (const pi of resolved.plusItems) {
      const amt = Number.isFinite(Number(pi.amount)) ? Number(pi.amount) : 0;
      if (amt <= 0) continue;
      totalPlus = Math.round((totalPlus + amt) * 100) / 100;
      const concepto = String(pi.concepto || "Plus").trim().slice(0, 100) || "Plus";
      if (!plusDesglose[concepto]) plusDesglose[concepto] = { cantidad: 0, total: 0 };
      plusDesglose[concepto].cantidad++;
      plusDesglose[concepto].total = Math.round((plusDesglose[concepto].total + amt) * 100) / 100;
    }
  }

  const extraDays = await listDayExtraEntries(from, to);
  for (const e of extraDays) {
    if (e.entryType === "offsite_weekly_rest") {
      const split = splitOffsiteWeeklyRestEntry(e, extrasCfg);
      if (split.restAmount > 0) {
        const key = `FUERA_BASE_${e.offsiteRestType || "WEEKLY_COMPLETE"}_${e.offsiteBase || "NACIONAL"}`;
        if (!desglose[key]) desglose[key] = { cantidad: 0, total: 0 };
        desglose[key].cantidad++;
        desglose[key].total = Math.round((desglose[key].total + split.restAmount) * 100) / 100;
        totalGeneral = Math.round((totalGeneral + split.restAmount) * 100) / 100;
      }
      if (split.plusAmount > 0) {
        if (e.plusSunday) {
          const k = "DOMINGO";
          if (!extrasDesglose[k]) extrasDesglose[k] = { cantidad: 0, total: 0 };
          extrasDesglose[k].cantidad++;
          extrasDesglose[k].total = Math.round((extrasDesglose[k].total + calcDayExtra("DOMINGO", extrasCfg)) * 100) / 100;
        }
        if (e.plusHoliday) {
          const k = "FESTIVO";
          if (!extrasDesglose[k]) extrasDesglose[k] = { cantidad: 0, total: 0 };
          extrasDesglose[k].cantidad++;
          extrasDesglose[k].total = Math.round((extrasDesglose[k].total + calcDayExtra("FESTIVO", extrasCfg)) * 100) / 100;
        }
        totalExtras = Math.round((totalExtras + split.plusAmount) * 100) / 100;
      }
      continue;
    }

    if (!e.dayFlag) continue;
    const extraImporte = e.amount != null ? e.amount : calcDayExtra(e.dayFlag, extrasCfg);
    if (!Number.isFinite(extraImporte) || extraImporte <= 0) continue;
    const extraKey = e.dayFlag;
    if (!extrasDesglose[extraKey]) extrasDesglose[extraKey] = { cantidad: 0, total: 0 };
    extrasDesglose[extraKey].cantidad++;
    extrasDesglose[extraKey].total = Math.round((extrasDesglose[extraKey].total + extraImporte) * 100) / 100;
    totalExtras = Math.round((totalExtras + extraImporte) * 100) / 100;
  }

  return {
    total: Math.round(totalGeneral * 100) / 100,
    desglose: Object.entries(desglose).map(([tipo, data]) => ({
      tipo,
      ...data,
    })),
    extras: {
      totalExtras,
      desglose: Object.entries(extrasDesglose).map(([tipo, data]) => ({
        tipo,
        ...data,
      })),
    },
    plus: {
      totalPlus,
      desglose: Object.entries(plusDesglose).map(([tipo, data]) => ({
        tipo,
        ...data,
      })),
    },
  };
}

export async function getResumenKm(
  from: string,
  to: string,
): Promise<{
  totalKm: number;
  totalImporte: number;
  desglose: Array<{ tipo: string; cantidad: number; total: number }>;
  dietas: { totalDietas: number; desglose: Array<{ tipo: string; cantidad: number; total: number }> };
  extras: { totalExtras: number; desglose: Array<{ tipo: string; cantidad: number; total: number }> };
  plus: { totalPlus: number; desglose: Array<{ tipo: string; cantidad: number; total: number }> };
}> {
  const all = await getAllJornadas();
  const jornadasPeriodo = all.filter(
    (j) =>
      j.fechaFin &&
      j.fechaInicio >= from &&
      j.fechaInicio <= to &&
      (j.paymentMode || "dietas") === "km",
  );

  const desglose: Record<string, { cantidad: number; total: number }> = {};
  const dietasDesglose: Record<string, { cantidad: number; total: number }> = {};
  const extrasDesglose: Record<string, { cantidad: number; total: number }> = {};
  const plusDesglose: Record<string, { cantidad: number; total: number }> = {};
  let totalKm = 0;
  let totalImporte = 0;
  let totalDietas = 0;
  let totalExtras = 0;
  let totalPlus = 0;

  let extrasCfg: UserDayExtras = {
    extra_saturday: 0,
    extra_sunday: 0,
    extra_holiday: 0,
    offsite_weekly_reduced_nacional: 0,
    offsite_weekly_reduced_internacional: 0,
    offsite_weekly_complete_nacional: 0,
    offsite_weekly_complete_internacional: 0,
  };
  try {
    const raw = await AsyncStorage.getItem(await userScopedKey("tacoplan_user_settings"));
    if (raw) {
      const s = JSON.parse(raw);
      const pf = (v: any, fb: number) => { const n = parseFloat(v); return Number.isFinite(n) ? n : fb; };
      extrasCfg = {
        extra_saturday: pf(s.extra_saturday, 0),
        extra_sunday: pf(s.extra_sunday, 0),
        extra_holiday: pf(s.extra_holiday, 0),
        offsite_weekly_reduced_nacional: pf(s.offsite_weekly_reduced_nacional, 0),
        offsite_weekly_reduced_internacional: pf(s.offsite_weekly_reduced_internacional, 0),
        offsite_weekly_complete_nacional: pf(s.offsite_weekly_complete_nacional, 0),
        offsite_weekly_complete_internacional: pf(s.offsite_weekly_complete_internacional, 0),
      };
    }
  } catch {}

  const kmCategory = (tipoRuta: string | null | undefined): "NACIONAL" | "INTERNACIONAL" | "REGIONAL" => {
    if (tipoRuta === "INTERNACIONAL" || tipoRuta === "REGIONAL_INTL" || tipoRuta === "NAC_INTL") return "INTERNACIONAL";
    if (tipoRuta === "REGIONAL") return "REGIONAL";
    return "NACIONAL";
  };

  for (const j of jornadasPeriodo) {
    if (j.plusItems && j.plusItems.length > 0) {
      for (const pi of j.plusItems) {
        totalPlus = Math.round((totalPlus + pi.importe) * 100) / 100;
        if (!plusDesglose[pi.concepto]) plusDesglose[pi.concepto] = { cantidad: 0, total: 0 };
        plusDesglose[pi.concepto].cantidad++;
        plusDesglose[pi.concepto].total = Math.round((plusDesglose[pi.concepto].total + pi.importe) * 100) / 100;
      }
    }

    if (j.dayFlag) {
      let extraImporte = j.dayExtraEur ? parseFloat(j.dayExtraEur) : 0;
      if (!Number.isFinite(extraImporte) || extraImporte <= 0) {
        extraImporte = calcDayExtra(j.dayFlag, extrasCfg);
      }
      if (extraImporte > 0) {
        const extraKey = j.dayFlag;
        if (!extrasDesglose[extraKey]) extrasDesglose[extraKey] = { cantidad: 0, total: 0 };
        extrasDesglose[extraKey].cantidad++;
        extrasDesglose[extraKey].total = Math.round((extrasDesglose[extraKey].total + extraImporte) * 100) / 100;
        totalExtras = Math.round((totalExtras + extraImporte) * 100) / 100;
      }
    }

    const km = j.kmTotal != null ? j.kmTotal : (j.kmInicio != null && j.kmFin != null ? (j.kmFin - j.kmInicio) : 0);
    const kmSafe = Number.isFinite(km) ? km : 0;
    totalKm += kmSafe;

    const importe = j.importeKm != null ? j.importeKm : (j.pricePerKm != null ? kmSafe * j.pricePerKm : 0);
    const importeSafe = Number.isFinite(importe) ? importe : 0;
    totalImporte = Math.round((totalImporte + importeSafe) * 100) / 100;

    const key = kmCategory(j.tipoRuta);
    if (!desglose[key]) desglose[key] = { cantidad: 0, total: 0 };
    desglose[key].cantidad = Math.round((desglose[key].cantidad + kmSafe) * 100) / 100;
    desglose[key].total = Math.round((desglose[key].total + importeSafe) * 100) / 100;
  }

  const naturalDayDietsKm = await getAllNaturalDayDiets();
  const { customRates: naturalRatesKm } = await loadDietDerivationContext();
  for (const nd of naturalDayDietsKm) {
    if (nd.date < from || nd.date > to) continue;
    if (!nd.confirmedByUser || nd.dismissedAt) continue;

    const resolved = resolveNaturalDayDietFinancials(nd, all, naturalRatesKm, extrasCfg);
    totalDietas = Math.round((totalDietas + resolved.dietAmount) * 100) / 100;
    const key = `${nd.type}_${nd.percentage}`;
    if (!dietasDesglose[key]) dietasDesglose[key] = { cantidad: 0, total: 0 };
    dietasDesglose[key].cantidad++;
    dietasDesglose[key].total = Math.round((dietasDesglose[key].total + resolved.dietAmount) * 100) / 100;

    for (const plus of resolved.plusItems) {
      const amount = Number(plus.amount) || 0;
      if (amount <= 0) continue;
      const concepto = String(plus.concepto || "Plus").trim() || "Plus";
      totalPlus = Math.round((totalPlus + amount) * 100) / 100;
      if (!plusDesglose[concepto]) plusDesglose[concepto] = { cantidad: 0, total: 0 };
      plusDesglose[concepto].cantidad++;
      plusDesglose[concepto].total = Math.round((plusDesglose[concepto].total + amount) * 100) / 100;
    }
  }

  const extraDays = await listDayExtraEntries(from, to);
  for (const e of extraDays) {
    if (e.entryType === "offsite_weekly_rest") {
      const split = splitOffsiteWeeklyRestEntry(e, extrasCfg);
      if (split.restAmount > 0) {
        const key = `FUERA_BASE_${e.offsiteRestType || "WEEKLY_COMPLETE"}_${e.offsiteBase || "NACIONAL"}`;
        if (!dietasDesglose[key]) dietasDesglose[key] = { cantidad: 0, total: 0 };
        dietasDesglose[key].cantidad++;
        dietasDesglose[key].total = Math.round((dietasDesglose[key].total + split.restAmount) * 100) / 100;
        totalDietas = Math.round((totalDietas + split.restAmount) * 100) / 100;
      }
      if (split.plusAmount > 0) {
        if (e.plusSunday) {
          const k = "DOMINGO";
          if (!extrasDesglose[k]) extrasDesglose[k] = { cantidad: 0, total: 0 };
          extrasDesglose[k].cantidad++;
          extrasDesglose[k].total = Math.round((extrasDesglose[k].total + calcDayExtra("DOMINGO", extrasCfg)) * 100) / 100;
        }
        if (e.plusHoliday) {
          const k = "FESTIVO";
          if (!extrasDesglose[k]) extrasDesglose[k] = { cantidad: 0, total: 0 };
          extrasDesglose[k].cantidad++;
          extrasDesglose[k].total = Math.round((extrasDesglose[k].total + calcDayExtra("FESTIVO", extrasCfg)) * 100) / 100;
        }
        totalExtras = Math.round((totalExtras + split.plusAmount) * 100) / 100;
      }
      continue;
    }

    if (!e.dayFlag) continue;
    const extraImporte = e.amount != null ? e.amount : calcDayExtra(e.dayFlag, extrasCfg);
    if (!Number.isFinite(extraImporte) || extraImporte <= 0) continue;
    const extraKey = e.dayFlag;
    if (!extrasDesglose[extraKey]) extrasDesglose[extraKey] = { cantidad: 0, total: 0 };
    extrasDesglose[extraKey].cantidad++;
    extrasDesglose[extraKey].total = Math.round((extrasDesglose[extraKey].total + extraImporte) * 100) / 100;
    totalExtras = Math.round((totalExtras + extraImporte) * 100) / 100;
  }

  return {
    totalKm: Math.round(totalKm * 100) / 100,
    totalImporte: Math.round(totalImporte * 100) / 100,
    desglose: Object.entries(desglose).map(([tipo, data]) => ({ tipo, ...data })),
    dietas: {
      totalDietas,
      desglose: Object.entries(dietasDesglose).map(([tipo, data]) => ({ tipo, ...data })),
    },
    extras: {
      totalExtras,
      desglose: Object.entries(extrasDesglose).map(([tipo, data]) => ({ tipo, ...data })),
    },
    plus: {
      totalPlus,
      desglose: Object.entries(plusDesglose).map(([tipo, data]) => ({ tipo, ...data })),
    },
  };
}

export async function getResumenViaje(
  from: string,
  to: string,
): Promise<{
  totalViajes: number;
  totalImporte: number;
  desglose: Array<{ tipo: string; cantidad: number; total: number }>;
  dietas: { totalDietas: number; desglose: Array<{ tipo: string; cantidad: number; total: number }> };
  extras: { totalExtras: number; desglose: Array<{ tipo: string; cantidad: number; total: number }> };
  plus: { totalPlus: number; desglose: Array<{ tipo: string; cantidad: number; total: number }> };
}> {
  const all = await getAllJornadas();
  const jornadasPeriodo = all.filter(
    (j) =>
      j.fechaFin &&
      j.fechaInicio >= from &&
      j.fechaInicio <= to &&
      (j.paymentMode || "dietas") === "viaje",
  );

  const desglose: Record<string, { cantidad: number; total: number }> = {};
  const dietasDesglose: Record<string, { cantidad: number; total: number }> = {};
  const extrasDesglose: Record<string, { cantidad: number; total: number }> = {};
  const plusDesglose: Record<string, { cantidad: number; total: number }> = {};
  let totalViajes = 0;
  let totalImporte = 0;
  let totalDietas = 0;
  let totalExtras = 0;
  let totalPlus = 0;

  let extrasCfg: UserDayExtras = {
    extra_saturday: 0,
    extra_sunday: 0,
    extra_holiday: 0,
    offsite_weekly_reduced_nacional: 0,
    offsite_weekly_reduced_internacional: 0,
    offsite_weekly_complete_nacional: 0,
    offsite_weekly_complete_internacional: 0,
  };
  try {
    const raw = await AsyncStorage.getItem(await userScopedKey("tacoplan_user_settings"));
    if (raw) {
      const s = JSON.parse(raw);
      const pf = (v: any, fb: number) => { const n = parseFloat(v); return Number.isFinite(n) ? n : fb; };
      extrasCfg = {
        extra_saturday: pf(s.extra_saturday, 0),
        extra_sunday: pf(s.extra_sunday, 0),
        extra_holiday: pf(s.extra_holiday, 0),
        offsite_weekly_reduced_nacional: pf(s.offsite_weekly_reduced_nacional, 0),
        offsite_weekly_reduced_internacional: pf(s.offsite_weekly_reduced_internacional, 0),
        offsite_weekly_complete_nacional: pf(s.offsite_weekly_complete_nacional, 0),
        offsite_weekly_complete_internacional: pf(s.offsite_weekly_complete_internacional, 0),
      };
    }
  } catch {}

  const tripCategory = (tipoRuta: string | null | undefined): "NACIONAL" | "INTERNACIONAL" | "REGIONAL" => {
    if (tipoRuta === "INTERNACIONAL" || tipoRuta === "REGIONAL_INTL" || tipoRuta === "NAC_INTL") return "INTERNACIONAL";
    if (tipoRuta === "REGIONAL") return "REGIONAL";
    return "NACIONAL";
  };

  for (const j of jornadasPeriodo) {
    if (j.plusItems && j.plusItems.length > 0) {
      for (const pi of j.plusItems) {
        totalPlus = Math.round((totalPlus + pi.importe) * 100) / 100;
        if (!plusDesglose[pi.concepto]) plusDesglose[pi.concepto] = { cantidad: 0, total: 0 };
        plusDesglose[pi.concepto].cantidad++;
        plusDesglose[pi.concepto].total = Math.round((plusDesglose[pi.concepto].total + pi.importe) * 100) / 100;
      }
    }

    if (j.dayFlag) {
      let extraImporte = j.dayExtraEur ? parseFloat(j.dayExtraEur) : 0;
      if (!Number.isFinite(extraImporte) || extraImporte <= 0) {
        extraImporte = calcDayExtra(j.dayFlag, extrasCfg);
      }
      if (extraImporte > 0) {
        const extraKey = j.dayFlag;
        if (!extrasDesglose[extraKey]) extrasDesglose[extraKey] = { cantidad: 0, total: 0 };
        extrasDesglose[extraKey].cantidad++;
        extrasDesglose[extraKey].total = Math.round((extrasDesglose[extraKey].total + extraImporte) * 100) / 100;
        totalExtras = Math.round((totalExtras + extraImporte) * 100) / 100;
      }
    }

    const importe = j.importeViaje != null ? j.importeViaje : (j.pricePerTrip != null ? j.pricePerTrip : 0);
    const importeSafe = Number.isFinite(importe) ? importe : 0;
    if (importeSafe > 0) {
      totalViajes += 1;
      totalImporte = Math.round((totalImporte + importeSafe) * 100) / 100;
      const key = tripCategory(j.tipoRuta);
      if (!desglose[key]) desglose[key] = { cantidad: 0, total: 0 };
      desglose[key].cantidad++;
      desglose[key].total = Math.round((desglose[key].total + importeSafe) * 100) / 100;
    }
  }

  const naturalDayDietsViaje = await getAllNaturalDayDiets();
  const { customRates: naturalRatesViaje } = await loadDietDerivationContext();
  for (const nd of naturalDayDietsViaje) {
    if (nd.date < from || nd.date > to) continue;
    if (!nd.confirmedByUser || nd.dismissedAt) continue;

    const resolved = resolveNaturalDayDietFinancials(nd, all, naturalRatesViaje, extrasCfg);
    totalDietas = Math.round((totalDietas + resolved.dietAmount) * 100) / 100;
    const key = `${nd.type}_${nd.percentage}`;
    if (!dietasDesglose[key]) dietasDesglose[key] = { cantidad: 0, total: 0 };
    dietasDesglose[key].cantidad++;
    dietasDesglose[key].total = Math.round((dietasDesglose[key].total + resolved.dietAmount) * 100) / 100;

    for (const plus of resolved.plusItems) {
      const amount = Number(plus.amount) || 0;
      if (amount <= 0) continue;
      const concepto = String(plus.concepto || "Plus").trim() || "Plus";
      totalPlus = Math.round((totalPlus + amount) * 100) / 100;
      if (!plusDesglose[concepto]) plusDesglose[concepto] = { cantidad: 0, total: 0 };
      plusDesglose[concepto].cantidad++;
      plusDesglose[concepto].total = Math.round((plusDesglose[concepto].total + amount) * 100) / 100;
    }
  }

  const extraDays = await listDayExtraEntries(from, to);
  for (const e of extraDays) {
    if (e.entryType === "offsite_weekly_rest") {
      const split = splitOffsiteWeeklyRestEntry(e, extrasCfg);
      if (split.restAmount > 0) {
        const key = `FUERA_BASE_${e.offsiteRestType || "WEEKLY_COMPLETE"}_${e.offsiteBase || "NACIONAL"}`;
        if (!dietasDesglose[key]) dietasDesglose[key] = { cantidad: 0, total: 0 };
        dietasDesglose[key].cantidad++;
        dietasDesglose[key].total = Math.round((dietasDesglose[key].total + split.restAmount) * 100) / 100;
        totalDietas = Math.round((totalDietas + split.restAmount) * 100) / 100;
      }
      if (split.plusAmount > 0) {
        if (e.plusSunday) {
          const k = "DOMINGO";
          if (!extrasDesglose[k]) extrasDesglose[k] = { cantidad: 0, total: 0 };
          extrasDesglose[k].cantidad++;
          extrasDesglose[k].total = Math.round((extrasDesglose[k].total + calcDayExtra("DOMINGO", extrasCfg)) * 100) / 100;
        }
        if (e.plusHoliday) {
          const k = "FESTIVO";
          if (!extrasDesglose[k]) extrasDesglose[k] = { cantidad: 0, total: 0 };
          extrasDesglose[k].cantidad++;
          extrasDesglose[k].total = Math.round((extrasDesglose[k].total + calcDayExtra("FESTIVO", extrasCfg)) * 100) / 100;
        }
        totalExtras = Math.round((totalExtras + split.plusAmount) * 100) / 100;
      }
      continue;
    }

    if (!e.dayFlag) continue;
    const extraImporte = e.amount != null ? e.amount : calcDayExtra(e.dayFlag, extrasCfg);
    if (!Number.isFinite(extraImporte) || extraImporte <= 0) continue;
    const extraKey = e.dayFlag;
    if (!extrasDesglose[extraKey]) extrasDesglose[extraKey] = { cantidad: 0, total: 0 };
    extrasDesglose[extraKey].cantidad++;
    extrasDesglose[extraKey].total = Math.round((extrasDesglose[extraKey].total + extraImporte) * 100) / 100;
    totalExtras = Math.round((totalExtras + extraImporte) * 100) / 100;
  }

  return {
    totalViajes,
    totalImporte: Math.round(totalImporte * 100) / 100,
    desglose: Object.entries(desglose).map(([tipo, data]) => ({ tipo, ...data })),
    dietas: {
      totalDietas,
      desglose: Object.entries(dietasDesglose).map(([tipo, data]) => ({ tipo, ...data })),
    },
    extras: {
      totalExtras,
      desglose: Object.entries(extrasDesglose).map(([tipo, data]) => ({ tipo, ...data })),
    },
    plus: {
      totalPlus,
      desglose: Object.entries(plusDesglose).map(([tipo, data]) => ({ tipo, ...data })),
    },
  };
}

export async function getEstadoLegal(): Promise<EstadoLegal> {
  const ahora = new Date();
  const lunes = getMondayOfUtcWeek(ahora);
  const domingo = getSundayOfUtcWeek(ahora);
  const lunesStr = formatUTCDateStr(lunes);
  const domingoStr = formatUTCDateStr(domingo);

  const lunesAnterior = new Date(lunes);
  lunesAnterior.setUTCDate(lunesAnterior.getUTCDate() - 7);
  const lunesAnteriorStr = formatUTCDateStr(lunesAnterior);

  const all = await getAllJornadas();

  for (const j of all) {
    if (!j.endAt) continue;
    const anterior = findPreviousClosed(
      all.filter((o) => o.id !== j.id),
      j.startAt,
    );
    if (anterior && anterior.endAt) {
      j.descansoAnteriorMin = calcMinutesBetween(anterior.endAt, j.startAt);
      if (isSplitDailyRestGapComplete(j.descansoAnteriorMin, anterior)) {
        j.tipoDescansoAnterior = "DESCANSO_DIARIO_COMPLETO";
      } else {
        j.tipoDescansoAnterior = clasificarDescanso(j.descansoAnteriorMin);
      }
    }
  }

  const domingoAnteriorStr = formatUTCDateStr(new Date(lunes.getTime() - 86400000));

  const jornadasSemana = all.filter(
    (j) => j.fechaFin && (
      (getJornadaUtcStartDateStr(j) >= lunesStr && getJornadaUtcStartDateStr(j) <= domingoStr) ||
      jornadaOverlapsWeek(j, lunesStr, domingoStr)
    ),
  );

  const jornadasBisemana = all.filter(
    (j) => j.fechaFin && (
      (getJornadaUtcStartDateStr(j) >= lunesAnteriorStr && getJornadaUtcStartDateStr(j) <= domingoStr) ||
      jornadaOverlapsWeek(j, lunesStr, domingoStr) ||
      jornadaOverlapsWeek(j, lunesAnteriorStr, domingoAnteriorStr)
    ),
  );

  let conduccionSemanalMin = 0;
  let extensiones10h = 0;

  const seenWeekly = new Set<string>();
  for (const j of jornadasSemana) {
    if (seenWeekly.has(j.id)) continue;
    seenWeekly.add(j.id);
    const weekDriving = getJornadaDrivingForWeek(j, lunesStr, domingoStr);
    conduccionSemanalMin += weekDriving;

    const durMin = j.duracionJornadaMin || 0;
    const condMin = j.conduccionMin || 0;
    if (condMin > 9 * 60) extensiones10h++;
  }

  const abierta = all.find((j) => !j.fechaFin);
  const descansosReducidos = computeReducedRestsInUtcWeek(
    all,
    lunesStr,
    domingoStr,
    abierta ? {
      startAt: abierta.startAt,
      descansoAnteriorMin: abierta.descansoAnteriorMin,
      tipoDescansoAnterior: abierta.tipoDescansoAnterior,
    } : null,
  );

  let conduccionBisemanalMin = 0;
  const seenBiweekly = new Set<string>();
  for (const j of jornadasBisemana) {
    if (seenBiweekly.has(j.id)) continue;
    seenBiweekly.add(j.id);
    const weekDriving = getJornadaDrivingForWeek(j, lunesStr, domingoStr);
    const prevWeekDriving = getJornadaDrivingForWeek(j, lunesAnteriorStr, domingoAnteriorStr);
    conduccionBisemanalMin += weekDriving + prevWeekDriving;
  }

  const maxSemanalMin = 56 * 60;
  const maxBisemanalMin = 90 * 60;

  const comps = await getAllCompensaciones();
  // REGLA 52 DÍAS: sólo pendientes DENTRO de la ventana de policía activa
  // participan en el banner / agregada / alertas. Se filtra por FECHA de la
  // JORNADA (fechaInicio) que generó la compensación; NO por fechaLimite.
  // Las compensaciones fuera de 52d hacia atrás quedan en BBDD pero "prescritas en UI".
  const compPendientes = comps
    .filter(c => isCompWithinPoliceWindow(c, all, ahora))
    .sort((a, b) => a.fechaLimite.localeCompare(b.fechaLimite));

  const compFueraVentana = comps.filter(c => !c.compensada && !isCompWithinPoliceWindow(c, all, ahora));

  const hoyStr = formatDateStr(ahora);

  let compensacionAgregada: CompensacionAgregada | null = null;

  if (compPendientes.length > 0) {
    let totalDeudaMin = 0;
    const detalle: CompensacionAgregada["detalle"] = [];
    const ids: string[] = [];

    for (const c of compPendientes) {
      const hOk = Number.isFinite(c.horasDeuda) ? Number(c.horasDeuda) : 0;
      const mOk = Number.isFinite(c.minutosDeuda) ? Number(c.minutosDeuda) : 0;
      const cMin = Math.max(0, hOk * 60 + mOk);
      const cMinClamped = Math.min(cMin, 48 * 60);
      totalDeudaMin += cMinClamped;
      ids.push(c.id);

      let fechaDescanso = "-";
      if (c.jornadaId) {
        const jornadaLinked = all.find((j) => j.id === c.jornadaId);
        if (jornadaLinked) {
          fechaDescanso = jornadaLinked.fechaInicio;
        }
      }

      detalle.push({
        id: c.id,
        horasDeuda: Math.floor(cMinClamped / 60),
        minutosDeuda: cMinClamped % 60,
        fechaDescanso,
      });
    }

    totalDeudaMin = Math.max(0, Math.floor(totalDeudaMin));
    const fechaLimite = compPendientes[0].fechaLimite;
    const fechaPrimerReducido = detalle.length > 0 ? detalle[0].fechaDescanso : null;

    compensacionAgregada = {
      ids,
      totalDeudaHoras: Math.floor(totalDeudaMin / 60),
      totalDeudaMinutos: totalDeudaMin % 60,
      fechaPrimerReducido,
      fechaLimite,
      vencida: fechaLimite < hoyStr,
      detalle,
    };
  }

  const alertas: EstadoLegal["alertas"] = [];
  const restanteSemanalMin = maxSemanalMin - conduccionSemanalMin;
  const restanteBisemanalMin = maxBisemanalMin - conduccionBisemanalMin;

  if (restanteSemanalMin <= 10 * 60 && restanteSemanalMin > 0) {
    const h = Math.floor(restanteSemanalMin / 60);
    const m = restanteSemanalMin % 60;
    alertas.push({ tipo: "warning", mensaje: `Te quedan ${h}h ${m}m de conduccion semanal` });
  }
  if (restanteSemanalMin <= 0) {
    alertas.push({ tipo: "danger", mensaje: "Has superado el limite de 56h semanales de conduccion" });
  }

  if (restanteBisemanalMin <= 10 * 60 && restanteBisemanalMin > 0) {
    const h = Math.floor(restanteBisemanalMin / 60);
    const m = restanteBisemanalMin % 60;
    alertas.push({ tipo: "warning", mensaje: `Te quedan ${h}h ${m}m de conduccion bisemanal` });
  }
  if (restanteBisemanalMin <= 0) {
    alertas.push({ tipo: "danger", mensaje: "Has superado el limite de 90h bisemanales de conduccion" });
  }

  if (extensiones10h >= 2) {
    alertas.push({ tipo: "danger", mensaje: "Has usado las 2 extensiones de 10h esta semana" });
  }

  if (descansosReducidos >= 3) {
    alertas.push({ tipo: "danger", mensaje: "Has usado los 3 descansos diarios reducidos. Disponibilidad limitada a 13h." });
  }

  if (compensacionAgregada) {
    const totalMin = Number(compensacionAgregada.totalDeudaHoras || 0) * 60 + Number(compensacionAgregada.totalDeudaMinutos || 0);
    const hTot = Math.floor(totalMin / 60);
    const mTot = totalMin % 60;
    const fmtTot = mTot > 0 ? `${hTot}h ${mTot}m` : `${hTot}h`;
    if (compensacionAgregada.vencida) {
      alertas.push({
        tipo: "danger",
        mensaje: `INFRACCION: ${fmtTot} de descanso reducido no compensado (limite: ${formatFechaES(compensacionAgregada.fechaLimite)})`,
      });
    } else {
      alertas.push({
        tipo: "warning",
        mensaje: `Compensar ${fmtTot} antes del ${formatFechaES(compensacionAgregada.fechaLimite)}`,
      });
    }
  }

  return {
    conduccionSemanalMin,
    conduccionBisemanalMin,
    maxSemanalMin,
    maxBisemanalMin,
    restanteSemanalMin: Math.max(0, restanteSemanalMin),
    restanteBisemanalMin: Math.max(0, restanteBisemanalMin),
    extensiones10h,
    maxExtensiones: 2,
    descansosReducidos,
    maxDescansosReducidos: 3,
    disponibilidadMin: descansosReducidos < 3 ? 15 * 60 : 13 * 60,
    compensacionAgregada,
    alertas,
  };
}

export async function marcarTodasCompensadas(): Promise<void> {
  const comps = await getAllCompensaciones();
  const hoyStr = formatDateStr(new Date());
  const now = new Date().toISOString();
  for (const c of comps) {
    if (!c.compensada) {
      c.compensada = true;
      c.fechaCompensacion = hoyStr;
      c.updatedAt = now;
      c.syncStatus = "pending";
    }
  }
  await saveAllCompensaciones(comps);
}

export async function getPendingSyncData(): Promise<{
  jornadas: Jornada[];
  compensaciones: Compensacion[];
  dayExtraEntries: DayExtraEntry[];
}> {
  const jornadas = await getAllJornadas();
  const compensaciones = await getAllCompensaciones();
  const dayExtraEntries = await getAllDayExtraEntries();
  return {
    jornadas: jornadas.filter((j) => j.syncStatus === "pending" || j.syncStatus === "local"),
    compensaciones: compensaciones.filter((c) => c.syncStatus === "pending" || c.syncStatus === "local"),
    dayExtraEntries: dayExtraEntries.filter((e) => e.syncStatus === "pending" || e.syncStatus === "local"),
  };
}

export async function markAllSynced(): Promise<void> {
  const jornadas = await getAllJornadas();
  for (const j of jornadas) {
    if (j.syncStatus !== "synced") j.syncStatus = "synced";
  }
  await saveAllJornadas(jornadas);

  const comps = await getAllCompensaciones();
  for (const c of comps) {
    if (c.syncStatus !== "synced") c.syncStatus = "synced";
  }
  await saveAllCompensaciones(comps);

  const extraDays = await getAllDayExtraEntries();
  for (const e of extraDays) {
    if (e.syncStatus !== "synced") e.syncStatus = "synced";
  }
  await saveAllDayExtraEntries(extraDays);

  await markNaturalDayDietsSynced();
}

export async function mergeFromCloud(cloudJornadas: Jornada[], cloudCompensaciones: Compensacion[], cloudDayExtraEntries: DayExtraEntry[] = []): Promise<void> {
  const localJornadas = await getAllJornadas();
  const localComps = await getAllCompensaciones();
  const localExtraDays = await getAllDayExtraEntries();

  const cloudJIds = new Set(cloudJornadas.map((cj) => cj.id));
  const cloudCIds = new Set(cloudCompensaciones.map((cc) => cc.id));
  const cloudEIds = new Set(cloudDayExtraEntries.map((ce) => ce.id));

  const localSyncedCount = localJornadas.filter((j) => j.syncStatus === "synced").length;
  const cloudIsEmpty = cloudJornadas.length === 0 && cloudCompensaciones.length === 0 && cloudDayExtraEntries.length === 0;
  const shouldPruneDeleted = !(cloudIsEmpty && localSyncedCount > 3);

  const jMap = new Map<string, Jornada>();
  for (const j of localJornadas) {
    if (shouldPruneDeleted && j.syncStatus === "synced" && !cloudJIds.has(j.id)) {
      continue;
    }
    jMap.set(j.id, j);
  }

  for (const cj of cloudJornadas) {
    const existing = jMap.get(cj.id);
    if (!existing) {
      jMap.set(cj.id, { ...cj, syncStatus: "synced" });
    } else if (cj.updatedAt > existing.updatedAt) {
      // #region debug-point D:merge-cloud-overwrite
      reportJornadaDateDebug("D", "local-storage:mergeFromCloud", "cloud jornada overwrites local jornada", {
        jornadaId: cj.id,
        localBefore: {
          updatedAt: existing.updatedAt,
          fechaInicio: existing.fechaInicio,
          horaInicio: existing.horaInicio,
          fechaFin: existing.fechaFin,
          horaFin: existing.horaFin,
          startAt: existing.startAt,
          endAt: existing.endAt,
        },
        cloudIncoming: {
          updatedAt: cj.updatedAt,
          fechaInicio: cj.fechaInicio,
          horaInicio: cj.horaInicio,
          fechaFin: cj.fechaFin,
          horaFin: cj.horaFin,
          startAt: cj.startAt,
          endAt: cj.endAt,
        },
      });
      // #endregion
      if (existing.ferryPending) {
        console.log("[mergeFromCloud] OVERWRITING ferry jornada id=", cj.id, "cloud.ferryPending=", cj.ferryPending, "cloud.ferryRestCompleted=", cj.ferryRestCompleted, "cloud.updatedAt=", cj.updatedAt, "local.updatedAt=", existing.updatedAt);
      }
      const merged: Jornada = {
        ...cj,
        syncStatus: "synced",
        conduccionDomingoMin: cj.conduccionDomingoMin ?? existing.conduccionDomingoMin,
        conduccionLunesMin: cj.conduccionLunesMin ?? existing.conduccionLunesMin,
        plusItems: cj.plusItems ?? existing.plusItems,
        plannedRestMin: cj.plannedRestMin ?? existing.plannedRestMin,
        plannedRestType: cj.plannedRestType ?? existing.plannedRestType,
        legalSummary: cj.legalSummary ?? existing.legalSummary,
        dietBaseEur: cj.dietBaseEur ?? existing.dietBaseEur,
        dietRule: cj.dietRule ?? existing.dietRule,
        dietCalculatedAt: cj.dietCalculatedAt ?? existing.dietCalculatedAt,
        observaciones: cj.observaciones ?? existing.observaciones,
        ferryPending: cj.ferryPending != null ? cj.ferryPending : existing.ferryPending,
        ferryRestType: cj.ferryRestType ?? existing.ferryRestType,
        ferryDestination: cj.ferryDestination ?? existing.ferryDestination,
        ferryExtras: cj.ferryExtras ?? existing.ferryExtras,
        ferryInterruptions: cj.ferryInterruptions ?? existing.ferryInterruptions,
        ferryRestCompleted: cj.ferryRestCompleted != null ? cj.ferryRestCompleted : existing.ferryRestCompleted,
      };
      jMap.set(cj.id, merged);
    }
  }

  const cMap = new Map<string, Compensacion>();
  for (const c of localComps) {
    if (shouldPruneDeleted && c.syncStatus === "synced" && !cloudCIds.has(c.id)) {
      continue;
    }
    cMap.set(c.id, c);
  }

  for (const cc of cloudCompensaciones) {
    const existing = cMap.get(cc.id);
    if (!existing || cc.updatedAt > existing.updatedAt) {
      cMap.set(cc.id, { ...cc, syncStatus: "synced" });
    }
  }

  const eMap = new Map<string, DayExtraEntry>();
  for (const e of localExtraDays) {
    if (shouldPruneDeleted && e.syncStatus === "synced" && !cloudEIds.has(e.id)) {
      continue;
    }
    eMap.set(e.id, e);
  }
  for (const ce of cloudDayExtraEntries) {
    const existing = eMap.get(ce.id);
    if (!existing || ce.updatedAt > existing.updatedAt) {
      eMap.set(ce.id, { ...ce, syncStatus: "synced" });
    }
  }

  await saveAllJornadas(Array.from(jMap.values()));
  await saveAllCompensaciones(Array.from(cMap.values()));
  await saveAllDayExtraEntries(Array.from(eMap.values()));
}

export async function getLastLugarFin(): Promise<string | null> {
  const all = await getAllJornadas();
  const closed = all.filter((j) => j.fechaFin && j.lugarFin && j.endAt);
  if (closed.length === 0) return null;
  closed.sort((a, b) => (b.endAt || "").localeCompare(a.endAt || ""));
  return closed[0].lugarFin || null;
}

export async function getRecentPlaces(): Promise<string[]> {
  try {
    const raw = await getItemScoped(RECENT_PLACES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const unique = [...new Set(parsed.filter((p: any) => typeof p === "string" && p.trim()))];
    return unique.slice(0, 20);
  } catch {
    return [];
  }
}

export async function addRecentPlace(place: string): Promise<void> {
  if (!place.trim()) return;
  const trimmed = place.trim();
  const existing = await getRecentPlaces();
  const filtered = existing.filter((p) => p.toLowerCase() !== trimmed.toLowerCase());
  const updated = [trimmed, ...filtered].slice(0, 20);
  await setItemScoped(RECENT_PLACES_KEY, JSON.stringify(updated));
}

export async function getAllDayExtraEntries(): Promise<DayExtraEntry[]> {
  const raw = await getItemScoped(DAY_EXTRA_ENTRIES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const nowIso = new Date().toISOString();
    return parsed
      .filter(Boolean)
      .map((e: any) => {
        const entryType: DayExtraEntryType =
          e.entryType === "offsite_weekly_rest" ? "offsite_weekly_rest" : "day_extra";
        const dayFlag =
          e.dayFlag === "SABADO" || e.dayFlag === "DOMINGO" || e.dayFlag === "FESTIVO"
            ? e.dayFlag
            : null;
        const offsiteRestType =
          e.offsiteRestType === "WEEKLY_REDUCED" || e.offsiteRestType === "WEEKLY_COMPLETE"
            ? e.offsiteRestType
            : null;
        const offsiteBase =
          e.offsiteBase === "NACIONAL" || e.offsiteBase === "INTERNACIONAL"
            ? e.offsiteBase
            : null;
        const normalized: DayExtraEntry = {
          id: String(e.id || generateId()),
          date: String(e.date || ""),
          entryType,
          dayFlag,
          offsiteRestType,
          offsiteBase,
          plusSunday: Boolean(e.plusSunday),
          plusHoliday: Boolean(e.plusHoliday),
          locationStart: typeof e.locationStart === "string" ? e.locationStart : null,
          locationEnd: typeof e.locationEnd === "string" ? e.locationEnd : null,
          inBase: e.inBase == null ? null : Boolean(e.inBase),
          distanceToBaseKm: e.distanceToBaseKm == null ? null : Number(e.distanceToBaseKm),
          amount: e.amount == null ? null : Number(e.amount),
          note: typeof e.note === "string" ? e.note : null,
          createdAt: typeof e.createdAt === "string" ? e.createdAt : nowIso,
          updatedAt: typeof e.updatedAt === "string" ? e.updatedAt : nowIso,
          syncStatus: e.syncStatus === "pending" || e.syncStatus === "synced" || e.syncStatus === "local" ? e.syncStatus : "local",
        };
        return normalized;
      });
  } catch {
    return [];
  }
}

async function saveAllDayExtraEntries(list: DayExtraEntry[]): Promise<void> {
  await setItemScoped(DAY_EXTRA_ENTRIES_KEY, JSON.stringify(list));
}

export async function replaceImportedDayExtraEntries(list: DayExtraEntry[]): Promise<void> {
  await saveAllDayExtraEntries(list);
}

export async function listDayExtraEntries(from?: string, to?: string): Promise<DayExtraEntry[]> {
  const all = await getAllDayExtraEntries();
  const filtered = all.filter((e) => {
    if (!e?.date) return false;
    if (from && e.date < from) return false;
    if (to && e.date > to) return false;
    return true;
  });
  filtered.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  return filtered;
}

export async function addDayExtraEntry(data: {
  date: string;
  dayFlag: Exclude<DayExtraEntry["dayFlag"], null>;
  amount?: number | null;
  note?: string | null;
}): Promise<DayExtraEntry> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) throw new Error("Fecha inválida (YYYY-MM-DD)");
  if (data.dayFlag !== "SABADO" && data.dayFlag !== "DOMINGO" && data.dayFlag !== "FESTIVO") {
    throw new Error("Tipo de día inválido");
  }
  const all = await getAllDayExtraEntries();
  const now = new Date().toISOString();
  let resolvedAmount: number | null = data.amount ?? null;
  if (resolvedAmount == null) {
    try {
      const settingsRaw = await getItemScoped("tacoplan_user_settings");
      const s = settingsRaw ? JSON.parse(settingsRaw) : {};
      const pf = (v: any) => {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : 0;
      };
      const extrasCfg: UserDayExtras = {
        extra_saturday: pf(s.extra_saturday),
        extra_sunday: pf(s.extra_sunday),
        extra_holiday: pf(s.extra_holiday),
        offsite_weekly_reduced_nacional: pf(s.offsite_weekly_reduced_nacional),
        offsite_weekly_reduced_internacional: pf(s.offsite_weekly_reduced_internacional),
        offsite_weekly_complete_nacional: pf(s.offsite_weekly_complete_nacional),
        offsite_weekly_complete_internacional: pf(s.offsite_weekly_complete_internacional),
      };
      const calc = calcDayExtra(data.dayFlag, extrasCfg);
      resolvedAmount = Number.isFinite(calc) ? calc : 0;
    } catch {
      resolvedAmount = 0;
    }
  }
  const entry: DayExtraEntry = {
    id: generateId(),
    date: data.date,
    entryType: "day_extra",
    dayFlag: data.dayFlag,
    offsiteRestType: null,
    offsiteBase: null,
    plusSunday: false,
    plusHoliday: false,
    amount: resolvedAmount,
    note: data.note?.trim() || null,
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
  };
  all.push(entry);
  await saveAllDayExtraEntries(all);
  return entry;
}

export async function listAvailableOffsiteWeeklyRestDates(): Promise<string[]> {
  const allJ = await getAllJornadas();
  const existing = await getAllDayExtraEntries();
  const usedDates = new Set(existing.filter((e) => e.entryType === "offsite_weekly_rest").map((e) => e.date));

  const today = formatDateStr(new Date());
  const maxFuture = addDays(today, 31);

  const jornadasSorted = allJ
    .filter((j) => /^\d{4}-\d{2}-\d{2}$/.test(j.fechaInicio))
    .slice()
    .sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio));

  if (jornadasSorted.length === 0) return [];

  const coveredDates = new Set<string>();
  for (const j of jornadasSorted) {
    const start = j.fechaInicio;
    const end = j.fechaFin && /^\d{4}-\d{2}-\d{2}$/.test(j.fechaFin) ? j.fechaFin : j.fechaInicio;
    let cur = start;
    while (cur <= end) {
      coveredDates.add(cur);
      cur = addDays(cur, 1);
    }
  }

  const candidates = new Set<string>();
  for (let i = 0; i < jornadasSorted.length - 1; i++) {
    const a = jornadasSorted[i];
    const b = jornadasSorted[i + 1];
    if (!a.fechaFin || !/^\d{4}-\d{2}-\d{2}$/.test(a.fechaFin)) continue;
    const start = addDays(a.fechaFin, 1);
    const rawEnd = addDays(b.fechaInicio, -1);
    const end = rawEnd > maxFuture ? maxFuture : rawEnd;
    let cur = start;
    while (cur <= end) {
      candidates.add(cur);
      cur = addDays(cur, 1);
    }
  }

  const last = jornadasSorted[jornadasSorted.length - 1];
  if (last.fechaFin && /^\d{4}-\d{2}-\d{2}$/.test(last.fechaFin)) {
    let cur = addDays(last.fechaFin, 1);
    while (cur <= today) {
      candidates.add(cur);
      cur = addDays(cur, 1);
    }
  }

  const out = Array.from(candidates).filter((d) => !coveredDates.has(d) && !usedDates.has(d));
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

export async function addOffsiteWeeklyRestEntry(data: {
  date: string;
  restType: DayExtraEntry["offsiteRestType"];
  base: DayExtraEntry["offsiteBase"];
  plusSunday?: boolean;
  plusHoliday?: boolean;
  amount?: number | null;
  note?: string | null;
}): Promise<DayExtraEntry> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) throw new Error("Fecha inválida (YYYY-MM-DD)");
  if (data.restType !== "WEEKLY_REDUCED" && data.restType !== "WEEKLY_COMPLETE") throw new Error("Tipo de descanso inválido");
  if (data.base !== "NACIONAL" && data.base !== "INTERNACIONAL") throw new Error("Tipo de ruta inválido");

  const allJ = await getAllJornadas();
  if (allJ.some((j) => {
    if (!j.fechaInicio) return false;
    const start = j.fechaInicio;
    const end = j.fechaFin || j.fechaInicio;
    return data.date >= start && data.date <= end;
  })) {
    throw new Error("Ya existe una jornada en esa fecha");
  }

  const all = await getAllDayExtraEntries();
  if (all.some((e) => e.entryType === "offsite_weekly_rest" && e.date === data.date)) {
    throw new Error("Ya existe un descanso fuera de base en esa fecha");
  }

  const now = new Date().toISOString();
  const plusSunday = Boolean(data.plusSunday);
  const plusHoliday = Boolean(data.plusHoliday);

  let resolvedAmount: number | null = data.amount ?? null;
  if (resolvedAmount == null) {
    try {
      const settingsRaw = await getItemScoped("tacoplan_user_settings");
      const s = settingsRaw ? JSON.parse(settingsRaw) : {};
      const pf = (v: any) => {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : 0;
      };
      const extrasCfg: UserDayExtras = {
        extra_saturday: pf(s.extra_saturday),
        extra_sunday: pf(s.extra_sunday),
        extra_holiday: pf(s.extra_holiday),
        offsite_weekly_reduced_nacional: pf(s.offsite_weekly_reduced_nacional),
        offsite_weekly_reduced_internacional: pf(s.offsite_weekly_reduced_internacional),
        offsite_weekly_complete_nacional: pf(s.offsite_weekly_complete_nacional),
        offsite_weekly_complete_internacional: pf(s.offsite_weekly_complete_internacional),
      };
      const baseKey = data.base === "NACIONAL" ? "nacional" : "internacional";
      const restKey = data.restType === "WEEKLY_REDUCED" ? "reduced" : "complete";
      const baseAmount =
        restKey === "reduced"
          ? (baseKey === "nacional" ? extrasCfg.offsite_weekly_reduced_nacional : extrasCfg.offsite_weekly_reduced_internacional)
          : (baseKey === "nacional" ? extrasCfg.offsite_weekly_complete_nacional : extrasCfg.offsite_weekly_complete_internacional);
      resolvedAmount = Math.round(Number(baseAmount) * 100) / 100;
    } catch {
      resolvedAmount = 0;
    }
  }

  const entry: DayExtraEntry = {
    id: generateId(),
    date: data.date,
    entryType: "offsite_weekly_rest",
    dayFlag: null,
    offsiteRestType: data.restType,
    offsiteBase: data.base,
    plusSunday,
    plusHoliday,
    amount: resolvedAmount,
    note: data.note?.trim() || null,
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
  };
  all.push(entry);
  await saveAllDayExtraEntries(all);
  return entry;
}

export async function deleteDayExtraEntry(id: string): Promise<void> {
  const all = await getAllDayExtraEntries();
  const filtered = all.filter((e) => e.id !== id);
  await saveAllDayExtraEntries(filtered);
}

export async function updateDayExtraEntry(
  id: string,
  patch: {
    date?: string;
    restType?: DayExtraEntry["offsiteRestType"];
    base?: DayExtraEntry["offsiteBase"];
    plusSunday?: boolean;
    plusHoliday?: boolean;
    amount?: number | null;
    note?: string | null;
  },
): Promise<DayExtraEntry> {
  const all = await getAllDayExtraEntries();
  const idx = all.findIndex((e) => e.id === id);
  if (idx < 0) throw new Error("No se encontró el registro");
  const cur = all[idx];
  if (cur.entryType !== "offsite_weekly_rest") throw new Error("Edición no soportada para este tipo de registro");

  const nextDate = typeof patch.date === "string" ? patch.date : cur.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) throw new Error("Fecha inválida (YYYY-MM-DD)");

  const nextRestType = patch.restType ?? cur.offsiteRestType;
  if (nextRestType !== "WEEKLY_REDUCED" && nextRestType !== "WEEKLY_COMPLETE") throw new Error("Tipo de descanso inválido");

  const nextBase = patch.base ?? cur.offsiteBase;
  if (nextBase !== "NACIONAL" && nextBase !== "INTERNACIONAL") throw new Error("Tipo de ruta inválido");

  const nextAmount = patch.amount !== undefined ? patch.amount : cur.amount;
  if (nextAmount != null) {
    const n = Number(nextAmount);
    if (!Number.isFinite(n) || n < 0) throw new Error("Importe inválido");
  }

  if (nextDate !== cur.date) {
    const allJ = await getAllJornadas();
    if (allJ.some((j) => {
      if (!j.fechaInicio) return false;
      const start = j.fechaInicio;
      const end = j.fechaFin || j.fechaInicio;
      return nextDate >= start && nextDate <= end;
    })) {
      throw new Error("Ya existe una jornada en esa fecha");
    }
    if (all.some((e) => e.id !== cur.id && e.entryType === "offsite_weekly_rest" && e.date === nextDate)) {
      throw new Error("Ya existe un descanso fuera de base en esa fecha");
    }
  }

  const now = new Date().toISOString();
  const updated: DayExtraEntry = {
    ...cur,
    date: nextDate,
    offsiteRestType: nextRestType,
    offsiteBase: nextBase,
    plusSunday: patch.plusSunday !== undefined ? !!patch.plusSunday : cur.plusSunday,
    plusHoliday: patch.plusHoliday !== undefined ? !!patch.plusHoliday : cur.plusHoliday,
    amount: nextAmount != null ? Math.round(Number(nextAmount) * 100) / 100 : null,
    note: patch.note !== undefined ? (patch.note?.trim() || null) : cur.note,
    updatedAt: now,
    syncStatus: cur.syncStatus === "local" ? "local" : "pending",
  };
  all[idx] = updated;
  await saveAllDayExtraEntries(all);
  return updated;
}

async function getAllDismissedNaturalDayDates(): Promise<Set<string>> {
  const raw = await getItemScoped(NATURAL_DAY_DIETS_DISMISSED_KEY);
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((d: unknown) => typeof d === "string"));
  } catch {
    return new Set();
  }
}

async function saveAllDismissedNaturalDayDates(set: Set<string>): Promise<void> {
  await setItemScoped(NATURAL_DAY_DIETS_DISMISSED_KEY, JSON.stringify(Array.from(set)));
}

export async function getAllNaturalDayDiets(): Promise<NaturalDayDietEntry[]> {
  const raw = await getItemScoped(NATURAL_DAY_DIETS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const nowIso = new Date().toISOString();
    return parsed
      .filter(Boolean)
      .map((e: any) => {
        const validTypes: NaturalDayDietType[] = ["INTERNACIONAL", "NACIONAL", "REGIONAL"];
        const type: NaturalDayDietType = validTypes.includes(e.type) ? (e.type as NaturalDayDietType) : "NACIONAL";
        const rawPct = Number(e.percentage);
        let percentage: 100 | 60 | 30 = 100;
        if (rawPct === 60) percentage = 60;
        else if (rawPct === 30) percentage = 30;
        else percentage = 100;
        const rawPluses =
          Array.isArray(e.plusItems) || Array.isArray((e as any).pluses)
            ? (Array.isArray(e.plusItems) ? e.plusItems : (e as any).pluses)
            : null;
        const plusClean: Array<{ concepto: string; amount: number; id: string }> | null =
          Array.isArray(rawPluses)
            ? rawPluses
                .filter((p) => p && String(p.concepto || "").trim().length > 0 && Number.isFinite(Number(p.amount)))
                .map((p) => ({
                  concepto: String(p.concepto).trim().slice(0, 200),
                  amount: Math.max(0, Math.min(99999, +Number(p.amount).toFixed(2))),
                  id: String(p.id || `${e.date}_${p.concepto}_${Math.random().toString(36).slice(2, 7)}`),
                }))
            : null;
        const normalized: NaturalDayDietEntry = {
          id: String(e.id || generateId()),
          date: String(e.date || ""),
          type,
          percentage,
          amount: Number.isFinite(Number(e.amount)) ? Number(e.amount) : 0,
          location: typeof e.location === "string" ? e.location : (e.location ?? null),
          source: "NATURAL_DAY_OUT_OF_BASE",
          previousJourneyId: typeof e.previousJourneyId === "string" ? e.previousJourneyId : (e.previousJourneyId ?? null),
          nextJourneyId: typeof e.nextJourneyId === "string" ? e.nextJourneyId : (e.nextJourneyId ?? null),
          confirmedByUser: Boolean(e.confirmedByUser),
          dismissedAt: typeof e.dismissedAt === "string" ? e.dismissedAt : (e.dismissedAt ?? null),
          createdAt: typeof e.createdAt === "string" ? e.createdAt : nowIso,
          updatedAt: typeof e.updatedAt === "string" ? e.updatedAt : nowIso,
          syncStatus: e.syncStatus === "pending" || e.syncStatus === "synced" || e.syncStatus === "local" ? e.syncStatus : "local",
          plusItems: plusClean && plusClean.length > 0 ? plusClean : null,
          isDomingo: typeof e.isDomingo === "boolean" ? e.isDomingo : (typeof e.is_domingo === "boolean" ? e.is_domingo : null),
          isFestivo: typeof e.isFestivo === "boolean" ? e.isFestivo : (typeof e.is_festivo === "boolean" ? e.is_festivo : null),
        };
        return normalized;
      });
  } catch {
    return [];
  }
}

function dedupeNaturalDayDietsByDate(list: NaturalDayDietEntry[]): NaturalDayDietEntry[] {
  const byDate = new Map<string, NaturalDayDietEntry>();

  const rank = (entry: NaturalDayDietEntry): number => {
    if (entry.confirmedByUser && !entry.dismissedAt) return 4;
    if (entry.confirmedByUser) return 3;
    if (!entry.dismissedAt) return 2;
    return 1;
  };

  for (const entry of list || []) {
    if (!entry?.date) continue;
    const current = byDate.get(entry.date);
    if (!current) {
      byDate.set(entry.date, entry);
      continue;
    }
    const currentRank = rank(current);
    const incomingRank = rank(entry);
    const currentUpdated = String(current.updatedAt || current.createdAt || "");
    const incomingUpdated = String(entry.updatedAt || entry.createdAt || "");
    if (incomingRank > currentRank || (incomingRank === currentRank && incomingUpdated >= currentUpdated)) {
      byDate.set(entry.date, entry);
    }
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

async function saveAllNaturalDayDiets(list: NaturalDayDietEntry[]): Promise<void> {
  // La base de datos tiene UNIQUE(user_id,date). Repetimos esa misma regla
  // localmente para que nunca existan dos "Jornadas fuera de base" del mismo día.
  await setItemScoped(NATURAL_DAY_DIETS_KEY, JSON.stringify(dedupeNaturalDayDietsByDate(list)));
}

export async function replaceImportedNaturalDayDiets(list: NaturalDayDietEntry[]): Promise<void> {
  await saveAllNaturalDayDiets(list);
}

export async function mergeNaturalDayDietsFromCloud(cloudEntries: NaturalDayDietEntry[]): Promise<void> {
  const local = dedupeNaturalDayDietsByDate(await getAllNaturalDayDiets());
  const cloudSafe = dedupeNaturalDayDietsByDate((cloudEntries || []).map((entry) => ({
    ...entry,
    syncStatus: "synced" as const,
  })));
  const cloudDates = new Set(cloudSafe.map((entry) => entry.date));

  // La nube es autoritativa para registros ya sincronizados. Si otro dispositivo
  // eliminó uno, desaparece localmente; las ediciones pendientes nunca se podan.
  const byDate = new Map<string, NaturalDayDietEntry>();
  for (const entry of local) {
    const pending = entry.syncStatus === "pending" || entry.syncStatus === "local";
    if (pending || cloudDates.has(entry.date)) byDate.set(entry.date, entry);
  }

  for (const incoming of cloudSafe) {
    if (!incoming?.date) continue;
    const existing = byDate.get(incoming.date);

    if (!existing) {
      byDate.set(incoming.date, incoming);
      continue;
    }

    const localIsPending = existing.syncStatus === "pending" || existing.syncStatus === "local";
    const localUpdated = String(existing.updatedAt || existing.createdAt || "");
    const cloudUpdated = String(incoming.updatedAt || incoming.createdAt || "");

    // Nunca pisamos una edición local pendiente con una copia antigua de nube.
    if (localIsPending && localUpdated >= cloudUpdated) continue;
    byDate.set(incoming.date, incoming);
  }

  await saveAllNaturalDayDiets(Array.from(byDate.values()));
}

export async function markNaturalDayDietsSynced(ids?: string[]): Promise<void> {
  const all = await getAllNaturalDayDiets();
  const idSet = ids && ids.length > 0 ? new Set(ids) : null;
  let changed = false;
  for (const entry of all) {
    if (idSet && !idSet.has(entry.id)) continue;
    if (entry.syncStatus !== "synced") {
      entry.syncStatus = "synced";
      changed = true;
    }
  }
  if (changed) await saveAllNaturalDayDiets(all);
}

export async function upsertNaturalDayDiets(entries: NaturalDayDietEntry[]): Promise<NaturalDayDietEntry[]> {
  if (!entries || entries.length === 0) return [];

  const all = dedupeNaturalDayDietsByDate(await getAllNaturalDayDiets());
  const byId = new Map<string, NaturalDayDietEntry>();
  const byDate = new Map<string, NaturalDayDietEntry>();
  for (const entry of all) {
    byId.set(entry.id, entry);
    byDate.set(entry.date, entry);
  }

  const results: NaturalDayDietEntry[] = [];
  for (const raw of entries) {
    if (!raw?.date) continue;

    // Si llega un ID nuevo para una fecha que ya existe, reutilizamos el registro
    // existente. Esto evita duplicados locales y conflictos UNIQUE(user_id,date).
    const existing = (raw.id ? byId.get(raw.id) : undefined) || byDate.get(raw.date);
    const now = new Date().toISOString();
    const entry: NaturalDayDietEntry = {
      ...existing,
      ...raw,
      id: existing?.id || raw.id || generateId(),
      createdAt: existing?.createdAt || raw.createdAt || now,
      updatedAt: now,
      syncStatus: existing?.syncStatus === "synced" ? "pending" : (raw.syncStatus || existing?.syncStatus || "pending"),
    };

    if (existing && existing.id !== entry.id) byId.delete(existing.id);
    byId.set(entry.id, entry);
    byDate.set(entry.date, entry);
    results.push(entry);
  }

  await saveAllNaturalDayDiets(Array.from(byId.values()));
  return results;
}

export async function deleteNaturalDayDiet(id: string): Promise<void> {
  const all = await getAllNaturalDayDiets();
  const filtered = all.filter((e) => e.id !== id);
  await saveAllNaturalDayDiets(filtered);
}

export async function dismissNaturalDayDiets(dates: string[]): Promise<void> {
  if (!dates || dates.length === 0) return;
  const set = await getAllDismissedNaturalDayDates();
  const now = new Date().toISOString();
  const validDates = dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  for (const d of validDates) set.add(d);
  await saveAllDismissedNaturalDayDates(set);
  const all = await getAllNaturalDayDiets();
  let changed = false;
  for (const e of all) {
    // Una dieta ya confirmada por el usuario no debe quedar marcada como
    // descartada. El set de fechas descartadas sirve para que el detector no
    // vuelva a ofrecer ese día, pero no debe ocultar una dieta recién guardada
    // ni excluirla de los totales.
    if (validDates.includes(e.date) && !e.confirmedByUser && !e.dismissedAt) {
      e.dismissedAt = now;
      e.updatedAt = now;
      e.syncStatus = e.syncStatus === "synced" ? "pending" : e.syncStatus;
      changed = true;
    }
  }
  if (changed) await saveAllNaturalDayDiets(all);
}

export async function clearDismissedNaturalDayDiets(dates?: string[]): Promise<void> {
  const set = await getAllDismissedNaturalDayDates();
  if (dates && dates.length > 0) {
    for (const d of dates) set.delete(d);
  } else {
    set.clear();
  }
  await saveAllDismissedNaturalDayDates(set);
  if (!dates || dates.length === 0) return;
  const all = await getAllNaturalDayDiets();
  const validDates = dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  let changed = false;
  const now = new Date().toISOString();
  for (const e of all) {
    if (validDates.includes(e.date) && e.dismissedAt) {
      e.dismissedAt = null;
      e.updatedAt = now;
      e.syncStatus = e.syncStatus === "synced" ? "pending" : e.syncStatus;
      changed = true;
    }
  }
  if (changed) await saveAllNaturalDayDiets(all);
}

/**
 * Limpia el set de fechas "descartadas" solo dentro de un rango [from,to] inclusive.
 * Útil para el botón "Re-evaluar" del periodo actual en Historial/Dietas.
 */
export async function clearDismissedNaturalDayDietsInRange(from: string, to: string): Promise<void> {
  if (!from || !to) return;
  const set = await getAllDismissedNaturalDayDates();
  const clearDates: string[] = [];
  for (const d of set) {
    if (d >= from && d <= to) clearDates.push(d);
  }
  if (clearDates.length === 0) return;
  await clearDismissedNaturalDayDiets(clearDates);
}

function normalizeLocationForCompare(loc: string | null | undefined): string {
  if (!loc) return "";
  return String(loc)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function locationsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeLocationForCompare(a);
  const nb = normalizeLocationForCompare(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const tokensA = na
    .split(/[\s,;./\\|()]+/)
    .map(s => s.trim())
    .filter(s => s.length >= 4);
  const tokensB = nb
    .split(/[\s,;./\\|()]+/)
    .map(s => s.trim())
    .filter(s => s.length >= 4);
  if (tokensA.length === 0 || tokensB.length === 0) return false;
  for (const ta of tokensA) {
    for (const tb of tokensB) {
      if (ta === tb) return true;
      if (ta.includes(tb) || tb.includes(ta)) return true;
    }
  }
  return false;
}

export async function detectMissingOutOfBaseDietDays(options?: {
  fromDate?: string;
  toDate?: string;
  extraPendingJourney?: {
    startAt: string;
    fechaInicio?: string;
    lugarInicio?: string | null;
    tipoRuta?: string | null;
    id?: string;
  };
}): Promise<DetectedMissingNaturalDay[]> {
  const allJornadas = await getAllJornadas();
  const extra = options?.extraPendingJourney;
  const extraAsJornada: Jornada | null = extra
    ? ({
        id: extra.id || "__pending_new__",
        startAt: extra.startAt,
        fechaInicio: extra.fechaInicio ?? extractYyyyMmDd(extra.startAt),
        fechaFin: extra.fechaInicio ?? extractYyyyMmDd(extra.startAt),
        endAt: extra.startAt,
        lugarInicio: extra.lugarInicio ?? null,
        lugarFin: extra.lugarInicio ?? null,
        tipoRuta: (extra.tipoRuta as Jornada["tipoRuta"]) || "NINGUNO",
        updatedAt: new Date().toISOString(),
      } as any)
    : null;
  const combined = extraAsJornada ? [...allJornadas, extraAsJornada] : allJornadas;
  const sorted = combined
    .filter((j) => j && j.startAt && (j.fechaInicio || j.fechaFin || j.endAt))
    .sort((a, b) => a.startAt.localeCompare(b.startAt));

  if (sorted.length < 2) return [];

  let baseLocation: string | null = null;
  try {
    const settingsRaw = await getItemScoped("tacoplan_user_settings");
    const settings = settingsRaw ? JSON.parse(settingsRaw) : {};
    const firstNonEmpty = (...vals: any[]): string | null => {
      for (const v of vals) {
        if (typeof v === "string" && v.trim() !== "") return v.trim();
      }
      return null;
    };
    const buildAddress = (parts: (string | null | undefined)[]): string | null => {
      const clean = parts
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter((s) => s.length > 0);
      return clean.length > 0 ? clean.join(", ") : null;
    };
    baseLocation = firstNonEmpty(
      settings.baseLocation,
      settings.base_city,
      settings.base_name,
      settings.base_address,
      settings.base,
      buildAddress([settings.base_name, settings.base_city, settings.base_country || settings.baseCountry]),
    );
    if (!baseLocation) {
      try {
        const { data: { user } = {} } = await supabase.auth.getUser();
        const uid = user?.id;
        if (uid) {
          const profileCols = "base_name,base_city,base_country,baseCountry,base_address,baseLocation,base_location";
          const { data: profileRow, error } = await supabase
            .from("profiles")
            .select(profileCols)
            .eq("id", uid)
            .maybeSingle();
          if (!error && profileRow) {
            baseLocation = firstNonEmpty(
              profileRow.baseLocation || profileRow.base_location,
              profileRow.base_city,
              profileRow.base_name,
              profileRow.base_address,
              buildAddress([
                profileRow.base_name,
                profileRow.base_city,
                profileRow.base_country || profileRow.baseCountry,
              ]),
            );
          }
          if (!baseLocation) {
            const meta = user?.user_metadata || {};
            baseLocation = firstNonEmpty(
              meta.baseLocation || meta.base_location,
              meta.base_city,
              meta.base_name,
              meta.base_address,
              meta.base,
              buildAddress([meta.base_name, meta.base_city, meta.base_country || meta.baseCountry]),
            );
          }
        }
      } catch {}
    }
  } catch {}
  try {
    console.log("[detectMissingOutOfBaseDietDays:BASE_RESOLVED]", {
      baseLocation,
    });
  } catch {}

  // Set de tokens STOP (países, adjetivos genéricos) — no cuentan como token diferenciador.
  const STOP_TOKENS_LOWER = new Set([
    "espana","españa","spain","catalunya","cataluna","cataluña","barcelona","provincia","ciudad","pueblo","base","s/n","sn","calle","avenida","avda","av","plaza","pl","plza","carretera","crta","carrera","poligono","poligono","industrial","parque","france","francia","alemania","germany","deutschland","polonia","poland","belgica","belgium","luxemburgo","luxembourg","italia","italy","portugal","republica","checa","czech","netherlands","bajos","paises","countries","espanol","catalan","localidad","municipio","nacional","regional","internacional","sp",
  ]);

  /**
   * isBaseLocation V2 — robusta contra variantes ciudad vs ciu+prov vs ciu+pais
   * Match if:
   *   - loc vacío → false
   *   - isBaseLocation mismo texto normalizado o match tokens 1 común "no stop"
   */
  const isBaseLocation = (loc: string | null | undefined, base: string | null): boolean => {
    if (!base) return false;
    if (!loc || typeof loc !== "string") return false;
    const baseTrim = base.trim();
    if (baseTrim === "") return false;
    const tokensBase = normalizeLocationForCompare(baseTrim)
      .split(/[\s,;./\\|()\-\[\]{}]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 3 && !STOP_TOKENS_LOWER.has(s));
    const tokensLoc = normalizeLocationForCompare(loc)
      .split(/[\s,;./\\|()\-\[\]{}]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 3 && !STOP_TOKENS_LOWER.has(s));
    if (tokensLoc.length === 0 || tokensBase.length === 0) {
      return locationsMatch(loc, base);
    }
    for (const tb of tokensBase) {
      for (const tl of tokensLoc) {
        if (tb === tl || tb.includes(tl) || tl.includes(tb)) return true;
      }
    }
    return locationsMatch(loc, base);
  };

  type OutOfBasePeriod = {
    startDate: string;
    endDate: string | null;
    startJourneyId: string;
    endJourneyId: string | null;
    closedByBaseArrival: boolean;
    routeTypeAtStart: NaturalDayDietType;
    reliableLocationStart: string | null;
    reliableLocationEnd: string | null;
    includesArrivalDay: boolean;
  };

  const periods: OutOfBasePeriod[] = [];
  let openPeriod: (OutOfBasePeriod & { state: "OPEN" }) | null = null;
  for (const j of sorted) {
    if (!j) continue;
    const jStart = extractYyyyMmDd(j.fechaInicio ?? j.startAt);
    const jEnd = extractYyyyMmDd(j.fechaFin ?? j.endAt);
    const startsFromBase = isBaseLocation(j.lugarInicio, baseLocation);
    const startsAtBase = startsFromBase;
    const endsAtBase = isBaseLocation(j.lugarFin, baseLocation);

    function resolveRouteTypeForOpen(): NaturalDayDietType {
      const tipo = j.tipoRuta || "NINGUNO";
      if (tipo === "INTERNACIONAL" || tipo === "REGIONAL_INTL" || tipo === "NAC_INTL") return "INTERNACIONAL";
      if (tipo === "REGIONAL") return "REGIONAL";
      if (tipo === "NACIONAL" || tipo === "NAC_REGIONAL") return "NACIONAL";
      return openPeriod?.routeTypeAtStart || "NACIONAL";
    }

    if (!openPeriod) {
      if (!endsAtBase && jEnd) {
        const rt = resolveRouteTypeForOpen();
        openPeriod = {
          state: "OPEN",
          startDate: jStart || jEnd,
          endDate: jEnd,
          startJourneyId: j.id,
          endJourneyId: j.id,
          closedByBaseArrival: false,
          includesArrivalDay: false,
          routeTypeAtStart: rt,
          reliableLocationStart: j.lugarFin || j.lugarInicio || null,
          reliableLocationEnd: j.lugarFin || j.lugarInicio || null,
        };
        try {
          console.log("[detectMissingOutOfBaseDietDays:STATE_MACHINE_OPEN]", {
            journey: { id: j.id, jStart, jEnd, lugarInicio: j.lugarInicio ?? null, lugarFin: j.lugarFin ?? null, tipoRuta: j.tipoRuta || null, startsAtBase, endsAtBase },
            openPeriod: { startDate: openPeriod.startDate, endDate: openPeriod.endDate, routeType: rt, reliableEnd: openPeriod.reliableLocationEnd },
          });
        } catch {}
      }
    } else {
      const beforeEnd = openPeriod.endDate;
      const beforeType = openPeriod.routeTypeAtStart;
      openPeriod.endDate = jEnd ?? openPeriod.endDate;
      openPeriod.endJourneyId = j.id;
      openPeriod.reliableLocationEnd = j.lugarFin || j.lugarInicio || openPeriod.reliableLocationEnd;
      if (openPeriod.routeTypeAtStart === "NACIONAL") {
        openPeriod.routeTypeAtStart = resolveRouteTypeForOpen();
      }
      if (endsAtBase) {
        periods.push({
          startDate: openPeriod.startDate,
          endDate: openPeriod.endDate,
          startJourneyId: openPeriod.startJourneyId,
          endJourneyId: openPeriod.endJourneyId,
          closedByBaseArrival: true,
          includesArrivalDay: true,
          routeTypeAtStart: openPeriod.routeTypeAtStart,
          reliableLocationStart: openPeriod.reliableLocationStart,
          reliableLocationEnd: openPeriod.reliableLocationEnd,
        });
        try {
          console.log("[detectMissingOutOfBaseDietDays:STATE_MACHINE_CLOSE_BASE]", {
            journey: { id: j.id, jStart, jEnd, lugarInicio: j.lugarInicio ?? null, lugarFin: j.lugarFin ?? null, tipoRuta: j.tipoRuta || null, startsAtBase, endsAtBase },
            closedPeriod: { startDate: openPeriod.startDate, endDate: openPeriod.endDate, routeTypeBefore: beforeType, routeTypeNow: openPeriod.routeTypeAtStart, reliableStart: openPeriod.reliableLocationStart, reliableEnd: openPeriod.reliableLocationEnd },
          });
        } catch {}
        openPeriod = null;
      } else {
        try {
          console.log("[detectMissingOutOfBaseDietDays:STATE_MACHINE_EXTEND]", {
            journey: { id: j.id, jStart, jEnd, lugarInicio: j.lugarInicio ?? null, lugarFin: j.lugarFin ?? null, tipoRuta: j.tipoRuta || null, startsAtBase, endsAtBase },
            before: { endDate: beforeEnd, routeType: beforeType },
            after: { endDate: openPeriod.endDate, routeType: openPeriod.routeTypeAtStart, reliableEnd: openPeriod.reliableLocationEnd },
          });
        } catch {}
      }
    }
  }
  if (openPeriod) {
    periods.push({
      startDate: openPeriod.startDate,
      endDate: openPeriod.endDate,
      startJourneyId: openPeriod.startJourneyId,
      endJourneyId: openPeriod.endJourneyId,
      closedByBaseArrival: false,
      includesArrivalDay: false,
      routeTypeAtStart: openPeriod.routeTypeAtStart,
      reliableLocationStart: openPeriod.reliableLocationStart,
      reliableLocationEnd: openPeriod.reliableLocationEnd,
    });
    try {
      console.log("[detectMissingOutOfBaseDietDays:STATE_MACHINE_OPEN_LEFTOVER]", {
        openPeriod: { startDate: openPeriod.startDate, endDate: openPeriod.endDate, routeType: openPeriod.routeTypeAtStart, reliableStart: openPeriod.reliableLocationStart, reliableEnd: openPeriod.reliableLocationEnd },
        reason: "no journey after returned to base; kept open",
      });
    } catch {}
  }

  function periodContainsDate(p: OutOfBasePeriod, date: string): boolean {
    if (!(date >= p.startDate)) return false;
    if (p.endDate) {
      if (p.closedByBaseArrival) {
        return date <= p.endDate;
      }
      return date <= p.endDate;
    }
    return true;
  }
  try {
    console.log("[detectMissingOutOfBaseDietDays:PERIODS_BUILT]", {
      periodsCount: periods.length,
      baseLocation,
      sortedCount: sorted.length,
      periods: periods.map((p) => ({
        startDate: p.startDate,
        endDate: p.endDate,
        routeType: p.routeTypeAtStart,
        closedByBaseArrival: p.closedByBaseArrival,
        includesArrivalDay: p.includesArrivalDay,
        reliableStart: p.reliableLocationStart,
        reliableEnd: p.reliableLocationEnd,
      })),
    });
  } catch {}

  // Carga de holidays cache (festivos) + pluses por jornada para no duplicar conceptos
  let holidaysSet: Set<string> = new Set();
  try {
    const holidaysRaw = await getItemScoped("tacoplan_user_holidays_cache");
    const parsed = holidaysRaw ? JSON.parse(holidaysRaw) : [];
    const flat = Array.isArray(parsed)
      ? parsed
          .map((item) => (typeof item === "string" ? item : item?.date))
          .filter((item): item is string => /^\d{4}-\d{2}-\d{2}$/.test(String(item || "")))
      : [];
    holidaysSet = new Set(flat);
  } catch {}

  // Pluses map por jornada id -> los pluses de una jornada (plusItems array)
  type PlusItemLike = { concepto?: string | null; concept?: string | null; amount?: number | null; importe?: number | null; id?: string | null };
  const plusesByJourney = new Map<string, PlusItemLike[]>();
  const allJornadasForPluses = sorted;
  for (const j of allJornadasForPluses) {
    if (!j?.id || j.id.startsWith("__")) continue;
    let items: PlusItemLike[] = [];
    const jany = j as any;
    if (Array.isArray(jany.plusItems) && jany.plusItems.length > 0) items = jany.plusItems as PlusItemLike[];
    else if (Array.isArray(jany.extras) && jany.extras.length) {
      // fallback intento extraer plus de extras si están
    }
    if (items.length > 0) plusesByJourney.set(j.id, items);
  }
  // Clave única para comprobar plus duplicado: `date||concepto||sourceJourneyId`
  const usedPlusKeysGlobal = new Set<string>();
  for (const [jId, list] of plusesByJourney.entries()) {
    const j = allJornadasForPluses.find((x) => x?.id === jId);
    if (!j) continue;
    const jFin = extractYyyyMmDd(j.fechaFin ?? j.endAt);
    const jIni = extractYyyyMmDd(j.fechaInicio ?? j.startAt);
    for (const p of list) {
      const concepto = (p.concepto || p.concept || "").trim();
      if (!concepto) continue;
      if (jFin) usedPlusKeysGlobal.add(`${jFin}||${concepto}||${jId}`);
      if (jIni && jIni !== jFin) usedPlusKeysGlobal.add(`${jIni}||${concepto}||${jId}`);
    }
  }

  // Helper Domingo + Festivo
  function isDomingoDate(date: string): boolean {
    if (!date) return false;
    const y = +date.slice(0, 4); const m = +date.slice(5, 7); const d = +date.slice(8, 10);
    if (!y || !m || !d) return false;
    return new Date(y, m - 1, d).getDay() === 0;
  }
  function isFestivoDate(date: string): boolean {
    return holidaysSet.has(date);
  }
  function getPlusItemsForCandidateDate(params: {
    candidateDate: string;
    prevId: string | null;
    currId: string | null;
  }): PlusItemLike[] {
    const out: PlusItemLike[] = [];
    const ids = [params.prevId, params.currId].filter((s): s is string => Boolean(s));
    for (const id of ids) {
      const list = plusesByJourney.get(id);
      if (!list) continue;
      for (const p of list) {
        const concepto = (p.concepto || p.concept || "").trim();
        if (!concepto) continue;

        // Solo heredamos automáticamente el plus diario de formación/segundo
        // conductor. Copiar cualquier plus de la jornada vecina (parking, bono,
        // incidencia, etc.) a un día sin jornada propia generaba duplicados.
        const normalizedConcept = concepto
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");
        const isSecondDriverTraining =
          normalizedConcept.includes("formacion") &&
          (normalizedConcept.includes("seg") || normalizedConcept.includes("conductor"));
        if (!isSecondDriverTraining) continue;

        const globalKey = `${params.candidateDate}||${concepto}||${id}`;
        if (usedPlusKeysGlobal.has(globalKey)) continue;
        out.push(p);
      }
    }
    return out;
  }

  const allNatural = await getAllNaturalDayDiets();
  const confirmedByDate = new Map<string, NaturalDayDietEntry>();
  for (const n of allNatural) {
    if (n.confirmedByUser) confirmedByDate.set(n.date, n);
  }

  const dismissedSet = await getAllDismissedNaturalDayDates();
  const dismissedWithInfo = new Map<string, string>();
  for (const n of allNatural) {
    if (n.dismissedAt) dismissedWithInfo.set(n.date, n.dismissedAt);
  }

  const journeyStartDatesWithDiet = new Set<string>();
  for (const j of allJornadas) {
    const dietAmount = j.dietaImporteEur ? parseFloat(j.dietaImporteEur) : 0;
    if (dietAmount > 0 && j.fechaInicio) journeyStartDatesWithDiet.add(j.fechaInicio);
  }
  const anyJourneyStartByDate = new Map<string, Jornada>();
  for (const j of allJornadas) {
    if (j.fechaInicio && !anyJourneyStartByDate.has(j.fechaInicio)) anyJourneyStartByDate.set(j.fechaInicio, j);
  }
  const journeyEndsAtBaseByDate = new Map<string, Jornada>();
  for (const j of allJornadas) {
    const f = extractYyyyMmDd(j.fechaFin ?? j.endAt);
    if (f && isBaseLocation(j.lugarFin, baseLocation)) journeyEndsAtBaseByDate.set(f, j);
  }

  const { customRates } = await loadDietDerivationContext();
  const findRateSafe = (t: NaturalDayDietType, pct: 100 | 60 | 30) => {
    try { return findRate(customRates, t, pct); } catch { return 0; }
  };

  const candidates: DetectedMissingNaturalDay[] = [];
  const seenDates = new Set<string>();

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const prevIni = extractYyyyMmDd(prev.fechaInicio ?? prev.startAt);
    const prevFin = extractYyyyMmDd(prev.fechaFin ?? prev.endAt);
    const currIni = extractYyyyMmDd(curr.fechaInicio ?? curr.startAt);
    if (!prevIni || !prevFin || !currIni) continue;

    // ——— CAPA 0: REGLA DEFINITIVA GAP EN_BASE ↔ EN_BASE ———
    // Si el GAP empieza EN_BASE (lugarFin previo = base) Y además termina EN_BASE (lugarInicio actual = base)
    //   → se trata de un descanso completo EN BASE → NUNCA dietas naturales, pase lo que pase con la máquina periods.
    // Ejemplo user: 30/07 fin Abrera → 24/08 ini Abrera → SKIP 31/07…23/08.
    // Si la fechaIni del gap siguiente EN BASE, pero la jornada INICIO también termina EN BASE al final → también aplica a arrival days.
    const prevEndsAtBase = isBaseLocation(prev.lugarFin, baseLocation);
    const currStartsAtBase = isBaseLocation(curr.lugarInicio, baseLocation);
    const gapBothEndsBase = Boolean(prevEndsAtBase && currStartsAtBase);
    // GAP DISTANCIA (días naturales entre última fecha útil de PREV y primera fecha útil de CURR)
    let gapStartDayInclusive: string | null = addDays(prevFin < prevIni ? prevIni : prevFin, 1);
    let gapEndDayInclusive: string | null = addDays(currIni, -1);
    let gapDayCount = 0;
    if (gapStartDayInclusive && gapEndDayInclusive && gapStartDayInclusive <= gapEndDayInclusive) {
      const y1 = +gapStartDayInclusive.slice(0,4), m1 = +gapStartDayInclusive.slice(5,7), d1 = +gapStartDayInclusive.slice(8,10);
      const y2 = +gapEndDayInclusive.slice(0,4), m2 = +gapEndDayInclusive.slice(5,7), d2 = +gapEndDayInclusive.slice(8,10);
      gapDayCount = Math.round((new Date(y2, m2-1, d2).getTime() - new Date(y1, m1-1, d1).getTime()) / 86400000) + 1;
    }
    // CAPA 0.5 BIS: GAP >= 2 días Y (algún extremo BASE) → se asume descanso en base (no es ruta continua single-night)
    const oneSideBaseLongRest = Boolean((prevEndsAtBase || currStartsAtBase) && gapDayCount >= 2);

    const gapFrom = prevFin < prevIni ? prevIni : prevFin; // en gaps normales, la última fecha útil del prev = fechaFin
    const gapTo = currIni;
    try {
      console.log("[detectMissingOutOfBaseDietDays:GAP]", {
        gapIndex: i,
        prev: { id: prev.id, fechaFin: prevFin, lugarFin: prev.lugarFin ?? null, endsAtBase: prevEndsAtBase, tipoRuta: prev.tipoRuta || null },
        curr: { id: curr.id, fechaInicio: currIni, lugarInicio: curr.lugarInicio ?? null, startsAtBase: currStartsAtBase, tipoRuta: curr.tipoRuta || null },
        gapRange: { from: addDays(gapFrom, 1), to: addDays(gapTo, -1), dayCount: gapDayCount },
        gapBothEndsBase,
        oneSideBaseLongRest,
        note: oneSideBaseLongRest ? "gap >= 2d & one endpoint = base → treated as in-base full rest" : null,
      });
    } catch {}
    if (gapBothEndsBase || oneSideBaseLongRest) {
      try { console.log("[detectMissingOutOfBaseDietDays:GAP_SKIP_ENDPOINTS_BASE]", { reason: gapBothEndsBase ? "BOTH_ENDS_BASE" : "ONE_END_BASE_GAP>=2DAYS" }); } catch {}
      continue;
    }

    let curDate = prevIni;
    while (curDate <= currIni) {
      if (options?.fromDate && curDate < options.fromDate) {
        curDate = addDays(curDate, 1);
        continue;
      }
      if (options?.toDate && curDate > options.toDate) {
        break;
      }
      if (curDate === prevIni) {
        curDate = addDays(curDate, 1);
        continue;
      }
      if (curDate === currIni) {
        curDate = addDays(curDate, 1);
        continue;
      }
      if (dismissedSet.has(curDate)) {
        curDate = addDays(curDate, 1);
        continue;
      }

      const periodForDate = periods.find(p => periodContainsDate(p, curDate));
      const isInsideOOBDuration = Boolean(periodForDate);
      const alreadyHasDiet = confirmedByDate.has(curDate) || journeyStartDatesWithDiet.has(curDate);
      const anyJourneyStartsToday = anyJourneyStartByDate.has(curDate);

      const arrivalJ = journeyEndsAtBaseByDate.get(curDate);

      // FIX A: SI ESTA FECHA ES DÍA DE LLEGADA A BASE (una jornada terminó EN BASE hoy),
      //        NO la procesa el GAP loop. La deja AL BLOQUE CROSSDAY_ARRIVAL para que
      //        marque isBaseArrivalDay=true, location=lugarFin, y lance el selector %.
      if (arrivalJ) {
        try {
          console.log("[detectMissingOutOfBaseDietDays:GAP_SKIP_ARRIVAL_DAY]", {
            date: curDate,
            reason: "SKIP gap-loop, handled by CROSSDAY_ARRIVAL block to set isBaseArrivalDay=true",
            arrivalJourney: { id: arrivalJ.id, lugarFin: arrivalJ.lugarFin ?? null, fechaFin: extractYyyyMmDd(arrivalJ.fechaFin ?? arrivalJ.endAt), horaFin: (arrivalJ as any).horaFin ?? null },
          });
        } catch {}
        curDate = addDays(curDate, 1);
        continue;
      }

      const nextStartsSameDay = anyJourneyStartsToday;
      let result: "SKIP" | "CANDIDATE" = "SKIP";
      if (anyJourneyStartsToday || alreadyHasDiet || !periodForDate) {
        result = "SKIP";
      } else {
        result = "CANDIDATE";
      }

      try {
        console.log("[detectMissingOutOfBaseDietDays]", {
          date: curDate,
          previousJourney: { id: prev.id, fechaInicio: prevIni, fechaFin: prevFin, lugarFin: prev.lugarFin ?? null, tipo: prev.tipoRuta ?? null, endsAtBase: prevEndsAtBase },
          nextJourney: { id: curr.id, fechaInicio: currIni, lugarInicio: curr.lugarInicio ?? null, startsAtBase: currStartsAtBase },
          gapBothEndsBase,
          baseLocation,
          isAtBase: Boolean(isBaseLocation(baseLocation, baseLocation)) && !isInsideOOBDuration,
          isInsideOutOfBasePeriod: isInsideOOBDuration,
          periodMatched: periodForDate ? { startDate: periodForDate.startDate, endDate: periodForDate.endDate, routeType: periodForDate.routeTypeAtStart, closedByBaseArrival: periodForDate.closedByBaseArrival, includesArrivalDay: periodForDate.includesArrivalDay, reliableStart: periodForDate.reliableLocationStart, reliableEnd: periodForDate.reliableLocationEnd } : null,
          alreadyHasDiet,
          anyJourneyStartsToday,
          dismissed: dismissedSet.has(curDate),
          result,
        });
      } catch {}

      if (result === "CANDIDATE" && !seenDates.has(curDate)) {
        seenDates.add(curDate);
        const p = periodForDate!;
        const tipoPrev = prev.tipoRuta || "NINGUNO";
        const tipoCurr = curr.tipoRuta || "NINGUNO";
        let resolvedType: NaturalDayDietType = p.routeTypeAtStart;
        if (resolvedType === "NACIONAL" && (tipoPrev === "INTERNACIONAL" || tipoCurr === "INTERNACIONAL" || tipoPrev === "REGIONAL_INTL" || tipoCurr === "REGIONAL_INTL" || tipoPrev === "NAC_INTL" || tipoCurr === "NAC_INTL")) {
          resolvedType = "INTERNACIONAL";
        }
        const percentage: 100 | 60 | 30 = 100;
        const amount = findRateSafe(resolvedType, percentage);
        let location: string | null = null;
        // FIX B: Regla ubicación FIABLE por cercanía temporal (nunca arrastrar FIN periodo a días antiguos):
        //   1. Si es EXACTAMENTE endDate del periodo por regreso a base → reliableLocationEnd (base)
        //   2. Si es EXACTAMENTE startDate del periodo → reliableLocationStart (fin jornada opener)
        //   3. SINO (día intermedio): la UBICACIÓN MÁS RECIENTE ANTERIOR = lugarFin de la jornada anterior (cruzada o no).
        //      Solo si no hay lugarFin previo, usamos reliableStart/end como fallback último.
        if (p.closedByBaseArrival && p.endDate === curDate) {
          location = p.reliableLocationEnd;
        } else if (p.startDate === curDate) {
          location = p.reliableLocationStart;
        } else {
          // Día intermedio: 1ª opción = lugarFin jornada anterior (última que pasó antes del gap).
          location = prev.lugarFin || null;
          if (!location && prevFin < curDate) {
            // 2ª opción: si hay fechaFin cruzada, usar reliableLocationStart (fin del opener)
            location = p.reliableLocationStart || null;
          }
          if (!location) {
            // 3ª opción fallback (siempre válido, pero menos preciso): reliableEnd del periodo o lugarInicio sgte
            location = p.reliableLocationEnd || curr.lugarInicio || p.reliableLocationStart || null;
          }
        }
        // CAPA 3 DEFENSA FINAL: si la location resuelta coincide con BASE → es un día EN BASE.
        // SKIP incondicional aunque periodForDate diga lo contrario.
        if (location && isBaseLocation(location, baseLocation)) {
          try {
            console.log("[detectMissingOutOfBaseDietDays:CANDIDATE_SKIP_BASE_LOCATION]", {
              date: curDate,
              resolvedLocation: location,
              reason: "SKIP incondicional: candidate resolved location matches user baseLocation",
            });
          } catch {}
          curDate = addDays(curDate, 1);
          continue;
        }
        candidates.push({
          date: curDate,
          type: resolvedType,
          percentage,
          amount,
          location,
          previousJourneyId: prev.id && !prev.id.startsWith("__") ? prev.id : null,
          nextJourneyId: curr.id && !curr.id.startsWith("__") ? curr.id : null,
          isBaseArrivalDay: false,

          // Campos richer nueva UI:
          previousJourneyStartAt: (prev as any).startAt ?? (prev as any).fechaInicio ?? null,
          previousJourneyEndAt: (prev as any).endAt ?? (prev as any).fechaFin ?? null,
          previousJourneyLugarInicio: prev.lugarInicio ?? null,
          previousJourneyLugarFin: prev.lugarFin ?? null,
          arrivesAtBase: prevEndsAtBase ?? false,
          arrivalHHMM: (prevEndsAtBase && (prev as any).horaFin) ? (prev as any).horaFin : null,
          nextJourneyStartAt: (curr as any).startAt ?? (curr as any).fechaInicio ?? null,
          nextJourneyLugarInicio: curr.lugarInicio ?? null,
          isDomingo: isDomingoDate(curDate),
          isFestivo: isFestivoDate(curDate),
          motivo: "Día completo fuera de base entre jornadas (periodo OutOfBase activo)",
          plusItems: getPlusItemsForCandidateDate({
            candidateDate: curDate,
            prevId: prev.id && !prev.id.startsWith("__") ? prev.id : null,
            currId: curr.id && !curr.id.startsWith("__") ? curr.id : null,
          }).map((p, idx) => ({
            id: p.id ?? `plus-${curDate}-${idx}`,
            concepto: (p.concepto ?? (p as any).concept ?? "").trim() || "Plus",
            amount: Number((p.amount ?? p.importe ?? 0)) || 0,
            selected: true,
          })),
        } as any);
      }

      curDate = addDays(curDate, 1);
    }
  }

  // --- BLOQUE ADICIONAL: día de regreso a base en jornada CRUZADA (empieza en base, termina en base, fechaInicio != fechaFin)
  // Caso 13 Abrera → 14 Abrera, tipo Internacional: NO abría OutOfBasePeriod (sale y vuelve a base),
  // pero el día natural 14 SÍ puede necesitar dieta (selector 100/60/30/sin dieta).
  try {
    const realJornadas = sorted.filter(j => j && !j.id?.startsWith("__"));
    for (const j of realJornadas) {
      const jIni = extractYyyyMmDd(j.fechaInicio ?? j.startAt);
      const jFin = extractYyyyMmDd(j.fechaFin ?? j.endAt);
      if (!jIni || !jFin) continue;
      if (jIni === jFin) continue;
      const endsBase = isBaseLocation(j.lugarFin, baseLocation);
      if (!endsBase) continue;
      const tipo = j.tipoRuta || "NINGUNO";
      if (tipo === "NINGUNO") continue;

      const candidateDate = jFin;
      if (options?.fromDate && candidateDate < options.fromDate) continue;
      if (options?.toDate && candidateDate > options.toDate) continue;
      if (dismissedSet.has(candidateDate)) continue;
      if (seenDates.has(candidateDate)) continue;
      if (confirmedByDate.has(candidateDate)) continue;
      if (journeyStartDatesWithDiet.has(candidateDate)) continue;
      // la jornada empieza en jIni y acaba en jFin (otro día). jFin no es el startDate de esa jornada. Pero SÍ una posterior o la del arrivalDay mismo.
      // No salta si ya tiene NDDE o dieta asociada al start. Ahora la marcamos.
      let rtype: NaturalDayDietType = "NACIONAL";
      if (tipo === "INTERNACIONAL" || tipo === "REGIONAL_INTL" || tipo === "NAC_INTL") rtype = "INTERNACIONAL";
      else if (tipo === "REGIONAL") rtype = "REGIONAL";
      const pct: 100 | 60 | 30 = 100;
      const amt = findRateSafe(rtype, pct);
      const loc = j.lugarFin || j.lugarInicio || null;
      let arrivalHHMM: string | null = null;
      if (j && (j as any).horaFin) arrivalHHMM = (j as any).horaFin;
      seenDates.add(candidateDate);
      const rawPluses = getPlusItemsForCandidateDate({ candidateDate, prevId: j.id.startsWith("__") ? null : j.id, currId: null });
      candidates.push({
        date: candidateDate,
        type: rtype,
        percentage: pct,
        amount: amt,
        location: loc,
        previousJourneyId: j.id.startsWith("__") ? null : j.id,
        nextJourneyId: null,
        isBaseArrivalDay: true,
        arrivalTime: arrivalHHMM,

        // Campos richer nueva UI:
        previousJourneyStartAt: (j as any).startAt ?? (j as any).fechaInicio ?? null,
        previousJourneyEndAt: (j as any).endAt ?? (j as any).fechaFin ?? null,
        previousJourneyLugarInicio: j.lugarInicio ?? null,
        previousJourneyLugarFin: j.lugarFin ?? null,
        arrivesAtBase: true,
        arrivalHHMM,
        nextJourneyStartAt: null,
        nextJourneyLugarInicio: null,
        isDomingo: isDomingoDate(candidateDate),
        isFestivo: isFestivoDate(candidateDate),
        motivo: "Jornada iniciada el día anterior y finalizada hoy en base (llegada a base)",
        plusItems: rawPluses.map((p, idx) => ({
          id: p.id ?? `plus-${candidateDate}-${idx}`,
          concepto: (p.concepto ?? (p as any).concept ?? "").trim() || "Plus",
          amount: Number((p.amount ?? p.importe ?? 0)) || 0,
          selected: true,
        })),
      } as any);
      try {
        console.log("[detectMissingOutOfBaseDietDays:CROSSDAY_ARRIVAL]", {
          date: candidateDate,
          journey: { id: j.id, fechaInicio: jIni, fechaFin: jFin, lugarInicio: j.lugarInicio ?? null, lugarFin: j.lugarFin ?? null, tipoRuta: tipo },
          baseLocation,
          type: rtype,
        });
      } catch {}
    }
  } catch {}

  candidates.sort((a, b) => a.date.localeCompare(b.date));
  return candidates;
}

export async function autoConfirmOutOfBaseDietDays(
  items: DetectedMissingNaturalDay[],
): Promise<NaturalDayDietEntry[]> {
  const safeItems = Array.isArray(items)
    ? items.filter((item) => item && item.date && item.isBaseArrivalDay !== true)
    : [];
  if (safeItems.length === 0) return [];

  const existing = await getAllNaturalDayDiets();
  const existingByDate = new Map(
    existing
      .filter((entry) => entry && entry.confirmedByUser && !entry.dismissedAt)
      .map((entry) => [entry.date, entry] as const),
  );
  const { dayExtras } = await loadDietDerivationContext();
  const now = new Date().toISOString();
  const created: NaturalDayDietEntry[] = [];

  const normalizeConcept = (value: string) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  for (const item of safeItems) {
    if (existingByDate.has(item.date)) continue;

    const plusItems: Array<{ concepto: string; amount: number; id: string }> = [];
    const seenConcepts = new Set<string>();

    for (const raw of Array.isArray(item.plusItems) ? item.plusItems : []) {
      if (raw?.selected === false) continue;
      const concepto = String(raw?.concepto || "Plus").trim() || "Plus";
      const amount = Math.round((Number(raw?.amount) || 0) * 100) / 100;
      if (amount <= 0) continue;
      const key = normalizeConcept(concepto);
      if (seenConcepts.has(key)) continue;
      seenConcepts.add(key);
      plusItems.push({
        concepto,
        amount,
        id: String(raw?.id || `auto_${item.date}_${key || "plus"}`),
      });
    }

    const addConfiguredPlus = (concepto: string, amountRaw: number) => {
      const amount = Math.round((Number(amountRaw) || 0) * 100) / 100;
      const key = normalizeConcept(concepto);
      if (amount <= 0 || seenConcepts.has(key)) return;
      seenConcepts.add(key);
      plusItems.push({
        concepto,
        amount,
        id: `auto_${item.date}_${key}`,
      });
    };

    if (item.isDomingo === true) addConfiguredPlus("Domingo", dayExtras.extra_sunday);
    if (item.isFestivo === true) addConfiguredPlus("Festivo", dayExtras.extra_holiday);

    const entry: NaturalDayDietEntry = {
      id: `auto_oob_${item.date}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      date: item.date,
      type: item.type,
      percentage: item.percentage,
      // amount contiene SOLO la dieta base. Los pluses permanecen separados.
      amount: Math.round((Number(item.amount) || 0) * 100) / 100,
      location: item.location ?? null,
      source: "NATURAL_DAY_OUT_OF_BASE",
      previousJourneyId: item.previousJourneyId ?? null,
      nextJourneyId: item.nextJourneyId ?? null,
      confirmedByUser: true,
      dismissedAt: null,
      createdAt: now,
      updatedAt: now,
      syncStatus: "pending",
      plusItems: plusItems.length > 0 ? plusItems : null,
      isDomingo: item.isDomingo === true,
      isFestivo: item.isFestivo === true,
    };
    created.push(entry);
    existingByDate.set(entry.date, entry);
  }

  if (created.length > 0) {
    await upsertNaturalDayDiets(created);
  }
  return created;
}

export async function importFromServer(serverJornadas: any[], serverCompensaciones: any[]): Promise<void> {
  const existingJornadas = await getAllJornadas();
  const existingComps = await getAllCompensaciones();

  if (existingJornadas.length === 0 && serverJornadas.length > 0) {
    const migrated = serverJornadas.map(migrateJornada);
    await saveAllJornadas(migrated);
  }
  if (existingComps.length === 0 && serverCompensaciones.length > 0) {
    const migrated = serverCompensaciones.map(migrateCompensacion);
    await saveAllCompensaciones(migrated);
  }
}

export type ModoViaje = "COMPLETO" | "SOLO_CARGA" | "SOLO_DESCARGA";

export interface Parada {
  id: string;
  tipo: "CARGA" | "DESCARGA";
  lugar: string;
  citaFecha: string | null;
  citaHora: string | null;
  llegadaReal: string | null;
  salidaReal: string | null;
  llegadaConfirmada: boolean;
  salidaConfirmada: boolean;
}

export interface Viaje {
  id: string;
  cliente: string | null;
  modoViaje: ModoViaje;
  notas: string | null;
  finLugar: string | null;
  finHora: string | null;
  finViajeNota: string | null;
  estado: "EN_CURSO" | "COMPLETADO";
  paradas: Parada[];
  createdAt: string;
  updatedAt: string;
}

const VIAJES_KEY = "tacoplan_viajes";
const VIAJE_PLACES_KEY = "tacoplan_viaje_places";

export async function getAllViajes(): Promise<Viaje[]> {
  const raw = await getItemScoped(VIAJES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return parsed.map(migrateViaje);
  } catch {
    return [];
  }
}

function migrateViaje(v: any): Viaje {
  if (v.paradas) return v as Viaje;
  const paradas: Parada[] = [];
  if (v.origen) {
    paradas.push({
      id: generateId(),
      tipo: "CARGA",
      lugar: v.origen,
      citaFecha: v.fechaInicio || null,
      citaHora: null,
      llegadaReal: null,
      salidaReal: null,
      llegadaConfirmada: false,
      salidaConfirmada: false,
    });
  }
  if (v.destino) {
    paradas.push({
      id: generateId(),
      tipo: "DESCARGA",
      lugar: v.destino,
      citaFecha: null,
      citaHora: null,
      llegadaReal: null,
      salidaReal: null,
      llegadaConfirmada: false,
      salidaConfirmada: false,
    });
  }
  if (v.cargas && Array.isArray(v.cargas)) {
    for (const c of v.cargas) {
      paradas.push({
        id: c.id || generateId(),
        tipo: c.tipo === "descarga" ? "DESCARGA" : "CARGA",
        lugar: c.lugar || "",
        citaFecha: c.fecha || null,
        citaHora: c.hora || null,
        llegadaReal: c.fecha && c.hora ? `${c.fecha}T${c.hora}` : null,
        salidaReal: null,
        llegadaConfirmada: !!(c.fecha && c.hora),
        salidaConfirmada: false,
      });
    }
  }
  return {
    id: v.id || generateId(),
    cliente: null,
    modoViaje: "COMPLETO",
    notas: v.observaciones || null,
    finLugar: null,
    finHora: null,
    finViajeNota: null,
    estado: v.estado === "completado" ? "COMPLETADO" : "EN_CURSO",
    paradas,
    createdAt: v.updatedAt || new Date().toISOString(),
    updatedAt: v.updatedAt || new Date().toISOString(),
  };
}

async function saveAllViajes(list: Viaje[]): Promise<void> {
  await setItemScoped(VIAJES_KEY, JSON.stringify(list));
}

export async function replaceImportedViajes(list: Viaje[]): Promise<void> {
  await saveAllViajes(list);
}

export async function upsertViajesImported(viajes: Viaje[]): Promise<{ added: number; skipped: number }> {
  if (viajes.length === 0) return { added: 0, skipped: 0 };
  const all = await getAllViajes();
  const map = new Map<string, Viaje>();
  for (const v of all) map.set(v.id, v);
  let added = 0;
  let skipped = 0;
  let changed = false;
  for (const v of viajes) {
    if (!v.id) continue;
    if (!map.has(v.id)) {
      map.set(v.id, v);
      added++;
      changed = true;
      for (const p of v.paradas || []) {
        if (p.lugar?.trim()) await addViajePlace(p.lugar.trim());
      }
    } else {
      skipped++;
    }
  }
  if (changed) await saveAllViajes(Array.from(map.values()));
  return { added, skipped };
}

export async function crearViaje(data: {
  cliente?: string;
  modoViaje: ModoViaje;
  notas?: string;
  paradas: Array<{ tipo: "CARGA" | "DESCARGA"; lugar: string; citaFecha?: string; citaHora?: string }>;
}): Promise<Viaje> {
  const all = await getAllViajes();
  const now = new Date().toISOString();
  const paradas: Parada[] = data.paradas.map((p) => ({
    id: generateId(),
    tipo: p.tipo,
    lugar: p.lugar,
    citaFecha: p.citaFecha || null,
    citaHora: p.citaHora || null,
    llegadaReal: null,
    salidaReal: null,
    llegadaConfirmada: false,
    salidaConfirmada: false,
  }));
  const viaje: Viaje = {
    id: generateId(),
    cliente: data.cliente?.trim() || null,
    modoViaje: data.modoViaje,
    notas: data.notas?.trim() || null,
    finLugar: null,
    finHora: null,
    finViajeNota: null,
    estado: "EN_CURSO",
    paradas,
    createdAt: now,
    updatedAt: now,
  };
  for (const p of paradas) {
    if (p.lugar.trim()) await addViajePlace(p.lugar.trim());
  }
  all.push(viaje);
  await saveAllViajes(all);
  return viaje;
}

export async function addParada(
  viajeId: string,
  data: { tipo: "CARGA" | "DESCARGA"; lugar: string; citaFecha?: string; citaHora?: string },
): Promise<void> {
  const all = await getAllViajes();
  const idx = all.findIndex((v) => v.id === viajeId);
  if (idx === -1) throw new Error("Viaje no encontrado");
  const parada: Parada = {
    id: generateId(),
    tipo: data.tipo,
    lugar: data.lugar,
    citaFecha: data.citaFecha || null,
    citaHora: data.citaHora || null,
    llegadaReal: null,
    salidaReal: null,
    llegadaConfirmada: false,
    salidaConfirmada: false,
  };
  all[idx].paradas.push(parada);
  all[idx].updatedAt = new Date().toISOString();
  if (data.lugar.trim()) await addViajePlace(data.lugar.trim());
  await saveAllViajes(all);
}

export async function marcarLlegada(viajeId: string, paradaId: string, datetime?: string): Promise<void> {
  const all = await getAllViajes();
  const idx = all.findIndex((v) => v.id === viajeId);
  if (idx === -1) throw new Error("Viaje no encontrado");
  const pIdx = all[idx].paradas.findIndex((p) => p.id === paradaId);
  if (pIdx === -1) throw new Error("Parada no encontrada");
  all[idx].paradas[pIdx].llegadaReal = datetime || new Date().toISOString();
  all[idx].paradas[pIdx].llegadaConfirmada = true;
  all[idx].updatedAt = new Date().toISOString();
  await saveAllViajes(all);
}

export async function marcarSalida(viajeId: string, paradaId: string, datetime?: string): Promise<void> {
  const all = await getAllViajes();
  const idx = all.findIndex((v) => v.id === viajeId);
  if (idx === -1) throw new Error("Viaje no encontrado");
  const pIdx = all[idx].paradas.findIndex((p) => p.id === paradaId);
  if (pIdx === -1) throw new Error("Parada no encontrada");
  if (!all[idx].paradas[pIdx].llegadaConfirmada) throw new Error("Registra la llegada primero");
  all[idx].paradas[pIdx].salidaReal = datetime || new Date().toISOString();
  all[idx].paradas[pIdx].salidaConfirmada = true;
  all[idx].updatedAt = new Date().toISOString();
  await saveAllViajes(all);
}

export async function completarViaje(viajeId: string, finData?: { finLugar?: string; finHora?: string; finViajeNota?: string }): Promise<void> {
  const all = await getAllViajes();
  const idx = all.findIndex((v) => v.id === viajeId);
  if (idx === -1) throw new Error("Viaje no encontrado");
  const v = all[idx];
  const allLlegadas = v.paradas.every((p) => p.llegadaConfirmada);
  if (!allLlegadas) throw new Error("Todas las paradas deben tener llegada registrada");
  v.estado = "COMPLETADO";
  v.finLugar = finData?.finLugar?.trim() || null;
  v.finHora = finData?.finHora?.trim() || null;
  v.finViajeNota = finData?.finViajeNota?.trim() || null;
  v.updatedAt = new Date().toISOString();
  await saveAllViajes(all);
}

export async function updateViaje(viajeId: string, data: Partial<Pick<Viaje, "cliente" | "notas" | "finLugar" | "finHora" | "finViajeNota">>): Promise<void> {
  const all = await getAllViajes();
  const idx = all.findIndex((v) => v.id === viajeId);
  if (idx === -1) throw new Error("Viaje no encontrado");
  if (data.cliente !== undefined) all[idx].cliente = data.cliente?.trim() || null;
  if (data.notas !== undefined) all[idx].notas = data.notas?.trim() || null;
  if (data.finLugar !== undefined) all[idx].finLugar = data.finLugar?.trim() || null;
  if (data.finHora !== undefined) all[idx].finHora = data.finHora?.trim() || null;
  if (data.finViajeNota !== undefined) all[idx].finViajeNota = data.finViajeNota?.trim() || null;
  all[idx].updatedAt = new Date().toISOString();
  await saveAllViajes(all);
}

export async function removeParada(viajeId: string, paradaId: string): Promise<void> {
  const all = await getAllViajes();
  const idx = all.findIndex((v) => v.id === viajeId);
  if (idx === -1) throw new Error("Viaje no encontrado");
  const pIdx = all[idx].paradas.findIndex((p) => p.id === paradaId);
  if (pIdx === -1) throw new Error("Parada no encontrada");
  if (all[idx].paradas.length <= 1) throw new Error("El viaje debe tener al menos una parada");
  all[idx].paradas.splice(pIdx, 1);
  all[idx].updatedAt = new Date().toISOString();
  await saveAllViajes(all);
}

export async function updateParada(
  viajeId: string,
  paradaId: string,
  data: Partial<Pick<Parada, "tipo" | "lugar" | "citaFecha" | "citaHora" | "llegadaReal" | "salidaReal">>,
): Promise<void> {
  const all = await getAllViajes();
  const idx = all.findIndex((v) => v.id === viajeId);
  if (idx === -1) throw new Error("Viaje no encontrado");
  const pIdx = all[idx].paradas.findIndex((p) => p.id === paradaId);
  if (pIdx === -1) throw new Error("Parada no encontrada");
  const p = all[idx].paradas[pIdx];
  if (data.tipo !== undefined) p.tipo = data.tipo;
  if (data.lugar !== undefined) p.lugar = data.lugar;
  if (data.citaFecha !== undefined) p.citaFecha = data.citaFecha;
  if (data.citaHora !== undefined) p.citaHora = data.citaHora;
  if (data.llegadaReal !== undefined) p.llegadaReal = data.llegadaReal;
  if (data.salidaReal !== undefined) p.salidaReal = data.salidaReal;
  all[idx].updatedAt = new Date().toISOString();
  await saveAllViajes(all);
}

export async function getFerryExtrasSummary(from: string, to: string, transitRate: number = 54.30, cabinRate: number = 54.30): Promise<{
  totalTransitDiet: number;
  totalCabinOvernight: number;
  totalCountryChange: number;
  totalAmount: number;
  transitRate: number;
  cabinRate: number;
  count: number;
}> {
  const all = await getAllJornadas();
  let totalTransitDiet = 0;
  let totalCabinOvernight = 0;
  let totalCountryChange = 0;
  let count = 0;
  const ferryRests = await getAllFerryRests();
  const linkedJornadaIds = new Set<string>();
  for (const fr of ferryRests) {
    if (fr.linkedJornadaId) linkedJornadaIds.add(fr.linkedJornadaId);
    if (!fr.fecha || fr.fecha < from || fr.fecha > to) continue;
    if (!fr.ferryExtras) continue;
    const td = Number(fr.ferryExtras.transitDiet) || 0;
    const co = Number(fr.ferryExtras.cabinOvernight) || 0;
    const cc = fr.ferryExtras.countryChange ? 1 : 0;
    if (td <= 0 && co <= 0 && cc === 0) continue;
    totalTransitDiet += td;
    totalCabinOvernight += co;
    totalCountryChange += cc;
    count++;
  }
  for (const j of all) {
    if (!j.fechaInicio || j.fechaInicio < from || j.fechaInicio > to) continue;
    if (!j.ferryExtras || linkedJornadaIds.has(j.id)) continue;
    const td = Number(j.ferryExtras.transitDiet) || 0;
    const co = Number(j.ferryExtras.cabinOvernight) || 0;
    const cc = j.ferryExtras.countryChange ? 1 : 0;
    if (td <= 0 && co <= 0 && cc === 0) continue;
    totalTransitDiet += td;
    totalCabinOvernight += co;
    totalCountryChange += cc;
    count++;
  }
  const totalAmount = (totalTransitDiet * transitRate) + (totalCabinOvernight * cabinRate);
  return { totalTransitDiet, totalCabinOvernight, totalCountryChange, totalAmount, transitRate, cabinRate, count };
}

export async function getViajesEnCurso(): Promise<Viaje[]> {
  const all = await getAllViajes();
  return all.filter((v) => v.estado === "EN_CURSO").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getViajesCompletados(): Promise<Viaje[]> {
  const all = await getAllViajes();
  return all.filter((v) => v.estado === "COMPLETADO").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getViajeById(viajeId: string): Promise<Viaje | null> {
  const all = await getAllViajes();
  return all.find((v) => v.id === viajeId) || null;
}

export async function eliminarViaje(viajeId: string): Promise<void> {
  const all = await getAllViajes();
  const filtered = all.filter((v) => v.id !== viajeId);
  await saveAllViajes(filtered);
}

export async function getViajePlaces(): Promise<string[]> {
  try {
    const raw = await getItemScoped(VIAJE_PLACES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p: any) => typeof p === "string" && p.trim()).slice(0, 20);
  } catch {
    return [];
  }
}

export async function addViajePlace(place: string): Promise<void> {
  if (!place.trim()) return;
  const trimmed = place.trim();
  const existing = await getViajePlaces();
  const filtered = existing.filter((p) => p.toLowerCase() !== trimmed.toLowerCase());
  const updated = [trimmed, ...filtered].slice(0, 20);
  await setItemScoped(VIAJE_PLACES_KEY, JSON.stringify(updated));
}

export type TachoActivityType = "conduccion" | "pausa" | "trabajo";

export interface TachoActivity {
  id: string;
  fecha: string;
  tipo: TachoActivityType;
  inicio: string;
  fin: string;
  duracionMin: number;
  origen: string | null;
  destino: string | null;
  createdAt: string;
  updatedAt: string;
}

const TACHO_ACTIVITIES_KEY = "tacoplan_tacho_activities";

export async function getAllTachoActivities(): Promise<TachoActivity[]> {
  const raw = await getItemScoped(TACHO_ACTIVITIES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function upsertTachoActivitiesImported(items: TachoActivity[]): Promise<{ added: number; skipped: number }> {
  if (items.length === 0) return { added: 0, skipped: 0 };
  const all = await getAllTachoActivities();
  const map = new Map<string, TachoActivity>();
  for (const a of all) map.set(a.id, a);
  let added = 0;
  let skipped = 0;
  let changed = false;
  for (const a of items) {
    if (!a.id) continue;
    if (!map.has(a.id)) {
      map.set(a.id, a);
      added++;
      changed = true;
    } else {
      skipped++;
    }
  }
  if (changed) await setItemScoped(TACHO_ACTIVITIES_KEY, JSON.stringify(Array.from(map.values())));
  return { added, skipped };
}

export async function replaceImportedTachoActivities(items: TachoActivity[]): Promise<void> {
  await setItemScoped(TACHO_ACTIVITIES_KEY, JSON.stringify(items));
}

export interface MoroccoTrip {
  id: string;
  fecha: string;
  origen: string;
  destino: string;
  estado: "ida" | "vuelta" | "completo";
  importe: number;
  createdAt: string;
  updatedAt: string;
}

export interface FerryRestRecord {
  id: string;
  fecha: string;
  startTime: string;
  endTime?: string;
  restType: "9h" | "11h";
  interruptions: FerryInterruption[] | Array<{ startMin: number; endMin: number }>;
  interruptionTotalMin: number;
  accumulatedRestMin?: number;
  linkedJornadaId?: string;
  isValid: boolean;
  isComplete?: boolean;
  resumedPreviousJourney?: boolean;
  invalidReason: string | null;
  createdAt: string;
  destination?: string;
  ferryExtras?: FerryExtras;
}

export async function getAllMoroccoTrips(): Promise<MoroccoTrip[]> {
  try {
    const raw = await getItemScoped(MOROCCO_TRIPS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function addMoroccoTrip(trip: Omit<MoroccoTrip, "id" | "createdAt" | "updatedAt">): Promise<MoroccoTrip> {
  const all = await getAllMoroccoTrips();
  const now = new Date().toISOString();
  const newTrip: MoroccoTrip = {
    ...trip,
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    createdAt: now,
    updatedAt: now,
  };
  all.push(newTrip);
  await setItemScoped(MOROCCO_TRIPS_KEY, JSON.stringify(all));
  return newTrip;
}

export async function updateMoroccoTrip(id: string, updates: Partial<MoroccoTrip>): Promise<void> {
  const all = await getAllMoroccoTrips();
  const idx = all.findIndex((t) => t.id === id);
  if (idx === -1) return;
  all[idx] = { ...all[idx], ...updates, updatedAt: new Date().toISOString() };
  await setItemScoped(MOROCCO_TRIPS_KEY, JSON.stringify(all));
}

export async function deleteMoroccoTrip(id: string): Promise<void> {
  const all = await getAllMoroccoTrips();
  const filtered = all.filter((t) => t.id !== id);
  await setItemScoped(MOROCCO_TRIPS_KEY, JSON.stringify(filtered));
}

export async function getMoroccoTripsSummary(desde: string, hasta: string): Promise<{
  trips: MoroccoTrip[];
  count: number;
  totalImporte: number;
}> {
  const all = await getAllMoroccoTrips();
  const filtered = all.filter((t) => t.fecha >= desde && t.fecha <= hasta);
  const totalImporte = filtered.reduce((s, t) => s + t.importe, 0);
  return { trips: filtered, count: filtered.length, totalImporte };
}

export async function getMoroccoPernoctaSummary(desde: string, hasta: string, pernightRate: number): Promise<{
  trips: MoroccoTrip[];
  count: number;
  totalImporte: number;
}> {
  const all = await getAllMoroccoTrips();
  const filtered = all.filter((t) => t.fecha >= desde && t.fecha <= hasta);
  const totalImporte = filtered.reduce((s, t) => s + t.importe, 0);
  return { trips: filtered, count: filtered.length, totalImporte };
}

export async function getMoroccoJornadaSummary(
  desde: string,
  hasta: string,
  paymentMode: "morocco_trip" | "morocco_pernight" | "morocco_diet",
): Promise<{
  count: number;
  totalDieta: number;
  totalExtras: number;
}> {
  const all = await getAllJornadas();
  const filtered = all.filter(
    (j) => j.fechaFin && j.fechaInicio >= desde && j.fechaInicio <= hasta && j.moroccoPaymentMode === paymentMode,
  );
  let totalDieta = 0;
  let totalExtras = 0;
  for (const j of filtered) {
    const dieta = j.dietaImporteEur ? parseFloat(j.dietaImporteEur) : 0;
    const dayEx = j.dayExtraEur ? parseFloat(j.dayExtraEur) : 0;
    totalDieta += (dieta - dayEx);
    totalExtras += dayEx;
  }
  return {
    count: filtered.length,
    totalDieta: Math.round(totalDieta * 100) / 100,
    totalExtras: Math.round(totalExtras * 100) / 100,
  };
}

export async function getAllFerryRests(): Promise<FerryRestRecord[]> {
  try {
    const raw = await getItemScoped(FERRY_RESTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function replaceImportedFerryRests(list: FerryRestRecord[]): Promise<void> {
  await setItemScoped(FERRY_RESTS_KEY, JSON.stringify(list));
}

export async function addFerryRest(rest: Omit<FerryRestRecord, "id" | "createdAt">): Promise<FerryRestRecord> {
  const all = await getAllFerryRests();
  const newRest: FerryRestRecord = {
    ...rest,
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    createdAt: new Date().toISOString(),
  };
  all.push(newRest);
  await setItemScoped(FERRY_RESTS_KEY, JSON.stringify(all));
  return newRest;
}

export async function updateFerryRest(id: string, updates: Partial<Omit<FerryRestRecord, "id" | "createdAt">>): Promise<FerryRestRecord | null> {
  const all = await getAllFerryRests();
  const idx = all.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...updates };
  await setItemScoped(FERRY_RESTS_KEY, JSON.stringify(all));
  return all[idx];
}

export async function deleteFerryRest(id: string): Promise<void> {
  const all = await getAllFerryRests();
  const filtered = all.filter((r) => r.id !== id);
  await setItemScoped(FERRY_RESTS_KEY, JSON.stringify(filtered));
}

export interface ActiveFerryRest {
  startTime: string;
  restType: "9h" | "11h";
  interruptions: FerryInterruption[];
  computedEnd: string;
  linkedJornadaId: string;
  status: "active" | "completed" | "incomplete" | "invalid";
}

function computeFerryEndTime(startTime: string, restType: "9h" | "11h", interruptions: FerryInterruption[]): string {
  const restMinutes = restType === "9h" ? 540 : 660;
  let totalIntMin = 0;
  for (const int of interruptions) {
    if (int.end) {
      totalIntMin += Math.max(0, Math.round((new Date(int.end).getTime() - new Date(int.start).getTime()) / 60000));
    }
  }
  return new Date(new Date(startTime).getTime() + (restMinutes + totalIntMin) * 60000).toISOString();
}

export function getInterruptionsTotalMin(interruptions: FerryInterruption[]): number {
  let total = 0;
  for (const int of interruptions) {
    if (int.end) {
      total += Math.max(0, Math.round((new Date(int.end).getTime() - new Date(int.start).getTime()) / 60000));
    }
  }
  return total;
}

export function getAccumulatedRestMin(startTime: string, interruptions: FerryInterruption[]): number {
  const now = Date.now();
  const startMs = new Date(startTime).getTime();
  const totalElapsed = Math.max(0, now - startMs);
  const intMs = interruptions.reduce((s, int) => {
    if (int.end) {
      return s + Math.max(0, new Date(int.end).getTime() - new Date(int.start).getTime());
    } else {
      return s + Math.max(0, now - new Date(int.start).getTime());
    }
  }, 0);
  return Math.round((totalElapsed - intMs) / 60000);
}

export function hasOpenInterruption(interruptions: FerryInterruption[]): boolean {
  return interruptions.some((i) => i.end === null);
}

export async function getActiveFerryRest(): Promise<ActiveFerryRest | null> {
  try {
    const raw = await getItemScoped(ACTIVE_FERRY_REST_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function setActiveFerryRest(rest: ActiveFerryRest): Promise<void> {
  await setItemScoped(ACTIVE_FERRY_REST_KEY, JSON.stringify(rest));
}

export async function clearActiveFerryRest(): Promise<void> {
  await removeItemScoped(ACTIVE_FERRY_REST_KEY);
}

export async function startFerryInterruption(): Promise<ActiveFerryRest | null> {
  const active = await getActiveFerryRest();
  if (!active) return null;
  if (hasOpenInterruption(active.interruptions)) return active;
  if (active.interruptions.length >= 2) return active;
  const updated: ActiveFerryRest = {
    ...active,
    interruptions: [...active.interruptions, { start: new Date().toISOString(), end: null }],
  };
  updated.computedEnd = computeFerryEndTime(updated.startTime, updated.restType, updated.interruptions);
  await setActiveFerryRest(updated);
  return updated;
}

export async function endFerryInterruption(): Promise<ActiveFerryRest | null> {
  const active = await getActiveFerryRest();
  if (!active) return null;
  const openIdx = active.interruptions.findIndex((i) => i.end === null);
  if (openIdx === -1) return active;
  const updated: ActiveFerryRest = {
    ...active,
    interruptions: active.interruptions.map((int, idx) =>
      idx === openIdx ? { ...int, end: new Date().toISOString() } : int
    ),
  };
  updated.computedEnd = computeFerryEndTime(updated.startTime, updated.restType, updated.interruptions);
  await setActiveFerryRest(updated);
  return updated;
}

export function validateFerryRestCompletion(active: ActiveFerryRest): {
  isValid: boolean;
  isComplete: boolean;
  reason: string | null;
} {
  const requiredMin = active.restType === "9h" ? 540 : 660;
  const accum = getAccumulatedRestMin(active.startTime, active.interruptions);
  const totalIntMin = getInterruptionsTotalMin(active.interruptions);
  const intCount = active.interruptions.filter((i) => i.end !== null).length;

  if (intCount > 2) return { isValid: false, isComplete: false, reason: "ferry.restForm.maxInterruptions" };
  if (totalIntMin > 60) return { isValid: false, isComplete: false, reason: "ferry.restForm.maxTotalInterruption" };
  if (accum < requiredMin) return { isValid: true, isComplete: false, reason: "ferry.incompleteModal.message" };
  return { isValid: true, isComplete: true, reason: null };
}

export async function updateJornadaFerryData(
  jornadaId: string,
  updates: Partial<Pick<Jornada, "ferryPending" | "ferryDestination" | "ferryExtras" | "ferryInterruptions" | "ferryRestCompleted" | "ferryRestType" | "tipoRuta" | "dietaImporteEur" | "dietBaseEur" | "dietRule" | "dietasItems">>,
): Promise<Jornada | null> {
  const all = await getAllJornadas();
  const idx = all.findIndex((j) => j.id === jornadaId);
  if (idx === -1) return null;

  const j = all[idx];
  const updated = { ...j, ...updates, updatedAt: new Date().toISOString(), syncStatus: "pending" as const };
  all[idx] = updated;
  await saveAllJornadas(all);
  return updated;
}

export function getFerryInterruptionsTotalMin(interruptions: FerryInterruption[]): number {
  let total = 0;
  for (const int of interruptions) {
    if (!int.start) continue;
    const end = int.end ? new Date(int.end).getTime() : Date.now();
    total += Math.max(0, (end - new Date(int.start).getTime()) / 60000);
  }
  return Math.round(total);
}

export function getFerryEffectiveRestMin(endAt: string, interruptions: FerryInterruption[]): number {
  const closedTime = new Date(endAt).getTime();
  const elapsed = (Date.now() - closedTime) / 60000;
  const intMin = getFerryInterruptionsTotalMin(interruptions);
  return Math.round(Math.max(0, elapsed - intMin));
}

export function validateFerryJornadaRest(jornada: Jornada): {
  isValid: boolean;
  isComplete: boolean;
  effectiveMin: number;
  interruptionMin: number;
  interruptionCount: number;
  reason: string | null;
} {
  const ints = jornada.ferryInterruptions || [];
  const requiredMin = jornada.ferryRestType === "11h" ? 660 : 540;
  const effectiveMin = jornada.endAt ? getFerryEffectiveRestMin(jornada.endAt, ints) : 0;
  const interruptionMin = getFerryInterruptionsTotalMin(ints);
  const completedInts = ints.filter((i) => i.end !== null).length;
  const hasOpenInt = ints.some((i) => i.end === null);

  if (completedInts > 2 || (completedInts === 2 && hasOpenInt))
    return { isValid: false, isComplete: false, effectiveMin, interruptionMin, interruptionCount: completedInts, reason: "ferry.restForm.maxInterruptions" };
  if (interruptionMin > 60)
    return { isValid: false, isComplete: false, effectiveMin, interruptionMin, interruptionCount: completedInts, reason: "ferry.restForm.maxTotalInterruption" };
  if (effectiveMin < requiredMin)
    return { isValid: true, isComplete: false, effectiveMin, interruptionMin, interruptionCount: completedInts, reason: null };
  return { isValid: true, isComplete: true, effectiveMin, interruptionMin, interruptionCount: completedInts, reason: null };
}
