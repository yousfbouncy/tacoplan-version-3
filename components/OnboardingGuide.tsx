import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  Dimensions,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import Colors from "@/constants/colors";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const SUPPORT_WHATSAPP_URL = "https://wa.me/34656365216";
const SCREENSHOT_MAX_WIDTH = SCREEN_WIDTH > 480 ? 348 : SCREEN_WIDTH - 72;
const SCREENSHOT_MAX_HEIGHT = Math.min(Math.max(SCREEN_HEIGHT * 0.42, 280), 420);

type ScreenshotItem = {
  source: number;
  title?: string;
  notes?: string[];
};

type Step = {
  id: string;
  icon: string;
  iconFamily: "ionicons" | "mci";
  accent: string;
  title: string;
  description: string;
  screenshots?: ScreenshotItem[];
  actionLabel?: string;
  actionUrl?: string;
};

const STEPS: Step[] = [
  {
    id: "welcome",
    icon: "hand-wave-outline",
    iconFamily: "mci",
    accent: Colors.light.tint,
    title: "Bienvenido a Tacoplan",
    description: "Tacoplan te ayuda a controlar jornadas, conduccion, descansos, dietas, historial y estimacion de nomina desde una sola app.",
    screenshots: [
      {
        source: require("../assets/tutorial/pantalla-inicio.jpeg"),
        title: "Pantalla principal",
        notes: [
          "Desde aqui entras a registrar jornada, revisar historial, dietas y la estimacion de nomina.",
          "En la cabecera tienes acceso rapido al tutorial, soporte y notificaciones.",
        ],
      },
    ],
  },
  {
    id: "reference_prices",
    icon: "pricetag-outline",
    iconFamily: "ionicons",
    accent: Colors.light.success,
    title: "Precios de referencia",
    description: "Configuralos al principio porque Tacoplan usa esos importes para calcular dietas, extras y una estimacion de nomina mucho mas realista.",
    screenshots: [
      {
        source: require("../assets/tutorial/precios-de-referencia.jpeg"),
        title: "Que debes apuntar",
        notes: [
          "Introduce los importes reales que te paga la empresa o marca tu convenio.",
          "Rellena los conceptos que uses de verdad: hora ordinaria, extras, nocturnidad, pluses o similares.",
          "Actualizalos cuando cambie tu empresa o tus condiciones para no desajustar dietas y nomina.",
        ],
      },
    ],
  },
  {
    id: "start_jornada",
    icon: "play-circle-outline",
    iconFamily: "ionicons",
    accent: Colors.light.accent,
    title: "Registrar una jornada",
    description: "Empieza una jornada cada dia indicando fecha, hora y lugar. Ese paso es la base para que todos los calculos automaticos sean fiables.",
    screenshots: [
      {
        source: require("../assets/tutorial/inicio-jornada.jpeg"),
        title: "Inicio de jornada",
        notes: [
          "Marca la fecha correcta del servicio.",
          "Apunta la hora real de comienzo, no una aproximada.",
          "Rellena el lugar de inicio o la base si el formulario lo pide.",
          "Comprueba que no tengas una jornada anterior abierta antes de guardar.",
        ],
      },
      {
        source: require("../assets/tutorial/plan-inicio-jornada.jpeg"),
        title: "Planificacion inicial",
        notes: [
          "Anota la actividad prevista si vas a conducir, estar disponible o hacer otros trabajos.",
          "Deja reflejado el tipo de servicio para que luego el resumen y el historial se entiendan bien.",
          "Guarda solo cuando el bloque inicial quede revisado.",
        ],
      },
    ],
  },
  {
    id: "close_jornada",
    icon: "stop-circle-outline",
    iconFamily: "ionicons",
    accent: Colors.light.descansoSemanal,
    title: "Cerrar una jornada",
    description: "Cuando termines, cierra la jornada con la hora de fin y los datos finales. Asi la app puede calcular descanso, conduccion y dietas correctamente.",
    screenshots: [
      {
        source: require("../assets/tutorial/fin-de-jornada.jpeg"),
        title: "Fin de jornada",
        notes: [
          "Marca la hora real de finalizacion.",
          "Apunta los datos finales del dia, como kilometros, observaciones o incidencias, si aparecen en tu formulario.",
          "Revisa antes de cerrar que no falte ninguna pausa o tramo relevante.",
        ],
      },
      {
        source: require("../assets/tutorial/plan-descanso.jpeg"),
        title: "Descanso y cierre",
        notes: [
          "Indica el descanso realizado o lo que queda pendiente si esta pantalla te lo solicita.",
          "Marca disponibilidad u otros trabajos si todavia no los habias anotado.",
          "Cierra la jornada solo cuando el total del dia cuadre con lo que realmente has hecho.",
        ],
      },
    ],
  },
  {
    id: "summary_history_diets",
    icon: "receipt-outline",
    iconFamily: "ionicons",
    accent: Colors.light.internacional,
    title: "Resumen, historial y dietas",
    description: "Consulta el resumen diario, revisa el historial y comprueba las dietas calculadas para ver rapido lo que has trabajado y generado.",
    screenshots: [
      {
        source: require("../assets/tutorial/historial.jpeg"),
        title: "Historial y resumen",
        notes: [
          "Usa esta vista para comprobar que cada jornada se ha guardado correctamente.",
          "Entra en un dia concreto si necesitas corregir horas, descansos o cualquier tramo.",
        ],
      },
      {
        source: require("../assets/tutorial/dietas.jpeg"),
        title: "Dietas calculadas",
        notes: [
          "Revisa el importe generado y el tipo de dieta asignado.",
          "Comprueba si hay pernocta, internacional u otros conceptos antes de dar el calculo por bueno.",
        ],
      },
    ],
  },
  {
    id: "payroll_settings",
    icon: "wallet-outline",
    iconFamily: "ionicons",
    accent: Colors.light.tint,
    title: "Estimacion de nomina",
    description: "Ajusta la configuracion de estimacion de nomina y los importes para que el calculo se adapte a tu forma real de cobro.",
    screenshots: [
      {
        source: require("../assets/tutorial/estimcion-nomina.jpeg"),
        title: "Configuracion de nomina",
        notes: [
          "Rellena los importes base y los complementos que realmente cobras.",
          "Ajusta extras, pluses y dietas para que la estimacion no se quede corta ni inflada.",
          "Revisa esta pantalla cada vez que cambien tus condiciones o tu convenio.",
        ],
      },
    ],
  },
  {
    id: "support",
    icon: "logo-whatsapp",
    iconFamily: "ionicons",
    accent: "#25D366",
    title: "¿Necesitas ayuda?",
    description: "Si tienes dudas sobre configuracion, jornadas, dietas o estimacion de nomina, puedes escribirnos por WhatsApp al final del tutorial o desde la cabecera.",
    actionLabel: "Contactar por WhatsApp",
    actionUrl: SUPPORT_WHATSAPP_URL,
  },
];

