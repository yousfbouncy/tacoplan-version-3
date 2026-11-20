import { Platform } from "react-native";

// On iOS 3.0.6, do not load expo-widgets or call its ObjC TurboModule.
// This is deliberately separate from the 13/15 h availability notifications.
type OpenShift = { id: string; fechaInicio: string; horaInicio: string } | null;

export async function syncJornadaWidget(shift: OpenShift, availabilityMinutes?: number): Promise<void> {
  if (Platform.OS === "ios" || Platform.OS === "web") return;
  const now = new Date().toISOString();
  let props = { active: false, deadline13At: now, deadline15At: now, show15: false };
  if (shift) {
    const startedAt = new Date(`${shift.fechaInicio}T${shift.horaInicio}:00`);
    if (Number.isFinite(startedAt.getTime())) {
      props = {
        active: true,
        deadline13At: new Date(startedAt.getTime() + 13 * 60 * 60 * 1000).toISOString(),
        deadline15At: new Date(startedAt.getTime() + 15 * 60 * 60 * 1000).toISOString(),
        show15: (availabilityMinutes ?? 0) >= 15 * 60,
      };
    }
  }
  try {
    // The Android widget stays enabled. No iOS widget import or native invocation.
    const { default: JornadaStatusWidget, syncJourneyLiveActivity } = await import("@/widgets/JornadaStatus");
    JornadaStatusWidget.updateSnapshot(props);
    await syncJourneyLiveActivity(props);
  } catch (e) {
    console.warn("[WIDGET] Could not sync Android widget", e);
  }
}
