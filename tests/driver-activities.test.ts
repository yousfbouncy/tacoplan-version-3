import test from "node:test";
import assert from "node:assert/strict";
import {buildActivitySyncRows,changeDriverActivity,closeDriverActivities,getDriverActivityTotals,getDrivingTotalsForClose,sanitizeLog,pauseDriverActivity} from "../lib/driver-activities";

const t=(min:number)=>new Date(Date.parse("2026-11-16T08:00:00.000Z")+min*60000);
test("activity changes are exclusive and repeated taps do not duplicate segments",()=>{
  let log={shiftId:"s",segments:[] as Array<{type:"DRIVING"|"REST"|"AVAILABLE"|"WORK";startedAt:string;endedAt:string|null}>};
  log=changeDriverActivity(log,"DRIVING",t(0));
  assert.equal(changeDriverActivity(log,"DRIVING",t(1)),log);
  log=changeDriverActivity(log,"WORK",t(20));
  assert.equal(log.segments.length,2);
  assert.equal(log.segments[0].endedAt,t(20).toISOString());
  assert.equal(getDriverActivityTotals(log,t(30)).totals.WORK,10*60000);
});
test("45-minute break resets driving; 30-minute break does not",()=>{
 let log={shiftId:"s",segments:[] as Array<{type:"DRIVING"|"REST"|"AVAILABLE"|"WORK";startedAt:string;endedAt:string|null}>};
 log=changeDriverActivity(log,"DRIVING",t(0));
 log=changeDriverActivity(log,"REST",t(90));
 log=changeDriverActivity(log,"DRIVING",t(120));
 assert.equal(getDriverActivityTotals(log,t(140)).continuousDrivingMs,110*60000);
 log=changeDriverActivity(log,"REST",t(140));
 log=changeDriverActivity(log,"DRIVING",t(185));
 assert.equal(getDriverActivityTotals(log,t(195)).continuousDrivingMs,10*60000);
});
test("shift closure stops live accumulation and rejects negative durations",()=>{
 let log={shiftId:"s",segments:[] as Array<{type:"DRIVING"|"REST"|"AVAILABLE"|"WORK";startedAt:string;endedAt:string|null}>};
 log=changeDriverActivity(log,"AVAILABLE",t(0));
 assert.equal(changeDriverActivity(log,"REST",t(-1)),log);
 log=closeDriverActivities(log,t(40));
 assert.equal(getDriverActivityTotals(log,t(100)).totals.AVAILABLE,40*60000);
});
test("malformed activity records are safely discarded",()=>{
 const log=sanitizeLog({segments:[{type:"DRIVING",startedAt:"bad",endedAt:null},{type:"WORK",startedAt:t(1).toISOString(),endedAt:null}]},"s");
 assert.equal(log.segments.length,1);
});

test("cloud sync payload keeps stable segment keys across activity changes and closure",()=>{
 let log={shiftId:"shift-123",segments:[] as Array<{type:"DRIVING"|"REST"|"AVAILABLE"|"WORK";startedAt:string;endedAt:string|null}>};
 log=changeDriverActivity(log,"DRIVING",t(0));
 const open=buildActivitySyncRows("driver-123",log,t(1))[0];
 assert.equal(open.fin,null);
 assert.equal(open.tipo,"CONDUCCION");
 assert.equal(open.duracion_min,0);
 log=changeDriverActivity(log,"AVAILABLE",t(42));
 const updated=buildActivitySyncRows("driver-123",log,t(43));
 assert.equal(updated[0].id,open.id);
 assert.equal(updated[0].duracion_min,42);
 assert.equal(updated[1].tipo,"DISPONIBILIDAD");
 assert.equal(updated[1].fin,null);
 log=changeDriverActivity(log,"WORK",t(50));
 log=changeDriverActivity(log,"REST",t(60));
 const closed=closeDriverActivities(log,t(105));
 const rows=buildActivitySyncRows("driver-123",closed,t(106));
 assert.deepEqual(rows.map(row=>row.tipo),["CONDUCCION","DISPONIBILIDAD","OTROS_TRABAJOS","DESCANSO"]);
 assert.deepEqual(rows.map(row=>row.duracion_min),[42,8,10,45]);
 assert.ok(rows.every(row=>row.fin!==null));
 assert.deepEqual(rows.map(row=>row.id),[
  "manual:driver-123:shift-123:0","manual:driver-123:shift-123:1",
  "manual:driver-123:shift-123:2","manual:driver-123:shift-123:3"
 ]);
});

