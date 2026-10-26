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
  nivel: NivelAlarma;
  mensaje: string;
}
/** Aviso único cinco minutos antes de cada límite aplicable. */
export function crearAvisosAmplitud(turno: TurnoAlarma, ahora = Date.now()): AvisoAmplitud[] {
  const inicio = Date.parse(turno.inicio);
  if (!turno.id || !Number.isFinite(inicio) || turno.fin) return [];
  const limites: Array<13 | 15> = turno.ampliacion15h === "disponible" ? [13, 15] : [13];
  return limites.map((limite): AvisoAmplitud => {
    const fecha = new Date(inicio + (limite * 60 - 5) * 60000).toISOString();
    const nivel: NivelAlarma =
      limite === 15 ? "urgente" :
      turno.ampliacion15h === "disponible" ? "suave" :
      turno.ampliacion15h === "agotada" ? "urgente" : "preventiva";
    const mensaje =
      nivel === "suave"
        ? "Quedan 5 minutos para las 13 horas. Puedes llegar a 15 horas solo si cumples las condiciones legales."
        : nivel === "preventiva"
          ? "Quedan 5 minutos para las 13 horas. Comprueba si puedes ampliar la jornada."
          : `Quedan 5 minutos para las ${limite} horas. Prepara el final de jornada y tu descanso.`;
    return { id: `amplitud:${turno.id}:${limite}`, fecha, limite, nivel, mensaje };
  }).filter(a => Date.parse(a.fecha) > ahora);
}
