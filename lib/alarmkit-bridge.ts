import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

// Compatibility wrapper for existing test controls.
// Tacoplan no longer loads or requests authorization through AlarmKit.
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
      body: "Esta es una notificación de prueba, sin AlarmKit.",
      sound: "default",
      data: { tacoplanAvailabilityAlarmTest: true },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(Date.now() + 10_000) },
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
