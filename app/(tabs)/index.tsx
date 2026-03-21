import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  Platform,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Switch,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { useI18n } from "@/lib/i18n-context";
import OnboardingGuide from "@/components/OnboardingGuide";
import DebugSimulator from "@/components/DebugSimulator";
import { useFerry } from "@/lib/ferry-context";
import {
  addMoroccoTrip,
  getJornadaAbierta,
  crearJornadaInicio,
  cerrarJornada,
  getEstadoLegal,
  marcarTodasCompensadas,
  calcDietaWithCustomRates,
  calcDietaManualWithRates,
  calcDayExtra,
  detectDayFlag,
  getLastLugarFin,
  getRecentPlaces,
  addRecentPlace,
  type Jornada,
  type EstadoLegal,
  type CompensacionAgregada,
  listarJornadas,
  listarCompensaciones,
  updateJornadaPlannedRest,
  updateJornadaFerryData,
  getFerryInterruptionsTotalMin,
  getFerryEffectiveRestMin,
  type LegalSummaryStored,
  type UserDietRate,
  type UserDayExtras,
  type PlusItem,
  type FerryExtras,
  type FerryInterruption,
  addFerryRest,
} from "@/lib/local-storage";
import {
  todayStr,
  nowTimeStr,
  formatFecha,
  formatMinutosHoras,
  isSpainSummerTime,
  detectCrossSundayMonday,
} from "@/lib/utils";
import {
  getLegalStatusColor,
  getLegalStatusLabel,
  getSeverityColor,
  getSeverityLabel,
  buildLegalPreview,
  computeLegalPlan,
  formatDateTimeES,
  type LegalPreview,
  type LegalPlan,
} from "@/lib/legalEngine";
import { useAuth } from "@/lib/auth-context";
import { useSync } from "@/lib/sync-context";
import { getApiUrl } from "@/lib/query-client";
import AsyncStorage from "@react-native-async-storage/async-storage";

type TipoRuta = "NACIONAL" | "INTERNACIONAL" | "REGIONAL_INTL" | "NAC_INTL" | "NAC_REGIONAL" | "NINGUNO" | "REGIONAL";

const LOCALE_MAP: Record<string, string> = { es: "es-ES", en: "en-GB", ar: "ar-SA", fr: "fr-FR" };

