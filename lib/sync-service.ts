import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getPendingSyncData, markAllSynced, mergeFromCloud } from "@/lib/local-storage";
import * as LS from "@/lib/local-storage";
import { normalizeLocationText } from "@/lib/location-normalization";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

const OFFLINE_QUEUE_KEY = "tacoplan_offline_queue";
const LAST_SYNC_KEY = "tacoplan_last_sync";
const DEVICE_ID_KEY = "tacoplan_device_id";
const DEVICE_ID_GLOBAL_KEY = "tacoplan_device_id_global";
const SYNC_DEBOUNCE_MS = 2000;
const JORNADA_DATE_DEBUG_URL = "http://127.0.0.1:7777/event";
const JORNADA_DATE_DEBUG_SESSION = "jornada-date-drift";
const JORNADA_DATE_DEBUG_RUN = "pre-fix";

type SyncAction =
  | { type: "push"; timestamp: number }
  | { type: "delete"; jornadaId: string; timestamp: number }
  | { type: "delete_day_extra"; entryId: string; timestamp: number }
  | { type: "delete_natural_day"; entryId: string; timestamp: number };

let onlineOverride: boolean | null = null;

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
        platform: Platform.OS,
        ...data,
      },
      ts: Date.now(),
    }),
  }).catch(() => {});
}

export function setOnlineOverride(next: boolean | null): void {
  onlineOverride = next;
}

async function userScopedKey(base: string): Promise<string> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!session?.user) throw new Error("No hay usuario autenticado");
  return `${base}_${session.user.id}`;
}

export interface SyncResult {
  success: boolean;
  message: string;
  stats?: {
    pulled: number;
    pushed: number;
    merged: number;
  };
}

async function touchDeviceLastSyncAt(userId: string): Promise<void> {
  try {
    if (!userId) return;
    const deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY).catch(() => null);
    if (!deviceId) return;
    const nowIso = new Date().toISOString();
    await supabase
      .from("app_user_devices")
      .update({ last_sync_at: nowIso, updated_at: nowIso } as any)
      .eq("user_id", userId)
      .eq("device_id", deviceId);
  } catch {}
}

type CloudPayload = {
  profile: any | null;
  dietasConfig: { rates: any[]; extras: any | null; holidays: any[] } | null;
  ferryConfig: any | null;
  jornadas: any[];
  compensaciones: any[];
  dayExtraEntries: any[];
  naturalDayDiets: any[];
};

export type NATURAL_TYPE = "INTERNACIONAL" | "NACIONAL" | "REGIONAL";

export interface NaturalDayDietEntry {
  id: string;
  date: string;
  type: NATURAL_TYPE;
  percentage: 100 | 60 | 30;
  amount: number;
  location?: string | null;
  source: string;
  previousJourneyId?: string | null;
  nextJourneyId?: string | null;
  confirmedByUser: boolean;
  dismissedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  syncStatus: "synced" | "pending" | "local";
  plusItems?: Array<{ concepto: string; amount: number; id: string }> | null;
  isDomingo?: boolean | null;
  isFestivo?: boolean | null;
}

const columnsCache = new Map<string, Set<string>>();

async function getColumnSet(table: string): Promise<Set<string>> {
  const cached = columnsCache.get(table);
  if (cached) return cached;

  try {
    const res = await supabase.from(table).select("*").limit(1);
    const row = Array.isArray(res.data) && res.data.length > 0 ? res.data[0] : null;
    const cols = new Set<string>();
    if (row && typeof row === "object") {
      for (const k of Object.keys(row)) cols.add(k);
    } else {
      cols.add(table === "profiles" ? "id" : "id");
    }
    columnsCache.set(table, cols);
    return cols;
  } catch {
    const cols = new Set<string>();
    cols.add("id");
    columnsCache.set(table, cols);
    return cols;
  }
}

function mapJornadaFromDb(j: any) {
  const mapped = {
    id: j.id,
    fechaInicio: j.fecha_inicio,
    horaInicio: j.hora_inicio,
    lugarInicio: normalizeLocationText(j.lugar_inicio || ""),
    fechaFin: j.fecha_fin,
    horaFin: j.hora_fin,
    lugarFin: j.lugar_fin ? normalizeLocationText(j.lugar_fin) : null,
    startAt: j.start_at,
    endAt: j.end_at,
    conduccionMin: j.conduccion_min,
    conduccionDomingoMin: j.conduccion_domingo_min ?? null,
    conduccionLunesMin: j.conduccion_lunes_min ?? null,
    tipoRuta: j.tipo_ruta,
    pernocta: j.pernocta,
    dietaModo: j.dieta_modo,
    dietaManualTipo: j.dieta_manual_tipo,
    dietaManualPct: j.dieta_manual_pct,
    dietaImporteEur: j.dieta_importe_eur,
    dietasItems: j.dietas_items,
    dietaPercent: j.dieta_percent ?? null,
    dayFlag: j.day_flag ?? null,
    dayExtraEur: j.day_extra_eur ?? null,
    dietBaseEur: j.diet_base_eur ?? null,
    dietRule: j.diet_rule ?? null,
    dietCalculatedAt: j.diet_calculated_at ?? null,
    descansoAnteriorMin: j.descanso_anterior_min,
    tipoDescansoAnterior: j.tipo_descanso_anterior,
    duracionJornadaMin: j.duracion_jornada_min,
    countsAsDailyReduced: j.counts_as_daily_reduced || false,
    plannedRestMin: j.planned_rest_min ?? null,
    plannedRestType: j.planned_rest_type ?? null,
    splitRestDetected: j.split_rest_detected ?? false,
    splitRestFirstPartMin: j.split_rest_first_part_min ?? null,
    splitRestSecondPartMin: j.split_rest_second_part_min ?? null,
    countsAsReducedRest: j.counts_as_reduced_rest ?? true,
    paymentMode: j.payment_mode ?? null,
    kmInicio: j.km_inicio ?? null,
    kmFin: j.km_fin ?? null,
    kmTotal: j.km_total ?? null,
    pricePerKm: j.price_per_km ?? null,
    importeKm: j.importe_km ?? null,
    pricePerTrip: j.price_per_trip ?? null,
    importeViaje: j.importe_viaje ?? null,
    reportHideAmounts: j.report_hide_amounts ?? false,
    reportHidePluses: j.report_hide_pluses ?? false,
    plusItems: j.plus_items ?? null,
    observaciones: j.observaciones ?? null,
    legalSummary: j.legal_summary ?? null,
    previousRestSource: j.previous_rest_source ?? null,
    previousRestId: j.previous_rest_id ?? null,
    previousRestValid: j.previous_rest_valid ?? null,
    previousRestStartAt: j.previous_rest_start_at ?? null,
    previousRestEndAt: j.previous_rest_end_at ?? null,
    previousRestLegalType: j.previous_rest_legal_type ?? null,
    previousRestStartLocation: j.previous_rest_start_location ?? null,
    previousRestEndLocation: j.previous_rest_end_location ?? null,
    previousRestInBase: j.previous_rest_in_base ?? null,
    previousRestDistanceKm: j.previous_rest_distance_km != null ? Number(j.previous_rest_distance_km) : null,
    previousRestPerformedInVehicle: j.previous_rest_performed_in_vehicle ?? null,
    previousRestAccommodation: j.previous_rest_accommodation ?? null,
    previousRestCompGeneratedMin: j.previous_rest_comp_generated_min ?? null,
    previousRestCompUsedMin: j.previous_rest_comp_used_min ?? null,
    previousRestObservations: j.previous_rest_observations ?? null,
    moroccoPaymentMode: j.morocco_payment_mode ?? null,
    moroccoTripRate: j.morocco_trip_rate ?? null,
    moroccoPernightRate: j.morocco_pernight_rate ?? null,
    ferryPending: j.ferry_pending != null ? j.ferry_pending : null,
    ferryRestType: j.ferry_rest_type ?? null,
    ferryDestination: j.ferry_destination ?? null,
    ferryExtras: j.ferry_extras ?? null,
    ferryInterruptions: j.ferry_interruptions ?? null,
    ferryRestCompleted: j.ferry_rest_completed != null ? j.ferry_rest_completed : null,
    tachoDailySummaryId: j.tacho_daily_summary_id ?? null,
    tachoDrivingMin: j.tacho_driving_min ?? null,
    tachoWorkMin: j.tacho_work_min ?? null,
    tachoAvailableMin: j.tacho_available_min ?? null,
    tachoRestMin: j.tacho_rest_min ?? null,
    tachoCountries: j.tacho_countries ?? null,
    tachoCountryEntries: j.tacho_country_entries ?? null,
    tachoKmTotal: j.tacho_km_total ?? null,
    tachoFirstActivityAt: j.tacho_first_activity_at ?? null,
    tachoLastActivityAt: j.tacho_last_activity_at ?? null,
    tachoDisconnections: j.tacho_disconnections ?? null,
    tachoDataQuality: j.tacho_data_quality ?? null,
    isDoubleDriving: j.is_double_driving === true ? true : false,
    secondDriverName: j.second_driver_name ?? null,
    updatedAt: j.updated_at,
    syncStatus: "synced" as const,
  };
  // #region debug-point D:supabase-read
  reportJornadaDateDebug("D", "sync-service:mapJornadaFromDb", "mapped jornada read from Supabase", {
    jornadaId: mapped.id,
    dbRow: {
      fecha_inicio: j.fecha_inicio,
      hora_inicio: j.hora_inicio,
      fecha_fin: j.fecha_fin,
      hora_fin: j.hora_fin,
      start_at: j.start_at,
      end_at: j.end_at,
      updated_at: j.updated_at,
    },
    mapped: {
      fechaInicio: mapped.fechaInicio,
      horaInicio: mapped.horaInicio,
      fechaFin: mapped.fechaFin,
      horaFin: mapped.horaFin,
      startAt: mapped.startAt,
      endAt: mapped.endAt,
    },
  });
  // #endregion
  return mapped;
}

