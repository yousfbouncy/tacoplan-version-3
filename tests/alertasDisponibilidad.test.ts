import test from "node:test";
import assert from "node:assert/strict";
import { crearAvisosAmplitud } from "../lib/alertasDisponibilidad";
const turno = { id: "abc", inicio: "2026-10-26T08:00:00+01:00" };
test("ampliación disponible: 13 horas suave y 15 urgente", () => {
 const a = crearAvisosAmplitud({...turno, ampliacion15h:"disponible"},0);
 assert.deepEqual(a.map(x=>[x.limite,x.nivel]),[[13,"suave"],[15,"urgente"]]);
});
test("agotada: una sola urgente a 13 horas", () => {
 const a=crearAvisosAmplitud({...turno,ampliacion15h:"agotada"},0);
 assert.deepEqual(a.map(x=>[x.limite,x.nivel]),[[13,"urgente"]]);
});
test("desconocida no acusa infracción", () => {
 const a=crearAvisosAmplitud({...turno,ampliacion15h:"desconocida"},0);
 assert.equal(a[0].nivel,"preventiva");
});
test("al cerrar turno se cancelan propuestas", () => {
 assert.equal(crearAvisosAmplitud({...turno,ampliacion15h:"disponible",fin:"2026-10-26T10:00:00+01:00"},0).length,0);
});
