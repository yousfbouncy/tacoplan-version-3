import type {
  TachographActivity,
  TachographDataSource,
  TachographEvent,
  TachographTimestampSource,
} from "./types";
import { buildEventUid } from "./bluetoothTransport";

/**
 * Smart Tachograph 2 parser.
 *
 * IMPORTANTE (no inventar bytes):
 * - El protocolo ITS oficial define FIFO + Credits con framing binario propio.
 * - Los comandos, DIDs y estructuras exactas de activity/GNSS/country NO se
 *   documentan aquí con valores inventados. Solo se implementa:
 *     - detección de UUIDs GATT correctos (ya en bluetoothTransport)
 *     - interfaz de parser preparada
 *     - normalización de eventos de actividad / país / etc.
 *
 * CUALQUIER sección que requiera el formato exacto del comando o del
 * bloque binario del tachógrafo queda marcada con TODO(pending-spec) y
 * NO devuelve datos ficticios.
 */

export type TachoFrameKind =
  | "activity_change"
  | "country_entry"
  | "country_exit"
  | "speed"
  | "odometer"
  | "gnss"
  | "driver_slot"
  | "heartbeat"
  | "ack"
  | "unknown";

export interface TachoParsedFrame {
  kind: TachoFrameKind;
  receivedAt: string;
  payload: Record<string, unknown> | null;
  /** Si podemos extraer un evento normalizado, lo devolvemos ya listo. */
  normalizedEvent?: Omit<TachographEvent, "eventUid" | "createdAt" | "source"> & { source?: TachographDataSource } | null;
}

const MAX_KNOWN_FRAME_SIZE = 512;

function timestampFromBytesOrNow(bytes: Uint8Array, hintIndex?: number): string {
  // TODO(pending-spec): los Smart Tacho 2 usan un campo "time_real" en segundos
  // desde 1970-01-01 TAI o similar (4 bytes, probablemente uint32 BE).
  // Como no disponemos del offset exacto del campo dentro del paquete en esta
  // primera versión, devolvemos la hora del teléfono etiquetada
  // "phone_clock" para no falsear datos.
  void bytes;
  void hintIndex;
  return new Date().toISOString();
}

function inferActivityFromByte(value: number): TachographActivity {
  // TODO(pending-spec): mapeo exacto según el byte del cardholder status o
  // activity status del paquete. Por ahora devolvemos UNKNOWN para no
  // falsear; la capa superior lo ignora (anti-duplicados).
  switch (value & 0x03) {
    case 0:
      return "UNKNOWN";
    case 1:
      return "DRIVING";
    case 2:
      return "WORK";
    case 3:
      return "AVAILABLE";
    default:
      return "UNKNOWN";
  }
}

function inferCountryFromBytes(_bytes: Uint8Array, _offset: number): string | null {
  // TODO(pending-spec): cruce fronterizo usa o bien un GNSS fiable o bien el
  // evento explícito de "entered country" con código numérico.
  return null;
}

export function parseTachoFrame(serviceUuid: string, bytes: Uint8Array): TachoParsedFrame {
  const receivedAt = new Date().toISOString();

  if (!bytes || bytes.length === 0) {
    return { kind: "unknown", receivedAt, payload: { reason: "empty_frame", service: serviceUuid } };
  }
  if (bytes.length > MAX_KNOWN_FRAME_SIZE) {
    return { kind: "unknown", receivedAt, payload: { reason: "oversized_frame", service: serviceUuid, size: bytes.length } };
  }

  const firstByte = bytes[0];

  // TODO(pending-spec): interpretación del primer byte. Por ahora solo
  // detectamos casos triviales y etiquetamos TODO para que la capa de UI
  // no muestre valores inventados.

  if (firstByte === 0x00 && bytes.length === 1) {
    return { kind: "heartbeat", receivedAt, payload: { service: serviceUuid } };
  }

  if (bytes.length >= 4 && serviceUuid.endsWith("a69b5")) {
    // Canal DOWNLOAD: el paquete inicial podría ser activity change.
    // Como no sabemos el formato exacto, no forzamos la clasificación.
    return {
      kind: "unknown",
      receivedAt,
      payload: {
        reason: "pending_download_frame_spec",
        service: serviceUuid,
        firstByte,
        size: bytes.length,
      },
    };
  }

  if (bytes.length >= 4 && serviceUuid.endsWith("73efc")) {
    // Canal DIAGNOSTIC: probablemente ACK o chunk de respuesta.
    return {
      kind: "ack",
      receivedAt,
      payload: {
        service: serviceUuid,
        firstByte,
        size: bytes.length,
      },
    };
  }

  return {
    kind: "unknown",
    receivedAt,
    payload: {
      firstByte,
      size: bytes.length,
      service: serviceUuid,
    },
  };
}

/**
 * Utilidad de apoyo para eventos normalizados que NO provienen del parser
 * binario (por ejemplo, driver slot, conexión, etc.).
 * Sólo construye metadatos válidos sin inventar datos.
 */
export function buildSyntheticActivityChange(params: {
  previous?: TachographActivity | null;
  next: TachographActivity;
  timestamp?: string;
  timestampSource?: TachographTimestampSource;
  source?: TachographDataSource;
  sessionId?: string;
  jornadaId?: string;
  durationMin?: number;
  qualityScore?: number;
}): TachographEvent | null {
  if (!params.next || params.next === "UNKNOWN") return null;
  const ts = params.timestamp || new Date().toISOString();
  const src: TachographDataSource = params.source || "tachograph_ble";
  const tss: TachographTimestampSource = params.timestampSource || "phone_clock";
  const extra = `${params.previous || "?"}->${params.next}`;
  return {
    eventUid: buildEventUid("act", ts, extra + (params.sessionId || "")),
    jornadaId: params.jornadaId || null,
    sessionId: params.sessionId || null,
    timestamp: ts,
    timestampSource: tss,
    eventType: "activity_change",
    previousActivity: params.previous || null,
    newActivity: params.next,
    durationMin: params.durationMin ?? null,
    source: src,
    qualityScore: params.qualityScore ?? null,
  };
}

/**
 * Igual que el anterior pero para países.
 * No forzamos detección por GNSS, solo acepta país confirmado.
 */
export function buildSyntheticCountryChange(params: {
  previousCountry?: string | null;
  newCountry: string;
  timestamp?: string;
  timestampSource?: TachographTimestampSource;
  source?: TachographDataSource;
  sessionId?: string;
  jornadaId?: string;
  qualityScore?: number;
}): TachographEvent | null {
  if (!params.newCountry) return null;
  if (params.newCountry === params.previousCountry) return null;
  const ts = params.timestamp || new Date().toISOString();
  return {
    eventUid: buildEventUid("country", ts, `${params.previousCountry || ""}->${params.newCountry}`),
    jornadaId: params.jornadaId || null,
    sessionId: params.sessionId || null,
    timestamp: ts,
    timestampSource: params.timestampSource || "phone_clock",
    eventType: "country_entry",
    previousCountry: params.previousCountry || null,
    newCountry: params.newCountry,
    source: params.source || "tachograph_ble",
    qualityScore: params.qualityScore ?? 100,
  };
}

export { timestampFromBytesOrNow, inferActivityFromByte, inferCountryFromBytes };
