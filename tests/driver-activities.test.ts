import test from "node:test";
import assert from "node:assert/strict";
import {changeDriverActivity,closeDriverActivities,getDriverActivityTotals,sanitizeLog} from "../lib/driver-activities";

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
