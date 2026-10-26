import { HStack, Text, VStack } from "@expo/ui/swift-ui";
import { font, foregroundStyle, padding } from "@expo/ui/swift-ui/modifiers";
import { createLiveActivity, createWidget } from "expo-widgets";
import type { JornadaStatusProps } from "./JornadaStatus.android";

const JornadaStatusLayout = (props: JornadaStatusProps, environment: any) => {
  "widget";
  const deadline13 = new Date(props.deadline13At);
  const deadline15 = new Date(props.deadline15At);
  const isCompact = environment.widgetFamily === "accessoryInline" || environment.widgetFamily === "accessoryCircular";
  if (!props.active) {
    return (
      <VStack spacing={4} modifiers={[padding({ all: 12 })]}>
        <Text modifiers={[font({ size: 12, weight: "semibold" }), foregroundStyle("#0F4C75")]}>TACOPLAN</Text>
        <Text modifiers={[font({ size: 16, weight: "bold" }), foregroundStyle("#1A1A2E")]}>Sin jornada abierta</Text>
      </VStack>
    );
  }
  if (isCompact) {
    return <Text date={deadline13} dateStyle="timer" modifiers={[font({ size: 15, weight: "bold" }), foregroundStyle("#0F4C75")]} />;
  }
  return (
    <VStack spacing={7} modifiers={[padding({ all: 14 })]}>
      <Text modifiers={[font({ size: 11, weight: "semibold" }), foregroundStyle("#D6E9F8")]}>TACOPLAN · DISPONIBILIDAD</Text>
      <HStack spacing={8}>
        <Text modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle("#FFFFFF")]}>Límite 13 h</Text>
        <Text date={deadline13} dateStyle="timer" modifiers={[font({ size: 19, weight: "bold" }), foregroundStyle("#FFFFFF")]} />
      </HStack>
      <Text date={deadline13} dateStyle="time" modifiers={[font({ size: 12 }), foregroundStyle("#D6E9F8")]} />
      {props.show15 ? (
        <HStack spacing={8}>
          <Text modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle("#FFFFFF")]}>Límite 15 h</Text>
          <Text date={deadline15} dateStyle="timer" modifiers={[font({ size: 19, weight: "bold" }), foregroundStyle("#FFFFFF")]} />
        </HStack>
      ) : null}
    </VStack>
  );
};

const JornadaLiveActivityLayout = (props: JornadaStatusProps) => {
  "widget";
  const banner = (
    <HStack spacing={10} modifiers={[padding({ all: 12 })]}>
      <VStack spacing={4}>
        <Text modifiers={[font({ size: 12, weight: "semibold" }), foregroundStyle("#D6E9F8")]}>TACOPLAN · DISPONIBILIDAD</Text>
        <HStack spacing={8}>
          <Text modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle("#FFFFFF")]}>13 h</Text>
          <Text date={new Date(props.deadline13At)} dateStyle="timer" modifiers={[font({ size: 17, weight: "bold" }), foregroundStyle("#FFFFFF")]} />
        </HStack>
        {props.show15 ? (
          <HStack spacing={8}>
            <Text modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle("#FFFFFF")]}>15 h</Text>
            <Text date={new Date(props.deadline15At)} dateStyle="timer" modifiers={[font({ size: 17, weight: "bold" }), foregroundStyle("#FFFFFF")]} />
          </HStack>
        ) : null}
      </VStack>
    </HStack>
  );
  return {
    banner,
    bannerSmall: banner,
    compactLeading: <Text modifiers={[font({ size: 11, weight: "semibold" }), foregroundStyle("#FFFFFF")]}>Tacoplan</Text>,
    compactTrailing: <Text date={new Date(props.deadline13At)} dateStyle="timer" modifiers={[font({ size: 13, weight: "bold" }), foregroundStyle("#FFFFFF")]} />,
    minimal: <Text modifiers={[font({ size: 11, weight: "bold" }), foregroundStyle("#FFFFFF")]}>T</Text>,
    expandedCenter: banner,
    expandedBottom: props.show15 ? <Text date={new Date(props.deadline15At)} dateStyle="timer" modifiers={[font({ size: 15, weight: "bold" }), foregroundStyle("#FFFFFF")]}>15 h · </Text> : undefined,
  };
};

export const JornadaLiveActivity = createLiveActivity<JornadaStatusProps>("JornadaStatus", JornadaLiveActivityLayout);

export async function syncJourneyLiveActivity(props: JornadaStatusProps) {
  const instances = JornadaLiveActivity.getInstances();
  if (!props.active) {
    await Promise.all(instances.map((instance) => instance.end("immediate").catch(() => {})));
    return;
  }
  const staleDate = new Date(props.deadline15At);
  if (instances[0]) {
    await instances[0].update(props, staleDate).catch(() => {});
    await Promise.all(instances.slice(1).map((instance) => instance.end("immediate").catch(() => {})));
  } else {
    try { await JornadaLiveActivity.start(props, "tacoplan://", staleDate); } catch {}
  }
}
