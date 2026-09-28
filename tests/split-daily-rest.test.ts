import test from "node:test";
import assert from "node:assert/strict";

import {
  computeReducedRestsInUtcWeek,
  getQualifiedSplitDailyRestFirstPartMin,
  getSplitDailyRestComputedTotalMin,
} from "../lib/legalEngine";

function buildClosedJornada(input: {
  id: string;
  startAt: string;
  endAt: string;
  split?: boolean;
}) {
  const split = input.split === true;
  return {
    id: input.id,
    startAt: input.startAt,
    endAt: input.endAt,
    fechaInicio: input.startAt.slice(0, 10),
    fechaFin: input.endAt.slice(0, 10),
    splitRestDetected: split,
    splitRestFirstPartMin: split ? 3 * 60 : null,
    splitRestSecondPartMin: split ? 9 * 60 : null,
    countsAsReducedRest: split ? false : true,
  } as any;
}

const WEEK_MONDAY = "2026-07-13";
const WEEK_SUNDAY = "2026-07-19";

test("9h despues de una pausa previa de 3h no suma descanso reducido semanal", () => {
  const prev = buildClosedJornada({
    id: "prev-split",
    startAt: "2026-07-15T06:00:00Z",
    endAt: "2026-07-15T18:00:00Z",
    split: true,
  });
  const current = buildClosedJornada({
    id: "curr-complete",
    startAt: "2026-07-16T03:00:00Z",
    endAt: "2026-07-16T12:00:00Z",
  });

  const reduced = computeReducedRestsInUtcWeek([prev, current], WEEK_MONDAY, WEEK_SUNDAY);
  assert.equal(reduced, 0);
});

test("9h sin pausa previa de 3h sigue contando como descanso reducido semanal", () => {
  const prev = buildClosedJornada({
    id: "prev-normal",
    startAt: "2026-07-15T06:00:00Z",
    endAt: "2026-07-15T18:00:00Z",
  });
  const current = buildClosedJornada({
    id: "curr-reduced",
    startAt: "2026-07-16T03:00:00Z",
    endAt: "2026-07-16T12:00:00Z",
  });

  const reduced = computeReducedRestsInUtcWeek([prev, current], WEEK_MONDAY, WEEK_SUNDAY);
  assert.equal(reduced, 1);
});

test("la jornada abierta con descanso previo 3h + 9h no incrementa el contador de reducidos", () => {
  const prev = buildClosedJornada({
    id: "prev-open-split",
    startAt: "2026-07-15T06:00:00Z",
    endAt: "2026-07-15T18:00:00Z",
    split: true,
  });

  const reduced = computeReducedRestsInUtcWeek(
    [prev],
    WEEK_MONDAY,
    WEEK_SUNDAY,
    {
      startAt: "2026-07-16T03:00:00Z",
      descansoAnteriorMin: 9 * 60,
      tipoDescansoAnterior: "DESCANSO_DIARIO_COMPLETO",
    },
  );

  assert.equal(reduced, 0);
});

test("la jornada abierta con 9h sin pausa previa sigue incrementando el contador de reducidos", () => {
  const prev = buildClosedJornada({
    id: "prev-open-normal",
    startAt: "2026-07-15T06:00:00Z",
    endAt: "2026-07-15T18:00:00Z",
  });

  const reduced = computeReducedRestsInUtcWeek(
    [prev],
    WEEK_MONDAY,
    WEEK_SUNDAY,
    {
      startAt: "2026-07-16T03:00:00Z",
      descansoAnteriorMin: 9 * 60,
      tipoDescansoAnterior: "DESCANSO_DIARIO_REDUCIDO",
    },
  );

  assert.equal(reduced, 1);
});

test("el descanso fraccionado conserva el tramo final real y suma el total computado legal", () => {
  const prev = buildClosedJornada({
    id: "prev-display-split",
    startAt: "2026-07-15T06:00:00Z",
    endAt: "2026-07-15T18:00:00Z",
    split: true,
  });

  assert.equal(getQualifiedSplitDailyRestFirstPartMin(prev), 3 * 60);
  assert.equal(getSplitDailyRestComputedTotalMin(9 * 60 + 3, prev), 12 * 60 + 3);
});

test("sin pausa previa de 3h no existe total computado fraccionado", () => {
  const prev = buildClosedJornada({
    id: "prev-display-normal",
    startAt: "2026-07-15T06:00:00Z",
    endAt: "2026-07-15T18:00:00Z",
  });

  assert.equal(getQualifiedSplitDailyRestFirstPartMin(prev), null);
  assert.equal(getSplitDailyRestComputedTotalMin(9 * 60 + 3, prev), null);
});
