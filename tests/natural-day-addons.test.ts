import assert from "node:assert/strict";
import test from "node:test";

import { classifyNaturalDayAddons } from "../lib/natural-day-addons";

const rates = { extra_sunday: 82.38, extra_holiday: 82.38 };

test("un domingo natural se contabiliza como extra de dia", () => {
  const result = classifyNaturalDayAddons(
    { isDomingo: true, isFestivo: false },
    [
      { id: "auto_domingo", concepto: "Domingo", amount: 82.38 },
      { id: "training", concepto: "Formación seg.conductor", amount: 14 },
    ],
    rates,
  );

  assert.deepEqual(result.dayExtras, [{ tipo: "DOMINGO", amount: 82.38 }]);
  assert.deepEqual(result.plusItems, [
    { id: "training", concepto: "Formación seg.conductor", amount: 14 },
  ]);
});

test("un domingo automatico obsoleto no se cobra si la marca esta desactivada", () => {
  const result = classifyNaturalDayAddons(
    { isDomingo: false, isFestivo: false },
    [{ id: "auto_domingo", concepto: "Domingo", amount: 82.38 }],
    rates,
  );

  assert.deepEqual(result.dayExtras, []);
  assert.deepEqual(result.plusItems, []);
});

test("la marca de domingo completa un importe automatico que falte", () => {
  const result = classifyNaturalDayAddons(
    { isDomingo: true, isFestivo: false },
    [],
    rates,
  );

  assert.deepEqual(result.dayExtras, [{ tipo: "DOMINGO", amount: 82.38 }]);
});

test("domingo y festivo no se duplican aunque tengan ids distintos", () => {
  const result = classifyNaturalDayAddons(
    { isDomingo: true, isFestivo: true },
    [
      { id: "legacy_sunday", concepto: "Domingo", amount: 82.38 },
      { id: "auto_domingo", concepto: "Domingo", amount: 82.38 },
      { id: "auto_festivo", concepto: "Festivo", amount: 82.38 },
    ],
    rates,
  );

  assert.deepEqual(result.dayExtras, [
    { tipo: "DOMINGO", amount: 82.38 },
    { tipo: "FESTIVO", amount: 82.38 },
  ]);
  assert.deepEqual(result.plusItems, []);
});
