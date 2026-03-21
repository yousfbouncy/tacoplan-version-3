import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Modal,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import {
  crearJornadaCompleta,
  listarJornadas,
  eliminarJornada,
  type Jornada,
} from "@/lib/local-storage";
import { useSync } from "@/lib/sync-context";

interface SimulatorResult {
  type: "success" | "error";
  message: string;
}

function genId(): string {
  return "sim_" + Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

function dateStr(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function timeStr(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function isoAt(daysAgo: number, h: number, m: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

interface ScenarioConfig {
  label: string;
  icon: string;
  description: string;
  run: () => Promise<string>;
}

export default function DebugSimulator({ onDataChanged }: { onDataChanged?: () => void }) {
  const [visible, setVisible] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<SimulatorResult[]>([]);
  const { triggerSync } = useSync();

  const addResult = useCallback((r: SimulatorResult) => {
    setResults((prev) => [r, ...prev].slice(0, 20));
  }, []);

  const runScenario = useCallback(async (scenario: ScenarioConfig) => {
    setRunning(true);
    try {
      const msg = await scenario.run();
      addResult({ type: "success", message: `${scenario.label}: ${msg}` });
      triggerSync();
      onDataChanged?.();
    } catch (e: any) {
      addResult({ type: "error", message: `${scenario.label}: ${e.message}` });
    }
    setRunning(false);
  }, [addResult, triggerSync, onDataChanged]);

  const clearSimData = useCallback(async () => {
    Alert.alert(
      "Borrar datos simulados",
      "Se eliminarán todas las jornadas que empiecen con 'sim_'. ¿Continuar?",
      [
        { text: "Cancelar" },
        {
          text: "Borrar",
          style: "destructive",
          onPress: async () => {
            setRunning(true);
            try {
              const all = await listarJornadas();
              const simulated = all.filter((j: Jornada) => j.id.startsWith("sim_"));
              for (const j of simulated) {
                await eliminarJornada(j.id);
              }
              addResult({ type: "success", message: `Borradas ${simulated.length} jornadas simuladas` });
              triggerSync();
              onDataChanged?.();
            } catch (e: any) {
              addResult({ type: "error", message: `Error borrando: ${e.message}` });
            }
            setRunning(false);
          },
        },
      ]
    );
  }, [addResult, triggerSync, onDataChanged]);

  const scenarios: ScenarioConfig[] = [
    {
      label: "Nacional 100%",
      icon: "car-outline",
      description: "Jornada nacional con pernocta (dieta 100%)",
      run: async () => {
        const id = genId();
        await crearJornadaCompleta({
          id,
          fechaInicio: dateStr(3),
          horaInicio: timeStr(6, 0),
          lugarInicio: "Madrid",
          fechaFin: dateStr(3),
          horaFin: timeStr(18, 0),
          lugarFin: "Barcelona",
          conduccionMin: 480,
          tipoRuta: "NACIONAL",
          pernocta: true,
          observaciones: "[SIM] Nacional 100% pernocta",
        });
        return "Jornada nacional 100% creada";
      },
    },
    {
      label: "Nacional 60%",
      icon: "car-outline",
      description: "Jornada nacional sin pernocta (dieta 60%)",
      run: async () => {
        const id = genId();
        await crearJornadaCompleta({
          id,
          fechaInicio: dateStr(2),
          horaInicio: timeStr(7, 0),
          lugarInicio: "Valencia",
          fechaFin: dateStr(2),
          horaFin: timeStr(15, 0),
          lugarFin: "Alicante",
          conduccionMin: 300,
          tipoRuta: "NACIONAL",
          pernocta: false,
          observaciones: "[SIM] Nacional 60% sin pernocta",
        });
        return "Jornada nacional 60% creada";
      },
    },
    {
      label: "Internacional 100%",
      icon: "globe-outline",
      description: "Jornada internacional con pernocta (dieta 100%)",
      run: async () => {
        const id = genId();
        await crearJornadaCompleta({
          id,
          fechaInicio: dateStr(4),
          horaInicio: timeStr(5, 0),
          lugarInicio: "Barcelona",
          fechaFin: dateStr(4),
          horaFin: timeStr(19, 0),
          lugarFin: "Lyon, Francia",
          conduccionMin: 540,
          tipoRuta: "INTERNACIONAL",
          pernocta: true,
          observaciones: "[SIM] Internacional 100% pernocta",
        });
        return "Jornada internacional 100% creada";
      },
    },
    {
      label: "Internacional 60%",
      icon: "globe-outline",
      description: "Jornada internacional sin pernocta (dieta 60%)",
      run: async () => {
        const id = genId();
        await crearJornadaCompleta({
          id,
          fechaInicio: dateStr(1),
          horaInicio: timeStr(6, 30),
          lugarInicio: "Irun",
          fechaFin: dateStr(1),
          horaFin: timeStr(14, 30),
          lugarFin: "Burdeos, Francia",
          conduccionMin: 300,
          tipoRuta: "INTERNACIONAL",
          pernocta: false,
          observaciones: "[SIM] Internacional 60% sin pernocta",
        });
        return "Jornada internacional 60% creada";
      },
    },
    {
      label: "Regional (sin dieta)",
      icon: "navigate-outline",
      description: "Jornada regional corta sin dieta",
      run: async () => {
        const id = genId();
        await crearJornadaCompleta({
          id,
          fechaInicio: dateStr(1),
          horaInicio: timeStr(8, 0),
          lugarInicio: "Getafe",
          fechaFin: dateStr(1),
          horaFin: timeStr(12, 0),
          lugarFin: "Alcala de Henares",
          conduccionMin: 120,
          tipoRuta: "REGIONAL",
          pernocta: false,
          observaciones: "[SIM] Regional sin dieta",
        });
        return "Jornada regional creada";
      },
    },
    {
      label: "Con Extras (Sab/Dom)",
      icon: "sunny-outline",
      description: "Jornada en sábado con extras de día",
      run: async () => {
        const id = genId();
        const now = new Date();
        let targetDay = new Date(now);
        const dayOfWeek = now.getDay();
        const daysUntilSat = dayOfWeek <= 6 ? (6 - dayOfWeek + 7) % 7 || 7 : 1;
        targetDay.setDate(now.getDate() - daysUntilSat);

        const fInicio = targetDay.toISOString().slice(0, 10);
        await crearJornadaCompleta({
          id,
          fechaInicio: fInicio,
          horaInicio: timeStr(6, 0),
          lugarInicio: "Madrid",
          fechaFin: fInicio,
          horaFin: timeStr(18, 0),
          lugarFin: "Sevilla",
          conduccionMin: 480,
          tipoRuta: "NACIONAL",
          pernocta: true,
          observaciones: "[SIM] Nacional sabado con extras",
        });
        return `Jornada sabado (${fInicio}) creada`;
      },
    },
    {
      label: "Ferry Completo (interrupciones)",
      icon: "boat-outline",
      description: "Puerto 3h → interrupción 20min embarque → 2h dentro → interrupción 30min desembarque → 5h puerto destino",
      run: async () => {
        const id = genId();
        const dayOffset = 3;
        await crearJornadaCompleta({
          id,
          fechaInicio: dateStr(dayOffset),
          horaInicio: timeStr(6, 0),
          lugarInicio: "Algeciras",
          fechaFin: dateStr(dayOffset),
          horaFin: timeStr(14, 0),
          lugarFin: "Puerto Algeciras",
          conduccionMin: 360,
          tipoRuta: "INTERNACIONAL",
          pernocta: true,
          observaciones: "[SIM] Ferry completo con interrupciones: 3h puerto → 20min embarque → 2h navegando → 30min desembarque → 5h puerto destino",
          ferryPending: false,
          ferryRestCompleted: true,
          ferryRestType: "11h",
          ferryDestination: "Tanger Med, Marruecos",
          ferryExtras: { transitDiet: 1, cabinOvernight: 1, countryChange: true },
          ferryInterruptions: [
            { start: isoAt(dayOffset, 17, 0), end: isoAt(dayOffset, 17, 20) },
            { start: isoAt(dayOffset, 19, 20), end: isoAt(dayOffset, 19, 50) },
          ],
        });
        return "Ferry completo creado: 3h puerto + embarque 20min + 2h navegando + desembarque 30min + 5h destino";
      },
    },
    {
      label: "Ferry 8h + Jornada Algeciras-Agadir",
      icon: "boat-outline",
      description: "Descanso ferry 8h con interrupciones 20min, seguido de jornada nueva Algeciras → Agadir",
      run: async () => {
        const id1 = genId();
        const dayOffset = 2;
        await crearJornadaCompleta({
          id: id1,
          fechaInicio: dateStr(dayOffset),
          horaInicio: timeStr(5, 0),
          lugarInicio: "Algeciras",
          fechaFin: dateStr(dayOffset),
          horaFin: timeStr(13, 0),
          lugarFin: "Puerto Algeciras",
          conduccionMin: 360,
          tipoRuta: "INTERNACIONAL",
          pernocta: true,
          observaciones: "[SIM] Jornada pre-ferry con descanso 8h + interrupciones 20min",
          ferryPending: false,
          ferryRestCompleted: true,
          ferryRestType: "9h",
          ferryDestination: "Tanger Med, Marruecos",
          ferryExtras: { transitDiet: 1, cabinOvernight: 1, countryChange: true },
          ferryInterruptions: [
            { start: isoAt(dayOffset, 14, 0), end: isoAt(dayOffset, 14, 20) },
            { start: isoAt(dayOffset, 18, 0), end: isoAt(dayOffset, 18, 20) },
          ],
        });

        await new Promise((r) => setTimeout(r, 200));

        const id2 = genId();
        const nextDay = dayOffset - 1;
        await crearJornadaCompleta({
          id: id2,
          fechaInicio: dateStr(nextDay),
          horaInicio: timeStr(6, 0),
          lugarInicio: "Tanger Med",
          fechaFin: dateStr(nextDay),
          horaFin: timeStr(18, 0),
          lugarFin: "Agadir",
          conduccionMin: 540,
          tipoRuta: "INTERNACIONAL",
          pernocta: true,
          observaciones: "[SIM] Jornada post-ferry Tanger Med → Agadir",
        });
        return "Ferry 8h + jornada Algeciras-Agadir creadas (2 jornadas)";
      },
    },
    {
      label: "Semana completa",
      icon: "calendar-outline",
      description: "5 jornadas de lunes a viernes",
      run: async () => {
        const created: string[] = [];
        const routes = [
          { from: "Madrid", to: "Zaragoza", tipo: "NACIONAL", mins: 360 },
          { from: "Zaragoza", to: "Barcelona", tipo: "NACIONAL", mins: 300 },
          { from: "Barcelona", to: "Perpignan", tipo: "INTERNACIONAL", mins: 420 },
          { from: "Perpignan", to: "Barcelona", tipo: "INTERNACIONAL", mins: 420 },
          { from: "Barcelona", to: "Madrid", tipo: "NACIONAL", mins: 480 },
        ];

        for (let i = 0; i < 5; i++) {
          const daysAgo = 10 - i;
          const r = routes[i];
          const id = genId();
          await crearJornadaCompleta({
            id,
            fechaInicio: dateStr(daysAgo),
            horaInicio: timeStr(6, 0),
            lugarInicio: r.from,
            fechaFin: dateStr(daysAgo),
            horaFin: timeStr(6 + Math.floor(r.mins / 60), r.mins % 60),
            lugarFin: r.to,
            conduccionMin: r.mins,
            tipoRuta: r.tipo,
            pernocta: true,
            observaciones: `[SIM] Semana dia ${i + 1}`,
          });
          created.push(dateStr(daysAgo));
        }
        return `5 jornadas creadas (${created[0]} a ${created[4]})`;
      },
    },
  ];

  return (
    <>
      <Pressable
        onPress={() => setVisible(true)}
        style={styles.fab}
      >
        <Ionicons name="bug-outline" size={24} color="#fff" />
      </Pressable>

      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setVisible(false)}
      >
        <View style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Simulador de Pruebas</Text>
            <Pressable onPress={() => setVisible(false)} hitSlop={12}>
              <Ionicons name="close-circle" size={28} color={Colors.light.textSecondary} />
            </Pressable>
          </View>

          <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 100 }}>
            <Text style={styles.sectionTitle}>Crear Jornadas</Text>
            <Text style={styles.sectionDesc}>
              Cada escenario crea una jornada cerrada con datos realistas. Los resultados se reflejan en Historial y Dietas.
            </Text>

            {scenarios.map((s, i) => (
              <Pressable
                key={i}
                style={({ pressed }) => [styles.scenarioBtn, pressed && styles.pressed]}
                onPress={() => runScenario(s)}
                disabled={running}
              >
                <View style={styles.scenarioIcon}>
                  <Ionicons name={s.icon as any} size={22} color={Colors.light.tint} />
                </View>
                <View style={styles.scenarioText}>
                  <Text style={styles.scenarioLabel}>{s.label}</Text>
                  <Text style={styles.scenarioDesc}>{s.description}</Text>
                </View>
                {running ? (
                  <ActivityIndicator size="small" color={Colors.light.tint} />
                ) : (
                  <Ionicons name="play-circle" size={28} color={Colors.light.tint} />
                )}
              </Pressable>
            ))}

            <View style={styles.divider} />

            <Text style={styles.sectionTitle}>Herramientas</Text>

            <Pressable
              style={({ pressed }) => [styles.toolBtn, pressed && styles.pressed]}
              onPress={clearSimData}
              disabled={running}
            >
              <Ionicons name="trash-outline" size={20} color={Colors.light.danger} />
              <Text style={[styles.toolLabel, { color: Colors.light.danger }]}>
                Borrar jornadas simuladas
              </Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.toolBtn, pressed && styles.pressed]}
              onPress={() => {
                triggerSync();
                addResult({ type: "success", message: "Sincronización manual forzada" });
              }}
              disabled={running}
            >
              <Ionicons name="cloud-upload-outline" size={20} color={Colors.light.tint} />
              <Text style={[styles.toolLabel, { color: Colors.light.tint }]}>
                Forzar sincronización
              </Text>
            </Pressable>

            {results.length > 0 && (
              <>
                <View style={styles.divider} />
                <Text style={styles.sectionTitle}>Resultados</Text>
                {results.map((r, i) => (
                  <View key={i} style={[styles.resultItem, r.type === "error" && styles.resultError]}>
                    <Ionicons
                      name={r.type === "success" ? "checkmark-circle" : "alert-circle"}
                      size={16}
                      color={r.type === "success" ? Colors.light.success : Colors.light.danger}
                    />
                    <Text style={styles.resultText} numberOfLines={2}>{r.message}</Text>
                  </View>
                ))}
              </>
            )}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    bottom: 100,
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.light.tint,
    justifyContent: "center",
    alignItems: "center",
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    zIndex: 999,
  },
  modal: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
    marginBottom: 4,
    marginTop: 8,
  },
  sectionDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    marginBottom: 12,
  },
  scenarioBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.light.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    gap: 12,
  },
  pressed: {
    opacity: 0.7,
  },
  scenarioIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.light.accentLight,
    justifyContent: "center",
    alignItems: "center",
  },
  scenarioText: {
    flex: 1,
  },
  scenarioLabel: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
  },
  scenarioDesc: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.light.border,
    marginVertical: 16,
  },
  toolBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: Colors.light.surface,
    borderRadius: 12,
    marginBottom: 8,
  },
  toolLabel: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  resultItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: Colors.light.surface,
    borderRadius: 8,
    marginBottom: 4,
  },
  resultError: {
    backgroundColor: "#FEE2E2",
  },
  resultText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.light.text,
  },
});
