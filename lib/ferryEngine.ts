export interface FerryInterruption {
  startMin: number;
  endMin: number;
}

export interface FerryRest {
  startTime: string;
  restType: "9h" | "11h";
  interruptions: FerryInterruption[];
}

export interface FerryRestValidation {
  valid: boolean;
  reason: string | null;
  computedEnd: string | null;
}

export function validateFerryRest(rest: FerryRest): FerryRestValidation {
  if (!rest.startTime) {
    return { valid: false, reason: "START_TIME_REQUIRED", computedEnd: null };
  }

  const startDate = new Date(rest.startTime);
  if (isNaN(startDate.getTime())) {
    return { valid: false, reason: "INVALID_START_TIME", computedEnd: null };
  }

  if (rest.interruptions.length > 2) {
    return { valid: false, reason: "MAX_2_INTERRUPTIONS", computedEnd: null };
  }

  let totalInterruptionMin = 0;
  for (let i = 0; i < rest.interruptions.length; i++) {
    const inter = rest.interruptions[i];

    if (inter.startMin < 0 || inter.endMin < 0) {
      return { valid: false, reason: "NEGATIVE_INTERRUPTION_TIME", computedEnd: null };
    }

    if (inter.endMin <= inter.startMin) {
      return { valid: false, reason: "INTERRUPTION_END_BEFORE_START", computedEnd: null };
    }

    const durationMin = inter.endMin - inter.startMin;
    totalInterruptionMin += durationMin;
  }

  if (totalInterruptionMin > 60) {
    return { valid: false, reason: "TOTAL_INTERRUPTIONS_EXCEED_60MIN", computedEnd: null };
  }

  // El art. 9 permite interrumpir el descanso diario normal (11h), no un
  // descanso diario reducido de 9h. Un descanso de 9h sigue siendo válido
  // únicamente cuando no se ha interrumpido.
  if (rest.restType === "9h" && rest.interruptions.length > 0) {
    return { valid: false, reason: "INTERRUPTED_REST_REQUIRES_11H", computedEnd: null };
  }

  for (let i = 0; i < rest.interruptions.length - 1; i++) {
    for (let j = i + 1; j < rest.interruptions.length; j++) {
      const a = rest.interruptions[i];
      const b = rest.interruptions[j];
      if (a.startMin < b.endMin && b.startMin < a.endMin) {
        return { valid: false, reason: "OVERLAPPING_INTERRUPTIONS", computedEnd: null };
      }
    }
  }

  const computedEnd = computeFerryRestEnd(rest);
  return { valid: true, reason: null, computedEnd };
}

export function computeFerryRestEnd(rest: FerryRest): string {
  const startDate = new Date(rest.startTime);
  const baseMinutes = rest.restType === "9h" ? 9 * 60 : 11 * 60;

  let totalInterruptionMin = 0;
  for (const inter of rest.interruptions) {
    totalInterruptionMin += inter.endMin - inter.startMin;
  }

  const totalRestMin = baseMinutes + totalInterruptionMin;
  const endDate = new Date(startDate.getTime() + totalRestMin * 60000);
  return endDate.toISOString();
}

export function isFerryRestValid(rest: FerryRest): FerryRestValidation {
  return validateFerryRest(rest);
}
