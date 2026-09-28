import { eq, desc, asc, and, gte, lte, isNull, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  jornadas,
  compensaciones,
  type Jornada,
  type Compensacion,
  type InsertJornadaInicio,
  type InsertJornadaCierre,
  type InsertJornadaCompleta,
  DIETAS,
} from "@shared/schema";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool);

function calcDescansoMin(
  finFecha: string,
  finHora: string,
  inicioFecha: string,
  inicioHora: string,
): number {
  const fin = new Date(`${finFecha}T${finHora}:00`);
  const inicio = new Date(`${inicioFecha}T${inicioHora}:00`);
  return Math.round((inicio.getTime() - fin.getTime()) / 60000);
}

function clasificarDescanso(minutos: number): string {
  if (minutos < 9 * 60) return "INFRACCION_DESCANSO";
  if (minutos < 11 * 60) return "DESCANSO_DIARIO_REDUCIDO";
  if (minutos < 24 * 60) return "DESCANSO_DIARIO_COMPLETO";
  if (minutos < 45 * 60) return "DESCANSO_SEMANAL_REDUCIDO";
  return "DESCANSO_SEMANAL_COMPLETO";
}

function calcDuracionJornadaMin(
  fechaInicio: string,
  horaInicio: string,
  fechaFin: string,
  horaFin: string,
): number {
  const inicio = new Date(`${fechaInicio}T${horaInicio}:00`);
  const fin = new Date(`${fechaFin}T${horaFin}:00`);
  return Math.round((fin.getTime() - inicio.getTime()) / 60000);
}

function calcDietaAuto(
  tipoRuta: string,
  _pernocta: boolean,
): number {
  switch (tipoRuta) {
    case "NACIONAL":
      return DIETAS.NACIONAL["100"];
    case "INTERNACIONAL":
      return DIETAS.INTERNACIONAL["100"];
    case "REGIONAL_INTL":
      return DIETAS.INTERNACIONAL["60"];
    case "NAC_INTL":
      return Math.round((DIETAS.NACIONAL["60"] + DIETAS.INTERNACIONAL["60"]) * 100) / 100;
    default:
      return 0;
  }
}

function calcDietaManual(
  tipo: "NACIONAL" | "INTERNACIONAL",
  pct: "100" | "60" | "30",
): number {
  return DIETAS[tipo][pct];
}

function formatDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatFechaES(dateStr: string): string {
  const m = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(dateStr || "");
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return formatDateStr(d);
}

export async function getJornadaAbierta(): Promise<Jornada | null> {
  const results = await db
    .select()
    .from(jornadas)
    .where(isNull(jornadas.fechaFin))
    .limit(1);
  return results[0] || null;
}

export async function crearJornadaInicio(
  data: InsertJornadaInicio,
): Promise<Jornada> {
  const existing = await getJornadaAbierta();
  if (existing) {
    throw new Error("Ya existe una jornada abierta");
  }
  const results = await db
    .insert(jornadas)
    .values({
      fechaInicio: data.fechaInicio,
      horaInicio: data.horaInicio,
      lugarInicio: data.lugarInicio,
    })
    .returning();
  return results[0];
}

async function calcDescansoPrevio(fechaInicio: string, horaInicio: string) {
  const anterior = await db
    .select()
    .from(jornadas)
    .where(and(isNotNull(jornadas.fechaFin), isNotNull(jornadas.horaFin)))
    .orderBy(desc(jornadas.fechaFin), desc(jornadas.horaFin))
    .limit(1);

  let descansoAnteriorMin: number | null = null;
  let tipoDescansoAnterior: any = null;

  if (anterior[0] && anterior[0].fechaFin && anterior[0].horaFin) {
    descansoAnteriorMin = calcDescansoMin(
      anterior[0].fechaFin,
      anterior[0].horaFin,
      fechaInicio,
      horaInicio,
    );
    tipoDescansoAnterior = clasificarDescanso(descansoAnteriorMin);
  }

  return { descansoAnteriorMin, tipoDescansoAnterior };
}

