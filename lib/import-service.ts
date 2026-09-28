import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getAllDayExtraEntries,
  getAllFerryRests,
  getAllTachoActivities,
  getAllViajes,
  listarJornadas,
  prepareImportedJornadasForStorage,
  replaceImportedDayExtraEntries,
  replaceImportedFerryRests,
  replaceImportedJornadas,
  replaceImportedTachoActivities,
  replaceImportedViajes,
  type DayExtraEntry,
  type FerryExtras,
  type FerryInterruption,
  type FerryRestRecord,
  type Jornada,
  type LegalSummaryStored,
  type PlusItem,
  type TachoActivity,
  type Viaje,
} from "@/lib/local-storage";
import { supabase } from "@/lib/supabase";
import { syncWithCloud } from "@/lib/sync-service";
import { parseTacoplanReport, type TacoplanReportParseResult } from "@/lib/tacoplan-report-parser";
import { userScopedKey } from "@/lib/user-scope";
import { normalizeLocationText } from "@/lib/location-normalization";

const IMPORT_BACKUP_KEY = "tacoplan_import_backup";
const PDF_MARKER = "TACOPLAN_DATA:";
const PDF_STOP_TOKENS = [
  "Generado por Tacoplan",
  "about:blank",
  "Periodo:",
  "Historial de Jornadas",
  "Resumen de Dietas",
  "Resumen de KM",
  "Resumen por viaje",
  "Viajes",
];
const PDF_DIETS_DEBUG_URL = "http://127.0.0.1:7777/event";
const PDF_DIETS_DEBUG_SESSION = "pdf-diets-not-saved";
const PDF_DIETS_DEBUG_RUN = "pre-fix";

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

export type ImportMode = "new_only" | "overwrite_matching" | "import_all";

export type ImportDuplicate = {
  importedId: string;
  existingId: string;
  by: "id" | "content";
  importedLabel: string;
};

export type ImportWarning = {
  code:
    | "legacy_pdf_review"
    | "duplicates_detected"
    | "missing_owner_confirmation"
    | "sync_pending"
    | "embedded_backup_truncated"
    | "diagnostic_preview";
  message: string;
};

export type ImportPdfDiagnostics = TacoplanReportParseResult["diagnostics"];

export type ImportPreview = {
  periodLabel: string;
  jornadasCount: number;
  specialRecordsCount: number;
  totalDrivingMin: number;
  totalDurationMin: number;
  totalDietas: number;
  totalExtras: number;
  totalPlus: number;
  totalOverall: number;
  from: string | null;
  to: string | null;
  duplicateCount: number;
};

export type ParsedImportBundle = {
  source: "json" | "pdf";
  fileName: string;
  version: number | null;
  generatedAt: string | null;
  range: { from: string | null; to: string | null };
  jornadas: Jornada[];
  dayExtraEntries: DayExtraEntry[];
  ferryRests: FerryRestRecord[];
  viajes: Viaje[];
  tachoActivities: TachoActivity[];
  warnings: ImportWarning[];
  duplicates: ImportDuplicate[];
  preview: ImportPreview;
  ownerHint: string | null;
  diagnostics?: ImportPdfDiagnostics | null;
};

export type ImportApplyResult = {
  added: { jornadas: number; dayExtraEntries: number; ferryRests: number; viajes: number; tachoActivities: number };
  overwritten: { jornadas: number; dayExtraEntries: number; ferryRests: number; viajes: number; tachoActivities: number };
  skipped: { jornadas: number; dayExtraEntries: number; ferryRests: number; viajes: number; tachoActivities: number };
  syncAttempted: boolean;
  syncSucceeded: boolean;
  backupCreated: boolean;
};

type ParseImportParams = {
  fileName: string;
  source: "json" | "pdf";
  text?: string | null;
  bytes?: Uint8Array | null;
  extractedPdfText?: string | null;
  legacyFallback?: ((bytes: Uint8Array) => Promise<{
    jornadas?: Jornada[];
    dayExtraEntries?: DayExtraEntry[];
    ferryRests?: FerryRestRecord[];
    viajes?: Viaje[];
    tachoActivities?: TachoActivity[];
  } | null>) | null;
};

type Snapshot = {
  jornadas: Jornada[];
  dayExtraEntries: DayExtraEntry[];
  ferryRests: FerryRestRecord[];
  viajes: Viaje[];
  tachoActivities: TachoActivity[];
};

class ImportError extends Error {
  constructor(
    public readonly code:
      | "pdf_no_export_data"
      | "pdf_incomplete"
      | "decode_failed"
      | "unsupported_version"
      | "json_invalid"
      | "duplicates_detected",
    message: string,
  ) {
    super(message);
  }
}

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function pick<T = any>(obj: any, ...keys: string[]): T | undefined {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key] as T;
  }
  return undefined;
}

function parseBoolean(value: unknown, fallback: boolean = false): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function parseNumber(value: unknown, fallback: number | null = null): number | null {
  if (value === null || value === undefined || value === "") return fallback;
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function parseString(value: unknown, fallback: string | null = null): string | null {
  if (value === null || value === undefined) return fallback;
  const str = String(value);
  return str.length > 0 ? str : fallback;
}

function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return trimmed;
  const dmy = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return null;
}

function toTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
}

function buildStartAt(fecha: string | null, hora: string | null, fallback?: string | null): string {
  if (fallback && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(fallback)) return fallback;
  return `${fecha || "1970-01-01"}T${hora || "00:00"}:00`;
}

function buildEndAt(fecha: string | null, hora: string | null, fallback?: string | null): string | null {
  if (fallback && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(fallback)) return fallback;
  if (!fecha || !hora) return null;
  return `${fecha}T${hora}:00`;
}

