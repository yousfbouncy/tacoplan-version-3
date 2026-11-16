import { requireNativeModule } from "expo-modules-core";

type AlarmModule = {
  schedule(id: string, epochMillis: number, title: string, body: string): Promise<"exact" | "inexact">;
  cancel(id: string): Promise<void>;
  canScheduleExact(): Promise<boolean>;
  openExactAlarmSettings(): Promise<void>;
};

export const androidAlarm: AlarmModule = requireNativeModule("TacoplanAndroidAlarm");
