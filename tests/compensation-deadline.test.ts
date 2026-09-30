import test from "node:test";
import assert from "node:assert/strict";

import { calculateCompensationDeadline } from "../lib/compensation-deadline";

test("la compensación vence al terminar la tercera semana siguiente", () => {
  assert.equal(
    calculateCompensationDeadline({ sourceRestStartAt: "2026-09-02T10:00:00Z" }),
    "2026-09-27",
  );
});

test("el inicio del descanso determina la semana aunque termine el lunes", () => {
  assert.equal(
    calculateCompensationDeadline({
      sourceRestStartAt: "2026-09-06T20:00:00Z",
      sourceRestEndAt: "2026-09-07T20:00:00Z",
    }),
    "2026-09-27",
  );
});
