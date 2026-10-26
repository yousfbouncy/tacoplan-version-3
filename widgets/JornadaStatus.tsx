import { Text, View } from "react-native";
import { createWidget } from "expo-widgets";
import type { JornadaStatusProps } from "./JornadaStatus.android";
export type { JornadaStatusProps } from "./JornadaStatus.android";

const JornadaStatusLayout = (props: JornadaStatusProps) => (
  <View style={{ padding: 16, backgroundColor: "#0F4C75", borderRadius: 16 }}>
    <Text style={{ color: "#fff", fontWeight: "700" }}>{props.active ? "Disponibilidad" : "Sin jornada abierta"}</Text>
  </View>
);

export default createWidget<JornadaStatusProps>("JornadaStatus", JornadaStatusLayout, {
  active: false,
  deadline13At: new Date().toISOString(),
  deadline15At: new Date().toISOString(),
  show15: false,
});

export async function syncJourneyLiveActivity(_props: JornadaStatusProps) {}
