import test from "node:test";
import assert from "node:assert/strict";
import { advanceCandidate, advanceAutoStartEvidence } from "../lib/autostart/engine";

const fix = (timestamp: number, kmh: number) => ({ timestamp, coords: { speed: kmh / 3.6, accuracy: 10 } });

test("no confirma antes de 15 segundos ni a 3 km/h exactos", () => {
  let x = advanceCandidate(null, fix(100_000, 3));
  assert.equal(x.detectedAt, undefined);
  x = advanceCandidate(null, fix(100_000, 4));
  assert.equal(advanceCandidate(x.candidate, fix(110_000, 4)).detectedAt, undefined);
  assert.equal(advanceCandidate(x.candidate, fix(115_000, 4)).detectedAt, 100_000);
});

test("autoconfirma tras tres movimientos separados y uno largo; conserva la primera hora", () => {
  let state: ReturnType<typeof advanceAutoStartEvidence>["state"] = null;
  const feed = (t: number, speed: number) => {
    const result = advanceAutoStartEvidence(state, fix(t, speed));
    state = result.state;
    return result;
  };
  feed(100_000, 4);
  assert.equal(feed(115_000, 4).shouldPrompt, true);
  feed(120_000, 0);
  feed(130_000, 4);
  feed(145_000, 4);
  feed(150_000, 0);
  feed(160_000, 4);
  assert.equal(feed(175_000, 4).shouldAutoConfirm, false);
  assert.equal(feed(220_000, 4).shouldAutoConfirm, false); // gap > 30 s: interrumpe
  feed(230_000, 0);
  feed(240_000, 4);
  feed(255_000, 4);
  const result = feed(300_000, 4); // gap >30 s: no es continuidad
  assert.equal(result.shouldAutoConfirm, false);
});
