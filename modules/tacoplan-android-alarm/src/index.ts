import { requireOptionalNativeModule } from "expo";

type AlarmModule = {
  schedule(id: string, epochMillis: number, title: string, body: string): Promise<"exact" | "inexact">;
  cancel(id: string): Promise<void>;
  canScheduleExact(): Promise<boolean>;
  openExactAlarmSettings(): Promise<void>;
};

// Older APKs may lack this compiled native module. The app must still open
// and availability alerts will use expo-notifications as a fallback.
export const androidAlarm: AlarmModule | null = requireOptionalNativeModule<AlarmModule>("TacoplanAndroidAlarm");