function formatSyncTime(isoStr: string, t: (key: string) => string, locale: string = "es"): string {
  try {
    const d = new Date(isoStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return t("common.now");
    if (diffMin < 60) return `${t("dashboard.syncAgo")} ${diffMin} ${t("dashboard.syncMin")}`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${t("dashboard.syncAgo")} ${diffH}h`;
    const diffD = Math.floor(diffH / 24);
    if (diffD === 1) return t("common.yesterday");
    if (diffD < 7) return `${t("dashboard.syncAgo")} ${diffD} ${t("common.daysAgo")}`;
    return d.toLocaleDateString(LOCALE_MAP[locale] || "es-ES", { day: "2-digit", month: "short" });
  } catch {
    return "";
  }
}

function ProgressBar({ value, max, color, bgColor }: { value: number; max: number; color: string; bgColor: string }) {
  const pct = Math.min(value / max, 1);
  return (
    <View style={[styles.progressBg, { backgroundColor: bgColor }]}>
      <View style={[styles.progressFill, { width: `${pct * 100}%` as any, backgroundColor: color }]} />
    </View>
  );
}

function AlertBanner({ tipo, mensaje }: { tipo: string; mensaje: string }) {
  const bg = tipo === "danger" ? "#FEE2E2" : tipo === "warning" ? "#FEF3C7" : "#DBEAFE";
  const color = tipo === "danger" ? "#DC2626" : tipo === "warning" ? "#D97706" : "#2563EB";
  const icon = tipo === "danger" ? "alert-circle" : tipo === "warning" ? "warning" : "information-circle";
  return (
    <View style={[styles.alertBanner, { backgroundColor: bg }]}>
      <Ionicons name={icon as any} size={18} color={color} />
      <Text style={[styles.alertText, { color }]}>{mensaje}</Text>
    </View>
  );
}

function parseDrivingInputToMinutes(text: string): { minutes: number | null; error: string | null } {
  const cleaned = text.trim();
  if (!cleaned) return { minutes: null, error: null };
  if (cleaned.includes(":")) {
    const parts = cleaned.split(":");
    if (parts.length !== 2) return { minutes: null, error: "common.invalidFormat" };
    const h = parseInt(parts[0]);
    const m = parseInt(parts[1]);
    if (isNaN(h) || isNaN(m)) return { minutes: null, error: "common.invalidFormat" };
    if (m < 0 || m > 59) return { minutes: null, error: "common.minutesRange" };
    const total = h * 60 + m;
    if (total < 0) return { minutes: null, error: "common.invalidFormat" };
    return { minutes: total, error: null };
  }
  const normalized = cleaned.replace(",", ".");
  const num = parseFloat(normalized);
  if (isNaN(num)) return { minutes: null, error: "common.invalidFormat" };
  const total = Math.round(num * 60);
  if (total < 0) return { minutes: null, error: "common.invalidFormat" };
  return { minutes: total, error: null };
}

function buildIsoTimestamp(fecha: string, hora: string) { return `${fecha}T${hora}:00`; }

function PlaceSuggestions({
  places,
  filter,
  onSelect,
}: {
  places: string[];
  filter: string;
  onSelect: (place: string) => void;
}) {
  const filtered = places.filter((p) =>
    p.toLowerCase().includes(filter.toLowerCase())
  );
  if (filtered.length === 0) return null;
  return (
    <View style={suggestionStyles.container}>
      {filtered.map((place, i) => (
        <Pressable
          key={i}
          style={({ pressed }) => [
            suggestionStyles.item,
            pressed && { backgroundColor: Colors.light.background },
            i < filtered.length - 1 && suggestionStyles.itemBorder,
          ]}
          onPressIn={() => onSelect(place)}
        >
          <Ionicons name="time-outline" size={14} color={Colors.light.textSecondary} style={{ marginRight: 8 }} />
          <Text style={suggestionStyles.text} numberOfLines={1}>{place}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const suggestionStyles = StyleSheet.create({
  container: {
    position: "absolute" as const,
    top: "100%" as any,
    left: 0,
    right: 0,
    backgroundColor: Colors.light.surface,
    borderRadius: 10,
    maxHeight: 150,
    zIndex: 999,
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    borderWidth: 1,
    borderColor: Colors.light.border,
    marginTop: 2,
  },
  item: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  itemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  text: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.light.text,
    flex: 1,
  },
});

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const qc = useQueryClient();
  const { user, isGuest, logout, getAccessToken } = useAuth();
  const { t, locale } = useI18n();
  const {
    triggerSync, syncStatus, lastSyncTime, hasPending,
    showRecoveryPrompt, isRestoring, restoreProgress,
    restoreComplete, restoreResult, startRestore,
    dismissRecovery, dismissRestoreComplete, refreshSyncInfo,
    syncVersion,
  } = useSync();

  const [inicioFecha, setInicioFecha] = useState(todayStr());
  const [inicioHora, setInicioHora] = useState(nowTimeStr());
  const [inicioLugar, setInicioLugar] = useState("");

  const [finFecha, setFinFecha] = useState(todayStr());
  const [finHora, setFinHora] = useState(nowTimeStr());
  const [finLugar, setFinLugar] = useState("");
  const [tipoRuta, setTipoRuta] = useState<TipoRuta>("NACIONAL");
  const [conduccionHoras, setConduccionHoras] = useState("");
  const [conduccionDomingoHoras, setConduccionDomingoHoras] = useState("");
  const [conduccionLunesHoras, setConduccionLunesHoras] = useState("");
  const conduccionParsed = useMemo(() => parseDrivingInputToMinutes(conduccionHoras), [conduccionHoras]);
  const conduccionDomingoParsed = useMemo(() => parseDrivingInputToMinutes(conduccionDomingoHoras), [conduccionDomingoHoras]);
  const conduccionLunesParsed = useMemo(() => parseDrivingInputToMinutes(conduccionLunesHoras), [conduccionLunesHoras]);
  const [pernocta, setPernocta] = useState(false);
  const [dietaModo, setDietaModo] = useState<"AUTO" | "MANUAL">("AUTO");
  const [manualTipo, setManualTipo] = useState<"NACIONAL" | "INTERNACIONAL">("INTERNACIONAL");
  const [manualPct, setManualPct] = useState<"100" | "60" | "30">("100");
  const [dietaPercent, setDietaPercent] = useState<number>(100);
  const [dayFlag, setDayFlag] = useState<string>("");

  const [moroccoRouteType, setMoroccoRouteType] = useState<"NACIONAL" | "INTERNACIONAL" | "NINGUNA">("NACIONAL");
  const [moroccoPernocta, setMoroccoPernocta] = useState(false);
  const [moroccoDayExtras, setMoroccoDayExtras] = useState<{ saturday: boolean; sunday: boolean; holiday: boolean }>({ saturday: false, sunday: false, holiday: false });

  const [showInicioForm, setShowInicioForm] = useState(false);
  const [showFinForm, setShowFinForm] = useState(false);

  const [showOnboarding, setShowOnboarding] = useState(false);
  const [legalResult, setLegalResult] = useState<LegalSummaryStored | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const { config: ferryConfig, isFerryRestMode, isMoroccoMode } = useFerry();
  const [showLegalModal, setShowLegalModal] = useState(false);
  const [showStartPlan, setShowStartPlan] = useState(false);
  const [startPlanData, setStartPlanData] = useState<LegalPlan | null>(null);
  const [chosenRest, setChosenRest] = useState<number | null>(null);
  const [closedJornadaId, setClosedJornadaId] = useState<string | null>(null);
  const [closePlanData, setClosePlanData] = useState<LegalPlan | null>(null);
  const [ferryJustClosed, setFerryJustClosed] = useState<Jornada | null>(null);

  const [plusItems, setPlusItems] = useState<PlusItem[]>([]);
  const [plusConcepto, setPlusConcepto] = useState("");
  const [plusImporte, setPlusImporte] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [ferryEmbarking, setFerryEmbarking] = useState(false);
  const [ferryRestTypeChoice, setFerryRestTypeChoice] = useState<"9h" | "11h">("11h");
  const [showFerryFinishModal, setShowFerryFinishModal] = useState(false);
  const [ferryFinishEndDate, setFerryFinishEndDate] = useState("");
  const [ferryFinishEndTime, setFerryFinishEndTime] = useState("");

  const [customRates, setCustomRates] = useState<UserDietRate[] | null>(null);
  const [dayExtras, setDayExtras] = useState<UserDayExtras>({ extra_saturday: 10, extra_sunday: 15, extra_holiday: 20 });
  const [userHolidays, setUserHolidays] = useState<string[]>([]);

  const [recentPlaces, setRecentPlaces] = useState<string[]>([]);
  const [showInicioSuggestions, setShowInicioSuggestions] = useState(false);
  const [showFinSuggestions, setShowFinSuggestions] = useState(false);

  const loadUserConfig = useCallback(async () => {
    try {
      const local = await AsyncStorage.getItem("tacoplan_user_settings");
      if (local) {
        const s = JSON.parse(local);
        const pf = (v: any, fb: number) => { const n = parseFloat(v); return isNaN(n) ? fb : n; };
        const rates: UserDietRate[] = [
          { trip_type: "NACIONAL", percent: 100, amount: pf(s.nac_100, 54.30) },
          { trip_type: "NACIONAL", percent: 60, amount: pf(s.nac_60, 32.58) },
          { trip_type: "NACIONAL", percent: 30, amount: pf(s.nac_30, 16.29) },
          { trip_type: "INTERNACIONAL", percent: 100, amount: pf(s.intl_100, 72.77) },
          { trip_type: "INTERNACIONAL", percent: 60, amount: pf(s.intl_60, 43.66) },
          { trip_type: "INTERNACIONAL", percent: 30, amount: pf(s.intl_30, 21.83) },
          { trip_type: "REGIONAL", percent: 100, amount: pf(s.reg_100, 0) },
          { trip_type: "REGIONAL", percent: 60, amount: pf(s.reg_60, 0) },
          { trip_type: "REGIONAL", percent: 30, amount: pf(s.reg_30, 0) },
        ];
        setCustomRates(rates);
        setDayExtras({
          extra_saturday: pf(s.extra_saturday, 10),
          extra_sunday: pf(s.extra_sunday, 15),
          extra_holiday: pf(s.extra_holiday, 20),
        });
      }
    } catch (e) {
      console.log("Failed to load local settings:", e);
    }

    if (isGuest || !user) return;
    try {
      const token = await getAccessToken();
      if (!token) return;
      const base = getApiUrl();
      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

      const [ratesRes, extrasRes, holidaysRes] = await Promise.all([
        fetch(new URL("/api/user/diet-rates", base).toString(), { headers }),
        fetch(new URL("/api/user/day-extras", base).toString(), { headers }),
        fetch(new URL("/api/user/holidays", base).toString(), { headers }),
      ]);

      if (ratesRes.ok) {
        const d = await ratesRes.json();
        if (d.rates && d.rates.length > 0) setCustomRates(d.rates);
      }
      if (extrasRes.ok) {
        const d = await extrasRes.json();
        const ex = d.extras;
        if (ex) {
          const pn = (v: any, fb: number) => { const n = Number(v); return isNaN(n) ? fb : n; };
          setDayExtras({
            extra_saturday: pn(ex.extra_saturday, 10),
            extra_sunday: pn(ex.extra_sunday, 15),
            extra_holiday: pn(ex.extra_holiday, 20),
          });
        }
      }
      if (holidaysRes.ok) {
        const d = await holidaysRes.json();
        setUserHolidays((d.holidays || []).map((h: any) => h.date));
      }
    } catch (e) {
      console.log("Failed to load user config:", e);
    }
  }, [isGuest, user, getAccessToken]);


  useFocusEffect(
    useCallback(() => {
      loadUserConfig();
      AsyncStorage.getItem("tacoplan_onboarded").then((val) => {
        setShowOnboarding(val !== "true");
      });
      getRecentPlaces().then(setRecentPlaces);
      getJornadaAbierta().then((abierta) => {
        if (!abierta) {
          getLastLugarFin().then((lugar) => {
            if (lugar) {
              setInicioLugar((prev) => (prev === "" ? lugar : prev));
            }
          });
        }
      });
    }, [loadUserConfig])
  );

  const dismissOnboarding = useCallback(async () => {
    await AsyncStorage.setItem("tacoplan_onboarded", "true");
    setShowOnboarding(false);
  }, []);

  const openGuideAndDismiss = useCallback(async () => {
    await AsyncStorage.setItem("tacoplan_onboarded", "true");
    setShowOnboarding(false);
    setShowGuide(true);
  }, []);

  const dietaPreview = useMemo(() => {
    let result: { items: any[]; total: number };
    if (dietaModo === "MANUAL") {
      result = calcDietaManualWithRates(manualTipo, manualPct, customRates);
    } else {
      result = calcDietaWithCustomRates(tipoRuta, pernocta, dietaPercent, customRates);
    }
    const resolvedFlag = dayFlag === "NINGUNO" ? null : (dayFlag || detectDayFlag(finFecha, userHolidays));
    const extra = calcDayExtra(resolvedFlag, dayExtras);
    return { base: result.total, extra, total: result.total + extra, flag: resolvedFlag, items: result.items };
  }, [tipoRuta, pernocta, dietaPercent, dietaModo, manualTipo, manualPct, customRates, dayExtras, dayFlag, finFecha, userHolidays]);

  const moroccoPernightPreview = useMemo(() => {
    if (!isMoroccoMode || ferryConfig.paymentMode !== "morocco_pernight") return null;
    let dietBase = 0;
    if (moroccoRouteType !== "NINGUNA") {
      const pct = moroccoPernocta ? 100 : 60;
      const r = calcDietaWithCustomRates(moroccoRouteType as any, moroccoPernocta, pct, customRates);
      dietBase = r.total;
    }
    let extraTotal = 0;
    if (moroccoDayExtras.saturday) extraTotal += dayExtras.extra_saturday || 0;
    if (moroccoDayExtras.sunday) extraTotal += dayExtras.extra_sunday || 0;
    if (moroccoDayExtras.holiday) extraTotal += dayExtras.extra_holiday || 0;
    return { dietBase, extraTotal, total: dietBase + extraTotal };
  }, [isMoroccoMode, ferryConfig.paymentMode, moroccoRouteType, moroccoPernocta, moroccoDayExtras, customRates, dayExtras]);

  const abiertaQuery = useQuery<Jornada | null>({
    queryKey: ["jornada-abierta", syncVersion],
    queryFn: () => getJornadaAbierta(),
  });

  const estadoQuery = useQuery<EstadoLegal>({
    queryKey: ["estado-legal", syncVersion],
    queryFn: () => getEstadoLegal(),
  });

  const legalPreviewQuery = useQuery<LegalPreview>({
    queryKey: ["legal-preview", syncVersion],
    queryFn: async () => {
      const allJ = await listarJornadas();
      const allC = await listarCompensaciones();
      return buildLegalPreview(allJ, allC);
    },
  });
  const legalPreview = legalPreviewQuery.data;

  const abierta = ferryJustClosed ? null : abiertaQuery.data;
  const estado = estadoQuery.data;

  const isCrossSundayMonday = useMemo(() => {
    if (!abierta) return false;
    let resolvedFechaFin = finFecha;
    if (resolvedFechaFin === abierta.fechaInicio && finHora < abierta.horaInicio) {
      const d = new Date(resolvedFechaFin + "T12:00:00");
      d.setDate(d.getDate() + 1);
      resolvedFechaFin = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    }
    return detectCrossSundayMonday(abierta.fechaInicio, resolvedFechaFin);
  }, [abierta?.fechaInicio, abierta?.horaInicio, finFecha, finHora]);

  const crossWeekTimeLabel = useMemo(() => {
    if (!abierta) return "01:00";
    const isSummer = isSpainSummerTime(abierta.fechaInicio);
    return isSummer ? "02:00" : "01:00";
  }, [abierta?.fechaInicio]);

  const drivingWarningInfo = useMemo(() => {
    if (!estado) return null;
    const totalMin = isCrossSundayMonday
      ? (conduccionDomingoParsed.minutes || 0) + (conduccionLunesParsed.minutes || 0)
      : conduccionParsed.minutes;
    if (totalMin == null || totalMin === 0) return null;
    const extensionsAvailable = estado.maxExtensiones - estado.extensiones10h;
    const weeklyRemainMin = estado.restanteSemanalMin;
    const biweeklyRemainMin = estado.restanteBisemanalMin;
    const maxDailyMin = extensionsAvailable > 0 ? 600 : 540;
    const maxDailyLabel = extensionsAvailable > 0 ? "10h" : "9h";
    const warnings: Array<{ type: "infraction" | "warning"; message: string }> = [];
    if (totalMin > maxDailyMin) {
      const excessMin = totalMin - maxDailyMin;
      const msg = t("dashboard.drivingInfraction")
        .replace("{max}", maxDailyLabel)
        .replace("{excess}", formatMinutosHoras(excessMin));
      warnings.push({ type: "infraction", message: msg });
    } else if (totalMin > 540 && extensionsAvailable > 0) {
      const msg = t("dashboard.drivingWarning")
        .replace("{used}", String(estado.extensiones10h + 1));
      warnings.push({ type: "warning", message: msg });
    }
    if (weeklyRemainMin < 0) {
      warnings.push({ type: "infraction", message: `${t("dashboard.weekly")}: +${formatMinutosHoras(Math.abs(weeklyRemainMin) + totalMin)}` });
    } else if (totalMin > weeklyRemainMin) {
      const excessMin = totalMin - weeklyRemainMin;
      warnings.push({ type: "infraction", message: `${t("dashboard.weekly")}: +${formatMinutosHoras(excessMin)} (${formatMinutosHoras(weeklyRemainMin)} ${t("dashboard.remaining").toLowerCase()})` });
    }
    if (biweeklyRemainMin < 0) {
      warnings.push({ type: "infraction", message: `${t("dashboard.biweekly")}: +${formatMinutosHoras(Math.abs(biweeklyRemainMin) + totalMin)}` });
    } else if (totalMin > biweeklyRemainMin) {
      const excessMin = totalMin - biweeklyRemainMin;
      warnings.push({ type: "infraction", message: `${t("dashboard.biweekly")}: +${formatMinutosHoras(excessMin)} (${formatMinutosHoras(biweeklyRemainMin)} ${t("dashboard.remaining").toLowerCase()})` });
    }
    return warnings.length > 0 ? warnings : null;
  }, [conduccionParsed.minutes, conduccionDomingoParsed.minutes, conduccionLunesParsed.minutes, isCrossSundayMonday, estado, t]);

  const lastClosedQuery = useQuery<Jornada | null>({
    queryKey: ["last-closed", syncVersion],
    queryFn: async () => {
      const allJ = await listarJornadas();
      const closed = allJ.filter(j => j.fechaFin && j.endAt);
      if (closed.length === 0) return null;
      closed.sort((a, b) => (b.endAt || "").localeCompare(a.endAt || ""));
      const result = closed[0];
      console.log("[lastClosedQuery] id=", result.id, "ferryPending=", result.ferryPending, "ferryRestCompleted=", result.ferryRestCompleted, "endAt=", result.endAt);
      return result;
    },
  });
  const lastClosedRaw = lastClosedQuery.data;
  useEffect(() => {
    if (ferryJustClosed && lastClosedRaw && lastClosedRaw.id === ferryJustClosed.id) {
      if (lastClosedRaw.ferryPending && lastClosedRaw.ferryRestCompleted) {
        setFerryJustClosed(null);
      }
    }
  }, [lastClosedRaw?.id, lastClosedRaw?.ferryPending, lastClosedRaw?.ferryRestCompleted, ferryJustClosed]);
  const lastClosed = useMemo(() => {
    if (ferryJustClosed && lastClosedRaw && lastClosedRaw.id === ferryJustClosed.id) {
      return {
        ...lastClosedRaw,
        ferryPending: true,
        ferryRestCompleted: lastClosedRaw.ferryRestCompleted ?? false,
        ferryRestType: lastClosedRaw.ferryRestType || ferryJustClosed.ferryRestType,
        ferryInterruptions: lastClosedRaw.ferryInterruptions ?? ferryJustClosed.ferryInterruptions ?? [],
        ferryExtras: lastClosedRaw.ferryExtras ?? ferryJustClosed.ferryExtras,
        ferryDestination: lastClosedRaw.ferryDestination ?? ferryJustClosed.ferryDestination,
      };
    }
    if (lastClosedRaw?.ferryPending) {
      return lastClosedRaw;
    }
    if (ferryJustClosed?.ferryPending && !ferryJustClosed.ferryRestCompleted) {
      console.log("[Ferry Panel] Using ferryJustClosed fallback, id=", ferryJustClosed.id);
      return ferryJustClosed;
    }
    return lastClosedRaw;
  }, [lastClosedRaw, ferryJustClosed]);

  const [countdownNow, setCountdownNow] = useState(Date.now());
  useEffect(() => {
    const needsCountdown = (lastClosed?.plannedRestMin && lastClosed?.endAt) || lastClosed?.ferryPending;
    if (!needsCountdown) return;
    const tickMs = lastClosed?.ferryPending ? 1000 : 30000;
    const interval = setInterval(() => setCountdownNow(Date.now()), tickMs);
    return () => clearInterval(interval);
  }, [lastClosed?.plannedRestMin, lastClosed?.endAt, lastClosed?.ferryPending]);

  const [ferryTransitDiet, setFerryTransitDiet] = useState(0);
  const [ferryCabinOvernight, setFerryCabinOvernight] = useState(0);
  const [ferryCountryChange, setFerryCountryChange] = useState(false);
  const [ferryDestination, setFerryDestination] = useState("");

  useEffect(() => {
    if (lastClosed?.ferryPending && lastClosed.ferryExtras) {
      setFerryTransitDiet(lastClosed.ferryExtras.transitDiet || 0);
      setFerryCabinOvernight(lastClosed.ferryExtras.cabinOvernight || 0);
      setFerryCountryChange(lastClosed.ferryExtras.countryChange || false);
    }
    if (lastClosed?.ferryPending && lastClosed.ferryDestination) {
      setFerryDestination(lastClosed.ferryDestination);
    }
  }, [lastClosed?.id, lastClosed?.ferryPending]);

  const invalidateAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["jornada-abierta"] });
    qc.invalidateQueries({ queryKey: ["estado-legal"] });
    qc.invalidateQueries({ queryKey: ["legal-preview"] });
    qc.invalidateQueries({ queryKey: ["last-closed"] });
  }, [qc]);

  const inicioMutation = useMutation({
    mutationFn: async () => {
      return crearJornadaInicio({
        fechaInicio: inicioFecha,
        horaInicio: inicioHora,
        lugarInicio: inicioLugar,
      });
    },
    onSuccess: async (newJornada: Jornada) => {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setFerryJustClosed(null);
      setInicioLugar("");
      invalidateAll();
      triggerSync();
      const allJ = await listarJornadas();
      const allC = await listarCompensaciones();
      const plan = computeLegalPlan(allJ, allC, {
        startAt: newJornada.startAt,
        descansoAnteriorMin: newJornada.descansoAnteriorMin,
        tipoDescansoAnterior: newJornada.tipoDescansoAnterior,
      }, locale);
      setStartPlanData(plan);
      setShowStartPlan(true);
    },
    onError: (e: Error) => {
      Alert.alert(t("common.error"), e.message);
    },
  });

  const cierreMutation = useMutation({
    mutationFn: async () => {
      const abierta = abiertaQuery.data;
      if (!abierta) throw new Error(t("dashboard.noOpenJornada"));
      const body: any = {
        fechaFin: finFecha,
        horaFin: finHora,
        lugarFin: finLugar,
        tipoRuta,
        pernocta,
        dietaModo,
        dietaPercent,
        dayFlag: dayFlag || undefined,
        customRates: customRates || undefined,
        dayExtras: dayExtras || undefined,
        holidays: userHolidays,
      };
      if (isCrossSundayMonday && conduccionDomingoParsed.minutes != null && conduccionLunesParsed.minutes != null) {
        body.conduccionDomingoMin = conduccionDomingoParsed.minutes;
        body.conduccionLunesMin = conduccionLunesParsed.minutes;
        body.conduccionMin = conduccionDomingoParsed.minutes + conduccionLunesParsed.minutes;
      } else if (conduccionParsed.minutes != null) {
        body.conduccionMin = conduccionParsed.minutes;
      }
      if (dietaModo === "MANUAL") {
        body.dietaManualTipo = manualTipo;
        body.dietaManualPct = manualPct;
      }
      if (isMoroccoMode && ferryConfig.paymentMode === "morocco_pernight") {
        body.tipoRuta = moroccoRouteType === "NINGUNA" ? "NINGUNO" : moroccoRouteType;
        body.pernocta = moroccoPernocta;
        body.dayFlag = "NINGUNO";
        if (moroccoDayExtras.saturday) body.dayFlag = "SABADO";
        if (moroccoDayExtras.sunday) body.dayFlag = "DOMINGO";
        if (moroccoDayExtras.holiday) body.dayFlag = "FESTIVO";
        body.moroccoPaymentMode = "morocco_pernight";
        body.moroccoPernightRate = ferryConfig.pernightRate;
      }
      if (isMoroccoMode && ferryConfig.paymentMode === "morocco_trip") {
        body.moroccoPaymentMode = "morocco_trip";
        body.moroccoTripRate = ferryConfig.tripRate;
      }
      if (isMoroccoMode && ferryConfig.paymentMode === "morocco_diet") {
        body.moroccoPaymentMode = "morocco_diet";
      }
      if (plusItems.length > 0) {
        body.plusItems = plusItems;
      }
      if (observaciones.trim()) {
        body.observaciones = observaciones.trim();
      }
      if (ferryEmbarking) {
        body.ferryPending = true;
        body.ferryRestType = ferryRestTypeChoice;
        console.log("[Ferry Close] ferryEmbarking=true, adding ferryPending to body, restType:", ferryRestTypeChoice);
      }
      const result = await cerrarJornada(abierta.id, body);
      console.log("[Ferry Close] cerrarJornada result: ferryPending=", result.ferryPending, "ferryRestCompleted=", result.ferryRestCompleted, "endAt=", result.endAt);
      return result;
    },
    onSuccess: async (closed: Jornada) => {
      console.log("[Ferry Close] onSuccess: ferryPending=", closed.ferryPending, "ferryRestCompleted=", closed.ferryRestCompleted);
      if (closed.ferryPending) {
        setFerryJustClosed(closed);
        console.log("[Ferry Close] setFerryJustClosed with id=", closed.id);
      }
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (closed.lugarInicio) addRecentPlace(closed.lugarInicio);
      if (closed.lugarFin) addRecentPlace(closed.lugarFin);
      getRecentPlaces().then(setRecentPlaces);
      setFinLugar("");
      setConduccionHoras("");
      setConduccionDomingoHoras("");
      setConduccionLunesHoras("");
      setPlusItems([]);
      setPlusConcepto("");
      setPlusImporte("");
      setObservaciones("");
      setShowFinForm(false);
      setClosedJornadaId(closed.id);

      if (closed.legalSummary) {
        setLegalResult(closed.legalSummary);
        const allJ = await listarJornadas();
        const allC = await listarCompensaciones();
        const plan = computeLegalPlan(allJ, allC, {
          startAt: closed.startAt,
          endAt: closed.endAt || undefined,
          conduccionMin: closed.conduccionMin || undefined,
          duracionJornadaMin: closed.duracionJornadaMin || undefined,
          descansoAnteriorMin: closed.descansoAnteriorMin,
          tipoDescansoAnterior: closed.tipoDescansoAnterior,
        }, locale);
        setClosePlanData(plan);
        setChosenRest(null);
        setShowLegalModal(true);
      }
      invalidateAll();
      triggerSync();
    },
    onError: (e: Error) => {
      Alert.alert(t("common.error"), e.message);
    },
  });

  const compensarMutation = useMutation({
    mutationFn: () => marcarTodasCompensadas(),
    onSuccess: () => {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      invalidateAll();
      triggerSync();
    },
  });

  const isLoading = abiertaQuery.isLoading;

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={abiertaQuery.isRefetching || estadoQuery.isRefetching}
            onRefresh={invalidateAll}
            tintColor={Colors.light.tint}
          />
        }
      >
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <MaterialCommunityIcons name="steering" size={28} color={Colors.light.tint} />
            <Text style={styles.headerTitle}>Tacoplan</Text>
            <View style={{ flex: 1 }} />
            {!isGuest && user && (
              <Pressable
                onPress={() => triggerSync()}
                hitSlop={8}
                style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
              >
                {hasPending && syncStatus !== "syncing" && (
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.light.accent }} />
                )}
                {syncStatus === "syncing" ? (
                  <ActivityIndicator size="small" color={Colors.light.tint} />
                ) : syncStatus === "synced" ? (
                  <Ionicons name="cloud-done-outline" size={22} color={Colors.light.success} />
                ) : syncStatus === "error" ? (
                  <Ionicons name="cloud-offline-outline" size={22} color={Colors.light.danger} />
                ) : syncStatus === "offline" ? (
                  <Ionicons name="cloud-offline-outline" size={22} color={Colors.light.textSecondary} />
                ) : (
                  <Ionicons name="cloud-done-outline" size={22} color={Colors.light.tint} />
                )}
              </Pressable>
            )}
            <Pressable
              onPress={() => {
                if (isGuest) {
                  Alert.alert(t("dashboard.account"), t("dashboard.guestAlertMsg"), [
                    { text: "OK" },
                    { text: t("dashboard.logoutLabel"), onPress: logout },
                  ]);
                } else {
                  Alert.alert(t("dashboard.account"), user?.email || "", [
                    { text: "OK" },
                    { text: t("dashboard.logoutLabel"), style: "destructive", onPress: logout },
                  ]);
                }
              }}
              hitSlop={8}
              style={{ marginLeft: 12 }}
            >
              <Ionicons name="person-circle-outline" size={24} color={isGuest ? Colors.light.textSecondary : Colors.light.tint} />
            </Pressable>
          </View>
          <Text style={styles.headerSubtitle}>{t("login.appDesc")}</Text>
          {!isGuest && user && lastSyncTime && (
            <View style={styles.syncInfoRow}>
              <Ionicons name="time-outline" size={12} color={Colors.light.textSecondary} />
              <Text style={styles.syncInfoText}>
                {t("dashboard.syncSaved")} {formatSyncTime(lastSyncTime, t, locale)}
              </Text>
              {hasPending && (
                <View style={styles.syncPendingBadge}>
                  <Text style={styles.syncPendingText}>{t("dashboard.syncUnsaved")}</Text>
                </View>
              )}
            </View>
          )}
        </View>

        {showOnboarding && (
          <View style={styles.onboardingCard}>
            <View style={styles.onboardingHeader}>
              <MaterialCommunityIcons name="hand-wave" size={22} color={Colors.light.tint} />
              <Text style={styles.onboardingTitle}>{t("dashboard.welcome")}</Text>
              <Pressable onPress={dismissOnboarding} hitSlop={8}>
                <Ionicons name="close" size={20} color={Colors.light.textSecondary} />
              </Pressable>
            </View>
            <Text style={styles.onboardingText}>
              {t("dashboard.welcomeText")}
            </Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                style={styles.onboardingBtn}
                onPress={openGuideAndDismiss}
              >
                <Ionicons name="book-outline" size={16} color="#fff" />
                <Text style={styles.onboardingBtnText}>{t("guide.openGuide")}</Text>
              </Pressable>
              <Pressable
                style={[styles.onboardingBtn, { backgroundColor: Colors.light.textSecondary }]}
                onPress={() => {
                  dismissOnboarding();
                  router.push("/(tabs)/usuario");
                }}
              >
                <Ionicons name="settings-outline" size={16} color="#fff" />
                <Text style={styles.onboardingBtnText}>{t("dashboard.goToConfig")}</Text>
              </Pressable>
            </View>
          </View>
        )}

        {estado && estado.alertas.length > 0 && (
          <View style={styles.alertSection}>
            {estado.alertas.map((a, i) => (
              <AlertBanner key={i} tipo={a.tipo} mensaje={a.mensaje} />
            ))}
          </View>
        )}

        {isMoroccoMode && ferryConfig.paymentMode === "morocco_trip" && (
          <Pressable
            style={({ pressed }) => [styles.ferryDashCard, { opacity: pressed ? 0.95 : 1 }]}
            onPress={async () => {
              try {
                await addMoroccoTrip({
                  fecha: todayStr(),
                  origen: "",
                  destino: "",
                  estado: "completo",
                  importe: ferryConfig.tripRate,
                });
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                Alert.alert(t("morocco.tripSaved"), `${ferryConfig.tripRate.toFixed(2)} €`);
              } catch (e) {
                Alert.alert("Error", String(e));
              }
            }}
          >
            <View style={styles.ferryDashHeader}>
              <Ionicons name="airplane-outline" size={18} color={Colors.light.tint} />
              <Text style={styles.ferryDashTitle}>{t("ferry.dashboard.addMoroccoTrip")}</Text>
            </View>
            <Text style={styles.ferryDashEmpty}>
              {t("ferry.tripRate")}: {ferryConfig.tripRate.toFixed(2)} €
            </Text>
          </Pressable>
        )}

        {isMoroccoMode && ferryConfig.paymentMode === "morocco_pernight" && (
          <Pressable
            style={({ pressed }) => [styles.ferryDashCard, { opacity: pressed ? 0.95 : 1 }]}
            onPress={async () => {
              try {
                await addMoroccoTrip({
                  fecha: todayStr(),
                  origen: "",
                  destino: "",
                  estado: "pernocta",
                  importe: ferryConfig.pernightRate,
                });
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                Alert.alert(t("morocco.pernightSaved"), `${ferryConfig.pernightRate.toFixed(2)} €`);
              } catch (e) {
                Alert.alert("Error", String(e));
              }
            }}
          >
            <View style={styles.ferryDashHeader}>
              <Ionicons name="bed-outline" size={18} color={Colors.light.tint} />
              <Text style={styles.ferryDashTitle}>{t("ferry.dashboard.addPernight")}</Text>
            </View>
            <Text style={styles.ferryDashEmpty}>
              {t("ferry.pernightRate")}: {ferryConfig.pernightRate.toFixed(2)} €
            </Text>
          </Pressable>
        )}

        {isLoading ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color={Colors.light.tint} />
          </View>
        ) : !abierta ? (
          <>
          {!showInicioForm ? (
            <Pressable
              style={({ pressed }) => [styles.bigActionBtn, styles.bigActionBtnStart, { opacity: pressed ? 0.9 : 1 }]}
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setInicioFecha(todayStr());
                setInicioHora(nowTimeStr());
                setShowInicioForm(true);
              }}
            >
              <View style={styles.bigActionIcon}>
                <Ionicons name="play" size={22} color={Colors.light.success} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.bigActionTitle}>{t("dashboard.startJornada")}</Text>
                <Text style={styles.bigActionSub}>{t("dashboard.tapToStart")}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={Colors.light.textSecondary} />
            </Pressable>
          ) : (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Ionicons name="play-circle" size={22} color={Colors.light.success} />
                <Text style={styles.cardTitle}>{t("dashboard.startTitle")}</Text>
                <View style={{ flex: 1 }} />
                <Pressable onPress={() => setShowInicioForm(false)} hitSlop={8}>
                  <Ionicons name="close" size={20} color={Colors.light.textSecondary} />
                </Pressable>
              </View>
              <View style={styles.fieldRow}>
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>{t("common.date")}</Text>
                  <TextInput
                    style={styles.input}
                    value={inicioFecha}
                    onChangeText={setInicioFecha}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#9CA3AF"
                  />
                </View>
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>{t("common.time")}</Text>
                  <TextInput
                    style={styles.input}
                    value={inicioHora}
                    onChangeText={setInicioHora}
                    placeholder="HH:MM"
                    placeholderTextColor="#9CA3AF"
                  />
                </View>
              </View>
              <View style={[styles.field, { zIndex: 10 }]}>
                <Text style={styles.fieldLabel}>{t("common.place")}</Text>
                <View style={{ position: "relative" as const }}>
                  <TextInput
                    style={styles.input}
                    value={inicioLugar}
                    onChangeText={(v) => { setInicioLugar(v); setShowInicioSuggestions(true); }}
                    onFocus={() => setShowInicioSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowInicioSuggestions(false), 200)}
                    placeholder={t("dashboard.cityBase")}
                    placeholderTextColor="#9CA3AF"
                  />
                  {showInicioSuggestions && recentPlaces.length > 0 && (
                    <PlaceSuggestions
                      places={recentPlaces}
                      filter={inicioLugar}
                      onSelect={(p) => { setInicioLugar(p); setShowInicioSuggestions(false); }}
                    />
                  )}
                </View>
              </View>
              <Pressable
                style={({ pressed }) => [
                  styles.btnPrimary,
                  { opacity: pressed ? 0.85 : 1 },
                  (!inicioLugar.trim() || inicioMutation.isPending) && styles.btnDisabled,
                ]}
                onPress={() => {
                  inicioMutation.mutate();
                  setShowInicioForm(false);
                }}
                disabled={!inicioLugar.trim() || inicioMutation.isPending}
              >
                {inicioMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={20} color="#fff" />
                    <Text style={styles.btnText}>{t("dashboard.saveStart")}</Text>
                  </>
                )}
              </Pressable>
            </View>
          )}

          {(() => { if (lastClosed) console.log("[Ferry Panel Check] ferryPending=", lastClosed.ferryPending, "ferryRestCompleted=", lastClosed.ferryRestCompleted, "endAt=", !!lastClosed.endAt); return null; })()}
          {lastClosed?.ferryPending && !lastClosed.ferryRestCompleted && lastClosed.endAt && (() => {
            const _tick = countdownNow;
            const endMs = new Date(lastClosed.endAt!).getTime();
            const ints = lastClosed.ferryInterruptions || [];
            let intTotalMs = 0;
            for (const ii of ints) {
              if (!ii.start) continue;
              const iEnd = ii.end ? new Date(ii.end).getTime() : _tick;
              intTotalMs += Math.max(0, iEnd - new Date(ii.start).getTime());
            }
            const intTotalMin = Math.round(intTotalMs / 60000);
            const elapsedMin = Math.max(0, (_tick - endMs) / 60000);
            const effectiveMin = Math.round(Math.max(0, elapsedMin - intTotalMin));
            const requiredMin = lastClosed.ferryRestType === "9h" ? 540 : 660;
            const ferryComplete = effectiveMin >= requiredMin;
            const remainEffective = Math.max(0, requiredMin - effectiveMin);
            const remainH = Math.floor(remainEffective / 60);
            const remainM = remainEffective % 60;
            const progress = Math.min(1, Math.max(0, effectiveMin / requiredMin));
            const openInt = (lastClosed.ferryInterruptions || []).find(i => i.end === null);
            const closedIntCount = (lastClosed.ferryInterruptions || []).filter(i => i.end !== null).length;
            const intCount = closedIntCount + (openInt ? 1 : 0);
            const restLabel = lastClosed.ferryRestType === "9h" ? t("ferry.9hReduced") : t("ferry.11hNormal");
            const startDate = new Date(lastClosed.endAt!);
            const startHH = String(startDate.getHours()).padStart(2, "0");
            const startMM = String(startDate.getMinutes()).padStart(2, "0");
            const startDD = String(startDate.getDate()).padStart(2, "0");
            const startMo = String(startDate.getMonth() + 1).padStart(2, "0");
            const ferryStartLabel = `${startDD}/${startMo} ${startHH}:${startMM}`;
            const accumH = Math.floor(effectiveMin / 60);
            const accumM = effectiveMin % 60;
            return (
              <View style={[styles.card, { marginBottom: 16, borderColor: Colors.light.tint, borderWidth: 1 }]}>
                <View style={styles.cardHeader}>
                  <MaterialCommunityIcons name="ferry" size={22} color={ferryComplete ? Colors.light.success : Colors.light.tint} />
                  <Text style={styles.cardTitle}>{t("ferry.ferryRest")} ({restLabel})</Text>
                </View>
                <View style={{ flexDirection: "row" as const, alignItems: "center" as const, gap: 6, paddingHorizontal: 16, paddingBottom: 6 }}>
                  <Ionicons name="time-outline" size={14} color={Colors.light.textSecondary} />
                  <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary }}>
                    {t("ferry.restStarted") || "Inicio descanso"}: {ferryStartLabel}
                  </Text>
                </View>

                {ferryComplete && (
                  <View style={{ flexDirection: "row" as const, alignItems: "center" as const, gap: 8, marginBottom: 8 }}>
                    <Ionicons name="checkmark-circle" size={24} color={Colors.light.success} />
                    <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.light.success }}>{t("ferry.restComplete")}</Text>
                  </View>
                )}

                <View style={{ alignItems: "center" as const, paddingVertical: 10 }}>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 32, color: openInt ? Colors.light.warning : (ferryComplete ? Colors.light.success : Colors.light.tint) }}>
                    {ferryComplete ? `${accumH}h ${accumM}m` : `${remainH}h ${remainM > 0 ? `${remainM}m` : ""}`}
                  </Text>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.light.textSecondary, marginTop: 2 }}>
                    {ferryComplete ? t("ferry.restComplete") : (openInt ? t("ferry.interruptionActive") : t("dashboard.restRemaining"))}
                  </Text>
                </View>
                <View style={[styles.progressBg, { backgroundColor: Colors.light.border, height: 6 }]}>
                  <View style={[styles.progressFill, { width: `${progress * 100}%` as any, backgroundColor: ferryComplete ? Colors.light.success : (openInt ? Colors.light.warning : Colors.light.tint), height: 6 }]} />
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary }}>
                    {t("ferry.accumulated")}: {accumH}h {accumM}m
                  </Text>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary }}>
                    {t("ferry.interruptionsUsed")}: {intCount}/2 ({intTotalMin}m)
                  </Text>
                </View>

                <View style={{ borderTopWidth: 1, borderTopColor: Colors.light.border, marginTop: 12, paddingTop: 12 }}>
                  {!openInt && intCount < 2 && !ferryComplete && (
                    <Pressable
                      style={({ pressed }) => [{ flexDirection: "row" as const, alignItems: "center" as const, gap: 8, backgroundColor: Colors.light.warning, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 10, opacity: pressed ? 0.85 : 1 }]}
                      onPress={async () => {
                        try {
                          const ints = [...(lastClosed.ferryInterruptions || []), { start: new Date().toISOString(), end: null }];
                          const updated = await updateJornadaFerryData(lastClosed.id, { ferryInterruptions: ints });
                          if (updated) setFerryJustClosed(updated);
                          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                          invalidateAll();
                        } catch (e) { Alert.alert(t("common.error"), String(e)); }
                      }}
                    >
                      <Ionicons name="pause-circle" size={18} color="#fff" />
                      <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#fff" }}>{t("ferry.embark")}</Text>
                    </Pressable>
                  )}
                  {openInt && (
                    <Pressable
                      style={({ pressed }) => [{ flexDirection: "row" as const, alignItems: "center" as const, gap: 8, backgroundColor: Colors.light.success, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 10, opacity: pressed ? 0.85 : 1 }]}
                      onPress={async () => {
                        try {
                          const ints = (lastClosed.ferryInterruptions || []).map(i => i.end === null ? { ...i, end: new Date().toISOString() } : i);
                          const totalIntMin = getFerryInterruptionsTotalMin(ints);
                          if (totalIntMin > 60) {
                            Alert.alert(t("ferry.restForm.maxTotalInterruption"), t("ferry.interruptionExceeded"));
                          }
                          const updated = await updateJornadaFerryData(lastClosed.id, { ferryInterruptions: ints });
                          if (updated) setFerryJustClosed(updated);
                          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                          invalidateAll();
                        } catch (e) { Alert.alert(t("common.error"), String(e)); }
                      }}
                    >
                      <Ionicons name="play-circle" size={18} color="#fff" />
                      <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#fff" }}>{t("ferry.disembark")}</Text>
                    </Pressable>
                  )}
                  <Pressable
                    style={({ pressed }) => [{ flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const, gap: 8, backgroundColor: ferryComplete ? Colors.light.success : Colors.light.danger, borderRadius: 10, paddingVertical: 14, paddingHorizontal: 16, marginTop: 6, opacity: pressed ? 0.85 : 1 }]}
                    onPress={() => {
                      const now = new Date();
                      setFerryFinishEndDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`);
                      setFerryFinishEndTime(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
                      setShowFerryFinishModal(true);
                    }}
                  >
                    <MaterialCommunityIcons name="ferry" size={20} color="#fff" />
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: "#fff" }}>{t("ferry.finishFerryRest")}</Text>
                  </Pressable>
                </View>

                <View style={{ borderTopWidth: 1, borderTopColor: Colors.light.border, marginTop: 4, paddingTop: 12 }}>
                  <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.light.text, marginBottom: 8 }}>{t("ferry.extras")}</Text>

                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Ionicons name="restaurant" size={16} color={Colors.light.tint} />
                      <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.text }}>{t("ferry.transitDiet")}</Text>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Pressable onPress={() => { if (ferryTransitDiet > 0) setFerryTransitDiet(v => v - 1); }} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.light.surface, borderWidth: 1, borderColor: Colors.light.border, alignItems: "center" as const, justifyContent: "center" as const }}>
                        <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text }}>-</Text>
                      </Pressable>
                      <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.light.tint, minWidth: 20, textAlign: "center" as const }}>{ferryTransitDiet}</Text>
                      <Pressable onPress={() => setFerryTransitDiet(v => v + 1)} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.light.tint, alignItems: "center" as const, justifyContent: "center" as const }}>
                        <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" }}>+</Text>
                      </Pressable>
                    </View>
                  </View>

                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Ionicons name="bed" size={16} color={Colors.light.tint} />
                      <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.text }}>{t("ferry.cabinOvernight")}</Text>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Pressable onPress={() => { if (ferryCabinOvernight > 0) setFerryCabinOvernight(v => v - 1); }} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.light.surface, borderWidth: 1, borderColor: Colors.light.border, alignItems: "center" as const, justifyContent: "center" as const }}>
                        <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text }}>-</Text>
                      </Pressable>
                      <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.light.tint, minWidth: 20, textAlign: "center" as const }}>{ferryCabinOvernight}</Text>
                      <Pressable onPress={() => setFerryCabinOvernight(v => v + 1)} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.light.tint, alignItems: "center" as const, justifyContent: "center" as const }}>
                        <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" }}>+</Text>
                      </Pressable>
                    </View>
                  </View>

                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Ionicons name="globe" size={16} color={Colors.light.tint} />
                      <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.text }}>{t("ferry.countryChange")}</Text>
                    </View>
                    <Switch
                      value={ferryCountryChange}
                      onValueChange={(v) => setFerryCountryChange(v)}
                      trackColor={{ false: Colors.light.border, true: Colors.light.tint }}
                      thumbColor="#fff"
                    />
                  </View>

                  <View style={{ marginBottom: 8 }}>
                    <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary, marginBottom: 4 }}>{t("ferry.destination")}</Text>
                    <TextInput
                      style={[styles.input, { fontSize: 14 }]}
                      value={ferryDestination}
                      onChangeText={setFerryDestination}
                      placeholder={t("ferry.destinationPlaceholder")}
                      placeholderTextColor="#9CA3AF"
                    />
                  </View>

                  {(ferryTransitDiet > 0 || ferryCabinOvernight > 0) && (() => {
                    const tRate = ferryConfig.ferryTransitRate ?? 54.30;
                    const cRate = ferryConfig.ferryCabinRate ?? 54.30;
                    const transitTotal = ferryTransitDiet * tRate;
                    const cabinTotal = ferryCabinOvernight * cRate;
                    const grandTotal = transitTotal + cabinTotal;
                    return (
                      <View style={{ backgroundColor: Colors.light.surface, borderRadius: 8, padding: 10, marginBottom: 8, alignItems: "center" as const }}>
                        <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary, marginBottom: 2 }}>Total extras ferry</Text>
                        <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.tint }}>
                          {grandTotal.toFixed(2)} EUR
                        </Text>
                        <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textSecondary }}>
                          {ferryTransitDiet > 0 ? `${ferryTransitDiet}x tránsito (${tRate.toFixed(2)}€)` : ""}{ferryTransitDiet > 0 && ferryCabinOvernight > 0 ? " + " : ""}{ferryCabinOvernight > 0 ? `${ferryCabinOvernight}x pernocta (${cRate.toFixed(2)}€)` : ""}
                        </Text>
                      </View>
                    );
                  })()}

                  <Pressable
                    style={({ pressed }) => [{ flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const, gap: 6, backgroundColor: Colors.light.tint, borderRadius: 8, paddingVertical: 10, marginTop: 4, opacity: pressed ? 0.85 : 1 }]}
                    onPress={async () => {
                      try {
                        const hasAnyExtras = ferryTransitDiet > 0 || ferryCabinOvernight > 0 || ferryCountryChange;
                        const extras: FerryExtras | null = hasAnyExtras ? { transitDiet: ferryTransitDiet, cabinOvernight: ferryCabinOvernight, countryChange: ferryCountryChange } : null;
                        await updateJornadaFerryData(lastClosed.id, {
                          ferryExtras: extras,
                          ferryDestination: ferryDestination.trim() || null,
                        });
                        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        invalidateAll();
                        triggerSync();
                      } catch (e) { Alert.alert(t("common.error"), String(e)); }
                    }}
                  >
                    <Ionicons name="save" size={16} color="#fff" />
                    <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#fff" }}>{t("ferry.saveExtras")}</Text>
                  </Pressable>
                </View>
              </View>
            );
          })()}

          {lastClosed?.plannedRestMin && lastClosed?.endAt && !lastClosed?.ferryPending && (() => {
            const endMs = new Date(lastClosed.endAt!).getTime();
            const totalMin = lastClosed.plannedRestMin;
            const targetDate = new Date(endMs + totalMin * 60000);
            const remainMs = targetDate.getTime() - countdownNow;
            const isComplete = remainMs <= 0;
            const remainMin = Math.max(0, Math.min(totalMin, Math.ceil(remainMs / 60000)));
            const remainH = Math.floor(remainMin / 60);
            const remainM = remainMin % 60;
            const elapsedMin = totalMin - remainMin;
            const progress = Math.min(1, Math.max(0, elapsedMin / totalMin));
            const restTypeLabel = lastClosed.plannedRestType === "weekly"
              ? `${t("dashboard.weeklyRest")} (${lastClosed.plannedRestMin / 60}h)`
              : `${t("dashboard.dailyRest")} (${lastClosed.plannedRestMin / 60}h)`;
            const targetLabel = formatDateTimeES(targetDate, locale);
            return (
              <View style={[styles.card, { marginBottom: 16 }]}>
                <View style={styles.cardHeader}>
                  <Ionicons name="moon" size={20} color={isComplete ? Colors.light.success : Colors.light.tint} />
                  <Text style={styles.cardTitle}>{restTypeLabel}</Text>
                </View>
                {isComplete ? (
                  <View style={{ flexDirection: "row" as const, alignItems: "center" as const, gap: 8, paddingVertical: 8 }}>
                    <Ionicons name="checkmark-circle" size={24} color={Colors.light.success} />
                    <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.light.success }}>
                      {t("dashboard.restCompleted")}
                    </Text>
                  </View>
                ) : (
                  <>
                    <View style={{ paddingVertical: 6, paddingHorizontal: 4 }}>
                      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.light.textSecondary }}>
                        {t("dashboard.canStartAt")}
                      </Text>
                      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: Colors.light.tint, marginTop: 2 }}>
                        {targetLabel}
                      </Text>
                    </View>
                    <View style={{ alignItems: "center" as const, paddingVertical: 10 }}>
                      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 32, color: Colors.light.tint }}>
                        {remainH}h {remainM > 0 ? `${remainM}m` : ""}
                      </Text>
                      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.light.textSecondary, marginTop: 2 }}>
                        {t("dashboard.restRemaining")}
                      </Text>
                    </View>
                    <View style={[styles.progressBg, { backgroundColor: Colors.light.border, height: 6 }]}>
                      <View style={[styles.progressFill, {
                        width: `${progress * 100}%` as any,
                        backgroundColor: Colors.light.tint,
                        height: 6,
                      }]} />
                    </View>
                  </>
                )}
              </View>
            );
          })()}
          </>
        ) : !showFinForm ? (
          <View>
            <View style={styles.openInfo}>
              <Ionicons name="radio-button-on" size={12} color={Colors.light.success} />
              <Text style={styles.openInfoText}>
                {t("dashboard.openJornada")}: {formatFecha(abierta.fechaInicio)} {abierta.horaInicio} - {abierta.lugarInicio}
              </Text>
            </View>
            {abierta.descansoAnteriorMin != null && (
              <View style={{
                backgroundColor: abierta.tipoDescansoAnterior === "INFRACCION_DESCANSO" ? "#FEE2E2" :
                  abierta.tipoDescansoAnterior === "DESCANSO_DIARIO_REDUCIDO" || abierta.tipoDescansoAnterior === "DESCANSO_SEMANAL_REDUCIDO" ? "#FEF3C7" : "#ECFDF5",
                padding: 10, borderRadius: 8, marginBottom: 8,
              }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Ionicons
                    name={abierta.tipoDescansoAnterior === "INFRACCION_DESCANSO" ? "alert-circle" : "moon-outline"}
                    size={16}
                    color={abierta.tipoDescansoAnterior === "INFRACCION_DESCANSO" ? Colors.light.danger :
                      abierta.tipoDescansoAnterior === "DESCANSO_DIARIO_REDUCIDO" || abierta.tipoDescansoAnterior === "DESCANSO_SEMANAL_REDUCIDO" ? Colors.light.warning : Colors.light.success}
                  />
                  <Text style={{ marginLeft: 6, fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>
                    {t("dashboard.previousRest")}: {formatMinutosHoras(abierta.descansoAnteriorMin)}
                  </Text>
                  <Text style={{ marginLeft: 6, fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textSecondary }}>
                    ({t(`common.restType.${abierta.tipoDescansoAnterior}`)})
                  </Text>
                </View>
                {abierta.tipoDescansoAnterior === "INFRACCION_DESCANSO" && (
                  <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.danger, marginTop: 4 }}>
                    {t("dashboard.restInfractionAlert")}
                  </Text>
                )}
              </View>
            )}
            <Pressable
              style={({ pressed }) => [styles.bigActionBtn, styles.bigActionBtnStop, { opacity: pressed ? 0.9 : 1 }]}
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setFinFecha(todayStr());
                setFinHora(nowTimeStr());
                setShowFinForm(true);
              }}
            >
              <View style={[styles.bigActionIcon, { backgroundColor: Colors.light.danger + "15" }]}>
                <Ionicons name="stop" size={22} color={Colors.light.danger} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.bigActionTitle}>{t("dashboard.closeJornada")}</Text>
                <Text style={styles.bigActionSub}>{t("dashboard.tapToEnd")}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={Colors.light.textSecondary} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="stop-circle" size={22} color={Colors.light.danger} />
              <Text style={styles.cardTitle}>{t("dashboard.endTitle")}</Text>
              <View style={{ flex: 1 }} />
              <Pressable onPress={() => setShowFinForm(false)} hitSlop={8}>
                <Ionicons name="close" size={20} color={Colors.light.textSecondary} />
              </Pressable>
            </View>
            <View style={styles.openInfo}>
              <Text style={styles.openInfoText}>
                {t("dashboard.opened")}: {formatFecha(abierta.fechaInicio)} {abierta.horaInicio} - {abierta.lugarInicio}
              </Text>
            </View>
            <View style={styles.fieldRow}>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>{t("dashboard.endDate")}</Text>
                <TextInput
                  style={styles.input}
                  value={finFecha}
                  onChangeText={setFinFecha}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#9CA3AF"
                />
              </View>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>{t("dashboard.endTime")}</Text>
                <TextInput
                  style={styles.input}
                  value={finHora}
                  onChangeText={setFinHora}
                  placeholder="HH:MM"
                  placeholderTextColor="#9CA3AF"
                />
              </View>
            </View>
            <View style={[styles.field, { zIndex: 10 }]}>
              <Text style={styles.fieldLabel}>{t("dashboard.endPlace")}</Text>
              <View style={{ position: "relative" as const }}>
                <TextInput
                  style={styles.input}
                  value={finLugar}
                  onChangeText={(v) => { setFinLugar(v); setShowFinSuggestions(true); }}
                  onFocus={() => setShowFinSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowFinSuggestions(false), 200)}
                  placeholder={t("dashboard.cityBase")}
                  placeholderTextColor="#9CA3AF"
                />
                {showFinSuggestions && recentPlaces.length > 0 && (
                  <PlaceSuggestions
                    places={recentPlaces}
                    filter={finLugar}
                    onSelect={(p) => { setFinLugar(p); setShowFinSuggestions(false); }}
                  />
                )}
              </View>
            </View>

            {!(isMoroccoMode && (ferryConfig.paymentMode === "morocco_pernight" || ferryConfig.paymentMode === "morocco_trip")) && (
            <>
            <Text style={styles.fieldLabel}>{t("dashboard.tripType")}</Text>
            <View style={styles.segmentRow}>
              {(["NACIONAL", "INTERNACIONAL", "REGIONAL_INTL", "NAC_INTL", "NAC_REGIONAL", "NINGUNO", "REGIONAL"] as const).map((rt) => (
                <Pressable
                  key={rt}
                  style={[styles.segmentFlex, tipoRuta === rt && styles.segmentActive]}
                  onPress={() => setTipoRuta(rt)}
                >
                  <Text style={[styles.segmentTextSmall, tipoRuta === rt && styles.segmentTextActive]}>
                    {rt === "NACIONAL" ? t("dashboard.routeNac") : rt === "INTERNACIONAL" ? t("dashboard.routeIntl") : rt === "REGIONAL_INTL" ? t("dashboard.routeRegIntl") : rt === "NAC_INTL" ? t("dashboard.routeNacIntl") : rt === "NAC_REGIONAL" ? t("dashboard.routeNacReg") : rt === "NINGUNO" ? t("dashboard.routeNone") : t("dashboard.routeReg")}
                  </Text>
                </Pressable>
              ))}
            </View>
            </>
            )}

            {isCrossSundayMonday ? (
              <View style={styles.field}>
                <View style={{ backgroundColor: Colors.light.warning + "15", padding: 10, borderRadius: 8, marginBottom: 10 }}>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.warning, marginBottom: 4 }}>
                    {t("dashboard.crossWeekTitle")}
                  </Text>
                  <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textSecondary }}>
                    {t("dashboard.crossWeekDesc")}
                  </Text>
                </View>
                <Text style={styles.fieldLabel}>
                  {t("dashboard.drivingSundayUntil")} {crossWeekTimeLabel} {t("dashboard.ofMonday")}
                </Text>
                <TextInput
                  style={[styles.input, conduccionDomingoParsed.error ? { borderColor: Colors.light.danger, borderWidth: 1 } : undefined]}
                  value={conduccionDomingoHoras}
                  onChangeText={setConduccionDomingoHoras}
                  placeholder={t("dashboard.drivingSundayExample")}
                  placeholderTextColor="#9CA3AF"
                  keyboardType="default"
                />
                {conduccionDomingoParsed.error && (
                  <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.danger, marginTop: 4 }}>
                    {t(conduccionDomingoParsed.error)}
                  </Text>
                )}
                <View style={{ height: 10 }} />
                <Text style={styles.fieldLabel}>
                  {t("dashboard.drivingMondayFrom")} {crossWeekTimeLabel}
                </Text>
                <TextInput
                  style={[styles.input, conduccionLunesParsed.error ? { borderColor: Colors.light.danger, borderWidth: 1 } : undefined]}
                  value={conduccionLunesHoras}
                  onChangeText={setConduccionLunesHoras}
                  placeholder={t("dashboard.drivingMondayExample")}
                  placeholderTextColor="#9CA3AF"
                  keyboardType="default"
                />
                {conduccionLunesParsed.error && (
                  <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.danger, marginTop: 4 }}>
                    {t(conduccionLunesParsed.error)}
                  </Text>
                )}
                {conduccionDomingoParsed.minutes != null && conduccionLunesParsed.minutes != null && (
                  <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.tint, marginTop: 6 }}>
                    Total: {Math.floor((conduccionDomingoParsed.minutes + conduccionLunesParsed.minutes) / 60)}h{((conduccionDomingoParsed.minutes + conduccionLunesParsed.minutes) % 60) > 0 ? `:${String((conduccionDomingoParsed.minutes + conduccionLunesParsed.minutes) % 60).padStart(2, "0")}` : ""}
                  </Text>
                )}
              </View>
            ) : (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>{t("dashboard.drivingHours")}</Text>
                <TextInput
                  style={[styles.input, conduccionParsed.error ? { borderColor: Colors.light.danger, borderWidth: 1 } : undefined]}
                  value={conduccionHoras}
                  onChangeText={setConduccionHoras}
                  placeholder={t("dashboard.drivingExample")}
                  placeholderTextColor="#9CA3AF"
                  keyboardType="default"
                />
                {conduccionParsed.error && (
                  <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.danger, marginTop: 4 }}>
                    {t(conduccionParsed.error)}
                  </Text>
                )}
              </View>
            )}

            {drivingWarningInfo && drivingWarningInfo.map((w, idx) => (
              <View key={idx} style={{ flexDirection: "row", alignItems: "center", backgroundColor: w.type === "infraction" ? "#FEE2E2" : "#FEF3C7", padding: 8, borderRadius: 8, marginTop: 4, marginBottom: 4 }}>
                <Ionicons name={w.type === "infraction" ? "alert-circle" : "warning"} size={16} color={w.type === "infraction" ? Colors.light.danger : Colors.light.warning} style={{ marginRight: 6 }} />
                <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold", color: w.type === "infraction" ? Colors.light.danger : "#92400E" }}>{w.message}</Text>
              </View>
            ))}

            {!(isMoroccoMode && ferryConfig.paymentMode !== "morocco_diet") && (
            <View style={styles.fieldRow}>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>{t("dashboard.pernocta")}</Text>
                <View style={styles.segmentRow}>
                  <Pressable
                    style={[styles.segmentSmall, pernocta && styles.segmentActive]}
                    onPress={() => setPernocta(true)}
                  >
                    <Text style={[styles.segmentText, pernocta && styles.segmentTextActive]}>{t("common.yes")}</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.segmentSmall, !pernocta && styles.segmentActive]}
                    onPress={() => setPernocta(false)}
                  >
                    <Text style={[styles.segmentText, !pernocta && styles.segmentTextActive]}>{t("common.no")}</Text>
                  </Pressable>
                </View>
              </View>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>{t("dashboard.dietMode")}</Text>
                <View style={styles.segmentRow}>
                  <Pressable
                    style={[styles.segmentSmall, dietaModo === "AUTO" && styles.segmentActive]}
                    onPress={() => setDietaModo("AUTO")}
                  >
                    <Text style={[styles.segmentText, dietaModo === "AUTO" && styles.segmentTextActive]}>{t("dashboard.dietAuto")}</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.segmentSmall, dietaModo === "MANUAL" && styles.segmentActive]}
                    onPress={() => setDietaModo("MANUAL")}
                  >
                    <Text style={[styles.segmentText, dietaModo === "MANUAL" && styles.segmentTextActive]}>{t("dashboard.dietManual")}</Text>
                  </Pressable>
                </View>
              </View>
            </View>
            )}

            {!(isMoroccoMode && ferryConfig.paymentMode !== "morocco_diet") && dietaModo === "AUTO" && (
              <View style={styles.manualSection}>
                <Text style={styles.fieldLabel}>{t("dashboard.dietPercentLabel")}</Text>
                <View style={styles.segmentRow}>
                  {([100, 60, 30] as const).map((p) => (
                    <Pressable
                      key={p}
                      style={[styles.segmentSmall, dietaPercent === p && styles.segmentActive]}
                      onPress={() => setDietaPercent(p)}
                    >
                      <Text style={[styles.segmentText, dietaPercent === p && styles.segmentTextActive]}>
                        {p}%
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.fieldLabel}>{t("dashboard.dayExtra")}</Text>
                <View style={styles.segmentRow}>
                  {(["", "NINGUNO", "SABADO", "DOMINGO", "FESTIVO"] as const).map((f) => (
                    <Pressable
                      key={f || "none"}
                      style={[styles.segmentSmall, dayFlag === f && styles.segmentActive]}
                      onPress={() => setDayFlag(f)}
                    >
                      <Text style={[styles.segmentTextSmall, dayFlag === f && styles.segmentTextActive]}>
                        {f === "" ? t("dashboard.dayFlagAuto") : f === "NINGUNO" ? t("dashboard.dayFlagNone") : f === "SABADO" ? t("dashboard.dayFlagSat") : f === "DOMINGO" ? t("dashboard.dayFlagSun") : t("dashboard.dayFlagHol")}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {dietaPreview && (
                  <View style={styles.dietaPreview}>
                    {dietaPreview.items && dietaPreview.items.map((it: any, i: number) => (
                      <View key={i} style={styles.dietaPreviewRow}>
                        <Text style={styles.dietaPreviewLabel}>{it.tipo} {it.pct}%</Text>
                        <Text style={styles.dietaPreviewValue}>{it.importe.toFixed(2)} EUR</Text>
                      </View>
                    ))}
                    {dietaPreview.extra > 0 && (
                      <View style={styles.dietaPreviewRow}>
                        <Text style={styles.dietaPreviewLabel}>
                          {t("dashboard.extra")} {dietaPreview.flag ? t(`common.dayFlag.${dietaPreview.flag}`) : ""}
                        </Text>
                        <Text style={styles.dietaPreviewValue}>+{dietaPreview.extra.toFixed(2)} EUR</Text>
                      </View>
                    )}
                    <View style={[styles.dietaPreviewRow, styles.dietaPreviewTotal]}>
                      <Text style={styles.dietaPreviewTotalLabel}>{t("dashboard.totalDiet")}</Text>
                      <Text style={styles.dietaPreviewTotalValue}>{dietaPreview.total.toFixed(2)} EUR</Text>
                    </View>
                  </View>
                )}
              </View>
            )}

            {!(isMoroccoMode && ferryConfig.paymentMode !== "morocco_diet") && dietaModo === "MANUAL" && (
              <View style={styles.manualSection}>
                <Text style={styles.fieldLabel}>{t("dashboard.dietType")}</Text>
                <View style={styles.segmentRow}>
                  <Pressable
                    style={[styles.segment, manualTipo === "NACIONAL" && styles.segmentActive]}
                    onPress={() => setManualTipo("NACIONAL")}
                  >
                    <Text style={[styles.segmentText, manualTipo === "NACIONAL" && styles.segmentTextActive]}>
                      {t("common.nacional")}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.segment, manualTipo === "INTERNACIONAL" && styles.segmentActive]}
                    onPress={() => setManualTipo("INTERNACIONAL")}
                  >
                    <Text style={[styles.segmentText, manualTipo === "INTERNACIONAL" && styles.segmentTextActive]}>
                      {t("common.internacional")}
                    </Text>
                  </Pressable>
                </View>
                <Text style={[styles.fieldLabel, { marginTop: 4 }]}>{t("dashboard.dietPercent")}</Text>
                <View style={styles.segmentRow}>
                  {(["100", "60", "30"] as const).map((p) => (
                    <Pressable
                      key={p}
                      style={[styles.segmentSmall, manualPct === p && styles.segmentActive]}
                      onPress={() => setManualPct(p)}
                    >
                      <Text style={[styles.segmentText, manualPct === p && styles.segmentTextActive]}>
                        {p}%
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={[styles.fieldLabel, { marginTop: 4 }]}>{t("dashboard.dayExtra")}</Text>
                <View style={styles.segmentRow}>
                  {(["", "NINGUNO", "SABADO", "DOMINGO", "FESTIVO"] as const).map((f) => (
                    <Pressable
                      key={f || "none"}
                      style={[styles.segmentSmall, dayFlag === f && styles.segmentActive]}
                      onPress={() => setDayFlag(f)}
                    >
                      <Text style={[styles.segmentTextSmall, dayFlag === f && styles.segmentTextActive]}>
                        {f === "" ? t("dashboard.dayFlagAuto") : f === "NINGUNO" ? t("dashboard.dayFlagNone") : f === "SABADO" ? t("dashboard.dayFlagSat") : f === "DOMINGO" ? t("dashboard.dayFlagSun") : t("dashboard.dayFlagHol")}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {dietaPreview && (
                  <View style={styles.dietaPreview}>
                    {dietaPreview.items && dietaPreview.items.map((it: any, i: number) => (
                      <View key={i} style={styles.dietaPreviewRow}>
                        <Text style={styles.dietaPreviewLabel}>{it.tipo} {it.pct}%</Text>
                        <Text style={styles.dietaPreviewValue}>{it.importe.toFixed(2)} EUR</Text>
                      </View>
                    ))}
                    {dietaPreview.extra > 0 && (
                      <View style={styles.dietaPreviewRow}>
                        <Text style={styles.dietaPreviewLabel}>
                          {t("dashboard.extra")} {dietaPreview.flag ? t(`common.dayFlag.${dietaPreview.flag}`) : ""}
                        </Text>
                        <Text style={styles.dietaPreviewValue}>+{dietaPreview.extra.toFixed(2)} EUR</Text>
                      </View>
                    )}
                    <View style={[styles.dietaPreviewRow, styles.dietaPreviewTotal]}>
                      <Text style={styles.dietaPreviewTotalLabel}>{t("dashboard.totalDiet")}</Text>
                      <Text style={styles.dietaPreviewTotalValue}>{dietaPreview.total.toFixed(2)} EUR</Text>
                    </View>
                  </View>
                )}
              </View>
            )}

            {isMoroccoMode && ferryConfig.paymentMode === "morocco_pernight" && (
              <View style={styles.manualSection}>
                <Text style={styles.fieldLabel}>{t("morocco.diet.nacional")}/{t("morocco.diet.internacional")}</Text>
                <View style={styles.segmentRow}>
                  {(["NACIONAL", "INTERNACIONAL", "NINGUNA"] as const).map((rt) => (
                    <Pressable
                      key={rt}
                      style={[styles.segmentFlex, moroccoRouteType === rt && styles.segmentActive]}
                      onPress={() => setMoroccoRouteType(rt)}
                    >
                      <Text style={[styles.segmentTextSmall, moroccoRouteType === rt && styles.segmentTextActive]}>
                        {t(`morocco.diet.${rt.toLowerCase()}`)}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={[styles.fieldLabel, { marginTop: 8 }]}>{t("morocco.diet.pernocta")}</Text>
                <View style={styles.segmentRow}>
                  <Pressable
                    style={[styles.segmentSmall, moroccoPernocta && styles.segmentActive]}
                    onPress={() => setMoroccoPernocta(true)}
                  >
                    <Text style={[styles.segmentText, moroccoPernocta && styles.segmentTextActive]}>{t("morocco.diet.pernocta")}</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.segmentSmall, !moroccoPernocta && styles.segmentActive]}
                    onPress={() => setMoroccoPernocta(false)}
                  >
                    <Text style={[styles.segmentText, !moroccoPernocta && styles.segmentTextActive]}>{t("morocco.diet.noPernocta")}</Text>
                  </Pressable>
                </View>

                <Text style={[styles.fieldLabel, { marginTop: 8 }]}>{t("morocco.diet.dayExtras")}</Text>
                <View style={styles.segmentRow}>
                  <Pressable
                    style={[styles.segmentSmall, moroccoDayExtras.saturday && styles.segmentActive]}
                    onPress={() => setMoroccoDayExtras(prev => ({ ...prev, saturday: !prev.saturday }))}
                  >
                    <Text style={[styles.segmentTextSmall, moroccoDayExtras.saturday && styles.segmentTextActive]}>{t("morocco.diet.saturday")}</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.segmentSmall, moroccoDayExtras.sunday && styles.segmentActive]}
                    onPress={() => setMoroccoDayExtras(prev => ({ ...prev, sunday: !prev.sunday }))}
                  >
                    <Text style={[styles.segmentTextSmall, moroccoDayExtras.sunday && styles.segmentTextActive]}>{t("morocco.diet.sunday")}</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.segmentSmall, moroccoDayExtras.holiday && styles.segmentActive]}
                    onPress={() => setMoroccoDayExtras(prev => ({ ...prev, holiday: !prev.holiday }))}
                  >
                    <Text style={[styles.segmentTextSmall, moroccoDayExtras.holiday && styles.segmentTextActive]}>{t("morocco.diet.holiday")}</Text>
                  </Pressable>
                </View>

                {moroccoPernightPreview && (
                  <View style={styles.dietaPreview}>
                    {moroccoPernightPreview.dietBase > 0 && (
                      <View style={styles.dietaPreviewRow}>
                        <Text style={styles.dietaPreviewLabel}>{t(`morocco.diet.${moroccoRouteType.toLowerCase()}`)} {moroccoPernocta ? "100%" : "60%"}</Text>
                        <Text style={styles.dietaPreviewValue}>{moroccoPernightPreview.dietBase.toFixed(2)} EUR</Text>
                      </View>
                    )}
                    {moroccoPernightPreview.extraTotal > 0 && (
                      <View style={styles.dietaPreviewRow}>
                        <Text style={styles.dietaPreviewLabel}>{t("morocco.diet.dayExtras")}</Text>
                        <Text style={styles.dietaPreviewValue}>+{moroccoPernightPreview.extraTotal.toFixed(2)} EUR</Text>
                      </View>
                    )}
                    <View style={[styles.dietaPreviewRow, styles.dietaPreviewTotal]}>
                      <Text style={styles.dietaPreviewTotalLabel}>{t("morocco.diet.totalDiet")}</Text>
                      <Text style={styles.dietaPreviewTotalValue}>{moroccoPernightPreview.total.toFixed(2)} EUR</Text>
                    </View>
                  </View>
                )}
              </View>
            )}

            {isMoroccoMode && ferryConfig.paymentMode === "morocco_trip" && (
              <View style={[styles.manualSection, { alignItems: "center", paddingVertical: 16 }]}>
                <Ionicons name="airplane" size={28} color={Colors.light.accent} />
                <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary, marginTop: 6, textAlign: "center" }}>
                  {t("morocco.diet.tripPayment")}
                </Text>
                <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textSecondary, marginTop: 4, textAlign: "center" }}>
                  {ferryConfig.tripRate.toFixed(2)} EUR / {t("morocco.summary.byTrip")}
                </Text>
              </View>
            )}

            <View style={styles.plusSection}>
              <Text style={styles.fieldLabel}>{t("dashboard.plusItems")}</Text>
              {plusItems.map((item, idx) => (
                <View key={idx} style={styles.plusItemRow}>
                  <Text style={styles.plusItemText} numberOfLines={1}>{item.concepto}</Text>
                  <Text style={styles.plusItemAmount}>{item.importe.toFixed(2)} \u20AC</Text>
                  <Pressable onPress={() => setPlusItems(prev => prev.filter((_, i) => i !== idx))} hitSlop={6}>
                    <Ionicons name="close-circle" size={18} color={Colors.light.danger} />
                  </Pressable>
                </View>
              ))}
              <View style={styles.plusAddRow}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={plusConcepto}
                  onChangeText={setPlusConcepto}
                  placeholder={t("dashboard.concept")}
                  placeholderTextColor="#9CA3AF"
                />
                <TextInput
                  style={[styles.input, { width: 80, textAlign: "right" as const }]}
                  value={plusImporte}
                  onChangeText={setPlusImporte}
                  placeholder="EUR"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="decimal-pad"
                />
                <Pressable
                  onPress={() => {
                    const imp = parseFloat(plusImporte.replace(",", "."));
                    if (plusConcepto.trim() && !isNaN(imp) && imp > 0) {
                      setPlusItems(prev => [...prev, { concepto: plusConcepto.trim(), importe: imp }]);
                      setPlusConcepto("");
                      setPlusImporte("");
                    }
                  }}
                  hitSlop={8}
                >
                  <Ionicons name="add-circle" size={28} color={Colors.light.tint} />
                </Pressable>
              </View>
              {plusItems.length > 0 && (
                <Text style={styles.plusTotal}>
                  {t("dashboard.totalPlus")} {plusItems.reduce((s, i) => s + i.importe, 0).toFixed(2)} \u20AC
                </Text>
              )}
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{t("dashboard.observations")}</Text>
              <TextInput
                style={[styles.input, { textAlignVertical: "top" as const }]}
                value={observaciones}
                onChangeText={setObservaciones}
                placeholder={t("dashboard.additionalNotes")}
                placeholderTextColor="#9CA3AF"
                multiline={true}
                numberOfLines={3}
              />
            </View>

            {isFerryRestMode && (
              <View style={[styles.field, { backgroundColor: ferryEmbarking ? Colors.light.accentLight : Colors.light.surface, borderRadius: 10, padding: 12 }]}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                    <MaterialCommunityIcons name="ferry" size={20} color={ferryEmbarking ? Colors.light.tint : Colors.light.textSecondary} />
                    <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.light.text }}>{t("ferry.embarking")}</Text>
                  </View>
                  <Switch
                    value={ferryEmbarking}
                    onValueChange={setFerryEmbarking}
                    trackColor={{ false: Colors.light.border, true: Colors.light.tint }}
                    thumbColor="#fff"
                  />
                </View>
                {ferryEmbarking && (
                  <View style={{ marginTop: 10 }}>
                    <View style={{ flexDirection: "row" as const, alignItems: "center" as const, gap: 6, marginBottom: 8, backgroundColor: "#e0f2fe", borderRadius: 8, padding: 10 }}>
                      <Ionicons name="time-outline" size={16} color="#0284c7" />
                      <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: "#0284c7" }}>
                        {t("ferry.restStarted") || "Inicio descanso"}: {finHora} ({finFecha})
                      </Text>
                    </View>
                    <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textSecondary, marginBottom: 8 }}>
                      {t("ferry.startTimeNote") || "La hora de fin de jornada sera el inicio del descanso ferry. El contador comenzara desde esta hora."}
                    </Text>
                    <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary, marginBottom: 6 }}>{t("ferry.targetRest")}</Text>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Pressable
                        style={({ pressed }) => [{
                          flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: "center" as const,
                          backgroundColor: ferryRestTypeChoice === "9h" ? Colors.light.tint : Colors.light.surface,
                          borderWidth: 1, borderColor: ferryRestTypeChoice === "9h" ? Colors.light.tint : Colors.light.border,
                          opacity: pressed ? 0.85 : 1,
                        }]}
                        onPress={() => setFerryRestTypeChoice("9h")}
                      >
                        <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: ferryRestTypeChoice === "9h" ? "#fff" : Colors.light.text }}>{t("ferry.9hReduced")}</Text>
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [{
                          flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: "center" as const,
                          backgroundColor: ferryRestTypeChoice === "11h" ? Colors.light.tint : Colors.light.surface,
                          borderWidth: 1, borderColor: ferryRestTypeChoice === "11h" ? Colors.light.tint : Colors.light.border,
                          opacity: pressed ? 0.85 : 1,
                        }]}
                        onPress={() => setFerryRestTypeChoice("11h")}
                      >
                        <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: ferryRestTypeChoice === "11h" ? "#fff" : Colors.light.text }}>{t("ferry.11hNormal")}</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              </View>
            )}

            <Pressable
              style={({ pressed }) => [
                styles.btnDanger,
                { opacity: pressed ? 0.85 : 1 },
                (!finLugar.trim() || cierreMutation.isPending || !!conduccionParsed.error) && styles.btnDisabled,
              ]}
              onPress={() => cierreMutation.mutate()}
              disabled={!finLugar.trim() || cierreMutation.isPending || !!conduccionParsed.error}
            >
              {cierreMutation.isPending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={20} color="#fff" />
                  <Text style={styles.btnText}>{t("dashboard.closeJornada")}</Text>
                </>
              )}
            </Pressable>
          </View>
        )}

        {estado && (
          <View style={styles.legalPanel}>
            <View style={styles.legalHeader}>
              <Ionicons name="shield-checkmark" size={20} color={Colors.light.tint} />
              <Text style={styles.legalTitle}>{t("dashboard.legalStatus")}</Text>
            </View>

            <View style={styles.kpiRow}>
              <View style={styles.kpiBox}>
                <Text style={styles.kpiLabel}>{t("dashboard.weekly")}</Text>
                <Text style={[styles.kpiValue, estado.restanteSemanalMin < 10 * 60 ? { color: Colors.light.danger } : null]}>
                  {formatMinutosHoras(estado.conduccionSemanalMin)}
                </Text>
                <Text style={styles.kpiSub}>{t("dashboard.of")} {formatMinutosHoras(estado.maxSemanalMin)}</Text>
                <ProgressBar
                  value={estado.conduccionSemanalMin}
                  max={estado.maxSemanalMin}
                  color={estado.conduccionSemanalMin > estado.maxSemanalMin ? Colors.light.danger : Colors.light.tint}
                  bgColor={Colors.light.border}
                />
                <Text style={styles.kpiRemain}>
                  {t("dashboard.remaining")} {formatMinutosHoras(estado.restanteSemanalMin)}
                </Text>
              </View>
              <View style={styles.kpiBox}>
                <Text style={styles.kpiLabel}>{t("dashboard.biweekly")}</Text>
                <Text style={[styles.kpiValue, estado.restanteBisemanalMin < 10 * 60 ? { color: Colors.light.danger } : null]}>
                  {formatMinutosHoras(estado.conduccionBisemanalMin)}
                </Text>
                <Text style={styles.kpiSub}>{t("dashboard.of")} {formatMinutosHoras(estado.maxBisemanalMin)}</Text>
                <ProgressBar
                  value={estado.conduccionBisemanalMin}
                  max={estado.maxBisemanalMin}
                  color={estado.conduccionBisemanalMin > estado.maxBisemanalMin ? Colors.light.danger : Colors.light.accent}
                  bgColor={Colors.light.border}
                />
                <Text style={styles.kpiRemain}>
                  {t("dashboard.remaining")} {formatMinutosHoras(estado.restanteBisemanalMin)}
                </Text>
              </View>
            </View>

            <View style={styles.disponibilidadRow}>
              <Ionicons
                name="speedometer-outline"
                size={18}
                color={estado.descansosReducidos >= estado.maxDescansosReducidos ? Colors.light.danger : Colors.light.tint}
              />
              <Text style={styles.disponibilidadLabel}>{t("dashboard.availabilityToday")}</Text>
              <Text style={[
                styles.disponibilidadValue,
                estado.descansosReducidos >= estado.maxDescansosReducidos ? { color: Colors.light.danger } : null,
              ]}>
                {Math.floor(estado.disponibilidadMin / 60)}h
              </Text>
            </View>

            <View style={styles.legalRow}>
              <View style={styles.legalItem}>
                <View style={styles.legalItemHeader}>
                  <Ionicons name="timer-outline" size={16} color={Colors.light.accent} />
                  <Text style={styles.legalItemLabel}>{t("dashboard.extensions10h")}</Text>
                </View>
                <Text style={[
                  styles.legalItemValue,
                  estado.extensiones10h >= estado.maxExtensiones ? { color: Colors.light.danger } : null,
                ]}>
                  {estado.extensiones10h} / {estado.maxExtensiones}
                </Text>
              </View>
              <View style={styles.legalItem}>
                <View style={styles.legalItemHeader}>
                  <Ionicons name="moon-outline" size={16} color={Colors.light.descansoReducido} />
                  <Text style={styles.legalItemLabel}>{t("dashboard.reducedRests")}</Text>
                </View>
                <Text style={[
                  styles.legalItemValue,
                  estado.descansosReducidos >= estado.maxDescansosReducidos ? { color: Colors.light.danger } : null,
                ]}>
                  {estado.descansosReducidos} / {estado.maxDescansosReducidos}
                </Text>
              </View>
            </View>

            {estado.descansosReducidos < estado.maxDescansosReducidos && (
              <View style={styles.recomendacionRow}>
                <Ionicons name="information-circle-outline" size={16} color={Colors.light.accent} />
                <Text style={styles.recomendacionText}>
                  {t("dashboard.canRest9h")} {estado.maxDescansosReducidos - estado.descansosReducidos} {t("dashboard.reducedRemaining")}
                </Text>
              </View>
            )}
            {estado.descansosReducidos >= estado.maxDescansosReducidos && (
              <View style={[styles.recomendacionRow, { backgroundColor: "#FEE2E2" }]}>
                <Ionicons name="warning-outline" size={16} color={Colors.light.danger} />
                <Text style={[styles.recomendacionText, { color: Colors.light.danger }]}>
                  {t("dashboard.noReducedAvailable")}
                </Text>
              </View>
            )}

            {estado.compensacionAgregada && (
              <View style={[styles.compSection, estado.compensacionAgregada.vencida && styles.compSectionDanger]}>
                <Text style={[styles.compTitle, estado.compensacionAgregada.vencida && { color: Colors.light.danger }]}>
                  {t("dashboard.pendingCompensations")}
                </Text>

                <View style={styles.compSummary}>
                  <View style={styles.compSummaryRow}>
                    <Text style={styles.compSummaryLabel}>{t("dashboard.totalToCompensate")}</Text>
                    <Text style={[styles.compSummaryValue, estado.compensacionAgregada.vencida && { color: Colors.light.danger }]}>
                      {estado.compensacionAgregada.totalDeudaHoras}h {estado.compensacionAgregada.totalDeudaMinutos}m
                    </Text>
                  </View>
                  {estado.compensacionAgregada.fechaPrimerReducido && (
                    <View style={styles.compSummaryRow}>
                      <Text style={styles.compSummaryLabel}>{t("dashboard.firstReduced")}</Text>
                      <Text style={styles.compSummaryDate}>
                        {formatFecha(estado.compensacionAgregada.fechaPrimerReducido)}
                      </Text>
                    </View>
                  )}
                  <View style={styles.compSummaryRow}>
                    <Text style={styles.compSummaryLabel}>{t("dashboard.deadline")}</Text>
                    <Text style={[
                      styles.compSummaryDate,
                      estado.compensacionAgregada.vencida && { color: Colors.light.danger, fontFamily: "Inter_700Bold" },
                    ]}>
                      {estado.compensacionAgregada.vencida ? `${t("dashboard.expired")} - ` : ""}
                      {formatFecha(estado.compensacionAgregada.fechaLimite)}
                    </Text>
                  </View>
                </View>

                {estado.compensacionAgregada.detalle.length > 1 && (
                  <View style={styles.compDetalle}>
                    {estado.compensacionAgregada.detalle.map((d) => (
                      <View key={d.id} style={styles.compDetalleRow}>
                        <Text style={styles.compDetalleFecha}>{formatFecha(d.fechaDescanso)}</Text>
                        <Text style={styles.compDetalleDeuda}>
                          {d.horasDeuda}h {d.minutosDeuda}m
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                <Pressable
                  style={({ pressed }) => [
                    styles.compBtn,
                    { opacity: pressed ? 0.8 : 1 },
                    compensarMutation.isPending && styles.btnDisabled,
                  ]}
                  onPress={() => {
                    Alert.alert(
                      t("dashboard.compensateConfirm"),
                      t("dashboard.compensateQuestion"),
                      [
                        { text: t("common.cancel"), style: "cancel" },
                        { text: t("dashboard.compensateConfirm"), onPress: () => compensarMutation.mutate() },
                      ],
                    );
                  }}
                  disabled={compensarMutation.isPending}
                >
                  <Ionicons name="checkmark-done-circle" size={18} color={Colors.light.success} />
                  <Text style={styles.compBtnText}>{t("dashboard.markCompensated")}</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}

        <Pressable
          style={({ pressed }) => [styles.btnOutline, { opacity: pressed ? 0.7 : 1 }]}
          onPress={() => {
            if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/jornada-completa");
          }}
        >
          <Ionicons name="add-circle-outline" size={20} color={Colors.light.tint} />
          <Text style={styles.btnOutlineText}>{t("dashboard.registerManual")}</Text>
        </Pressable>

        <View style={{ height: 100 }} />
      </ScrollView>

      <Modal
        visible={showRecoveryPrompt}
        transparent
        animationType="fade"
        onRequestClose={dismissRecovery}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Ionicons name="cloud-download-outline" size={40} color={Colors.light.tint} style={{ alignSelf: "center" as const }} />
            <Text style={styles.modalTitle}>{t("dashboard.recoverData")}</Text>
            <Text style={styles.modalText}>
              {t("dashboard.recoverDataDesc")}
            </Text>
            <Pressable
              style={({ pressed }) => [styles.modalBtnPrimary, { opacity: pressed ? 0.85 : 1 }]}
              onPress={startRestore}
            >
              <Ionicons name="download-outline" size={18} color="#fff" />
              <Text style={styles.modalBtnText}>{t("dashboard.restoreCloud")}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.modalBtnSecondary, { opacity: pressed ? 0.85 : 1 }]}
              onPress={dismissRecovery}
            >
              <Text style={styles.modalBtnSecondaryText}>{t("dashboard.startFresh")}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isRestoring}
        transparent
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ActivityIndicator size="large" color={Colors.light.tint} style={{ marginBottom: 12 }} />
            <Text style={styles.modalTitle}>{t("dashboard.downloadingData")}</Text>
            {restoreProgress && (
              <>
                <View style={styles.restoreProgressBar}>
                  <View
                    style={[
                      styles.restoreProgressFill,
                      { width: `${Math.round((restoreProgress.step / restoreProgress.total) * 100)}%` as any },
                    ]}
                  />
                </View>
                <Text style={styles.restoreProgressLabel}>{restoreProgress.label}</Text>
                <Text style={styles.restoreProgressPct}>
                  {Math.round((restoreProgress.step / restoreProgress.total) * 100)}%
                </Text>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={restoreComplete}
        transparent
        animationType="fade"
        onRequestClose={dismissRestoreComplete}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {restoreResult ? (
              <>
                <Ionicons name="checkmark-circle" size={48} color={Colors.light.success} style={{ alignSelf: "center" as const }} />
                <Text style={styles.modalTitle}>{t("dashboard.downloadComplete")}</Text>
                <Text style={styles.modalText}>
                  {t("dashboard.restoredJornadas")} {restoreResult.jornadasCount} {t("dashboard.restoredJornadasSuffix")}{" "}
                  {restoreResult.compensacionesCount} {t("dashboard.restoredCompSuffix")}
                </Text>
              </>
            ) : (
              <>
                <Ionicons name="alert-circle" size={48} color={Colors.light.danger} style={{ alignSelf: "center" as const }} />
                <Text style={styles.modalTitle}>{t("dashboard.restoreError")}</Text>
                <Text style={styles.modalText}>
                  {t("dashboard.restoreErrorDesc")}
                </Text>
              </>
            )}
            <Pressable
              style={({ pressed }) => [styles.modalBtnPrimary, { opacity: pressed ? 0.85 : 1 }]}
              onPress={() => {
                dismissRestoreComplete();
                invalidateAll();
              }}
            >
              <Text style={styles.modalBtnText}>OK</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showLegalModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowLegalModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxWidth: 380, gap: 0, maxHeight: "85%" }]}>
           <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
            {legalResult && (
              <>
                <View style={styles.legalModalHeader}>
                  <View style={[styles.legalModalStatusBadge, { backgroundColor: getLegalStatusColor(legalResult.status) + "18" }]}>
                    <Ionicons
                      name={legalResult.status === "legal" ? "shield-checkmark" : legalResult.status === "advertencia" ? "warning" : "alert-circle"}
                      size={28}
                      color={getLegalStatusColor(legalResult.status)}
                    />
                  </View>
                  <Text style={[styles.legalModalStatus, { color: getLegalStatusColor(legalResult.status) }]}>
                    {getLegalStatusLabel(legalResult.status)}
                  </Text>
                  <Text style={styles.legalModalSubtitle}>{t("dashboard.legalAnalysis")}</Text>
                </View>

                <View style={styles.legalModalStats}>
                  <View style={styles.legalModalStatRow}>
                    <Text style={styles.legalModalStatLabel}>{t("dashboard.weeklyCond")}</Text>
                    <Text style={styles.legalModalStatValue}>{formatMinutosHoras(legalResult.conduccionSemanalMin)} / 56h</Text>
                  </View>
                  <View style={styles.legalModalStatRow}>
                    <Text style={styles.legalModalStatLabel}>{t("dashboard.biweeklyCond")}</Text>
                    <Text style={styles.legalModalStatValue}>{formatMinutosHoras(legalResult.conduccionBisemanalMin)} / 90h</Text>
                  </View>
                  <View style={styles.legalModalStatRow}>
                    <Text style={styles.legalModalStatLabel}>{t("dashboard.extensions10h")}</Text>
                    <Text style={styles.legalModalStatValue}>{legalResult.extensiones10hSemana} / 2</Text>
                  </View>
                  <View style={styles.legalModalStatRow}>
                    <Text style={styles.legalModalStatLabel}>{t("dashboard.reducedDesc")}</Text>
                    <Text style={styles.legalModalStatValue}>{legalResult.descansosReducidosSemana} / 3</Text>
                  </View>
                </View>

                {legalResult.infractions.length > 0 && (
                  <View style={styles.legalModalSection}>
                    <Text style={[styles.legalModalSectionTitle, { color: Colors.light.danger }]}>{t("dashboard.infractions")}</Text>
                    {legalResult.infractions.map((inf, i) => (
                      <View key={i} style={styles.legalModalItem}>
                        <View style={styles.legalModalItemHeader}>
                          <Ionicons name="alert-circle" size={14} color={getSeverityColor(inf.severity as any)} />
                          <View style={[styles.legalModalSeverityBadge, { backgroundColor: getSeverityColor(inf.severity as any) + "18" }]}>
                            <Text style={[styles.legalModalSeverityText, { color: getSeverityColor(inf.severity as any) }]}>
                              {getSeverityLabel(inf.severity as any)}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.legalModalItemText}>{inf.description}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {legalResult.warnings.length > 0 && (
                  <View style={styles.legalModalSection}>
                    <Text style={[styles.legalModalSectionTitle, { color: Colors.light.warning }]}>{t("dashboard.warnings")}</Text>
                    {legalResult.warnings.map((w, i) => (
                      <View key={i} style={styles.legalModalItem}>
                        <View style={styles.legalModalItemHeader}>
                          <Ionicons name="warning" size={14} color={Colors.light.warning} />
                        </View>
                        <Text style={styles.legalModalItemText}>{w.description}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {legalResult.infractions.length === 0 && legalResult.warnings.length === 0 && (
                  <View style={styles.legalModalSection}>
                    <View style={styles.legalModalAllClear}>
                      <Ionicons name="checkmark-circle" size={20} color={Colors.light.success} />
                      <Text style={styles.legalModalAllClearText}>{t("dashboard.allClear")}</Text>
                    </View>
                  </View>
                )}
              </>
            )}

            {closePlanData && (
              <View style={styles.legalModalSection}>
                <Text style={[styles.legalModalSectionTitle, { color: Colors.light.tint }]}>{t("dashboard.restPlan")}</Text>

                <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.textSecondary, marginTop: 4, marginBottom: 4 }}>{t("dashboard.dailyRest")}</Text>
                <View style={{ flexDirection: "row" as const, gap: 8, marginBottom: 10 }}>
                  {closePlanData.restOptions.filter(o => o.type === "daily").map((opt) => (
                    <Pressable
                      key={opt.minutes}
                      style={[
                        {
                          flex: 1,
                          paddingVertical: 12,
                          borderRadius: 10,
                          alignItems: "center" as const,
                          borderWidth: 2,
                          borderColor: chosenRest === opt.minutes ? Colors.light.tint : Colors.light.border,
                          backgroundColor: chosenRest === opt.minutes ? Colors.light.tint + "10" : Colors.light.background,
                          opacity: opt.enabled ? 1 : 0.4,
                        },
                      ]}
                      onPress={() => opt.enabled && setChosenRest(opt.minutes)}
                      disabled={!opt.enabled}
                    >
                      <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: chosenRest === opt.minutes ? Colors.light.tint : Colors.light.text }}>
                        {opt.label}
                      </Text>
                      {!opt.enabled && (
                        <Text style={{ fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.light.danger, marginTop: 2 }}>
                          {t("dashboard.notAvailable")}
                        </Text>
                      )}
                    </Pressable>
                  ))}
                </View>

                <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.textSecondary, marginBottom: 4 }}>{t("dashboard.weeklyRest")}</Text>
                <View style={{ flexDirection: "row" as const, gap: 8, marginBottom: 8 }}>
                  {closePlanData.restOptions.filter(o => o.type === "weekly").map((opt) => (
                    <Pressable
                      key={opt.minutes}
                      style={[
                        {
                          flex: 1,
                          paddingVertical: 12,
                          borderRadius: 10,
                          alignItems: "center" as const,
                          borderWidth: 2,
                          borderColor: chosenRest === opt.minutes ? Colors.light.tint : Colors.light.border,
                          backgroundColor: chosenRest === opt.minutes ? Colors.light.tint + "10" : Colors.light.background,
                          opacity: opt.enabled ? 1 : 0.4,
                        },
                      ]}
                      onPress={() => opt.enabled && setChosenRest(opt.minutes)}
                      disabled={!opt.enabled}
                    >
                      <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: chosenRest === opt.minutes ? Colors.light.tint : Colors.light.text }}>
                        {opt.label}
                      </Text>
                      {opt.generatesDebt && (
                        <Text style={{ fontSize: 10, fontFamily: "Inter_400Regular", color: "#F59E0B", marginTop: 2 }}>
                          {t("dashboard.generatesDebtLabel")}
                        </Text>
                      )}
                    </Pressable>
                  ))}
                </View>

                {chosenRest && closePlanData.restOptions.find(o => o.minutes === chosenRest) && (() => {
                  const opt = closePlanData.restOptions.find(o => o.minutes === chosenRest)!;
                  return (
                    <View style={{ backgroundColor: Colors.light.background, borderRadius: 10, padding: 12, gap: 6 }}>
                      <View style={{ gap: 2 }}>
                        <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.light.textSecondary }}>{t("dashboard.canStartOn")}</Text>
                        <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.light.tint }}>{opt.nextStartTime}</Text>
                      </View>
                      {opt.type === "daily" && (
                        <>
                          <View style={{ flexDirection: "row" as const, justifyContent: "space-between" as const }}>
                            <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.light.textSecondary }}>{t("dashboard.availabilityTomorrow")}</Text>
                            <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>{formatMinutosHoras(opt.tomorrowMaxDutyMin)}</Text>
                          </View>
                          <View style={{ flexDirection: "row" as const, justifyContent: "space-between" as const }}>
                            <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.light.textSecondary }}>{t("dashboard.drivingTomorrow")}</Text>
                            <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>{formatMinutosHoras(opt.tomorrowMaxDriveMin)}</Text>
                          </View>
                        </>
                      )}
                      {opt.type === "weekly" && opt.generatesDebt && (
                        <View style={{ backgroundColor: "#F59E0B" + "15", borderRadius: 8, padding: 8, marginTop: 4, flexDirection: "row" as const, alignItems: "center" as const, gap: 6 }}>
                          <Ionicons name="warning" size={14} color="#F59E0B" />
                          <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#92400E" }}>
                            {t("dashboard.generatesDebt")} {formatMinutosHoras(opt.debtMinutes || 0)}. {t("dashboard.mustCompensate3w")}
                          </Text>
                        </View>
                      )}
                      {opt.type === "weekly" && !opt.generatesDebt && (
                        <View style={{ backgroundColor: "#10B981" + "15", borderRadius: 8, padding: 8, marginTop: 4, flexDirection: "row" as const, alignItems: "center" as const, gap: 6 }}>
                          <Ionicons name="checkmark-circle" size={14} color="#10B981" />
                          <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#065F46" }}>
                            {t("dashboard.weeklyRestComplete")}
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                })()}

                {closePlanData.biweeklyRemainMin < 10 * 60 && (
                  <View style={{ backgroundColor: Colors.light.danger + "15", borderRadius: 8, padding: 10, marginTop: 6, flexDirection: "row" as const, alignItems: "center" as const, gap: 6 }}>
                    <Ionicons name="alert-circle" size={16} color={Colors.light.danger} />
                    <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.danger }}>
                      Restante bisemanal bajo: {formatMinutosHoras(closePlanData.biweeklyRemainMin)}
                    </Text>
                  </View>
                )}
              </View>
            )}

            <Pressable
              style={({ pressed }) => [styles.modalBtnPrimary, { opacity: pressed ? 0.85 : 1, marginTop: 16 }]}
              onPress={async () => {
                if (chosenRest && closedJornadaId) {
                  const opt = closePlanData?.restOptions.find(o => o.minutes === chosenRest);
                  if (opt) {
                    await updateJornadaPlannedRest(closedJornadaId, chosenRest, opt.type);
                    invalidateAll();
                    triggerSync();
                  }
                }
                setShowLegalModal(false);
              }}
            >
              <Text style={styles.modalBtnText}>{t("common.understood")}</Text>
            </Pressable>
           </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showStartPlan} transparent animationType="slide" onRequestClose={() => setShowStartPlan(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxWidth: 380, gap: 0, maxHeight: "85%" }]}>
           <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
            {startPlanData && (
              <>
                <View style={styles.legalModalHeader}>
                  <View style={[styles.legalModalStatusBadge, { backgroundColor: Colors.light.tint + "18" }]}>
                    <Ionicons name="calendar" size={28} color={Colors.light.tint} />
                  </View>
                  <Text style={[styles.legalModalStatus, { color: Colors.light.tint }]}>{t("dashboard.todayPlan")}</Text>
                  <Text style={styles.legalModalSubtitle}>{t("dashboard.availabilityAndLimits")}</Text>
                </View>

                <View style={styles.legalModalStats}>
                  {startPlanData.prevRestMin != null && (
                    <View style={styles.legalModalStatRow}>
                      <Text style={styles.legalModalStatLabel}>{t("dashboard.previousRest")}</Text>
                      <Text style={[styles.legalModalStatValue, {
                        color: startPlanData.prevRestType === "INFRACCION_DESCANSO" ? Colors.light.danger
                          : startPlanData.prevRestType === "DESCANSO_DIARIO_REDUCIDO" ? Colors.light.warning
                          : Colors.light.success,
                      }]}>{formatMinutosHoras(startPlanData.prevRestMin)}</Text>
                    </View>
                  )}
                  <View style={styles.legalModalStatRow}>
                    <Text style={styles.legalModalStatLabel}>{t("dashboard.drivingAvailableToday")}</Text>
                    <Text style={styles.legalModalStatValue}>{formatMinutosHoras(startPlanData.maxDriveTodayMin)}</Text>
                  </View>
                  <View style={styles.legalModalStatRow}>
                    <Text style={styles.legalModalStatLabel}>{t("dashboard.extension10h")}</Text>
                    <Text style={[styles.legalModalStatValue, { color: startPlanData.canUseExtension ? Colors.light.success : Colors.light.textSecondary }]}>
                      {startPlanData.canUseExtension ? `${t("common.yes")} (${startPlanData.extensionsUsed}/2)` : `${t("common.no")} (${startPlanData.extensionsUsed}/2)`}
                    </Text>
                  </View>
                  <View style={styles.legalModalStatRow}>
                    <Text style={styles.legalModalStatLabel}>{t("dashboard.availabilityToday")}</Text>
                    <Text style={styles.legalModalStatValue}>{formatMinutosHoras(startPlanData.dayMaxDutyMin)}</Text>
                  </View>
                  {startPlanData.maxDutyLimitTime && (
                    <View style={{ paddingVertical: 8, paddingHorizontal: 14 }}>
                      <Text style={styles.legalModalStatLabel}>{t("dashboard.timeLimit")}</Text>
                      <Text style={[styles.legalModalStatValue, { color: Colors.light.warning, marginTop: 2 }]}>
                        {startPlanData.maxDutyLimitTime}
                      </Text>
                    </View>
                  )}
                  <View style={styles.legalModalStatRow}>
                    <Text style={styles.legalModalStatLabel}>{t("dashboard.remainingWeekly")}</Text>
                    <Text style={styles.legalModalStatValue}>{formatMinutosHoras(startPlanData.weeklyRemainMin)}</Text>
                  </View>
                  <View style={styles.legalModalStatRow}>
                    <Text style={styles.legalModalStatLabel}>{t("dashboard.remainingBiweekly")}</Text>
                    <Text style={styles.legalModalStatValue}>{formatMinutosHoras(startPlanData.biweeklyRemainMin)}</Text>
                  </View>
                  <View style={styles.legalModalStatRow}>
                    <Text style={styles.legalModalStatLabel}>{t("dashboard.reducedRestsUsed")}</Text>
                    <Text style={styles.legalModalStatValue}>{startPlanData.reducedRestsUsed} / 3</Text>
                  </View>
                </View>

                {startPlanData.warnings.length > 0 && (
                  <View style={styles.legalModalSection}>
                    <Text style={[styles.legalModalSectionTitle, { color: Colors.light.warning }]}>{t("dashboard.warnings")}</Text>
                    {startPlanData.warnings.map((w, i) => (
                      <View key={i} style={styles.legalModalItem}>
                        <View style={styles.legalModalItemHeader}>
                          <Ionicons name="warning" size={14} color={Colors.light.warning} />
                        </View>
                        <Text style={styles.legalModalItemText}>{w}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}
            <Pressable
              style={({ pressed }) => [styles.modalBtnPrimary, { opacity: pressed ? 0.85 : 1, marginTop: 16 }]}
              onPress={() => setShowStartPlan(false)}
            >
              <Text style={styles.modalBtnText}>{t("common.understood")}</Text>
            </Pressable>
           </ScrollView>
          </View>
        </View>
      </Modal>



      <Modal visible={showFerryFinishModal} transparent animationType="slide" onRequestClose={() => setShowFerryFinishModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxWidth: 400, gap: 0 }]}>
            {(() => {
              if (!lastClosed?.endAt) return null;
              const endDateTimeStr = `${ferryFinishEndDate}T${ferryFinishEndTime}:00`;
              const endDt = new Date(endDateTimeStr);
              const startMs = new Date(lastClosed.endAt).getTime();
              const endMs = endDt.getTime();
              const ints = lastClosed.ferryInterruptions || [];
              let intTotalMs = 0;
              for (const ii of ints) {
                if (!ii.start) continue;
                const iEnd = ii.end ? new Date(ii.end).getTime() : endMs;
                intTotalMs += Math.max(0, iEnd - new Date(ii.start).getTime());
              }
              const intTotalMin = Math.round(intTotalMs / 60000);
              const elapsedMin = Math.max(0, (endMs - startMs) / 60000);
              const effMin = Math.round(Math.max(0, elapsedMin - intTotalMin));
              const effH = Math.floor(effMin / 60);
              const effM = effMin % 60;

              let classification = "";
              let classColor = Colors.light.danger;
              let classIcon: "alert-circle" | "checkmark-circle" | "time-outline" = "alert-circle";
              let restTypeLabel = "";
              if (effMin >= 45 * 60) {
                classification = t("ferry.finishModal.weeklyComplete");
                classColor = Colors.light.success;
                classIcon = "checkmark-circle";
                restTypeLabel = "DESCANSO_SEMANAL_COMPLETO";
              } else if (effMin >= 24 * 60) {
                classification = t("ferry.finishModal.weeklyReduced");
                classColor = Colors.light.warning;
                classIcon = "time-outline";
                restTypeLabel = "DESCANSO_SEMANAL_REDUCIDO";
              } else if (effMin >= 660) {
                classification = t("ferry.finishModal.dailyComplete");
                classColor = Colors.light.success;
                classIcon = "checkmark-circle";
                restTypeLabel = "DESCANSO_DIARIO_COMPLETO";
              } else if (effMin >= 540) {
                classification = t("ferry.finishModal.dailyReduced");
                classColor = Colors.light.warning;
                classIcon = "time-outline";
                restTypeLabel = "DESCANSO_DIARIO_REDUCIDO";
              } else {
                classification = t("ferry.finishModal.insufficient");
                classColor = Colors.light.danger;
                classIcon = "alert-circle";
                restTypeLabel = "INSUFICIENTE";
              }

              const isValidTime = !isNaN(endDt.getTime()) && endMs > startMs;

              return (
                <>
                  <View style={{ flexDirection: "row" as const, alignItems: "center" as const, gap: 10, marginBottom: 16 }}>
                    <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.light.tint + "18", alignItems: "center" as const, justifyContent: "center" as const }}>
                      <MaterialCommunityIcons name="ferry" size={24} color={Colors.light.tint} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 18, color: Colors.light.text }}>{t("ferry.finishModal.title")}</Text>
                      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.light.textSecondary }}>
                        {t("ferry.restStarted")}: {new Date(lastClosed.endAt).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </Text>
                    </View>
                  </View>

                  <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.light.textSecondary, marginBottom: 6 }}>{t("ferry.finishModal.endTime")}</Text>
                  <View style={{ flexDirection: "row" as const, gap: 8, marginBottom: 16 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: "Inter_500Medium", fontSize: 11, color: Colors.light.textSecondary, marginBottom: 4 }}>{t("common.date")}</Text>
                      <TextInput
                        style={[styles.input, { fontSize: 15, textAlign: "center" as const }]}
                        value={ferryFinishEndDate}
                        onChangeText={setFerryFinishEndDate}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor="#9CA3AF"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: "Inter_500Medium", fontSize: 11, color: Colors.light.textSecondary, marginBottom: 4 }}>{t("common.time")}</Text>
                      <TextInput
                        style={[styles.input, { fontSize: 15, textAlign: "center" as const }]}
                        value={ferryFinishEndTime}
                        onChangeText={setFerryFinishEndTime}
                        placeholder="HH:MM"
                        placeholderTextColor="#9CA3AF"
                      />
                    </View>
                  </View>

                  <View style={{ backgroundColor: classColor + "14", borderRadius: 10, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: classColor + "30" }}>
                    <View style={{ flexDirection: "row" as const, alignItems: "center" as const, gap: 8, marginBottom: 8 }}>
                      <Ionicons name={classIcon} size={22} color={classColor} />
                      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: classColor }}>{classification}</Text>
                    </View>
                    <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.light.text }}>
                      {t("ferry.finishModal.effectiveRest")}: {effH}h {effM > 0 ? `${effM}m` : ""}
                    </Text>
                    {intTotalMin > 0 && (
                      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.light.textSecondary, marginTop: 4 }}>
                        {t("ferry.interruptionsUsed")}: {ints.length} ({intTotalMin}m)
                      </Text>
                    )}
                    {!isValidTime && (
                      <Text style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.light.danger, marginTop: 6 }}>
                        {t("ferry.invalidTime")}
                      </Text>
                    )}
                  </View>

                  {(ferryTransitDiet > 0 || ferryCabinOvernight > 0 || ferryCountryChange) && (
                    <View style={{ backgroundColor: Colors.light.surface, borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: Colors.light.border }}>
                      <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.light.text, marginBottom: 6 }}>{t("ferry.extras")}</Text>
                      {ferryTransitDiet > 0 && (
                        <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textSecondary }}>
                          {t("ferry.transitDiet")}: {ferryTransitDiet} × {ferryConfig.transitRate.toFixed(2)}€ = {(ferryTransitDiet * ferryConfig.transitRate).toFixed(2)}€
                        </Text>
                      )}
                      {ferryCabinOvernight > 0 && (
                        <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textSecondary }}>
                          {t("ferry.cabinOvernight")}: {ferryCabinOvernight} × {ferryConfig.cabinRate.toFixed(2)}€ = {(ferryCabinOvernight * ferryConfig.cabinRate).toFixed(2)}€
                        </Text>
                      )}
                      {ferryCountryChange && (
                        <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textSecondary }}>
                          {t("ferry.countryChange")}: ✓
                        </Text>
                      )}
                    </View>
                  )}

                  <View style={{ flexDirection: "row" as const, gap: 10 }}>
                    <Pressable
                      style={({ pressed }) => [{ flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center" as const, backgroundColor: Colors.light.surface, borderWidth: 1, borderColor: Colors.light.border, opacity: pressed ? 0.85 : 1 }]}
                      onPress={() => setShowFerryFinishModal(false)}
                    >
                      <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.light.textSecondary }}>{t("ferry.finishModal.cancel")}</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [{ flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center" as const, backgroundColor: isValidTime ? Colors.light.tint : Colors.light.border, opacity: pressed ? 0.85 : 1 }]}
                      disabled={!isValidTime}
                      onPress={async () => {
                        try {
                          const finishIso = new Date(`${ferryFinishEndDate}T${ferryFinishEndTime}:00`).toISOString();
                          const finalInts = (lastClosed.ferryInterruptions || []).map((i: FerryInterruption) => i.end === null ? { ...i, end: finishIso } : i);
                          const finalIntTotalMin = getFerryInterruptionsTotalMin(finalInts);
                          const isValid = effMin >= (lastClosed.ferryRestType === "9h" ? 540 : 660);
                          const hasAnyExtras = ferryTransitDiet > 0 || ferryCabinOvernight > 0 || ferryCountryChange;
                          const extras: FerryExtras | null = hasAnyExtras ? { transitDiet: ferryTransitDiet, cabinOvernight: ferryCabinOvernight, countryChange: ferryCountryChange } : null;
                          const endAtDate = new Date(lastClosed.endAt!);
                          const ferryFecha = `${endAtDate.getFullYear()}-${String(endAtDate.getMonth() + 1).padStart(2, "0")}-${String(endAtDate.getDate()).padStart(2, "0")}`;

                          await addFerryRest({
                            fecha: ferryFecha,
                            startTime: lastClosed.endAt!,
                            endTime: finishIso,
                            restType: lastClosed.ferryRestType || "9h",
                            interruptions: finalInts,
                            interruptionTotalMin: finalIntTotalMin,
                            accumulatedRestMin: effMin,
                            linkedJornadaId: lastClosed.id,
                            isValid,
                            isComplete: true,
                            invalidReason: isValid ? null : "insufficient_rest",
                            destination: ferryDestination.trim() || undefined,
                            ferryExtras: extras,
                          });

                          await updateJornadaFerryData(lastClosed.id, {
                            ferryExtras: extras,
                            ferryDestination: ferryDestination.trim() || null,
                            ferryInterruptions: finalInts,
                            ferryRestCompleted: true,
                          });

                          if (restTypeLabel && restTypeLabel !== "INSUFICIENTE") {
                            await updateJornadaFerryData(lastClosed.id, {
                              ferryRestCompleted: true,
                            });
                          }

                          if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                          setShowFerryFinishModal(false);
                          setFerryJustClosed(null);
                          invalidateAll();
                          triggerSync();
                        } catch (e) {
                          console.error("[Ferry] Finish error:", e);
                          Alert.alert(t("common.error"), String(e));
                        }
                      }}
                    >
                      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" }}>{t("ferry.finishModal.confirm")}</Text>
                    </Pressable>
                  </View>
                </>
              );
            })()}
          </View>
        </View>
      </Modal>

      <OnboardingGuide visible={showGuide} onClose={() => setShowGuide(false)} />

      {user?.email === "yosf.bouncy@gmail.com" && (
        <DebugSimulator onDataChanged={invalidateAll} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === "web" ? 34 : 0,
  },
  header: {
    paddingVertical: 16,
  },
  headerRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
  },
  headerTitle: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    color: Colors.light.tint,
  },
  headerSubtitle: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  alertSection: {
    gap: 6,
    marginBottom: 12,
  },
  alertBanner: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  alertText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  legalPanel: {
    backgroundColor: Colors.light.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  legalHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginBottom: 14,
  },
  legalTitle: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: Colors.light.tint,
  },
  kpiRow: {
    flexDirection: "row" as const,
    gap: 12,
    marginBottom: 14,
  },
  kpiBox: {
    flex: 1,
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    padding: 12,
    alignItems: "center" as const,
  },
  kpiLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.textSecondary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  kpiValue: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
    marginTop: 4,
  },
  kpiSub: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
  },
  kpiRemain: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: Colors.light.success,
    marginTop: 4,
  },
  progressBg: {
    height: 4,
    borderRadius: 2,
    width: "100%" as const,
    marginTop: 6,
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
  },
  disponibilidadRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    backgroundColor: Colors.light.background,
    borderRadius: 10,
    padding: 12,
    gap: 8,
    marginBottom: 8,
  },
  disponibilidadLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: Colors.light.textSecondary,
    flex: 1,
  },
  disponibilidadValue: {
    fontFamily: "Inter_700Bold",
    fontSize: 22,
    color: Colors.light.tint,
  },
  recomendacionRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    backgroundColor: "#EFF6FF",
    borderRadius: 8,
    padding: 10,
    gap: 8,
    marginTop: 8,
  },
  recomendacionText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.light.accent,
    flex: 1,
  },
  legalRow: {
    flexDirection: "row" as const,
    gap: 12,
  },
  legalItem: {
    flex: 1,
    backgroundColor: Colors.light.background,
    borderRadius: 10,
    padding: 10,
  },
  legalItemHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    marginBottom: 4,
  },
  legalItemLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: Colors.light.textSecondary,
  },
  legalItemValue: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
  },
  compSection: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
    paddingTop: 12,
  },
  compSectionDanger: {
    borderTopColor: Colors.light.danger,
  },
  compTitle: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    color: Colors.light.accent,
    marginBottom: 8,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  compSummary: {
    backgroundColor: Colors.light.background,
    borderRadius: 10,
    padding: 12,
    gap: 6,
    marginBottom: 8,
  },
  compSummaryRow: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
  },
  compSummaryLabel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
  },
  compSummaryValue: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
  },
  compSummaryDate: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
  },
  compDetalle: {
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    padding: 10,
    gap: 4,
    marginBottom: 8,
  },
  compDetalleRow: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
  },
  compDetalleFecha: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
  },
  compDetalleDeuda: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
  },
  compBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.success,
  },
  compBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.success,
  },
  loadingCard: {
    backgroundColor: Colors.light.surface,
    borderRadius: 16,
    padding: 32,
    alignItems: "center" as const,
  },
  card: {
    backgroundColor: Colors.light.surface,
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
  },
  openInfo: {
    backgroundColor: Colors.light.accentLight,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  openInfoText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.light.accent,
    flex: 1,
  },
  fieldRow: {
    flexDirection: "row" as const,
    gap: 12,
    marginBottom: 8,
  },
  fieldHalf: {
    flex: 1,
  },
  field: {
    marginBottom: 8,
  },
  fieldLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: Colors.light.textSecondary,
    marginBottom: 4,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: Colors.light.background,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: Colors.light.text,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  segmentRow: {
    flexDirection: "row" as const,
    gap: 6,
    marginBottom: 8,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.light.background,
    alignItems: "center" as const,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  segmentFlex: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.light.background,
    alignItems: "center" as const,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  segmentSmall: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.light.background,
    alignItems: "center" as const,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  segmentActive: {
    backgroundColor: Colors.light.tint,
    borderColor: Colors.light.tint,
  },
  segmentText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.light.text,
  },
  segmentTextSmall: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: Colors.light.text,
  },
  segmentTextActive: {
    color: "#fff",
  },
  manualSection: {
    marginTop: 4,
  },
  dietaPreview: {
    backgroundColor: Colors.light.background,
    borderRadius: 10,
    padding: 12,
    marginTop: 4,
    gap: 4,
  },
  dietaPreviewRow: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
  },
  dietaPreviewLabel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
  },
  dietaPreviewValue: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
  },
  dietaPreviewTotal: {
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
    paddingTop: 6,
    marginTop: 4,
  },
  dietaPreviewTotalLabel: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    color: Colors.light.tint,
  },
  dietaPreviewTotalValue: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: Colors.light.tint,
  },
  btnPrimary: {
    backgroundColor: Colors.light.success,
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    marginTop: 8,
  },
  btnDanger: {
    backgroundColor: Colors.light.tint,
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    marginTop: 8,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  btnOutline: {
    borderWidth: 1.5,
    borderColor: Colors.light.tint,
    borderRadius: 12,
    paddingVertical: 12,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    marginTop: 12,
    backgroundColor: Colors.light.surface,
  },
  btnOutlineText: {
    color: Colors.light.tint,
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  onboardingCard: {
    backgroundColor: "#EFF6FF",
    borderRadius: 14,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  onboardingHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
  },
  onboardingTitle: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    color: Colors.light.tint,
  },
  onboardingText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.light.text,
    lineHeight: 18,
  },
  onboardingBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
    backgroundColor: Colors.light.tint,
    borderRadius: 8,
    paddingVertical: 10,
    marginTop: 4,
  },
  onboardingBtnText: {
    color: "#fff",
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  syncInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  syncInfoText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
  },
  syncPendingBadge: {
    backgroundColor: Colors.light.accentLight,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 6,
  },
  syncPendingText: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    color: Colors.light.accent,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    backgroundColor: Colors.light.surface,
    borderRadius: 20,
    padding: 28,
    width: "100%",
    maxWidth: 340,
    gap: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
    textAlign: "center",
  },
  modalText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  modalBtnPrimary: {
    backgroundColor: Colors.light.tint,
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 8,
  },
  modalBtnText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  modalBtnSecondary: {
    paddingVertical: 10,
    alignItems: "center",
  },
  modalBtnSecondaryText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: Colors.light.textSecondary,
  },
  restoreProgressBar: {
    height: 8,
    backgroundColor: Colors.light.border,
    borderRadius: 4,
    overflow: "hidden",
    marginTop: 8,
  },
  restoreProgressFill: {
    height: "100%",
    backgroundColor: Colors.light.tint,
    borderRadius: 4,
  },
  restoreProgressLabel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    textAlign: "center",
  },
  restoreProgressPct: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    color: Colors.light.tint,
    textAlign: "center",
  },
  legalPreviewGrid: {
    flexDirection: "row" as const,
    gap: 12,
    marginBottom: 10,
  },
  legalPreviewItem: {
    flex: 1,
    backgroundColor: Colors.light.background,
    borderRadius: 10,
    padding: 10,
    alignItems: "center" as const,
  },
  legalPreviewLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.textSecondary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  legalPreviewValue: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
    marginTop: 2,
  },
  legalPreviewSub: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    marginTop: 2,
  },
  legalPreviewChips: {
    flexDirection: "row" as const,
    gap: 8,
    flexWrap: "wrap" as const,
  },
  legalPreviewChip: {
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  legalPreviewChipText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: Colors.light.textSecondary,
  },
  legalPreviewWarnings: {
    marginTop: 10,
    gap: 4,
  },
  legalPreviewWarningRow: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: 6,
  },
  legalPreviewWarningText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.light.warning,
    flex: 1,
    lineHeight: 16,
  },
  legalModalHeader: {
    alignItems: "center" as const,
    gap: 6,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  legalModalStatusBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  legalModalStatus: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
  },
  legalModalSubtitle: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
  },
  legalModalStats: {
    backgroundColor: Colors.light.background,
    borderRadius: 10,
    padding: 12,
    gap: 6,
    marginTop: 14,
  },
  legalModalStatRow: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
  },
  legalModalStatLabel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
  },
  legalModalStatValue: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
  },
  legalModalSection: {
    marginTop: 12,
    gap: 6,
  },
  legalModalSectionTitle: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  legalModalItem: {
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  legalModalItemHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  legalModalSeverityBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  legalModalSeverityText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase" as const,
  },
  legalModalItemText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.light.text,
    lineHeight: 18,
  },
  legalModalAllClear: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    backgroundColor: Colors.light.success + "10",
    borderRadius: 10,
    padding: 14,
  },
  legalModalAllClearText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: Colors.light.success,
    flex: 1,
  },
  plusSection: {
    marginTop: 8,
    gap: 6,
  },
  plusItemRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  plusItemText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.light.text,
  },
  plusItemAmount: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.accent,
  },
  plusAddRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  plusTotal: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.tint,
    textAlign: "right" as const,
    marginTop: 2,
  },
  bigActionBtn: {
    backgroundColor: Colors.light.surface,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    marginBottom: 8,
  },
  bigActionBtnStart: {
    borderWidth: 1.5,
    borderColor: Colors.light.success + "40",
  },
  bigActionBtnStop: {
    borderWidth: 1.5,
    borderColor: Colors.light.danger + "40",
  },
  bigActionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.light.success + "15",
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  bigActionTitle: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
  },
  bigActionSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    marginTop: 1,
  },
  ferryDashCard: {
    backgroundColor: Colors.light.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  ferryDashHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginBottom: 8,
  },
  ferryDashTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
  },
  ferryDashStatus: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    marginBottom: 10,
  },
  ferryDashStatusText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  ferryDashEmpty: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    marginBottom: 10,
  },
  ferryDashBtn: {
    backgroundColor: Colors.light.tint,
    borderRadius: 8,
    paddingVertical: 10,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
  },
  ferryDashBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
});
