import test from "node:test";
import assert from "node:assert/strict";
import { getPeriodAuditActions } from "../lib/period-audit-actions";

test("sin incidencias no se muestran herramientas",()=>{
  assert.deepEqual(getPeriodAuditActions([]),{needsReview:false,needsRecalculation:false});
});
test("una jornada automática desactualizada sólo requiere recálculo",()=>{
  assert.deepEqual(getPeriodAuditActions([{id:"journey-rate-a",detail:"Importe diferente"}]),{needsReview:false,needsRecalculation:true});
});
test("un día completo fuera de base faltante se puede recalcular",()=>{
  assert.deepEqual(getPeriodAuditActions([{id:"missing-oob-2026-11-13",detail:"Día completo fuera de base sin registrar."}]),{needsReview:false,needsRecalculation:true});
});
test("llegadas a base exigen revisión manual, no recálculo automático",()=>{
  assert.deepEqual(getPeriodAuditActions([{id:"missing-oob-2026-11-13",detail:"Día de llegada a base pendiente de elegir 100%, 60%, 30% o sin dieta."}]),{needsReview:true,needsRecalculation:false});
});
test("incidencias mixtas activan cada botón de forma independiente",()=>{
  assert.deepEqual(getPeriodAuditActions([{id:"dup-journey-x",detail:"Duplicado"},{id:"journey-rate-y",detail:"Desactualizada"}]),{needsReview:true,needsRecalculation:true});
});
