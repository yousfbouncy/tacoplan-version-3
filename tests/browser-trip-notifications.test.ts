import { test } from "node:test";
import assert from "node:assert/strict";
import { isTrafficTripNotice, tripNoticeEventId, type TrafficTripNotice } from "../lib/browser-trip-notifications";

const ownNotice: TrafficTripNotice = {
  id: "notification-1",
  user_id: "driver-1",
  title: "Nuevo viaje asignado por Tráfico",
  body: "Cliente · Madrid",
  data: { target: "viaje", source: "traffic", tripId: "traffic-123", eventId: "assigned:traffic-123" },
};

test("only the authenticated driver's new traffic trips trigger browser notifications", () => {
  assert.equal(isTrafficTripNotice(ownNotice, "driver-1"), true);
  assert.equal(isTrafficTripNotice(ownNotice, "driver-2"), false);
  assert.equal(isTrafficTripNotice({ ...ownNotice, data: { ...ownNotice.data, source: "admin" } }, "driver-1"), false);
  assert.equal(isTrafficTripNotice({ ...ownNotice, data: { ...ownNotice.data, target: "jornada" } }, "driver-1"), false);
  assert.equal(isTrafficTripNotice({ ...ownNotice, data: { ...ownNotice.data, tripId: "" } }, "driver-1"), false);
});

test("browser deduplication key identifies a trip assignment", () => {
  assert.equal(tripNoticeEventId(ownNotice), "assigned:traffic-123");
  const withoutEventId = { ...ownNotice, data: { ...ownNotice.data, eventId: "" } };
  assert.equal(tripNoticeEventId(withoutEventId), "trip:traffic-123");
});