function normalizeCompositeText(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function buildJornadaCompositeKey(jornada: Pick<Jornada, "fechaInicio" | "horaInicio" | "fechaFin" | "horaFin" | "lugarInicio" | "lugarFin">): string {
  return [
    jornada.fechaInicio || "",
    jornada.horaInicio || "",
    jornada.fechaFin || "",
    jornada.horaFin || "",
    normalizeCompositeText(normalizeLocationText(jornada.lugarInicio)),
    normalizeCompositeText(normalizeLocationText(jornada.lugarFin || "")),
  ].join("|");
}

function formatDateLabel(dateStr: string | null | undefined): string {
  const iso = toIsoDate(dateStr || "");
  if (!iso) return "-";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function formatMinutes(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes || 0));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function formatMoney(value: number): string {
  return `${value.toFixed(2)} €`;
}

function hasRecognizableTacoplanSections(text: string | null | undefined): boolean {
  if (!text) return false;
  return text.includes("Historial de Jornadas")
    || text.includes("Resumen de Dietas")
    || text.includes("Detalle por jornada")
    || text.includes("TACOPLAN_DATA:");
}

function buildRawPdfDiagnostics(text: string): ImportPdfDiagnostics {
  return {
    pageCount: text.includes("<<<TACOPLAN_PAGE_BREAK>>>") ? text.split("<<<TACOPLAN_PAGE_BREAK>>>").filter(Boolean).length : 1,
    textLength: text.length,
    sections: {
      historial: text.includes("Historial de Jornadas"),
      resumen: text.includes("Resumen de Dietas"),
      detalle: text.includes("Detalle por jornada"),
      marker: text.includes("TACOPLAN_DATA:"),
    },
    dateCount: (text.match(/\d{2}\/\d{2}\/\d{4}/g) || []).length,
    timeCount: (text.match(/\d{2}:\d{2}/g) || []).length,
    routeCount: (text.match(/\b(?:Internacional|Nacional)\b/gi) || []).length,
    amountCount: (text.match(/[0-9]+(?:[.,][0-9]{1,2})?\s*€/gi) || []).length,
    candidateRows: 0,
    parsedRows: 0,
    rejectedRows: [],
    firstParsedBlock: null,
    lastParsedBlock: null,
    textPreview: text.slice(0, 1000),
  };
}

function buildVisiblePdfBundle(
  fileName: string,
  visible: TacoplanReportParseResult,
  warnings: ImportWarning[],
): ParsedImportBundle {
  return {
    source: "pdf",
    fileName,
    version: 1,
    generatedAt: visible.generatedAt,
    range: visible.range,
    jornadas: visible.jornadas,
    dayExtraEntries: visible.dayExtraEntries,
    ferryRests: [],
    viajes: [],
    tachoActivities: [],
    warnings,
    duplicates: [],
    preview: {
      periodLabel: visible.range.from && visible.range.to
        ? `${formatDateLabel(visible.range.from)} - ${formatDateLabel(visible.range.to)}`
        : "Periodo no detectado",
      jornadasCount: visible.jornadas.length,
      specialRecordsCount: visible.dayExtraEntries.length,
      totalDrivingMin: visible.totalDrivingMin,
      totalDurationMin: visible.totalDurationMin,
      totalDietas: visible.totalDietas,
      totalExtras: visible.totalExtras,
      totalPlus: visible.totalPlus,
      totalOverall: visible.totalOverall,
      from: visible.range.from,
      to: visible.range.to,
      duplicateCount: 0,
    },
    ownerHint: null,
    diagnostics: visible.diagnostics,
  };
}

function buildDiagnosticPreviewBundle(fileName: string, text: string, extraMessage?: string): ParsedImportBundle {
  const diagnostics = buildRawPdfDiagnostics(text);
  return {
    source: "pdf",
    fileName,
    version: 1,
    generatedAt: null,
    range: { from: null, to: null },
    jornadas: [],
    dayExtraEntries: [],
    ferryRests: [],
    viajes: [],
    tachoActivities: [],
    warnings: [{
      code: "diagnostic_preview",
      message: extraMessage || "No se han podido reconstruir jornadas, pero se muestra una vista previa de diagnóstico del informe detectado.",
    }],
    duplicates: [],
    preview: {
      periodLabel: "Periodo no detectado",
      jornadasCount: 0,
      specialRecordsCount: 0,
      totalDrivingMin: 0,
      totalDurationMin: 0,
      totalDietas: 0,
      totalExtras: 0,
      totalPlus: 0,
      totalOverall: 0,
      from: null,
      to: null,
      duplicateCount: 0,
    },
    ownerHint: null,
    diagnostics,
  };
}

function base64ToBytes(base64: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = normalizeBase64(base64);
  if (!clean || clean.length % 4 === 1) throw new ImportError("decode_failed", "No se ha podido decodificar el archivo");

  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const c1 = clean[i] ?? "A";
    const c2 = clean[i + 1] ?? "A";
    const c3 = clean[i + 2] ?? "=";
    const c4 = clean[i + 3] ?? "=";

    const v1 = alphabet.indexOf(c1);
    const v2 = alphabet.indexOf(c2);
    const v3 = c3 === "=" ? -1 : alphabet.indexOf(c3);
    const v4 = c4 === "=" ? -1 : alphabet.indexOf(c4);

    if (v1 < 0 || v2 < 0 || (c3 !== "=" && v3 < 0) || (c4 !== "=" && v4 < 0)) {
      throw new ImportError("decode_failed", "No se ha podido decodificar el archivo");
    }

    const triple = (v1 << 18) | (v2 << 12) | ((v3 < 0 ? 0 : v3) << 6) | (v4 < 0 ? 0 : v4);
    out.push((triple >> 16) & 0xff);
    if (c3 !== "=") out.push((triple >> 8) & 0xff);
    if (c4 !== "=") out.push(triple & 0xff);
  }

  return new Uint8Array(out);
}

function decodeBytesAsLatin1(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let text = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    text += String.fromCharCode(...chunk);
  }
  return text;
}

function decodeBase64ToUtf8(base64: string): string {
  const bytes = base64ToBytes(base64);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return decodeBytesAsLatin1(bytes);
    } catch {
      throw new ImportError("decode_failed", "No se ha podido decodificar el archivo");
    }
  }
}

function normalizeBase64(base64: string): string {
  const clean = base64.replace(/\s+/g, "");
  const remainder = clean.length % 4;
  if (remainder === 0) return clean;
  if (remainder === 1) return clean;
  return clean + "=".repeat(4 - remainder);
}

function extractTacoplanBase64Candidates(rawText: string): string[] {
  const markerIndex = rawText.indexOf(PDF_MARKER);
  if (markerIndex === -1) return [];

  let tail = rawText.slice(markerIndex + PDF_MARKER.length);
  const lowerTail = tail.toLowerCase();
  let stopIndex = tail.length;
  for (const token of PDF_STOP_TOKENS) {
    const idx = lowerTail.indexOf(token.toLowerCase());
    if (idx >= 0 && idx < stopIndex) stopIndex = idx;
  }
  tail = tail.slice(0, stopIndex);

  const candidates: string[] = [];

  // Prefer long base64-like runs. This avoids swallowing footer/table words
  // that PDF text extraction may interleave after the hidden payload.
  const longChunks = tail.match(/[A-Za-z0-9+/=]{24,}/g) || [];
  if (longChunks.length > 0) {
    candidates.push(normalizeBase64(longChunks.join("")));
  }

  const cleaned = tail
    .replace(/[\u0000-\u001F]+/g, "")
    .replace(/\s+/g, "")
    .replace(/[^A-Za-z0-9+/=]/g, "");

  if (cleaned) {
    candidates.push(normalizeBase64(cleaned));
  }

  return Array.from(new Set(candidates.filter(Boolean)));
}

function tryParsePdfPayload(base64: string): any {
  const decoded = decodeBase64ToUtf8(base64);
  return JSON.parse(decoded);
}

function ensureCompatibleVersion(payload: any): number | null {
  const version = parseNumber(payload?.version, null);
  if (version == null) return null;
  if (version > 2) {
    throw new ImportError("unsupported_version", "El formato pertenece a una versión no compatible");
  }
  return version;
}

function normalizeLegalSummary(input: any): LegalSummaryStored | null {
  if (!input || typeof input !== "object") return null;
  return {
    status: input.status === "advertencia" || input.status === "infraccion" ? input.status : "legal",
    infractions: Array.isArray(input.infractions) ? input.infractions : [],
    warnings: Array.isArray(input.warnings) ? input.warnings : [],
    conduccionSemanalMin: Number(input.conduccionSemanalMin || 0),
    conduccionBisemanalMin: Number(input.conduccionBisemanalMin || 0),
    extensiones10hSemana: Number(input.extensiones10hSemana || 0),
    descansosReducidosSemana: Number(input.descansosReducidosSemana || 0),
    splitRestDetected: parseBoolean(input.splitRestDetected, false),
    splitRestFirstPartMin: parseNumber(input.splitRestFirstPartMin, null),
    splitRestSecondPartMin: parseNumber(input.splitRestSecondPartMin, null),
    countsAsReducedRest: parseBoolean(input.countsAsReducedRest, true),
  };
}

