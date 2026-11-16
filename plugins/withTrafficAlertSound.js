/**
 * Deterministically builds Tacoplan's ORIGINAL "tu-tu-tu-tut" notification tone.
 * Runs before expo-notifications config plugin so EAS/prebuild can bundle WAV.
 * No runtime network/filesystem dependency on a driver's device.
 */
const fs = require("node:fs");
const path = require("node:path");

module.exports = function withTrafficAlertSound(config) {
  const sampleRate = 22050;
  const notes = [
    { frequency: 880, duration: 0.15 },
    { frequency: 880, duration: 0.15 },
    { frequency: 880, duration: 0.15 },
    { frequency: 1175, duration: 0.23 },
  ];
  const silenceSeconds = 0.095;
  const parts = [];
  for (const note of notes) {
    const len = Math.floor(sampleRate * note.duration);
    const samples = Buffer.alloc(len * 2);
    for (let i = 0; i < len; i++) {
      const time = i / sampleRate;
      const edge = Math.min(1, i / (sampleRate * 0.012), (len - 1 - i) / (sampleRate * 0.025));
      const amplitude = 0.38 * Math.max(0, edge);
      const value = Math.round(Math.sin(2 * Math.PI * note.frequency * time) * amplitude * 32767);
      samples.writeInt16LE(value, i * 2);
    }
    parts.push(samples, Buffer.alloc(Math.floor(sampleRate * silenceSeconds) * 2));
  }
  const pcm = Buffer.concat(parts);
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  const destination = path.join(__dirname, "..", "assets", "sounds", "tacoplan_viaje.wav");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (!fs.existsSync(destination) || !fs.readFileSync(destination).equals(wav)) fs.writeFileSync(destination, wav);
  return config;
};
