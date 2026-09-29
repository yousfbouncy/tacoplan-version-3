import { useState, useEffect, useMemo, useRef } from "react";
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
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import {
  detectCrossSundayMonday,
  isSpainSummerTime,
  formatDateForDisplay,
  formatMinutosHoras,
  parseDisplayDateToISO,
} from "@/lib/utils";
import {
  editarJornada,
  getJornadaById,
  calcDietaWithCustomRates,
  calcDietaManualWithRates,
  calcDayExtra,
  detectDayFlag,
  getRecentPlaces,
  addRecentPlace,
  type Jornada,
  type UserDietRate,
  type UserDayExtras,
  type PlusItem,
} from "@/lib/local-storage";
import { useAuth } from "@/lib/auth-context";
import { useSync } from "@/lib/sync-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useI18n } from "@/lib/i18n-context";
import { userScopedKey } from "@/lib/user-scope";
import { fetchDayExtras, fetchDietRates, fetchHolidays } from "@/lib/user-cloud";

type TipoRuta = "NACIONAL" | "INTERNACIONAL" | "REGIONAL_INTL" | "NAC_INTL" | "NAC_REGIONAL" | "NINGUNO" | "REGIONAL";
function reportJornadaDateDebug(hypothesisId: string, location: string, msg: string, data: Record<string, unknown>): void {
  void hypothesisId;
  void location;
  void msg;
  void data;
}
function parseConduccion(text: string): number | undefined {
  if (!text.trim()) return undefined;
  if (text.includes(":")) {
    const [h, m] = text.split(":");
    return (parseInt(h) || 0) * 60 + (parseInt(m) || 0);
  }
  const num = parseFloat(text);
  if (isNaN(num)) return undefined;
  return Math.round(num * 60);
}

