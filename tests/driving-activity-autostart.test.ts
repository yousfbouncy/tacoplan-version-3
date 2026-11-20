import test from "node:test";
import assert from "node:assert/strict";
import {
  updateDrivingDetection, START_SPEED_MPS, STOP_SPEED_MPS,
  STOP_CONFIRM_MS,
} from "../lib/autostart/driving-activity-engine";

const epoch = Date.parse("2026-11-19T12:00:00.000Z");
const fix = (s:number,kph:number,accuracy=5) => ({
  timestamp: epoch+s*1000,
  coords:{speed:kph/3.6,accuracy}
});
const init = {movingSince:null,stoppedSince:null,lastFix:0};

test("stationary 20 s subtracts the full gap without ending DRIVING",()=>{
  let r=updateDrivingDetection(init,fix(0,20));
  r=updateDrivingDetection(r.state,fix(61,20));
  assert.equal(r.transition,"DRIVING");
  r=updateDrivingDetection(r.state,fix(62,0.4));
  assert.equal(r.transition,null);
  r=updateDrivingDetection(r.state,fix(82,1.1));
  assert.equal(r.transition,"RESUME");
  assert.equal(r.stopStart,fix(62,0.4).timestamp);
  assert.equal(r.state.stoppedSince,null);
});

test("60 s below 1 km/h confirms STOP, backdated to first fix",()=>{
  let r=updateDrivingDetection(init,fix(0,20));
  r=updateDrivingDetection(r.state,fix(60,20));
  r=updateDrivingDetection(r.state,fix(61,0.5));
  r=updateDrivingDetection(r.state,fix(120,0));
  assert.equal(r.transition,null);
  r=updateDrivingDetection(r.state,fix(121,0));
  assert.equal(r.transition,"STOP");
  assert.equal(r.stopStart,fix(61,0.5).timestamp);
});

test("a first moving fix after 60 seconds confirms a stop without fabricating REST",()=>{
  let r=updateDrivingDetection(init,fix(0,0));
  r=updateDrivingDetection(r.state,fix(70,2));
  assert.equal(r.transition,"STOP");
  assert.equal(r.stopStart,epoch);
});

test("speed exactly 1 km/h ends a pending short stop",()=>{
  let r=updateDrivingDetection(init,fix(0,0));
  r=updateDrivingDetection(r.state,fix(20,1));
  assert.equal(r.transition,"RESUME");
  assert.equal(STOP_SPEED_MPS,1/3.6);
  assert.equal(STOP_CONFIRM_MS,60_000);
  assert.equal(START_SPEED_MPS,6/3.6);
});

test("stopping briefly never requires new 15 km/h detection",()=>{
  let r=updateDrivingDetection(init,fix(0,30));
  r=updateDrivingDetection(r.state,fix(60,30));
  r=updateDrivingDetection(r.state,fix(61,0));
  r=updateDrivingDetection(r.state,fix(71,2));
  assert.equal(r.transition,"RESUME");
});

test("after a confirmed STOP a new drive requires 60 s of reliable movement reaching 6 km/h",()=>{
  let r=updateDrivingDetection(init,fix(0,30));
  r=updateDrivingDetection(r.state,fix(60,30));
  r=updateDrivingDetection(r.state,fix(61,0));
  r=updateDrivingDetection(r.state,fix(121,0));
  assert.equal(r.transition,"STOP");
  r=updateDrivingDetection(r.state,fix(122,20));
  assert.equal(r.transition,"STOP");
  r=updateDrivingDetection(r.state,fix(123,20));
  assert.equal(r.transition,null);
  r=updateDrivingDetection(r.state,fix(183,20));
  assert.equal(r.transition,"DRIVING");
  assert.equal(r.movementStart,fix(122,20).timestamp);
});

test("poor GPS and gaps cannot falsely confirm a stop",()=>{
  let r=updateDrivingDetection(init,fix(0,0));
  r=updateDrivingDetection(r.state,fix(60,0,120));
  assert.equal(r.transition,null);
  r=updateDrivingDetection(r.state,fix(61,-1));
  assert.equal(r.transition,null);
  r=updateDrivingDetection(r.state,fix(120,0));
  assert.equal(r.transition,null);
  r=updateDrivingDetection(r.state,fix(211,0));
  assert.equal(r.transition,null);
});

test("out-of-order and duplicate fixes are ignored",()=>{
  const r=updateDrivingDetection(init,fix(10,20));
  assert.equal(updateDrivingDetection(r.state,fix(10,0)).transition,null);
  assert.equal(updateDrivingDetection(r.state,fix(9,0)).transition,null);
});

test("slow departure 2 km/h then 6 km/h keeps the earliest moving fix",()=>{
 let r=updateDrivingDetection(init,fix(0,0));
 r=updateDrivingDetection(r.state,fix(10,2));
 assert.equal(r.transition,null);
 r=updateDrivingDetection(r.state,fix(25,4));
 assert.equal(r.transition,null);
 r=updateDrivingDetection(r.state,fix(40,6.1));
 assert.equal(r.transition,null);
 r=updateDrivingDetection(r.state,fix(70,6.1));
 assert.equal(r.transition,"DRIVING");
 assert.equal(r.movementStart,fix(10,2).timestamp);
});
test("below 6 km/h forever does not authorize a new DRIVING segment",()=>{
 let r=updateDrivingDetection(init,fix(0,2));
 r=updateDrivingDetection(r.state,fix(90,4));
 assert.equal(r.transition,null);
 // A fresh reliable 6 km/h sample starts the confirmation against itself
 // after a gap, never backdates through unobserved GPS intervals.
 r=updateDrivingDetection(r.state,fix(91,6));
 assert.equal(r.transition,null);
 r=updateDrivingDetection(r.state,fix(151,6));
 assert.equal(r.transition,"DRIVING");
 assert.equal(r.movementStart,fix(90,4).timestamp);
});
test("short stop and resume at 1 km/h remain unchanged",()=>{
 let r=updateDrivingDetection(init,fix(0,10));
 r=updateDrivingDetection(r.state,fix(60,10));
 assert.equal(r.transition,"DRIVING");
 r=updateDrivingDetection(r.state,fix(61,0));
 r=updateDrivingDetection(r.state,fix(81,1.1));
 assert.equal(r.transition,"RESUME");
 assert.equal(r.stopStart,fix(61,0).timestamp);
});
