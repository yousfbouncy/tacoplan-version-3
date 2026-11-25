import test from "node:test";
import assert from "node:assert/strict";
import {
  automaticCompensationCapacityMin,
  weeklyReductionDebtMin,
  allocateWholeCompensations,
  isWithinAlertWindow56Days,
  isCompensationInTime,
  isActiveCompensationDeadline,
  checkWeeklyRestSequence,
} from "../lib/weekly-compensation";

test("un semanal de 30 h genera 15 h; no 14 h", () => {
  assert.equal(weeklyReductionDebtMin(30 * 60), 15 * 60);
});
test("los reducidos de 24 h y 44 h 59 min generan deuda distinta", () => {
  assert.equal(weeklyReductionDebtMin(24 * 60), 21 * 60);
  assert.equal(weeklyReductionDebtMin(44 * 60 + 59), 1);
  assert.equal(weeklyReductionDebtMin(45 * 60), 0);
});
test("un reducido de 30 h no recupera automáticamente deudas antiguas", () => {
  assert.equal(automaticCompensationCapacityMin(30 * 60), 0);
});
test("un semanal de 45 h no recupera 15 h: hacen falta 60 h", () => {
  assert.equal(automaticCompensationCapacityMin(45 * 60), 0);
  assert.equal(automaticCompensationCapacityMin(60 * 60), 15 * 60);
});
test("se conserva el descanso diario mínimo antes de compensar", () => {
  assert.equal(automaticCompensationCapacityMin(9 * 60), 0);
  assert.equal(automaticCompensationCapacityMin(11 * 60), 0);
  assert.equal(automaticCompensationCapacityMin(12 * 60), 60);
});
test("nunca compensa parcialmente ni reutiliza los mismos minutos", () => {
  const debts = [
    { id: "first", min: 15 * 60 },
    { id: "second", min: 10 * 60 },
  ];
  assert.deepEqual(allocateWholeCompensations(debts, 15 * 60), ["first"]);
  assert.deepEqual(allocateWholeCompensations(debts, 25 * 60), ["first", "second"]);
  assert.deepEqual(allocateWholeCompensations(debts, 14 * 60), []);
  assert.deepEqual(allocateWholeCompensations(debts, 0), []);
});

test("un bloque diario de 20h con 11h base compensa 9h", () => {
  assert.equal(automaticCompensationCapacityMin(20 * 60, { kind:"daily", dailyBaseMin:660 }), 9 * 60);
});
test("un bloque diario de 24h expresamente diario puede recuperar 13h; el semanal reducido no", () => {
  assert.equal(automaticCompensationCapacityMin(24 * 60, { kind:"daily", dailyBaseMin:660 }), 13 * 60);
  assert.equal(automaticCompensationCapacityMin(24 * 60, { kind:"weekly_reduced" }), 0);
});
test("se admite base diaria reducida de 9h sólo cuando se facilita expresamente", () => {
  assert.equal(automaticCompensationCapacityMin(20 * 60, { kind:"daily", dailyBaseMin:540 }), 11 * 60);
});
test("la cola FIFO no salta la deuda que vence primero", () => {
  const debts = [{id:"old",min:900},{id:"new",min:300}];
  assert.deepEqual(allocateWholeCompensations(debts,600), []);
});
test("una compensación automática no paga deudas fuera de plazo", () => {
  assert.equal(isCompensationInTime("2026-11-19T09:00:00Z","2026-11-19"),true);
  assert.equal(isCompensationInTime("2026-11-20T00:00:00Z","2026-11-19"),false);
});
test("56 días limitan alertas, no eliminan obligaciones", () => {
  const now=new Date("2026-11-19T10:00:00Z");
  assert.equal(isWithinAlertWindow56Days("2026-09-24T12:00:00Z",now),true);
  assert.equal(isWithinAlertWindow56Days("2026-09-23T12:00:00Z",now),false);
  assert.equal(isWithinAlertWindow56Days("2026-02-15T12:00:00Z",now),false);
});

test("alerta de 144 horas y de dos semanales reducidos consecutivos", () => {
  const alerts = checkWeeklyRestSequence([
    {startAt:"2026-11-02T08:00:00Z",endAt:"2026-11-03T14:00:00Z",durationMin:1800},
    {startAt:"2026-11-10T00:00:00Z",endAt:"2026-11-11T06:00:00Z",durationMin:1800},
  ]);
  assert.equal(alerts.some(a=>a.code==="WEEKLY_REST_144H"),true);
  assert.equal(alerts.some(a=>a.code==="CONSECUTIVE_REDUCED_WEEKLY_RESTS"),true);
});


test("el total pendiente solo considera plazos vigentes, incluido el día límite", () => {
  const today = "2026-11-19";
  const rows = [
    { id: "vencida", fechaLimite: "2026-11-01", minutos: 900 },
    { id: "vence-hoy", fechaLimite: "2026-11-19", minutos: 360 },
    { id: "futura", fechaLimite: "2026-12-01", minutos: 480 },
  ];
  const vigentes = rows.filter(r => isActiveCompensationDeadline(r.fechaLimite, today));
  assert.deepEqual(vigentes.map(r => r.id), ["vence-hoy", "futura"]);
  assert.equal(vigentes.reduce((sum, r) => sum + r.minutos, 0), 840);
  assert.equal(isActiveCompensationDeadline("", today), false);
  assert.equal(isActiveCompensationDeadline("2026-11-18", today), false);
});

test("un descanso semanal normal elimina la advertencia actual de dos semanales reducidos anteriores", () => {
  const alerts = checkWeeklyRestSequence([
    {startAt:"2026-11-07T18:36:00Z",endAt:"2026-11-09T09:39:00Z",durationMin:2343},
    {startAt:"2026-11-14T12:29:00Z",endAt:"2026-11-15T18:40:00Z",durationMin:1811},
    {startAt:"2026-11-21T05:14:00Z",endAt:"2026-11-23T13:23:00Z",durationMin:3369},
  ]);
  assert.equal(alerts.some(a=>a.code==="CONSECUTIVE_REDUCED_WEEKLY_RESTS"),false);
});