function mapCompensacionFromDb(c: any) {
  return {
    id: c.id,
    jornadaId: c.jornada_id,
    horasDeuda: c.horas_deuda,
    minutosDeuda: c.minutos_deuda,
    fechaLimite: c.fecha_limite,
    compensada: c.compensada,
    fechaCompensacion: c.fecha_compensacion,
    sourceRestStartAt: c.source_rest_start_at ?? null,
    sourceRestEndAt: c.source_rest_end_at ?? null,
    sourceRestDurationMin: c.source_rest_duration_min ?? null,
    sourceRestLegalType: c.source_rest_legal_type ?? null,
    sourceRestLocationStart: c.source_rest_location_start ?? null,
    sourceRestLocationEnd: c.source_rest_location_end ?? null,
    sourceRestInBase: c.source_rest_in_base ?? null,
    sourceRestDistanceKm: c.source_rest_distance_km != null ? Number(c.source_rest_distance_km) : null,
    sourceRestObservations: c.source_rest_observations ?? null,
    recoveredInJornadaId: c.recovered_in_jornada_id ?? null,
    recoveryRestStartAt: c.recovery_rest_start_at ?? null,
    recoveryRestEndAt: c.recovery_rest_end_at ?? null,
    recoveryRestDurationMin: c.recovery_rest_duration_min ?? null,
    updatedAt: c.updated_at,
    syncStatus: "synced" as const,
  };
}

function mapDayExtraEntryFromDb(e: any) {
  return {
    id: e.id,
    date: e.date,
    entryType: (e.entry_type as any) || "day_extra",
    dayFlag: e.day_flag ?? null,
    offsiteRestType: e.offsite_rest_type ?? null,
    offsiteBase: e.offsite_base ?? null,
    plusSunday: e.plus_sunday != null ? !!e.plus_sunday : false,
    plusHoliday: e.plus_holiday != null ? !!e.plus_holiday : false,
    locationStart: e.location_start ?? null,
    locationEnd: e.location_end ?? null,
    inBase: e.in_base == null ? null : !!e.in_base,
    distanceToBaseKm: e.distance_to_base_km != null ? Number(e.distance_to_base_km) : null,
    amount: e.amount != null ? Number(e.amount) : null,
    note: e.note ?? null,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
    syncStatus: "synced" as const,
  };
}

function mapNaturalDayFromDb(row: any): NaturalDayDietEntry {
  const pct = Number(row.percentage);
  const percentage: 100 | 60 | 30 =
    pct === 60 ? 60 : pct === 30 ? 30 : 100;
  let plusItems: Array<{ concepto: string; amount: number; id: string }> | null = null;
  if (row.pluses_json != null) {
    try {
      const arr = typeof row.pluses_json === "string" ? JSON.parse(row.pluses_json) : row.pluses_json;
      if (Array.isArray(arr) && arr.length > 0) {
        plusItems = arr
          .filter((p: any) => p && String(p.concepto || "").trim().length > 0 && Number.isFinite(Number(p.amount)))
          .map((p: any) => ({
            concepto: String(p.concepto).trim().slice(0, 200),
            amount: Math.max(0, Math.min(99999, +Number(p.amount).toFixed(2))),
            id: String(p.id || `${row.date}_${p.concepto}_${Math.random().toString(36).slice(2, 7)}`),
          }));
        if (plusItems.length === 0) plusItems = null;
      }
    } catch {
      plusItems = null;
    }
  }
  return {
    id: row.id,
    date: row.date,
    type: row.type as NATURAL_TYPE,
    percentage,
    amount: Number(row.amount) || 0,
    location: row.location ?? null,
    source: row.source,
    previousJourneyId: row.previous_journey_id ?? null,
    nextJourneyId: row.next_journey_id ?? null,
    confirmedByUser: !!row.confirmed_by_user,
    dismissedAt: row.dismissed_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: "synced",
    plusItems,
    isDomingo: typeof row.is_domingo === "boolean" ? row.is_domingo : null,
    isFestivo: typeof row.is_festivo === "boolean" ? row.is_festivo : null,
  };
}

async function applyNaturalDayDietsLocally(list: any[]): Promise<void> {
  if (!list || list.length === 0) return;
  await LS.mergeNaturalDayDietsFromCloud(list as any);
}

async function pullCloudAll(user: User): Promise<CloudPayload> {
  const userId = user.id;
  const [profileRes, jornadasRes, compensacionesRes, ratesRes, extrasRes, holidaysRes, dayExtraRes, natRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("jornadas").select("*").eq("user_id", userId).order("start_at", { ascending: false }),
    supabase.from("compensaciones").select("*").eq("user_id", userId).order("fecha_limite", { ascending: true }),
    supabase.from("user_diet_rates").select("*").eq("user_id", userId),
    supabase.from("user_day_extras").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("user_holidays").select("*").eq("user_id", userId).order("date"),
    supabase.from("user_day_extra_entries").select("*").eq("user_id", userId).order("date"),
    supabase.from("user_natural_day_diets").select("*").eq("user_id", userId).order("date", { ascending: true }),
  ]);

  if (profileRes.error) throw profileRes.error;
  if (jornadasRes.error) throw jornadasRes.error;
  if (compensacionesRes.error) throw compensacionesRes.error;
  if (ratesRes.error) throw ratesRes.error;
  if (holidaysRes.error) throw holidaysRes.error;

  const jornadas = (jornadasRes.data || []).map(mapJornadaFromDb);
  const compensaciones = (compensacionesRes.data || []).map(mapCompensacionFromDb);
  const dayExtraEntries = dayExtraRes.error ? [] : (dayExtraRes.data || []).map(mapDayExtraEntryFromDb);
  const naturalDayDiets = (natRes.data || []).map(mapNaturalDayFromDb);

  let extras = extrasRes.error ? null : extrasRes.data;
  if (!extras) {
    try {
      const cols = await getColumnSet("user_day_extras");
      const baseRow: Record<string, any> = {
        user_id: userId,
        extra_saturday: 0,
        extra_sunday: 0,
        extra_holiday: 0,
        updated_at: new Date().toISOString(),
      };
      if (cols.has("offsite_weekly_reduced_nacional")) baseRow.offsite_weekly_reduced_nacional = 0;
      if (cols.has("offsite_weekly_reduced_internacional")) baseRow.offsite_weekly_reduced_internacional = 0;
      if (cols.has("offsite_weekly_complete_nacional")) baseRow.offsite_weekly_complete_nacional = 0;
      if (cols.has("offsite_weekly_complete_internacional")) baseRow.offsite_weekly_complete_internacional = 0;
      const inserted = await supabase.from("user_day_extras").insert(baseRow).select().single();
      if (inserted.error) throw inserted.error;
      extras = inserted.data;
    } catch (e) {
      const inserted = await supabase
        .from("user_day_extras")
        .insert({ user_id: userId, extra_saturday: 0, extra_sunday: 0, extra_holiday: 0, updated_at: new Date().toISOString() })
        .select()
        .single();
      if (inserted.error) throw inserted.error;
      extras = inserted.data;
    }
  }

  let ferryConfig: any | null = null;
  try {
    const ferryRes = await supabase.from("user_ferry_config").select("*").eq("user_id", userId).maybeSingle();
    ferryConfig = ferryRes.error ? null : (ferryRes.data ?? null);
  } catch {
    ferryConfig = null;
  }

  return {
    profile: profileRes.data ?? null,
    jornadas,
    compensaciones,
    dayExtraEntries,
    naturalDayDiets,
    ferryConfig,
    dietasConfig: {
      rates: ratesRes.data || [],
      extras,
      holidays: holidaysRes.data || [],
    },
  };
}

function isOnline(): boolean {
  if (onlineOverride !== null) return onlineOverride;
  if (Platform.OS === "web" && typeof navigator !== "undefined") {
    return navigator.onLine;
  }
  return true;
}

async function getOfflineQueue(): Promise<SyncAction[]> {
  try {
    const raw = await AsyncStorage.getItem(await userScopedKey(OFFLINE_QUEUE_KEY));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveOfflineQueue(queue: SyncAction[]): Promise<void> {
  await AsyncStorage.setItem(await userScopedKey(OFFLINE_QUEUE_KEY), JSON.stringify(queue));
}

async function addToOfflineQueue(action: SyncAction): Promise<void> {
  const queue = await getOfflineQueue();
  queue.push(action);
  await saveOfflineQueue(queue);
}

async function clearOfflineQueue(): Promise<void> {
  await AsyncStorage.removeItem(await userScopedKey(OFFLINE_QUEUE_KEY));
}

export async function saveLastSyncTime(): Promise<void> {
  await AsyncStorage.setItem(await userScopedKey(LAST_SYNC_KEY), new Date().toISOString());
}

export async function getLastSyncTime(): Promise<string | null> {
  return AsyncStorage.getItem(await userScopedKey(LAST_SYNC_KEY));
}

export async function hasPendingData(): Promise<boolean> {
  const pending = await getPendingSyncData();
  const queue = await getOfflineQueue();
  let natPending = false;
  try {
    const getAllFn = (LS as any).getAllNaturalDayDiets;
    if (typeof getAllFn === "function") {
      const allNat: any[] = (await getAllFn()) || [];
      natPending = allNat.some((x: any) => x.syncStatus !== "synced");
    }
  } catch {}
  return pending.jornadas.length > 0 || pending.compensaciones.length > 0 || pending.dayExtraEntries.length > 0 || queue.length > 0 || natPending;
}

export async function isNewDevice(): Promise<boolean> {
  const deviceId = await AsyncStorage.getItem(await userScopedKey(DEVICE_ID_KEY));
  if (!deviceId) {
    const newId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    await AsyncStorage.setItem(await userScopedKey(DEVICE_ID_KEY), newId);
    return true;
  }
  return false;
}

export async function getDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_ID_GLOBAL_KEY);
  if (existing) return existing;
  const newId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  await AsyncStorage.setItem(DEVICE_ID_GLOBAL_KEY, newId);
  return newId;
}

