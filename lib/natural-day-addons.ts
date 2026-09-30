export type NaturalDaySpecialFlag = "DOMINGO" | "FESTIVO";

export type NaturalDayAddon = {
  concepto: string;
  amount: number;
  id: string;
};

type NaturalDaySpecialState = {
  isDomingo?: boolean | null;
  isFestivo?: boolean | null;
};

type DayExtraRates = {
  extra_sunday?: number | null;
  extra_holiday?: number | null;
};

function normalize(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ");
}

function specialFlagFor(addon: NaturalDayAddon): NaturalDaySpecialFlag | null {
  const id = normalize(addon.id);
  const concept = normalize(addon.concepto);
  if (id === "auto domingo" || concept === "domingo") return "DOMINGO";
  if (id === "auto festivo" || concept === "festivo") return "FESTIVO";
  return null;
}

/**
 * Clasifica los conceptos de un dia natural fuera de base.
 *
 * Domingo y Festivo son extras de dia, no pluses genericos. La marca booleana
 * es la fuente de verdad: de este modo un antiguo `auto_domingo` que quedo
 * guardado despues de desmarcar el domingo no vuelve a cobrarse en el informe.
 */
export function classifyNaturalDayAddons(
  day: NaturalDaySpecialState,
  addons: NaturalDayAddon[],
  rates: DayExtraRates,
): {
  dayExtras: Array<{ tipo: NaturalDaySpecialFlag; amount: number }>;
  plusItems: NaturalDayAddon[];
} {
  const dayExtras: Array<{ tipo: NaturalDaySpecialFlag; amount: number }> = [];
  const plusItems: NaturalDayAddon[] = [];
  const seenSpecials = new Set<NaturalDaySpecialFlag>();

  const enabled = (flag: NaturalDaySpecialFlag) =>
    flag === "DOMINGO" ? day.isDomingo === true : day.isFestivo === true;

  for (const addon of Array.isArray(addons) ? addons : []) {
    const amount = Math.round((Number(addon?.amount) || 0) * 100) / 100;
    if (amount <= 0) continue;

    const special = specialFlagFor(addon);
    if (!special) {
      plusItems.push({ ...addon, amount });
      continue;
    }

    // Los conceptos automaticos obsoletos se ignoran si el usuario desactivo
    // la marca. Si esta activa, solo puede existir uno por tipo y por fecha.
    if (!enabled(special) || seenSpecials.has(special)) continue;
    seenSpecials.add(special);
    dayExtras.push({ tipo: special, amount });
  }

  const addConfiguredIfMissing = (
    tipo: NaturalDaySpecialFlag,
    configuredAmount: number | null | undefined,
  ) => {
    if (!enabled(tipo) || seenSpecials.has(tipo)) return;
    const amount = Math.round((Number(configuredAmount) || 0) * 100) / 100;
    if (amount <= 0) return;
    seenSpecials.add(tipo);
    dayExtras.push({ tipo, amount });
  };

  addConfiguredIfMissing("DOMINGO", rates.extra_sunday);
  addConfiguredIfMissing("FESTIVO", rates.extra_holiday);

  return { dayExtras, plusItems };
}
