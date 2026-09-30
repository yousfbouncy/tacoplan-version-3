import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../supabase";
import { userScopedKey } from "../user-scope";
import type {
  TachographActivity,
  TachographDailySummary,
  TachographDataSource,
  TachographDevice,
  TachographEvent,
  TachographSession,
} from "./types";

async function getSb() {
  try {
    // Reutiliza el cliente autenticado principal. El cliente antiguo obtenía
    // otra configuración desde /api/auth/config pero no heredaba la sesión,
    // por lo que RLS rechazaba silenciosamente las escrituras del tacógrafo.
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) return null;
    return supabase;
  } catch {
    return null;
  }
}

/**
 * Almacenamiento y persistencia del módulo tacógrafo.
 * - Local: AsyncStorage (cuando estamos offline)
 * - Remoto: Supabase (cuando hay conexión y RLS autoriza)
 * - Toda escritura la hace con una cola local, luego el sync-context
 *   general de Tacoplan puede hacer push cuando corresponda.
 */

const KEY_AUTHORIZED_DEVICES = "tachograph_authorized_devices_v1";
const KEY_SESSION = "tachograph_active_session_v1";
const KEY_EVENTS_QUEUE = "tachograph_events_pending_v1";
const KEY_LAST_ACTIVITY = "tachograph_last_activity_v1";

export interface LastActivitySnapshot {
  activity: TachographActivity;
  startedAt: string;
  source: TachographDataSource;
}

async function readList<T>(k: string): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(await userScopedKey(k));
    if (!raw) return [];
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
}

async function writeList<T>(k: string, list: T[]): Promise<void> {
  await AsyncStorage.setItem(await userScopedKey(k), JSON.stringify(list));
}

