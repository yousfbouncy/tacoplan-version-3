import test from "node:test";
import assert from "node:assert/strict";
import { legalPeriodStartAt, overlappingShiftPairs } from "../lib/shift-periods";

const at = (d:string,h:string) => `${d}T${h}:00.000`;

test("a driver can close at 12:00 and resume at 14:00 without resetting legal start", () => {
  const shifts = [
    {id:"morning",startAt:at("2026-11-20","07:00"),endAt:at("2026-11-20","12:00")},
    {id:"afternoon",startAt:at("2026-11-20","14:00"),endAt:at("2026-11-20","18:00")},
    {id:"evening",startAt:at("2026-11-20","19:00"),endAt:null},
  ];
  assert.equal(legalPeriodStartAt(shifts,"afternoon"),at("2026-11-20","07:00"));
  assert.equal(legalPeriodStartAt(shifts,"evening"),at("2026-11-20","07:00"));
  assert.deepEqual(overlappingShiftPairs(shifts, Date.parse(at("2026-11-20","20:00"))),[]);
});

test("a 9-hour gap is a candidate reset, without deciding whether a reduced rest was permitted", () => {
  const shifts = [
    {id:"one",startAt:at("2026-11-20","07:00"),endAt:at("2026-11-20","12:00")},
    {id:"two",startAt:at("2026-11-20","21:00"),endAt:null},
  ];
  assert.equal(legalPeriodStartAt(shifts,"two"),at("2026-11-20","21:00"));
});

test("an overlapping old shift is flagged and cannot reset the legal clock", () => {
  const shifts = [
    {id:"full",startAt:at("2026-11-20","06:00"),endAt:at("2026-11-20","17:54")},
    {id:"segment1",startAt:at("2026-11-20","07:00"),endAt:at("2026-11-20","12:11")},
    {id:"segment2",startAt:at("2026-11-20","12:12"),endAt:at("2026-11-20","17:54")},
  ];
  const pairs=overlappingShiftPairs(shifts,Date.parse(at("2026-11-21","03:00")));
  assert.deepEqual(pairs,[["full","segment1"],["full","segment2"]]);
  assert.equal(legalPeriodStartAt(shifts,"segment2"),at("2026-11-20","06:00"));
});

test("separate non-overlapping shifts on the same date are not duplicate alerts", () => {
  const shifts=[
    {id:"one",startAt:at("2026-11-20","07:00"),endAt:at("2026-11-20","09:00")},
    {id:"two",startAt:at("2026-11-20","09:00"),endAt:at("2026-11-20","11:00")},
  ];
  assert.equal(overlappingShiftPairs(shifts,Date.parse(at("2026-11-20","12:00"))).length,0);
});
