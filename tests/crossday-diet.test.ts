import test from "node:test";
import assert from "node:assert/strict";
import {
  crossDayAutoDietDate,
  crossDayAutoDietPercentage,
  isProvisionalCrossDayDietForNewStart,
  isCrossDayContinuationDiet,
  CROSSDAY_AUTO_DIET_PREFIX,
} from "../lib/crossday-diet";

const closed = {
  id: "journey20",
  fechaInicio: "2026-11-20",
  fechaFin: "2026-11-21",
  startAt: "2026-11-20T18:30:00",
  endAt: "2026-11-21T06:30:00",
  tipoRuta: "INTERNACIONAL",
  plannedRestType: "weekly" as const,
  paymentMode: "dietas" as const,
};

test("international 12-hour journey crossing midnight with weekly rest gets automatic end-day diet", () => {
  assert.equal(crossDayAutoDietDate(closed,[closed]),"2026-11-21");
});

test("daily rest also qualifies, but an ordinary same-day 12-hour journey does not", () => {
  assert.equal(crossDayAutoDietDate({...closed,plannedRestType:"daily"},[closed]),"2026-11-21");
  const sameDay={...closed,fechaInicio:"2026-11-21",startAt:"2026-11-21T06:00:00",endAt:"2026-11-21T18:00:00"};
  assert.equal(crossDayAutoDietDate(sameDay,[sameDay]),null);
});

test("no auto 100% when rest is not selected or route is national or mode is km", () => {
  assert.equal(crossDayAutoDietDate({...closed,plannedRestType:null},[closed]),null);
  assert.equal(crossDayAutoDietDate({...closed,tipoRuta:"NACIONAL"},[closed]),null);
  assert.equal(crossDayAutoDietDate({...closed,paymentMode:"km"},[closed]),null);
});

test("do not create provisional diet if another jornada starts on the closing day", () => {
  const next={id:"next21",fechaInicio:"2026-11-21",startAt:"2026-11-21T16:00:00"};
  assert.equal(crossDayAutoDietDate(closed,[closed,next]),null);
});

test("same-day start revokes only the provisional generated diet, never a manually saved one", () => {
  const start={id:"next21",fechaInicio:"2026-11-21",startAt:"2026-11-21T16:00:00"};
  assert.equal(isProvisionalCrossDayDietForNewStart({id:`${CROSSDAY_AUTO_DIET_PREFIX}2026-11-21_journey20`,date:"2026-11-21",previousJourneyId:"journey20"},start),true);
  assert.equal(isProvisionalCrossDayDietForNewStart({id:"user_confirmed",date:"2026-11-21",previousJourneyId:"journey20"},start),false);
  assert.equal(isProvisionalCrossDayDietForNewStart({id:`${CROSSDAY_AUTO_DIET_PREFIX}2026-11-20_journey19`,date:"2026-11-20",previousJourneyId:"journey19"},start),false);
});

test("return to configured base gets international 60%, outside base remains 100%",()=>{
  assert.equal(crossDayAutoDietPercentage("Abrera, España","Abrera"),60);
  assert.equal(crossDayAutoDietPercentage("Abrera, Spain","Abrera"),60);
  assert.equal(crossDayAutoDietPercentage("Lyon, Francia","Abrera"),100);
  assert.equal(crossDayAutoDietPercentage("Abrera, España",null),100);
});

test("confirmed cross-midnight arrival keeps continuity title even without provisional ID prefix",()=>{
 const previous={
  id:"mwp65qi93j52kiufu",fechaInicio:"2026-11-20",fechaFin:"2026-11-21",
  startAt:"2026-11-20T17:04:00.000",endAt:"2026-11-21T05:14:00.000",
  tipoRuta:"INTERNACIONAL",
 };
 const confirmed={
  id:"mwpz9qf535pmfgk_2026-11-21",date:"2026-11-21",
  previousJourneyId:"mwp65qi93j52kiufu",
 };
 assert.equal(isCrossDayContinuationDiet(confirmed,previous),true);
 assert.equal(isCrossDayContinuationDiet({...confirmed,previousJourneyId:null},previous),false);
 assert.equal(isCrossDayContinuationDiet({...confirmed,date:"2026-11-22"},previous),false);
 assert.equal(isCrossDayContinuationDiet({...confirmed,previousJourneyId:"unrelated"},previous),false);
});
