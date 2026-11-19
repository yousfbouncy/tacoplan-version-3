import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
require(path.join(root, "plugins", "withTrafficAlertSound.js"));

const frameCount = (file: string) => {
  const wav = fs.readFileSync(path.join(root, "assets", "sounds", file));
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt32LE(24), 8000);
  assert.equal(wav.readUInt16LE(22), 1);
  return { wav, frames: wav.readUInt32LE(40) / 2 };
};

test("trip sound contains the uploaded chime exactly three times", () => {
  const {wav, frames} = frameCount("tacoplan_viaje_3.wav");
  const chimeSamples = 8400;
  const gapSamples = 1120;
  assert.equal(frames, chimeSamples * 3 + gapSamples * 2);
  const audio = wav.subarray(44);
  for(let i=1; i<3; i++) {
    const current = audio.subarray((chimeSamples+gapSamples)*i*2,((chimeSamples+gapSamples)*i+chimeSamples)*2);
    assert.deepEqual(current,audio.subarray(0,chimeSamples*2));
  }
});

test("availability sound contains the uploaded chime exactly five times", () => {
  const {wav, frames} = frameCount("tacoplan_disponibilidad_5.wav");
  const chimeSamples = 8400;
  const gapSamples = 1120;
  assert.equal(frames, chimeSamples * 5 + gapSamples * 4);
  const audio = wav.subarray(44);
  for(let i=1; i<5; i++) {
    const current = audio.subarray((chimeSamples+gapSamples)*i*2,((chimeSamples+gapSamples)*i+chimeSamples)*2);
    assert.deepEqual(current,audio.subarray(0,chimeSamples*2));
  }
});
