import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { withTimeout } from "../lib/autostart/runtime";

const mocked = ["expo-task-manager", "expo-notifications", "@react-native-async-storage/async-storage",
  "@/lib/local-storage", "@/lib/user-scope", "@/lib/availability-alarms", "@/lib/jornada-widget-sync",
  "@/lib/query-client", "@/lib/supabase"];
const bundled = build({
  entryPoints: ["lib/autostart/task.ts"], bundle: true, write: false, platform: "node", format: "cjs",
  plugins: [{ name: "native-adapters", setup(b) {
    b.onResolve({ filter: /.*/ }, args => mocked.includes(args.path) ? { path: args.path, namespace: "mock" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: `module.exports = __mocks[${JSON.stringify(args.path)}];` }));
  } }],
});
const epoch = Date.parse("2026-10-27T08:00:00Z");
function fix(seconds: number, speed = 15, accuracy = 5) {
  return { timestamp: epoch + seconds * 1000, coords: { speed: speed / 3.6, accuracy, latitude: 41.5, longitude: 1.9 } };
}
async function harness(options: { cloudFails?: boolean; createFails?: boolean; otherUser?: boolean; open?: boolean; lastEndLocation?: string | null } = {}) {
  let stored = JSON.stringify({ userId: "u1", enabled: true, candidate: null, lastDetectedAt: 0, proposals: [], movementSegments: [], firstMovementAt: null });
  let callback: any;
  let open: any = options.open ? { id: "manual" } : null;
  let creates = 0;
  let failCreate = options.createFails;
  const notifications: any[] = [];
  const invalidations: any[] = [];
  const cloud = { then(resolve: any, reject: any) {
    // State must already be durable before the first cloud request.
    assert.ok(JSON.parse(stored).lastDetectedAt > 0);
    return options.cloudFails ? Promise.reject(new Error("offline")).then(resolve, reject)
      : Promise.resolve({ data: null, error: null }).then(resolve, reject);
  }, from() { return this; }, select() { return this; }, eq() { return this; }, update() { return this; }, maybeSingle() { return this; } };
  const mocks: Record<string, any> = {
    "expo-task-manager": { defineTask(_name: string, handler: any) { callback = handler; } },
    "expo-notifications": { async scheduleNotificationAsync(n: any) { notifications.push(n); return "n"; } },
    "@react-native-async-storage/async-storage": { async getItem(key: string) { return key === "@tacoplan/autostart/v1" ? stored : null; }, async setItem(_key: string, value: string) { stored = value; } },
    "@/lib/user-scope": { async userScopedKey(key: string, user?: string) { return `${key}_${user ?? (options.otherUser ? "u2" : "u1")}`; } },
    "@/lib/local-storage": {
      async getJornadaAbierta() { return open; },
      async getLastLugarFin() { return options.lastEndLocation === undefined ? "Narbonne, Francia" : options.lastEndLocation; },
      async crearJornadaInicio(data: any) { if (failCreate) throw new Error("disk failure"); creates++; open = { id: "shift", ...data }; return open; },
      async getEstadoLegal() { return { availabilityContext: { shiftId: "shift" }, disponibilidadMin: 900 }; },
    },
    "@/lib/query-client": { queryClient: { async invalidateQueries(q: any) { invalidations.push(q); } } },
    "@/lib/availability-alarms": { AVAILABILITY_ALARMS_KEY: "alarms", async syncAvailabilityAlarms() {} },
    "@/lib/jornada-widget-sync": { async syncJornadaWidget() {} },
    "@/lib/supabase": { supabase: cloud },
  };
  const code = (await bundled).outputFiles[0].text;
  const module = { exports: {} };
  new Function("__mocks", "module", "exports", code)(mocks, module, module.exports);
  return {
    deliver: (...locations: any[]) => callback({ data: { locations } }),
    state: () => JSON.parse(stored), creates: () => creates, shift: () => open,
    retryWrites: () => { failCreate = false; }, notifications, invalidations,
  };
}

