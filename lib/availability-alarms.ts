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
  if (Notifications.setNotificationChannelAsync) {
    await Notifications.setNotificationChannelAsync("availability-alarms", {
      name: "Avisos de disponibilidad",
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0],
      sound: "default",
    }).catch(() => {});
  }

  const alerts = planAvailabilityAlarms(shift, context, enabled);
  await Promise.all(alerts.map((alert) => Notifications.scheduleNotificationAsync({
    identifier: alert.id,
    content: {
      title: `Tacoplan · límite de ${alert.limite} h`,
      body: alert.mensaje,
      sound: true,
      data: { tacoplanAvailabilityAlarm: true, shiftId: shift.id, limit: alert.limite },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(alert.fecha),
      channelId: "availability-alarms",
    },
  })));
}
