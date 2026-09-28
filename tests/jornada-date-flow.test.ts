import test from "node:test";
import assert from "node:assert/strict";

import { parseDisplayDateToISO } from "../lib/utils";

function resolveDateOrThrow(displayDate: string): string {
  const iso = parseDisplayDateToISO(displayDate);
  assert.ok(iso, `La fecha visible debe parsearse: ${displayDate}`);
  return iso;
}

function buildLocalTimestamp(fechaIso: string, hora: string): string {
  return `${fechaIso}T${hora}:00`;
}

function buildJornadaSnapshot(input: {
  fechaInicioInput: string;
  horaInicio: string;
  fechaFinInput: string;
  horaFin: string;
}) {
  const fechaInicio = resolveDateOrThrow(input.fechaInicioInput);
  const fechaFin = resolveDateOrThrow(input.fechaFinInput);
  return {
    fechaInicio,
    horaInicio: input.horaInicio,
    fechaFin,
    horaFin: input.horaFin,
    startAt: buildLocalTimestamp(fechaInicio, input.horaInicio),
    endAt: buildLocalTimestamp(fechaFin, input.horaFin),
  };
}

test("acepta fechas DD/MM/YYYY y variantes con un solo digito", () => {
  assert.equal(parseDisplayDateToISO("17/07/2026"), "2026-07-17");
  assert.equal(parseDisplayDateToISO("17/7/2026"), "2026-07-17");
  assert.equal(parseDisplayDateToISO("7/07/2026"), "2026-07-07");
  assert.equal(parseDisplayDateToISO("7/7/2026"), "2026-07-07");
  assert.equal(parseDisplayDateToISO(" 17 / 07 / 2026 "), "2026-07-17");
});

test("jornada normal conserva exactamente la fecha elegida", () => {
  const snapshot = buildJornadaSnapshot({
    fechaInicioInput: "17/07/2026",
    horaInicio: "08:00",
    fechaFinInput: "17/07/2026",
    horaFin: "18:00",
  });

  assert.deepEqual(snapshot, {
    fechaInicio: "2026-07-17",
    horaInicio: "08:00",
    fechaFin: "2026-07-17",
    horaFin: "18:00",
    startAt: "2026-07-17T08:00:00",
    endAt: "2026-07-17T18:00:00",
  });
});

test("jornada que cruza medianoche conserva inicio y fin en dias distintos", () => {
  const snapshot = buildJornadaSnapshot({
    fechaInicioInput: "17/07/2026",
    horaInicio: "22:00",
    fechaFinInput: "18/07/2026",
    horaFin: "06:00",
  });

  assert.equal(snapshot.fechaInicio, "2026-07-17");
  assert.equal(snapshot.fechaFin, "2026-07-18");
  assert.equal(snapshot.startAt, "2026-07-17T22:00:00");
  assert.equal(snapshot.endAt, "2026-07-18T06:00:00");
});

test("jornada cerca de medianoche no desplaza la fecha confirmada", () => {
  const snapshot = buildJornadaSnapshot({
    fechaInicioInput: "17/07/2026",
    horaInicio: "23:59",
    fechaFinInput: "18/07/2026",
    horaFin: "00:10",
  });

  assert.equal(snapshot.fechaInicio, "2026-07-17");
  assert.equal(snapshot.fechaFin, "2026-07-18");
  assert.equal(snapshot.startAt, "2026-07-17T23:59:00");
  assert.equal(snapshot.endAt, "2026-07-18T00:10:00");
});

test("el valor visible del usuario prevalece sobre un ISO interno obsoleto", () => {
  const visibleInput = "17/7/2026";
  const staleInternalIso = "2026-07-15";
  const resolved = resolveDateOrThrow(visibleInput);

  assert.equal(staleInternalIso, "2026-07-15");
  assert.equal(resolved, "2026-07-17");
  assert.notEqual(resolved, staleInternalIso);
});

test("editar y volver a guardar usa la fecha visible actual", () => {
  const original = {
    fechaInicio: "2026-07-15",
    startAt: "2026-07-15T08:00:00",
    fechaFin: "2026-07-15",
    endAt: "2026-07-15T18:00:00",
  };
  const edited = buildJornadaSnapshot({
    fechaInicioInput: "17/7/2026",
    horaInicio: "08:00",
    fechaFinInput: "17/7/2026",
    horaFin: "18:00",
  });

  assert.equal(original.fechaInicio, "2026-07-15");
  assert.equal(edited.fechaInicio, "2026-07-17");
  assert.equal(edited.startAt, "2026-07-17T08:00:00");
  assert.equal(edited.endAt, "2026-07-17T18:00:00");
});

test("finalizar jornada abierta conserva la fecha visible de cierre", () => {
  const openJornada = {
    fechaInicio: "2026-07-17",
    horaInicio: "22:00",
    startAt: "2026-07-17T22:00:00",
  };
  const resolvedFechaFin = resolveDateOrThrow("18/07/2026");
  const endAt = buildLocalTimestamp(resolvedFechaFin, "06:00");

  assert.equal(openJornada.fechaInicio, "2026-07-17");
  assert.equal(resolvedFechaFin, "2026-07-18");
  assert.equal(endAt, "2026-07-18T06:00:00");
});

for (const timeZone of ["Europe/Madrid", "Europe/Paris", "Europe/Warsaw"]) {
  test(`la fecha seleccionada se mantiene igual en ${timeZone}`, () => {
    const snapshot = buildJornadaSnapshot({
      fechaInicioInput: "17/07/2026",
      horaInicio: "08:00",
      fechaFinInput: "18/07/2026",
      horaFin: "06:00",
    });

    assert.equal(snapshot.fechaInicio, "2026-07-17");
    assert.equal(snapshot.fechaFin, "2026-07-18");
  });
}