async function checkCompensaciones(
  descansoAnteriorMin: number | null,
  tipoDescansoAnterior: string | null,
  jornadaId: string,
  fechaInicio: string,
) {
  if (descansoAnteriorMin != null && descansoAnteriorMin > 0) {
    const pendientes = await db
      .select()
      .from(compensaciones)
      .where(eq(compensaciones.compensada, false))
      .orderBy(asc(compensaciones.fechaLimite));

    if (pendientes.length > 0) {
      const totalDeudaMin = pendientes.reduce(
        (sum, c) => sum + c.horasDeuda * 60 + c.minutosDeuda, 0,
      );

      if (descansoAnteriorMin >= 9 * 60 + totalDeudaMin) {
        for (const c of pendientes) {
          await db
            .update(compensaciones)
            .set({ compensada: true, fechaCompensacion: fechaInicio })
            .where(eq(compensaciones.id, c.id));
        }
      }
    }
  }

  if (
    tipoDescansoAnterior === "DESCANSO_SEMANAL_REDUCIDO" &&
    descansoAnteriorMin != null
  ) {
    const deudaMin = 45 * 60 - descansoAnteriorMin;
    if (deudaMin > 0) {
      const existingPending = await db
        .select()
        .from(compensaciones)
        .where(eq(compensaciones.compensada, false))
        .orderBy(asc(compensaciones.fechaLimite));

      let fechaLimite: string;
      if (existingPending.length > 0) {
        fechaLimite = existingPending[0].fechaLimite;
      } else {
        fechaLimite = addDays(fechaInicio, 14);
      }

      await db.insert(compensaciones).values({
        jornadaId,
        horasDeuda: Math.floor(deudaMin / 60),
        minutosDeuda: deudaMin % 60,
        fechaLimite,
      });
    }
  }
}

export async function cerrarJornada(
  id: string,
  data: InsertJornadaCierre,
): Promise<Jornada> {
  const jornada = await db
    .select()
    .from(jornadas)
    .where(eq(jornadas.id, id))
    .limit(1);
  if (!jornada[0]) throw new Error("Jornada no encontrada");
  if (jornada[0].fechaFin) throw new Error("Jornada ya cerrada");

  const { descansoAnteriorMin, tipoDescansoAnterior } = await calcDescansoPrevio(
    jornada[0].fechaInicio,
    jornada[0].horaInicio,
  );

  const duracionJornadaMin = calcDuracionJornadaMin(
    jornada[0].fechaInicio,
    jornada[0].horaInicio,
    data.fechaFin,
    data.horaFin,
  );

  let dietaImporteEur: number;
  if (data.dietaModo === "MANUAL" && data.dietaManualTipo && data.dietaManualPct) {
    dietaImporteEur = calcDietaManual(data.dietaManualTipo, data.dietaManualPct);
  } else {
    dietaImporteEur = calcDietaAuto(data.tipoRuta, data.pernocta);
  }

  const results = await db
    .update(jornadas)
    .set({
      fechaFin: data.fechaFin,
      horaFin: data.horaFin,
      lugarFin: data.lugarFin,
      tipoRuta: data.tipoRuta,
      pernocta: data.pernocta,
      dietaModo: data.dietaModo,
      dietaManualTipo: data.dietaManualTipo || null,
      dietaManualPct: data.dietaManualPct || null,
      dietaImporteEur: dietaImporteEur.toFixed(2),
      descansoAnteriorMin,
      tipoDescansoAnterior,
      duracionJornadaMin,
      conduccionMin: data.conduccionMin || null,
    })
    .where(eq(jornadas.id, id))
    .returning();

  await checkCompensaciones(descansoAnteriorMin, tipoDescansoAnterior, id, jornada[0].fechaInicio);

  return results[0];
}

