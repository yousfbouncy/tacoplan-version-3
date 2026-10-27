import test from "node:test";
import assert from "node:assert/strict";
import { suggestClosingDiet, applyClosingDietSuggestion } from "../lib/automatic-diet-selection";
const base = { baseCity: "Abrera", baseCountry: "España", baseLatitude: 41.516, baseLongitude: 1.902, baseRadiusKm: 20 };
const auto = { route: false, overnight: false, percentage: false };
test("Abrera to Alicante selects national, overnight and 100 percent", () => {
  const suggestion = suggestClosingDiet({ base, endPlace: "Alicante, España", startPlace: "Abrera, España" });
  assert.deepEqual(suggestion, { tipoRuta: "NACIONAL", pernocta: true, percentage: 100 });
  assert.deepEqual(applyClosingDietSuggestion({ tipoRuta: "NINGUNO", pernocta: false, percentage: 30 }, suggestion, auto),
    { tipoRuta: "NACIONAL", pernocta: true, percentage: 100 });
});
test("GPS country code handles localized country names", () => {
  assert.deepEqual(suggestClosingDiet({ base, endPlace: "Alicante, España", gps: {
    label: "Alicante, España", countryCode: "ES", latitude: 38.345, longitude: -0.481,
  } }), { tipoRuta: "NACIONAL", pernocta: true, percentage: 100 });
});
test("return to base selects no overnight without forcing arrival percentage", () => {
  assert.deepEqual(suggestClosingDiet({ base, endPlace: "Abrera, España" }), { tipoRuta: "NACIONAL", pernocta: false, percentage: null });
});
test("foreign endpoint or foreign start keeps international on return", () => {
  for (const pair of [{ endPlace: "Lyon, France" }, { endPlace: "Abrera, España", startPlace: "Lyon, Francia" }]) {
    assert.equal(suggestClosingDiet({ base, ...pair }).tipoRuta, "INTERNACIONAL");
  }
});
test("manual route, overnight and percentage decisions survive automatic updates", () => {
  const current = { tipoRuta: "REGIONAL", pernocta: false, percentage: 60 };
  const suggestion = suggestClosingDiet({ base, endPlace: "Alicante, España" });
  assert.deepEqual(applyClosingDietSuggestion(current, suggestion, { route: true, overnight: true, percentage: true }), current);
  assert.equal(applyClosingDietSuggestion(current, suggestion, { ...auto, percentage: true }).percentage, 60);
});
test("missing base or location leaves unknown fields unchanged", () => {
  for (const args of [{ base: null, endPlace: "Alicante, España" }, { base, endPlace: "" }, { base, endPlace: "Área de servicio" }]) {
    assert.deepEqual(suggestClosingDiet(args), { tipoRuta: null, pernocta: null, percentage: null });
  }
});
test("stale GPS is not applied to an edited destination", () => {
  assert.equal(suggestClosingDiet({ base, endPlace: "Abrera, España", gps: { label: "Alicante, España", countryCode: "ES", latitude: 38.345, longitude: -0.481 } }).pernocta, false);
});
test("base radius prevails over a nearby town name", () => {
  assert.equal(suggestClosingDiet({ base, endPlace: "Martorell, España", gps: { label: "Martorell, España", countryCode: "ES", latitude: 41.474, longitude: 1.93 } }).pernocta, false);
});
