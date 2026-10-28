import * as TaskManager from "expo-task-manager";
import type * as Location from "expo-location";
import { queryClient } from "@/lib/query-client";
import { withTimeout } from "./runtime";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MIN_SPEED_MPS, advanceCandidate, shouldAutoConfirm, type Candidate, type MovementSegment } from "./engine";
import { crearJornadaInicio, getEstadoLegal, getJornadaAbierta, getLastLugarFin } from "@/lib/local-storage";
import { userScopedKey } from "@/lib/user-scope";
import { AVAILABILITY_ALARMS_KEY, syncAvailabilityAlarms } from "@/lib/availability-alarms";
import { syncJornadaWidget } from "@/lib/jornada-widget-sync";
export const AUTOSTART_TASK = "tacoplan-autostart-location-v1";
const KEY = "@tacoplan/autostart/v1";
const COOLDOWN_MS = 8 * 60 * 60 * 1000;
// Una conducción continua también debe poder confirmar el inicio sin exigir paradas.
const CONTINUOUS_AUTO_CONFIRM_MS = 3 * 60 * 1000;
export type Proposal = { id: string; userId: string; detectedAt: string; createdAt: string; status: "pending"; source: "location" };
export type State = { userId: string | null; enabled: boolean; candidate: Candidate; lastDetectedAt: number; proposals: Proposal[]; movementSegments: MovementSegment[]; firstMovementAt: number | null; lastFixAt?: number; detectionMinSpeedMps?: number };
const empty: State = { userId: null, enabled: false, candidate: null, lastDetectedAt: 0, proposals: [], movementSegments: [], firstMovementAt: null };
export async function readAutoStartState(): Promise<State> {
  try { return { ...empty, ...JSON.parse((await AsyncStorage.getItem(KEY)) || "{}") }; }
  catch { return { ...empty }; }
}
export async function setAutoStartState(state: State): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(state));
}
// Serialize native deliveries: concurrent callbacks must not overwrite newer movement.
let pendingTask: Promise<void> = Promise.resolve();
TaskManager.defineTask(AUTOSTART_TASK, ({ data, error }) => {
  const next = pendingTask.then(() => processLocations(data, error));
  pendingTask = next.catch((failure) => console.warn("[AUTOSTART] Error procesando ubicación", failure));
  return next;
});
async function processLocations(data: unknown, error: unknown) {
  if (error || !data) return;
  const fixes = ((data as { locations?: Location.LocationObject[] }).locations || []).slice().sort((a, b) => a.timestamp - b.timestamp);
  if (!fixes.length) return;
  const state = await readAutoStartState();
  if (!state.enabled || !state.userId) return;
  // Old 2 km/h candidates must not count toward the new 15 km/h threshold.
  if (state.detectionMinSpeedMps !== MIN_SPEED_MPS) {
    state.candidate = null;
    state.firstMovementAt = null;
    state.movementSegments = [];
    state.proposals = [];
    state.detectionMinSpeedMps = MIN_SPEED_MPS;
  }
  // Never write a shift into another account's local namespace.
  if (await userScopedKey("autostart-owner") !== await userScopedKey("autostart-owner", state.userId)) return;
  const openAtEntry = await getJornadaAbierta();
  if (openAtEntry) {
    state.candidate = null;
    state.firstMovementAt = null;
    state.movementSegments = [];
    await setAutoStartState(state);
    return;
  }
  for (const fix of fixes) {
    if (!Number.isFinite(fix.timestamp) || fix.timestamp <= (state.lastFixAt ?? 0)) continue;
    state.lastFixAt = fix.timestamp;
    if (!state.candidate && typeof fix.coords.speed === "number" && fix.coords.speed >= MIN_SPEED_MPS &&
      typeof fix.coords.accuracy === "number" && fix.coords.accuracy <= 75 && state.firstMovementAt == null) {
      state.firstMovementAt = fix.timestamp;
    }
    const result = advanceCandidate(state.candidate, fix);
    state.candidate = result.candidate;
    if (result.segment) state.movementSegments = [...state.movementSegments, result.segment]
      .filter((segment) => fix.timestamp - segment.startedAt <= 20 * 60 * 1000);
    const continuousMovementConfirmed = state.candidate != null &&
      fix.timestamp - state.candidate.startedAt >= CONTINUOUS_AUTO_CONFIRM_MS;
    if (!result.segment && !continuousMovementConfirmed) continue;
    const firstMovementAt = state.firstMovementAt ?? result.segment?.startedAt ?? state.candidate!.startedAt;
    if (fix.timestamp - firstMovementAt < 0 || fix.timestamp - firstMovementAt > 20 * 60 * 1000) {
      state.firstMovementAt = result.segment?.startedAt ?? state.candidate!.startedAt;
      state.movementSegments = result.segment ? [result.segment] : [];
    }
    if (fix.timestamp - state.lastDetectedAt < COOLDOWN_MS) continue;
    if (state.firstMovementAt != null && (shouldAutoConfirm(state.movementSegments, fix.timestamp) || continuousMovementConfirmed)) {
      const open = await getJornadaAbierta();
      if (open) {
        // A manual start may have won while this batch was being processed.
        state.candidate = null;
        state.firstMovementAt = null;
        state.movementSegments = [];
        continue;
      }
      const startAt = new Date(state.firstMovementAt ?? result.segment?.startedAt ?? state.candidate!.startedAt);
      const fechaInicio = `${startAt.getFullYear()}-${String(startAt.getMonth() + 1).padStart(2, "0")}-${String(startAt.getDate()).padStart(2, "0")}`;
      const horaInicio = `${String(startAt.getHours()).padStart(2, "0")}:${String(startAt.getMinutes()).padStart(2, "0")}`;
      // AutoStart always begins where the previous shift ended. Use local data
      // without a network request so automatic creation keeps working offline.
      const lugarInicio = (await getLastLugarFin())?.trim() || "Lugar de inicio pendiente";
      const startedShift = await crearJornadaInicio({ fechaInicio, horaInicio, lugarInicio });
      const proposalId = `${state.userId}:${state.firstMovementAt ?? (result.segment?.startedAt ?? firstMovementAt)}`;
      state.proposals = state.proposals.filter((p) => p.id !== proposalId);
      state.lastDetectedAt = fix.timestamp;
      state.candidate = null;
      state.firstMovementAt = null;
      state.movementSegments = [];
      // Persist completion BEFORE any optional notification, widget or cloud operation.
      await setAutoStartState(state);
      void queryClient.invalidateQueries({ queryKey: ["jornada-abierta"] });
      void queryClient.invalidateQueries({ queryKey: ["estado-legal"] });
      await withTimeout(Notifications.scheduleNotificationAsync({
        content: { title: "Tacoplan · Jornada iniciada", body: `Inicio registrado automáticamente a las ${horaInicio}. La conducción sigue siendo manual.`, data: { target: "jornada" } },
        trigger: null,
      }), 5000).catch(() => {});
      try {
        const prefKey = await userScopedKey(AVAILABILITY_ALARMS_KEY, state.userId);
        let alertsEnabled = (await AsyncStorage.getItem(prefKey)) !== "false";
        const { data: notificationPrefs } = await withTimeout((await import("@/lib/supabase")).supabase
          .from("profiles").select("notifications_enabled").eq("id", state.userId).maybeSingle(), 5000);
        if ((notificationPrefs as any)?.notifications_enabled === false) alertsEnabled = false;
        const legalState = await getEstadoLegal();
        await syncAvailabilityAlarms(
          { id: startedShift.id, fechaInicio, horaInicio, startAt: startedShift.startAt },
          legalState.availabilityContext,
          alertsEnabled,
        );
        await syncJornadaWidget({ id: startedShift.id, fechaInicio, horaInicio }, legalState.disponibilidadMin);
      } catch (alarmError) {
        console.warn("[AUTOSTART] No se pudieron programar avisos de disponibilidad", alarmError);
      }
      try {
        const { error } = await withTimeout((await import("@/lib/supabase")).supabase.from("autostart_proposals")
          .update({ status: "accepted" }).eq("id", proposalId).eq("user_id", state.userId), 5000);
        if (error) console.warn("[AUTOSTART] Jornada guardada localmente; propuesta pendiente de sincronizar", error);
      } catch (error) {
        console.warn("[AUTOSTART] Jornada guardada localmente; sincronización no disponible", error);
      }
      return;
    }
    if (state.proposals.some(p => p.status === "pending")) continue;
    const proposal: Proposal = {
      id: `${state.userId}:${state.firstMovementAt ?? (result.segment?.startedAt ?? firstMovementAt)}`, userId: state.userId,
      detectedAt: new Date(state.firstMovementAt ?? (result.segment?.startedAt ?? firstMovementAt)).toISOString(), createdAt: new Date().toISOString(),
      status: "pending", source: "location",
    };
    state.proposals.push(proposal);
    await setAutoStartState(state);
    try {
      await withTimeout(Notifications.scheduleNotificationAsync({
        content: { title: "Tacoplan · Inicio detectado", body: "Si no confirmas, la jornada se iniciará automáticamente tras varios tramos de movimiento.", data: { target: "jornada", autostartProposalId: proposal.id } },
        trigger: null,
      }), 5000);
    } catch {}
  }
  await setAutoStartState(state);
}
