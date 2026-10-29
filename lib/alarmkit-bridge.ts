import { Platform } from "react-native";
async function getAlarmKit() { return (await import("../modules/tacoplan-alarmkit/src")).alarmKit; }

export async function testAvailabilityAlarm(): Promise<void> {
  if (Platform.OS !== "ios") throw new Error("Solo disponible en iOS");
  if (Number(Platform.Version) < 26) throw new Error("Se necesita iOS 26 o superior");
  await (await getAlarmKit()).test();
}

export async function scheduleAvailabilityAlarm(id: string, date: Date, title: string): Promise<void> {
  const status = await (await getAlarmKit()).requestAuthorization();
  if (status !== "authorized") throw new Error("Sin permiso de alarmas");
  await (await getAlarmKit()).schedule(id, date.getTime(), title);
}

export async function cancelAvailabilityAlarm(id: string): Promise<void> {
  await (await getAlarmKit()).cancel(id);
}
