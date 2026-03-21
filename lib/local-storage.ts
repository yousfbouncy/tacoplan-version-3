import AsyncStorage from "@react-native-async-storage/async-storage";
import { evaluateJornada, getJornadaDrivingForWeek, jornadaOverlapsWeek, computeReducidosSinceLastWeeklyRest, type LegalSummary } from "./legalEngine";

const JORNADAS_KEY = "tacoplan_jornadas";
const COMPENSACIONES_KEY = "tacoplan_compensaciones";
const RECENT_PLACES_KEY = "tacoplan_recent_places";
const MOROCCO_TRIPS_KEY = "tacoplan_morocco_trips";
const FERRY_RESTS_KEY = "tacoplan_ferry_rests";
const ACTIVE_FERRY_REST_KEY = "tacoplan_active_ferry_rest";

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
}

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
  duracionJornadaMin: number | null;
  countsAsDailyReduced: boolean;
  plannedRestMin: number | null;
  plannedRestType: "daily" | "weekly" | null;
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
}

export interface Compensacion {
  id: string;
  jornadaId: string | null;
  horasDeuda: number;
  minutosDeuda: number;
  fechaLimite: string;
  compensada: boolean;
  fechaCompensacion: string | null;
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

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return formatDateStr(d);
}

function buildIsoTimestamp(fecha: string, hora: string): string {
  return `${fecha}T${hora}:00`;
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

async function getAllJornadas(): Promise<Jornada[]> {
  const raw = await AsyncStorage.getItem(JORNADAS_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return parsed.map(migrateJornada);
}

function migrateJornada(j: any): Jornada {
  const migrated: Jornada = {
    ...j,
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

  return migrated;
}

async function saveAllJornadas(list: Jornada[]): Promise<void> {
  await AsyncStorage.setItem(JORNADAS_KEY, JSON.stringify(list));
}

async function getAllCompensaciones(): Promise<Compensacion[]> {
  const raw = await AsyncStorage.getItem(COMPENSACIONES_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return parsed.map(migrateCompensacion);
}

export async function listarCompensaciones(): Promise<Compensacion[]> {
  return getAllCompensaciones();
}

function migrateCompensacion(c: any): Compensacion {
  return {
    ...c,
    updatedAt: c.updatedAt || new Date().toISOString(),
    syncStatus: c.syncStatus || "local",
  };
}

async function saveAllCompensaciones(list: Compensacion[]): Promise<void> {
  await AsyncStorage.setItem(COMPENSACIONES_KEY, JSON.stringify(list));
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
      const pct = dietaPercent || 100;
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
    conduccionMin?: number;
    conduccionDomingoMin?: number;
    conduccionLunesMin?: number;
    dietaPercent?: number;
    dayFlag?: string;
    customRates?: UserDietRate[];
    dayExtras?: UserDayExtras;
    holidays?: string[];
    observaciones?: string;
  },
): Partial<Jornada> {
  const startAt = jornada.startAt;

  let resolvedFechaFin = closeData.fechaFin;
  if (resolvedFechaFin === jornada.fechaInicio && closeData.horaFin < jornada.horaInicio) {
    resolvedFechaFin = addDays(resolvedFechaFin, 1);
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
      tipoDescansoAnterior = clasificarDescanso(descansoAnteriorMin);
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
    ruleParts.push(`${closeData.tipoRuta} ${closeData.dietaPercent ?? 100}%`);
  }
  if (resolvedDayFlag) {
    const flagLabels: Record<string, string> = { SABADO: "SABADO", DOMINGO: "DOMINGO", FESTIVO: "FESTIVO" };
    ruleParts.push(`+ ${flagLabels[resolvedDayFlag] || resolvedDayFlag}`);
  }
  const dietRule = ruleParts.join(" ");

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
    dietaPercent: closeData.dietaPercent ?? null,
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
    duracionJornadaMin,
    countsAsDailyReduced,
    conduccionMin: closeData.conduccionMin || null,
    conduccionDomingoMin: closeData.conduccionDomingoMin ?? null,
    conduccionLunesMin: closeData.conduccionLunesMin ?? null,
    observaciones: closeData.observaciones || null,
    updatedAt: new Date().toISOString(),
    syncStatus: "pending" as const,
  };
}

async function processCompensaciones(
  descansoAnteriorMin: number | null,
  tipoDescansoAnterior: string | null,
  jornadaId: string,
  fechaInicio: string,
): Promise<void> {
  let comps = await getAllCompensaciones();

  if (descansoAnteriorMin != null && descansoAnteriorMin > 0) {
    const pendientes = comps
      .filter((c) => !c.compensada)
      .sort((a, b) => a.fechaLimite.localeCompare(b.fechaLimite));

    if (pendientes.length > 0) {
      const totalDeudaMin = pendientes.reduce(
        (sum, c) => sum + c.horasDeuda * 60 + c.minutosDeuda,
        0,
      );
      if (descansoAnteriorMin >= 9 * 60 + totalDeudaMin) {
        const now = new Date().toISOString();
        for (const c of pendientes) {
          c.compensada = true;
          c.fechaCompensacion = fechaInicio;
          c.updatedAt = now;
          c.syncStatus = "pending";
        }
        await saveAllCompensaciones(comps);
      }
    }
  }

  if (
    tipoDescansoAnterior === "DESCANSO_SEMANAL_REDUCIDO" &&
    descansoAnteriorMin != null
  ) {
    const deudaMin = 45 * 60 - descansoAnteriorMin;
    if (deudaMin > 0) {
      comps = await getAllCompensaciones();
      const existingPending = comps
        .filter((c) => !c.compensada)
        .sort((a, b) => a.fechaLimite.localeCompare(b.fechaLimite));

      let fechaLimite: string;
      if (existingPending.length > 0) {
        fechaLimite = existingPending[0].fechaLimite;
      } else {
        fechaLimite = addDays(fechaInicio, 14);
      }

      const newComp: Compensacion = {
        id: generateId(),
        jornadaId,
        horasDeuda: Math.floor(deudaMin / 60),
        minutosDeuda: deudaMin % 60,
        fechaLimite,
        compensada: false,
        fechaCompensacion: null,
        updatedAt: new Date().toISOString(),
        syncStatus: "pending",
      };

      comps.push(newComp);
      await saveAllCompensaciones(comps);
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

  let descansoAnteriorMin: number | null = null;
  let tipoDescansoAnterior: string | null = null;
  let previousRestSource: "normal_gap" | "ferry_rest" | null = null;
  let previousRestId: string | null = null;
  let previousRestValid: boolean | null = null;

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
      tipoDescansoAnterior = clasificarDescanso(descansoAnteriorMin);
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
    duracionJornadaMin: null,
    countsAsDailyReduced: false,
    plannedRestMin: null,
    plannedRestType: null,
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
    legalSummary: null,
    updatedAt: new Date().toISOString(),
    syncStatus: "pending",
  };

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
  },
): Promise<Jornada> {
  const all = await getAllJornadas();
  const idx = all.findIndex((j) => j.id === id);
  if (idx === -1) throw new Error("Jornada no encontrada");
  if (all[idx].fechaFin) throw new Error("Jornada ya cerrada");

  const jornada = all[idx];
  const others = all.filter((j) => j.id !== id);
  const derived = computeDerivedFields(jornada, others, data);

  const merged = { ...jornada, ...derived };
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
      merged.dietasItems = [{ tipo: "MOROCCO_TRIP", pct: 100, importe: data.moroccoTripRate }];
    }
  }
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
  };

  all[idx] = merged;
  await saveAllJornadas(all);
  await processCompensaciones(
    derived.descansoAnteriorMin!,
    derived.tipoDescansoAnterior!,
    id,
    jornada.fechaInicio,
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
  };

  all[idx] = editMerged;
  await saveAllJornadas(all);

  await saveAllCompensaciones(compsFiltered);

  await processCompensaciones(
    derived.descansoAnteriorMin!,
    derived.tipoDescansoAnterior!,
    id,
    data.fechaInicio,
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
): Promise<void> {
  const all = await getAllJornadas();
  const idx = all.findIndex((j) => j.id === id);
  if (idx === -1) return;
  all[idx].plannedRestMin = plannedRestMin;
  all[idx].plannedRestType = plannedRestType;
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
      j.tipoDescansoAnterior = clasificarDescanso(j.descansoAnteriorMin);
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
    (j) => j.fechaFin && j.fechaInicio >= from && j.fechaInicio <= to,
  );

  const desglose: Record<string, { cantidad: number; total: number }> = {};
  const extrasDesglose: Record<string, { cantidad: number; total: number }> = {};
  let totalGeneral = 0;
  let totalExtras = 0;
  let totalPlus = 0;
  const plusDesglose: Record<string, { cantidad: number; total: number }> = {};

  for (const j of jornadasPeriodo) {
    if (j.plusItems && j.plusItems.length > 0) {
      for (const pi of j.plusItems) {
        totalPlus = Math.round((totalPlus + pi.importe) * 100) / 100;
        if (!plusDesglose[pi.concepto]) plusDesglose[pi.concepto] = { cantidad: 0, total: 0 };
        plusDesglose[pi.concepto].cantidad++;
        plusDesglose[pi.concepto].total = Math.round((plusDesglose[pi.concepto].total + pi.importe) * 100) / 100;
      }
    }
    if (j.dayFlag && j.dayExtraEur) {
      const extraImporte = parseFloat(j.dayExtraEur);
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

export async function getEstadoLegal(): Promise<EstadoLegal> {
  const ahora = new Date();
  const lunes = getMondayOfWeek(ahora);
  const domingo = getSundayOfWeek(ahora);
  const lunesStr = formatDateStr(lunes);
  const domingoStr = formatDateStr(domingo);

  const lunesAnterior = new Date(lunes);
  lunesAnterior.setDate(lunesAnterior.getDate() - 7);
  const lunesAnteriorStr = formatDateStr(lunesAnterior);

  const all = await getAllJornadas();

  for (const j of all) {
    if (!j.endAt) continue;
    const anterior = findPreviousClosed(
      all.filter((o) => o.id !== j.id),
      j.startAt,
    );
    if (anterior && anterior.endAt) {
      j.descansoAnteriorMin = calcMinutesBetween(anterior.endAt, j.startAt);
      j.tipoDescansoAnterior = clasificarDescanso(j.descansoAnteriorMin);
    }
  }

  const domingoAnteriorStr = formatDateStr(new Date(lunes.getTime() - 86400000));

  const jornadasSemana = all.filter(
    (j) => j.fechaFin && (
      (j.fechaInicio >= lunesStr && j.fechaInicio <= domingoStr) ||
      jornadaOverlapsWeek(j, lunesStr, domingoStr)
    ),
  );

  const jornadasBisemana = all.filter(
    (j) => j.fechaFin && (
      (j.fechaInicio >= lunesAnteriorStr && j.fechaInicio <= domingoStr) ||
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
  const descansosReducidos = computeReducidosSinceLastWeeklyRest(
    all,
    abierta ? { descansoAnteriorMin: abierta.descansoAnteriorMin } : null,
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
  const compPendientes = comps
    .filter((c) => !c.compensada)
    .sort((a, b) => a.fechaLimite.localeCompare(b.fechaLimite));

  const hoyStr = formatDateStr(ahora);

  let compensacionAgregada: CompensacionAgregada | null = null;

  if (compPendientes.length > 0) {
    let totalDeudaMin = 0;
    const detalle: CompensacionAgregada["detalle"] = [];
    const ids: string[] = [];

    for (const c of compPendientes) {
      totalDeudaMin += c.horasDeuda * 60 + c.minutosDeuda;
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
        horasDeuda: c.horasDeuda,
        minutosDeuda: c.minutosDeuda,
        fechaDescanso,
      });
    }

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
    if (compensacionAgregada.vencida) {
      alertas.push({
        tipo: "danger",
        mensaje: `INFRACCION: ${compensacionAgregada.totalDeudaHoras}h ${compensacionAgregada.totalDeudaMinutos}m de descanso reducido no compensado (limite: ${compensacionAgregada.fechaLimite})`,
      });
    } else {
      alertas.push({
        tipo: "warning",
        mensaje: `Compensar ${compensacionAgregada.totalDeudaHoras}h ${compensacionAgregada.totalDeudaMinutos}m antes del ${compensacionAgregada.fechaLimite}`,
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
}> {
  const jornadas = await getAllJornadas();
  const compensaciones = await getAllCompensaciones();
  return {
    jornadas: jornadas.filter((j) => j.syncStatus === "pending" || j.syncStatus === "local"),
    compensaciones: compensaciones.filter((c) => c.syncStatus === "pending" || c.syncStatus === "local"),
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
}

export async function mergeFromCloud(cloudJornadas: Jornada[], cloudCompensaciones: Compensacion[]): Promise<void> {
  const localJornadas = await getAllJornadas();
  const localComps = await getAllCompensaciones();

  const cloudJIds = new Set(cloudJornadas.map((cj) => cj.id));
  const cloudCIds = new Set(cloudCompensaciones.map((cc) => cc.id));

  const localSyncedCount = localJornadas.filter((j) => j.syncStatus === "synced").length;
  const cloudIsEmpty = cloudJornadas.length === 0 && cloudCompensaciones.length === 0;
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

  await saveAllJornadas(Array.from(jMap.values()));
  await saveAllCompensaciones(Array.from(cMap.values()));
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
    const raw = await AsyncStorage.getItem(RECENT_PLACES_KEY);
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
  await AsyncStorage.setItem(RECENT_PLACES_KEY, JSON.stringify(updated));
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
  const raw = await AsyncStorage.getItem(VIAJES_KEY);
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
  await AsyncStorage.setItem(VIAJES_KEY, JSON.stringify(list));
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
    const raw = await AsyncStorage.getItem(VIAJE_PLACES_KEY);
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
  await AsyncStorage.setItem(VIAJE_PLACES_KEY, JSON.stringify(updated));
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
    const raw = await AsyncStorage.getItem(MOROCCO_TRIPS_KEY);
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
  await AsyncStorage.setItem(MOROCCO_TRIPS_KEY, JSON.stringify(all));
  return newTrip;
}

export async function updateMoroccoTrip(id: string, updates: Partial<MoroccoTrip>): Promise<void> {
  const all = await getAllMoroccoTrips();
  const idx = all.findIndex((t) => t.id === id);
  if (idx === -1) return;
  all[idx] = { ...all[idx], ...updates, updatedAt: new Date().toISOString() };
  await AsyncStorage.setItem(MOROCCO_TRIPS_KEY, JSON.stringify(all));
}

export async function deleteMoroccoTrip(id: string): Promise<void> {
  const all = await getAllMoroccoTrips();
  const filtered = all.filter((t) => t.id !== id);
  await AsyncStorage.setItem(MOROCCO_TRIPS_KEY, JSON.stringify(filtered));
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
  count: number;
  totalImporte: number;
}> {
  const all = await getAllMoroccoTrips();
  const filtered = all.filter((t) => t.estado === "pernocta" && t.fecha >= desde && t.fecha <= hasta);
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
    const raw = await AsyncStorage.getItem(FERRY_RESTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function addFerryRest(rest: Omit<FerryRestRecord, "id" | "createdAt">): Promise<FerryRestRecord> {
  const all = await getAllFerryRests();
  const newRest: FerryRestRecord = {
    ...rest,
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    createdAt: new Date().toISOString(),
  };
  all.push(newRest);
  await AsyncStorage.setItem(FERRY_RESTS_KEY, JSON.stringify(all));
  return newRest;
}

export async function updateFerryRest(id: string, updates: Partial<Omit<FerryRestRecord, "id" | "createdAt">>): Promise<FerryRestRecord | null> {
  const all = await getAllFerryRests();
  const idx = all.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...updates };
  await AsyncStorage.setItem(FERRY_RESTS_KEY, JSON.stringify(all));
  return all[idx];
}

export async function deleteFerryRest(id: string): Promise<void> {
  const all = await getAllFerryRests();
  const filtered = all.filter((r) => r.id !== id);
  await AsyncStorage.setItem(FERRY_RESTS_KEY, JSON.stringify(filtered));
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
    const raw = await AsyncStorage.getItem(ACTIVE_FERRY_REST_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function setActiveFerryRest(rest: ActiveFerryRest): Promise<void> {
  await AsyncStorage.setItem(ACTIVE_FERRY_REST_KEY, JSON.stringify(rest));
}

export async function clearActiveFerryRest(): Promise<void> {
  await AsyncStorage.removeItem(ACTIVE_FERRY_REST_KEY);
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