function parseDrivingInput(text: string): { minutes: number | null; error: string | null } {
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

function minutosToStr(min: number | null): string {
  if (min == null) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (m === 0) return String(h);
  return `${h}:${String(m).padStart(2, "0")}`;
}

function parseNumberOrNull(text: string): number | null {
  const cleaned = text.trim().replace(",", ".");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

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
    <View style={sugStyles.container}>
      {filtered.map((place, i) => (
        <Pressable
          key={i}
          style={({ pressed }) => [
            sugStyles.item,
            pressed && { backgroundColor: Colors.light.background },
            i < filtered.length - 1 && sugStyles.itemBorder,
          ]}
          onPressIn={() => onSelect(place)}
        >
          <Ionicons name="time-outline" size={14} color={Colors.light.textSecondary} style={{ marginRight: 8 }} />
          <Text style={sugStyles.text} numberOfLines={1}>{place}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const sugStyles = StyleSheet.create({
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

export default function EditarJornadaScreen() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { triggerSync } = useSync();

  const jornadaQuery = useQuery<Jornada | null>({
    queryKey: ["jornada-edit", id],
    queryFn: () => getJornadaById(id || ""),
    enabled: !!id,
  });

  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaInicioInput, setFechaInicioInput] = useState("");
  const [horaInicio, setHoraInicio] = useState("");
  const [lugarInicio, setLugarInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [fechaFinInput, setFechaFinInput] = useState("");
  const [horaFin, setHoraFin] = useState("");
  const [lugarFin, setLugarFin] = useState("");
  const [splitRestManual, setSplitRestManual] = useState(false);
  const [tipoRuta, setTipoRuta] = useState<TipoRuta>("NACIONAL");
  const [conduccionHoras, setConduccionHoras] = useState("");
  const [conduccionDomingoHoras, setConduccionDomingoHoras] = useState("");
  const [conduccionLunesHoras, setConduccionLunesHoras] = useState("");
  const [pernocta, setPernocta] = useState(false);
  const [dietaModo, setDietaModo] = useState<"AUTO" | "MANUAL">("AUTO");
  const [manualTipo, setManualTipo] = useState<"NACIONAL" | "INTERNACIONAL">("INTERNACIONAL");
  const [manualPct, setManualPct] = useState<"100" | "60" | "30">("100");
  const [dietaPercent, setDietaPercent] = useState<number>(100);
  const [dayFlag, setDayFlag] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [recalcDiet, setRecalcDiet] = useState(false);
  const [frozenDiet, setFrozenDiet] = useState<{ importe: string; rule: string; calculatedAt: string; baseEur: string; extraEur: string } | null>(null);

  const [plusItems, setPlusItems] = useState<PlusItem[]>([]);
  const [plusConcepto, setPlusConcepto] = useState("");
  const [plusImporte, setPlusImporte] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [paymentMode, setPaymentMode] = useState<"dietas" | "km" | "viaje">("dietas");
  const [defaultPricePerKmNac, setDefaultPricePerKmNac] = useState(0);
  const [defaultPricePerKmIntl, setDefaultPricePerKmIntl] = useState(0);
  const [defaultPricePerKmReg, setDefaultPricePerKmReg] = useState(0);
  const [defaultPricePerTripNac, setDefaultPricePerTripNac] = useState(0);
  const [defaultPricePerTripIntl, setDefaultPricePerTripIntl] = useState(0);
  const [defaultPricePerTripReg, setDefaultPricePerTripReg] = useState(0);
  const [kmInicio, setKmInicio] = useState("");
  const [kmFin, setKmFin] = useState("");
  const [pricePerKm, setPricePerKm] = useState("");
  const [importeKm, setImporteKm] = useState("");
  const [importeKmTouched, setImporteKmTouched] = useState(false);
  const [pricePerTrip, setPricePerTrip] = useState("");
  const [importeViaje, setImporteViaje] = useState("");
  const [importeViajeTouched, setImporteViajeTouched] = useState(false);

  const [customRates, setCustomRates] = useState<UserDietRate[] | null>(null);
  const [dayExtras, setDayExtras] = useState<UserDayExtras>({
    extra_saturday: 0,
    extra_sunday: 0,
    extra_holiday: 0,
    offsite_weekly_reduced_nacional: 0,
    offsite_weekly_reduced_internacional: 0,
    offsite_weekly_complete_nacional: 0,
    offsite_weekly_complete_internacional: 0,
  });
  const [userHolidays, setUserHolidays] = useState<string[]>([]);

  const [recentPlaces, setRecentPlaces] = useState<string[]>([]);
  const [showLugarInicioSug, setShowLugarInicioSug] = useState(false);
  const [showLugarFinSug, setShowLugarFinSug] = useState(false);

  useEffect(() => {
    getRecentPlaces().then(setRecentPlaces);
  }, []);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const local = await AsyncStorage.getItem(await userScopedKey("tacoplan_user_settings", user?.id));
        if (local) {
          const s = JSON.parse(local);
          const pm = s.payment_mode === "km" || s.payment_mode === "viaje" || s.payment_mode === "dietas" ? s.payment_mode : "dietas";
          setPaymentMode(pm);
          const fallbackKm = Number.isFinite(parseFloat(s.price_per_km)) ? parseFloat(s.price_per_km) : 0;
          setDefaultPricePerKmNac(Number.isFinite(parseFloat(s.price_per_km_nacional)) ? parseFloat(s.price_per_km_nacional) : fallbackKm);
          setDefaultPricePerKmIntl(Number.isFinite(parseFloat(s.price_per_km_internacional)) ? parseFloat(s.price_per_km_internacional) : fallbackKm);
          setDefaultPricePerKmReg(Number.isFinite(parseFloat(s.price_per_km_regional)) ? parseFloat(s.price_per_km_regional) : fallbackKm);
          const tripFallback = Number.isFinite(parseFloat(s.price_per_trip)) ? parseFloat(s.price_per_trip) : 0;
          setDefaultPricePerTripNac(Number.isFinite(parseFloat(s.price_per_trip_nacional)) ? parseFloat(s.price_per_trip_nacional) : tripFallback);
          setDefaultPricePerTripIntl(Number.isFinite(parseFloat(s.price_per_trip_internacional)) ? parseFloat(s.price_per_trip_internacional) : tripFallback);
          setDefaultPricePerTripReg(Number.isFinite(parseFloat(s.price_per_trip_regional)) ? parseFloat(s.price_per_trip_regional) : tripFallback);
          setCustomRates([
            { trip_type: "NACIONAL", percent: 100, amount: Number.isFinite(parseFloat(s.nac_100)) ? parseFloat(s.nac_100) : 0 },
            { trip_type: "NACIONAL", percent: 60, amount: Number.isFinite(parseFloat(s.nac_60)) ? parseFloat(s.nac_60) : 0 },
            { trip_type: "NACIONAL", percent: 30, amount: Number.isFinite(parseFloat(s.nac_30)) ? parseFloat(s.nac_30) : 0 },
            { trip_type: "INTERNACIONAL", percent: 100, amount: Number.isFinite(parseFloat(s.intl_100)) ? parseFloat(s.intl_100) : 0 },
            { trip_type: "INTERNACIONAL", percent: 60, amount: Number.isFinite(parseFloat(s.intl_60)) ? parseFloat(s.intl_60) : 0 },
            { trip_type: "INTERNACIONAL", percent: 30, amount: Number.isFinite(parseFloat(s.intl_30)) ? parseFloat(s.intl_30) : 0 },
            { trip_type: "REGIONAL", percent: 100, amount: parseFloat(s.reg_100) || 0 },
            { trip_type: "REGIONAL", percent: 60, amount: parseFloat(s.reg_60) || 0 },
            { trip_type: "REGIONAL", percent: 30, amount: parseFloat(s.reg_30) || 0 },
          ]);
          setDayExtras({
            extra_saturday: Number.isFinite(parseFloat(s.extra_saturday)) ? parseFloat(s.extra_saturday) : 0,
            extra_sunday: Number.isFinite(parseFloat(s.extra_sunday)) ? parseFloat(s.extra_sunday) : 0,
            extra_holiday: Number.isFinite(parseFloat(s.extra_holiday)) ? parseFloat(s.extra_holiday) : 0,
            offsite_weekly_reduced_nacional: Number.isFinite(parseFloat(s.offsite_weekly_reduced_nacional)) ? parseFloat(s.offsite_weekly_reduced_nacional) : 0,
            offsite_weekly_reduced_internacional: Number.isFinite(parseFloat(s.offsite_weekly_reduced_internacional)) ? parseFloat(s.offsite_weekly_reduced_internacional) : 0,
            offsite_weekly_complete_nacional: Number.isFinite(parseFloat(s.offsite_weekly_complete_nacional)) ? parseFloat(s.offsite_weekly_complete_nacional) : 0,
            offsite_weekly_complete_internacional: Number.isFinite(parseFloat(s.offsite_weekly_complete_internacional)) ? parseFloat(s.offsite_weekly_complete_internacional) : 0,
          });
        }
      } catch (e) {
        console.log("Failed to load local settings:", e);
      }

      if (!user) return;
      try {
        const [rates, extras, holidays] = await Promise.all([
          fetchDietRates(user.id),
          fetchDayExtras(user.id),
          fetchHolidays(user.id),
        ]);
        if (rates.length > 0) setCustomRates(rates as any);
        setDayExtras(extras as any);
        setUserHolidays((holidays || []).map((h: any) => h.date));
      } catch (e) {
        console.error("[EDITAR JORNADA] Failed to load user config from Supabase", e);
      }
    };
    loadConfig();
  }, [user]);

  useEffect(() => {
    const j = jornadaQuery.data;
    if (j && !loaded) {
      setFechaInicio(j.fechaInicio);
      setFechaInicioInput(formatDateForDisplay(j.fechaInicio));
      setHoraInicio(j.horaInicio);
      setLugarInicio(j.lugarInicio);
      setFechaFin(j.fechaFin || "");
      setFechaFinInput(formatDateForDisplay(j.fechaFin || ""));
      setHoraFin(j.horaFin || "");
      setLugarFin(j.lugarFin || "");
      setSplitRestManual(
        j.splitRestDetected === true &&
        j.countsAsReducedRest === false &&
        (j.splitRestFirstPartMin ?? 0) >= 3 * 60,
      );
      setTipoRuta((j.tipoRuta as TipoRuta) || "NACIONAL");
      setConduccionHoras(minutosToStr(j.conduccionMin));
      if (j.conduccionDomingoMin != null) setConduccionDomingoHoras(minutosToStr(j.conduccionDomingoMin));
      if (j.conduccionLunesMin != null) setConduccionLunesHoras(minutosToStr(j.conduccionLunesMin));
      setPernocta(j.pernocta || false);
      setDietaModo((j.dietaModo as "AUTO" | "MANUAL") || "AUTO");
      setManualTipo((j.dietaManualTipo as "NACIONAL" | "INTERNACIONAL") || "INTERNACIONAL");
      setManualPct((j.dietaManualPct as "100" | "60" | "30") || "100");
      setDietaPercent(j.dietaPercent || 100);
      setDayFlag(j.dayFlag || "");
      if (j.dietCalculatedAt && j.fechaFin) {
        setFrozenDiet({
          importe: j.dietaImporteEur || "0",
          rule: j.dietRule || "",
          calculatedAt: j.dietCalculatedAt,
          baseEur: j.dietBaseEur || "0",
          extraEur: j.dayExtraEur || "0",
        });
      }
      setPlusItems(j.plusItems || []);
      setObservaciones(j.observaciones || "");
      if (j.paymentMode === "km" || j.paymentMode === "viaje" || j.paymentMode === "dietas") {
        setPaymentMode(j.paymentMode);
      }
      setKmInicio(j.kmInicio != null && Number.isFinite(j.kmInicio) ? String(j.kmInicio) : "");
      setKmFin(j.kmFin != null && Number.isFinite(j.kmFin) ? String(j.kmFin) : "");
      setPricePerKm(j.pricePerKm != null && Number.isFinite(j.pricePerKm) ? String(j.pricePerKm) : "");
      setImporteKm(j.importeKm != null && Number.isFinite(j.importeKm) ? String(j.importeKm) : "");
      setImporteKmTouched(false);
      setPricePerTrip(j.pricePerTrip != null && Number.isFinite(j.pricePerTrip) ? String(j.pricePerTrip) : "");
      setImporteViaje(j.importeViaje != null && Number.isFinite(j.importeViaje) ? String(j.importeViaje) : "");
      setImporteViajeTouched(false);
      setLoaded(true);
    }
  }, [jornadaQuery.data, loaded]);

  const dietaPreview = useMemo(() => {
    let result: { items: any[]; total: number };
    if (dietaModo === "MANUAL") {
      result = calcDietaManualWithRates(manualTipo, manualPct, customRates);
    } else {
      result = calcDietaWithCustomRates(tipoRuta, pernocta, dietaPercent, customRates);
    }
    const resolvedFlag = dayFlag === "NINGUNO" ? null : (dayFlag || detectDayFlag(fechaFin, userHolidays));
    const extra = calcDayExtra(resolvedFlag, dayExtras);
    return { base: result.total, extra, total: result.total + extra, flag: resolvedFlag, items: result.items };
  }, [tipoRuta, pernocta, dietaPercent, dietaModo, manualTipo, manualPct, customRates, dayExtras, dayFlag, fechaFin, userHolidays]);

  const isCrossSundayMonday = useMemo(() => {
    if (!fechaInicio || !fechaFin) return false;
    return detectCrossSundayMonday(fechaInicio, fechaFin);
  }, [fechaInicio, fechaFin]);

  const crossWeekTimeLabel = useMemo(() => {
    if (!fechaInicio) return "01:00";
    return isSpainSummerTime(fechaInicio) ? "02:00" : "01:00";
  }, [fechaInicio]);

  const conduccionDomingoParsed = useMemo(() => {
    const cleaned = conduccionDomingoHoras.trim();
    if (!cleaned) return { minutes: null as number | null, error: null as string | null };
    return parseDrivingInput(cleaned);
  }, [conduccionDomingoHoras]);

  const conduccionLunesParsed = useMemo(() => {
    const cleaned = conduccionLunesHoras.trim();
    if (!cleaned) return { minutes: null as number | null, error: null as string | null };
    return parseDrivingInput(cleaned);
  }, [conduccionLunesHoras]);

  const suggestedPricePerKm = useMemo(() => {
    if (tipoRuta === "INTERNACIONAL" || tipoRuta === "REGIONAL_INTL" || tipoRuta === "NAC_INTL") return defaultPricePerKmIntl;
    if (tipoRuta === "REGIONAL" || tipoRuta === "NAC_REGIONAL") return defaultPricePerKmReg;
    return defaultPricePerKmNac;
  }, [tipoRuta, defaultPricePerKmNac, defaultPricePerKmIntl, defaultPricePerKmReg]);

  const defaultTripRate = useMemo(() => {
    if (tipoRuta === "REGIONAL") return defaultPricePerTripReg;
    if (tipoRuta === "INTERNACIONAL" || tipoRuta === "REGIONAL_INTL" || tipoRuta === "NAC_INTL") return defaultPricePerTripIntl;
    return defaultPricePerTripNac;
  }, [tipoRuta, defaultPricePerTripNac, defaultPricePerTripIntl, defaultPricePerTripReg]);

  const lastAutoTripRateRef = useRef<number | null>(null);

  useEffect(() => {
    if (paymentMode !== "km") return;
    if (pricePerKm.trim()) return;
    setPricePerKm(suggestedPricePerKm ? String(suggestedPricePerKm) : "");
  }, [paymentMode, pricePerKm, suggestedPricePerKm]);

  useEffect(() => {
    if (paymentMode !== "viaje") return;
    const current = parseNumberOrNull(pricePerTrip);
    const lastAuto = lastAutoTripRateRef.current;
    if (pricePerTrip.trim() && (lastAuto == null || current == null || Math.abs(current - lastAuto) > 0.0001)) {
      return;
    }
    setPricePerTrip(defaultTripRate ? String(defaultTripRate) : "");
    lastAutoTripRateRef.current = defaultTripRate;
  }, [paymentMode, pricePerTrip, defaultTripRate]);

  const kmTotal = useMemo(() => {
    const start = parseNumberOrNull(kmInicio);
    const end = parseNumberOrNull(kmFin);
    if (start == null || end == null) return null;
    const total = end - start;
    return Number.isFinite(total) ? total : null;
  }, [kmInicio, kmFin]);

  const suggestedImporteKm = useMemo(() => {
    if (paymentMode !== "km") return null;
    if (kmTotal == null) return null;
    const price = parseNumberOrNull(pricePerKm);
    if (price == null) return null;
    return Math.round((kmTotal * price) * 100) / 100;
  }, [paymentMode, kmTotal, pricePerKm]);

  useEffect(() => {
    if (paymentMode !== "km") return;
    if (importeKmTouched) return;
    if (suggestedImporteKm == null) return;
    setImporteKm(String(suggestedImporteKm));
  }, [paymentMode, importeKmTouched, suggestedImporteKm]);

  useEffect(() => {
    if (paymentMode !== "viaje") return;
    if (importeViajeTouched) return;
    const current = parseNumberOrNull(importeViaje);
    const lastAuto = lastAutoTripRateRef.current;
    if (current != null && lastAuto != null && Math.abs(current - lastAuto) > 0.0001) return;
    const price = parseNumberOrNull(pricePerTrip);
    if (price == null) return;
    setImporteViaje(String(price));
  }, [paymentMode, importeViajeTouched, pricePerTrip, importeViaje]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error("ID no encontrado");
      const resolvedFechaInicio = parseDisplayDateToISO(fechaInicioInput);
      if (!resolvedFechaInicio) throw new Error(t("common.invalidDate"));
      const resolvedFechaFin = parseDisplayDateToISO(fechaFinInput);
      if (!resolvedFechaFin) throw new Error(t("common.invalidDate"));
      const body: any = {
        fechaInicio: resolvedFechaInicio,
        horaInicio,
        lugarInicio,
        fechaFin: resolvedFechaFin,
        horaFin,
        lugarFin,
        tipoRuta,
        pernocta,
        dietaModo,
        dietaPercent,
        dayFlag: dayFlag || undefined,
        customRates: customRates || undefined,
        dayExtras: dayExtras || undefined,
        holidays: userHolidays,
        splitRestDetected: splitRestManual,
        splitRestFirstPartMin: splitRestManual
          ? Math.max(jornadaQuery.data?.splitRestFirstPartMin ?? 0, 3 * 60)
          : null,
        splitRestSecondPartMin: splitRestManual
          ? Math.max(jornadaQuery.data?.splitRestSecondPartMin ?? 0, 9 * 60)
          : null,
        countsAsReducedRest: splitRestManual ? false : true,
      };

      // --- BLOQUE MEJORADO VALIDACIÓN + PERSISTENCIA HORAS CONDUCCIÓN ---
      // Antes: body no enviaba el campo si vacío / parse fallaba. Ahora:
      // - Validar formato si user escribió algo inválido y bloquear save (no se pierde valor anterior)
      // - Enviar SIEMPRE conduccionMin / Domingo / Lunes explícitamente (incluso null)
      //   así computeDerivedFields NO sobreescribe con null al merge si ya es null.
      if (isCrossSundayMonday) {
        // CASO CROSS SUNDAY/MONDAY: validar ambos inputs si tienen texto
        if (conduccionDomingoHoras.trim() && conduccionDomingoParsed.error) {
          throw new Error(`Horas domingo: ${t(conduccionDomingoParsed.error || "common.invalidFormat")}`);
        }
        if (conduccionLunesHoras.trim() && conduccionLunesParsed.error) {
          throw new Error(`Horas lunes: ${t(conduccionLunesParsed.error || "common.invalidFormat")}`);
        }
        const domMin = conduccionDomingoParsed.minutes;
        const lunMin = conduccionLunesParsed.minutes;
        body.conduccionDomingoMin = (domMin != null && Number.isFinite(domMin)) ? domMin : null;
        body.conduccionLunesMin = (lunMin != null && Number.isFinite(lunMin)) ? lunMin : null;
        // Suma si ambos están presentes; si uno solo → usar solo ese; si ninguno → null
        body.conduccionMin =
          ((domMin != null && Number.isFinite(domMin)) || (lunMin != null && Number.isFinite(lunMin)))
            ? ((Number(domMin) || 0) + (Number(lunMin) || 0))
            : null;
      } else {
        // CASO JORNADA NORMAL: usar parseConduccion con validación estricta
        const condRaw = conduccionHoras.trim();
        let condMin: number | null = null;
        if (condRaw) {
          const result = parseDrivingInput(condRaw);
          if (result.error) {
            throw new Error(`${t("jornada.driving")}: ${t(result.error)}`);
          }
          condMin = (result.minutes != null && Number.isFinite(result.minutes)) ? result.minutes : null;
        }
        body.conduccionMin = condMin;
        // Caso no-crossday: domingo/lunes explícitamente a null para no
        // heredar del merged anterior cuando user los editó y luego quitó crossday.
        body.conduccionDomingoMin = null;
        body.conduccionLunesMin = null;
      }

      if (dietaModo === "MANUAL") {
        body.dietaManualTipo = manualTipo;
        body.dietaManualPct = manualPct;
      } else {
        // Limpiar manualTipo/Pct al volver a AUTO para que computeDerivedFields no herede del original
        body.dietaManualTipo = null;
        body.dietaManualPct = null;
      }
      body.paymentMode = paymentMode;
      if (paymentMode === "km") {
        body.kmInicio = parseNumberOrNull(kmInicio);
        body.kmFin = parseNumberOrNull(kmFin);
        body.kmTotal = kmTotal;
        body.pricePerKm = parseNumberOrNull(pricePerKm) ?? (suggestedPricePerKm || null);
        body.importeKm = parseNumberOrNull(importeKm);
      } else {
        body.kmInicio = null;
        body.kmFin = null;
        body.kmTotal = null;
        body.pricePerKm = null;
        body.importeKm = null;
      }
      if (paymentMode === "viaje") {
        body.pricePerTrip = parseNumberOrNull(pricePerTrip) ?? (defaultTripRate || null);
        body.importeViaje = parseNumberOrNull(importeViaje);
      } else {
        body.pricePerTrip = null;
        body.importeViaje = null;
      }
      body.recalcDiet = recalcDiet;
      // Siempre explícito (no undefined) para que editarJornada sepa si hay que setear a [] → null
      body.plusItems = plusItems;
      body.observaciones = observaciones.trim().length > 0 ? observaciones.trim() : null;
      // #region debug-point A:edit-ui-submit
      reportJornadaDateDebug("A", "editar-jornada:mutationFn", "user submits edited jornada", {
        jornadaId: id,
        fechaInicioInputVisible: fechaInicioInput,
        fechaFinInputVisible: fechaFinInput,
        fechaInicioSeleccionada: resolvedFechaInicio,
        horaInicioSeleccionada: horaInicio,
        fechaFinSeleccionada: resolvedFechaFin,
        horaFinSeleccionada: horaFin,
        payload: body,
      });
      // #endregion
      const result = await editarJornada(id, body);
      return result;
    },
    onSuccess: async () => {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (lugarInicio.trim()) addRecentPlace(lugarInicio.trim());
      if (lugarFin.trim()) addRecentPlace(lugarFin.trim());

      // Al editar una jornada, refresca explícitamente todos los cálculos
      // económicos y de historial antes de volver atrás. Esto evita que
      // Historial, Dietas e Informe muestren valores antiguos durante unos segundos.
      await Promise.all([
        qc.refetchQueries({ queryKey: ["jornadas"] }).catch(() => {}),
        qc.refetchQueries({ queryKey: ["dietas-resumen"] }).catch(() => {}),
        qc.refetchQueries({ queryKey: ["km-resumen"] }).catch(() => {}),
        qc.refetchQueries({ queryKey: ["viaje-resumen"] }).catch(() => {}),
        qc.refetchQueries({ queryKey: ["day-extra-entries"] }).catch(() => {}),
        qc.invalidateQueries({ queryKey: ["estado-legal"] }).catch(() => {}),
        qc.invalidateQueries({ queryKey: ["compensaciones"] }).catch(() => {}),
        qc.invalidateQueries({ queryKey: ["all-viajes"] }).catch(() => {}),
        qc.invalidateQueries({ queryKey: ["offsite-weekly-rest-dates"] }).catch(() => {}),
        qc.invalidateQueries({ queryKey: ["jornada-edit", id] }).catch(() => {}),
      ]);

      triggerSync();
      router.back();
    },
    onError: (e: Error) => {
      Alert.alert(t("common.error"), e.message);
    },
  });

  if (jornadaQuery.isLoading || !loaded) {
    return (
      <View style={[styles.container, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={Colors.light.tint} />
      </View>
    );
  }

  const isCerrada = !!jornadaQuery.data?.fechaFin;
  const canSave =
    lugarInicio.trim() &&
    !!parseDisplayDateToISO(fechaInicioInput) &&
    (!isCerrada || !!parseDisplayDateToISO(fechaFinInput)) &&
    (!isCerrada || (fechaFin.trim() && horaFin.trim() && lugarFin.trim())) &&
    !mutation.isPending;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.sectionTitle}>{t("jornada.start")}</Text>
      <View style={styles.fieldRow}>
        <View style={styles.fieldHalf}>
          <Text style={styles.fieldLabel}>{t("common.date")}</Text>
          <TextInput
            style={styles.input}
            value={fechaInicioInput}
            onChangeText={(v) => {
              setFechaInicioInput(v);
              const iso = parseDisplayDateToISO(v);
              if (iso) setFechaInicio(iso);
            }}
            placeholder="DD/MM/YYYY"
            placeholderTextColor="#9CA3AF"
          />
        </View>
        <View style={styles.fieldHalf}>
          <Text style={styles.fieldLabel}>{t("common.time")}</Text>
          <TextInput style={styles.input} value={horaInicio} onChangeText={setHoraInicio} placeholder="HH:MM" placeholderTextColor="#9CA3AF" />
        </View>
      </View>
      <View style={[styles.field, { zIndex: 10 }]}>
        <Text style={styles.fieldLabel}>{t("common.place")}</Text>
        <View style={{ position: "relative" as const }}>
          <TextInput
            style={styles.input}
            value={lugarInicio}
            onChangeText={(v) => { setLugarInicio(v); setShowLugarInicioSug(true); }}
            onFocus={() => setShowLugarInicioSug(true)}
            onBlur={() => setTimeout(() => setShowLugarInicioSug(false), 200)}
            placeholder="Ciudad / Base"
            placeholderTextColor="#9CA3AF"
          />
          {showLugarInicioSug && recentPlaces.length > 0 && (
            <PlaceSuggestions
              places={recentPlaces}
              filter={lugarInicio}
              onSelect={(p) => { setLugarInicio(p); setShowLugarInicioSug(false); }}
            />
          )}
        </View>
      </View>

      {(jornadaQuery.data as any)?.isDoubleDriving === true && (
        <View style={{
          marginTop: 14,
          padding: 12,
          borderRadius: 10,
          backgroundColor: Colors.light.accent + "12",
          borderWidth: 1,
          borderColor: Colors.light.accent + "33",
          gap: 6,
        }}>
          <View style={{ flexDirection: "row" as const, alignItems: "center" as const, gap: 8 }}>
            <Ionicons name="people" size={14} color={Colors.light.accent} />
            <Text style={{
              fontFamily: "Inter_600SemiBold",
              fontSize: 13,
              color: Colors.light.accent,
            }}>
              DOBLE CONDUCCI\u00d3N (conducci\u00f3n en equipo)
            </Text>
          </View>
          {typeof (jornadaQuery.data as any)?.secondDriverName === "string" && (jornadaQuery.data as any).secondDriverName ? (
            <Text style={{
              fontSize: 13,
              fontFamily: "Inter_400Regular",
              color: Colors.light.textSecondary,
              paddingLeft: 22,
            }}>
              Segundo conductor: {(jornadaQuery.data as any).secondDriverName}
            </Text>
          ) : null}
        </View>
      )}

      {isCerrada && (
        <>
          <Text style={[styles.sectionTitle, { marginTop: 16 }]}>{t("jornada.end")}</Text>
          <View style={styles.fieldRow}>
            <View style={styles.fieldHalf}>
              <Text style={styles.fieldLabel}>{t("common.date")}</Text>
              <TextInput
                style={styles.input}
                value={fechaFinInput}
                onChangeText={(v) => {
                  setFechaFinInput(v);
                  const iso = parseDisplayDateToISO(v);
                  if (iso) setFechaFin(iso);
                }}
                placeholder="DD/MM/YYYY"
                placeholderTextColor="#9CA3AF"
              />
            </View>
            <View style={styles.fieldHalf}>
              <Text style={styles.fieldLabel}>{t("common.time")}</Text>
              <TextInput style={styles.input} value={horaFin} onChangeText={setHoraFin} placeholder="HH:MM" placeholderTextColor="#9CA3AF" />
            </View>
          </View>
          <View style={[styles.field, { zIndex: 10 }]}>
            <Text style={styles.fieldLabel}>{t("common.place")}</Text>
            <View style={{ position: "relative" as const }}>
              <TextInput
                style={styles.input}
                value={lugarFin}
                onChangeText={(v) => { setLugarFin(v); setShowLugarFinSug(true); }}
                onFocus={() => setShowLugarFinSug(true)}
                onBlur={() => setTimeout(() => setShowLugarFinSug(false), 200)}
                placeholder="Ciudad / Base"
                placeholderTextColor="#9CA3AF"
              />
              {showLugarFinSug && recentPlaces.length > 0 && (
                <PlaceSuggestions
                  places={recentPlaces}
                  filter={lugarFin}
                  onSelect={(p) => { setLugarFin(p); setShowLugarFinSug(false); }}
                />
              )}
            </View>
          </View>

          <View style={[styles.field, { marginTop: 4 }]}>
            <Pressable
              onPress={() => setSplitRestManual((prev) => !prev)}
              style={({ pressed }) => [
                styles.splitRestToggle,
                { opacity: pressed ? 0.9 : 1 },
              ]}
            >
              <Ionicons
                name={splitRestManual ? "checkbox" : "square-outline"}
                size={20}
                color={Colors.light.accent}
              />
              <Text style={styles.splitRestToggleLabel}>
                {t("dashboard.splitRestManualLabel")}
              </Text>
            </Pressable>
            {splitRestManual && (
              <Text style={styles.splitRestHint}>
                {t("dashboard.splitRestDetected")} {formatMinutosHoras(Math.max(jornadaQuery.data?.splitRestFirstPartMin ?? 0, 3 * 60))} + 9h
              </Text>
            )}
          </View>

          <Text style={[styles.sectionTitle, { marginTop: 16 }]}>{t("jornada.details")}</Text>
          <Text style={styles.fieldLabel}>{t("jornada.tripType")}</Text>
          <View style={styles.segmentRow}>
            {(["NACIONAL", "INTERNACIONAL", "REGIONAL_INTL", "NAC_INTL", "NAC_REGIONAL", "NINGUNO", "REGIONAL"] as const).map((rt) => (
              <Pressable
                key={rt}
                style={[styles.segmentFlex, tipoRuta === rt && styles.segmentActive]}
                onPress={() => setTipoRuta(rt)}
              >
                <Text style={[styles.segmentTextSmall, tipoRuta === rt && styles.segmentTextActive]}>
                  {rt === "NACIONAL" ? t("jornada.nacShort") : rt === "INTERNACIONAL" ? t("jornada.intlShort") : rt === "REGIONAL_INTL" ? t("jornada.regIntlShort") : rt === "NAC_INTL" ? t("jornada.nacIntlShort") : rt === "NAC_REGIONAL" ? t("jornada.nacRegShort") : rt === "NINGUNO" ? t("jornada.ningShort") : t("jornada.regShort")}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.fieldRow}>
            <View style={styles.fieldHalf}>
              <Text style={styles.fieldLabel}>{t("jornada.pernocta")}</Text>
              <View style={styles.segmentRow}>
                <Pressable style={[styles.segmentSmall, pernocta && styles.segmentActive]} onPress={() => setPernocta(true)}>
                  <Text style={[styles.segmentText, pernocta && styles.segmentTextActive]}>{t("common.yes")}</Text>
                </Pressable>
                <Pressable style={[styles.segmentSmall, !pernocta && styles.segmentActive]} onPress={() => setPernocta(false)}>
                  <Text style={[styles.segmentText, !pernocta && styles.segmentTextActive]}>{t("common.no")}</Text>
                </Pressable>
              </View>
            </View>
            {!isCrossSundayMonday && (
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>{t("jornada.driving")}</Text>
                <TextInput
                  style={styles.input}
                  value={conduccionHoras}
                  onChangeText={setConduccionHoras}
                  placeholder="Ej: 9 o 9:30"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="default"
                />
              </View>
            )}
          </View>

          {isCrossSundayMonday && (
            <View style={styles.field}>
              <View style={{ backgroundColor: (Colors.light.warning || "#F59E0B") + "15", padding: 10, borderRadius: 8, marginBottom: 10 }}>
                <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.warning || "#F59E0B", marginBottom: 4 }}>
                  {t("jornada.crossSundayMonday")}
                </Text>
                <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textSecondary }}>
                  {t("jornada.separateDriving")}
                </Text>
              </View>
              <Text style={styles.fieldLabel}>
                {t("jornada.drivingSundayUntil")} {crossWeekTimeLabel} {t("jornada.ofMonday")}
              </Text>
              <TextInput
                style={[styles.input, conduccionDomingoParsed.error ? { borderColor: Colors.light.danger, borderWidth: 1 } : undefined]}
                value={conduccionDomingoHoras}
                onChangeText={setConduccionDomingoHoras}
                placeholder="Ej: 1 o 1:15"
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
                {t("jornada.drivingMondayFrom")} {crossWeekTimeLabel}
              </Text>
              <TextInput
                style={[styles.input, conduccionLunesParsed.error ? { borderColor: Colors.light.danger, borderWidth: 1 } : undefined]}
                value={conduccionLunesHoras}
                onChangeText={setConduccionLunesHoras}
                placeholder="Ej: 8 o 8:30"
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
          )}

          <Text style={[styles.sectionTitle, { marginTop: 16 }]}>{t("edit.billing")}</Text>
          <View style={styles.segmentRow}>
            {(["dietas", "km", "viaje"] as const).map((pm) => (
              <Pressable
                key={pm}
                style={[styles.segmentSmall, paymentMode === pm && styles.segmentActive]}
                onPress={() => setPaymentMode(pm)}
              >
                <Text style={[styles.segmentText, paymentMode === pm && styles.segmentTextActive]}>
                  {pm === "dietas" ? t("usuario.paymentModeDietas") : pm === "km" ? t("usuario.paymentModeKm") : t("usuario.paymentModeTrip")}
                </Text>
              </Pressable>
            ))}
          </View>

          {paymentMode === "km" && (
            <>
              <View style={styles.fieldRow}>
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>{t("edit.kmStart")}</Text>
                  <TextInput
                    style={styles.input}
                    value={kmInicio}
                    onChangeText={(v) => { setKmInicio(v); setImporteKmTouched(false); }}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor="#9CA3AF"
                  />
                </View>
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>{t("edit.kmEnd")}</Text>
                  <TextInput
                    style={styles.input}
                    value={kmFin}
                    onChangeText={(v) => { setKmFin(v); setImporteKmTouched(false); }}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor="#9CA3AF"
                  />
                </View>
              </View>
              <View style={styles.fieldRow}>
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>{t("edit.pricePerKm")}</Text>
                  <TextInput
                    style={styles.input}
                    value={pricePerKm}
                    onChangeText={(v) => { setPricePerKm(v); setImporteKmTouched(false); }}
                    keyboardType="decimal-pad"
                    placeholder={suggestedPricePerKm ? String(suggestedPricePerKm) : "0"}
                    placeholderTextColor="#9CA3AF"
                  />
                </View>
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>{t("edit.amountKm")}</Text>
                  <TextInput
                    style={styles.input}
                    value={importeKm}
                    onChangeText={(v) => { setImporteKm(v); setImporteKmTouched(true); }}
                    keyboardType="decimal-pad"
                    placeholder={suggestedImporteKm != null ? String(suggestedImporteKm) : "0"}
                    placeholderTextColor="#9CA3AF"
                  />
                </View>
              </View>
              <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textSecondary }}>
                {t("edit.kmTotal")}: {kmTotal != null ? Math.round(kmTotal).toString() : "-"} km
              </Text>
            </>
          )}

          {paymentMode === "viaje" && (
            <View style={styles.fieldRow}>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>
                  {tipoRuta === "REGIONAL"
                    ? t("usuario.pricePerTripRegional")
                    : (tipoRuta === "INTERNACIONAL" || tipoRuta === "REGIONAL_INTL" || tipoRuta === "NAC_INTL")
                      ? t("usuario.pricePerTripInternacional")
                      : t("usuario.pricePerTripNacional")}
                </Text>
                <TextInput
                  style={styles.input}
                  value={pricePerTrip}
                  onChangeText={(v) => { setPricePerTrip(v); setImporteViajeTouched(false); }}
                  keyboardType="decimal-pad"
                  placeholder={defaultTripRate ? String(defaultTripRate) : "0"}
                  placeholderTextColor="#9CA3AF"
                />
              </View>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>{t("edit.amountTrip")}</Text>
                <TextInput
                  style={styles.input}
                  value={importeViaje}
                  onChangeText={(v) => { setImporteViaje(v); setImporteViajeTouched(true); }}
                  keyboardType="decimal-pad"
                  placeholder={defaultTripRate ? String(defaultTripRate) : "0"}
                  placeholderTextColor="#9CA3AF"
                />
              </View>
            </View>
          )}

          {frozenDiet && !recalcDiet ? (
            <View style={styles.frozenDietCard}>
              <View style={styles.frozenDietHeader}>
                <View style={{ flexDirection: "row" as const, alignItems: "center" as const, gap: 6 }}>
                  <Ionicons name="lock-closed" size={14} color={Colors.light.tint} />
                  <Text style={styles.frozenDietTitle}>{t("edit.frozenDietSaved")}</Text>
                </View>
                <Text style={styles.frozenDietDate}>
                  {new Date(frozenDiet.calculatedAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}
                </Text>
              </View>
              <Text style={styles.frozenDietRule}>{frozenDiet.rule}</Text>
              <View style={styles.frozenDietAmounts}>
                <View style={styles.dietaPreviewRow}>
                  <Text style={styles.dietaPreviewLabel}>{t("edit.baseDiet")}</Text>
                  <Text style={styles.dietaPreviewValue}>{parseFloat(frozenDiet.baseEur).toFixed(2)} EUR</Text>
                </View>
                {parseFloat(frozenDiet.extraEur) > 0 && (
                  <View style={styles.dietaPreviewRow}>
                    <Text style={styles.dietaPreviewLabel}>{t("edit.dayExtra")}</Text>
                    <Text style={styles.dietaPreviewValue}>+{parseFloat(frozenDiet.extraEur).toFixed(2)} EUR</Text>
                  </View>
                )}
                <View style={[styles.dietaPreviewRow, styles.dietaPreviewTotal]}>
                  <Text style={styles.dietaPreviewTotalLabel}>Total</Text>
                  <Text style={styles.dietaPreviewTotalValue}>{parseFloat(frozenDiet.importe).toFixed(2)} EUR</Text>
                </View>
              </View>
              <Pressable
                style={styles.recalcBtn}
                onPress={() => setRecalcDiet(true)}
              >
                <Ionicons name="refresh" size={16} color={Colors.light.warning || "#F59E0B"} />
                <Text style={styles.recalcBtnText}>{t("edit.recalculate")}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.fieldRow}>
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>{t("jornada.dietMode")}</Text>
                  <View style={styles.segmentRow}>
                    <Pressable style={[styles.segmentSmall, dietaModo === "AUTO" && styles.segmentActive]} onPress={() => setDietaModo("AUTO")}>
                      <Text style={[styles.segmentText, dietaModo === "AUTO" && styles.segmentTextActive]}>{t("jornada.auto")}</Text>
                    </Pressable>
                    <Pressable style={[styles.segmentSmall, dietaModo === "MANUAL" && styles.segmentActive]} onPress={() => setDietaModo("MANUAL")}>
                      <Text style={[styles.segmentText, dietaModo === "MANUAL" && styles.segmentTextActive]}>{t("jornada.manual")}</Text>
                    </Pressable>
                  </View>
                </View>
              </View>

              {recalcDiet && frozenDiet && (
                <Pressable
                  style={styles.undoRecalcBtn}
                  onPress={() => setRecalcDiet(false)}
                >
                  <Ionicons name="arrow-undo" size={14} color={Colors.light.tint} />
                  <Text style={styles.undoRecalcText}>{t("edit.keepOriginalDiet")} ({parseFloat(frozenDiet.importe).toFixed(2)} EUR)</Text>
                </Pressable>
              )}

              {dietaModo === "AUTO" && (
                <>
                  <Text style={styles.fieldLabel}>{t("edit.dietPercent")}</Text>
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

                  <Text style={styles.fieldLabel}>{t("edit.daySpecial")}</Text>
                  <View style={styles.segmentRow}>
                    {(["", "NINGUNO", "SABADO", "DOMINGO", "FESTIVO"] as const).map((f) => (
                      <Pressable
                        key={f || "none"}
                        style={[styles.segmentSmall, dayFlag === f && styles.segmentActive]}
                        onPress={() => setDayFlag(f)}
                      >
                        <Text style={[styles.segmentTextSmall, dayFlag === f && styles.segmentTextActive]}>
                          {f === "" ? t("edit.autoShort") : f === "NINGUNO" ? t("edit.ningShort") : f === "SABADO" ? t("edit.sabShort") : f === "DOMINGO" ? t("edit.domShort") : t("edit.festShort")}
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
                            {t("edit.dayExtra")} {dietaPreview.flag === "SABADO" ? t("usuario.saturday") : dietaPreview.flag === "DOMINGO" ? t("usuario.sunday") : t("usuario.holiday")}
                          </Text>
                          <Text style={styles.dietaPreviewValue}>+{dietaPreview.extra.toFixed(2)} EUR</Text>
                        </View>
                      )}
                      <View style={[styles.dietaPreviewRow, styles.dietaPreviewTotal]}>
                        <Text style={styles.dietaPreviewTotalLabel}>{t("edit.totalDiet")}</Text>
                        <Text style={styles.dietaPreviewTotalValue}>{dietaPreview.total.toFixed(2)} EUR</Text>
                      </View>
                    </View>
                  )}
                </>
              )}

              {dietaModo === "MANUAL" && (
                <>
                  <Text style={styles.fieldLabel}>{t("jornada.dietType")}</Text>
                  <View style={styles.segmentRow}>
                    <Pressable style={[styles.segment, manualTipo === "NACIONAL" && styles.segmentActive]} onPress={() => setManualTipo("NACIONAL")}>
                      <Text style={[styles.segmentText, manualTipo === "NACIONAL" && styles.segmentTextActive]}>{t("common.nacional")}</Text>
                    </Pressable>
                    <Pressable style={[styles.segment, manualTipo === "INTERNACIONAL" && styles.segmentActive]} onPress={() => setManualTipo("INTERNACIONAL")}>
                      <Text style={[styles.segmentText, manualTipo === "INTERNACIONAL" && styles.segmentTextActive]}>{t("common.internacional")}</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.fieldLabel}>{t("jornada.dietPercent")}</Text>
                  <View style={styles.segmentRow}>
                    {(["100", "60", "30"] as const).map((p) => (
                      <Pressable key={p} style={[styles.segmentSmall, manualPct === p && styles.segmentActive]} onPress={() => setManualPct(p)}>
                        <Text style={[styles.segmentText, manualPct === p && styles.segmentTextActive]}>{p}%</Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={styles.fieldLabel}>{t("edit.daySpecial")}</Text>
                  <View style={styles.segmentRow}>
                    {(["", "NINGUNO", "SABADO", "DOMINGO", "FESTIVO"] as const).map((f) => (
                      <Pressable
                        key={f || "none"}
                        style={[styles.segmentSmall, dayFlag === f && styles.segmentActive]}
                        onPress={() => setDayFlag(f)}
                      >
                        <Text style={[styles.segmentTextSmall, dayFlag === f && styles.segmentTextActive]}>
                          {f === "" ? t("edit.autoShort") : f === "NINGUNO" ? t("edit.ningShort") : f === "SABADO" ? t("edit.sabShort") : f === "DOMINGO" ? t("edit.domShort") : t("edit.festShort")}
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
                            {t("edit.dayExtra")} {dietaPreview.flag === "SABADO" ? t("usuario.saturday") : dietaPreview.flag === "DOMINGO" ? t("usuario.sunday") : t("usuario.holiday")}
                          </Text>
                          <Text style={styles.dietaPreviewValue}>+{dietaPreview.extra.toFixed(2)} EUR</Text>
                        </View>
                      )}
                      <View style={[styles.dietaPreviewRow, styles.dietaPreviewTotal]}>
                        <Text style={styles.dietaPreviewTotalLabel}>{t("edit.totalDiet")}</Text>
                        <Text style={styles.dietaPreviewTotalValue}>{dietaPreview.total.toFixed(2)} EUR</Text>
                      </View>
                    </View>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}

      {isCerrada && (
        <View style={styles.plusSection}>
          <Text style={styles.fieldLabel}>{t("edit.plusExtras")}</Text>
          {plusItems.map((item, idx) => (
            <View key={`pi_${idx}_${item.concepto}`} style={styles.plusItemRow}>
              <TextInput
                style={[styles.input, styles.plusItemEditableConcept]}
                value={item.concepto}
                onChangeText={(v) => setPlusItems(prev => prev.map((it, i) => i === idx ? { ...it, concepto: v } : it))}
                onEndEditing={(e) => {
                  const v = e.nativeEvent.text?.trim();
                  if (!v) setPlusItems(prev => prev.map((it, i) => i === idx ? { ...it, concepto: "(sin concepto)" } : it));
                }}
                placeholder={t("jornada.concept")}
                placeholderTextColor="#9CA3AF"
              />
              <TextInput
                style={[styles.input, styles.plusItemEditableAmount]}
                value={String(item.importe)}
                onChangeText={(raw) => {
                  const v = parseFloat(raw.replace(",", "."));
                  if (Number.isFinite(v) && v >= 0) {
                    setPlusItems(prev => prev.map((it, i) => i === idx ? { ...it, importe: v } : it));
                  } else if (raw === "" || raw === "." || raw === ",") {
                    setPlusItems(prev => prev.map((it, i) => i === idx ? { ...it, importe: 0 } : it));
                  }
                }}
                onEndEditing={() => {
                  setPlusItems(prev => prev.map((it, i) => {
                    if (i !== idx) return it;
                    const safe = Number.isFinite(it.importe) && it.importe >= 0 ? it.importe : 0;
                    return { ...it, importe: Math.round(safe * 100) / 100 };
                  }));
                }}
                placeholder="EUR"
                placeholderTextColor="#9CA3AF"
                keyboardType="decimal-pad"
              />
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
              placeholder={t("jornada.concept")}
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
              {t("jornada.totalPlus")} {plusItems.reduce((s, i) => s + i.importe, 0).toFixed(2)} \u20AC
            </Text>
          )}
        </View>
      )}

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{t("jornada.observations")}</Text>
        <TextInput
          style={[styles.input, { textAlignVertical: "top" as const }]}
          value={observaciones}
          onChangeText={setObservaciones}
          placeholder={t("edit.notesPlaceholder")}
          placeholderTextColor="#9CA3AF"
          multiline={true}
          numberOfLines={3}
        />
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.btnPrimary,
          { opacity: pressed ? 0.85 : 1 },
          !canSave && styles.btnDisabled,
        ]}
        onPress={() => mutation.mutate()}
        disabled={!canSave}
      >
        {mutation.isPending ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <Ionicons name="checkmark-circle" size={20} color="#fff" />
            <Text style={styles.btnText}>{t("edit.saveChanges")}</Text>
          </>
        )}
      </Pressable>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  content: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.tint,
    marginBottom: 8,
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
  splitRestToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: Colors.light.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  splitRestToggleLabel: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.light.textSecondary,
  },
  splitRestHint: {
    marginTop: 6,
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.accent,
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
    backgroundColor: Colors.light.surface,
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
    backgroundColor: Colors.light.surface,
    alignItems: "center" as const,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  segmentFlex: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.light.surface,
    alignItems: "center" as const,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  segmentSmall: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.light.surface,
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
  dietaPreview: {
    backgroundColor: Colors.light.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
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
  frozenDietCard: {
    backgroundColor: Colors.light.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    gap: 8,
  },
  frozenDietHeader: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
  },
  frozenDietTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.tint,
  },
  frozenDietDate: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
  },
  frozenDietRule: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.light.textSecondary,
  },
  frozenDietAmounts: {
    gap: 4,
  },
  recalcBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "#FEF3C7",
    alignSelf: "flex-start" as const,
  },
  recalcBtnText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: "#92400E",
  },
  undoRecalcBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: Colors.light.surface,
    borderWidth: 1,
    borderColor: Colors.light.tint,
    alignSelf: "flex-start" as const,
    marginBottom: 8,
  },
  undoRecalcText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: Colors.light.tint,
  },
  btnPrimary: {
    backgroundColor: Colors.light.tint,
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    marginTop: 16,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  plusSection: {
    marginTop: 16,
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
  plusItemEditableConcept: {
    flex: 1,
    minHeight: 36,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: "#FFFFFF",
  },
  plusItemEditableAmount: {
    width: 88,
    minHeight: 36,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 13,
    textAlign: "right" as const,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: "#FFFFFF",
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
});
