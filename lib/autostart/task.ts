import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { advanceAutoStartEvidence, type AutoStartEvidence, type Candidate } from "./engine";
import { getJornadaAbierta, crearJornadaInicio } from "../local-storage";
export const AUTOSTART_TASK = "tacoplan-autostart-location-v1";
const KEY = "@tacoplan/autostart/v1";
const COOLDOWN_MS = 8 * 60 * 60 * 1000;
export type Proposal = { id: string; userId: string; detectedAt: string; createdAt: string; status: "pending"; source: "location" };
export type State = { userId: string | null; enabled: boolean; candidate: Candidate; evidence?: AutoStartEvidence; lastDetectedAt: number; proposals: Proposal[] };
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
    const result = advanceAutoStartEvidence(state.evidence ?? null, fix);
    state.evidence = result.state;
    if (result.shouldAutoConfirm && result.startAt && !state.proposals.some(p => p.status === "pending" && p.userId !== state.userId)) {
      try {
        if (!(await getJornadaAbierta())) {
          const first = new Date(result.startAt);
          const pad = (x: number) => String(x).padStart(2, "0");
          const fechaInicio = `${first.getFullYear()}-${pad(first.getMonth() + 1)}-${pad(first.getDate())}`;
          const horaInicio = `${pad(first.getHours())}:${pad(first.getMinutes())}`;
          await crearJornadaInicio({ fechaInicio, horaInicio, lugarInicio: "" });
          state.proposals = state.proposals.filter(p => p.userId !== state.userId);
          await Notifications.scheduleNotificationAsync({ content: { title: "Tacoplan · Jornada iniciada automáticamente", body: "Inicio registrado con la hora del primer movimiento confirmado. Revisa la jornada si el desplazamiento no era trabajo.", data: { target: "jornada" } }, trigger: null });
        }
      } catch (error) {
        // No señalar como iniciado si falla la escritura local.
        state.evidence = { ...result.state!, autoConfirmed: false };
      }
      await setAutoStartState(state);
      continue;
    }
    if (!result.shouldPrompt || !result.state) continue;
    const detectedAt = result.state.firstMovementAt;
    if (detectedAt - state.lastDetectedAt < COOLDOWN_MS) continue;
    if (state.proposals.some(p => p.status === "pending")) continue;
    const proposal: Proposal = {
      id: `${state.userId}:${detectedAt}`, userId: state.userId,
      detectedAt: new Date(detectedAt).toISOString(), createdAt: new Date().toISOString(),
      status: "pending", source: "location",
    };
    state.proposals.push(proposal);
    state.lastDetectedAt = detectedAt;
    await setAutoStartState(state);
    try {
      await Notifications.scheduleNotificationAsync({
        content: { title: "Tacoplan · Inicio detectado", body: "Movimiento superior a 3 km/h durante 15 segundos detectado. Confirma si has empezado a trabajar.", data: { target: "jornada", autostartProposalId: proposal.id } },
        trigger: null,
      });
    } catch {}
  }
  await setAutoStartState(state);
});