export async function hasLocalData(): Promise<boolean> {
  const jRaw = await AsyncStorage.getItem(await userScopedKey("tacoplan_jornadas"));
  if (jRaw) {
    const parsed = JSON.parse(jRaw);
    if (parsed.length > 0) return true;
  }
  const onboardingRaw = await AsyncStorage.getItem(await userScopedKey("tacoplan_onboarding_completed"));
  if (onboardingRaw) {
    try {
      const parsed = JSON.parse(onboardingRaw);
      if (parsed?.completed === true) return true;
    } catch {
      return true;
    }
  }
  const settingsRaw = await AsyncStorage.getItem(await userScopedKey("tacoplan_user_settings"));
  if (settingsRaw) {
    try {
      const parsed = JSON.parse(settingsRaw);
      const num = (k: string) => {
        const v = parsed?.[k];
        const n = parseFloat(String(v ?? "").replace(",", "."));
        return Number.isFinite(n) ? n : 0;
      };
      const anyNonZero = [
        "nac_100",
        "nac_60",
        "nac_30",
        "intl_100",
        "intl_60",
        "intl_30",
        "reg_100",
        "reg_60",
        "reg_30",
        "extra_saturday",
        "extra_sunday",
        "extra_holiday",
        "offsite_weekly_reduced_nacional",
        "offsite_weekly_reduced_internacional",
        "offsite_weekly_complete_nacional",
        "offsite_weekly_complete_internacional",
        "price_per_km",
        "price_per_km_nacional",
        "price_per_km_internacional",
        "price_per_km_regional",
        "price_per_trip",
        "price_per_trip_nacional",
        "price_per_trip_internacional",
        "price_per_trip_regional",
      ].some((k) => num(k) !== 0);
      if (anyNonZero) return true;

      const paymentMode = String(parsed?.payment_mode || "");
      if (paymentMode && paymentMode !== "dietas") return true;

      if (parsed?.driver_profile || parsed?.operation_zone) return true;
      const tt = parsed?.trip_types;
      if (tt && typeof tt === "object") {
        const vals = Object.values(tt as any);
        if (vals.some(Boolean)) return true;
      }
    } catch {
      return true;
    }
  }
  return false;
}

export async function checkCloudHasAnyUserData(getAccessToken: () => Promise<string | null>): Promise<{
  hasConfig: boolean;
  hasHistory: boolean;
}> {
  void getAccessToken;
  try {
    const auth = await getAuthenticatedUserOrThrow();
    const userId = auth.user.id;

    const [profileRes, jornadaRes, compRes, ratesRes, extrasRes, holidaysRes, dayExtraRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle(),
      supabase.from("jornadas").select("id").eq("user_id", userId).limit(1),
      supabase.from("compensaciones").select("id").eq("user_id", userId).limit(1),
      supabase.from("user_diet_rates").select("user_id").eq("user_id", userId).limit(1),
      supabase.from("user_day_extras").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("user_holidays").select("id").eq("user_id", userId).limit(1),
      supabase.from("user_day_extra_entries").select("id").eq("user_id", userId).limit(1),
    ]);

    const profile = profileRes.error ? null : profileRes.data;
    const hasHistory = (jornadaRes.data?.length ?? 0) > 0 || (compRes.data?.length ?? 0) > 0 || (dayExtraRes.data?.length ?? 0) > 0;
    const hasRates = (ratesRes.data?.length ?? 0) > 0;
    const hasHolidays = (holidaysRes.data?.length ?? 0) > 0;

    const extras = extrasRes.error ? null : extrasRes.data;
    const extrasHasNonZero =
      extras != null &&
      (Number(extras.extra_saturday || 0) !== 0 ||
        Number(extras.extra_sunday || 0) !== 0 ||
        Number(extras.extra_holiday || 0) !== 0 ||
        Number((extras as any).offsite_weekly_reduced_nacional || 0) !== 0 ||
        Number((extras as any).offsite_weekly_reduced_internacional || 0) !== 0 ||
        Number((extras as any).offsite_weekly_complete_nacional || 0) !== 0 ||
        Number((extras as any).offsite_weekly_complete_internacional || 0) !== 0);

    const profileHasNonDefault =
      profile != null &&
      (((profile as any).onboarding_completed === true) ||
        (String((profile as any).payment_mode || "") !== "" && String((profile as any).payment_mode || "") !== "dietas") ||
        Number((profile as any).price_per_km || 0) !== 0 ||
        Number((profile as any).price_per_km_nacional || 0) !== 0 ||
        Number((profile as any).price_per_km_internacional || 0) !== 0 ||
        Number((profile as any).price_per_km_regional || 0) !== 0 ||
        Number((profile as any).price_per_trip || 0) !== 0 ||
        Number((profile as any).price_per_trip_nacional || 0) !== 0 ||
        Number((profile as any).price_per_trip_internacional || 0) !== 0 ||
        Number((profile as any).price_per_trip_regional || 0) !== 0);

    const hasConfig = hasRates || extrasHasNonZero || hasHolidays || profileHasNonDefault;
    return { hasConfig, hasHistory };
  } catch {
    return { hasConfig: false, hasHistory: false };
  }
}

export async function shouldOfferCloudRestorePrompt(getAccessToken: () => Promise<string | null>): Promise<{
  shouldShow: boolean;
  reason: "no_profile" | "onboarding_not_completed" | "same_device" | "created_device_missing" | "no_cloud_data" | "ok";
}> {
  void getAccessToken;
  try {
    const auth = await getAuthenticatedUserOrThrow();
    const userId = auth.user.id;
    const deviceId = await getDeviceId();

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!profile) return { shouldShow: false, reason: "no_profile" };

    const cloud = await checkCloudHasAnyUserData(getAccessToken);
    if (!cloud.hasConfig && !cloud.hasHistory) {
      return { shouldShow: false, reason: "no_cloud_data" };
    }

    let completed = (profile as any).onboarding_completed === true;
    if (!completed) {
      try {
        await supabase
          .from("profiles")
          .update({ onboarding_completed: true, updated_at: new Date().toISOString() } as any)
          .eq("id", userId);
        completed = true;
      } catch {}
    }
    if (!completed) return { shouldShow: false, reason: "onboarding_not_completed" };

    const createdDeviceId = ((profile as any).created_device_id as string | null) ?? null;
    if (!createdDeviceId) {
      return { shouldShow: true, reason: "created_device_missing" };
    }

    if (createdDeviceId === deviceId) return { shouldShow: false, reason: "same_device" };
    return { shouldShow: true, reason: "ok" };
  } catch {
    return { shouldShow: false, reason: "no_profile" };
  }
}

export async function checkCloudDataCount(getAccessToken: () => Promise<string | null>): Promise<{ jornadas: number; compensaciones: number }> {
  try {
    const auth = await getAuthenticatedUserOrThrow();
    const cloud = await pullCloudAll(auth.user);
    return {
      jornadas: (cloud.jornadas || []).length,
      compensaciones: (cloud.compensaciones || []).length,
    };
  } catch {
    return { jornadas: 0, compensaciones: 0 };
  }
}

async function applyDietasConfigLocally(dietasConfig: any): Promise<void> {
  if (!dietasConfig) return;

  const { rates, extras, holidays } = dietasConfig;

  const settingsRaw = await AsyncStorage.getItem(await userScopedKey("tacoplan_user_settings"));
  const settings = settingsRaw ? JSON.parse(settingsRaw) : {};
  let changed = false;
  let maxCloudUpdatedAt: string | null = null;
  const maxIso = (a: any, b: any): string | null => {
    const as = typeof a === "string" ? a : null;
    const bs = typeof b === "string" ? b : null;
    if (!as && !bs) return null;
    if (!as) return bs;
    if (!bs) return as;
    return as > bs ? as : bs;
  };

  if (rates && rates.length > 0) {
    const sr = (type: string, pct: number, fb: string) => {
      const r = rates.find((r: any) => r.trip_type === type && r.percent === pct);
      return r != null ? String(r.amount) : fb;
    };
    settings.nac_100 = sr("NACIONAL", 100, settings.nac_100 ?? "0");
    settings.nac_60 = sr("NACIONAL", 60, settings.nac_60 ?? "0");
    settings.nac_30 = sr("NACIONAL", 30, settings.nac_30 ?? "0");
    settings.intl_100 = sr("INTERNACIONAL", 100, settings.intl_100 ?? "0");
    settings.intl_60 = sr("INTERNACIONAL", 60, settings.intl_60 ?? "0");
    settings.intl_30 = sr("INTERNACIONAL", 30, settings.intl_30 ?? "0");
    settings.reg_100 = sr("REGIONAL", 100, settings.reg_100 ?? "0");
    settings.reg_60 = sr("REGIONAL", 60, settings.reg_60 ?? "0");
    settings.reg_30 = sr("REGIONAL", 30, settings.reg_30 ?? "0");
    for (const r of rates) {
      maxCloudUpdatedAt = maxIso(maxCloudUpdatedAt, r?.updated_at);
    }
    changed = true;
  }

  if (extras) {
    settings.extra_saturday = String(extras.extra_saturday ?? settings.extra_saturday ?? "0");
    settings.extra_sunday = String(extras.extra_sunday ?? settings.extra_sunday ?? "0");
    settings.extra_holiday = String(extras.extra_holiday ?? settings.extra_holiday ?? "0");
    if (extras.offsite_weekly_reduced_nacional != null) settings.offsite_weekly_reduced_nacional = String(extras.offsite_weekly_reduced_nacional);
    if (extras.offsite_weekly_reduced_internacional != null) settings.offsite_weekly_reduced_internacional = String(extras.offsite_weekly_reduced_internacional);
    if (extras.offsite_weekly_complete_nacional != null) settings.offsite_weekly_complete_nacional = String(extras.offsite_weekly_complete_nacional);
    if (extras.offsite_weekly_complete_internacional != null) settings.offsite_weekly_complete_internacional = String(extras.offsite_weekly_complete_internacional);
    maxCloudUpdatedAt = maxIso(maxCloudUpdatedAt, extras?.updated_at);
    changed = true;
  }

  const nextUpdatedAt = maxIso(settings?._updated_at, maxCloudUpdatedAt);
  if (nextUpdatedAt && nextUpdatedAt !== settings?._updated_at) {
    settings._updated_at = nextUpdatedAt;
    changed = true;
  }

  if (changed) {
    await AsyncStorage.setItem(await userScopedKey("tacoplan_user_settings"), JSON.stringify(settings));
  }

  if (holidays) {
    await AsyncStorage.setItem(await userScopedKey("tacoplan_user_holidays_cache"), JSON.stringify(holidays));
  }
}

