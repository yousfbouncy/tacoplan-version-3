import test from "node:test";
import assert from "node:assert/strict";
import { nightWindowMinutes, nightWorkForShift, monthlyNightAmount, nightPayrollSummary } from "../lib/night-work";

const start="2026-11-20T21:00:00.000Z"; // 22:00 Madrid in winter
const end="2026-11-21T05:00:00.000Z"; // 06:00 Madrid
const shift={id:"s1",fechaInicio:"2026-11-20",startAt:start,endAt:end};

test("night hours 22:00–06:00 use configured local timezone",()=>{
  assert.equal(nightWindowMinutes(start,end,"Europe/Madrid"),480);
  assert.equal(nightWindowMinutes("2026-11-20T19:00:00.000Z","2026-11-20T21:00:00.000Z","Europe/Madrid"),0);
});
test("tracked activities exclude rest and do not double-count overlaps",()=>{
  const d=nightWorkForShift(shift,[
    {type:"DRIVING",startedAt:start,endedAt:"2026-11-20T23:00:00.000Z"},
    {type:"REST",startedAt:"2026-11-20T23:00:00.000Z",endedAt:"2026-11-21T00:00:00.000Z"},
    {type:"WORK",startedAt:"2026-11-21T00:00:00.000Z",endedAt:"2026-11-21T02:00:00.000Z"},
    {type:"AVAILABLE",startedAt:"2026-11-21T01:00:00.000Z",endedAt:"2026-11-21T02:00:00.000Z"},
  ],"Europe/Madrid");
  assert.equal(d.minutes,240);
  assert.equal(d.estimated,false);
});
test("bare shift interval cannot claim verified night work",()=>{
  const d=nightWorkForShift(shift,[],"Europe/Madrid");
  assert.equal(d.minutes,0);
  assert.equal(d.potentialMinutes,480);
  assert.equal(d.estimated,true);
});
test("León nocturnity is monthly 7 percent, never multiplied by shift count",()=>{
  const config={night_enabled:true,night_rate_pct:"7",fixed_unit:"day" as const,salario_base_bruto:"39.31"};
  assert.equal(monthlyNightAmount(config),82.55);
  const details={s1:{minutes:240,potentialMinutes:480,estimated:false,hasNightWork:true},s2:{minutes:70,potentialMinutes:70,estimated:false,hasNightWork:true}};
  const total=nightPayrollSummary(config,[shift,{...shift,id:"s2"}],details,"2026-11-01","2026-11-30");
  assert.equal(total.total,82.55);
  assert.equal(total.minutes,310);
});