test("native task starts after 3 continuous minutes, saves first movement and refreshes dashboard", async () => {
  const h = await harness();
  await h.deliver(fix(0), fix(60), fix(120));
  assert.equal(h.creates(), 0);
  await h.deliver(fix(180));
  assert.equal(h.creates(), 1);
  assert.equal(h.shift().horaInicio, new Date(epoch).toTimeString().slice(0, 5));
  assert.equal(h.state().candidate, null);
  assert.ok(h.notifications.some(n => n.content.title.includes("Jornada iniciada")));
  assert.equal(h.invalidations.length, 2);
});

test("AutoStart copies the previous closed jornada end as its start location, never the GPS coordinates", async () => {
  const h = await harness({ lastEndLocation: "Fitou, Francia" });
  await h.deliver(fix(0), fix(60), fix(120), fix(180));
  assert.equal(h.creates(), 1);
  assert.equal(h.shift().lugarInicio, "Fitou, Francia");
});

test("AutoStart still begins if there is no previous jornada end location", async () => {
  const h = await harness({ lastEndLocation: null });
  await h.deliver(fix(0), fix(60), fix(120), fix(180));
  assert.equal(h.creates(), 1);
  assert.equal(h.shift().lugarInicio, "Lugar de inicio pendiente");
});

test("notification for first segment is followed by automatic start after three valid segments", async () => {
  const h = await harness();
  await h.deliver(fix(0), fix(60, 0));
  assert.ok(h.notifications.some(n => n.content.title.includes("Inicio detectado")));
  await h.deliver(fix(100), fix(110, 0), fix(200), fix(210, 0));
  assert.equal(h.creates(), 1);
  assert.equal(h.state().proposals.length, 0);
});

test("offline cloud failure cannot prevent local completion or the success notification", async () => {
  const h = await harness({ cloudFails: true });
  await h.deliver(fix(0), fix(60), fix(120), fix(180));
  assert.equal(h.creates(), 1);
  assert.equal(h.state().lastDetectedAt, epoch + 180000);
  assert.ok(h.notifications.some(n => n.content.title.includes("Jornada iniciada")));
});

test("concurrent native deliveries are serialized and replay cannot duplicate a shift", async () => {
  const h = await harness();
  await Promise.all([h.deliver(fix(0), fix(60)), h.deliver(fix(120), fix(180))]);
  await h.deliver(fix(0), fix(60), fix(120), fix(180));
  assert.equal(h.creates(), 1);
});

test("write failure remains retryable and never reports success", async () => {
  const h = await harness({ createFails: true });
  await h.deliver(fix(0), fix(60), fix(120));
  await assert.rejects(h.deliver(fix(180)), /disk failure/);
  assert.equal(h.state().lastDetectedAt, 0);
  assert.equal(h.notifications.length, 0);
  h.retryWrites();
  await h.deliver(fix(180));
  assert.equal(h.creates(), 1);
});

test("manual open shift and mismatched account prevent automatic creation", async () => {
  for (const options of [{ open: true }, { otherUser: true }]) {
    const h = await harness(options);
    await h.deliver(fix(0), fix(60), fix(120), fix(180));
    assert.equal(h.creates(), 0);
    assert.equal(h.notifications.length, 0);
  }
});

test("poor accuracy, pauses and GPS gaps do not count as continuous movement", async () => {
  const h = await harness();
  await h.deliver(fix(0), fix(60), fix(120, 15, 200), fix(180), fix(400));
  assert.equal(h.creates(), 0);
});

test("optional operation timeout handles a never-resolving service", async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 5), /agotó el tiempo/);
  assert.equal(await withTimeout(Promise.resolve(7), 50), 7);
});


test("walking and movement below 15 km/h never create a proposal or shift", async () => {
  for (const speed of [4, 5, 10, 14.9]) {
    const h = await harness();
    await h.deliver(...[0, 60, 120, 180, 240].map(s => fix(s, speed)));
    assert.equal(h.creates(), 0);
    assert.equal(h.notifications.length, 0);
    assert.equal(h.state().firstMovementAt, null);
  }
});
