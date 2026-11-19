import test from "node:test";
import assert from "node:assert/strict";
import {
  createLargeSafeStorage,
  splitUtf8Chunks,
  utf8Bytes,
} from "../lib/large-safe-storage-engine";
import type { StorageAdapter } from "../lib/large-safe-storage-engine";

function memory() {
  const data = new Map<string, string>();
  let throwOnChunk = false;
  const adapter: StorageAdapter = {
    getItem: async key => data.get(key) ?? null,
    setItem: async (key, value) => { data.set(key, value); },
    removeItem: async key => { data.delete(key); },
    multiGet: async keys => keys.map(key => [key, data.get(key) ?? null] as const),
    multiSet: async entries => {
      if (throwOnChunk) {
        throwOnChunk = false;
        throw new Error("Simulated native write failure");
      }
      for (const [key, value] of entries) data.set(key, value);
    },
    multiRemove: async keys => { keys.forEach(key => data.delete(key)); },
  };
  return { data, adapter, failNextChunkWrite: () => { throwOnChunk = true; } };
}

test("all 900-byte chunks preserve Unicode and do not split surrogate pairs", () => {
  const sample = "🚛España — 毎日 ".repeat(1000);
  const parts = splitUtf8Chunks(sample);
  assert.equal(parts.join(""), sample);
  assert.equal(parts.every(part => utf8Bytes(part) <= 900), true);
});

test("old unchunked journals are readable without migrating or losing records", async () => {
  const m = memory();
  m.data.set("jornadas", JSON.stringify([{ id: "legacy", syncStatus: "pending" }]));
  const storage = createLargeSafeStorage(m.adapter, true);
  assert.deepEqual(JSON.parse((await storage.read("jornadas"))!), [{ id: "legacy", syncStatus: "pending" }]);
});

test("writes thousands of characters using only inline-size native values", async () => {
  const m = memory();
  const storage = createLargeSafeStorage(m.adapter, true);
  const value = JSON.stringify(Array.from({ length: 900 }, (_, i) => ({ id: `shift-${i}`, note: "España" })));
  await storage.write("jornadas", value);
  assert.equal(await storage.read("jornadas"), value);
  assert.equal([...m.data.values()].every(item => utf8Bytes(item) <= 900), true);
});

test("if a chunk write fails old data stays intact", async () => {
  const m = memory();
  const storage = createLargeSafeStorage(m.adapter, true);
  const first = JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ id: i })));
  const next = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ id: i, changed: true })));
  await storage.write("jornadas", first);
  m.failNextChunkWrite();
  await assert.rejects(storage.write("jornadas", next), /Simulated/);
  assert.equal(await storage.read("jornadas"), first);
  await storage.write("jornadas", next);
  assert.equal(await storage.read("jornadas"), next);
});

test("legacy big value is preserved when its first migration fails", async () => {
  const m = memory();
  const storage = createLargeSafeStorage(m.adapter, true);
  const original = "legacy".repeat(1000);
  m.data.set("jornadas", original);
  m.failNextChunkWrite();
  await assert.rejects(storage.write("jornadas", "new".repeat(1000)));
  assert.equal(await storage.read("jornadas"), original);
});

test("a corrupted chunk is an error, never an empty history", async () => {
  const m = memory();
  const storage = createLargeSafeStorage(m.adapter, true);
  await storage.write("jornadas", "a".repeat(2000));
  const lost = [...m.data.keys()].find(k => k.includes("tacoplan-chunk"));
  assert.ok(lost);
  m.data.delete(lost);
  await assert.rejects(storage.read("jornadas"), /incomplete local storage/);
});

test("one key is serialized and the previous version chunks are reclaimed", async () => {
  const m = memory();
  const storage = createLargeSafeStorage(m.adapter, true);
  await Promise.all([
    storage.write("jornadas", "a".repeat(4000)),
    storage.write("jornadas", "b".repeat(4000)),
  ]);
  assert.equal(await storage.read("jornadas"), "b".repeat(4000));
  assert.equal([...m.data.keys()].filter(k => k.includes("tacoplan-chunk")).length, 5);
});
