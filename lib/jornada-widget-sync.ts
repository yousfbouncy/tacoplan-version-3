import JornadaStatusWidget, { syncJourneyLiveActivity } from "@/widgets/JornadaStatus";
import type { JornadaStatusProps } from "@/widgets/JornadaStatus";

type OpenShift = { id: string; fechaInicio: string; horaInicio: string } | null;

const emptyProps = (): JornadaStatusProps => ({
  active: false,
  deadline13At: new Date().toISOString(),
  deadline15At: new Date().toISOString(),
  show15: false,
});

export async function syncJornadaWidget(shift: OpenShift, availabilityMinutes?: number) {
  let props = emptyProps();
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
  try { JornadaStatusWidget.updateSnapshot(props); } catch {}
  try { await syncJourneyLiveActivity(props); } catch {}
}
