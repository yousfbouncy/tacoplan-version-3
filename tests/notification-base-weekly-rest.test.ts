import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBaseLocationConfig,
  isBaseLocationConfigured,
  matchLocationAgainstBase,
} from "../lib/base-location";
import {
  canPersistentDispatchApplyToUser,
  selectMissingPersistentDispatchIds,
} from "../lib/notification-visibility";
import { assessWeeklyRest } from "../lib/weekly-rest";

test("snapshot no se materializa para usuarios nuevos y persistent si aplica", () => {
  const existingDispatchIds: string[] = [];
  const dispatches = [
    { id: "snap-1", visibility_mode: "snapshot", target_type: "all" },
    { id: "persist-1", visibility_mode: "persistent", target_type: "all" },
  ];

  const missing = selectMissingPersistentDispatchIds(dispatches, existingDispatchIds, "user-new");
  assert.deepEqual(missing, ["persist-1"]);
  assert.equal(canPersistentDispatchApplyToUser(dispatches[0], "user-new"), false);
  assert.equal(canPersistentDispatchApplyToUser(dispatches[1], "user-new"), true);
});

test("persistent individual solo aplica al usuario objetivo", () => {
  const dispatch = {
    id: "persist-user",
    visibility_mode: "persistent",
    target_type: "user",
    target_user_id: "u-1",
  };

  assert.equal(canPersistentDispatchApplyToUser(dispatch, "u-1"), true);
  assert.equal(canPersistentDispatchApplyToUser(dispatch, "u-2"), false);
});

test("base location queda configurada con nombre, ciudad y país", () => {
  const base = buildBaseLocationConfig({
    baseName: "Base Abrera",
    baseCity: "Abrera",
    baseCountry: "España",
    baseRadiusKm: 20,
  });

  assert.equal(isBaseLocationConfigured(base), true);
});

test("usuario sin base configurada sigue requiriendo configuración", () => {
  const base = buildBaseLocationConfig({
    baseName: "Base Abrera",
    baseCity: "",
    baseCountry: "España",
  });

  assert.equal(isBaseLocationConfigured(base), false);
});

test("cambio de base conserva nuevos datos y radio configurado", () => {
  const base = buildBaseLocationConfig({
    baseName: "Base Lyon",
    baseCity: "Lyon",
    baseCountry: "Francia",
    baseLatitude: 45.764,
    baseLongitude: 4.8357,
    baseRadiusKm: 30,
  });

  assert.equal(base.baseName, "Base Lyon");
  assert.equal(base.baseCity, "Lyon");
  assert.equal(base.baseCountry, "Francia");
  assert.equal(base.baseRadiusKm, 30);
});

test("base con coordenadas clasifica correctamente en base", () => {
  const match = matchLocationAgainstBase(
    {
      baseName: "Base Abrera",
      baseCity: "Abrera",
      baseCountry: "España",
      baseLatitude: 41.517,
      baseLongitude: 1.902,
      baseRadiusKm: 20,
    },
    "Abrera, Barcelona, España",
    { latitude: 41.52, longitude: 1.91 },
  );

  assert.equal(match.status, "in_base");
  assert.equal(match.matchedBy, "coordinates");
});

test("base solo con ciudad y país admite coincidencias normalizadas", () => {
  const match = matchLocationAgainstBase(
    {
      baseName: "Base Abrera",
      baseCity: "Abrera",
      baseCountry: "España",
    },
    "Abrera, Barcelona, Espana",
  );

  assert.equal(match.status, "in_base");
  assert.equal(match.matchedBy, "city_country");
});

test("coincidencia parcial de ubicación queda como desconocida para confirmación manual", () => {
  const match = matchLocationAgainstBase(
    {
      baseName: "Base Abrera",
      baseCity: "Abrera",
      baseCountry: "España",
    },
    "Abrera, Barcelona",
  );

  assert.equal(match.status, "unknown");
});

