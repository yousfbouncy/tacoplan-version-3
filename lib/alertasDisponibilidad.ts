/** Reglas puras para alarmas de amplitud (no de conducción). */
export type Ampliacion15h = "disponible" | "agotada" | "desconocida";
export type NivelAlarma = "suave" | "urgente" | "preventiva";
export interface TurnoAlarma {
  id: string;
  inicio: string;
  fin?: string | null;
  ampliacion15h: Ampliacion15h;
}
export interface AvisoAmplitud {
  id: string;
  fecha: string;
  limite: 13 | 15;
  minutosAntes: 10 | 30;
  nivel: NivelAlarma;
  mensaje: string;
}
/**
 * Con 15h disponibles: aviso 10 min antes de las 13h y 30 min antes de las 15h.
 * Sin ampliación confirmada (agotada o desconocida): dos avisos, 30 y 10 min
 * antes de las 13h. El estado "desconocida" nunca confirma la ampliación.
 */
export function crearAvisosAmplitud(turno: TurnoAlarma, ahora = Date.now()): AvisoAmplitud[] {
  const inicio = Date.parse(turno.inicio);
  if (!turno.id || !Number.isFinite(inicio) || turno.fin) return [];

  const avisos: Array<{ limite: 13 | 15; minutosAntes: 10 | 30 }> =
    turno.ampliacion15h === "disponible"
      ? [{ limite: 13, minutosAntes: 10 }, { limite: 15, minutosAntes: 30 }]
      : [{ limite: 13, minutosAntes: 30 }, { limite: 13, minutosAntes: 10 }];

  return avisos.map(({ limite, minutosAntes }): AvisoAmplitud => {
    const fecha = new Date(inicio + (limite * 60 - minutosAntes) * 60000).toISOString();
    const nivel: NivelAlarma =
      limite === 15 ? "urgente" :
      turno.ampliacion15h === "disponible" ? "suave" :
      turno.ampliacion15h === "agotada" ? "urgente" : "preventiva";

    const mensaje =
      limite === 15
        ? `Quedan ${minutosAntes} minutos para las 15 horas. Prepara el final de jornada y tu descanso.`
        : turno.ampliacion15h === "disponible"
          ? `Quedan ${minutosAntes} minutos para las 13 horas. Puedes llegar a 15 horas solo si cumples las condiciones legales.`
          : turno.ampliacion15h === "desconocida"
            ? `Quedan ${minutosAntes} minutos para las 13 horas. No se ha podido confirmar la ampliación a 15 horas; comprueba las condiciones.`
            : `Quedan ${minutosAntes} minutos para las 13 horas. No hay ampliación a 15 horas disponible. Prepara el final de jornada y tu descanso.`;

    return { id: `amplitud:${turno.id}:${limite}:${minutosAntes}`, fecha, limite, minutosAntes, nivel, mensaje };
  }).filter(a => Date.parse(a.fecha) > ahora);
}
