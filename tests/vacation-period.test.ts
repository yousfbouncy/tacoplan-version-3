import test from "node:test";
import assert from "node:assert/strict";
import { validVacationDate, validateVacationPeriod, isVacationDay } from "../lib/vacation-period";
test("rejects impossible dates and inverted windows", () => {
  assert.equal(validVacationDate("2026-02-30"), false);
  assert.equal(validVacationDate("2028-02-29"), true);
  assert.notEqual(validateVacationPeriod("2026-11-20", "2026-11-19"), null);
});
test("vacation is inclusive; reminders resume the next day", () => {
  const period={startDate:"2026-11-20",endDate:"2026-11-27"};
  assert.equal(isVacationDay(period,"2026-11-19"),false);
  assert.equal(isVacationDay(period,"2026-11-20"),true);
  assert.equal(isVacationDay(period,"2026-11-27"),true);
  assert.equal(isVacationDay(period,"2026-11-28"),false);
});