export async function crearJornadaCompleta(
  data: InsertJornadaCompleta,
): Promise<Jornada> {
  const { descansoAnteriorMin, tipoDescansoAnterior } = await calcDescansoPrevio(
    data.fechaInicio,
    data.horaInicio,
  );

  const duracionJornadaMin = calcDuracionJornadaMin(
    data.fechaInicio,
    data.horaInicio,
    data.fechaFin,
    data.horaFin,
  );

  let dietaImporteEur: number;
  if (data.dietaModo === "MANUAL" && data.dietaManualTipo && data.dietaManualPct) {
    dietaImporteEur = calcDietaManual(data.dietaManualTipo, data.dietaManualPct);
  } else {
    dietaImporteEur = calcDietaAuto(data.tipoRuta, data.pernocta);
  }

  const results = await db
    .insert(jornadas)
    .values({
      fechaInicio: data.fechaInicio,
      horaInicio: data.horaInicio,
      lugarInicio: data.lugarInicio,
      fechaFin: data.fechaFin,
      horaFin: data.horaFin,
      lugarFin: data.lugarFin,
      tipoRuta: data.tipoRuta,
      pernocta: data.pernocta,
      dietaModo: data.dietaModo,
      dietaManualTipo: data.dietaManualTipo || null,
      dietaManualPct: data.dietaManualPct || null,
      dietaImporteEur: dietaImporteEur.toFixed(2),
      descansoAnteriorMin,
      tipoDescansoAnterior,
      duracionJornadaMin,
      conduccionMin: data.conduccionMin || null,
    })
    .returning();

  await checkCompensaciones(descansoAnteriorMin, tipoDescansoAnterior, results[0].id, data.fechaInicio);

  return results[0];
}

export async function listarJornadas(
  from?: string,
  to?: string,
): Promise<Jornada[]> {
  const conditions = [];
  if (from) conditions.push(gte(jornadas.fechaInicio, from));
  if (to) conditions.push(lte(jornadas.fechaInicio, to));

  if (conditions.length > 0) {
    return db
      .select()
      .from(jornadas)
      .where(and(...conditions))
      .orderBy(desc(jornadas.fechaInicio), desc(jornadas.horaInicio));
  }
  return db
    .select()
    .from(jornadas)
    .orderBy(desc(jornadas.fechaInicio), desc(jornadas.horaInicio));
}

export async function getResumenDietas(
  from: string,
  to: string,
): Promise<{
  total: number;
  desglose: Array<{ tipo: string; cantidad: number; total: number }>;
}> {
  const jornadasPeriodo = await db
    .select()
    .from(jornadas)
    .where(
      and(
        isNotNull(jornadas.fechaFin),
        gte(jornadas.fechaInicio, from),
        lte(jornadas.fechaInicio, to),
      ),
    );

  const desglose: Record<string, { cantidad: number; total: number }> = {};
  let totalGeneral = 0;

  for (const j of jornadasPeriodo) {
    if (!j.dietaImporteEur) continue;
    const importe = parseFloat(j.dietaImporteEur);
    totalGeneral += importe;

    let key: string;
    if (j.dietaModo === "MANUAL" && j.dietaManualTipo && j.dietaManualPct) {
      key = `${j.dietaManualTipo}_${j.dietaManualPct}`;
    } else if (j.tipoRuta === "NAC_INTL") {
      key = "NAC_INTL_AUTO";
    } else if (j.tipoRuta === "NACIONAL") {
      key = "NACIONAL_100";
    } else if (j.tipoRuta === "INTERNACIONAL") {
      key = "INTERNACIONAL_100";
    } else {
      key = "INTERNACIONAL_60";
    }

    if (!desglose[key]) {
      desglose[key] = { cantidad: 0, total: 0 };
    }
    desglose[key].cantidad++;
    desglose[key].total = Math.round((desglose[key].total + importe) * 100) / 100;
  }

  return {
    total: Math.round(totalGeneral * 100) / 100,
    desglose: Object.entries(desglose).map(([tipo, data]) => ({
      tipo,
      ...data,
    })),
  };
}

