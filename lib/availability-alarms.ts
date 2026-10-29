import AsyncStorage from "@react-native-async-storage/async-storage";
import { scheduleAvailabilityAlarm, cancelAvailabilityAlarm } from "./alarmkit-bridge";
import { planAvailabilityAlarms, type AlarmShift, type AvailabilityContext } from "./availability-context";
import { Platform } from "react-native";

export const AVAILABILITY_ALARMS_KEY = "tacoplan_availability_alarms_enabled";

let pendingSync: Promise<void> = Promise.resolve();

const NATIVE_IDS_KEY = "tacoplan_availability_alarmkit_ids";
function nativeAlarmId(value: string): string {
  let a=2166136261,b=2166136261,c=2166136261,d=2166136261;
  for(let i=0;i<value.length;i++){
    const n=value.charCodeAt(i);
    a=Math.imul(a^n,16777619); b=Math.imul(b^(n+17),16777619);
    c=Math.imul(c^(n+41),16777619); d=Math.imul(d^(n+91),16777619);
  }
  const x=[a,b,c,d].map(n=>(n>>>0).toString(16).padStart(8,"0")).join("");
  return x.slice(0,8)+"-"+x.slice(8,12)+"-4"+x.slice(13,16)+"-a"+x.slice(17,20)+"-"+x.slice(20);
}


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
  if (Platform.OS === "ios" && Number(Platform.Version) >= 26) {
    const oldIds = JSON.parse(await AsyncStorage.getItem(NATIVE_IDS_KEY) || "[]") as string[];
    for (const id of oldIds) await cancelAvailabilityAlarm(id).catch(() => {});
    await AsyncStorage.setItem(NATIVE_IDS_KEY, "[]");
    if (!enabled || !shift || (context?.shiftId === shift.id && !context.aplica13h15h)) return;
    const alerts = planAvailabilityAlarms(shift, context, enabled);
    const ids: string[] = [];
    try {
      for (const alert of alerts) {
        const id = nativeAlarmId(alert.id);
        await scheduleAvailabilityAlarm(id, new Date(alert.fecha), `Tacoplan · límite de ${alert.limite} h`);
        ids.push(id);
        await AsyncStorage.setItem(NATIVE_IDS_KEY, JSON.stringify(ids));
      }
      return;
    } catch (error) {
      console.warn("AlarmKit no pudo programar avisos, usando notificaciones:", error);
      for (const id of ids) await cancelAvailabilityAlarm(id).catch(() => {});
      await AsyncStorage.setItem(NATIVE_IDS_KEY, "[]");
    }
  }
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
