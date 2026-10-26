import { crearAvisosAmplitud, type Ampliacion15h } from "@/lib/alertasDisponibilidad";
import { Platform } from "react-native";

export const AVAILABILITY_ALARMS_KEY = "tacoplan_availability_alarms_enabled";

type ActiveShift = {
  id: string;
  fechaInicio: string;
  horaInicio: string;
};

/** Reconciles scheduled local alerts with the current open shift. */
export async function syncAvailabilityAlarms(
  shift: ActiveShift | null,
  availabilityMinutes: number | undefined,
  enabled: boolean,
): Promise<void> {
  if (Platform.OS === "web") return;
  const Notifications = await import("expo-notifications");
  const existing = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  const ours = existing.filter((item) => item.content.data?.tacoplanAvailabilityAlarm === true);
  await Promise.all(ours.map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier).catch(() => {})));
  if (!enabled || !shift || !availabilityMinutes || availabilityMinutes <= 0) return;

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

  const start = new Date(`${shift.fechaInicio}T${shift.horaInicio}:00`);
  if (!Number.isFinite(start.getTime())) return;
  const applies15Hours = availabilityMinutes >= 15 * 60;
  const alerts = crearAvisosAmplitud({
    id: shift.id,
    inicio: start.toISOString(),
    ampliacion15h: applies15Hours ? "disponible" as Ampliacion15h : "agotada" as Ampliacion15h,
  });
  await Promise.all(alerts.map((alert) => Notifications.scheduleNotificationAsync({
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
