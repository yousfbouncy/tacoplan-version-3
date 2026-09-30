import type { Jornada, Compensacion } from "./local-storage";

export const POLICIA_VENTANA_DIAS = 52;

export function formatFechaES(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T00:00:00Z");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = String(d.getUTCFullYear());
    return `${dd}/${mm}/${yyyy}`;
  } catch {
    return dateStr;
  }
}

/**
 * Ventana retrospectiva de inspección/policía (52 días hacia atrás).
 * Se filtra por FECHA DE LA JORNADA ASOCIADA (fechaInicio), NO por fechaLimite.
 * Cualquier compensación derivada de una jornada >52d de antigüedad se considera
 * FUERA DE VIGILANCIA ACTIVA:
 *   → NO suma, NO warning, NO infracción en UI (sigue en BBDD).
 */
export function policeWindowStart(dateRef: Date = new Date()): string {
  const d = new Date(Date.UTC(
    dateRef.getUTCFullYear(),
    dateRef.getUTCMonth(),
    dateRef.getUTCDate() - POLICIA_VENTANA_DIAS,
  ));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isCompWithinPoliceWindow(
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
  return c.fechaLimite >= start;
}

export interface LegalInfraction {
  code: string;
  severity: "leve" | "grave" | "muy_grave";
  description: string;
}

export interface LegalWarning {
  code: string;
  description: string;
}

type SplitRestMeta = Pick<Jornada, "splitRestDetected" | "splitRestFirstPartMin" | "splitRestSecondPartMin" | "countsAsReducedRest">;
type CurrentRestMeta = Pick<Jornada, "descansoAnteriorMin" | "tipoDescansoAnterior">;

export function isQualifiedSplitDailyRest(meta: Partial<SplitRestMeta> | null | undefined): boolean {
  return meta?.splitRestDetected === true &&
    meta?.countsAsReducedRest === false &&
    (meta?.splitRestFirstPartMin ?? 0) >= 3 * 60 &&
    (meta?.splitRestSecondPartMin ?? 0) >= 9 * 60;
}

export function getQualifiedSplitDailyRestFirstPartMin(meta: Partial<SplitRestMeta> | null | undefined): number | null {
  if (!isQualifiedSplitDailyRest(meta)) return null;
  return meta?.splitRestFirstPartMin ?? null;
}

export function isSplitDailyRestGapComplete(
  restMin: number | null | undefined,
  meta: Partial<SplitRestMeta> | null | undefined,
): boolean {
  return restMin != null && restMin >= 9 * 60 && restMin < 11 * 60 && isQualifiedSplitDailyRest(meta);
}

export function getSplitDailyRestComputedTotalMin(
  restMin: number | null | undefined,
  meta: Partial<SplitRestMeta> | null | undefined,
): number | null {
  const firstPartMin = getQualifiedSplitDailyRestFirstPartMin(meta);
  if (restMin == null || firstPartMin == null) return null;
  return firstPartMin + restMin;
}

function isSplitDailyRestCurrentComplete(meta: Partial<CurrentRestMeta> | null | undefined): boolean {
  return meta?.tipoDescansoAnterior === "DESCANSO_DIARIO_COMPLETO" &&
    meta?.descansoAnteriorMin != null &&
    meta.descansoAnteriorMin >= 9 * 60 &&
    meta.descansoAnteriorMin < 11 * 60;
}

export interface LegalSummary {
  status: "legal" | "advertencia" | "infraccion";
  conduccionMin: number;
  duracionJornadaMin: number;
  descansoAnteriorMin: number | null;
  tipoDescansoAnterior: string | null;
  infractions: LegalInfraction[];
  warnings: LegalWarning[];
  conduccionSemanalMin: number;
  conduccionBisemanalMin: number;
  extensiones10hSemana: number;
  descansosReducidosSemana: number;
  compensacionGenerada: boolean;
  compensacionDeudaMin: number;
}

export interface LegalPreview {
  conduccionSemanalMin: number;
  restanteSemanalMin: number;
  conduccionBisemanalMin: number;
  restanteBisemanalMin: number;
  extensiones10h: number;
  descansosReducidos: number;
  disponibilidadMin: number;
  compensacionesPendientes: number;
  compensacionDeudaTotalMin: number;
  warnings: string[];
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

function formatDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatUTCDateStr(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function getJornadaUtcStartDateStr(j: Jornada): string {
  return formatUTCDateStr(new Date(j.startAt || `${j.fechaInicio}T${j.horaInicio || "00:00"}:00`));
}

function getJornadaUtcEndDateStr(j: Jornada): string | null {
  const endStr = j.endAt || (j.fechaFin && j.horaFin ? `${j.fechaFin}T${j.horaFin}:00` : null);
  if (!endStr) return null;
  return formatUTCDateStr(new Date(endStr));
}

export function getJornadaDrivingForWeek(
  j: Jornada,
  weekMondayStr: string,
  weekSundayStr: string,
): number {
  const jCond = j.conduccionMin || 0;
  if (jCond <= 0) return 0;

  const startStr = j.startAt || `${j.fechaInicio}T${j.horaInicio || "00:00"}:00`;
  const endStr = j.endAt || (j.fechaFin && j.horaFin ? `${j.fechaFin}T${j.horaFin}:00` : null);
  if (!endStr) return jCond;

  const startDate = new Date(startStr);
  const endDate = new Date(endStr);
  const startDay = startDate.getUTCDay();
  const endDay = endDate.getUTCDay();
  const startDateStr = formatUTCDateStr(startDate);
  const endDateStr = formatUTCDateStr(endDate);

  if (startDay === 0 && endDay === 1 && startDateStr !== endDateStr &&
      j.conduccionDomingoMin != null && j.conduccionLunesMin != null) {
    if (endDateStr && endDateStr >= weekMondayStr && endDateStr <= weekSundayStr) {
      return j.conduccionLunesMin;
    }
    if (startDateStr >= weekMondayStr && startDateStr <= weekSundayStr) {
      return j.conduccionDomingoMin;
    }
    return 0;
  }

  const startMs = startDate.getTime();
  const endMs = endDate.getTime();
  const totalDurMs = endMs - startMs;
  if (totalDurMs <= 0) return jCond;

  const weekStartMs = new Date(`${weekMondayStr}T00:00:00Z`).getTime();
  const nextMondayDate = new Date(`${weekMondayStr}T00:00:00Z`);
  nextMondayDate.setUTCDate(nextMondayDate.getUTCDate() + 7);
  const weekEndMs = nextMondayDate.getTime();

  const overlapStart = Math.max(startMs, weekStartMs);
  const overlapEnd = Math.min(endMs, weekEndMs);
  if (overlapStart >= overlapEnd) return 0;

  const overlapMs = overlapEnd - overlapStart;
  const fraction = overlapMs / totalDurMs;

  if (fraction >= 1) return jCond;
  if (fraction <= 0) return 0;
  return Math.round(jCond * fraction);
}

export function jornadaOverlapsWeek(
  j: Jornada,
  weekMondayStr: string,
  weekSundayStr: string,
): boolean {
  const startStr = getJornadaUtcStartDateStr(j);
  const endStr = getJornadaUtcEndDateStr(j);
  if (!endStr) return false;
  return startStr <= weekSundayStr && endStr >= weekMondayStr;
}

function clasificarDescanso(minutos: number): string {
  if (minutos < 9 * 60) return "INFRACCION_DESCANSO";
  if (minutos < 11 * 60) return "DESCANSO_DIARIO_REDUCIDO";
  if (minutos < 24 * 60) return "DESCANSO_DIARIO_COMPLETO";
  if (minutos < 45 * 60) return "DESCANSO_SEMANAL_REDUCIDO";
  return "DESCANSO_SEMANAL_COMPLETO";
}

export function computeReducidosSinceLastWeeklyRest(
  allJornadas: Jornada[],
  includeOpenJornada?: { descansoAnteriorMin?: number | null; tipoDescansoAnterior?: string | null } | null,
): number {
  const cerradas = allJornadas
    .filter((j) => j.fechaFin && j.endAt)
    .sort((a, b) => (a.startAt || "").localeCompare(b.startAt || ""));

  let reducidos = 0;

  for (let i = 1; i < cerradas.length; i++) {
    const prev = cerradas[i - 1];
    const curr = cerradas[i];
    if (prev.endAt && curr.startAt) {
      const gapMs = new Date(curr.startAt).getTime() - new Date(prev.endAt).getTime();
      const gapMin = Math.round(gapMs / 60000);
      if (gapMin >= 24 * 60) {
        reducidos = 0;
      } else if (gapMin >= 9 * 60 && gapMin < 11 * 60) {
        if (!isSplitDailyRestGapComplete(gapMin, prev)) reducidos++;
      }
    }
  }

  if (includeOpenJornada && includeOpenJornada.descansoAnteriorMin != null) {
    const gapMin = includeOpenJornada.descansoAnteriorMin;
    if (gapMin >= 24 * 60) {
      reducidos = 0;
    } else if (gapMin >= 9 * 60 && gapMin < 11 * 60) {
      if (!isSplitDailyRestCurrentComplete(includeOpenJornada)) reducidos++;
    }
  }

  return reducidos;
}

export function computeReducedRestsInUtcWeek(
  allJornadas: Jornada[],
  weekMondayStr: string,
  weekSundayStr: string,
  includeOpenJornada?: { startAt?: string; descansoAnteriorMin?: number | null; tipoDescansoAnterior?: string | null } | null,
): number {
  const cerradas = allJornadas
    .filter((j) => j.fechaFin && j.endAt)
    .sort((a, b) => (a.startAt || "").localeCompare(b.startAt || ""));

  let reducidos = 0;

  for (let i = 1; i < cerradas.length; i++) {
    const prev = cerradas[i - 1];
    const curr = cerradas[i];
    if (!prev.endAt || !curr.startAt) continue;

    const gapMs = new Date(curr.startAt).getTime() - new Date(prev.endAt).getTime();
    const gapMin = Math.round(gapMs / 60000);
    if (gapMin < 9 * 60 || gapMin >= 11 * 60) continue;

    if (isSplitDailyRestGapComplete(gapMin, prev)) continue;

    const currUtcStart = formatUTCDateStr(new Date(curr.startAt));
    if (currUtcStart >= weekMondayStr && currUtcStart <= weekSundayStr) {
      reducidos++;
    }
  }

  if (includeOpenJornada?.startAt && includeOpenJornada.descansoAnteriorMin != null) {
    const gapMin = includeOpenJornada.descansoAnteriorMin;
    if (gapMin >= 9 * 60 && gapMin < 11 * 60) {
      const openUtcStart = formatUTCDateStr(new Date(includeOpenJornada.startAt));
      if (
        openUtcStart >= weekMondayStr &&
        openUtcStart <= weekSundayStr &&
        !isSplitDailyRestCurrentComplete(includeOpenJornada)
      ) {
        reducidos++;
      }
    }
  }

  return reducidos;
}

export function evaluateJornada(
  jornada: Jornada,
  allJornadas: Jornada[],
  compensaciones: Compensacion[],
): LegalSummary {
  const infractions: LegalInfraction[] = [];
  const warnings: LegalWarning[] = [];

  const durMin = jornada.duracionJornadaMin || 0;
  const condMin = jornada.conduccionMin || 0;
  const descansoMin = jornada.descansoAnteriorMin;
  const tipoDescanso = jornada.tipoDescansoAnterior;
  const isDouble = !!((jornada as any).isDoubleDriving === true);

  if (condMin > 10 * 60) {
    infractions.push({
      code: "COND_DIARIA_EXCEDIDA",
      severity: "grave",
      description: `Conduccion diaria ${formatHM(condMin)} supera el maximo de 10h (con extension)`,
    });
  } else if (condMin > 9 * 60) {
    warnings.push({
      code: "COND_EXTENSION_10H",
      description: `Conduccion diaria ${formatHM(condMin)} usa extension 10h (max 2/semana)`,
    });
  }

  // ========================================================================
  // FASE 8 — Separación estricta individual vs doble
  // ========================================================================
  // - isDouble=true : NO aplicar límites de amplitud individual (13h/15h).
  //                   Sustituir por ventana 30h (umbrales 19h/21h).
  // - isDouble=false: continuar exactamente con la lógica histórica.
  // ========================================================================
  if (!isDouble) {
    const maxDutyMin = (() => {
      const hasPlannedReduced = (jornada as any).plannedRestType === "daily" && (jornada as any).plannedRestMin === 540;
      const hasSplit = isQualifiedSplitDailyRest(jornada);
      return (hasPlannedReduced || hasSplit) ? 15 * 60 : 13 * 60;
    })();

    if (durMin > 15 * 60) {
      infractions.push({
        code: "JORNADA_EXCESIVA",
        severity: "grave",
        description: `Duracion de jornada ${formatHM(durMin)} supera las 15h`,
      });
    } else if (maxDutyMin === 13 * 60 && durMin > 13 * 60) {
      warnings.push({
        code: "JORNADA_LARGA",
        description: `Duracion de jornada ${formatHM(durMin)} supera las 13h`,
      });
    }
  } else {
    // Doble conducción — ventana de 30h.
    // Regla de producto acordada:
    // - ≤ 19h : se ofrecen 11h y 9h (si el reducido está disponible).
    // - > 19h y ≤ 21h : solo puede seleccionarse 9h.
    // - > 21h : no cabe el descanso mínimo de 9h dentro de la ventana.
    if (durMin > 21 * 60) {
      infractions.push({
        code: "DOBLE_VENTANA_30H_EXCEDIDA",
        severity: "grave",
        description: `Doble conduccion ${formatHM(durMin)} superior a 21h (ventana 30h no permite descanso diario minimo 9h)`,
      });
    } else if (durMin > 19 * 60) {
      warnings.push({
        code: "DOBLE_SIN_DESCANSO_11H",
        description: `Doble conduccion ${formatHM(durMin)} superior a 19h: solo se permite seleccionar descanso diario de 9h dentro de la ventana de 30h.`,
      });
    }
  }

  const isFerryRest = (jornada as any).previousRestSource === "ferry_rest";
  const ferryRestValid = isFerryRest && (jornada as any).previousRestValid === true;

  if (isFerryRest && ferryRestValid) {
    // noop
  } else if (tipoDescanso === "INFRACCION_DESCANSO" && descansoMin != null) {
    infractions.push({
      code: "DESCANSO_INSUFICIENTE",
      severity: "muy_grave",
      description: `Descanso anterior ${formatHM(descansoMin)} es inferior a 9h`,
    });
  } else if (tipoDescanso === "DESCANSO_DIARIO_REDUCIDO") {
    warnings.push({
      code: "DESCANSO_REDUCIDO",
      description: `Descanso diario reducido (${descansoMin != null ? formatHM(descansoMin) : "?"}) - max 3/semana`,
    });
  }

  const fechaJornada = new Date(jornada.startAt || `${jornada.fechaInicio}T${jornada.horaInicio || "00:00"}:00`);
  const lunes = getMondayOfUtcWeek(fechaJornada);
  const domingo = getSundayOfUtcWeek(fechaJornada);
  const lunesStr = formatUTCDateStr(lunes);
  const domingoStr = formatUTCDateStr(domingo);

  const lunesAnterior = new Date(lunes);
  lunesAnterior.setUTCDate(lunesAnterior.getUTCDate() - 7);
  const lunesAnteriorStr = formatUTCDateStr(lunesAnterior);

  const cerradas = allJornadas.filter((j) => j.fechaFin && j.id !== jornada.id);

  const semana = cerradas.filter(
    (j) => jornadaOverlapsWeek(j, lunesStr, domingoStr) || (j.fechaInicio >= lunesStr && j.fechaInicio <= domingoStr),
  );

  const semanaAnterior = cerradas.filter(
    (j) => jornadaOverlapsWeek(j, lunesAnteriorStr, formatUTCDateStr(new Date(lunes.getTime() - 86400000))) || (getJornadaUtcStartDateStr(j) >= lunesAnteriorStr && getJornadaUtcStartDateStr(j) < lunesStr),
  );

  const currentWeekDriving = getJornadaDrivingForWeek(jornada, lunesStr, domingoStr);
  let conduccionSemanalMin = currentWeekDriving;
  let extensiones10h = condMin > 9 * 60 ? 1 : 0;

  const seenIds = new Set<string>();
  for (const j of semana) {
    if (seenIds.has(j.id)) continue;
    seenIds.add(j.id);
    const weekDriving = getJornadaDrivingForWeek(j, lunesStr, domingoStr);
    conduccionSemanalMin += weekDriving;
    const jCond = j.conduccionMin || 0;
    if (jCond > 9 * 60) extensiones10h++;
  }

  // El límite de tres descansos diarios reducidos no se reinicia el lunes:
  // se cuenta entre dos descansos semanales (art. 8.4). La jornada evaluada
  // suele llegar separada de `allJornadas`, así que la incorporamos una sola vez.
  const jornadasConActual = [
    ...allJornadas.filter((j) => j.id !== jornada.id),
    jornada,
  ];
  const descansosReducidos = computeReducidosSinceLastWeeklyRest(jornadasConActual);

  const prevWeekMondayStr = lunesAnteriorStr;
  const prevWeekSundayStr = formatUTCDateStr(new Date(lunes.getTime() - 86400000));
  let conduccionBisemanalMin = conduccionSemanalMin;
  const previousWeekSeenIds = new Set<string>();
  for (const j of semanaAnterior) {
    if (previousWeekSeenIds.has(j.id)) continue;
    previousWeekSeenIds.add(j.id);
    const prevWeekDriving = getJornadaDrivingForWeek(j, prevWeekMondayStr, prevWeekSundayStr);
    conduccionBisemanalMin += prevWeekDriving;
  }

  if (conduccionSemanalMin > 56 * 60) {
    infractions.push({
      code: "COND_SEMANAL_EXCEDIDA",
      severity: "grave",
      description: `Conduccion semanal ${formatHM(conduccionSemanalMin)} supera el limite de 56h`,
    });
  } else if (conduccionSemanalMin > 50 * 60) {
    warnings.push({
      code: "COND_SEMANAL_CERCA",
      description: `Conduccion semanal ${formatHM(conduccionSemanalMin)} se acerca al limite de 56h`,
    });
  }

  if (conduccionBisemanalMin > 90 * 60) {
    infractions.push({
      code: "COND_BISEMANAL_EXCEDIDA",
      severity: "grave",
      description: `Conduccion bisemanal ${formatHM(conduccionBisemanalMin)} supera el limite de 90h`,
    });
  }

  if (extensiones10h > 2) {
    infractions.push({
      code: "EXTENSIONES_EXCEDIDAS",
      severity: "grave",
      description: `${extensiones10h} extensiones a 10h esta semana (maximo 2)`,
    });
  } else if (extensiones10h === 2 && condMin > 9 * 60) {
    warnings.push({
      code: "EXTENSIONES_AGOTADAS",
      description: "Has usado las 2 extensiones de 10h esta semana",
    });
  }

  if (descansosReducidos > 3) {
    infractions.push({
      code: "DESCANSOS_REDUCIDOS_EXCEDIDOS",
      severity: "grave",
      description: `${descansosReducidos} descansos diarios reducidos esta semana (maximo 3)`,
    });
  } else if (descansosReducidos === 3) {
    warnings.push({
      code: "DESCANSOS_REDUCIDOS_LIMITE",
      description: "Has usado los 3 descansos diarios reducidos esta semana",
    });
  }

  let compensacionGenerada = false;
  let compensacionDeudaMin = 0;

  if (tipoDescanso === "DESCANSO_SEMANAL_REDUCIDO" && descansoMin != null) {
    // Art. 8.6 CE 561/2006: deuda VARIABLE = 45h − duración REAL del descanso reducido
    // Si hubiera 2 reducidos en semanas seguidas, se ACUMULAN (se suman ambos débitos).
    const deuda = descansoMin < 24 * 60 ? 0 : 45 * 60 - descansoMin;
    if (deuda > 0) {
      compensacionGenerada = true;
      compensacionDeudaMin = deuda;
      warnings.push({
        code: "COMPENSACION_GENERADA",
        description: `Descanso semanal reducido genera deuda de ${formatHM(deuda)} a compensar en 14 dias desde el fin del descanso`.replace(/\s+/g, " ").trim(),
      });
    }
  }

  // REGLA 52 DÍAS: filtrar compensaciones a la ventana retrospectiva de policía.
  // Fuera de esta ventana → no suman, no generan warning ni infracción en la app
  // (el usuario ya habrá podido marcar manualmente las que corresponda).
  // Se filtra por FECHA DE LA JORNADA (no fechaLimite), 52 días hacia atrás.
  const pendientes = compensaciones.filter(c => isCompWithinPoliceWindow(c, allJornadas, new Date()));
  if (pendientes.length > 0) {
    const totalPendienteMin = pendientes.reduce(
      (sum, c) => sum + c.horasDeuda * 60 + c.minutosDeuda, 0,
    );
    const primerVencimiento = pendientes
      .sort((a, b) => a.fechaLimite.localeCompare(b.fechaLimite))[0];
    const hoy = formatDateStr(new Date());
    // REGLA 3-D: SOLO si hoy > fechaLimite → infracción. Si aún no, solo recordatorio (warning leve).
    if (primerVencimiento.fechaLimite < hoy) {
      infractions.push({
        code: "COMPENSACION_VENCIDA",
        severity: "muy_grave",
        description: `${formatHM(totalPendienteMin)} de compensacion vencida (limite: ${formatFechaES(primerVencimiento.fechaLimite)})`,
      });
    } else {
      warnings.push({
        code: "COMPENSACION_PENDIENTE",
        description: `Tienes ${formatHM(totalPendienteMin)} pendientes de compensar antes del ${formatFechaES(primerVencimiento.fechaLimite)}`,
      });
    }
  }

  let status: LegalSummary["status"] = "legal";
  if (infractions.length > 0) {
    status = "infraccion";
  } else if (warnings.length > 0) {
    status = "advertencia";
  }

  return {
    status,
    conduccionMin: condMin,
    duracionJornadaMin: durMin,
    descansoAnteriorMin: descansoMin,
    tipoDescansoAnterior: tipoDescanso,
    infractions,
    warnings,
    conduccionSemanalMin,
    conduccionBisemanalMin,
    extensiones10hSemana: extensiones10h,
    descansosReducidosSemana: descansosReducidos,
    compensacionGenerada,
    compensacionDeudaMin,
  };
}

export function buildLegalPreview(
  allJornadas: Jornada[],
  compensaciones: Compensacion[],
): LegalPreview {
  const ahora = new Date();
  const lunes = getMondayOfUtcWeek(ahora);
  const domingo = getSundayOfUtcWeek(ahora);
  const lunesStr = formatUTCDateStr(lunes);
  const domingoStr = formatUTCDateStr(domingo);

  const lunesAnterior = new Date(lunes);
  lunesAnterior.setUTCDate(lunesAnterior.getUTCDate() - 7);
  const lunesAnteriorStr = formatUTCDateStr(lunesAnterior);

  const cerradas = allJornadas.filter((j) => j.fechaFin);

  const prevWeekSundayStr = formatDateStr(new Date(lunes.getTime() - 86400000));

  const semana = cerradas.filter(
    (j) => jornadaOverlapsWeek(j, lunesStr, domingoStr) || (getJornadaUtcStartDateStr(j) >= lunesStr && getJornadaUtcStartDateStr(j) <= domingoStr),
  );

  const semanaAnterior = cerradas.filter(
    (j) => jornadaOverlapsWeek(j, lunesAnteriorStr, prevWeekSundayStr) || (getJornadaUtcStartDateStr(j) >= lunesAnteriorStr && getJornadaUtcStartDateStr(j) < lunesStr),
  );

  let conduccionSemanalMin = 0;
  let extensiones10h = 0;

  const seenIds = new Set<string>();
  for (const j of semana) {
    if (seenIds.has(j.id)) continue;
    seenIds.add(j.id);
    const weekDriving = getJornadaDrivingForWeek(j, lunesStr, domingoStr);
    conduccionSemanalMin += weekDriving;
    const jCond = j.conduccionMin || 0;
    if (jCond > 9 * 60) extensiones10h++;
  }

  const descansosReducidos = computeReducedRestsInUtcWeek(allJornadas, lunesStr, domingoStr);

  let conduccionBisemanalMin = conduccionSemanalMin;
  const biSeenIds = new Set<string>(seenIds);
  for (const j of semana) {
    const prevWeekDriving = getJornadaDrivingForWeek(j, lunesAnteriorStr, prevWeekSundayStr);
    if (prevWeekDriving > 0) {
      conduccionBisemanalMin += prevWeekDriving;
    }
  }
  for (const j of semanaAnterior) {
    if (biSeenIds.has(j.id)) continue;
    biSeenIds.add(j.id);
    const prevWeekDriving = getJornadaDrivingForWeek(j, lunesAnteriorStr, prevWeekSundayStr);
    conduccionBisemanalMin += prevWeekDriving;
  }

  const restanteSemanalMin = Math.max(0, 56 * 60 - conduccionSemanalMin);
  const restanteBisemanalMin = Math.max(0, 90 * 60 - conduccionBisemanalMin);

  const pendientes = compensaciones.filter((c) => !c.compensada);
  const compensacionDeudaTotalMin = pendientes.reduce(
    (sum, c) => sum + c.horasDeuda * 60 + c.minutosDeuda, 0,
  );

  const previewWarnings: string[] = [];
  if (restanteSemanalMin <= 10 * 60 && restanteSemanalMin > 0) {
    previewWarnings.push(`Quedan ${formatHM(restanteSemanalMin)} de conduccion semanal`);
  }
  if (restanteSemanalMin <= 0) {
    previewWarnings.push("Limite semanal de 56h alcanzado");
  }
  if (extensiones10h >= 2) {
    previewWarnings.push("2 extensiones de 10h usadas esta semana");
  }
  if (descansosReducidos >= 3) {
    previewWarnings.push("3 descansos reducidos usados. Disponibilidad 13h.");
  }
  if (pendientes.length > 0) {
    const hoy = formatDateStr(new Date());
    const vencidas = pendientes.filter((c) => c.fechaLimite < hoy);
    if (vencidas.length > 0) {
      previewWarnings.push(`Compensacion vencida: ${formatHM(compensacionDeudaTotalMin)}`);
    } else {
      previewWarnings.push(`Compensacion pendiente: ${formatHM(compensacionDeudaTotalMin)}`);
    }
  }

  return {
    conduccionSemanalMin,
    restanteSemanalMin,
    conduccionBisemanalMin,
    restanteBisemanalMin,
    extensiones10h,
    descansosReducidos,
    disponibilidadMin: descansosReducidos < 3 ? 15 * 60 : 13 * 60,
    compensacionesPendientes: pendientes.length,
    compensacionDeudaTotalMin,
    warnings: previewWarnings,
  };
}

export function getLegalStatusColor(status: LegalSummary["status"]): string {
  switch (status) {
    case "infraccion": return "#EF4444";
    case "advertencia": return "#F59E0B";
    case "legal": return "#10B981";
  }
}

export function getLegalStatusLabel(status: LegalSummary["status"]): string {
  switch (status) {
    case "infraccion": return "Infraccion";
    case "advertencia": return "Advertencia";
    case "legal": return "Legal";
  }
}

export function getSeverityLabel(severity: LegalInfraction["severity"]): string {
  switch (severity) {
    case "leve": return "Leve";
    case "grave": return "Grave";
    case "muy_grave": return "Muy grave";
  }
}

export function getSeverityColor(severity: LegalInfraction["severity"]): string {
  switch (severity) {
    case "leve": return "#F59E0B";
    case "grave": return "#EF4444";
    case "muy_grave": return "#DC2626";
  }
}

export interface RestOption {
  minutes: number;
  label: string;
  enabled: boolean;
  nextStartTime: string;
  tomorrowMaxDutyMin: number;
  tomorrowMaxDriveMin: number;
  type: "daily" | "weekly";
  generatesDebt?: boolean;
  debtMinutes?: number;
}

export interface LegalPlan {
  weeklyDriveMin: number;
  biweeklyDriveMin: number;
  weeklyRemainMin: number;
  biweeklyRemainMin: number;
  extensionsUsed: number;
  reducedRestsUsed: number;
  canUseSplitRest: boolean;
  splitRestFirstPartMin: number;
  maxDriveTodayMin: number;
  dayMaxDutyMin: number;
  canUseExtension: boolean;
  canUseReducedRest: boolean;
  maxDutyLimitTime: string | null;
  prevRestMin: number | null;
  prevRestType: string | null;
  isMonday: boolean;
  warnings: string[];
  restOptions: RestOption[];
}

export function computeLegalPlan(
  allJornadas: Jornada[],
  compensaciones: Compensacion[],
  currentJornada?: { startAt: string; endAt?: string; conduccionMin?: number; duracionJornadaMin?: number; descansoAnteriorMin?: number | null; tipoDescansoAnterior?: string | null; isDoubleDriving?: boolean } | null,
  locale: string = "es",
): LegalPlan {
  const ahora = new Date();
  const lunes = getMondayOfUtcWeek(ahora);
  const domingo = getSundayOfUtcWeek(ahora);
  const lunesStr = formatUTCDateStr(lunes);
  const domingoStr = formatUTCDateStr(domingo);

  const lunesAnterior = new Date(lunes);
  lunesAnterior.setUTCDate(lunesAnterior.getUTCDate() - 7);
  const lunesAnteriorStr = formatUTCDateStr(lunesAnterior);

  const cerradas = allJornadas.filter((j) => j.fechaFin);

  const prevWeekSundayStr = formatUTCDateStr(new Date(lunes.getTime() - 86400000));

  const semana = cerradas.filter(
    (j) => jornadaOverlapsWeek(j, lunesStr, domingoStr) || (getJornadaUtcStartDateStr(j) >= lunesStr && getJornadaUtcStartDateStr(j) <= domingoStr),
  );

  const semanaAnterior = cerradas.filter(
    (j) => jornadaOverlapsWeek(j, lunesAnteriorStr, prevWeekSundayStr) || (getJornadaUtcStartDateStr(j) >= lunesAnteriorStr && getJornadaUtcStartDateStr(j) < lunesStr),
  );

  let weeklyDriveMin = 0;
  let extensionsUsed = 0;

  const seenIds = new Set<string>();
  for (const j of semana) {
    if (seenIds.has(j.id)) continue;
    seenIds.add(j.id);
    const weekDriving = getJornadaDrivingForWeek(j, lunesStr, domingoStr);
    weeklyDriveMin += weekDriving;
    const jCond = j.conduccionMin || 0;
    if (jCond > 9 * 60) extensionsUsed++;
  }

  const currentClosedAlreadyIncluded = !!currentJornada?.endAt && allJornadas.some((j) =>
    j.startAt === currentJornada.startAt && j.endAt === currentJornada.endAt
  );
  const reducedRestsUsed = computeReducidosSinceLastWeeklyRest(
    allJornadas,
    currentJornada && !currentClosedAlreadyIncluded
      ? {
          descansoAnteriorMin: currentJornada.descansoAnteriorMin,
          tipoDescansoAnterior: currentJornada.tipoDescansoAnterior,
        }
      : null,
  );

  let biweeklyDriveMin = weeklyDriveMin;
  const previousWeekSeenIds = new Set<string>();
  for (const j of semanaAnterior) {
    if (previousWeekSeenIds.has(j.id)) continue;
    previousWeekSeenIds.add(j.id);
    const prevWeekDriving = getJornadaDrivingForWeek(j, lunesAnteriorStr, prevWeekSundayStr);
    biweeklyDriveMin += prevWeekDriving;
  }

  // Una jornada cerrada ya forma parte de `allJornadas`; sumarla de nuevo
  // duplicaba tanto la conducción semanal como la bisemanal en el modal final.
  if (currentJornada && !currentClosedAlreadyIncluded) {
    const curCond = currentJornada.conduccionMin || 0;
    if (curCond > 0) {
      weeklyDriveMin += curCond;
      biweeklyDriveMin += curCond;
      if (curCond > 9 * 60) extensionsUsed++;
    }
  }

  const canUseExtension = extensionsUsed < 2;
  const canUseReducedRest = reducedRestsUsed < 3;

  const weeklyRemainMin = Math.max(0, 56 * 60 - weeklyDriveMin);
  const biweeklyRemainMin = Math.max(0, 90 * 60 - biweeklyDriveMin);

  const baseDriveCap = canUseExtension ? 10 * 60 : 9 * 60;
  const maxDriveTodayMin = Math.min(baseDriveCap, weeklyRemainMin, biweeklyRemainMin);

  const prevRestMin = currentJornada?.descansoAnteriorMin ?? null;
  const prevRestType = currentJornada?.tipoDescansoAnterior ?? null;

  const storedSplitFirst = (currentJornada as any)?.splitRestFirstPartMin;
  const splitRestFirstPartMin = (typeof storedSplitFirst === "number" && storedSplitFirst >= 3 * 60) ? storedSplitFirst : 0;
  const canUseSplitRest = splitRestFirstPartMin >= 3 * 60;
  const isCurrentDouble = !!currentJornada?.isDoubleDriving;

  let dayMaxDutyMin: number;
  let disponibilidadMin: number;
  if (isCurrentDouble) {
    dayMaxDutyMin = 21 * 60;
    disponibilidadMin = 21 * 60;
  } else {
    dayMaxDutyMin = (canUseReducedRest || canUseSplitRest) ? 15 * 60 : 13 * 60;
    disponibilidadMin = reducedRestsUsed < 3 ? 15 * 60 : 13 * 60;
  }

  let maxDutyLimitTime: string | null = null;
  if (currentJornada?.startAt) {
    const startDate = new Date(currentJornada.startAt);
    if (!isNaN(startDate.getTime())) {
      const limitDate = new Date(startDate.getTime() + dayMaxDutyMin * 60000);
      maxDutyLimitTime = formatDateTimeES(limitDate, locale);
    }
  }

  // Cálculo de duración de la jornada actual FUERA del bloque if(endAt) para que los
  // warnings del final también puedan acceder al valor (especialmente advertencia 11h → 9h).
  let currentDurMin: number | null = null;
  if (currentJornada?.startAt) {
    const st = new Date(currentJornada.startAt);
    if (!isNaN(st.getTime())) {
      if (currentJornada.endAt) {
        const endDate = new Date(currentJornada.endAt);
        if (!isNaN(endDate.getTime())) {
          currentDurMin = Math.max(0, Math.round((endDate.getTime() - st.getTime()) / 60000));
        }
      }
    }
  }
  if (typeof currentJornada?.duracionJornadaMin === "number" && currentJornada.duracionJornadaMin >= 0) {
    currentDurMin = currentJornada.duracionJornadaMin;
  }

  const restOptions: RestOption[] = [];
  if (currentJornada?.endAt) {
    const endDate = new Date(currentJornada.endAt);
    if (!isNaN(endDate.getTime())) {
      const nextWeekLunes = new Date(lunes);
      nextWeekLunes.setDate(nextWeekLunes.getDate() + 7);
      const endDateOnly = formatDateStr(endDate);
      const isNextWeek = endDateOnly >= formatDateStr(nextWeekLunes);
      const nextWeekExtAvail = isNextWeek ? true : canUseExtension;
      const tomorrowMaxDrive = nextWeekExtAvail ? 10 * 60 : 9 * 60;

      if (typeof currentJornada.duracionJornadaMin === "number" && currentJornada.duracionJornadaMin >= 0) {
        currentDurMin = currentJornada.duracionJornadaMin;
      }

      // En doble conducción, una jornada superior a 19h deja únicamente
      // la opción de 9h; así la UI no permite elegir 11h en contra de la regla
      // configurada para Tacoplan.
      const rest11Enabled: boolean =
        !(isCurrentDouble && typeof currentDurMin === "number" && currentDurMin > 19 * 60);
      const rest11 = new Date(endDate.getTime() + 11 * 60 * 60000);
      restOptions.push({
        minutes: 660,
        label: "11h",
        enabled: rest11Enabled,
        nextStartTime: formatDateTimeES(rest11, locale),
        tomorrowMaxDutyMin: isCurrentDouble ? 21 * 60 : 13 * 60,
        tomorrowMaxDriveMin: tomorrowMaxDrive,
        type: "daily",
      });

      const rest9 = new Date(endDate.getTime() + 9 * 60 * 60000);
      restOptions.push({
        minutes: 540,
        label: "9h",
        enabled: canUseReducedRest || canUseSplitRest,
        nextStartTime: formatDateTimeES(rest9, locale),
        tomorrowMaxDutyMin: isCurrentDouble ? 21 * 60 : 15 * 60,
        tomorrowMaxDriveMin: tomorrowMaxDrive,
        type: "daily",
      });

      const rest45 = new Date(endDate.getTime() + 45 * 60 * 60000);
      restOptions.push({
        minutes: 45 * 60,
        label: "45h",
        enabled: true,
        nextStartTime: formatDateTimeES(rest45, locale),
        tomorrowMaxDutyMin: 13 * 60,
        tomorrowMaxDriveMin: tomorrowMaxDrive,
        type: "weekly",
      });

      const pendientes = compensaciones.filter((c) => !c.compensada);
      const totalPendingDebtMin = pendientes.reduce(
        (sum, c) => sum + c.horasDeuda * 60 + c.minutosDeuda, 0,
      );
      const rest24 = new Date(endDate.getTime() + 24 * 60 * 60000);
      const weeklyReducedDebt = 45 * 60 - 24 * 60;
      restOptions.push({
        minutes: 24 * 60,
        label: "24h",
        enabled: true,
        nextStartTime: formatDateTimeES(rest24, locale),
        tomorrowMaxDutyMin: 13 * 60,
        tomorrowMaxDriveMin: tomorrowMaxDrive,
        type: "weekly",
        generatesDebt: true,
        debtMinutes: weeklyReducedDebt,
      });
    }
  }

  const warnings: string[] = [];
  if (weeklyRemainMin <= 10 * 60 && weeklyRemainMin > 0) {
    warnings.push(`Quedan ${formatHM(weeklyRemainMin)} de conduccion semanal`);
  }
  if (weeklyRemainMin <= 0) {
    warnings.push("Limite semanal de 56h alcanzado");
  }
  if (biweeklyRemainMin <= 10 * 60 && biweeklyRemainMin > 0) {
    warnings.push(`Quedan ${formatHM(biweeklyRemainMin)} de conduccion bisemanal`);
  }
  if (extensionsUsed >= 2) {
    warnings.push("2 extensiones de 10h usadas esta semana");
  }
  if (reducedRestsUsed >= 3 && !canUseSplitRest) {
    if (isCurrentDouble) {
      warnings.push("3 descansos reducidos usados (descanso 9h no disponible hasta el siguiente descanso semanal).");
    } else {
      warnings.push("3 descansos reducidos usados. Disponibilidad 13h.");
    }
  }
  if (isCurrentDouble) {
    warnings.push("Doble conduccion activada: ventana legal 30h, disponibilidad maxima 21h, umbrales 19h/21h.");
  }
  if (isCurrentDouble && typeof currentDurMin === "number" && currentDurMin > 19 * 60 && currentDurMin <= 21 * 60) {
    warnings.push(
      "Doble conduccion: has superado 19h de jornada. Tacoplan desactiva la opción de 11h y deja únicamente el descanso diario de 9h dentro de la ventana de 30h.",
    );
  }

  const pendientes = compensaciones.filter((c) => !c.compensada);
  if (pendientes.length > 0) {
    const totalPendienteMin = pendientes.reduce(
      (sum, c) => sum + c.horasDeuda * 60 + c.minutosDeuda, 0,
    );
    warnings.push(`Compensacion pendiente: ${formatHM(totalPendienteMin)}`);
  }

  const isMonday = ahora.getUTCDay() === 1;

  return {
    weeklyDriveMin,
    biweeklyDriveMin,
    weeklyRemainMin,
    biweeklyRemainMin,
    extensionsUsed,
    reducedRestsUsed,
    canUseSplitRest,
    splitRestFirstPartMin,
    maxDriveTodayMin,
    dayMaxDutyMin,
    canUseExtension,
    canUseReducedRest,
    maxDutyLimitTime,
    prevRestMin,
    prevRestType,
    isMonday,
    warnings,
    restOptions,
  };
}

function formatHM(minutes: number): string {
  let m = Number(minutes);
  if (!Number.isFinite(m) || m < 0) m = 0;
  if (m > 52 * 7 * 24 * 60) m = 0;
  const h = Math.floor(m / 60);
  const m0 = Math.floor(m % 60);
  if (m0 === 0) return `${h}h`;
  return `${h}h ${m0}m`;
}

const WEEKDAYS: Record<string, string[]> = {
  es: ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  ar: ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"],
  fr: ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"],
};

const AT_WORD: Record<string, string> = { es: "a las", en: "at", ar: "الساعة", fr: "à" };

export function formatDateTimeES(date: Date, locale: string = "es"): string {
  const lang = WEEKDAYS[locale] ? locale : "es";
  const day = WEEKDAYS[lang][date.getDay()];
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${day} ${dd}/${mm}/${yyyy} ${AT_WORD[lang]} ${hh}:${min}`;
}
