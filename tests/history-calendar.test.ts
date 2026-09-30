import assert from "node:assert/strict";
import test from "node:test";
import {
  getCalendarDietLabel,
  journeyTouchesCalendarDate,
} from "../lib/history-calendar";

test("los dias naturales muestran su dieta real y nunca FUERA", () => {
  assert.equal(getCalendarDietLabel("INTERNACIONAL", null), "INT");
  assert.equal(getCalendarDietLabel("NACIONAL", null), "NAC");
  assert.equal(getCalendarDietLabel("REGIONAL", null), "REG");
});

test("la dieta natural prevalece sobre el tipo de la jornada", () => {
  assert.equal(getCalendarDietLabel("INTERNACIONAL", "REGIONAL"), "INT");
});

test("reconoce rutas internacionales combinadas", () => {
  assert.equal(getCalendarDietLabel(null, "INTERNACIONAL"), "INT");
  assert.equal(getCalendarDietLabel(null, "REGIONAL_INTL"), "INT");
  assert.equal(getCalendarDietLabel(null, "NAC_INTL"), "INT");
});

test("una jornada que cruza medianoche aparece en ambos dias", () => {
  const journey = { fechaInicio: "2026-09-29", fechaFin: "2026-09-30" };
  assert.equal(journeyTouchesCalendarDate(journey, "2026-09-29"), true);
  assert.equal(journeyTouchesCalendarDate(journey, "2026-09-30"), true);
  assert.equal(journeyTouchesCalendarDate(journey, "2026-09-28"), false);
  assert.equal(journeyTouchesCalendarDate(journey, "2026-10-01"), false);
});
