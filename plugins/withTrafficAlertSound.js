/** Reconstructs the user's supplied chime and produces native WAV sounds
 * with exactly three repetitions for traffic and five for availability.
 * Base64/zlib stores a mono 8kHz 4-bit µ-law-quantized copy of the uploaded
 * 1.05s chime. No external services or ffmpeg required at build time.
 * On-device playback uses native notification sounds; no JS timers.
 */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const SAMPLE_RATE = 8000;
const CHIME = "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";
function decode() {
  const bytes = zlib.inflateSync(Buffer.from(CHIME, "base64"));
  const pcm = Buffer.alloc(bytes.length * 4);
  let index = 0;
  for (const byte of bytes) {
    for (const nibble of [byte >> 4, byte & 15]) {
      const y = nibble / 7.5 - 1;
      const value = Math.sign(y) * Math.expm1(Math.abs(y) * Math.log1p(255)) / 255;
      pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value * 32767))), index);
      index += 2;
    }
  }
  return pcm;
}
function writeWav(file, repetitions) {
  const sample = decode();
  const silence = Buffer.alloc(Math.round(0.14 * SAMPLE_RATE) * 2);
  const parts = [];
  for (let i = 0; i < repetitions; i++) {
    if (i) parts.push(silence);
    parts.push(sample);
  }
  const pcm = Buffer.concat(parts);
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  const destination = path.join(__dirname, "..", "assets", "sounds", file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (!fs.existsSync(destination) || !fs.readFileSync(destination).equals(wav)) fs.writeFileSync(destination, wav);
}
writeWav("tacoplan_viaje_3.wav", 3);
writeWav("tacoplan_disponibilidad_5.wav", 5);
module.exports = (config) => config;