function normalizeJornada(input: any): Jornada {
  const now = new Date().toISOString();
  const fechaInicio = toIsoDate(pick(input, "fechaInicio", "fecha_inicio")) || "1970-01-01";
  const horaInicio = toTime(pick(input, "horaInicio", "hora_inicio")) || "00:00";
  const fechaFin = toIsoDate(pick(input, "fechaFin", "fecha_fin"));
  const horaFin = toTime(pick(input, "horaFin", "hora_fin"));
  const startAt = buildStartAt(fechaInicio, horaInicio, parseString(pick(input, "startAt", "start_at"), null));
  const endAt = buildEndAt(fechaFin, horaFin, parseString(pick(input, "endAt", "end_at"), null));
  const plusItems = Array.isArray(pick(input, "plusItems", "plus_items")) ? pick(input, "plusItems", "plus_items") as PlusItem[] : null;

  return {
    ...input,
    id: String(pick(input, "id") ?? randomId("jornada")),
    fechaInicio,
    horaInicio,
    lugarInicio: normalizeLocationText(String(pick(input, "lugarInicio", "lugar_inicio") ?? "-")),
    fechaFin,
    horaFin,
    lugarFin: (() => {
      const value = parseString(pick(input, "lugarFin", "lugar_fin"), null);
      return value ? normalizeLocationText(value) : null;
    })(),
    startAt,
    endAt,
    conduccionMin: parseNumber(pick(input, "conduccionMin", "conduccion_min"), null),
    conduccionDomingoMin: parseNumber(pick(input, "conduccionDomingoMin", "conduccion_domingo_min"), null),
    conduccionLunesMin: parseNumber(pick(input, "conduccionLunesMin", "conduccion_lunes_min"), null),
    tipoRuta: parseString(pick(input, "tipoRuta", "tipo_ruta"), null),
    pernocta: pick(input, "pernocta") == null ? null : parseBoolean(pick(input, "pernocta"), false),
    dietaModo: parseString(pick(input, "dietaModo", "dieta_modo"), null),
    dietaManualTipo: parseString(pick(input, "dietaManualTipo", "dieta_manual_tipo"), null),
    dietaManualPct: parseString(pick(input, "dietaManualPct", "dieta_manual_pct"), null),
    dietaImporteEur: parseString(pick(input, "dietaImporteEur", "dieta_importe_eur"), null),
    dietasItems: Array.isArray(pick(input, "dietasItems", "dietas_items")) ? pick(input, "dietasItems", "dietas_items") as any[] : null,
    dietaPercent: parseNumber(pick(input, "dietaPercent", "dieta_percent"), null),
    dayFlag: parseString(pick(input, "dayFlag", "day_flag"), null),
    dayExtraEur: parseString(pick(input, "dayExtraEur", "day_extra_eur"), null),
    dietBaseEur: parseString(pick(input, "dietBaseEur", "diet_base_eur"), null),
    dietRule: parseString(pick(input, "dietRule", "diet_rule"), null),
    dietCalculatedAt: parseString(pick(input, "dietCalculatedAt", "diet_calculated_at"), null),
    descansoAnteriorMin: parseNumber(pick(input, "descansoAnteriorMin", "descanso_anterior_min"), null),
    tipoDescansoAnterior: parseString(pick(input, "tipoDescansoAnterior", "tipo_descanso_anterior"), null),
    previousRestSource: pick(input, "previousRestSource", "previous_rest_source") ?? null,
    previousRestId: parseString(pick(input, "previousRestId", "previous_rest_id"), null),
    previousRestValid: pick(input, "previousRestValid", "previous_rest_valid") == null ? null : parseBoolean(pick(input, "previousRestValid", "previous_rest_valid"), false),
    duracionJornadaMin: parseNumber(pick(input, "duracionJornadaMin", "duracion_jornada_min"), null),
    countsAsDailyReduced: parseBoolean(pick(input, "countsAsDailyReduced", "counts_as_daily_reduced"), false),
    plannedRestMin: parseNumber(pick(input, "plannedRestMin", "planned_rest_min"), null),
    plannedRestType: (pick(input, "plannedRestType", "planned_rest_type") as "daily" | "weekly" | null | undefined) ?? null,
    splitRestDetected: parseBoolean(pick(input, "splitRestDetected", "split_rest_detected"), false),
    splitRestFirstPartMin: parseNumber(pick(input, "splitRestFirstPartMin", "split_rest_first_part_min"), null),
    splitRestSecondPartMin: parseNumber(pick(input, "splitRestSecondPartMin", "split_rest_second_part_min"), null),
    countsAsReducedRest: parseBoolean(pick(input, "countsAsReducedRest", "counts_as_reduced_rest"), true),
    paymentMode: pick(input, "paymentMode", "payment_mode") ?? null,
    kmInicio: parseNumber(pick(input, "kmInicio", "km_inicio"), null),
    kmFin: parseNumber(pick(input, "kmFin", "km_fin"), null),
    kmTotal: parseNumber(pick(input, "kmTotal", "km_total"), null),
    pricePerKm: parseNumber(pick(input, "pricePerKm", "price_per_km"), null),
    importeKm: parseNumber(pick(input, "importeKm", "importe_km"), null),
    pricePerTrip: parseNumber(pick(input, "pricePerTrip", "price_per_trip"), null),
    importeViaje: parseNumber(pick(input, "importeViaje", "importe_viaje"), null),
    reportHideAmounts: parseBoolean(pick(input, "reportHideAmounts", "report_hide_amounts"), false),
    reportHidePluses: parseBoolean(pick(input, "reportHidePluses", "report_hide_pluses"), false),
    plusItems,
    observaciones: parseString(pick(input, "observaciones"), null),
    moroccoPaymentMode: pick(input, "moroccoPaymentMode", "morocco_payment_mode") ?? null,
    moroccoTripRate: parseNumber(pick(input, "moroccoTripRate", "morocco_trip_rate"), null),
    moroccoPernightRate: parseNumber(pick(input, "moroccoPernightRate", "morocco_pernight_rate"), null),
    ferryPending: parseBoolean(pick(input, "ferryPending", "ferry_pending"), false),
    ferryDestination: parseString(pick(input, "ferryDestination", "ferry_destination"), null),
    ferryExtras: (pick(input, "ferryExtras", "ferry_extras") as FerryExtras | null | undefined) ?? null,
    ferryInterruptions: (pick(input, "ferryInterruptions", "ferry_interruptions") as FerryInterruption[] | null | undefined) ?? null,
    ferryRestCompleted: parseBoolean(pick(input, "ferryRestCompleted", "ferry_rest_completed"), false),
    ferryRestType: (pick(input, "ferryRestType", "ferry_rest_type") as "9h" | "11h" | null | undefined) ?? null,
    legalSummary: normalizeLegalSummary(pick(input, "legalSummary", "legal_summary")),
    updatedAt: parseString(pick(input, "updatedAt", "updated_at"), now) || now,
    syncStatus: "pending",
  };
}

