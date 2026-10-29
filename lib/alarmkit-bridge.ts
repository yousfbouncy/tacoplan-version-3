import { Platform } from "react-native";
import { alarmKit } from "../modules/tacoplan-alarmkit/src";

export async function testAvailabilityAlarm(): Promise<void> {
  if (Platform.OS !== "ios") throw new Error("Solo disponible en iOS");
  if (Number(Platform.Version) < 26) throw new Error("Se necesita iOS 26 o superior");
  await alarmKit.test();
}

export async function scheduleAvailabilityAlarm(id: string, date: Date, title: string): Promise<void> {
  const status = await alarmKit.requestAuthorization();
  if (status !== "authorized") throw new Error("Sin permiso de alarmas");
  await alarmKit.schedule(id, date.getTime(), title);
}

export async function cancelAvailabilityAlarm(id: string): Promise<void> {
  await alarmKit.cancel(id);
}
