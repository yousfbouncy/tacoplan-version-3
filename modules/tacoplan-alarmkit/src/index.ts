import { requireNativeModule } from "expo-modules-core";
const native = requireNativeModule("TacoplanAlarmKit");
export const alarmKit = {
  requestAuthorization: (): Promise<string> => native.requestAuthorization(),
  schedule: (id: string, timestampMs: number, title: string): Promise<void> => native.schedule(id, timestampMs, title),
  cancel: (id: string): Promise<void> => native.cancel(id),
  test: (): Promise<void> => native.test(),
};
