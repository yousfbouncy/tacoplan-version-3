import { Platform } from "react-native";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { supabase } from "@/lib/supabase";
import { AUTOSTART_TASK, readAutoStartState, setAutoStartState } from "./task";
export async function enableAutoStart(userId: string): Promise<void> {
  if (Platform.OS === "web") throw new Error("AutoStart solo está disponible en Android e iOS");
  if (!(await TaskManager.isAvailableAsync())) throw new Error("Hace falta una compilación nativa");
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== "granted") throw new Error("Autoriza ubicación precisa");
  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== "granted") throw new Error("Autoriza ubicación en segundo plano");
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("autostart", { name: "AutoStart", importance: Notifications.AndroidImportance.DEFAULT });
  }
  await Notifications.requestPermissionsAsync();
  const previous = await readAutoStartState();
  if (previous.userId && previous.userId !== userId) throw new Error("Desactiva AutoStart de la otra cuenta");
  await setAutoStartState({ ...previous, userId, enabled: true });
  if (!(await Location.hasStartedLocationUpdatesAsync(AUTOSTART_TASK))) {
    try {
      await Location.startLocationUpdatesAsync(AUTOSTART_TASK, {
        accuracy: Location.Accuracy.High, timeInterval: 15000, distanceInterval: 15,
        pausesUpdatesAutomatically: false, activityType: Location.ActivityType.AutomotiveNavigation,
        foregroundService: { notificationTitle: "Tacoplan AutoStart activo", notificationBody: "Detectando movimiento del vehículo" },
        showsBackgroundLocationIndicator: true,
      });
    } catch (e) {
      await setAutoStartState({ ...previous, enabled: false });
      throw e;
    }
  }
}
export async function disableAutoStart(): Promise<void> {
  if (Platform.OS !== "web" && await Location.hasStartedLocationUpdatesAsync(AUTOSTART_TASK)) {
    await Location.stopLocationUpdatesAsync(AUTOSTART_TASK);
  }
  const state = await readAutoStartState();
  await setAutoStartState({ ...state, enabled: false, candidate: null, userId: null });
}
export async function syncAutoStartProposals(userId: string): Promise<void> {
  const state = await readAutoStartState();
  if (!state.enabled || state.userId !== userId) return;
  for (const proposal of state.proposals.filter(p => p.userId === userId)) {
    const { error } = await supabase.from("autostart_proposals").upsert({
      id: proposal.id, user_id: userId, detected_at: proposal.detectedAt, source: "location", status: "pending",
    }, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw error;
  }
  await setAutoStartState({ ...state, proposals: state.proposals.filter(p => p.userId !== userId) });
}
