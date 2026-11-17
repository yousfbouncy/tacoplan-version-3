import test from "node:test";
import assert from "node:assert/strict";
import { googleMapsDestination } from "../lib/trip-navigation";

test("hide Google Maps button when traffic supplied no navigation destination",()=>{
  for (const input of [undefined, null, "", "   ", "https://example.org/path", "javascript:alert(1)"]) {
    assert.equal(googleMapsDestination(input),null);
  }
});
test("coordinates and exact street address always open Google Maps",()=>{
  assert.equal(googleMapsDestination("48.123, 11.987"),"https://www.google.com/maps/search/?api=1&query=48.123%2C11.987");
  assert.ok(googleMapsDestination("Calle Mayor 5, Madrid, España")?.startsWith("https://www.google.com/maps/search/"));
  assert.equal(googleMapsDestination("200,1"),null);
});
test("Google Maps share links remain compatible",()=>{
  assert.equal(googleMapsDestination("https://maps.app.goo.gl/abc"),"https://maps.app.goo.gl/abc");
  assert.equal(googleMapsDestination("https://www.google.com/maps/place/Madrid"),"https://www.google.com/maps/place/Madrid");
});