function normalizeViaje(input: any): Viaje {
  const now = new Date().toISOString();
  const paradas = Array.isArray(input?.paradas) ? input.paradas.map((p: any) => ({
    ...p,
    id: String(p?.id ?? randomId("parada")),
    tipo: p?.tipo === "DESCARGA" ? "DESCARGA" : "CARGA",
    lugar: String(p?.lugar || "-"),
    citaFecha: parseString(p?.citaFecha, null),
    citaHora: parseString(p?.citaHora, null),
    llegadaReal: parseString(p?.llegadaReal, null),
    salidaReal: parseString(p?.salidaReal, null),
    llegadaConfirmada: parseBoolean(p?.llegadaConfirmada, false),
    salidaConfirmada: parseBoolean(p?.salidaConfirmada, false),
  })) : [];

  return {
    ...input,
    id: String(input?.id ?? randomId("viaje")),
    cliente: parseString(input?.cliente, null),
    modoViaje: input?.modoViaje === "SOLO_CARGA" || input?.modoViaje === "SOLO_DESCARGA" ? input.modoViaje : "COMPLETO",
    notas: parseString(input?.notas, null),
    finLugar: parseString(input?.finLugar, null),
    finHora: parseString(input?.finHora, null),
    finViajeNota: parseString(input?.finViajeNota, null),
    estado: input?.estado === "COMPLETADO" ? "COMPLETADO" : "EN_CURSO",
    paradas,
    createdAt: parseString(input?.createdAt, now) || now,
    updatedAt: parseString(input?.updatedAt, now) || now,
  };
}

function normalizeFerryRest(input: any): FerryRestRecord {
  const now = new Date().toISOString();
  return {
    ...input,
    id: String(input?.id ?? randomId("ferry_rest")),
    fecha: toIsoDate(input?.fecha) || toIsoDate(String(input?.startTime || "").slice(0, 10)) || "1970-01-01",
    startTime: parseString(pick(input, "startTime", "start_time"), now) || now,
    endTime: parseString(pick(input, "endTime", "end_time"), undefined as any),
    restType: input?.restType === "11h" || input?.rest_type === "11h" ? "11h" : "9h",
    interruptions: Array.isArray(input?.interruptions) ? input.interruptions : [],
    interruptionTotalMin: parseNumber(pick(input, "interruptionTotalMin", "interruption_total_min"), 0) || 0,
    accumulatedRestMin: parseNumber(pick(input, "accumulatedRestMin", "accumulated_rest_min"), null) ?? undefined,
    linkedJornadaId: parseString(input?.linkedJornadaId, null) ?? undefined,
    isValid: parseBoolean(pick(input, "isValid", "valid"), true),
    isComplete: pick(input, "isComplete", "is_complete") == null ? undefined : parseBoolean(pick(input, "isComplete", "is_complete"), false),
    resumedPreviousJourney: pick(input, "resumedPreviousJourney") == null ? undefined : parseBoolean(pick(input, "resumedPreviousJourney"), false),
    invalidReason: parseString(pick(input, "invalidReason", "reason"), null),
    createdAt: parseString(pick(input, "createdAt", "created_at"), now) || now,
    destination: parseString(input?.destination, null) ?? undefined,
    ferryExtras: (pick(input, "ferryExtras", "ferry_extras") as FerryExtras | null | undefined) ?? undefined,
  };
}

function normalizeTachoActivity(input: any): TachoActivity {
  const now = new Date().toISOString();
  return {
    ...input,
    id: String(input?.id ?? randomId("tacho")),
    fecha: toIsoDate(input?.fecha) || "1970-01-01",
    tipo: input?.tipo === "pausa" || input?.tipo === "trabajo" ? input.tipo : "conduccion",
    inicio: parseString(input?.inicio, now) || now,
    fin: parseString(input?.fin, now) || now,
    duracionMin: parseNumber(pick(input, "duracionMin", "duracion_min"), 0) || 0,
    origen: parseString(input?.origen, null),
    destino: parseString(input?.destino, null),
    createdAt: parseString(pick(input, "createdAt", "created_at"), now) || now,
    updatedAt: parseString(pick(input, "updatedAt", "updated_at"), now) || now,
  };
}

function normalizeDayExtraEntry(input: any): DayExtraEntry {
  const now = new Date().toISOString();
  const entryType = input?.entryType === "offsite_weekly_rest" || input?.entry_type === "offsite_weekly_rest"
    ? "offsite_weekly_rest"
    : "day_extra";
  return {
    id: String(input?.id ?? randomId("day_extra")),
    date: toIsoDate(input?.date) || "1970-01-01",
    entryType,
    dayFlag: pick(input, "dayFlag", "day_flag") ?? null,
    offsiteRestType: pick(input, "offsiteRestType", "offsite_rest_type") ?? null,
    offsiteBase: pick(input, "offsiteBase", "offsite_base") ?? null,
    plusSunday: parseBoolean(pick(input, "plusSunday", "plus_sunday"), false),
    plusHoliday: parseBoolean(pick(input, "plusHoliday", "plus_holiday"), false),
    amount: parseNumber(input?.amount, null),
    note: parseString(input?.note, null),
    createdAt: parseString(pick(input, "createdAt", "created_at"), now) || now,
    updatedAt: parseString(pick(input, "updatedAt", "updated_at"), now) || now,
    syncStatus: "pending",
  };
}

function buildDayExtraCompositeKey(entry: Pick<DayExtraEntry, "date" | "entryType" | "note">): string {
  return [
    entry.date || "",
    entry.entryType || "",
    normalizeCompositeText(entry.note),
  ].join("|");
}