export async function eliminarJornada(id: string): Promise<void> {
  await db.delete(compensaciones).where(eq(compensaciones.jornadaId, id));
  await db.delete(jornadas).where(eq(jornadas.id, id));
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
  compensacionAgregada: CompensacionAgregada | null;
  alertas: Array<{
    tipo: "info" | "warning" | "danger";
    mensaje: string;
  }>;
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

  const jornadasSemana = await db
    .select()
    .from(jornadas)
    .where(
      and(
        isNotNull(jornadas.fechaFin),
        gte(jornadas.fechaInicio, lunesStr),
        lte(jornadas.fechaInicio, domingoStr),
      ),
    );

  const jornadasBisemana = await db
    .select()
    .from(jornadas)
    .where(
      and(
        isNotNull(jornadas.fechaFin),
        gte(jornadas.fechaInicio, lunesAnteriorStr),
        lte(jornadas.fechaInicio, domingoStr),
      ),
    );

  let conduccionSemanalMin = 0;
  let extensiones10h = 0;
  let descansosReducidos = 0;

  for (const j of jornadasSemana) {
    const durMin = j.duracionJornadaMin || 0;
    const condMin = j.conduccionMin || Math.round(durMin * 0.65);
    conduccionSemanalMin += condMin;

    if (condMin > 9 * 60) {
      extensiones10h++;
    }

    if (durMin > 13 * 60) {
      descansosReducidos++;
    } else if (
      j.tipoDescansoAnterior === "DESCANSO_DIARIO_REDUCIDO"
    ) {
      descansosReducidos++;
    }
  }

  let conduccionBisemanalMin = 0;
  for (const j of jornadasBisemana) {
    const durMin = j.duracionJornadaMin || 0;
    const condMin = j.conduccionMin || Math.round(durMin * 0.65);
    conduccionBisemanalMin += condMin;
  }

  const maxSemanalMin = 56 * 60;
  const maxBisemanalMin = 90 * 60;

  const compPendientes = await db
    .select()
    .from(compensaciones)
    .where(eq(compensaciones.compensada, false))
    .orderBy(asc(compensaciones.fechaLimite));

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
        const jornadaLinked = await db
          .select()
          .from(jornadas)
          .where(eq(jornadas.id, c.jornadaId))
          .limit(1);
        if (jornadaLinked[0]) {
          fechaDescanso = jornadaLinked[0].fechaInicio;
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
    alertas.push({
      tipo: "warning",
      mensaje: `Te quedan ${h}h ${m}m de conduccion semanal`,
    });
  }
  if (restanteSemanalMin <= 0) {
    alertas.push({
      tipo: "danger",
      mensaje: "Has superado el limite de 56h semanales de conduccion",
    });
  }

  if (restanteBisemanalMin <= 10 * 60 && restanteBisemanalMin > 0) {
    const h = Math.floor(restanteBisemanalMin / 60);
    const m = restanteBisemanalMin % 60;
    alertas.push({
      tipo: "warning",
      mensaje: `Te quedan ${h}h ${m}m de conduccion bisemanal`,
    });
  }
  if (restanteBisemanalMin <= 0) {
    alertas.push({
      tipo: "danger",
      mensaje: "Has superado el limite de 90h bisemanales de conduccion",
    });
  }

  if (extensiones10h >= 2) {
    alertas.push({
      tipo: "danger",
      mensaje: "Has usado las 2 extensiones de 10h esta semana",
    });
  }

  if (descansosReducidos >= 3) {
    alertas.push({
      tipo: "danger",
      mensaje: "Has usado los 3 descansos diarios reducidos esta semana",
    });
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
    compensacionAgregada,
    alertas,
  };
}

export async function marcarCompensada(id: string): Promise<void> {
  const hoyStr = formatDateStr(new Date());
  await db
    .update(compensaciones)
    .set({ compensada: true, fechaCompensacion: hoyStr })
    .where(eq(compensaciones.id, id));
}

export async function marcarTodasCompensadas(): Promise<void> {
  const hoyStr = formatDateStr(new Date());
  await db
    .update(compensaciones)
    .set({ compensada: true, fechaCompensacion: hoyStr })
    .where(eq(compensaciones.compensada, false));
}
