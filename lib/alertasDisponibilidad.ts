/**
 * Alertas de amplitud de jornada (13 / 15 horas).
 *
 * Módulo puro, sin efectos secundarios. El cliente móvil debe programar una
 * notificación local con sonido, deduplicarla y cancelarla al finalizar jornada.
 * No confundir amplitud de jornada con tiempo de conducción o trabajo efectivo.
 */
export type EstadoAmpliacion15h = "disponible" | "agotada" | "desconocida";
export type IntensidadAlarma = "suave" | "urgente" | "precaucion";

export interface JornadaParaAlarma {
  id: string;
  inicioISO: string;
  finISO?: string | null;
  ampliacion15h: EstadoAmpliacion15h;
}
export interface AlarmaDisponibilidad {
  id: string;
  fechaISO: string;
  limiteHoras: 13 | 15;
  intensidad: IntensidadAlarma;
  titulo: string;
  cuerpo: string;
  // Duración objetivo del sonido; su aplicación depende del SO y permisos.
  sonidoSegundos: number;
}

/** Aviso único cinco minutos antes de cada límite aplicable. */
export function calcularAlarmasDisponibilidad(jornada: JornadaParaAlarma): AlarmaDisponibilidad[] {
  const inicio = new Date(jornada.inicioISO).getTime();
  if (!jornada.id || !Number.isFinite(inicio)) return [];
  const fin = jornada.finISO ? new Date(jornada.finISO).getTime() : null;
  if (fin !== null && Number.isFinite(fin)) return [];

  const limites: Array<13 | 15> = jornada.ampliacion15h === "disponible"
    ? [13, 15] : [13];
  const etiquetas: Record<IntensidadAlarma, string> = {
    suave: "Aviso de disponibilidad",
    urgente: "Atención: límite de jornada próximo",
    precaucion: "Verifica tu disponibilidad",
  };

  return limites.map((limiteHoras) => {
    const intensidad: IntensidadAlarma = limiteHoras === 13
      ? jornada.ampliacion15h === "disponible" ? "suave"
        : jornada.ampliacion15h === "agotada" ? "urgente" : "precaucion"
      : "urgente";
    const horaLimite = new Date(inicio + limiteHoras * 60 * 60 * 1000);
    const fechaAviso = new Date(horaLimite.getTime() - 5 * 60 * 1000);
    let cuerpo: string;
    if (limiteHoras === 13 && jornada.ampliacion15h === "disponible") {
      cuerpo = "Quedan 5 minutos para las 13 horas. Según tu configuración, tienes disponible una ampliación hasta 15 horas; revisa que cumples las condiciones de descanso.";
    } else if (intensidad === "precaucion") {
      cuerpo = "Quedan 5 minutos para las 13 horas. No se ha confirmado si puedes ampliar hasta 15; verifica tu límite antes de continuar.";
    } else {
      cuerpo = `Quedan 5 minutos para las ${limiteHoras} horas de amplitud. Prepárate para finalizar la jornada y realizar el descanso correspondiente.`;
    }
    return {
      id: `disponibilidad:${jornada.id}:${limiteHoras}h:5min`,
      fechaISO: fechaAviso.toISOString(),
      limiteHoras,
      intensidad,
      titulo: etiquetas[intensidad],
      cuerpo,
      sonidoSegundos: intensidad === "suave" ? 3 : 5,
    };
  });
}

/** Para no programar alertas pasadas al restaurar la app. */
export function alarmasPendientes(jornada: JornadaParaAlarma, ahoraISO: string): AlarmaDisponibilidad[] {
  const ahora = new Date(ahoraISO).getTime();
  return Number.isFinite(ahora)
    ? calcularAlarmasDisponibilidad(jornada).filter(a => new Date(a.fechaISO).getTime() > ahora)
    : [];
}