async function applyProfileLocally(profile: any): Promise<void> {
  if (!profile) return;

  const maxIso = (a: any, b: any): string | null => {
    const as = typeof a === "string" ? a : null;
    const bs = typeof b === "string" ? b : null;
    if (!as && !bs) return null;
    if (!as) return bs;
    if (!bs) return as;
    return as > bs ? as : bs;
  };

  if (profile.updated_at) {
    const settingsRaw = await AsyncStorage.getItem(await userScopedKey("tacoplan_user_settings"));
    const settings = settingsRaw ? JSON.parse(settingsRaw) : {};
    const nextUpdatedAt = maxIso(settings?._updated_at, profile.updated_at);
    if (nextUpdatedAt && nextUpdatedAt !== settings?._updated_at) {
      settings._updated_at = nextUpdatedAt;
      await AsyncStorage.setItem(await userScopedKey("tacoplan_user_settings"), JSON.stringify(settings));
    }
  }

  if (profile.display_name) {
    const settingsRaw = await AsyncStorage.getItem(await userScopedKey("tacoplan_user_settings"));
    const settings = settingsRaw ? JSON.parse(settingsRaw) : {};
    settings.driver_name = profile.display_name;
    await AsyncStorage.setItem(await userScopedKey("tacoplan_user_settings"), JSON.stringify(settings));
  }

  if (profile.driver_profile || profile.operation_zone || profile.trip_types) {
    const settingsRaw = await AsyncStorage.getItem(await userScopedKey("tacoplan_user_settings"));
    const settings = settingsRaw ? JSON.parse(settingsRaw) : {};
    if (profile.driver_profile) settings.driver_profile = profile.driver_profile;
    if (profile.operation_zone) settings.operation_zone = profile.operation_zone;
    if (profile.trip_types) settings.trip_types = profile.trip_types;
    await AsyncStorage.setItem(await userScopedKey("tacoplan_user_settings"), JSON.stringify(settings));
  }

  if (
    profile.payment_mode ||
    profile.price_per_km != null ||
    profile.price_per_trip != null ||
    profile.price_per_trip_nacional != null ||
    profile.price_per_trip_internacional != null ||
    profile.price_per_trip_regional != null ||
    profile.price_per_km_nacional != null ||
    profile.price_per_km_internacional != null ||
    profile.price_per_km_regional != null
  ) {
    const settingsRaw = await AsyncStorage.getItem(await userScopedKey("tacoplan_user_settings"));
    const settings = settingsRaw ? JSON.parse(settingsRaw) : {};
    if (profile.payment_mode) settings.payment_mode = profile.payment_mode;
    if (profile.price_per_km != null) settings.price_per_km = String(profile.price_per_km);
    if (profile.price_per_km_nacional != null) settings.price_per_km_nacional = String(profile.price_per_km_nacional);
    if (profile.price_per_km_internacional != null) settings.price_per_km_internacional = String(profile.price_per_km_internacional);
    if (profile.price_per_km_regional != null) settings.price_per_km_regional = String(profile.price_per_km_regional);
    if (profile.price_per_trip != null) settings.price_per_trip = String(profile.price_per_trip);
    if (profile.price_per_trip_nacional != null) settings.price_per_trip_nacional = String(profile.price_per_trip_nacional);
    if (profile.price_per_trip_internacional != null) settings.price_per_trip_internacional = String(profile.price_per_trip_internacional);
    if (profile.price_per_trip_regional != null) settings.price_per_trip_regional = String(profile.price_per_trip_regional);
    if (profile.price_per_trip_nacional != null) settings.price_per_trip_nacional = String(profile.price_per_trip_nacional);
    if (profile.price_per_trip_internacional != null) settings.price_per_trip_internacional = String(profile.price_per_trip_internacional);
    if (profile.price_per_trip_regional != null) settings.price_per_trip_regional = String(profile.price_per_trip_regional);
    await AsyncStorage.setItem(await userScopedKey("tacoplan_user_settings"), JSON.stringify(settings));
  }

  if (profile.language) {
    await AsyncStorage.setItem("tacoplan_language", profile.language);
  }

  if (profile.period_type) {
    const periodRaw = await AsyncStorage.getItem(await userScopedKey("tacoplan_period_config"));
    const period = periodRaw ? JSON.parse(periodRaw) : {};
    const mode = String(profile.period_type);
    if (mode === "AUTO_01_30" || mode === "AUTO_20_20" || mode === "AUTO_MONTH" || mode === "MANUAL") {
      period.mode = mode;
      if (mode === "AUTO_20_20") {
        period.manualFrom = 21;
        period.manualTo = 20;
      } else if (mode === "MANUAL") {
        period.manualFrom = Number(profile.period_start_day) || period.manualFrom || 1;
        period.manualTo = Number(profile.period_end_day) || period.manualTo || 30;
      } else if (mode === "AUTO_MONTH") {
        period.manualFrom = 1;
        period.manualTo = 31;
      } else {
        period.manualFrom = 1;
        period.manualTo = 30;
      }
    }
    await AsyncStorage.setItem(await userScopedKey("tacoplan_period_config"), JSON.stringify(period));
  }
}

async function applyFerryConfigLocally(ferryConfig: any): Promise<void> {
  if (!ferryConfig) return;
  const raw = await AsyncStorage.getItem(await userScopedKey("tacoplan_ferry_config"));
  const existing = raw ? JSON.parse(raw) : {};
  const maxIso = (a: any, b: any): string | null => {
    const as = typeof a === "string" ? a : null;
    const bs = typeof b === "string" ? b : null;
    if (!as && !bs) return null;
    if (!as) return bs;
    if (!bs) return as;
    return as > bs ? as : bs;
  };
  const next = {
    ...existing,
    crossesFerry: ferryConfig.crosses_ferry != null ? !!ferryConfig.crosses_ferry : existing.crossesFerry ?? false,
    routeMode: ferryConfig.route_mode ?? existing.routeMode ?? "spain",
    paymentMode: ferryConfig.payment_mode ?? existing.paymentMode ?? "spain_diet",
    tripRate: ferryConfig.trip_rate != null ? Number(ferryConfig.trip_rate) : existing.tripRate ?? 0,
    pernightRate: ferryConfig.pernight_rate != null ? Number(ferryConfig.pernight_rate) : existing.pernightRate ?? 0,
    ferryRestEnabled: ferryConfig.ferry_rest_enabled != null ? !!ferryConfig.ferry_rest_enabled : existing.ferryRestEnabled ?? false,
    ferryTransitRate: ferryConfig.ferry_transit_rate != null ? Number(ferryConfig.ferry_transit_rate) : existing.ferryTransitRate ?? 54.3,
    ferryCabinRate: ferryConfig.ferry_cabin_rate != null ? Number(ferryConfig.ferry_cabin_rate) : existing.ferryCabinRate ?? 54.3,
    _updated_at: maxIso(existing?._updated_at, ferryConfig?.updated_at),
  };
  await AsyncStorage.setItem(await userScopedKey("tacoplan_ferry_config"), JSON.stringify(next));
}

async function getAuthenticatedUserOrThrow(): Promise<{ user: User; accessToken: string }> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) throw sessionError;
  if (!session?.user) throw new Error("No hay usuario autenticado");

  const nowSec = Math.floor(Date.now() / 1000);
  const exp = (session as any).expires_at ?? nowSec;
  let finalSession: any = session;
  if (exp <= nowSec + 60) {
    const { data, error } = await supabase.auth.refreshSession();
    if (error) throw error;
    if (data.session) finalSession = data.session;
  }

  if (!finalSession?.access_token) throw new Error("No hay access_token");

  return { user: finalSession.user, accessToken: finalSession.access_token };
}

async function ensureDietasConfigRow(user: User): Promise<void> {
  const { data, error } = await supabase
    .from("dietas_config")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    const { error: insertError } = await supabase
      .from("dietas_config")
      .insert({
        user_id: user.id,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) throw insertError;
  }
}