function parsePayloadObject(payload: any, source: "json" | "pdf", fileName: string, extraWarnings: ImportWarning[] = []): ParsedImportBundle {
  if (!payload || typeof payload !== "object") {
    throw new ImportError("json_invalid", "Los datos del PDF están incompletos");
  }

  const version = ensureCompatibleVersion(payload);
  const root = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const jornadasRaw: any[] = Array.isArray(root) ? root : Array.isArray(root?.jornadas) ? root.jornadas : [];
  const dayExtraEntriesRaw: any[] = Array.isArray(root?.dayExtraEntries) ? root.dayExtraEntries : Array.isArray(root?.extraDays) ? root.extraDays : [];
  const ferryRestsRaw: any[] = Array.isArray(root?.ferryRests) ? root.ferryRests : [];
  const viajesRaw: any[] = Array.isArray(root?.viajes) ? root.viajes : [];
  const tachoActivitiesRaw: any[] = Array.isArray(root?.tachoActivities) ? root.tachoActivities : [];

  const jornadas: Jornada[] = jornadasRaw.map((item: any) => normalizeJornada(item)).filter((j: Jornada) => !!j.fechaInicio && !!j.horaInicio);
  const dayExtraEntries: DayExtraEntry[] = dayExtraEntriesRaw.map((item: any) => normalizeDayExtraEntry(item));
  const ferryRests: FerryRestRecord[] = ferryRestsRaw.map((item: any) => normalizeFerryRest(item));
  const viajes: Viaje[] = viajesRaw.map((item: any) => normalizeViaje(item));
  const tachoActivities: TachoActivity[] = tachoActivitiesRaw.map((item: any) => normalizeTachoActivity(item));

  if (jornadas.length === 0 && dayExtraEntries.length === 0 && ferryRests.length === 0 && viajes.length === 0 && tachoActivities.length === 0) {
    throw new ImportError("pdf_incomplete", "Los datos del PDF están incompletos");
  }

  const rangeFrom = toIsoDate(root?.range?.from) || toIsoDate(payload?.range?.from) || (jornadas.length > 0 ? jornadas.map((j: Jornada) => j.fechaInicio).sort()[0] : null);
  const rangeTo = toIsoDate(root?.range?.to) || toIsoDate(payload?.range?.to) || (jornadas.length > 0 ? jornadas.map((j: Jornada) => j.fechaInicio).sort().slice(-1)[0] : null);
  const ownerHint = parseString(root?.driverName, null) || parseString(root?.userName, null) || parseString(root?.displayName, null) || parseString(payload?.driverName, null) || parseString(payload?.userName, null) || parseString(payload?.displayName, null);
  const totalDrivingMin = jornadas.reduce((sum: number, j: Jornada) => sum + (j.conduccionMin || 0), 0);
  const totalDurationMin = jornadas.reduce((sum: number, j: Jornada) => sum + (j.duracionJornadaMin || 0), 0);
  const totalDietas = jornadas.reduce((sum: number, j: Jornada) => sum + Number(j.dietaImporteEur || 0), 0);
  const totalExtras = jornadas.reduce((sum: number, j: Jornada) => sum + Number(j.dayExtraEur || 0), 0);
  const preview: ImportPreview = {
    periodLabel: rangeFrom && rangeTo ? `${formatDateLabel(rangeFrom)} - ${formatDateLabel(rangeTo)}` : "Periodo no detectado",
    jornadasCount: jornadas.length,
    specialRecordsCount: dayExtraEntries.length + ferryRests.length + tachoActivities.length,
    totalDrivingMin,
    totalDurationMin,
    totalDietas: Math.round(totalDietas * 100) / 100,
    totalExtras: Math.round(totalExtras * 100) / 100,
    totalPlus: 0,
    totalOverall: Math.round((totalDietas + totalExtras) * 100) / 100,
    from: rangeFrom,
    to: rangeTo,
    duplicateCount: 0,
  };

  return {
    source,
    fileName,
    version,
    generatedAt: parseString(root?.generatedAt, null) || parseString(payload?.generatedAt, null),
    range: { from: rangeFrom, to: rangeTo },
    jornadas,
    dayExtraEntries,
    ferryRests,
    viajes,
    tachoActivities,
    warnings: extraWarnings,
    duplicates: [],
    preview,
    ownerHint,
  };
}

async function analyzeDuplicates(bundle: ParsedImportBundle): Promise<ParsedImportBundle> {
  const [existingJornadas, existingDayExtraEntries] = await Promise.all([
    listarJornadas(),
    getAllDayExtraEntries(),
  ]);
  const existingById = new Map(existingJornadas.map((j) => [j.id, j]));
  const existingByComposite = new Map(existingJornadas.map((j) => [buildJornadaCompositeKey(j), j]));
  const existingDayExtraById = new Map(existingDayExtraEntries.map((entry) => [entry.id, entry]));
  const existingDayExtraByComposite = new Map(existingDayExtraEntries.map((entry) => [buildDayExtraCompositeKey(entry), entry]));

  const duplicates: ImportDuplicate[] = [];
  for (const jornada of bundle.jornadas) {
    const byId = existingById.get(jornada.id);
    if (byId) {
      duplicates.push({
        importedId: jornada.id,
        existingId: byId.id,
        by: "id",
        importedLabel: `${formatDateLabel(jornada.fechaInicio)} ${jornada.horaInicio}`,
      });
      continue;
    }
    const byContent = existingByComposite.get(buildJornadaCompositeKey(jornada));
    if (byContent) {
      duplicates.push({
        importedId: jornada.id,
        existingId: byContent.id,
        by: "content",
        importedLabel: `${formatDateLabel(jornada.fechaInicio)} ${jornada.horaInicio}`,
      });
    }
  }

  for (const entry of bundle.dayExtraEntries) {
    const byId = existingDayExtraById.get(entry.id);
    if (byId) {
      duplicates.push({
        importedId: entry.id,
        existingId: byId.id,
        by: "id",
        importedLabel: `${formatDateLabel(entry.date)} ${entry.entryType}`,
      });
      continue;
    }
    const byContent = existingDayExtraByComposite.get(buildDayExtraCompositeKey(entry));
    if (byContent) {
      duplicates.push({
        importedId: entry.id,
        existingId: byContent.id,
        by: "content",
        importedLabel: `${formatDateLabel(entry.date)} ${entry.entryType}`,
      });
    }
  }

  const warnings = [...bundle.warnings];
  if (duplicates.length > 0) {
    warnings.push({
      code: "duplicates_detected",
      message: "El archivo contiene jornadas duplicadas. Revísalas antes de importar.",
    });
  }

  return {
    ...bundle,
    warnings,
    duplicates,
    preview: {
      ...bundle.preview,
      duplicateCount: duplicates.length,
    },
  };
}

