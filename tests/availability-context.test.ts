import test from "node:test";
import assert from "node:assert/strict";
import { getAvailabilityContext, planAvailabilityAlarms } from "../lib/availability-context";
import type { Jornada } from "../lib/local-storage";

// Saturday -> Monday: the calendar week must not reset the ongoing rest cycle.
function cycle(reduced: number): Jornada[] {
  const start = Date.parse("2026-10-23T08:00:00Z");
  const rows: Jornada[] = [];
  const row = (id: string, at: number, open = false) => ({ id, startAt: new Date(at).toISOString(),
    endAt: open ? null : new Date(at + 15 * 3600000).toISOString(), fechaFin: open ? null : "closed",
    fechaInicio: new Date(at).toISOString().slice(0,10), horaInicio: "08:00" } as unknown as Jornada);
  rows.push(row("anchor", start));
  let at = start + (15 + 24) * 3600000;
  for (let i = 0; i < reduced; i++) { rows.push(row(String(i), at)); at += 24 * 3600000; }
  rows.push(row("active", at, true));
  return rows;
}
const shift = { id: "active", fechaInicio: "2026-10-27", horaInicio: "08:00" };
const pairs = (n: number) => planAvailabilityAlarms(shift, getAvailabilityContext(cycle(n)), true, 0);

test("13 h: three used rests, including rest before open shift, means one urgent alert", () => {
  assert.equal(getAvailabilityContext(cycle(3)).ampliacionesDisponibles, 0);
  assert.deepEqual(pairs(3).map(a => [a.limite,a.nivel]), [[13,"urgente"]]);
});
test("15 h: available extension gives soft 13 h and urgent 15 h, five minutes before", () => {
  const alerts = pairs(2);
  assert.deepEqual(alerts.map(a => [a.limite,a.nivel]), [[13,"suave"],[15,"urgente"]]);
  const start = new Date("2026-10-27T08:00:00").getTime();
  assert.deepEqual(alerts.map(a => (Date.parse(a.fecha)-start)/60000), [775,895]);
});
test("remaining extensions use the observed cycle, not Monday or driving extensions", () => {
  for (const n of [0,1,2,3,4]) {
    const rows = cycle(n);
    rows.forEach(j => { j.conduccionMin = 600; });
    assert.equal(getAvailabilityContext(rows).ampliacionesDisponibles, Math.max(0,3-n));
  }
});
test("unknown boundary, unavailable/stale state, invalid data: preventive only", () => {
  const noBoundary = getAvailabilityContext(cycle(2).slice(1));
  const invalid = cycle(2); invalid[1].endAt = "invalid";
  for (const ctx of [undefined, noBoundary, getAvailabilityContext(invalid), {...getAvailabilityContext(cycle(0)), shiftId:"other"}]) {
    const alerts = planAvailabilityAlarms(shift, ctx, true, 0);
    assert.deepEqual(alerts.map(a => [a.limite,a.nivel]), [[13,"preventiva"]]);
    assert.doesNotMatch(alerts[0].mensaje, /infracci[oó]n/i);
  }
});
test("weekly rest resets the cycle and split 3+9 does not consume a reduction", () => {
  const rows = cycle(3);
  rows[2].splitRestDetected = true; rows[2].countsAsReducedRest = false;
  rows[2].splitRestFirstPartMin = 180; rows[2].splitRestSecondPartMin = 540;
  assert.equal(getAvailabilityContext(rows).ampliacionesDisponibles, 1);
  rows.at(-1)!.startAt = new Date(Date.parse(rows.at(-2)!.endAt!) + 24*3600000).toISOString();
  assert.equal(getAvailabilityContext(rows).ampliacionesDisponibles, 3);
});
test("split conditions incomplete are not treated as exhausted; double driving has no 13/15 alerts", () => {
  const rows = cycle(3); rows.at(-1)!.splitRestFirstPartMin = 180;
  assert.equal(getAvailabilityContext(rows).ampliacion15h, "desconocida");
  rows.at(-1)!.isDoubleDriving = true;
  assert.deepEqual(planAvailabilityAlarms(shift, getAvailabilityContext(rows), true, 0), []);
});
test("closed, disabled, invalid and elapsed shifts do not schedule alerts; repeated plans have stable IDs", () => {
  const ctx = getAvailabilityContext(cycle(0));
  assert.deepEqual(planAvailabilityAlarms(null,ctx,true,0),[]);
  assert.deepEqual(planAvailabilityAlarms({...shift,fin:"closed"},ctx,true,0),[]);
  assert.deepEqual(planAvailabilityAlarms(shift,ctx,false,0),[]);
  assert.deepEqual(planAvailabilityAlarms({...shift,horaInicio:"bad"},ctx,true,0),[]);
  const alerts = planAvailabilityAlarms(shift,ctx,true,0);
  assert.deepEqual(planAvailabilityAlarms(shift,ctx,true,Date.parse(alerts[0].fecha)).map(a=>a.limite),[15]);
  assert.deepEqual(planAvailabilityAlarms(shift,ctx,true,Date.parse(alerts[1].fecha)),[]);
  assert.deepEqual(planAvailabilityAlarms(shift,ctx,true,0), alerts);
});
test("overlaps, duplicate records and insufficient rest keep the condition unknown", () => {
  const duplicate = cycle(2); duplicate.push(duplicate[1]);
  const short = cycle(2); short.at(-1)!.startAt = new Date(Date.parse(short.at(-2)!.endAt!) + 8*3600000).toISOString();
  for (const rows of [duplicate,short]) assert.equal(getAvailabilityContext(rows).ampliacion15h,"desconocida");
});
test("canonical timestamp preserves elapsed hours across DST and midnight; edit moves deadlines", () => {
  const ctx = getAvailabilityContext(cycle(0));
  const startAt = "2026-10-24T22:00:00+02:00";
  const alerts = planAvailabilityAlarms({...shift,startAt},ctx,true,0);
  assert.equal(Date.parse(alerts[0].fecha)-Date.parse(startAt),775*60000);
  const edited = planAvailabilityAlarms({...shift,startAt:"2026-10-24T23:00:00+02:00"},ctx,true,0);
  assert.equal(Date.parse(edited[0].fecha)-Date.parse(alerts[0].fecha),3600000);
  assert.equal(edited[0].id,alerts[0].id);
});