async function ensureProfileRow(user: User): Promise<void> {
  const { data: profileData, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) throw profileError;

  if (!profileData) {
    const { error: insertProfileError } = await supabase
      .from("profiles")
      .insert({
        id: user.id,
        email: user.email ?? "",
        display_name: (user.user_metadata as any)?.full_name ?? "",
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertProfileError) throw insertProfileError;
  }

  try {
    const deviceId = await getDeviceId();
    const createdDeviceId = (profileData as any)?.created_device_id ?? null;
    const hasData = await hasLocalData().catch(() => false);
    const payload: Record<string, any> = {
      last_login_device_id: deviceId,
      last_login_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (!createdDeviceId && hasData) payload.created_device_id = deviceId;
    await supabase.from("profiles").update(payload as any).eq("id", user.id);
  } catch {}
}

async function collectLocalSettings(): Promise<{ profile: any; dietasRates: any[]; extras: any; updatedAt: string | null } | null> {
  try {
    const settingsRaw = await AsyncStorage.getItem(await userScopedKey("tacoplan_user_settings"));
    const periodRaw = await AsyncStorage.getItem(await userScopedKey("tacoplan_period_config"));
    const langRaw = await AsyncStorage.getItem("tacoplan_language");

    const settings = settingsRaw ? JSON.parse(settingsRaw) : {};
    const period = periodRaw ? JSON.parse(periodRaw) : {};
    const fallbackKm = Number.isFinite(parseFloat(settings.price_per_km)) ? parseFloat(settings.price_per_km) : 0;

    const periodMode =
      period.mode === "AUTO_01_30" || period.mode === "AUTO_20_20" || period.mode === "AUTO_MONTH" || period.mode === "MANUAL"
        ? period.mode
        : "AUTO_01_30";
    const periodStartDay = periodMode === "AUTO_20_20" ? 21 : periodMode === "MANUAL" ? (Number(period.manualFrom) || 1) : 1;
    const periodEndDay =
      periodMode === "AUTO_20_20" ? 20 : periodMode === "MANUAL" ? (Number(period.manualTo) || 30) : periodMode === "AUTO_MONTH" ? 31 : 30;

    const maxIso = (a: any, b: any): string | null => {
      const as = typeof a === "string" ? a : null;
      const bs = typeof b === "string" ? b : null;
      if (!as && !bs) return null;
      if (!as) return bs;
      if (!bs) return as;
      return as > bs ? as : bs;
    };
    const updatedAt = maxIso(settings?._updated_at, period?._updated_at);

    const profile = {
      display_name: settings.driver_name || null,
      driver_profile: settings.driver_profile || null,
      operation_zone: settings.operation_zone || null,
      trip_types: settings.trip_types || null,
      language: langRaw || "es",
      period_type: periodMode,
      period_start_day: periodStartDay,
      period_end_day: periodEndDay,
      payment_mode: settings.payment_mode || "dietas",
      price_per_km: fallbackKm,
      price_per_km_nacional: Number.isFinite(parseFloat(settings.price_per_km_nacional)) ? parseFloat(settings.price_per_km_nacional) : fallbackKm,
      price_per_km_internacional: Number.isFinite(parseFloat(settings.price_per_km_internacional)) ? parseFloat(settings.price_per_km_internacional) : fallbackKm,
      price_per_km_regional: Number.isFinite(parseFloat(settings.price_per_km_regional)) ? parseFloat(settings.price_per_km_regional) : fallbackKm,
      price_per_trip: Number.isFinite(parseFloat(settings.price_per_trip)) ? parseFloat(settings.price_per_trip) : 0,
      price_per_trip_nacional: Number.isFinite(parseFloat(settings.price_per_trip_nacional)) ? parseFloat(settings.price_per_trip_nacional) : (Number.isFinite(parseFloat(settings.price_per_trip)) ? parseFloat(settings.price_per_trip) : 0),
      price_per_trip_internacional: Number.isFinite(parseFloat(settings.price_per_trip_internacional)) ? parseFloat(settings.price_per_trip_internacional) : (Number.isFinite(parseFloat(settings.price_per_trip)) ? parseFloat(settings.price_per_trip) : 0),
      price_per_trip_regional: Number.isFinite(parseFloat(settings.price_per_trip_regional)) ? parseFloat(settings.price_per_trip_regional) : (Number.isFinite(parseFloat(settings.price_per_trip)) ? parseFloat(settings.price_per_trip) : 0),
      base_name: String(settings.base_name || "").trim() || null,
      base_city: String(settings.base_city || "").trim() || null,
      base_country: String(settings.base_country || "").trim() || null,
      base_address: String(settings.base_address || "").trim() || null,
      base_latitude: Number.isFinite(parseFloat(settings.base_latitude)) ? parseFloat(settings.base_latitude) : null,
      base_longitude: Number.isFinite(parseFloat(settings.base_longitude)) ? parseFloat(settings.base_longitude) : null,
      base_radius_km: Number.isFinite(parseFloat(settings.base_radius_km)) ? parseFloat(settings.base_radius_km) : 20,
      base_configured_at: settings.base_configured_at || null,
      base_updated_at: settings.base_updated_at || null,
    };

    const rates: any[] = [];
    const addRate = (type: string, pct: number, key: string, def: string) => {
      const val = parseFloat(settings[key] ?? def);
      if (!isNaN(val)) rates.push({ trip_type: type, percent: pct, amount: val });
    };
    addRate("NACIONAL", 100, "nac_100", "0");
    addRate("NACIONAL", 60, "nac_60", "0");
    addRate("NACIONAL", 30, "nac_30", "0");
    addRate("INTERNACIONAL", 100, "intl_100", "0");
    addRate("INTERNACIONAL", 60, "intl_60", "0");
    addRate("INTERNACIONAL", 30, "intl_30", "0");

    const extras = {
      extra_saturday: parseFloat(settings.extra_saturday ?? "0"),
      extra_sunday: parseFloat(settings.extra_sunday ?? "0"),
      extra_holiday: parseFloat(settings.extra_holiday ?? "0"),
      offsite_weekly_reduced_nacional: parseFloat(settings.offsite_weekly_reduced_nacional ?? "0"),
      offsite_weekly_reduced_internacional: parseFloat(settings.offsite_weekly_reduced_internacional ?? "0"),
      offsite_weekly_complete_nacional: parseFloat(settings.offsite_weekly_complete_nacional ?? "0"),
      offsite_weekly_complete_internacional: parseFloat(settings.offsite_weekly_complete_internacional ?? "0"),
    };

    return { profile, dietasRates: rates, extras, updatedAt };
  } catch {
    return null;
  }
}

export async function syncAll(
  getAccessToken: () => Promise<string | null>,
): Promise<SyncResult> {
  void getAccessToken;
  (syncAll as any).__dayExtraPushOk = true;
  let authUser: User | null = null;
  try {
    const auth = await getAuthenticatedUserOrThrow();
    authUser = auth.user;
    await ensureProfileRow(auth.user);
    await ensureDietasConfigRow(auth.user);
  } catch (e: any) {
    console.log("SYNC ERROR:", e);
    return { success: false, message: e?.message || String(e) };
  }

  if (!authUser) return { success: false, message: "No autenticado" };

  const PG_INT4_MAX = 2147483647;
  const clampInt4 = (v: unknown, fallback = 0, max = PG_INT4_MAX): number => {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(max, Math.floor(n)));
  };

  let pushed = 0;
  let pulled = 0;
  let merged = 0;

  try {
    const pending = await getPendingSyncData();
    let hasNatPending = false;
    try {
      const getAllFn = (LS as any).getAllNaturalDayDiets;
      if (typeof getAllFn === "function") {
        const allNat: any[] = (await getAllFn()) || [];
        hasNatPending = allNat.some((x: any) => x.syncStatus !== "synced");
      }
    } catch {}
    const hasPendingLocal =
      pending.jornadas.length > 0 ||
      pending.compensaciones.length > 0 ||
      pending.dayExtraEntries.length > 0 ||
      hasNatPending;

    if (hasPendingLocal) {
      console.log("[SYNC] pushing pending to Supabase", {
        jornadas: pending.jornadas.length,
        compensaciones: pending.compensaciones.length,
        dayExtraEntries: pending.dayExtraEntries.length,
        naturalDayDietsPending: hasNatPending,
      });

      const jornadasCols = await getColumnSet("jornadas");
      for (const j of pending.jornadas) {
        const baseRow: Record<string, any> = {
          id: j.id,
          user_id: authUser.id,
          fecha_inicio: j.fechaInicio,
          hora_inicio: j.horaInicio,
          lugar_inicio: normalizeLocationText(j.lugarInicio || ""),
          fecha_fin: j.fechaFin,
          hora_fin: j.horaFin,
          lugar_fin: j.lugarFin ? normalizeLocationText(j.lugarFin) : null,
          start_at: j.startAt,
          end_at: j.endAt,
          conduccion_min: j.conduccionMin == null ? null : clampInt4(j.conduccionMin, 0, 60 * 24 * 7),
          tipo_ruta: j.tipoRuta,
          pernocta: j.pernocta,
          dieta_modo: j.dietaModo,
          dieta_manual_tipo: j.dietaManualTipo,
          dieta_manual_pct: j.dietaManualPct,
          dieta_importe_eur: j.dietaImporteEur,
          dietas_items: j.dietasItems,
          dieta_percent: j.dietaPercent,
          day_flag: j.dayFlag,
          day_extra_eur: j.dayExtraEur,
          descanso_anterior_min: j.descansoAnteriorMin == null ? null : clampInt4(j.descansoAnteriorMin, 0, 60 * 24 * 7),
          tipo_descanso_anterior: j.tipoDescansoAnterior,
          duracion_jornada_min: j.duracionJornadaMin == null ? null : clampInt4(j.duracionJornadaMin, 0, 60 * 24 * 7),
          updated_at: j.updatedAt,
        };

        const optionalFields: Record<string, any> = {
          conduccion_domingo_min: j.conduccionDomingoMin == null ? null : clampInt4(j.conduccionDomingoMin, 0, 60 * 24 * 7),
          conduccion_lunes_min: j.conduccionLunesMin == null ? null : clampInt4(j.conduccionLunesMin, 0, 60 * 24 * 7),
          diet_base_eur: j.dietBaseEur || null,
          diet_rule: j.dietRule || null,
          diet_calculated_at: j.dietCalculatedAt || null,
          counts_as_daily_reduced: j.countsAsDailyReduced || false,
          plus_items: j.plusItems || null,
          planned_rest_min: j.plannedRestMin == null ? null : clampInt4(j.plannedRestMin, 0, 60 * 24 * 14),
          planned_rest_type: j.plannedRestType || null,
          legal_summary: j.legalSummary || null,
          observaciones: j.observaciones || null,
          previous_rest_source: j.previousRestSource || null,
          previous_rest_id: j.previousRestId || null,
          previous_rest_valid: j.previousRestValid ?? null,
          previous_rest_start_at: j.previousRestStartAt ?? null,
          previous_rest_end_at: j.previousRestEndAt ?? null,
          previous_rest_legal_type: j.previousRestLegalType ?? null,
          previous_rest_start_location: j.previousRestStartLocation ?? null,
          previous_rest_end_location: j.previousRestEndLocation ?? null,
          previous_rest_in_base: j.previousRestInBase ?? null,
          previous_rest_distance_km: j.previousRestDistanceKm ?? null,
          previous_rest_performed_in_vehicle: j.previousRestPerformedInVehicle ?? null,
          previous_rest_accommodation: j.previousRestAccommodation ?? null,
          previous_rest_comp_generated_min: j.previousRestCompGeneratedMin == null ? null : clampInt4(j.previousRestCompGeneratedMin, 0, 60 * 24 * 14),
          previous_rest_comp_used_min: j.previousRestCompUsedMin == null ? null : clampInt4(j.previousRestCompUsedMin, 0, 60 * 24 * 14),
          previous_rest_observations: j.previousRestObservations ?? null,
          morocco_payment_mode: j.moroccoPaymentMode || null,
          morocco_trip_rate: j.moroccoTripRate ?? null,
          morocco_pernight_rate: j.moroccoPernightRate ?? null,
          ferry_pending: j.ferryPending ?? false,
          ferry_rest_type: j.ferryRestType || null,
          ferry_destination: j.ferryDestination || null,
          ferry_extras: j.ferryExtras || null,
          ferry_interruptions: j.ferryInterruptions || null,
          ferry_rest_completed: j.ferryRestCompleted ?? false,
        };

        const row: Record<string, any> = { ...baseRow, ...optionalFields };
        if (jornadasCols.has("split_rest_detected")) row.split_rest_detected = j.splitRestDetected ?? false;
        if (jornadasCols.has("split_rest_first_part_min")) row.split_rest_first_part_min = j.splitRestFirstPartMin == null ? null : clampInt4(j.splitRestFirstPartMin, 0, 60 * 24 * 7);
        if (jornadasCols.has("split_rest_second_part_min")) row.split_rest_second_part_min = j.splitRestSecondPartMin == null ? null : clampInt4(j.splitRestSecondPartMin, 0, 60 * 24 * 7);
        if (jornadasCols.has("counts_as_reduced_rest")) row.counts_as_reduced_rest = j.countsAsReducedRest ?? true;
        if (jornadasCols.has("payment_mode")) row.payment_mode = j.paymentMode ?? null;
        if (jornadasCols.has("km_inicio")) row.km_inicio = j.kmInicio ?? null;
        if (jornadasCols.has("km_fin")) row.km_fin = j.kmFin ?? null;
        if (jornadasCols.has("km_total")) row.km_total = j.kmTotal ?? null;
        if (jornadasCols.has("price_per_km")) row.price_per_km = j.pricePerKm ?? null;
        if (jornadasCols.has("importe_km")) row.importe_km = j.importeKm ?? null;
        if (jornadasCols.has("price_per_trip")) row.price_per_trip = j.pricePerTrip ?? null;
        if (jornadasCols.has("importe_viaje")) row.importe_viaje = j.importeViaje ?? null;
        if (jornadasCols.has("report_hide_amounts")) row.report_hide_amounts = j.reportHideAmounts ?? false;
        if (jornadasCols.has("report_hide_pluses")) row.report_hide_pluses = j.reportHidePluses ?? false;
        if (jornadasCols.has("tacho_daily_summary_id")) row.tacho_daily_summary_id = j.tachoDailySummaryId ?? null;
        if (jornadasCols.has("tacho_driving_min")) row.tacho_driving_min = j.tachoDrivingMin == null ? null : clampInt4(j.tachoDrivingMin, 0, 60 * 24 * 7);
        if (jornadasCols.has("tacho_work_min")) row.tacho_work_min = j.tachoWorkMin == null ? null : clampInt4(j.tachoWorkMin, 0, 60 * 24 * 7);
        if (jornadasCols.has("tacho_available_min")) row.tacho_available_min = j.tachoAvailableMin == null ? null : clampInt4(j.tachoAvailableMin, 0, 60 * 24 * 14);
        if (jornadasCols.has("tacho_rest_min")) row.tacho_rest_min = j.tachoRestMin == null ? null : clampInt4(j.tachoRestMin, 0, 60 * 24 * 14);
        if (jornadasCols.has("tacho_countries")) row.tacho_countries = Array.isArray(j.tachoCountries) ? j.tachoCountries : [];
        if (jornadasCols.has("tacho_country_entries")) row.tacho_country_entries = clampInt4(j.tachoCountryEntries, 0, 9999);
        if (jornadasCols.has("tacho_km_total")) row.tacho_km_total = j.tachoKmTotal ?? null;
        if (jornadasCols.has("tacho_first_activity_at")) row.tacho_first_activity_at = j.tachoFirstActivityAt ?? null;
        if (jornadasCols.has("tacho_last_activity_at")) row.tacho_last_activity_at = j.tachoLastActivityAt ?? null;
        if (jornadasCols.has("tacho_disconnections")) row.tacho_disconnections = clampInt4(j.tachoDisconnections, 0, 9999);
        if (jornadasCols.has("tacho_data_quality")) row.tacho_data_quality = j.tachoDataQuality ?? null;
        if (jornadasCols.has("is_double_driving")) row.is_double_driving = j.isDoubleDriving === true ? true : false;
        if (jornadasCols.has("second_driver_name")) row.second_driver_name = j.secondDriverName ?? null;
        // #region debug-point C:supabase-push
        reportJornadaDateDebug("C", "sync-service:syncAll:beforeUpsert", "sending jornada payload to Supabase", {
          jornadaId: j.id,
          local: {
            fechaInicio: j.fechaInicio,
            horaInicio: j.horaInicio,
            fechaFin: j.fechaFin,
            horaFin: j.horaFin,
            startAt: j.startAt,
            endAt: j.endAt,
            updatedAt: j.updatedAt,
          },
          payloadSupabase: row,
        });
        // #endregion
        const { error } = await supabase.from("jornadas").upsert(row, { onConflict: "id" });
        if (error) throw error;
        const storedRes = await supabase
          .from("jornadas")
          .select("id,fecha_inicio,hora_inicio,fecha_fin,hora_fin,start_at,end_at,updated_at")
          .eq("id", j.id)
          .maybeSingle();
        // #region debug-point C:supabase-stored
        reportJornadaDateDebug("C", "sync-service:syncAll:afterUpsert", "jornada stored in Supabase after upsert", {
          jornadaId: j.id,
          storedRow: storedRes.data
            ? {
                id: storedRes.data.id,
                fecha_inicio: storedRes.data.fecha_inicio,
                hora_inicio: storedRes.data.hora_inicio,
                fecha_fin: storedRes.data.fecha_fin,
                hora_fin: storedRes.data.hora_fin,
                start_at: storedRes.data.start_at,
                end_at: storedRes.data.end_at,
                updated_at: storedRes.data.updated_at,
              }
            : null,
          storedError: storedRes.error ? String(storedRes.error.message || storedRes.error) : null,
        });
        // #endregion
      }

      for (const c of pending.compensaciones) {
        const row = {
          id: c.id,
          user_id: authUser.id,
          jornada_id: c.jornadaId,
          horas_deuda: c.horasDeuda == null ? null : clampInt4(c.horasDeuda, 0, 48),
          minutos_deuda: c.minutosDeuda == null ? null : clampInt4(c.minutosDeuda, 0, 59),
          fecha_limite: c.fechaLimite,
          compensada: c.compensada,
          fecha_compensacion: c.fechaCompensacion,
          source_rest_start_at: c.sourceRestStartAt ?? null,
          source_rest_end_at: c.sourceRestEndAt ?? null,
          source_rest_duration_min: c.sourceRestDurationMin == null ? null : clampInt4(c.sourceRestDurationMin, 0, 60 * 24 * 14),
          source_rest_legal_type: c.sourceRestLegalType ?? null,
          source_rest_location_start: c.sourceRestLocationStart ?? null,
          source_rest_location_end: c.sourceRestLocationEnd ?? null,
          source_rest_in_base: c.sourceRestInBase ?? null,
          source_rest_distance_km: c.sourceRestDistanceKm ?? null,
          source_rest_observations: c.sourceRestObservations ?? null,
          recovered_in_jornada_id: c.recoveredInJornadaId ?? null,
          recovery_rest_start_at: c.recoveryRestStartAt ?? null,
          recovery_rest_end_at: c.recoveryRestEndAt ?? null,
          recovery_rest_duration_min: c.recoveryRestDurationMin == null ? null : clampInt4(c.recoveryRestDurationMin, 0, 60 * 24 * 14),
          updated_at: c.updatedAt,
        };
        const { error } = await supabase.from("compensaciones").upsert(row, { onConflict: "id" });
        if (error) throw error;
      }
      let dayExtraPushed = 0;
      let dayExtraPushOk = true;
      for (const e of pending.dayExtraEntries) {
        try {
          const rawAmount = (e as any).amount;
          const safeAmount =
            rawAmount == null
              ? null
              : (() => {
                  const n = Number(rawAmount);
                  return Number.isFinite(n) ? Math.max(0, Math.min(99999, +n.toFixed(2))) : null;
                })();
          const fullRow: Record<string, any> = {
            id: e.id,
            user_id: authUser.id,
            date: e.date,
            entry_type: (e as any).entryType ?? "day_extra",
            day_flag: (e as any).dayFlag ?? null,
            offsite_rest_type: (e as any).offsiteRestType ?? null,
            offsite_base: (e as any).offsiteBase ?? null,
            plus_sunday: (e as any).plusSunday ?? false,
            plus_holiday: (e as any).plusHoliday ?? false,
            location_start: (e as any).locationStart ?? null,
            location_end: (e as any).locationEnd ?? null,
            in_base: (e as any).inBase ?? null,
            distance_to_base_km: (e as any).distanceToBaseKm ?? null,
            amount: safeAmount,
            note: e.note,
            created_at: e.createdAt,
            updated_at: e.updatedAt,
          };
          const fullRes = await supabase.from("user_day_extra_entries").upsert(fullRow, { onConflict: "id" });
          if (fullRes.error) {
            const minimalRow: Record<string, any> = {
              id: e.id,
              user_id: authUser.id,
              date: e.date,
              amount: safeAmount,
              note: e.note,
              created_at: e.createdAt,
              updated_at: e.updatedAt,
            };
            const minRes = await supabase.from("user_day_extra_entries").upsert(minimalRow, { onConflict: "id" });
            if (minRes.error) throw minRes.error;
          }
          dayExtraPushed += 1;
        } catch (e) {
          console.error("SYNC ERROR: day extra entries upsert", e);
          dayExtraPushOk = false;
        }
      }

      let natPushed = 0;
      let natPushOk = true;
      try {
        const getAllFn = (LS as any).getAllNaturalDayDiets;
        if (typeof getAllFn === "function") {
          const allLocal: any[] = (await getAllFn()) || [];
          const pendingLocal = allLocal.filter((x: any) => x.syncStatus !== "synced");
          const nowIso = new Date().toISOString();
          let natCols: Set<string> = new Set();
          try {
            natCols = await getColumnSet("user_natural_day_diets");
          } catch {}
          for (const n of pendingLocal) {
            const row: Record<string, any> = {
              id: n.id,
              user_id: authUser.id,
              date: n.date,
              type: n.type,
              percentage: Number(n.percentage) || 100,
              amount: Number(n.amount) || 0,
              location: n.location ?? null,
              source: n.source || "NATURAL_DAY_OUT_OF_BASE",
              previous_journey_id: n.previousJourneyId ?? null,
              next_journey_id: n.nextJourneyId ?? null,
              confirmed_by_user: !!n.confirmedByUser,
              dismissed_at: n.dismissedAt ?? null,
              updated_at: n.updatedAt || nowIso,
            };
            if (natCols.has("pluses_json")) {
              if (Array.isArray(n.plusItems) && n.plusItems.length > 0) {
                try {
                  row.pluses_json = n.plusItems.map((p: any) => ({
                    concepto: String(p.concepto || "").trim().slice(0, 200),
                    amount: Math.max(0, Math.min(99999, +Number(p.amount || 0).toFixed(2))),
                    id: String(p.id || ""),
                  }));
                } catch {
                  row.pluses_json = null;
                }
              } else {
                row.pluses_json = null;
              }
            }
            if (natCols.has("is_domingo")) {
              row.is_domingo = typeof n.isDomingo === "boolean" ? n.isDomingo : false;
            }
            if (natCols.has("is_festivo")) {
              row.is_festivo = typeof n.isFestivo === "boolean" ? n.isFestivo : false;
            }
            const { error } = await supabase
              .from("user_natural_day_diets")
              .upsert(row, { onConflict: "user_id,date" });
            if (error) throw error;
            natPushed += 1;
          }
          if (natPushed > 0) {
            await LS.markNaturalDayDietsSynced(pendingLocal.map((p: any) => p.id));
          }
        }
      } catch (e) {
        console.error("SYNC ERROR: natural day diets upsert", e);
        natPushOk = false;
      }

      pushed = pending.jornadas.length + pending.compensaciones.length + dayExtraPushed + natPushed;
      (syncAll as any).__dayExtraPushOk = dayExtraPushOk;
      (syncAll as any).__natPushOk = natPushOk;
    }

    let profilePushOk = true;
    let dietasPushOk = true;
    const localSettings = await collectLocalSettings();
    if (localSettings) {
      const maxIso = (a: any, b: any): string | null => {
        const as = typeof a === "string" ? a : null;
        const bs = typeof b === "string" ? b : null;
        if (!as && !bs) return null;
        if (!as) return bs;
        if (!bs) return as;
        return as > bs ? as : bs;
      };
      const localUpdatedAt = localSettings.updatedAt;

      const profilesCols = await getColumnSet("profiles");
      try {
        let cloudProfileUpdatedAt: string | null = null;
        try {
          const r = await supabase.from("profiles").select("updated_at").eq("id", authUser.id).maybeSingle();
          cloudProfileUpdatedAt = r.error ? null : ((r.data as any)?.updated_at ?? null);
        } catch {
          cloudProfileUpdatedAt = null;
        }
        const shouldPushProfile = !cloudProfileUpdatedAt || (localUpdatedAt != null && localUpdatedAt > cloudProfileUpdatedAt);
        if (!shouldPushProfile) {
          throw new Error("skip_push_profile_newer_cloud");
        }

        const payload: Record<string, any> = {
          id: authUser.id,
          display_name: localSettings.profile.display_name ?? null,
          language: localSettings.profile.language ?? "es",
          period_type: localSettings.profile.period_type ?? "AUTO_01_30",
          period_start_day: localSettings.profile.period_start_day ?? 1,
          period_end_day: localSettings.profile.period_end_day ?? 30,
          updated_at: localUpdatedAt ?? new Date().toISOString(),
        };
        if (profilesCols.has("driver_profile")) payload.driver_profile = localSettings.profile.driver_profile ?? null;
        if (profilesCols.has("operation_zone")) payload.operation_zone = localSettings.profile.operation_zone ?? null;
        if (profilesCols.has("trip_types")) payload.trip_types = localSettings.profile.trip_types ?? null;
        if (profilesCols.has("payment_mode")) payload.payment_mode = localSettings.profile.payment_mode ?? "dietas";
        if (profilesCols.has("price_per_km")) payload.price_per_km = localSettings.profile.price_per_km ?? 0;
        if (profilesCols.has("price_per_km_nacional")) payload.price_per_km_nacional = localSettings.profile.price_per_km_nacional ?? (localSettings.profile.price_per_km ?? 0);
        if (profilesCols.has("price_per_km_internacional")) payload.price_per_km_internacional = localSettings.profile.price_per_km_internacional ?? (localSettings.profile.price_per_km ?? 0);
        if (profilesCols.has("price_per_km_regional")) payload.price_per_km_regional = localSettings.profile.price_per_km_regional ?? (localSettings.profile.price_per_km ?? 0);
        if (profilesCols.has("price_per_trip")) payload.price_per_trip = localSettings.profile.price_per_trip ?? 0;
        if (profilesCols.has("price_per_trip_nacional")) payload.price_per_trip_nacional = localSettings.profile.price_per_trip_nacional ?? (localSettings.profile.price_per_trip ?? 0);
        if (profilesCols.has("price_per_trip_internacional")) payload.price_per_trip_internacional = localSettings.profile.price_per_trip_internacional ?? (localSettings.profile.price_per_trip ?? 0);
        if (profilesCols.has("price_per_trip_regional")) payload.price_per_trip_regional = localSettings.profile.price_per_trip_regional ?? (localSettings.profile.price_per_trip ?? 0);
        if (profilesCols.has("base_name")) payload.base_name = localSettings.profile.base_name ?? null;
        if (profilesCols.has("base_city")) payload.base_city = localSettings.profile.base_city ?? null;
        if (profilesCols.has("base_country")) payload.base_country = localSettings.profile.base_country ?? null;
        if (profilesCols.has("base_address")) payload.base_address = localSettings.profile.base_address ?? null;
        if (profilesCols.has("base_latitude")) payload.base_latitude = localSettings.profile.base_latitude ?? null;
        if (profilesCols.has("base_longitude")) payload.base_longitude = localSettings.profile.base_longitude ?? null;
        if (profilesCols.has("base_radius_km")) payload.base_radius_km = localSettings.profile.base_radius_km ?? 20;
        if (profilesCols.has("base_configured_at")) payload.base_configured_at = localSettings.profile.base_configured_at ?? null;
        if (profilesCols.has("base_updated_at")) payload.base_updated_at = localSettings.profile.base_updated_at ?? null;
        const { error } = await supabase.from("profiles").upsert(payload, { onConflict: "id" });
        if (error) throw error;
      } catch (e: any) {
        if (String(e?.message || "").includes("skip_push_profile_newer_cloud")) {
          profilePushOk = true;
        } else {
          console.error("SYNC ERROR: profiles upsert", e);
          profilePushOk = false;
        }
      }
      try {
        let cloudDietRatesUpdatedAt: string | null = null;
        let cloudExtrasUpdatedAt: string | null = null;
        try {
          const r = await supabase
            .from("user_diet_rates")
            .select("updated_at")
            .eq("user_id", authUser.id)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          cloudDietRatesUpdatedAt = r.error ? null : ((r.data as any)?.updated_at ?? null);
        } catch {
          cloudDietRatesUpdatedAt = null;
        }
        try {
          const r = await supabase.from("user_day_extras").select("updated_at").eq("user_id", authUser.id).maybeSingle();
          cloudExtrasUpdatedAt = r.error ? null : ((r.data as any)?.updated_at ?? null);
        } catch {
          cloudExtrasUpdatedAt = null;
        }
        const cloudDietasUpdatedAt = maxIso(cloudDietRatesUpdatedAt, cloudExtrasUpdatedAt);
        const shouldPushDietas = !cloudDietasUpdatedAt || (localUpdatedAt != null && localUpdatedAt > cloudDietasUpdatedAt);
        if (!shouldPushDietas) {
          throw new Error("skip_push_dietas_newer_cloud");
        }

        if (localSettings.dietasRates.length > 0) {
          const rows = localSettings.dietasRates.map((r: any) => ({
            user_id: authUser.id,
            trip_type: r.trip_type,
            percent: r.percent,
            amount: r.amount,
            updated_at: localUpdatedAt ?? new Date().toISOString(),
          }));
          const { error } = await supabase.from("user_diet_rates").upsert(rows, { onConflict: "user_id,trip_type,percent" });
          if (error) throw error;
        }
        const extrasCols = await getColumnSet("user_day_extras");
        const extrasRow: Record<string, any> = {
          user_id: authUser.id,
          extra_saturday: localSettings.extras.extra_saturday ?? 0,
          extra_sunday: localSettings.extras.extra_sunday ?? 0,
          extra_holiday: localSettings.extras.extra_holiday ?? 0,
          updated_at: localUpdatedAt ?? new Date().toISOString(),
        };
        if (extrasCols.has("offsite_weekly_reduced_nacional")) extrasRow.offsite_weekly_reduced_nacional = localSettings.extras.offsite_weekly_reduced_nacional ?? 0;
        if (extrasCols.has("offsite_weekly_reduced_internacional")) extrasRow.offsite_weekly_reduced_internacional = localSettings.extras.offsite_weekly_reduced_internacional ?? 0;
        if (extrasCols.has("offsite_weekly_complete_nacional")) extrasRow.offsite_weekly_complete_nacional = localSettings.extras.offsite_weekly_complete_nacional ?? 0;
        if (extrasCols.has("offsite_weekly_complete_internacional")) extrasRow.offsite_weekly_complete_internacional = localSettings.extras.offsite_weekly_complete_internacional ?? 0;
        const { error: extrasError } = await supabase.from("user_day_extras").upsert(extrasRow, { onConflict: "user_id" });
        if (extrasError) throw extrasError;
      } catch (e: any) {
        if (String(e?.message || "").includes("skip_push_dietas_newer_cloud")) {
          dietasPushOk = true;
        } else {
          console.error("SYNC ERROR: dietas config upsert", e);
          dietasPushOk = false;
        }
      }

      try {
        const ferryRaw = await AsyncStorage.getItem(await userScopedKey("tacoplan_ferry_config"));
        if (ferryRaw) {
          const f = JSON.parse(ferryRaw);
          let cloudFerryUpdatedAt: string | null = null;
          try {
            const r = await supabase.from("user_ferry_config").select("updated_at").eq("user_id", authUser.id).maybeSingle();
            cloudFerryUpdatedAt = r.error ? null : ((r.data as any)?.updated_at ?? null);
          } catch {
            cloudFerryUpdatedAt = null;
          }
          const localFerryUpdatedAt = typeof f?._updated_at === "string" ? f._updated_at : null;
          const shouldPushFerry = !cloudFerryUpdatedAt || (localFerryUpdatedAt != null && localFerryUpdatedAt > cloudFerryUpdatedAt);
          if (shouldPushFerry) {
            const cols = await getColumnSet("user_ferry_config");
            const row: Record<string, any> = {
              user_id: authUser.id,
              crosses_ferry: !!f.crossesFerry,
              route_mode: f.routeMode || "spain",
              payment_mode: f.paymentMode || "spain_diet",
              trip_rate: Number(f.tripRate) || 0,
              pernight_rate: Number(f.pernightRate) || 0,
              ferry_rest_enabled: !!f.ferryRestEnabled,
              updated_at: maxIso(localFerryUpdatedAt, localUpdatedAt) ?? new Date().toISOString(),
            };
            if (cols.has("ferry_transit_rate")) row.ferry_transit_rate = Number(f.ferryTransitRate) || 54.3;
            if (cols.has("ferry_cabin_rate")) row.ferry_cabin_rate = Number(f.ferryCabinRate) || 54.3;
            await supabase.from("user_ferry_config").upsert(row, { onConflict: "user_id" });
          }
        }
      } catch {}
    }

    const queue = await getOfflineQueue();
    const deleteJornadas = queue.filter((a): a is Extract<SyncAction, { type: "delete" }> => a.type === "delete");
    const deleteDayExtras = queue.filter((a): a is Extract<SyncAction, { type: "delete_day_extra" }> => a.type === "delete_day_extra");
    const deleteNaturalDays = queue.filter((a): a is Extract<SyncAction, { type: "delete_natural_day" }> => a.type === "delete_natural_day");
    const failedDeletes: SyncAction[] = [];
    let allDeletesOk = true;
    for (const action of deleteJornadas) {
      try {
        await deleteFromCloud(action.jornadaId, getAccessToken);
      } catch {
        allDeletesOk = false;
        failedDeletes.push(action);
      }
    }
    for (const action of deleteDayExtras) {
      try {
        await deleteDayExtraEntryFromCloud(action.entryId, getAccessToken);
      } catch {
        allDeletesOk = false;
        failedDeletes.push(action);
      }
    }
    for (const action of deleteNaturalDays) {
      try {
        await deleteNaturalDayDietFromCloud(action.entryId, getAccessToken);
      } catch {
        allDeletesOk = false;
        failedDeletes.push(action);
      }
    }

    let cloud: any;
    let pullSuccess = false;
    let pullError: any = null;
    try {
      cloud = await pullCloudAll(authUser);
      pullSuccess = true;
    } catch (e: any) {
      pullError = e;
      cloud = { jornadas: [], compensaciones: [], profile: null, dietasConfig: null, naturalDayDiets: [] };
    }

    if (!pullSuccess) {
      return {
        success: false,
        message: pullError?.message || "Error al descargar datos",
        stats: { pulled: 0, pushed, merged: 0 },
      };
    }

    const cloudJ = cloud.jornadas || [];
    const cloudC = cloud.compensaciones || [];
    const cloudE = cloud.dayExtraEntries || [];
    const cloudN = cloud.naturalDayDiets || [];
    pulled = cloudJ.length + cloudC.length + cloudE.length + cloudN.length;

    if (cloudJ.length > 0 || cloudC.length > 0 || cloudE.length > 0) {
      await mergeFromCloud(cloudJ, cloudC, cloudE);
    }

    if (cloudN.length > 0) {
      await applyNaturalDayDietsLocally(cloudN);
    }

    merged = Math.max(0, pulled - pushed);

    if (cloud.profile && profilePushOk) {
      await applyProfileLocally(cloud.profile);
    }

    if (cloud.dietasConfig && dietasPushOk) {
      await applyDietasConfigLocally(cloud.dietasConfig);
    }

    if (cloud.ferryConfig) {
      await applyFerryConfigLocally(cloud.ferryConfig);
    }

    const dayExtraPushOk = (syncAll as any).__dayExtraPushOk !== false;
    const natPushOk = (syncAll as any).__natPushOk !== false;
    if (!hasPendingLocal) {
      await markAllSynced();
    } else if (pushed > 0 && dayExtraPushOk && natPushOk) {
      await markAllSynced();
    }

    if (allDeletesOk) {
      await clearOfflineQueue();
    } else {
      const pushes = queue.filter((a) => a.type === "push");
      const remaining = [...pushes, ...failedDeletes];
      await saveOfflineQueue(remaining.length > 0 ? remaining : []);
    }

    await saveLastSyncTime();
    await touchDeviceLastSyncAt(authUser.id);

    return {
      success: true,
      message: "Sincronizado",
      stats: { pulled, pushed, merged },
    };
  } catch (e: any) {
    console.error("SYNC ERROR:", e);
    const rawMsg = e?.message || String(e || "Error de sincronización");
    let userMsg = rawMsg;
    // Formato más legible para errores out-of-range de Postgres (integer overflow / epoch ms)
    const oorMatch = String(rawMsg).match(/value\s+'(-?\d+)'\s+is out of range for type integer/i);
    if (oorMatch?.[1]) {
      const badVal = oorMatch[1];
      const num = Number(badVal);
      let hint = "";
      if (Number.isFinite(num)) {
        if (num > 2_147_483_647) {
          // Sospecha: epoch milisegundos en columna int4
          const asDate = new Date(num);
          const asDateStr = isNaN(asDate.getTime()) ? "" : asDate.toISOString().slice(0, 16).replace("T", " ");
          const asSecs = Math.floor(num / 1000);
          hint = asDateStr
            ? ` (epoch ms detectado: ${asDateStr} → ${asSecs.toLocaleString("es-ES")} segundos)`
            : ` (máximo permitido Postgres int4: 2.147.483.647)`;
        } else if (num < -2_147_483_648) {
          hint = ` (mínimo permitido Postgres int4: -2.147.483.648)`;
        }
      }
      userMsg = `Valor corrupto: el número ${badVal} excede el límite entero${hint}. Los campos numéricos se han acotado (clamp). Vuelve a sincronizar.`;
    }
    return { success: false, message: userMsg };
  }
}

async function getAllJornadasCount(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(await userScopedKey("tacoplan_jornadas"));
    return raw ? JSON.parse(raw).length : 0;
  } catch {
    return 0;
  }
}

