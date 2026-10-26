import { Column, Text } from "@expo/ui/jetpack-compose";
import { background, cornerRadius, paddingAll } from "@expo/ui/jetpack-compose/modifiers";
import { createWidget } from "expo-widgets";

export type JornadaStatusProps = {
  active: boolean;
  deadline13At: string;
  deadline15At: string;
  show15: boolean;
};

const JornadaStatusLayout = (props: JornadaStatusProps) => {
  "widget";
  const remaining = (iso: string) => {
    const minutes = Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 60000));
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hours).padStart(2, "0")} h ${String(mins).padStart(2, "0")} min`;
  };
  const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <Column
      verticalArrangement="center"
      modifiers={[background("#0F4C75"), cornerRadius(18), paddingAll(16)]}
    >
      <Text color="#D9ECFA" style={{ fontSize: 12, fontWeight: "600" }}>TACOPLAN · JORNADA</Text>
      {props.active ? (
        <>
          <Text color="#FFFFFF" style={{ fontSize: 19, fontWeight: "700" }}>Disponibilidad</Text>
          <Text color="#FFFFFF" style={{ fontSize: 14, fontWeight: "600" }}>
            Límite 13 h · {remaining(props.deadline13At)}
          </Text>
          <Text color="#D9ECFA" style={{ fontSize: 12 }}>Hasta las {clock(props.deadline13At)}</Text>
          {props.show15 ? (
            <>
              <Text color="#FFFFFF" style={{ fontSize: 14, fontWeight: "600" }}>
                Límite 15 h · {remaining(props.deadline15At)}
              </Text>
              <Text color="#D9ECFA" style={{ fontSize: 12 }}>Hasta las {clock(props.deadline15At)}</Text>
            </>
          ) : null}
        </>
      ) : (
        <Text color="#FFFFFF" style={{ fontSize: 18, fontWeight: "700" }}>Sin jornada abierta</Text>
      )}
    </Column>
  );
};

export default createWidget<JornadaStatusProps>("JornadaStatus", JornadaStatusLayout, {
  active: false,
  deadline13At: new Date().toISOString(),
  deadline15At: new Date().toISOString(),
  show15: false,
});
