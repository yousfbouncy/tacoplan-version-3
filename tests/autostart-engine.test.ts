import test from "node:test";
import assert from "node:assert/strict";
import { advanceCandidate, shouldAutoConfirm, type Candidate, type MovementSegment } from "../lib/autostart/engine";

function moving(timestamp: number) {
  return { timestamp, coords: { speed: 3 / 3.6, accuracy: 5 } };
}
function stopped(timestamp: number) {
  return { timestamp, coords: { speed: 0, accuracy: 5 } };
}

test("un tramo de movimiento termina y conserva su hora inicial", () => {
  let candidate: Candidate = null;
  candidate = advanceCandidate(candidate, moving(1_000)).candidate;
  candidate = advanceCandidate(candidate, moving(3_000)).candidate;
  const result = advanceCandidate(candidate, stopped(61_000));
  assert.deepEqual(result.segment, { startedAt: 1_000, durationMs: 60_000 });
  assert.equal(result.candidate, null);
});

test("confirma con tres tramos en veinte minutos y uno de al menos sesenta segundos", () => {
  const segments: MovementSegment[] = [
    { startedAt: 1_000, durationMs: 60_000 },
    { startedAt: 5 * 60_000, durationMs: 10_000 },
    { startedAt: 10 * 60_000, durationMs: 10_000 },
  ];
  assert.equal(shouldAutoConfirm(segments, 11 * 60_000), true);
});

test("no confirma con menos de tres tramos, sin tramo largo o fuera de ventana", () => {
  const two: MovementSegment[] = [
    { startedAt: 1_000, durationMs: 60_000 },
    { startedAt: 5 * 60_000, durationMs: 10_000 },
  ];
  const noLong: MovementSegment[] = [
    { startedAt: 1_000, durationMs: 30_000 },
    { startedAt: 5 * 60_000, durationMs: 10_000 },
    { startedAt: 10 * 60_000, durationMs: 10_000 },
  ];
  const outside: MovementSegment[] = [
    { startedAt: 1_000, durationMs: 60_000 },
    { startedAt: 5 * 60_000, durationMs: 10_000 },
    { startedAt: 21 * 60_000, durationMs: 10_000 },
  ];
  assert.equal(shouldAutoConfirm(two, 11 * 60_000), false);
  assert.equal(shouldAutoConfirm(noLong, 11 * 60_000), false);
  assert.equal(shouldAutoConfirm(outside, 22 * 60_000), false);
});
