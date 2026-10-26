import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { advanceCandidate, shouldAutoConfirm, type Candidate, type MovementSegment } from "./engine";
import { crearJornadaInicio, getEstadoLegal, getJornadaAbierta } from "@/lib/local-storage";
import { userScopedKey } from "@/lib/user-scope";
import { AVAILABILITY_ALARMS_KEY, syncAvailabilityAlarms } from "@/lib/availability-alarms";
import { syncJornadaWidget } from "@/lib/jornada-widget-sync";
export const AUTOSTART_TASK = "tacoplan-autostart-location-v1";
const KEY = "@tacoplan/autostart/v1";
const COOLDOWN_MS = 8 * 60 * 60 * 1000;
export type Proposal = { id: string; userId: string; detectedAt: string; createdAt: string; status: "pending"; source: "location" };
export type State = { userId: string | null; enabled: boolean; candidate: Candidate; lastDetectedAt: number; proposals: Proposal[]; movementSegments: MovementSegment[]; firstMovementAt: number | null };
const empty: State = { userId: null, enabled: false, candidate: null, lastDetectedAt: 0, proposals: [], movementSegments: [], firstMovementAt: null };
export async function readAutoStartState(): Promise<State> {
  try { return { ...empty, ...JSON.parse((await AsyncStorage.getItem(KEY)) || "{}") }; }
  catch { return { ...empty }; }
}
export async function setAutoStartState(state: State): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(state));
}
TaskManager.defineTask(AUTOSTART_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const fixes = ((data as { locations?: Location.LocationObject[] }).locations || []).slice().sort((a, b) => a.timestamp - b.timestamp);
  if (!fixes.length) return;
  const state = await readAutoStartState();
  if (!state.enabled || !state.userId) return;
  for (const fix of fixes) {
    if (!state.candidate && typeof fix.coords.speed === "number" && fix.coords.speed >= 2 / 3.6 &&
      typeof fix.coords.accuracy === "number" && fix.coords.accuracy <= 75 && state.firstMovementAt == null) {
      state.firstMovementAt = fix.timestamp;
    }
    const result = advanceCandidate(state.candidate, fix);
    state.candidate = result.candidate;
    if (result.segment) state.movementSegments = [...state.movementSegments, result.segment]
      .filter((segment) => fix.timestamp - segment.startedAt <= 20 * 60 * 1000);
    if (!result.segment) continue;
    const firstMovementAt = state.firstMovementAt ?? result.segment.startedAt;
    if (fix.timestamp - firstMovementAt < 0 || fix.timestamp - firstMovementAt > 20 * 60 * 1000) {
      state.firstMovementAt = result.segment.startedAt;
      state.movementSegments = [result.segment];
    }
    if (fix.timestamp - state.lastDetectedAt < COOLDOWN_MS) continue;
    if (state.firstMovementAt != null && shouldAutoConfirm(state.movementSegments, fix.timestamp)) {
      const open = await getJornadaAbierta();
      if (open) {
        const pending = state.proposals.find((p) => p.userId === state.userId && p.status === "pending");
        if (pending) {
          await (await import("@/lib/supabase")).supabase.from("autostart_proposals")
            .update({ status: "dismissed" }).eq("id", pending.id).eq("user_id", state.userId);
          state.proposals = state.proposals.filter((p) => p.id !== pending.id);
        }
        state.firstMovementAt = null;
        state.movementSegments = [];
        continue;
      }
      const startAt = new Date(state.firstMovementAt ?? result.segment.startedAt);
      const fechaInicio = `${startAt.getFullYear()}-${String(startAt.getMonth() + 1).padStart(2, "0")}-${String(startAt.getDate()).padStart(2, "0")}`;
      const horaInicio = `${String(startAt.getHours()).padStart(2, "0")}:${String(startAt.getMinutes()).padStart(2, "0")}`;
      let lugarInicio = "Ubicación detectada automáticamente";
      try {
        const [place] = await Location.reverseGeocodeAsync(fix.coords);
        if (place) lugarInicio = [place.city, place.region, place.country].filter(Boolean).join(", ") || lugarInicio;
      } catch {}
      await crearJornadaInicio({ fechaInicio, horaInicio, lugarInicio });
      try {
        const prefKey = await userScopedKey(AVAILABILITY_ALARMS_KEY, state.userId);
        let alertsEnabled = (await AsyncStorage.getItem(prefKey)) !== "false";
        const { data: notificationPrefs } = await (await import("@/lib/supabase")).supabase
          .from("profiles").select("notifications_enabled").eq("id", state.userId).maybeSingle();
        if ((notificationPrefs as any)?.notifications_enabled === false) alertsEnabled = false;
        const legalState = await getEstadoLegal();
        await syncAvailabilityAlarms(
          { id: `${state.userId}:${state.firstMovementAt ?? result.segment.startedAt}`, fechaInicio, horaInicio },
          legalState.disponibilidadMin,
          alertsEnabled,
        );
        await syncJornadaWidget({ id: `${state.userId}:${state.firstMovementAt ?? result.segment.startedAt}`, fechaInicio, horaInicio }, legalState.disponibilidadMin);
      } catch (alarmError) {
        console.warn("[AUTOSTART] No se pudieron programar avisos de disponibilidad", alarmError);
      }
      const proposalId = `${state.userId}:${state.firstMovementAt ?? result.segment.startedAt}`;
      const { error } = await (await import("@/lib/supabase")).supabase.from("autostart_proposals")
        .update({ status: "accepted" }).eq("id", proposalId).eq("user_id", state.userId);
      if (error) throw error;
      state.proposals = state.proposals.filter((p) => p.id !== proposalId);
      state.lastDetectedAt = fix.timestamp;
      state.firstMovementAt = null;
      state.movementSegments = [];
      await Notifications.scheduleNotificationAsync({
        content: { title: "Tacoplan · Jornada iniciada", body: `Inicio registrado automáticamente a las ${horaInicio}. La conducción sigue siendo manual.`, data: { target: "jornada" } },
        trigger: null,
      }).catch(() => {});
      continue;
    }
    if (state.proposals.some(p => p.status === "pending")) continue;
    const proposal: Proposal = {
      id: `${state.userId}:${state.firstMovementAt ?? result.segment.startedAt}`, userId: state.userId,
      detectedAt: new Date(state.firstMovementAt ?? result.segment.startedAt).toISOString(), createdAt: new Date().toISOString(),
      status: "pending", source: "location",
    };
    state.proposals.push(proposal);
    await setAutoStartState(state);
    try {
      await Notifications.scheduleNotificationAsync({
        content: { title: "Tacoplan · Inicio detectado", body: "Si no confirmas, la jornada se iniciará automáticamente tras varios tramos de movimiento.", data: { target: "jornada", autostartProposalId: proposal.id } },
        trigger: null,
      });
    } catch {}
  }
  await setAutoStartState(state);
});
