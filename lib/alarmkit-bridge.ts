import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

// Legacy exported API stays available for the existing UI, but neither the
// bridge nor its callers load the AlarmKit native module in iOS 3.0.6.
async function ensureNotificationPermission(): Promise<void> {
  if (Platform.OS !== "ios") throw new Error("Solo disponible en iOS");
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted &&
      permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) {
    throw new Error("Se necesita permiso de notificaciones");
  }
}

export async function testAvailabilityAlarm(): Promise<void> {
  await ensureNotificationPermission();
  await Notifications.scheduleNotificationAsync({
    identifier: "tacoplan-availability-notification-test",
    content: {
      title: "Tacoplan · prueba de disponibilidad",
      body: "Aviso de prueba de notificaciones.",
      sound: "default",
      data: { tacoplanAvailabilityAlarmTest: true },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(Date.now() + 10_000),
    },
  });
}

export async function scheduleAvailabilityAlarm(id: string, date: Date, title: string): Promise<void> {
  await ensureNotificationPermission();
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: { title, sound: "default", data: { tacoplanAvailabilityAlarm: true } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
  });
}

export async function cancelAvailabilityAlarm(id: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(id);
}