test("automatic driving pause closes only driving, without inventing a break",()=>{
  let log={shiftId:"s",segments:[] as Array<{type:"DRIVING"|"REST"|"AVAILABLE"|"WORK";startedAt:string;endedAt:string|null}>};
  log=changeDriverActivity(log,"DRIVING",t(0));
  log=pauseDriverActivity(log,t(12));
  assert.equal(log.segments.length,1);
  assert.equal(log.segments[0].endedAt,t(12).toISOString());
  assert.equal(getDriverActivityTotals(log,t(20)).totals.DRIVING,12*60000);
  assert.equal(pauseDriverActivity(log,t(30)),log);
  log=changeDriverActivity(log,"WORK",t(30));
  assert.equal(pauseDriverActivity(log,t(40)),log);
});


test("a 15-minute break followed by 30 minutes resets driving (not a standalone 30-minute break)",()=>{
 let log={shiftId:"split",segments:[] as Array<{type:"DRIVING"|"REST"|"AVAILABLE"|"WORK";startedAt:string;endedAt:string|null}>};
 log=changeDriverActivity(log,"DRIVING",t(0));
 log=changeDriverActivity(log,"REST",t(120));
 log=changeDriverActivity(log,"DRIVING",t(135));
 assert.equal(getDriverActivityTotals(log,t(170)).firstBreak15Completed,true);
 assert.equal(getDriverActivityTotals(log,t(170)).continuousDrivingMs,155*60000);
 log=changeDriverActivity(log,"REST",t(170));
 assert.equal(getDriverActivityTotals(log,t(199)).qualifiedBreak,false);
 assert.equal(getDriverActivityTotals(log,t(200)).qualifiedBreak,true);
 assert.equal(getDriverActivityTotals(log,t(200)).continuousDrivingMs,0);
 log=changeDriverActivity(log,"DRIVING",t(200));
 assert.equal(getDriverActivityTotals(log,t(210)).continuousDrivingMs,10*60000);
});
test("rest button displays current continuous rest separately from all rests in a shift",()=>{
 let log={shiftId:"rest",segments:[] as Array<{type:"DRIVING"|"REST"|"AVAILABLE"|"WORK";startedAt:string;endedAt:string|null}>};
 log=changeDriverActivity(log,"REST",t(0));
 log=changeDriverActivity(log,"WORK",t(12));
 log=changeDriverActivity(log,"REST",t(30));
 const result=getDriverActivityTotals(log,t(38));
 assert.equal(result.totals.REST,20*60000);
 assert.equal(result.currentRestMs,8*60000);
 assert.equal(result.qualifiedBreak,false);
});
test("availability is not a 45-minute driving break",()=>{
 let log={shiftId:"availability",segments:[] as Array<{type:"DRIVING"|"REST"|"AVAILABLE"|"WORK";startedAt:string;endedAt:string|null}>};
 log=changeDriverActivity(log,"DRIVING",t(0));
 log=changeDriverActivity(log,"AVAILABLE",t(240));
 log=changeDriverActivity(log,"DRIVING",t(300));
 assert.equal(getDriverActivityTotals(log,t(330)).continuousDrivingMs,270*60000);
});

test("20 minutes uninterrupted gives only 15 minutes split credit, while history retains all 20",()=>{
  let log={shiftId:"credit",segments:[] as Array<{type:"DRIVING"|"REST"|"AVAILABLE"|"WORK";startedAt:string;endedAt:string|null}>};
  log=changeDriverActivity(log,"DRIVING",t(0));
  log=changeDriverActivity(log,"REST",t(120));
  const state=getDriverActivityTotals(log,t(140));
  assert.equal(state.totals.REST,20*60000);
  assert.equal(state.firstBreakProgressMs,15*60000);
  assert.equal(state.firstBreakReady,true);
  assert.equal(state.secondBreakProgressMs,0);
  assert.equal(state.uninterruptedBreakProgressMs,20*60000);
  assert.equal(state.qualifiedBreak,false);
});

