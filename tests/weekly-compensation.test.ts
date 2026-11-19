import test from "node:test";
import assert from "node:assert/strict";
import {
  automaticCompensationCapacityMin,
  weeklyReductionDebtMin,
  allocateWholeCompensations,
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
  assert.deepEqual(allocateWholeCompensations(debts, 14 * 60), ["second"]);
  assert.deepEqual(allocateWholeCompensations(debts, 0), []);
});
