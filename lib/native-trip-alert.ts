import { Platform } from "react-native";
import { supabase } from "@/lib/supabase";
import type { TrafficTripNotice } from "@/lib/browser-trip-notifications";

/** Native, foreground-only fallback when no push device is registered.
 * A registered push token relies on the normal server push to avoid double sounds.
 * Background/closed-app delivery is exclusively the responsibility of APNs/FCM.
 */
export async function notifyLocalTripWithoutPushToken(
  recipientId: string,
  notice: TrafficTripNotice,
): Promise<void> {
  if (Platform.OS === "web" || notice.user_id !== recipientId) return;
  try {
    const { data: devices, error } = await supabase.from("push_tokens")
      .select("id").eq("user_id", recipientId)
      .eq("notifications_enabled", true).limit(1);
    if (error || (devices?.length ?? 0) > 0) return;

    const Notifications = await import("expo-notifications");
    const permission = await Notifications.getPermissionsAsync();
    if (permission.status !== "granted" || (Platform.OS === "ios" && permission.ios?.allowsSound === false)) return;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: notice.title,
        body: notice.body,
        sound: "tacoplan_viaje_3.wav",
        data: { target: "viaje", tripId: notice.data.tripId, source: "traffic", eventId: notice.data.eventId },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 1,
        channelId: "traffic-assigned-v2",
      },
    });
  } catch (error) {
    console.warn("[TRIP-INBOX] Foreground local sound unavailable", error);
  }
}