export async function parseImportDocument(params: ParseImportParams): Promise<ParsedImportBundle> {
  if (params.source === "json") {
    if (!params.text) throw new ImportError("json_invalid", "Los datos del PDF están incompletos");
    let payload: any;
    try {
      payload = JSON.parse(params.text);
    } catch {
      throw new ImportError("json_invalid", "Los datos del archivo están incompletos o no son válidos");
    }
    return analyzeDuplicates(parsePayloadObject(payload, "json", params.fileName));
  }

  if (params.extractedPdfText) {
    try {
      const visible = parseTacoplanReport(params.extractedPdfText);
      // #region debug-point A:import-visible-result
      fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"pdf-incomplete-import",runId:"pre",hypothesisId:"A",location:"lib/import-service.ts:669",msg:"[DEBUG] Resultado parser visible en parseImportDocument",data:{fileName:params.fileName,jornadas:visible.jornadas.length,specials:visible.dayExtraEntries.length,errors:visible.errors,totalDietas:visible.totalDietas,totalExtras:visible.totalExtras},ts:Date.now()})}).catch(()=>{});
      // #endregion
      const recognisable = visible.diagnostics.sections.historial || visible.diagnostics.sections.resumen || visible.diagnostics.sections.detalle;
      if (visible.jornadas.length > 0 || visible.dayExtraEntries.length > 0 || recognisable) {
        // #region debug-point C:import-visible-accepted
        fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"pdf-incomplete-import",runId:"pre",hypothesisId:"C",location:"lib/import-service.ts:672",msg:"[DEBUG] Se acepta la ruta visible del informe",data:{fileName:params.fileName,jornadas:visible.jornadas.length,specials:visible.dayExtraEntries.length,warningCount:visible.errors.length},ts:Date.now()})}).catch(()=>{});
        // #endregion
        return analyzeDuplicates(buildVisiblePdfBundle(
          params.fileName,
          visible,
          visible.errors.length > 0 || visible.jornadas.length === 0
            ? [{
                code: visible.jornadas.length === 0 && visible.dayExtraEntries.length === 0 ? "diagnostic_preview" : "legacy_pdf_review",
                message: visible.jornadas.length === 0 && visible.dayExtraEntries.length === 0
                  ? "Se ha detectado la estructura del informe, pero no todas las jornadas se han podido reconstruir. Se muestra una vista previa de diagnóstico."
                  : "Se ha cargado la vista previa desde la informacion visible del informe. Conviene revisarla antes de importar.",
              }]
            : [],
        ));
      }
    } catch {
      // #region debug-point D:import-visible-exception
      fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"pdf-incomplete-import",runId:"pre",hypothesisId:"D",location:"lib/import-service.ts:704",msg:"[DEBUG] Excepcion en parseImportDocument al usar parser visible",data:{fileName:params.fileName},ts:Date.now()})}).catch(()=>{});
      // #endregion
      if (hasRecognizableTacoplanSections(params.extractedPdfText)) {
        return buildDiagnosticPreviewBundle(params.fileName, params.extractedPdfText, "Se ha detectado texto del informe Tacoplan, pero el parser visible lanzó una excepción. Se muestra una vista previa de diagnóstico.");
      }
      // Keep the embedded backup path and the fallback path available.
    }
  }

  const candidateTexts = [params.extractedPdfText, params.text];
  let sawMarker = false;
  let lastMarkerError: ImportError | null = null;
  let shouldUseLegacyFallbackForTruncatedBackup = false;
  for (const candidate of candidateTexts) {
    if (!candidate) continue;
    const base64Candidates = extractTacoplanBase64Candidates(candidate);
    if (base64Candidates.length === 0) continue;
    sawMarker = true;
    for (const base64 of base64Candidates) {
      try {
        const payload = tryParsePdfPayload(base64);
        return analyzeDuplicates(parsePayloadObject(payload, "pdf", params.fileName));
      } catch (error: any) {
        if (!(error instanceof ImportError) || error.code === "pdf_incomplete" || error.code === "decode_failed") {
          shouldUseLegacyFallbackForTruncatedBackup = true;
        }
        lastMarkerError = error instanceof ImportError
          ? error
          : new ImportError("pdf_incomplete", "Los datos del PDF están incompletos");
      }
    }
  }

  if (params.bytes) {
    const rawText = decodeBytesAsLatin1(params.bytes);
    const base64Candidates = extractTacoplanBase64Candidates(rawText);
    if (base64Candidates.length > 0) {
      sawMarker = true;
      for (const base64 of base64Candidates) {
        try {
          const payload = tryParsePdfPayload(base64);
          return analyzeDuplicates(parsePayloadObject(payload, "pdf", params.fileName));
        } catch (error: any) {
          if (!(error instanceof ImportError) || error.code === "pdf_incomplete" || error.code === "decode_failed") {
            shouldUseLegacyFallbackForTruncatedBackup = true;
          }
          lastMarkerError = error instanceof ImportError
            ? error
            : new ImportError("pdf_incomplete", "Los datos del PDF están incompletos");
        }
      }
    }
  }

  if (params.legacyFallback && params.bytes) {
    const legacy = await params.legacyFallback(params.bytes);
    if (legacy) {
      const bundle = parsePayloadObject(
        {
          version: 1,
          generatedAt: new Date().toISOString(),
          jornadas: legacy.jornadas || [],
          dayExtraEntries: legacy.dayExtraEntries || [],
          ferryRests: legacy.ferryRests || [],
          viajes: legacy.viajes || [],
          tachoActivities: legacy.tachoActivities || [],
        },
        "pdf",
        params.fileName,
        [
          shouldUseLegacyFallbackForTruncatedBackup
            ? {
                code: "embedded_backup_truncated",
                message: "El backup completo del PDF esta truncado. Se ha cargado una vista previa desde la tabla del informe y conviene revisarla antes de importar.",
              }
            : {
                code: "legacy_pdf_review",
                message: "Este informe no contiene un backup completo. Revisa los datos antes de importarlos.",
              },
        ],
      );
      bundle.diagnostics = params.extractedPdfText ? buildRawPdfDiagnostics(params.extractedPdfText) : null;
      return analyzeDuplicates(bundle);
    }
  }

  if (lastMarkerError) {
    if (params.extractedPdfText && hasRecognizableTacoplanSections(params.extractedPdfText)) {
      return buildDiagnosticPreviewBundle(params.fileName, params.extractedPdfText, "El backup embebido del PDF está incompleto, pero se ha detectado un informe Tacoplan legible y se muestra una vista previa de diagnóstico.");
    }
    // #region debug-point C:last-marker-error
    fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"pdf-incomplete-import",runId:"pre",hypothesisId:"C",location:"lib/import-service.ts:786",msg:"[DEBUG] Se retorna ultimo error del backup embebido",data:{fileName:params.fileName,code:lastMarkerError.code,message:lastMarkerError.message,sawMarker,shouldUseLegacyFallbackForTruncatedBackup},ts:Date.now()})}).catch(()=>{});
    // #endregion
    throw lastMarkerError;
  }
  if (sawMarker) {
    throw new ImportError("decode_failed", "No se ha podido decodificar el archivo");
  }
  throw new ImportError("pdf_no_export_data", "Este PDF no contiene datos exportables de Tacoplan");
}

async function buildSnapshot(): Promise<Snapshot> {
  const [jornadas, dayExtraEntries, ferryRests, viajes, tachoActivities] = await Promise.all([
    listarJornadas(),
    getAllDayExtraEntries(),
    getAllFerryRests(),
    getAllViajes(),
    getAllTachoActivities(),
  ]);
  return { jornadas, dayExtraEntries, ferryRests, viajes, tachoActivities };
}

async function saveBackup(snapshot: Snapshot, bundle: ParsedImportBundle): Promise<void> {
  const payload = {
    createdAt: new Date().toISOString(),
    fileName: bundle.fileName,
    source: bundle.source,
    preview: bundle.preview,
    data: snapshot,
  };
  await AsyncStorage.setItem(await userScopedKey(IMPORT_BACKUP_KEY), JSON.stringify(payload));
}

async function restoreSnapshot(snapshot: Snapshot): Promise<void> {
  await replaceImportedJornadas(snapshot.jornadas);
  await replaceImportedDayExtraEntries(snapshot.dayExtraEntries);
  await replaceImportedFerryRests(snapshot.ferryRests);
  await replaceImportedViajes(snapshot.viajes);
  await replaceImportedTachoActivities(snapshot.tachoActivities);
}

function cloneForPendingSync<T extends { updatedAt?: string; syncStatus?: string }>(item: T): T {
  return {
    ...item,
    updatedAt: item.updatedAt || new Date().toISOString(),
    syncStatus: "pending",
  };
}