export async function syncFromCloud(getAccessToken: () => Promise<string | null>): Promise<SyncResult> {
  return syncAll(getAccessToken);
}

export async function syncWithCloud(getAccessToken: () => Promise<string | null>): Promise<SyncResult> {
  return syncAll(getAccessToken);
}

export async function deleteFromCloud(
  jornadaId: string,
  getAccessToken: () => Promise<string | null>,
): Promise<void> {
  void getAccessToken;
  try {
    const auth = await getAuthenticatedUserOrThrow();
    console.log("[SYNC] delete jornada in Supabase", { jornadaId, userId: auth.user.id });
    const { error: cErr } = await supabase.from("compensaciones").delete().eq("jornada_id", jornadaId);
    if (cErr) throw cErr;
    const { error: jErr } = await supabase.from("jornadas").delete().eq("id", jornadaId);
    if (jErr) throw jErr;
  } catch (e) {
    console.log("[SYNC] deleteFromCloud failed", e);
  }
}

export async function deleteNaturalDayDietFromCloud(
  entryId: string,
  getAccessToken: () => Promise<string | null>,
): Promise<void> {
  void getAccessToken;
  const auth = await getAuthenticatedUserOrThrow();
  const { error } = await supabase
    .from("user_natural_day_diets")
    .delete()
    .eq("id", entryId)
    .eq("user_id", auth.user.id);
  if (error) throw error;
}

