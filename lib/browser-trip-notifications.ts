/**
 * Validates an in-app notification before treating it as a new trip alert.
 * Only the recipient can receive it via RLS-protected Supabase Realtime.
 */
export type TrafficTripNotice = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  data: {
    target: "viaje";
    source: "traffic";
    tripId: string;
    eventId?: string;
    [key: string]: unknown;
  };
};

export function isTrafficTripNotice(value: unknown, recipientId: string): value is TrafficTripNotice {
  if (!value || typeof value !== "object" || !recipientId) return false;
  const row = value as Record<string, any>;
  return typeof row.id === "string" && !!row.id
    && row.user_id === recipientId
    && typeof row.title === "string"
    && typeof row.body === "string"
    && row.data?.target === "viaje"
    && row.data?.source === "traffic"
    && typeof row.data.tripId === "string"
    && !!row.data.tripId;
}

export function tripNoticeEventId(notice: TrafficTripNotice): string {
  return typeof notice.data.eventId === "string" && notice.data.eventId.trim()
    ? notice.data.eventId
    : `trip:${notice.data.tripId}`;
}