test("interrupted second break starts again at zero but earlier resting minutes remain in history",()=>{
  let log={shiftId:"split-stages",segments:[] as Array<{type:"DRIVING"|"REST"|"AVAILABLE"|"WORK";startedAt:string;endedAt:string|null}>};
  log=changeDriverActivity(log,"DRIVING",t(0));
  log=changeDriverActivity(log,"REST",t(120));
  log=changeDriverActivity(log,"DRIVING",t(136)); // 16-min first break: 15 credited
  log=changeDriverActivity(log,"REST",t(140));
  let state=getDriverActivityTotals(log,t(150));
  assert.equal(state.firstBreakProgressMs,15*60000);
  assert.equal(state.secondBreakProgressMs,10*60000);
  log=changeDriverActivity(log,"WORK",t(160)); // 20 minutes: not a valid second part
  state=getDriverActivityTotals(log,t(160));
  assert.equal(state.secondBreakProgressMs,0);
  assert.equal(state.firstBreak15Completed,true);
  log=changeDriverActivity(log,"REST",t(161));
  state=getDriverActivityTotals(log,t(190));
  assert.equal(state.secondBreakProgressMs,29*60000);
  assert.equal(state.qualifiedBreak,false);
  assert.equal(state.totals.REST,65*60000); // 16+20+29
  state=getDriverActivityTotals(log,t(191));
  assert.equal(state.qualifiedBreak,true);
  assert.equal(state.continuousDrivingMs,0);
  assert.equal(state.totals.REST,66*60000);
});

test("a 50-minute continuous rest is qualifying but all 50 minutes remain counted",()=>{
  let log={shiftId:"long-rest",segments:[] as Array<{type:"DRIVING"|"REST"|"AVAILABLE"|"WORK";startedAt:string;endedAt:string|null}>};
  log=changeDriverActivity(log,"DRIVING",t(0));
  log=changeDriverActivity(log,"REST",t(90));
  const state=getDriverActivityTotals(log,t(140));
  assert.equal(state.qualifiedBreak,true);
  assert.equal(state.uninterruptedBreakProgressMs,45*60000);
  assert.equal(state.totals.REST,50*60000);
});

test("closing uses recorded driving time and can split Sunday/Monday without inventing minutes",()=>{
  let log={shiftId:"closing",segments:[] as Array<{type:"DRIVING"|"REST"|"AVAILABLE"|"WORK";startedAt:string;endedAt:string|null}>};
  log=changeDriverActivity(log,"DRIVING",t(0));
  log=changeDriverActivity(log,"REST",t(70));
  log=changeDriverActivity(log,"DRIVING",t(120));
  const summary=getDrivingTotalsForClose(log,t(142),t(125).getTime());
  assert.equal(summary.totalMin,92);
  assert.equal(summary.firstPartMin,75);
  assert.equal(summary.secondPartMin,17);
  assert.equal(summary.closed.segments[2].endedAt,t(142).toISOString());
  assert.equal(getDriverActivityTotals(summary.closed,t(200)).totals.DRIVING,92*60000);
});

test("rest button resets invalid pauses and credits only a valid 15-minute first stage",()=>{
 let log={shiftId:"display",segments:[] as Array<{type:"DRIVING"|"REST"|"AVAILABLE"|"WORK";startedAt:string;endedAt:string|null}>};
 log=changeDriverActivity(log,"DRIVING",t(0));
 log=changeDriverActivity(log,"REST",t(90));
 assert.equal(getDriverActivityTotals(log,t(104)).restButtonMs,14*60000);
 log=changeDriverActivity(log,"DRIVING",t(104));
 assert.equal(getDriverActivityTotals(log,t(105)).restButtonMs,0);
 log=changeDriverActivity(log,"REST",t(110));
 assert.equal(getDriverActivityTotals(log,t(130)).restButtonMs,20*60000);
 log=changeDriverActivity(log,"DRIVING",t(130));
 let state=getDriverActivityTotals(log,t(140));
 assert.equal(state.restButtonMs,15*60000);
 assert.equal(state.totals.REST,34*60000);
 log=changeDriverActivity(log,"REST",t(140));
 state=getDriverActivityTotals(log,t(141));
 assert.equal(state.restButtonMs,1*60000);
 assert.equal(state.firstBreakProgressMs,15*60000);
 log=changeDriverActivity(log,"DRIVING",t(170));
 state=getDriverActivityTotals(log,t(171));
 assert.equal(state.restButtonMs,0);
 assert.equal(state.continuousDrivingMs,1*60000);
 assert.equal(state.totals.REST,64*60000);
});
