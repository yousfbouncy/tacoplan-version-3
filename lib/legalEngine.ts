import type { Jornada, Compensacion } from "./local-storage";

export interface LegalInfraction {
  code: string;
  severity: "leve" | "grave" | "muy_grave";
  description: string;
}

export interface LegalWarning {
  code: string;
  description: string;
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

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
  const startDay = startDate.getDay();
  const endDay = endDate.getDay();
  const startDateStr = j.fechaInicio;
  const endDateStr = j.fechaFin;

  if (startDay === 0 && endDay === 1 && startDateStr !== endDateStr &&
      j.conduccionDomingoMin != null && j.conduccionLunesMin != null) {
    const weekStart = new Date(weekMondayStr + "T00:00:00");
    const weekMondayMs = weekStart.getTime();
    const nextMonday = new Date(weekMondayMs + 7 * 86400000);
    const nextMondayStr = `${nextMonday.getFullYear()}-${String(nextMonday.getMonth()+1).padStart(2,"0")}-${String(nextMonday.getDate()).padStart(2,"0")}`;

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

  const weekStartMs = new Date(weekMondayStr + "T00:00:00").getTime();
  const nextMondayDate = new Date(weekMondayStr + "T00:00:00");
  nextMondayDate.setDate(nextMondayDate.getDate() + 7);
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
  if (!j.fechaFin) return false;
  const startStr = j.fechaInicio;
  const endStr = j.fechaFin;
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
  includeOpenJornada?: { descansoAnteriorMin?: number | null } | null,
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
        reducidos++;
      }
    }
  }

  if (includeOpenJornada && includeOpenJornada.descansoAnteriorMin != null) {
    const gapMin = includeOpenJornada.descansoAnteriorMin;
    if (gapMin >= 24 * 60) {
      reducidos = 0;
    } else if (gapMin >= 9 * 60 && gapMin < 11 * 60) {
      reducidos++;
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

  if (durMin > 15 * 60) {
    infractions.push({
      code: "JORNADA_EXCESIVA",
      severity: "grave",
      description: `Duracion de jornada ${formatHM(durMin)} supera las 15h`,
    });
  } else if (durMin > 13 * 60) {
    warnings.push({
      code: "JORNADA_LARGA",
      description: `Duracion de jornada ${formatHM(durMin)} supera las 13h`,
    });
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

  const fechaJornada = new Date(jornada.fechaInicio + "T00:00:00");
  const lunes = getMondayOfWeek(fechaJornada);
  const domingo = new Date(lunes);
  domingo.setDate(lunes.getDate() + 6);
  const lunesStr = formatDateStr(lunes);
  const domingoStr = formatDateStr(domingo);

  const lunesAnterior = new Date(lunes);
  lunesAnterior.setDate(lunesAnterior.getDate() - 7);
  const lunesAnteriorStr = formatDateStr(lunesAnterior);

  const cerradas = allJornadas.filter((j) => j.fechaFin && j.id !== jornada.id);

  const semana = cerradas.filter(
    (j) => jornadaOverlapsWeek(j, lunesStr, domingoStr) || (j.fechaInicio >= lunesStr && j.fechaInicio <= domingoStr),
  );

  const semanaAnterior = cerradas.filter(
    (j) => jornadaOverlapsWeek(j, lunesAnteriorStr, formatDateStr(new Date(lunes.getTime() - 86400000))) || (j.fechaInicio >= lunesAnteriorStr && j.fechaInicio < lunesStr),
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

  const descansosReducidos = computeReducidosSinceLastWeeklyRest(
    allJornadas,
    { descansoAnteriorMin: jornada.descansoAnteriorMin },
  );

  const prevWeekMondayStr = lunesAnteriorStr;
  const prevWeekSundayStr = formatDateStr(new Date(lunes.getTime() - 86400000));
  let conduccionBisemanalMin = conduccionSemanalMin;
  const biSeenIds = new Set<string>(seenIds);
  biSeenIds.add(jornada.id);
  for (const j of semanaAnterior) {
    if (biSeenIds.has(j.id)) continue;
    biSeenIds.add(j.id);
    const prevWeekDriving = getJornadaDrivingForWeek(j, prevWeekMondayStr, prevWeekSundayStr);
    conduccionBisemanalMin += prevWeekDriving;
  }
  for (const j of semana) {
    if (!biSeenIds.has(j.id)) {
      biSeenIds.add(j.id);
      const prevWeekDriving = getJornadaDrivingForWeek(j, prevWeekMondayStr, prevWeekSundayStr);
      conduccionBisemanalMin += prevWeekDriving;
    }
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
    const deuda = 45 * 60 - descansoMin;
    if (deuda > 0) {
      compensacionGenerada = true;
      compensacionDeudaMin = deuda;
      warnings.push({
        code: "COMPENSACION_GENERADA",
        description: `Descanso semanal reducido genera deuda de ${formatHM(deuda)} a compensar en 14 dias`,
      });
    }
  }

  const pendientes = compensaciones.filter((c) => !c.compensada);
  if (pendientes.length > 0) {
    const totalPendienteMin = pendientes.reduce(
      (sum, c) => sum + c.horasDeuda * 60 + c.minutosDeuda, 0,
    );
    const primerVencimiento = pendientes
      .sort((a, b) => a.fechaLimite.localeCompare(b.fechaLimite))[0];
    const hoy = formatDateStr(new Date());
    if (primerVencimiento.fechaLimite < hoy) {
      infractions.push({
        code: "COMPENSACION_VENCIDA",
        severity: "muy_grave",
        description: `${formatHM(totalPendienteMin)} de compensacion vencida (limite: ${primerVencimiento.fechaLimite})`,
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
  const lunes = getMondayOfWeek(ahora);
  const domingo = new Date(lunes);
  domingo.setDate(lunes.getDate() + 6);
  const lunesStr = formatDateStr(lunes);
  const domingoStr = formatDateStr(domingo);

  const lunesAnterior = new Date(lunes);
  lunesAnterior.setDate(lunesAnterior.getDate() - 7);
  const lunesAnteriorStr = formatDateStr(lunesAnterior);

  const cerradas = allJornadas.filter((j) => j.fechaFin);

  const prevWeekSundayStr = formatDateStr(new Date(lunes.getTime() - 86400000));

  const semana = cerradas.filter(
    (j) => jornadaOverlapsWeek(j, lunesStr, domingoStr) || (j.fechaInicio >= lunesStr && j.fechaInicio <= domingoStr),
  );

  const semanaAnterior = cerradas.filter(
    (j) => jornadaOverlapsWeek(j, lunesAnteriorStr, prevWeekSundayStr) || (j.fechaInicio >= lunesAnteriorStr && j.fechaInicio < lunesStr),
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

  const descansosReducidos = computeReducidosSinceLastWeeklyRest(allJornadas);

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
  currentJornada?: { startAt: string; endAt?: string; conduccionMin?: number; duracionJornadaMin?: number; descansoAnteriorMin?: number | null; tipoDescansoAnterior?: string | null } | null,
  locale: string = "es",
): LegalPlan {
  const ahora = new Date();
  const lunes = getMondayOfWeek(ahora);
  const domingo = new Date(lunes);
  domingo.setDate(lunes.getDate() + 6);
  const lunesStr = formatDateStr(lunes);
  const domingoStr = formatDateStr(domingo);

  const lunesAnterior = new Date(lunes);
  lunesAnterior.setDate(lunesAnterior.getDate() - 7);
  const lunesAnteriorStr = formatDateStr(lunesAnterior);

  const cerradas = allJornadas.filter((j) => j.fechaFin);

  const prevWeekSundayStr = formatDateStr(new Date(lunes.getTime() - 86400000));

  const semana = cerradas.filter(
    (j) => jornadaOverlapsWeek(j, lunesStr, domingoStr) || (j.fechaInicio >= lunesStr && j.fechaInicio <= domingoStr),
  );

  const semanaAnterior = cerradas.filter(
    (j) => jornadaOverlapsWeek(j, lunesAnteriorStr, prevWeekSundayStr) || (j.fechaInicio >= lunesAnteriorStr && j.fechaInicio < lunesStr),
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

  const reducedRestsUsed = computeReducidosSinceLastWeeklyRest(
    allJornadas,
    currentJornada ? { descansoAnteriorMin: currentJornada.descansoAnteriorMin } : null,
  );

  let biweeklyDriveMin = weeklyDriveMin;
  const biSeenIds = new Set<string>(seenIds);
  for (const j of semanaAnterior) {
    if (biSeenIds.has(j.id)) continue;
    biSeenIds.add(j.id);
    const prevWeekDriving = getJornadaDrivingForWeek(j, lunesAnteriorStr, prevWeekSundayStr);
    biweeklyDriveMin += prevWeekDriving;
  }

  if (currentJornada) {
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

  const dayMaxDutyMin = canUseReducedRest ? 15 * 60 : 13 * 60;

  let maxDutyLimitTime: string | null = null;
  if (currentJornada?.startAt) {
    const startDate = new Date(currentJornada.startAt);
    if (!isNaN(startDate.getTime())) {
      const limitDate = new Date(startDate.getTime() + dayMaxDutyMin * 60000);
      maxDutyLimitTime = formatDateTimeES(limitDate, locale);
    }
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

      const rest11 = new Date(endDate.getTime() + 11 * 60 * 60000);
      restOptions.push({
        minutes: 660,
        label: "11h",
        enabled: true,
        nextStartTime: formatDateTimeES(rest11, locale),
        tomorrowMaxDutyMin: 13 * 60,
        tomorrowMaxDriveMin: tomorrowMaxDrive,
        type: "daily",
      });

      const rest9 = new Date(endDate.getTime() + 9 * 60 * 60000);
      restOptions.push({
        minutes: 540,
        label: "9h",
        enabled: canUseReducedRest,
        nextStartTime: formatDateTimeES(rest9, locale),
        tomorrowMaxDutyMin: 15 * 60,
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
  if (reducedRestsUsed >= 3) {
    warnings.push("3 descansos reducidos usados. Disponibilidad 13h.");
  }

  const pendientes = compensaciones.filter((c) => !c.compensada);
  if (pendientes.length > 0) {
    const totalPendienteMin = pendientes.reduce(
      (sum, c) => sum + c.horasDeuda * 60 + c.minutosDeuda, 0,
    );
    warnings.push(`Compensacion pendiente: ${formatHM(totalPendienteMin)}`);
  }

  const isMonday = ahora.getDay() === 1;

  return {
    weeklyDriveMin,
    biweeklyDriveMin,
    weeklyRemainMin,
    biweeklyRemainMin,
    extensionsUsed,
    reducedRestsUsed,
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
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
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
