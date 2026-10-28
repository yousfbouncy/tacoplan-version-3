import { planAvailabilityAlarms, type AlarmShift, type AvailabilityContext } from "./availability-context";
import { Platform } from "react-native";

export const AVAILABILITY_ALARMS_KEY = "tacoplan_availability_alarms_enabled";

let pendingSync: Promise<void> = Promise.resolve();

export function syncAvailabilityAlarms(shift: AlarmShift | null, context: AvailabilityContext | undefined, enabled: boolean): Promise<void> {
  const next = pendingSync.then(() => reconcileAvailabilityAlarms(shift, context, enabled));
  pendingSync = next.catch(() => {});
  return next;
}

/** Reconciles scheduled local alerts with the current open shift. */
async function reconcileAvailabilityAlarms(
  shift: AlarmShift | null,
  context: AvailabilityContext | undefined,
  enabled: boolean,
): Promise<void> {
  if (Platform.OS === "web") return;
  const Notifications = await import("expo-notifications");
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  const ours = existing.filter((item) => item.content.data?.tacoplanAvailabilityAlarm === true);
  await Promise.all(ours.map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)));
  if (!enabled || !shift) return;

  if (context?.shiftId === shift.id && !context.aplica13h15h) return;

  const permission = await Notifications.getPermissionsAsync().catch(() => ({ status: "undetermined" } as any));
  if (permission.status !== "granted") return;
  // Android keeps a channel's sound/importance settings after creation.
  // Use a new channel ID so upgraded installations receive the audible defaults.
  // The user can still silence this channel in the system's notification settings.
  const availabilityChannelId = "availability-alarms-sound-v2";
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(availabilityChannelId, {
      name: "Alarmas de disponibilidad",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 350, 150, 350],
      sound: "default",
    });
  }

  const alerts = planAvailabilityAlarms(shift, context, enabled);
  await Promise.all(alerts.map((alert) => Notifications.scheduleNotificationAsync({
    identifier: alert.id,
    content: {
      title: `Tacoplan · límite de ${alert.limite} h`,
      body: alert.mensaje,
      sound: "default",
      data: { tacoplanAvailabilityAlarm: true, shiftId: shift.id, limit: alert.limite },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(alert.fecha),
      ...(Platform.OS === "android" ? { channelId: availabilityChannelId } : {}),
    },
  })));
}