function mergeJornadas(existing: Jornada[], imported: Jornada[], mode: ImportMode) {
  const next = [...existing];
  const byId = new Map(next.map((j, index) => [j.id, index]));
  const byComposite = new Map(next.map((j, index) => [buildJornadaCompositeKey(j), index]));
  let added = 0;
  let overwritten = 0;
  let skipped = 0;

  for (const jornada of imported) {
    const byIdIndex = byId.get(jornada.id);
    const compositeKey = buildJornadaCompositeKey(jornada);
    const byContentIndex = byComposite.get(compositeKey);

    if (byIdIndex != null) {
      if (mode === "new_only") {
        skipped++;
        continue;
      }
      next[byIdIndex] = cloneForPendingSync(jornada);
      overwritten++;
      continue;
    }

    if (byContentIndex != null) {
      if (mode === "new_only") {
        skipped++;
        continue;
      }
      if (mode === "overwrite_matching") {
        const existingId = next[byContentIndex].id;
        next[byContentIndex] = cloneForPendingSync({ ...jornada, id: existingId });
        overwritten++;
        continue;
      }
    }

    next.push(cloneForPendingSync(jornada));
    added++;
  }

  next.sort((a, b) => b.startAt.localeCompare(a.startAt));
  return { next, added, overwritten, skipped };
}

function mergeDayExtraEntries(existing: DayExtraEntry[], imported: DayExtraEntry[], mode: ImportMode) {
  const next = [...existing];
  const byId = new Map(next.map((entry, index) => [entry.id, index]));
  const byComposite = new Map(next.map((entry, index) => [buildDayExtraCompositeKey(entry), index]));
  let added = 0;
  let overwritten = 0;
  let skipped = 0;

  for (const entry of imported) {
    const byIdIndex = byId.get(entry.id);
    const byContentIndex = byComposite.get(buildDayExtraCompositeKey(entry));

    if (byIdIndex != null) {
      if (mode === "new_only") {
        skipped++;
        continue;
      }
      next[byIdIndex] = cloneForPendingSync(entry);
      overwritten++;
      continue;
    }

    if (byContentIndex != null) {
      if (mode === "new_only") {
        skipped++;
        continue;
      }
      if (mode === "overwrite_matching") {
        const existingId = next[byContentIndex].id;
        next[byContentIndex] = cloneForPendingSync({ ...entry, id: existingId });
        overwritten++;
        continue;
      }
    }

    next.push(cloneForPendingSync(entry));
    added++;
  }

  next.sort((a, b) => b.date.localeCompare(a.date));
  return { next, added, overwritten, skipped };
}

function mergeById<T extends { id: string }>(existing: T[], imported: T[], mode: ImportMode) {
  const next = [...existing];
  const byId = new Map(next.map((item, index) => [item.id, index]));
  let added = 0;
  let overwritten = 0;
  let skipped = 0;

  for (const item of imported) {
    const idx = byId.get(item.id);
    if (idx != null) {
      if (mode === "new_only") {
        skipped++;
        continue;
      }
      next[idx] = item;
      overwritten++;
      continue;
    }
    next.push(item);
    added++;
  }

  return { next, added, overwritten, skipped };
}

function logManualVsImportedComparison(existing: Jornada[], imported: Jornada[]): void {
  const manualReference =
    existing.find((item) => item.fechaInicio === "2026-07-14" && !String(item.id || "").startsWith("pdf_")) ||
    existing.find((item) => !String(item.id || "").startsWith("pdf_"));
  const importedReference =
    imported.find((item) => item.fechaInicio === "2026-07-12") ||
    imported[0];

  if (!manualReference || !importedReference) return;

  const fieldNames = [
    "fechaInicio",
    "horaInicio",
    "lugarInicio",
    "fechaFin",
    "horaFin",
    "lugarFin",
    "tipoRuta",
    "pernocta",
    "dietaModo",
    "dietaImporteEur",
    "dietBaseEur",
    "dietaPercent",
    "dietRule",
    "dietasItems",
    "dayFlag",
    "dayExtraEur",
    "plusItems",
    "legalSummary",
  ] as const;

  const rows = fieldNames.map((field) => {
    const manualValue = (manualReference as any)[field];
    const importedValue = (importedReference as any)[field];
    let correction = "OK";
    if (field === "lugarInicio" || field === "lugarFin") {
      correction = /[€%]|\b\d+h(?:\s*\d{1,2}m)?\b/i.test(String(importedValue || "")) ? "Separar lugar y datos económicos" : "Normalizar lugar";
    } else if (field === "legalSummary") {
      correction = importedValue ? "OK" : "Recalcular resumen legal";
    } else if (manualValue == null && importedValue != null) {
      correction = "Revisar si el campo debe existir también en manual";
    } else if (manualValue != null && importedValue == null) {
      correction = "Completar campo faltante";
    } else if (typeof manualValue !== typeof importedValue) {
      correction = "Alinear tipo";
    } else if (JSON.stringify(manualValue) !== JSON.stringify(importedValue)) {
      correction = "Alinear valor al modelo manual";
    }

    return {
      campo: field,
      manual: typeof manualValue === "object" ? JSON.stringify(manualValue) : manualValue,
      importada: typeof importedValue === "object" ? JSON.stringify(importedValue) : importedValue,
      correccion: correction,
    };
  });

  // #region debug-point D:manual-vs-imported
  reportPdfDietDebug("D", "import-service:logManualVsImportedComparison:manual", "manual reference object", {
    jornada: manualReference,
  });
  reportPdfDietDebug("D", "import-service:logManualVsImportedComparison:imported", "imported reference object", {
    jornada: importedReference,
  });
  reportPdfDietDebug("D", "import-service:logManualVsImportedComparison:diff", "manual vs imported diet comparison", {
    rows,
  });
  // #endregion
}

async function syncImportedData(bundle: ParsedImportBundle, getAccessToken: (() => Promise<string | null>) | null | undefined): Promise<boolean> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user || !getAccessToken) return false;

  await syncWithCloud(getAccessToken);

  if (bundle.ferryRests.length > 0) {
    const ferryRows = bundle.ferryRests.map((rest) => ({
      id: rest.id,
      user_id: session.user.id,
      fecha: rest.fecha,
      start_time: rest.startTime,
      end_time: rest.endTime ?? null,
      rest_type: rest.restType,
      interruptions: rest.interruptions ?? [],
      interruption_total_min: rest.interruptionTotalMin ?? 0,
      accumulated_rest_min: rest.accumulatedRestMin ?? null,
      computed_end: rest.endTime ?? null,
      valid: rest.isValid,
      reason: rest.invalidReason,
      destination: rest.destination ?? null,
      ferry_extras: rest.ferryExtras ?? null,
      is_complete: rest.isComplete ?? null,
      updated_at: rest.createdAt ?? new Date().toISOString(),
      created_at: rest.createdAt ?? new Date().toISOString(),
    }));
    const { error } = await supabase.from("ferry_rests").upsert(ferryRows, { onConflict: "id" });
    if (error) throw error;
  }

  if (bundle.viajes.length > 0) {
    const viajesRows = bundle.viajes.map((viaje) => ({
      id: viaje.id,
      user_id: session.user.id,
      cliente: viaje.cliente,
      notas: viaje.notas,
      modo_viaje: viaje.modoViaje,
      estado: viaje.estado,
      paradas: viaje.paradas,
      fin_lugar: viaje.finLugar,
      fin_hora: viaje.finHora,
      fin_viaje_nota: viaje.finViajeNota,
      jornada_id: null,
      updated_at: viaje.updatedAt,
      created_at: viaje.createdAt,
    }));
    const { error } = await supabase.from("viajes").upsert(viajesRows, { onConflict: "id" });
    if (error) throw error;
  }

  if (bundle.tachoActivities.length > 0) {
    const activityRows = bundle.tachoActivities.map((activity) => ({
      id: activity.id,
      user_id: session.user.id,
      fecha: activity.fecha,
      tipo: activity.tipo,
      inicio: activity.inicio,
      fin: activity.fin,
      duracion_min: activity.duracionMin,
      origen: activity.origen,
      destino: activity.destino,
      source: "pdf",
      created_at: activity.createdAt,
      updated_at: activity.updatedAt,
    }));
    const { error } = await supabase.from("tacho_activities").upsert(activityRows, { onConflict: "id" });
    if (error) throw error;
  }

  return true;
}