export async function deleteDayExtraEntryFromCloud(
  entryId: string,
  getAccessToken: () => Promise<string | null>,
): Promise<void> {
  void getAccessToken;
  try {
    const auth = await getAuthenticatedUserOrThrow();
    console.log("[SYNC] delete day extra entry in Supabase", { entryId, userId: auth.user.id });
    const { error } = await supabase.from("user_day_extra_entries").delete().eq("id", entryId);
    if (error) throw error;
  } catch (e) {
    console.log("[SYNC] deleteDayExtraEntryFromCloud failed", e);
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let syncInProgress = false;

type SyncStatusCallback = (status: "syncing" | "synced" | "error" | "offline", result?: SyncResult) => void;

export async function autoSync(
  getAccessToken: () => Promise<string | null>,
  onStatus?: SyncStatusCallback,
): Promise<void> {
  if (!isOnline()) {
    await addToOfflineQueue({ type: "push", timestamp: Date.now() });
    onStatus?.("offline", { success: false, message: "Sin conexión" });
    return;
  }

  if (syncInProgress) return;
  syncInProgress = true;
  onStatus?.("syncing");

  try {
    const result = await syncAll(getAccessToken);
    onStatus?.(result.success ? "synced" : "error", result);
  } catch (e: any) {
    onStatus?.("error", { success: false, message: e?.message || String(e) });
  } finally {
    syncInProgress = false;
  }
}

export function debouncedAutoSync(
  getAccessToken: () => Promise<string | null>,
  onStatus?: SyncStatusCallback,
): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    autoSync(getAccessToken, onStatus);
  }, SYNC_DEBOUNCE_MS);
}