test("45h en base sigue siendo descanso semanal normal sin compensación", () => {
  const result = assessWeeklyRest({
    durationMin: 45 * 60,
    base: { baseName: "Base Abrera", baseCity: "Abrera", baseCountry: "España" },
    startLocation: "Base Abrera, España",
    endLocation: "Abrera, España",
  });

  assert.equal(result.legalType, "weekly_normal");
  assert.equal(result.locationStatus, "in_base");
  assert.equal(result.compensationGeneratedMin, 0);
});

test("45h fuera de base sigue siendo descanso semanal normal sin compensación", () => {
  const result = assessWeeklyRest({
    durationMin: 45 * 60,
    base: { baseName: "Base Abrera", baseCity: "Abrera", baseCountry: "España" },
    startLocation: "Lyon, Francia",
    endLocation: "Lyon, Francia",
  });

  assert.equal(result.legalType, "weekly_normal");
  assert.equal(result.locationStatus, "out_of_base");
  assert.equal(result.compensationGeneratedMin, 0);
});

test("46h fuera de base sigue siendo descanso semanal normal", () => {
  const result = assessWeeklyRest({
    durationMin: 46 * 60,
    base: { baseName: "Base Abrera", baseCity: "Abrera", baseCountry: "España" },
    startLocation: "Lyon, Francia",
    endLocation: "Lyon, Francia",
  });

  assert.equal(result.legalType, "weekly_normal");
  assert.equal(result.compensationGeneratedMin, 0);
});

test("24h fuera de base genera 21h de compensación", () => {
  const result = assessWeeklyRest({
    durationMin: 24 * 60,
    base: { baseName: "Base Abrera", baseCity: "Abrera", baseCountry: "España" },
    startLocation: "Lyon, Francia",
    endLocation: "Lyon, Francia",
  });

  assert.equal(result.legalType, "weekly_reduced");
  assert.equal(result.locationStatus, "out_of_base");
  assert.equal(result.compensationGeneratedMin, 21 * 60);
});

test("30h en base genera 15h de compensación", () => {
  const result = assessWeeklyRest({
    durationMin: 30 * 60,
    base: { baseName: "Base Abrera", baseCity: "Abrera", baseCountry: "España" },
    startLocation: "Abrera, España",
    endLocation: "Abrera, España",
  });

  assert.equal(result.legalType, "weekly_reduced");
  assert.equal(result.locationStatus, "in_base");
  assert.equal(result.compensationGeneratedMin, 15 * 60);
});

test("44h fuera de base genera 1h de compensación", () => {
  const result = assessWeeklyRest({
    durationMin: 44 * 60,
    base: { baseName: "Base Abrera", baseCity: "Abrera", baseCountry: "España" },
    startLocation: "Lyon, Francia",
    endLocation: "Lyon, Francia",
  });

  assert.equal(result.legalType, "weekly_reduced");
  assert.equal(result.compensationGeneratedMin, 60);
});

test("menos de 24h muestra advertencia y no genera deuda semanal reducida", () => {
  const result = assessWeeklyRest({
    durationMin: 23 * 60,
    base: { baseName: "Base Abrera", baseCity: "Abrera", baseCountry: "España" },
    startLocation: "Lyon, Francia",
    endLocation: "Lyon, Francia",
  });

  assert.equal(result.legalType, "weekly_invalid");
  assert.equal(result.warning, "below_24h");
  assert.equal(result.compensationGeneratedMin, 0);
});

test("jornadas antiguas sin base quedan con ubicación desconocida sin recalcular compensación", () => {
  const result = assessWeeklyRest({
    durationMin: 45 * 60,
    base: null,
    startLocation: "Lyon, Francia",
    endLocation: "Lyon, Francia",
  });

  assert.equal(result.legalType, "weekly_normal");
  assert.equal(result.locationStatus, "unknown");
  assert.equal(result.compensationGeneratedMin, 0);
});
