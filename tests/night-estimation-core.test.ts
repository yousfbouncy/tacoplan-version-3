import test from "node:test";
import assert from "node:assert/strict";
import {estimateNightBonus} from "../lib/night-estimation-core";
import type {NightRule,NightPreference} from "../lib/night-estimator";
const rule=(mode:NightRule["calculation_mode"],percent:number|null):NightRule=>({
 id:"test",country_code:"ES",province:"León",title:"Convenio prueba",
 night_from:"22:00",night_to:"06:00",timezone:"Europe/Madrid",
 calculation_mode:mode,percent,fixed_amount:null,reference_monthly_hours:171.167,
 monthly_proration:"none",source_url:"https://example.com",source_article:"art"
});
const auto:NightPreference={estimation_mode:"automatic",manual_unit:null,manual_amount:null,contract_province:null,enabled:true};
const payroll={fixed_unit:"month",salario_base_bruto:"1200"};
const run=(r:NightRule|null,p:NightPreference,minutes=480,nightDays=1,from="2026-11-01",to="2026-11-30")=>
 estimateNightBonus({rule:r,preference:p,payroll,minutes,nightDays,from,to});
test("León 7% monthly counted once even with many night shifts",()=>{
 assert.equal(run(rule("monthly_percent",7),auto,2400,5).total,84);
 assert.equal(run(rule("monthly_percent",7),auto,2400,5,"2026-11-21","2026-12-20").total,84);
});
test("Barcelona 25% proportional to hours of actual night work",()=>{
 const n=run(rule("hourly_percent",25),auto,120,1);
 assert.equal(n.total,Math.round((1200/171.167)*0.25*2*100)/100);
});
test("manual hourly and monthly override automatic rule",()=>{
 assert.equal(run(null,{...auto,estimation_mode:"manual",manual_unit:"hourly",manual_amount:8},150,2).total,20);
 assert.equal(run(null,{...auto,estimation_mode:"manual",manual_unit:"monthly",manual_amount:130},600,2).total,130);
});
test("unknown province cannot invent a legal rate",()=>{
 assert.equal(run(null,auto,240,1).total,null);
 assert.equal(run(null,auto,0,0).total,0);
});