export async function processOfflineQueue(
  getAccessToken: () => Promise<string | null>,
  onStatus?: SyncStatusCallback,
): Promise<void> {
  const queue = await getOfflineQueue();
  if (queue.length === 0) return;
  if (!isOnline()) return;
  await autoSync(getAccessToken, onStatus);
}

export async function queueDeleteForSync(jornadaId: string): Promise<void> {
  await addToOfflineQueue({ type: "delete", jornadaId, timestamp: Date.now() });
}

export async function queueDeleteDayExtraEntryForSync(entryId: string): Promise<void> {
  await addToOfflineQueue({ type: "delete_day_extra", entryId, timestamp: Date.now() });
}

export async function queueDeleteNaturalDayDietForSync(entryId: string): Promise<void> {
  await addToOfflineQueue({ type: "delete_natural_day", entryId, timestamp: Date.now() });
}

export async function restoreFromCloud(
  getAccessToken: () => Promise<string | null>,
  onProgress?: (step: number, total: number, label: string) => void,
): Promise<{ success: boolean; message: string; jornadasCount: number; compensacionesCount: number }> {
  void getAccessToken;

  const totalSteps = 5;

  try {
    onProgress?.(1, totalSteps, "Conectando con la nube...");
    await new Promise((r) => setTimeout(r, 400));

    onProgress?.(2, totalSteps, "Descargando jornadas y perfil...");

    const auth = await getAuthenticatedUserOrThrow();
    const cloud: any = await pullCloudAll(auth.user);

    await new Promise((r) => setTimeout(r, 300));

    onProgress?.(3, totalSteps, "Aplicando configuración...");

    if (cloud.profile) {
      await applyProfileLocally(cloud.profile);
    }

    if (cloud.dietasConfig) {
      await applyDietasConfigLocally(cloud.dietasConfig);
    }

    if (cloud.ferryConfig) {
      await applyFerryConfigLocally(cloud.ferryConfig);
    }

    await new Promise((r) => setTimeout(r, 300));

    onProgress?.(4, totalSteps, "Guardando datos en el dispositivo...");
    const cloudJornadas = cloud.jornadas || [];
    const cloudCompensaciones = cloud.compensaciones || [];
    const cloudDayExtraEntries = cloud.dayExtraEntries || [];
    const cloudNaturalDayDiets = cloud.naturalDayDiets || [];

    if (cloudJornadas.length > 0 || cloudCompensaciones.length > 0 || cloudDayExtraEntries.length > 0) {
      await mergeFromCloud(cloudJornadas, cloudCompensaciones, cloudDayExtraEntries);
    }

    if (cloudNaturalDayDiets.length > 0) {
      await applyNaturalDayDietsLocally(cloudNaturalDayDiets);
    }

    await markAllSynced();
    await saveLastSyncTime();
    await new Promise((r) => setTimeout(r, 300));

    onProgress?.(5, totalSteps, "Completado");
    await new Promise((r) => setTimeout(r, 200));

    return {
      success: true,
      message: "Datos restaurados correctamente",
      jornadasCount: cloudJornadas.length,
      compensacionesCount: cloudCompensaciones.length,
    };
  } catch (e: any) {
    return { success: false, message: e.message || "Error al restaurar", jornadasCount: 0, compensacionesCount: 0 };
  }
}
