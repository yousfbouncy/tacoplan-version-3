import assert from "node:assert/strict";
import test from "node:test";
import { collectCloudPages } from "../lib/sync-pagination";

test("collectCloudPages descarga todas las páginas, incluida la posterior a 1000 filas", async () => {
  const source = Array.from({ length: 1066 }, (_, id) => ({ id }));
  const ranges: Array<[number, number]> = [];

  const rows = await collectCloudPages(async (from, to) => {
    ranges.push([from, to]);
    return { data: source.slice(from, to + 1), error: null };
  });

  assert.equal(rows.length, 1066);
  assert.deepEqual(rows.at(-1), { id: 1065 });
  assert.deepEqual(ranges, [[0, 999], [1000, 1999]]);
});

test("collectCloudPages pide una página final vacía cuando el total es múltiplo exacto", async () => {
  const source = Array.from({ length: 2000 }, (_, id) => id);
  let calls = 0;

  const rows = await collectCloudPages(async (from, to) => {
    calls += 1;
    return { data: source.slice(from, to + 1), error: null };
  });

  assert.equal(rows.length, 2000);
  assert.equal(calls, 3);
});

test("collectCloudPages no convierte un error parcial en una lista incompleta", async () => {
  const expected = new Error("fallo de red");

  await assert.rejects(
    collectCloudPages(async (from) => (
      from === 0
        ? { data: Array.from({ length: 1000 }, (_, id) => id), error: null }
        : { data: null, error: expected }
    )),
    expected,
  );
});
