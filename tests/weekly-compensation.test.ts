import test from "node:test";
import assert from "node:assert/strict";
import {
  automaticCompensationCapacityMin,
  weeklyReductionDebtMin,
  allocateWholeCompensations,
  isWithinAlertWindow56Days,
  isCompensationInTime,
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
