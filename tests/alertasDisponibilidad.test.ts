import test from "node:test";
import assert from "node:assert/strict";
import { crearAvisosAmplitud } from "../lib/alertasDisponibilidad";

const turno = { id: "abc", inicio: "2026-10-26T08:00:00+01:00" };
const inicio = Date.parse(turno.inicio);
const minutosDesdeInicio = (fecha: string) => (Date.parse(fecha) - inicio) / 60000;

test("ampliación disponible: 13h a 10 minutos y 15h a 30 minutos", () => {
  const avisos = crearAvisosAmplitud({ ...turno, ampliacion15h: "disponible" }, 0);
  assert.deepEqual(avisos.map(a => [a.limite, a.minutosAntes, a.nivel]),
    [[13, 10, "suave"], [15, 30, "urgente"]]);
  assert.deepEqual(avisos.map(a => minutosDesdeInicio(a.fecha)), [770, 870]);
  assert.deepEqual(avisos.map(a => a.id), ["amplitud:abc:13:10", "amplitud:abc:15:30"]);
  assert.match(avisos[0].mensaje, /10 minutos/);
  assert.match(avisos[1].mensaje, /30 minutos/);
});

test("ampliación agotada: dos avisos urgentes para 13h, a 30 y 10 minutos", () => {
  const avisos = crearAvisosAmplitud({ ...turno, ampliacion15h: "agotada" }, 0);
  assert.deepEqual(avisos.map(a => [a.limite, a.minutosAntes, a.nivel]),
    [[13, 30, "urgente"], [13, 10, "urgente"]]);
  assert.deepEqual(avisos.map(a => minutosDesdeInicio(a.fecha)), [750, 770]);
  assert.notEqual(avisos[0].id, avisos[1].id);
});

test("ampliación desconocida: dos avisos preventivos, sin asegurar infracción ni 15h", () => {
  const avisos = crearAvisosAmplitud({ ...turno, ampliacion15h: "desconocida" }, 0);
  assert.deepEqual(avisos.map(a => [a.limite, a.minutosAntes, a.nivel]),
    [[13, 30, "preventiva"], [13, 10, "preventiva"]]);
  avisos.forEach(a => assert.doesNotMatch(a.mensaje, /infracci[oó]n/i));
});

test("una alarma pasada se elimina sin perder la siguiente; IDs estables", () => {
  const turnoSin15 = { ...turno, ampliacion15h: "agotada" as const };
  const avisos = crearAvisosAmplitud(turnoSin15, 0);
  assert.deepEqual(crearAvisosAmplitud(turnoSin15, Date.parse(avisos[0].fecha)).map(a => a.id),
    [avisos[1].id]);
  assert.deepEqual(crearAvisosAmplitud(turnoSin15, Date.parse(avisos[1].fecha)), []);
  assert.deepEqual(crearAvisosAmplitud(turnoSin15, 0), avisos);
});

test("cerrado o datos inválidos no generan avisos", () => {
  assert.equal(crearAvisosAmplitud({ ...turno, ampliacion15h: "disponible", fin: "2026-10-26T10:00:00+01:00" }, 0).length, 0);
  assert.equal(crearAvisosAmplitud({ ...turno, ampliacion15h: "disponible", id: "" }, 0).length, 0);
  assert.equal(crearAvisosAmplitud({ ...turno, ampliacion15h: "disponible", inicio: "bad" }, 0).length, 0);
});
