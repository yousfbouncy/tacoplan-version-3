import test from "node:test";
import assert from "node:assert/strict";
import { updateDrivingDetection, START_SPEED_MPS, STOP_SPEED_MPS } from "../lib/autostart/driving-activity-engine";

const fix = (s:number,kph:number,accuracy=5) => ({
  timestamp: Date.parse("2026-11-19T12:00:00.000Z")+s*1000,
  coords:{speed:kph/3.6,accuracy}
});
const init = {movingSince:null,lastFix:0};
test("stop immediately with the first accurate GPS fix below 6 km/h",()=>{
  let r=updateDrivingDetection(init,fix(0,20));
  r=updateDrivingDetection(r.state,fix(61,20));
  assert.equal(r.transition,"DRIVING");
  const stopped=updateDrivingDetection(r.state,fix(62,5.9));
  assert.equal(stopped.transition,"REST");
  assert.equal(stopped.state.movingSince,null);
});
test("6–15 km/h neither stops nor starts; exact thresholds respected",()=>{
  const r=updateDrivingDetection(init,fix(0,6));
  assert.equal(r.transition,null);
  assert.equal(STOP_SPEED_MPS,6/3.6);
  assert.equal(START_SPEED_MPS,15/3.6);
  let moving=updateDrivingDetection(r.state,fix(2,15));
  assert.equal(moving.transition,null);
  moving=updateDrivingDetection(moving.state,fix(62,15));
  assert.equal(moving.transition,"DRIVING");
});
test("restart after a stop still requires 60 seconds above 15 km/h",()=>{
  let r=updateDrivingDetection(init,fix(0,30));
  r=updateDrivingDetection(r.state,fix(60,30));
  r=updateDrivingDetection(r.state,fix(61,0));
  assert.equal(r.transition,"REST");
  r=updateDrivingDetection(r.state,fix(62,20));
  assert.equal(r.transition,null);
  r=updateDrivingDetection(r.state,fix(121,20));
  assert.equal(r.transition,null);
  r=updateDrivingDetection(r.state,fix(122,20));
  assert.equal(r.transition,"DRIVING");
  assert.equal(r.movementStart,fix(62,20).timestamp);
});
test("GPS measurements with poor accuracy cannot trigger false stops",()=>{
  let r=updateDrivingDetection(init,fix(0,20));
  r=updateDrivingDetection(r.state,fix(60,0,120));
  assert.equal(r.transition,null);
  r=updateDrivingDetection(r.state,fix(61,-1));
  assert.equal(r.transition,null);
});
test("one-minute movement is never inferred across gaps >90 seconds",()=>{
  let r=updateDrivingDetection(init,fix(0,25));
  r=updateDrivingDetection(r.state,fix(100,25));
  assert.equal(r.transition,null);
  r=updateDrivingDetection(r.state,fix(160,25));
  assert.equal(r.transition,"DRIVING");
});
test("out-of-order or duplicate fixes never change activity",()=>{
  const r=updateDrivingDetection(init,fix(10,20));
  assert.equal(updateDrivingDetection(r.state,fix(10,0)).transition,null);
  assert.equal(updateDrivingDetection(r.state,fix(9,0)).transition,null);
});
