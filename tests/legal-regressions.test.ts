import test from "node:test";
import assert from "node:assert/strict";

import {
  computeLegalPlan,
  computeReducidosSinceLastWeeklyRest,
  evaluateJornada,
} from "../lib/legalEngine";
import { validateFerryRest } from "../lib/ferryEngine";

function closedJornada(
  id: string,
  startAt: string,
  endAt: string,
  conduccionMin: number,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    startAt,
    endAt,
    fechaInicio: startAt.slice(0, 10),
    fechaFin: endAt.slice(0, 10),
    horaInicio: startAt.slice(11, 16),
    horaFin: endAt.slice(11, 16),
    conduccionMin,
    duracionJornadaMin: Math.round(
      (new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000,
    ),
    descansoAnteriorMin: 11 * 60,
    tipoDescansoAnterior: "DESCANSO_DIARIO_COMPLETO",
    ...extra,
  } as any;
}

function currentUtcWeekTuesday(): { startAt: string; endAt: string } {
  const now = new Date();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = monday.getUTCDay();
  monday.setUTCDate(monday.getUTCDate() - (day === 0 ? 6 : day - 1));
  const tuesday = new Date(monday);
  tuesday.setUTCDate(tuesday.getUTCDate() + 1);
  tuesday.setUTCHours(8, 0, 0, 0);
  const end = new Date(tuesday.getTime() + 10 * 60 * 60000);
  return { startAt: tuesday.toISOString(), endAt: end.toISOString() };
}

test("el plan de cierre no suma dos veces la jornada ya guardada", () => {
  const { startAt, endAt } = currentUtcWeekTuesday();
  const current = closedJornada("current", startAt, endAt, 5 * 60);

  const plan = computeLegalPlan([current], [], {
    startAt: current.startAt,
    endAt: current.endAt,
    conduccionMin: current.conduccionMin,
    duracionJornadaMin: current.duracionJornadaMin,
  });

  assert.equal(plan.weeklyDriveMin, 5 * 60);
  assert.equal(plan.biweeklyDriveMin, 5 * 60);
});

test("el bisemanal conserva las dos partes de una jornada domingo-lunes", () => {
  const cross = closedJornada(
    "cross",
    "2026-09-27T20:00:00Z",
    "2026-09-28T04:00:00Z",
    8 * 60,
    { conduccionDomingoMin: 4 * 60, conduccionLunesMin: 4 * 60 },
  );
  const current = closedJornada(
    "current",
    "2026-09-29T08:00:00Z",
    "2026-09-29T18:00:00Z",
    5 * 60,
  );

  const result = evaluateJornada(current, [cross], []);

  assert.equal(result.conduccionSemanalMin, 9 * 60);
  assert.equal(result.conduccionBisemanalMin, 13 * 60);
});

test("los descansos reducidos no se reinician al cambiar de semana", () => {
  const jornadas = [
    closedJornada("j1", "2026-09-24T06:00:00Z", "2026-09-24T21:00:00Z", 300),
    closedJornada("j2", "2026-09-25T06:00:00Z", "2026-09-25T21:00:00Z", 300),
    closedJornada("j3", "2026-09-26T06:00:00Z", "2026-09-26T21:00:00Z", 300),
    closedJornada("j4", "2026-09-27T06:00:00Z", "2026-09-27T21:00:00Z", 300),
    closedJornada("j5", "2026-09-28T06:00:00Z", "2026-09-28T16:00:00Z", 300),
  ];

  assert.equal(computeReducidosSinceLastWeeklyRest(jornadas), 4);
});

test("el plan cuenta el descanso reducido anterior de una jornada todavía abierta", () => {
  const { startAt } = currentUtcWeekTuesday();
  const open = {
    id: "open",
    startAt,
    endAt: null,
    fechaInicio: startAt.slice(0, 10),
    fechaFin: null,
    descansoAnteriorMin: 9 * 60,
    tipoDescansoAnterior: "DESCANSO_DIARIO_REDUCIDO",
  } as any;

  const plan = computeLegalPlan([open], [], {
    startAt,
    descansoAnteriorMin: 9 * 60,
    tipoDescansoAnterior: "DESCANSO_DIARIO_REDUCIDO",
  });

  assert.equal(plan.reducedRestsUsed, 1);
});

test("un descanso semanal reinicia el contador de descansos diarios reducidos", () => {
  const jornadas = [
    closedJornada("j1", "2026-09-24T06:00:00Z", "2026-09-24T21:00:00Z", 300),
    closedJornada("j2", "2026-09-25T06:00:00Z", "2026-09-25T21:00:00Z", 300),
    closedJornada("j3", "2026-09-27T06:00:00Z", "2026-09-27T16:00:00Z", 300),
    closedJornada("j4", "2026-09-28T01:00:00Z", "2026-09-28T11:00:00Z", 300),
  ];

  assert.equal(computeReducidosSinceLastWeeklyRest(jornadas), 1);
});

test("un descanso ferry de 9h no puede interrumpirse", () => {
  const result = validateFerryRest({
    startTime: "2026-09-30T08:00:00Z",
    restType: "9h",
    interruptions: [{ startMin: 60, endMin: 80 }],
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, "INTERRUPTED_REST_REQUIRES_11H");
});

test("un descanso ferry normal de 11h admite hasta dos interrupciones y 60 minutos", () => {
  const result = validateFerryRest({
    startTime: "2026-09-30T08:00:00Z",
    restType: "11h",
    interruptions: [
      { startMin: 60, endMin: 80 },
      { startMin: 300, endMin: 340 },
    ],
  });

  assert.equal(result.valid, true);
});