async function readOne<T>(k: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(await userScopedKey(k));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeOne<T>(k: string, value: T | null): Promise<void> {
  if (value == null) {
    await AsyncStorage.removeItem(await userScopedKey(k));
  } else {
    await AsyncStorage.setItem(await userScopedKey(k), JSON.stringify(value));
  }
}

// =====================================================================
// AUTHORIZED DEVICES
// =====================================================================
export async function listAuthorizedDevices(): Promise<TachographDevice[]> {
  const list = await readList<TachographDevice>(KEY_AUTHORIZED_DEVICES);
  list.sort((a, b) => (b.lastSeenAt || "").localeCompare(a.lastSeenAt || ""));
  return list;
}

export async function upsertAuthorizedDevice(
  device: TachographDevice,
  userId?: string | null,
): Promise<TachographDevice> {
  const list = await listAuthorizedDevices();
  const existing = list.findIndex((d) => d.identifier === device.identifier);
  const enriched: TachographDevice = existing >= 0
    ? { ...list[existing], ...device }
    : device;
  if (existing >= 0) list[existing] = enriched;
  else list.unshift(enriched);
  await writeList(KEY_AUTHORIZED_DEVICES, list);
  if (userId) {
    const row: any = {
      user_id: userId,
      identifier: enriched.identifier,
      name: enriched.name || null,
      model: enriched.model || null,
      manufacturer: enriched.manufacturer || null,
      serial_number: enriched.serialNumber || null,
      trusted: !!enriched.trusted,
      auto_reconnect: !!enriched.autoReconnect,
      meta: enriched.meta || {},
    };
    try {
      const sb = await getSb();
      if (sb) await sb.from("tachograph_devices").upsert(row, { onConflict: "user_id,identifier" });
    } catch {}
  }
  return enriched;
}

export async function removeAuthorizedDevice(identifier: string, userId?: string | null): Promise<void> {
  const list = await listAuthorizedDevices();
  await writeList(KEY_AUTHORIZED_DEVICES, list.filter((d) => d.identifier !== identifier));
  if (userId) {
    try {
      const sb = await getSb();
      if (sb) {
        await sb
          .from("tachograph_devices")
          .delete()
          .eq("user_id", userId)
          .eq("identifier", identifier);
      }
    } catch {}
  }
}

// =====================================================================
// SESSION
// =====================================================================
export async function getActiveSession(): Promise<TachographSession | null> {
  return readOne<TachographSession>(KEY_SESSION);
}

export async function setActiveSession(session: TachographSession | null, userId?: string | null): Promise<void> {
  await writeOne(KEY_SESSION, session);
  if (!session || !userId) return;
  try {
    const sb = await getSb();
    if (sb) {
      await sb.from("tachograph_sessions").upsert(
        {
          id: session.id,
          user_id: userId,
          device_id: session.deviceId || null,
          jornada_id: session.jornadaId || null,
          started_at: session.startedAt,
          ended_at: session.endedAt || null,
          connection_state: session.connectionState,
          disconnections_count: session.disconnectionsCount || 0,
          rssi_min: session.rssiMin ?? null,
          rssi_max: session.rssiMax ?? null,
          services_detected: session.servicesDetected || null,
          firmware_version: session.firmwareVersion || null,
        },
        { onConflict: "id" },
      );
    }
  } catch {}
}

// =====================================================================
// EVENTS
// =====================================================================
function dedupeTachographEvents(events: TachographEvent[]): TachographEvent[] {
  const byUid = new Map<string, TachographEvent>();
  for (const event of events || []) {
    if (!event?.eventUid) continue;
    const current = byUid.get(event.eventUid);
    // Si por algún motivo llegan dos copias, conservamos la más completa/reciente.
    if (!current || String(event.timestamp || "") >= String(current.timestamp || "")) {
      byUid.set(event.eventUid, event);
    }
  }
  return Array.from(byUid.values());
}

export async function pushEvents(events: TachographEvent[], userId?: string | null): Promise<void> {
  if (events.length === 0) return;
  const queued = dedupeTachographEvents(await readList<TachographEvent>(KEY_EVENTS_QUEUE));
  const seen = new Set(queued.map((e) => e.eventUid));
  for (const e of dedupeTachographEvents(events)) {
    if (seen.has(e.eventUid)) continue;
    queued.push(e);
    // Importante: actualizar el Set dentro del mismo lote; de otro modo dos
    // eventos repetidos recibidos juntos podían entrar dos veces.
    seen.add(e.eventUid);
  }
  await writeList(KEY_EVENTS_QUEUE, dedupeTachographEvents(queued));

  if (userId) {
    const rows = events.map((e) => ({
      user_id: userId,
      jornada_id: e.jornadaId || null,
      session_id: e.sessionId || null,
      event_uid: e.eventUid,
      timestamp: e.timestamp,
      timestamp_source: e.timestampSource,
      event_type: e.eventType,
      previous_activity: e.previousActivity || null,
      new_activity: e.newActivity || null,
      previous_country: e.previousCountry || null,
      new_country: e.newCountry || null,
      latitude: e.latitude ?? null,
      longitude: e.longitude ?? null,
      speed_kmh: e.speedKmh ?? null,
      distance_m: e.distanceM ?? null,
      odometer_km: e.odometerKm ?? null,
      duration_min: e.durationMin ?? null,
      source: e.source,
      raw_data: e.rawData || null,
      quality_score: e.qualityScore ?? null,
      deduplication_key: e.deduplicationKey || null,
    }));
    try {
      const sb = await getSb();
      if (sb) await sb.from("tachograph_events").upsert(rows, { onConflict: "user_id,event_uid" });
    } catch {}
  }
}

export async function listEventsForJornada(jornadaId: string): Promise<TachographEvent[]> {
  const queued = dedupeTachographEvents(await readList<TachographEvent>(KEY_EVENTS_QUEUE));
  const res = queued.filter((e) => e.jornadaId === jornadaId);
  res.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return res;
}

export async function listEventsForDate(dateIso: string): Promise<TachographEvent[]> {
  const queued = dedupeTachographEvents(await readList<TachographEvent>(KEY_EVENTS_QUEUE));
  const res = queued.filter((e) => e.timestamp.slice(0, 10) === dateIso);
  res.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return res;
}

// =====================================================================
// LAST ACTIVITY
// =====================================================================
export async function getLastActivity(): Promise<LastActivitySnapshot | null> {
  return readOne<LastActivitySnapshot>(KEY_LAST_ACTIVITY);
}

export async function setLastActivity(snap: LastActivitySnapshot | null): Promise<void> {
  await writeOne(KEY_LAST_ACTIVITY, snap);
}

// =====================================================================
// DAILY SUMMARY
// =====================================================================
export interface BuildSummaryOptions {
  events: TachographEvent[];
  jornadaId?: string | null;
  source?: TachographDataSource;
  disconnectionsCount?: number;
}

export function buildDailySummary(options: BuildSummaryOptions): TachographDailySummary {
  const { events, jornadaId = null, source = "tachograph_ble", disconnectionsCount = 0 } = options;
  // El resumen nunca debe sumar dos veces el mismo evento de tacógrafo.
  const sorted = dedupeTachographEvents(events).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const dates = sorted.map((e) => e.timestamp.slice(0, 10));
  const summaryDate = dates[0] || new Date().toISOString().slice(0, 10);

  let drivingMin = 0;
  let workMin = 0;
  let availableMin = 0;
  let restMin = 0;
  let pauseMin = 0;
  let unknownMin = 0;
  let firstAt: string | null = null;
  let lastAt: string | null = null;
  let countryEntries = 0;
  const countriesSet = new Set<string>();
  let minOdo: number | null = null;
  let maxOdo: number | null = null;

  for (const e of sorted) {
    if (!firstAt || e.timestamp < firstAt) firstAt = e.timestamp;
    if (!lastAt || e.timestamp > lastAt) lastAt = e.timestamp;
    if (e.eventType === "country_entry" && e.newCountry) {
      countryEntries++;
      countriesSet.add(e.newCountry);
    }
    if (e.odometerKm != null) {
      if (minOdo == null || e.odometerKm < minOdo) minOdo = e.odometerKm;
      if (maxOdo == null || e.odometerKm > maxOdo) maxOdo = e.odometerKm;
    }
    if (e.eventType === "activity_change" && e.newActivity) {
      const dur = Number(e.durationMin) || 0;
      switch (e.newActivity) {
        case "DRIVING":
          drivingMin += dur;
          break;
        case "WORK":
          workMin += dur;
          break;
        case "AVAILABLE":
          availableMin += dur;
          break;
        case "REST":
          restMin += dur;
          pauseMin += dur;
          break;
        default:
          unknownMin += dur;
      }
    }
  }
  let distanceKm: number | null = null;
  if (minOdo != null && maxOdo != null) {
    distanceKm = Math.max(0, maxOdo - minOdo);
  }
  const totalKnown = drivingMin + workMin + availableMin + restMin;
  let qualityScore = 0;
  if (sorted.length > 0 && totalKnown > 0) {
    qualityScore = Math.max(0, Math.min(100, 50 + Math.round((1 - unknownMin / Math.max(1, totalKnown + unknownMin)) * 50)));
  }
  return {
    summaryDate,
    jornadaId,
    firstActivityAt: firstAt,
    lastActivityAt: lastAt,
    drivingMin,
    workMin,
    availableMin,
    restMin,
    pauseMin,
    unknownMin,
    countries: Array.from(countriesSet),
    countryEntriesCount: countryEntries,
    distanceKm,
    disconnectionsCount,
    dataSource: source,
    dataQualityScore: sorted.length > 0 ? qualityScore : 0,
  };
}

export async function upsertDailySummary(
  summary: TachographDailySummary,
  userId?: string | null,
): Promise<TachographDailySummary | null> {
  if (!userId) return null;
  try {
    const payload: any = {
      user_id: userId,
      summary_date: summary.summaryDate,
      jornada_id: summary.jornadaId || null,
      first_activity_at: summary.firstActivityAt || null,
      last_activity_at: summary.lastActivityAt || null,
      driving_min: summary.drivingMin,
      work_min: summary.workMin,
      available_min: summary.availableMin,
      rest_min: summary.restMin,
      pause_min: summary.pauseMin,
      unknown_min: summary.unknownMin,
      countries: summary.countries,
      country_entries_count: summary.countryEntriesCount,
      distance_km: summary.distanceKm ?? null,
      disconnections_count: summary.disconnectionsCount || 0,
      data_source: summary.dataSource,
      data_quality_score: summary.dataQualityScore ?? null,
    };
    const sb = await getSb();
    if (!sb) return { ...summary, id: summary.id ?? undefined };
    const { data } = await sb
      .from("tachograph_daily_summary")
      .upsert(payload, { onConflict: "user_id,summary_date,jornada_id" })
      .select("*")
      .limit(1)
      .maybeSingle();
    if (data) {
      return {
        ...summary,
        id: data.id,
      };
    }
  } catch {}
  return summary;
}
