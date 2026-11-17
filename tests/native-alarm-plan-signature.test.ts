import test from "node:test";
import assert from "node:assert/strict";
import {nativeAlarmPlanSignature} from "../lib/native-alarm-plan-signature";

const a={id:"shift-7-30",fecha:"2026-11-17T13:30:00Z",limite:13,mensaje:"30 min"};
test("same alarm plan is stable across repeated dashboard syncs",()=>{
  assert.equal(nativeAlarmPlanSignature([a]),nativeAlarmPlanSignature([{...a}]));
  assert.equal(nativeAlarmPlanSignature([]),nativeAlarmPlanSignature([]));
});
test("new deadline or changed message forces rescheduling",()=>{
  assert.notEqual(nativeAlarmPlanSignature([a]),nativeAlarmPlanSignature([{...a,fecha:"2026-11-17T13:40:00Z"}]));
  assert.notEqual(nativeAlarmPlanSignature([a]),nativeAlarmPlanSignature([{...a,mensaje:"10 min"}]));
  assert.notEqual(nativeAlarmPlanSignature([a]),nativeAlarmPlanSignature([]));
});
