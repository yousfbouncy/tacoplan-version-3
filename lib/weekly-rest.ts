import {
  type BaseLocationConfig,
  matchLocationAgainstBase,
} from "@/lib/base-location";

export type WeeklyRestLegalType =
  | "weekly_normal"
  | "weekly_reduced"
  | "weekly_invalid";

export type WeeklyRestLocationStatus =
  | "in_base"
  | "out_of_base"
  | "unknown";

export type WeeklyRestAssessment = {
  legalType: WeeklyRestLegalType;
  durationMin: number;
  compensationGeneratedMin: number;
  warning: string | null;
  locationStatus: WeeklyRestLocationStatus;
  distanceKm: number | null;
  startLocation: string | null;
  endLocation: string | null;
  summaryLabel: string;
};

export function classifyWeeklyRestByDuration(durationMin: number): {
  legalType: WeeklyRestLegalType;
  compensationGeneratedMin: number;
  warning: string | null;
} {
  if (!Number.isFinite(durationMin) || durationMin <= 0) {
    return {
      legalType: "weekly_invalid",
      compensationGeneratedMin: 0,
      warning: "invalid_duration",
    };
  }
  if (durationMin < 24 * 60) {
    return {
      legalType: "weekly_invalid",
      compensationGeneratedMin: 0,
      warning: "below_24h",
    };
  }
  if (durationMin < 45 * 60) {
    // Art. 8.6 CE 561/2006:
    //   Semanal reducido ≥ 24h y < 45h  →  deuda VARIABLE = 45h − duracionReal.
    //   Si hay 2 reducidos seguidos se suman (45h - durA) + (45h - durB) = totalDeuda.
    return {
      legalType: "weekly_reduced",
      compensationGeneratedMin: 45 * 60 - durationMin,
      warning: null,
    };
  }
  return {
    legalType: "weekly_normal",
    compensationGeneratedMin: 0,
    warning: null,
  };
}

function buildSummaryLabel(legalType: WeeklyRestLegalType, locationStatus: WeeklyRestLocationStatus): string {
  if (legalType === "weekly_invalid") {
    return locationStatus === "out_of_base"
      ? "Descanso inferior a 24h fuera de base"
      : locationStatus === "in_base"
        ? "Descanso inferior a 24h en base"
        : "Descanso inferior a 24h";
  }
  if (legalType === "weekly_reduced") {
    return locationStatus === "out_of_base"
      ? "Descanso semanal reducido fuera de base"
      : locationStatus === "in_base"
        ? "Descanso semanal reducido en base"
        : "Descanso semanal reducido";
  }
  return locationStatus === "out_of_base"
    ? "Descanso semanal normal fuera de base"
    : locationStatus === "in_base"
      ? "Descanso semanal normal en base"
      : "Descanso semanal normal";
}

export function assessWeeklyRest(params: {
  durationMin: number;
  base: Partial<BaseLocationConfig> | null | undefined;
  startLocation?: string | null;
  endLocation?: string | null;
}): WeeklyRestAssessment {
  const { legalType, compensationGeneratedMin, warning } = classifyWeeklyRestByDuration(params.durationMin);
  const startMatch = matchLocationAgainstBase(params.base, params.startLocation);
  const endMatch = matchLocationAgainstBase(params.base, params.endLocation);

  let locationStatus: WeeklyRestLocationStatus = "unknown";
  if (startMatch.status === "in_base" && endMatch.status === "in_base") {
    locationStatus = "in_base";
  } else if (startMatch.status === "out_of_base" || endMatch.status === "out_of_base") {
    locationStatus = "out_of_base";
  }

  const distanceKm =
    endMatch.distanceKm != null ? endMatch.distanceKm :
      startMatch.distanceKm != null ? startMatch.distanceKm :
        null;

  return {
    legalType,
    durationMin: params.durationMin,
    compensationGeneratedMin,
    warning,
    locationStatus,
    distanceKm,
    startLocation: params.startLocation?.trim() || null,
    endLocation: params.endLocation?.trim() || null,
    summaryLabel: buildSummaryLabel(legalType, locationStatus),
  };
}
