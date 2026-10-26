import test from "node:test";
import assert from "node:assert/strict";
import { calcularAlarmasDisponibilidad, alarmasPendientes } from "../lib/alertasDisponibilidad";

const base = { id: "turno-1", inicioISO: "2026-10-26T08:00:00+01:00" };

test("con ampliación disponible: 13 horas suave y 15 horas urgente", () => {
  const a = calcularAlarmasDisponibilidad({ ...base, ampliacion15h: "disponible" });
  assert.equal(a.length, 2);
  assert.deepEqual(a.map(x => [x.limiteHoras, x.intensidad, x.sonidoSegundos]), [[13, "suave", 3], [15, "urgente", 5]]);
  assert.equal(a[0].fechaISO, "2026-10-26T19:55:00.000Z");
  assert.equal(a[1].fechaISO, "2026-10-26T21:55:00.000Z");
});

test("sin ampliación: solo alarma urgente de 13 horas", () => {
  const a = calcularAlarmasDisponibilidad({ ...base, ampliacion15h: "agotada" });
  assert.equal(a.length, 1);
  assert.equal(a[0].intensidad, "urgente");
});

test("ampliación desconocida: precaución y nunca afirma infracción", () => {
  const a = calcularAlarmasDisponibilidad({ ...base, ampliacion15h: "desconocida" });
  assert.equal(a.length, 1);
  assert.equal(a[0].intensidad, "precaucion");
  assert.match(a[0].cuerpo, /No se ha confirmado/);
});

test("al finalizar jornada no queda ninguna alarma", () => {
  const a = calcularAlarmasDisponibilidad({ ...base, ampliacion15h: "disponible", finISO: "2026-10-26T19:00:00+01:00" });
  assert.deepEqual(a, []);
});

test("no vuelve a programar alarmas pasadas", () => {
  const a = alarmasPendientes({ ...base, ampliacion15h: "disponible" }, "2026-10-26T21:00:00Z");
  assert.equal(a.length, 1);
  assert.equal(a[0].limiteHoras, 15);
});
