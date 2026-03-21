import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  integer,
  boolean,
  decimal,
  pgEnum,
} from "drizzle-orm/pg-core";
import { z } from "zod";

export const tipoRutaEnum = pgEnum("tipo_ruta", [
  "REGIONAL_INTL",
  "NAC_INTL",
  "NACIONAL",
  "INTERNACIONAL",
]);

export const dietaModoEnum = pgEnum("dieta_modo", ["AUTO", "MANUAL"]);

export const dietaManualTipoEnum = pgEnum("dieta_manual_tipo", [
  "NACIONAL",
  "INTERNACIONAL",
]);

export const dietaManualPctEnum = pgEnum("dieta_manual_pct", [
  "100",
  "60",
  "30",
]);

export const tipoDescansoEnum = pgEnum("tipo_descanso", [
  "DESCANSO_DIARIO_COMPLETO",
  "DESCANSO_DIARIO_REDUCIDO",
  "DESCANSO_SEMANAL_COMPLETO",
  "DESCANSO_SEMANAL_REDUCIDO",
  "INFRACCION_DESCANSO",
]);

export const jornadas = pgTable("jornadas", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  fechaInicio: text("fecha_inicio").notNull(),
  horaInicio: text("hora_inicio").notNull(),
  lugarInicio: text("lugar_inicio").notNull(),
  fechaFin: text("fecha_fin"),
  horaFin: text("hora_fin"),
  lugarFin: text("lugar_fin"),
  conduccionMin: integer("conduccion_min"),
  tipoRuta: tipoRutaEnum("tipo_ruta"),
  pernocta: boolean("pernocta"),
  dietaModo: dietaModoEnum("dieta_modo").default("AUTO"),
  dietaManualTipo: dietaManualTipoEnum("dieta_manual_tipo"),
  dietaManualPct: dietaManualPctEnum("dieta_manual_pct"),
  dietaImporteEur: decimal("dieta_importe_eur", {
    precision: 10,
    scale: 2,
  }),
  descansoAnteriorMin: integer("descanso_anterior_min"),
  tipoDescansoAnterior: tipoDescansoEnum("tipo_descanso_anterior"),
  duracionJornadaMin: integer("duracion_jornada_min"),
});

export const compensaciones = pgTable("compensaciones", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  jornadaId: varchar("jornada_id").references(() => jornadas.id),
  horasDeuda: integer("horas_deuda").notNull(),
  minutosDeuda: integer("minutos_deuda").notNull(),
  fechaLimite: text("fecha_limite").notNull(),
  compensada: boolean("compensada").default(false),
  fechaCompensacion: text("fecha_compensacion"),
});

export const RUTAS = ["NACIONAL", "INTERNACIONAL", "REGIONAL_INTL", "NAC_INTL"] as const;
export type TipoRuta = (typeof RUTAS)[number];

export const insertJornadaInicioSchema = z.object({
  fechaInicio: z.string().min(1),
  horaInicio: z.string().min(1),
  lugarInicio: z.string().min(1),
});

export const insertJornadaCierreSchema = z.object({
  fechaFin: z.string().min(1),
  horaFin: z.string().min(1),
  lugarFin: z.string().min(1),
  tipoRuta: z.enum(["REGIONAL_INTL", "NAC_INTL", "NACIONAL", "INTERNACIONAL"]),
  pernocta: z.boolean(),
  dietaModo: z.enum(["AUTO", "MANUAL"]).default("AUTO"),
  dietaManualTipo: z.enum(["NACIONAL", "INTERNACIONAL"]).optional(),
  dietaManualPct: z.enum(["100", "60", "30"]).optional(),
  conduccionMin: z.number().optional(),
});

export const insertJornadaCompletaSchema = z.object({
  fechaInicio: z.string().min(1),
  horaInicio: z.string().min(1),
  lugarInicio: z.string().min(1),
  fechaFin: z.string().min(1),
  horaFin: z.string().min(1),
  lugarFin: z.string().min(1),
  tipoRuta: z.enum(["REGIONAL_INTL", "NAC_INTL", "NACIONAL", "INTERNACIONAL"]),
  pernocta: z.boolean(),
  dietaModo: z.enum(["AUTO", "MANUAL"]).default("AUTO"),
  dietaManualTipo: z.enum(["NACIONAL", "INTERNACIONAL"]).optional(),
  dietaManualPct: z.enum(["100", "60", "30"]).optional(),
  conduccionMin: z.number().optional(),
});

export type Jornada = typeof jornadas.$inferSelect;
export type Compensacion = typeof compensaciones.$inferSelect;
export type InsertJornadaInicio = z.infer<typeof insertJornadaInicioSchema>;
export type InsertJornadaCierre = z.infer<typeof insertJornadaCierreSchema>;
export type InsertJornadaCompleta = z.infer<typeof insertJornadaCompletaSchema>;

export const DIETAS = {
  INTERNACIONAL: { "100": 72.77, "60": 43.66, "30": 21.83 },
  NACIONAL: { "100": 54.3, "60": 32.58, "30": 16.29 },
} as const;
