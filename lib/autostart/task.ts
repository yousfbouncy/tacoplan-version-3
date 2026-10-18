import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { advanceCandidate, type Candidate } from "./engine";
export const AUTOSTART_TASK = "tacoplan-autostart-location-v1";
const KEY = "@tacoplan/autostart/v1";
const COOLDOWN_MS = 8 * 60 * 60 * 1000;
export type Proposal = { id: string; userId: string; detectedAt: string; createdAt: string; status: "pending"; source: "location" };
export type State = { userId: string | null; enabled: boolean; candidate: Candidate; lastDetectedAt: number; proposals: Proposal[] };
const empty: State = { userId: null, enabled: false, candidate: null, lastDetectedAt: 0, proposals: [] };
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
    const result = advanceCandidate(state.candidate, fix);
    state.candidate = result.candidate;
    if (!result.detectedAt) continue;
    if (result.detectedAt - state.lastDetectedAt < COOLDOWN_MS) continue;
    if (state.proposals.some(p => p.status === "pending")) continue;
    const proposal: Proposal = {
      id: `${state.userId}:${result.detectedAt}`, userId: state.userId,
      detectedAt: new Date(result.detectedAt).toISOString(), createdAt: new Date().toISOString(),
      status: "pending", source: "location",
    };
    state.proposals.push(proposal);
    state.lastDetectedAt = result.detectedAt;
    await setAutoStartState(state);
    try {
      await Notifications.scheduleNotificationAsync({
        content: { title: "Tacoplan · Inicio detectado", body: "Movimiento de 3 minutos detectado. Confirma si has empezado a trabajar.", data: { target: "jornada", autostartProposalId: proposal.id } },
        trigger: null,
      });
    } catch {}
  }
  await setAutoStartState(state);
});