type Props = {
  visible: boolean;
  onClose: () => void;
};

function getScreenshotAspectRatio(source: number): number {
  const resolver = (Image as typeof Image & {
    resolveAssetSource?: (asset: number) => { width?: number; height?: number } | null;
  }).resolveAssetSource;

  if (typeof resolver === "function") {
    const asset = resolver(source);
    if (asset?.width && asset?.height) {
      return asset.width / asset.height;
    }
  }

  return 9 / 19.5;
}

async function openExternalUrl(url: string | undefined) {
  if (!url) return;
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) return;
    await Linking.openURL(url);
  } catch {}
}

function PhonePreview({ children }: { children: ReactNode }) {
  return (
    <View style={styles.phoneShell}>
      <View style={styles.phoneTopBar}>
        <View style={styles.phoneDynamicIsland} />
      </View>
      <View style={styles.phoneContent}>{children}</View>
    </View>
  );
}

function PreviewHeader({ title }: { title: string }) {
  return (
    <View style={styles.previewHeader}>
      <Text style={styles.previewHeaderTitle}>{title}</Text>
      <Ionicons name="ellipsis-horizontal" size={16} color={Colors.light.textSecondary} />
    </View>
  );
}

function renderPreview(step: Step) {
  if (step.screenshots?.length) {
    return (
      <View style={styles.screenshotStack}>
        {step.screenshots.map((screenshot, index) => {
          const aspectRatio = getScreenshotAspectRatio(screenshot.source);
          const estimatedHeight = SCREENSHOT_MAX_WIDTH / aspectRatio;
          const frameHeight = Math.min(Math.max(estimatedHeight, 220), SCREENSHOT_MAX_HEIGHT);

          return (
            <View key={`${step.id}-${index}`} style={styles.screenshotCard}>
              {screenshot.title ? <Text style={styles.screenshotTitle}>{screenshot.title}</Text> : null}
              <View style={[styles.screenshotFrame, { height: frameHeight }]}>
                <Image source={screenshot.source} style={styles.screenshotImage} resizeMode="contain" />
              </View>
              {screenshot.notes?.length ? (
                <View style={styles.noteList}>
                  {screenshot.notes.map((note) => (
                    <View key={note} style={styles.noteRow}>
                      <View style={[styles.noteBullet, { backgroundColor: step.accent }]} />
                      <Text style={styles.noteText}>{note}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    );
  }

  switch (step.id) {
    case "support":
      return (
        <PhonePreview>
          <PreviewHeader title="Ayuda" />
          <View style={styles.supportCard}>
            <Ionicons name="logo-whatsapp" size={34} color="#25D366" />
            <Text style={styles.supportTitle}>Soporte directo</Text>
            <Text style={styles.supportText}>Escribenos por WhatsApp para resolver dudas de uso o configuracion.</Text>
          </View>
        </PhonePreview>
      );
    default:
      return (
        <PhonePreview>
          <PreviewHeader title="Tacoplan" />
          <View style={styles.welcomeGrid}>
            <View style={styles.welcomeItem}>
              <Ionicons name="car-outline" size={18} color={Colors.light.tint} />
              <Text style={styles.welcomeItemText}>Jornadas</Text>
            </View>
            <View style={styles.welcomeItem}>
              <Ionicons name="time-outline" size={18} color={Colors.light.tint} />
              <Text style={styles.welcomeItemText}>Descansos</Text>
            </View>
            <View style={styles.welcomeItem}>
              <Ionicons name="cash-outline" size={18} color={Colors.light.tint} />
              <Text style={styles.welcomeItemText}>Dietas</Text>
            </View>
            <View style={styles.welcomeItem}>
              <Ionicons name="wallet-outline" size={18} color={Colors.light.tint} />
              <Text style={styles.welcomeItemText}>Nomina</Text>
            </View>
          </View>
          <View style={styles.mockListCard}>
            <Text style={styles.mockListRow}>Control diario de actividad</Text>
            <Text style={styles.mockListRow}>Calculos automaticos</Text>
            <Text style={styles.mockListRow}>Avisos y recordatorios</Text>
          </View>
        </PhonePreview>
      );
  }
}

export default function OnboardingGuide({ visible, onClose }: Props) {
  const [currentStep, setCurrentStep] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const step = STEPS[currentStep];
  const isLast = currentStep === STEPS.length - 1;
  const progressLabel = useMemo(() => `${currentStep + 1}/${STEPS.length}`, [currentStep]);
  const IconComponent = step.iconFamily === "mci" ? MaterialCommunityIcons : Ionicons;

  const goToStep = (nextStep: number) => {
    setCurrentStep(nextStep);
    scrollRef.current?.scrollTo({ x: 0, y: 0, animated: false });
  };

  const handleSkip = () => {
    goToStep(0);
    onClose();
  };

  const handleNext = () => {
    if (isLast) {
      handleSkip();
      return;
    }
    goToStep(currentStep + 1);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleSkip}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Pressable onPress={handleSkip} hitSlop={12}>
              <Text style={styles.skipText}>Omitir</Text>
            </Pressable>
            <Text style={styles.progressText}>{progressLabel}</Text>
          </View>

          <View style={styles.progressRow}>
            {STEPS.map((_, index) => (
              <View
                key={index}
                style={[
                  styles.progressDot,
                  index === currentStep && styles.progressDotActive,
                  index < currentStep && styles.progressDotDone,
                ]}
              />
            ))}
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.heroCircle, { backgroundColor: `${step.accent}18` }]}>
              <IconComponent name={step.icon as any} size={54} color={step.accent} />
            </View>

            {renderPreview(step)}

            <Text style={styles.title}>{step.title}</Text>
            <Text style={styles.description}>{step.description}</Text>

            {step.actionLabel && step.actionUrl ? (
              <Pressable style={styles.whatsAppButton} onPress={() => openExternalUrl(step.actionUrl)}>
                <Ionicons name="logo-whatsapp" size={18} color="#FFFFFF" />
                <Text style={styles.whatsAppButtonText}>{step.actionLabel}</Text>
              </Pressable>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable style={styles.secondaryButton} onPress={handleSkip}>
              <Text style={styles.secondaryButtonText}>Omitir</Text>
            </Pressable>
            <Pressable style={styles.primaryButton} onPress={handleNext}>
              <Text style={styles.primaryButtonText}>{isLast ? "Finalizar" : "Siguiente"}</Text>
              {!isLast ? <Ionicons name="chevron-forward" size={18} color="#FFFFFF" /> : null}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  container: {
    width: "100%",
    maxWidth: SCREEN_WIDTH > 480 ? 420 : SCREEN_WIDTH - 24,
    backgroundColor: Colors.light.surface,
    borderRadius: 24,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 22,
    elevation: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
  },
  skipText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  progressText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: Colors.light.textSecondary,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  progressDot: {
    flex: 1,
    height: 6,
    borderRadius: 999,
    backgroundColor: Colors.light.border,
  },
  progressDotActive: {
    backgroundColor: Colors.light.tint,
  },
  progressDotDone: {
    backgroundColor: `${Colors.light.tint}7A`,
  },
  scrollArea: {
    maxHeight: SCREEN_WIDTH < 380 ? 520 : 600,
  },
  scrollContent: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 28,
  },
  screenshotStack: {
    width: "100%",
    gap: 18,
    marginBottom: 24,
  },
  screenshotCard: {
    width: "100%",
    gap: 12,
  },
  screenshotTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    color: Colors.light.text,
  },
  screenshotFrame: {
    width: "100%",
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#D1D5DB",
    padding: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 6,
  },
  screenshotImage: {
    width: "100%",
    height: "100%",
    borderRadius: 20,
  },
  noteList: {
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 14,
    gap: 10,
  },
  noteRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  noteBullet: {
    width: 8,
    height: 8,
    borderRadius: 999,
    marginTop: 7,
    flexShrink: 0,
  },
  noteText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 21,
    color: Colors.light.textSecondary,
  },
  heroCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
    marginTop: 8,
  },
  phoneShell: {
    width: "100%",
    borderRadius: 28,
    backgroundColor: "#0F172A",
    padding: 8,
    marginBottom: 24,
  },
  phoneTopBar: {
    alignItems: "center",
    paddingTop: 6,
    paddingBottom: 10,
  },
  phoneDynamicIsland: {
    width: 88,
    height: 22,
    borderRadius: 999,
    backgroundColor: "#020617",
  },
  phoneContent: {
    borderRadius: 22,
    backgroundColor: "#F8FAFC",
    padding: 14,
    gap: 10,
    minHeight: 248,
  },
  previewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  previewHeaderTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 15,
    color: Colors.light.text,
  },
  mockCard: {
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    padding: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    gap: 4,
  },
  mockCardTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: Colors.light.textSecondary,
  },
  mockPrice: {
    fontFamily: "Inter_700Bold",
    fontSize: 24,
    color: Colors.light.text,
  },
  mockRow: {
    flexDirection: "row",
    gap: 8,
  },
  mockInput: {
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    gap: 4,
  },
  mockLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: Colors.light.textSecondary,
  },
  mockValue: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: Colors.light.text,
  },
  mockPrimaryButton: {
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: Colors.light.tint,
    alignItems: "center",
    justifyContent: "center",
  },
  mockPrimaryButtonText: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
    color: "#FFFFFF",
  },
  mockAlertCard: {
    borderRadius: 16,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
    padding: 14,
    gap: 4,
  },
  mockAlertTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
    color: "#1D4ED8",
  },
  mockAlertText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: "#1E40AF",
  },
  mockMetricCard: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    padding: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    gap: 4,
  },
  mockMetricLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: Colors.light.textSecondary,
  },
  mockMetricValue: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
    color: Colors.light.text,
  },
  mockListCard: {
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    padding: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    gap: 8,
  },
  mockListRow: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: Colors.light.text,
  },
  supportCard: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#DCFCE7",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    gap: 8,
  },
  supportTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    color: Colors.light.text,
  },
  supportText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 20,
    color: Colors.light.textSecondary,
    textAlign: "center",
  },
  welcomeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  welcomeItem: {
    width: "47%",
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: "center",
    gap: 6,
  },
  welcomeItemText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    color: Colors.light.text,
  },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 26,
    lineHeight: 30,
    textAlign: "center",
    color: Colors.light.text,
    marginBottom: 12,
  },
  description: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    lineHeight: 23,
    textAlign: "center",
    color: Colors.light.textSecondary,
    marginBottom: 20,
  },
  whatsAppButton: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: "#25D366",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 18,
    alignSelf: "stretch",
  },
  whatsAppButtonText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: "#FFFFFF",
  },
  footer: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: Colors.light.textSecondary,
  },
  primaryButton: {
    flex: 1.2,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: Colors.light.tint,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  primaryButtonText: {
    fontFamily: "Inter_700Bold",
    fontSize: 15,
    color: "#FFFFFF",
  },
});