export async function applyImportBundle(
  bundle: ParsedImportBundle,
  mode: ImportMode,
  getAccessToken?: (() => Promise<string | null>) | null,
): Promise<ImportApplyResult> {
  const snapshot = await buildSnapshot();
  await saveBackup(snapshot, bundle);

  const preparedImportedJornadas = bundle.source === "pdf"
    ? await prepareImportedJornadasForStorage(bundle.jornadas, snapshot.jornadas)
    : bundle.jornadas;

  if (bundle.source === "pdf") {
    logManualVsImportedComparison(snapshot.jornadas, preparedImportedJornadas);
  }

  if (bundle.source === "pdf") {
    for (const jornada of preparedImportedJornadas) {
      // #region debug-point A:pdf-before-save
      reportPdfDietDebug("A", "import-service:applyImportBundle:before-save", "prepared imported jornada before save", {
        fecha: jornada.fechaInicio,
        lugarInicioOriginal: jornada.lugarInicio,
        lugarInicioNormalizado: normalizeLocationText(jornada.lugarInicio),
        lugarFinOriginal: jornada.lugarFin,
        lugarFinNormalizado: jornada.lugarFin ? normalizeLocationText(jornada.lugarFin) : null,
        dietaExtraida: jornada.dietaImporteEur,
        dietaBase: jornada.dietBaseEur,
        porcentaje: jornada.dietaPercent,
        extra: jornada.dayExtraEur,
        total: jornada.dietaImporteEur,
        objetoFinal: jornada,
      });
      // #endregion
    }
  }

  const mergedJornadas = mergeJornadas(snapshot.jornadas, preparedImportedJornadas, mode);
  const mergedDayExtraEntries = mergeDayExtraEntries(snapshot.dayExtraEntries, bundle.dayExtraEntries, mode);
  const mergedFerryRests = mergeById(snapshot.ferryRests, bundle.ferryRests, mode);
  const mergedViajes = mergeById(snapshot.viajes, bundle.viajes, mode);
  const mergedActivities = mergeById(snapshot.tachoActivities, bundle.tachoActivities, mode);

  try {
    await replaceImportedJornadas(mergedJornadas.next);
    await replaceImportedDayExtraEntries(mergedDayExtraEntries.next);
    await replaceImportedFerryRests(mergedFerryRests.next);
    await replaceImportedViajes(mergedViajes.next);
    await replaceImportedTachoActivities(mergedActivities.next);
  } catch (error) {
    await restoreSnapshot(snapshot);
    throw error;
  }

  if (bundle.source === "pdf") {
    const persisted = await listarJornadas();
    const importedIds = new Set(preparedImportedJornadas.map((jornada) => jornada.id));
    for (const jornada of persisted.filter((item) => importedIds.has(item.id))) {
      // #region debug-point A:pdf-after-save
      reportPdfDietDebug("A", "import-service:applyImportBundle:after-save", "persisted imported jornada after save", {
        fecha: jornada.fechaInicio,
        lugarInicio: jornada.lugarInicio,
        lugarFin: jornada.lugarFin,
        dietaImporteEur: jornada.dietaImporteEur,
        dietBaseEur: jornada.dietBaseEur,
        dietaPercent: jornada.dietaPercent,
        dayExtraEur: jornada.dayExtraEur,
        plusItems: jornada.plusItems,
        dietasItems: jornada.dietasItems,
        dietRule: jornada.dietRule,
        dayFlag: jornada.dayFlag,
      });
      // #endregion
    }
  }

  let syncSucceeded = false;
  try {
    syncSucceeded = await syncImportedData(bundle, getAccessToken);
  } catch {
    syncSucceeded = false;
  }

  return {
    added: {
      jornadas: mergedJornadas.added,
      dayExtraEntries: mergedDayExtraEntries.added,
      ferryRests: mergedFerryRests.added,
      viajes: mergedViajes.added,
      tachoActivities: mergedActivities.added,
    },
    overwritten: {
      jornadas: mergedJornadas.overwritten,
      dayExtraEntries: mergedDayExtraEntries.overwritten,
      ferryRests: mergedFerryRests.overwritten,
      viajes: mergedViajes.overwritten,
      tachoActivities: mergedActivities.overwritten,
    },
    skipped: {
      jornadas: mergedJornadas.skipped,
      dayExtraEntries: mergedDayExtraEntries.skipped,
      ferryRests: mergedFerryRests.skipped,
      viajes: mergedViajes.skipped,
      tachoActivities: mergedActivities.skipped,
    },
    syncAttempted: !!getAccessToken,
    syncSucceeded,
    backupCreated: true,
  };
}

export function buildImportSummaryMessage(bundle: ParsedImportBundle, result: ImportApplyResult): string {
  const parts = [
    `Jornadas nuevas: ${result.added.jornadas}`,
    `sobrescritas: ${result.overwritten.jornadas}`,
    `omitidas: ${result.skipped.jornadas}`,
  ];
  if (bundle.dayExtraEntries.length > 0 || bundle.ferryRests.length > 0) {
    parts.push(`registros especiales: ${result.added.dayExtraEntries + result.overwritten.dayExtraEntries + result.added.ferryRests + result.overwritten.ferryRests}`);
  }
  if (bundle.viajes.length > 0) parts.push(`viajes: ${result.added.viajes + result.overwritten.viajes}`);
  if (bundle.tachoActivities.length > 0) parts.push(`actividades: ${result.added.tachoActivities + result.overwritten.tachoActivities}`);
  if (result.syncAttempted && !result.syncSucceeded) {
    parts.push("sync pendiente");
  }
  return parts.join(" · ");
}

export function formatPreviewLines(preview: ImportPreview): string[] {
  return [
    `Periodo: ${preview.periodLabel}`,
    `Jornadas: ${preview.jornadasCount}`,
    `Especiales: ${preview.specialRecordsCount}`,
    `Conducción total: ${formatMinutes(preview.totalDrivingMin)}`,
    `Duración total: ${formatMinutes(preview.totalDurationMin)}`,
    `Dietas: ${formatMoney(preview.totalDietas)}`,
    `Extras: ${formatMoney(preview.totalExtras)}`,
    `Plus: ${formatMoney(preview.totalPlus)}`,
    `Total: ${formatMoney(preview.totalOverall)}`,
  ];
}
