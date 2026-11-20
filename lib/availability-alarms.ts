import AsyncStorage from "@react-native-async-storage/async-storage";
import { planAvailabilityAlarms, type AlarmShift, type AvailabilityContext } from "./availability-context";
import { nativeAlarmPlanSignature } from "./native-alarm-plan-signature";
import { Platform } from "react-native";

export const AVAILABILITY_ALARMS_KEY = "tacoplan_availability_alarms_enabled";

let pendingSync: Promise<void> = Promise.resolve();

// Impide que sincronizaciones anteriores vuelvan a activar alarmas tras cerrar.
const closedShiftIds = new Set<string>();

/**
 * Se llama solo después de guardar correctamente el cierre de una jornada.
 * Cancela los próximos avisos en iOS/Android y retira los ya mostrados.
 * No toca notificaciones de AutoStart, dietas ni otras funciones.
 */
export function cancelAvailabilityAlarmsForClosedShift(shiftId: string): Promise<void> {
  if (shiftId) closedShiftIds.add(shiftId);
  const next = pendingSync.then(async () => {
    await reconcileAvailabilityAlarms(null, undefined, false);
    if (Platform.OS === "web") return;
    const Notifications = await import("expo-notifications");
    const presented = await Notifications.getPresentedNotificationsAsync();
    const ours = presented.filter(
      item => item.request.content.data?.tacoplanAvailabilityAlarm === true,
    );
    await Promise.all(ours.map(
      item => Notifications.dismissNotificationAsync(item.request.identifier),
    ));
  });
  pendingSync = next.catch(() => {});
  return next;
}

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
  // El cierre tiene prioridad incluso frente a sincronizaciones en cola.
  if (shift?.id && closedShiftIds.has(shift.id)) return;
  if (Platform.OS === "web") return;
  if (Platform.OS === "android") {
    const key = "tacoplan_availability_android_native_ids";
    const planKey = "tacoplan_availability_android_native_plan_v1";
    try {
      const { androidAlarm } = await import("../modules/tacoplan-android-alarm/src");
      if (!androidAlarm) throw new Error("TacoplanAndroidAlarm no está integrado en esta APK");
      // AlarmManager owns these alarms even when JS is closed. Cancelling and
      // recreating them on every 15-second dashboard sync can prevent a due
      // alarm from sounding. Keep a stable snapshot until the plan changes.
      const scheduledAlerts = planAvailabilityAlarms(shift, context, enabled);
      const signature = nativeAlarmPlanSignature(scheduledAlerts);
      const lastSignature = await AsyncStorage.getItem(planKey);
      if (lastSignature === signature) return;
      let previous: string[] = [];
      try {
        const saved = JSON.parse(await AsyncStorage.getItem(key) || "[]");
        previous = Array.isArray(saved) ? saved.filter((v): v is string => typeof v === "string") : [];
      } catch {}
      for (const id of previous) await androidAlarm.cancel(id);
      await AsyncStorage.setItem(key, "[]");
      if (!enabled || !shift || (context?.shiftId === shift.id && !context.aplica13h15h)) {
        const Notifications = await import("expo-notifications");
        const legacy = await Notifications.getAllScheduledNotificationsAsync();
        await Promise.all(legacy.filter(item => item.content.data?.tacoplanAvailabilityAlarm === true)
          .map(item => Notifications.cancelScheduledNotificationAsync(item.identifier)));
        await AsyncStorage.setItem(planKey, signature);
        return;
      }
      const ids: string[] = [];
      try {
        for (const alert of scheduledAlerts) {
          await androidAlarm.schedule(alert.id, Date.parse(alert.fecha),
            `Tacoplan · límite de ${alert.limite} h`, alert.mensaje);
          ids.push(alert.id);
          await AsyncStorage.setItem(key, JSON.stringify(ids));
        }
        // The system AlarmManager now owns these alerts; remove old Expo
        // scheduled notifications to avoid a second sound at the same time.
        const Notifications = await import("expo-notifications");
        const legacy = await Notifications.getAllScheduledNotificationsAsync();
        await Promise.all(legacy.filter(item => item.content.data?.tacoplanAvailabilityAlarm === true)
          .map(item => Notifications.cancelScheduledNotificationAsync(item.identifier)));
        await AsyncStorage.setItem(planKey, signature);
        return;
      } catch (error) {
        for (const id of ids) await androidAlarm.cancel(id).catch(() => {});
        await AsyncStorage.setItem(key, "[]");
        await AsyncStorage.removeItem(planKey);
        throw error;
      }
    } catch (error) {
      console.warn("[ANDROID ALARMS] Módulo nativo no disponible, usando notificaciones:", error);
    }
  }
  // iOS: AlarmKit deliberately removed. Use ordinary local notifications
  // (the same fallback as in 3.0.2) to warn before the 13/15-hour limit.
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
