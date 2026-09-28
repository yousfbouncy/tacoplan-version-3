import React, { useState, useMemo, useCallback, useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  Platform,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Alert,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Colors from "@/constants/colors";
import { usePeriod } from "@/lib/period-context";
import { useI18n } from "@/lib/i18n-context";
import { addOffsiteWeeklyRestEntry, getResumenDietas, getResumenKm, getResumenViaje, findRate, getMoroccoJornadaSummary, getFerryExtrasSummary, listAvailableOffsiteWeeklyRestDates, detectMissingOutOfBaseDietDays, dismissNaturalDayDiets, upsertNaturalDayDiets, clearDismissedNaturalDayDietsInRange, type UserDietRate, type UserDayExtras, type DetectedMissingNaturalDay, type NaturalDayDietEntry } from "@/lib/local-storage";
import PendingNaturalDietsModal, { type DetectedDiet } from "@/components/PendingNaturalDietsModal";
import ArrivalDayDietSelectorModal from "@/components/ArrivalDayDietSelectorModal";
import { useAuth } from "@/lib/auth-context";
import { useSync } from "@/lib/sync-context";
import { useFerry } from "@/lib/ferry-context";
import { userScopedKey } from "@/lib/user-scope";
import { fetchDayExtras, fetchDietRates } from "@/lib/user-cloud";
import { formatFecha } from "@/lib/utils";

type ResumenDietas = {
  total: number;
  desglose: { tipo: string; cantidad: number; total: number }[];
  extras: { totalExtras: number; desglose: { tipo: string; cantidad: number; total: number }[] };
  plus: { totalPlus: number; desglose: { tipo: string; cantidad: number; total: number }[] };
};

type MoroccoSummary = {
  mode: string;
  count: number;
  totalDieta: number;
  totalExtras: number;
};

export default function DietasScreen() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const qc = useQueryClient();
  const { user } = useAuth();
  const { syncVersion } = useSync();
  const { config: ferryConfig, isMoroccoMode } = useFerry();
  const [periodoIdx, setPeriodoIdx] = useState(0);
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
  const [showReferencePrices, setShowReferencePrices] = useState(false);
  const [paymentMode, setPaymentMode] = useState<"dietas" | "km" | "viaje">("dietas");
  const [showOffsiteForm, setShowOffsiteForm] = useState(false);
  const [offsiteDate, setOffsiteDate] = useState("");
  const [offsiteRestType, setOffsiteRestType] = useState<"WEEKLY_REDUCED" | "WEEKLY_COMPLETE">("WEEKLY_COMPLETE");
  const [offsiteBase, setOffsiteBase] = useState<"NACIONAL" | "INTERNACIONAL">("NACIONAL");
  const [offsitePlusSunday, setOffsitePlusSunday] = useState(false);
  const [offsitePlusHoliday, setOffsitePlusHoliday] = useState(false);
  const [offsiteAmount, setOffsiteAmount] = useState("");
  const [offsiteAmountTouched, setOffsiteAmountTouched] = useState(false);
  const [offsiteNote, setOffsiteNote] = useState("");
  const [savingOffsite, setSavingOffsite] = useState(false);
  const [pendingDietsVisible, setPendingDietsVisible] = useState(false);
  const [pendingDietsBannerVisible, setPendingDietsBannerVisible] = useState(false);
  const [pendingDiets, setPendingDiets] = useState<DetectedMissingNaturalDay[]>([]);
  const [pendingDietsSaving, setPendingDietsSaving] = useState(false);
  const [arrivalSelectorVisible, setArrivalSelectorVisible] = useState(false);
  const [arrivalSelectorDay, setArrivalSelectorDay] = useState<Parameters<typeof ArrivalDayDietSelectorModal>[0]["day"]>(null);
  const [arrivalSelectorChoices, setArrivalSelectorChoices] = useState<Map<string, { percentage: 100|60|30|null; amount: number }>>(new Map());
  const [arrivalSelectorQueue, setArrivalSelectorQueue] = useState<DetectedMissingNaturalDay[]>([]);
  const [pendingConfirmRichItems, setPendingConfirmRichItems] = useState<DetectedMissingNaturalDay[] | null>(null);

  const toMissingDay = (d: DetectedDiet): DetectedMissingNaturalDay => {
    const up = d.userPercentage === "SIN_DIETA" ? null : d.userPercentage ?? null;
    return {
      ...d,
      userPercentage: up as 100 | 60 | 30 | null | undefined,
    };
  };

  const { getPeriod } = usePeriod();

  const loadConfig = useCallback(async () => {
    try {
      const pf = (v: any, fb: number) => { const n = parseFloat(v); return Number.isFinite(n) ? n : fb; };
      const local = await AsyncStorage.getItem(await userScopedKey("tacoplan_user_settings", user?.id));
      if (local) {
        const s = JSON.parse(local);
        if (s.payment_mode === "km" || s.payment_mode === "viaje" || s.payment_mode === "dietas") {
          setPaymentMode(s.payment_mode);
        }
        setCustomRates([
          { trip_type: "NACIONAL", percent: 100, amount: pf(s.nac_100, 0) },
          { trip_type: "NACIONAL", percent: 60, amount: pf(s.nac_60, 0) },
          { trip_type: "NACIONAL", percent: 30, amount: pf(s.nac_30, 0) },
          { trip_type: "INTERNACIONAL", percent: 100, amount: pf(s.intl_100, 0) },
          { trip_type: "INTERNACIONAL", percent: 60, amount: pf(s.intl_60, 0) },
          { trip_type: "INTERNACIONAL", percent: 30, amount: pf(s.intl_30, 0) },
          { trip_type: "REGIONAL", percent: 100, amount: pf(s.reg_100, 0) },
          { trip_type: "REGIONAL", percent: 60, amount: pf(s.reg_60, 0) },
          { trip_type: "REGIONAL", percent: 30, amount: pf(s.reg_30, 0) },
        ]);
        setDayExtras({
          extra_saturday: pf(s.extra_saturday, 0),
          extra_sunday: pf(s.extra_sunday, 0),
          extra_holiday: pf(s.extra_holiday, 0),
          offsite_weekly_reduced_nacional: pf(s.offsite_weekly_reduced_nacional, 0),
          offsite_weekly_reduced_internacional: pf(s.offsite_weekly_reduced_internacional, 0),
          offsite_weekly_complete_nacional: pf(s.offsite_weekly_complete_nacional, 0),
          offsite_weekly_complete_internacional: pf(s.offsite_weekly_complete_internacional, 0),
        });
      }
    } catch {}

    if (!user) return;
    try {
      const [rates, extras] = await Promise.all([fetchDietRates(user.id), fetchDayExtras(user.id)]);
      if (rates.length > 0) setCustomRates(rates as any);
      setDayExtras((prev) => {
        const e: any = extras || {};
        const pf = (v: any, fb: number) => { const n = parseFloat(v); return Number.isFinite(n) ? n : fb; };
        return {
          extra_saturday: pf(e.extra_saturday, prev.extra_saturday),
          extra_sunday: pf(e.extra_sunday, prev.extra_sunday),
          extra_holiday: pf(e.extra_holiday, prev.extra_holiday),
          offsite_weekly_reduced_nacional: pf(e.offsite_weekly_reduced_nacional, prev.offsite_weekly_reduced_nacional),
          offsite_weekly_reduced_internacional: pf(e.offsite_weekly_reduced_internacional, prev.offsite_weekly_reduced_internacional),
          offsite_weekly_complete_nacional: pf(e.offsite_weekly_complete_nacional, prev.offsite_weekly_complete_nacional),
          offsite_weekly_complete_internacional: pf(e.offsite_weekly_complete_internacional, prev.offsite_weekly_complete_internacional),
        };
      });
    } catch (e) {
      console.error("[DIETAS] Failed to load rates/extras from Supabase", e);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      loadConfig();
    }, [loadConfig])
  );

  const periodo = useMemo(() => {
    return getPeriod(periodoIdx);
  }, [periodoIdx, getPeriod]);

  const offsiteDatesQuery = useQuery<string[]>({
    queryKey: ["offsite-weekly-rest-dates", syncVersion],
    queryFn: () => listAvailableOffsiteWeeklyRestDates(),
    enabled: !isMoroccoMode,
    staleTime: 30_000,
  });

  const hasOffsiteDates = (offsiteDatesQuery.data || []).length > 0;

  useEffect(() => {
    if (offsiteDatesQuery.isLoading) return;
    if (!hasOffsiteDates && showOffsiteForm) setShowOffsiteForm(false);
  }, [offsiteDatesQuery.isLoading, hasOffsiteDates, showOffsiteForm]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const det = await detectMissingOutOfBaseDietDays({ fromDate: periodo.from, toDate: periodo.to });
        if (cancelled) return;
        if (det.length > 0) {
          setPendingDiets(det);
          setPendingDietsBannerVisible(true);
        } else {
          setPendingDiets([]);
          setPendingDietsBannerVisible(false);
        }
      } catch {}
    };
    run();
    return () => { cancelled = true; };
  }, [periodo.from, periodo.to, syncVersion]);

  const resumenQuery = useQuery<ResumenDietas>({
    queryKey: ["dietas-resumen", periodo.from, periodo.to, syncVersion],
    queryFn: () => getResumenDietas(periodo.from, periodo.to),
    enabled: !isMoroccoMode && paymentMode === "dietas",
  });

  const kmResumenQuery = useQuery({
    queryKey: ["km-resumen", periodo.from, periodo.to, syncVersion],
    queryFn: () => getResumenKm(periodo.from, periodo.to),
    enabled: !isMoroccoMode && paymentMode === "km",
  });

  const viajeResumenQuery = useQuery({
    queryKey: ["viaje-resumen", periodo.from, periodo.to, syncVersion],
    queryFn: () => getResumenViaje(periodo.from, periodo.to),
    enabled: !isMoroccoMode && paymentMode === "viaje",
  });

  const moroccoQuery = useQuery<MoroccoSummary>({
    queryKey: ["morocco-summary", periodo.from, periodo.to, ferryConfig.paymentMode, syncVersion],
    queryFn: async () => {
      const pm = ferryConfig.paymentMode as "morocco_trip" | "morocco_pernight" | "morocco_diet";
      const s = await getMoroccoJornadaSummary(periodo.from, periodo.to, pm);
      return { mode: pm, count: s.count, totalDieta: s.totalDieta, totalExtras: s.totalExtras };
    },
    enabled: isMoroccoMode && ferryConfig.paymentMode !== "morocco_diet",
  });

  const fTransitRate = ferryConfig.ferryTransitRate ?? 54.30;
  const fCabinRate = ferryConfig.ferryCabinRate ?? 54.30;

  const ferryExtrasQuery = useQuery({
    queryKey: ["ferry-extras-summary", periodo.from, periodo.to, fTransitRate, fCabinRate, syncVersion],
    queryFn: () => getFerryExtrasSummary(periodo.from, periodo.to, fTransitRate, fCabinRate),
  });
  const ferryExtras = ferryExtrasQuery.data;

  const data = resumenQuery.data;
  const kmData = kmResumenQuery.data as any;
  const viajeData = viajeResumenQuery.data as any;
  const totalExtras = (paymentMode === "km"
    ? kmData?.extras?.totalExtras
    : paymentMode === "viaje"
      ? viajeData?.extras?.totalExtras
      : data?.extras?.totalExtras) || 0;
  const totalPlus = (paymentMode === "km"
    ? kmData?.plus?.totalPlus
    : paymentMode === "viaje"
      ? viajeData?.plus?.totalPlus
      : data?.plus?.totalPlus) || 0;
  const totalDietasOffsite = (paymentMode === "km"
    ? kmData?.dietas?.totalDietas
    : paymentMode === "viaje"
      ? viajeData?.dietas?.totalDietas
      : 0) || 0;
  const totalFerryExtras = ferryExtras?.totalAmount || 0;
  const baseTotal = paymentMode === "km"
    ? (kmData?.totalImporte || 0)
    : paymentMode === "viaje"
      ? (viajeData?.totalImporte || 0)
      : (data?.total || 0);
  const grandTotal = baseTotal + totalDietasOffsite + totalExtras + totalPlus + totalFerryExtras;
  const refreshing =
    resumenQuery.isRefetching ||
    kmResumenQuery.isRefetching ||
    viajeResumenQuery.isRefetching ||
    moroccoQuery.isRefetching ||
    ferryExtrasQuery.isRefetching;

  const suggestedOffsiteBaseAmount = useMemo(() => {
    const base =
      offsiteRestType === "WEEKLY_REDUCED"
        ? (offsiteBase === "NACIONAL"
          ? dayExtras.offsite_weekly_reduced_nacional
          : dayExtras.offsite_weekly_reduced_internacional)
        : (offsiteBase === "NACIONAL"
          ? dayExtras.offsite_weekly_complete_nacional
          : dayExtras.offsite_weekly_complete_internacional);
    return Math.round(Number(base || 0) * 100) / 100;
  }, [offsiteRestType, offsiteBase, dayExtras]);

  const suggestedOffsitePlusAmount = useMemo(() => {
    const plus = (offsitePlusSunday ? dayExtras.extra_sunday : 0) + (offsitePlusHoliday ? dayExtras.extra_holiday : 0);
    return Math.round(Number(plus || 0) * 100) / 100;
  }, [offsitePlusSunday, offsitePlusHoliday, dayExtras]);

  const effectiveOffsiteBaseAmount = useMemo(() => {
    const raw = offsiteAmount.trim().replace(",", ".");
    if (!raw) return suggestedOffsiteBaseAmount;
    const n = parseFloat(raw);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : suggestedOffsiteBaseAmount;
  }, [offsiteAmount, suggestedOffsiteBaseAmount]);

  const effectiveOffsiteTotalAmount = useMemo(() => {
    return Math.round((effectiveOffsiteBaseAmount + suggestedOffsitePlusAmount) * 100) / 100;
  }, [effectiveOffsiteBaseAmount, suggestedOffsitePlusAmount]);

  const extraTipoLabel = useCallback((tipo: string) => {
    if (tipo === "FUERA_BASE") return t("dietas.offsiteWeeklyRestLabel");
    if (tipo.startsWith("FUERA_BASE_")) {
      const restBase = tipo.slice("FUERA_BASE_".length);
      const base = restBase.endsWith("_INTERNACIONAL") ? "INTERNACIONAL" : restBase.endsWith("_NACIONAL") ? "NACIONAL" : null;
      const rest = base ? restBase.slice(0, -(`_${base}`.length)) : restBase;
      const restLabel = rest === "WEEKLY_REDUCED" ? t("dietas.offsiteWeeklyRestReduced") : t("dietas.offsiteWeeklyRestComplete");
      const baseLabel = base === "INTERNACIONAL" ? t("common.internacional") : t("common.nacional");
      return `${restLabel} · ${baseLabel}`;
    }
    return t(`common.dayFlag.${tipo}`);
  }, [t]);

  useEffect(() => {
    if (!showOffsiteForm) return;
    if (offsiteAmountTouched) return;
    setOffsiteAmount(suggestedOffsiteBaseAmount.toFixed(2));
  }, [showOffsiteForm, suggestedOffsiteBaseAmount, offsiteAmountTouched]);

  const upsertAllPendingSelections = useCallback(async (
    selectedItems: Array<string | DetectedMissingNaturalDay>,
    arrivalChoices: Map<string, { percentage: 100 | 60 | 30 | null; amount: number }>,
  ) => {
    const nowIso = new Date().toISOString();
    const entries: NaturalDayDietEntry[] = [];
    const richByDate = new Map<string, DetectedMissingNaturalDay>();
    for (const it of selectedItems) {
      if (it && typeof it === "object" && "date" in it) {
        richByDate.set(it.date, it);
      }
    }
    for (const s of selectedItems) {
      const date = typeof s === "string" ? s : s.date;
      if (!date) continue;
      const richSrc = richByDate.get(date);
      const src = richSrc ?? pendingDiets.find((p) => p.date === date);
      if (!src) continue;
      const choice = arrivalChoices.get(date);
      let pct: 100 | 60 | 30 = 100;
      let amount = src.amount;
      if (src.isBaseArrivalDay) {
        if (choice) {
          if (choice.percentage == null) continue;
          pct = choice.percentage;
          amount = choice.amount;
        } else if (richSrc && typeof richSrc.userPercentage === "number" && richSrc.userPercentage !== null) {
          pct = richSrc.userPercentage as 100 | 60 | 30;
          if (typeof richSrc.userAmount === "number") amount = richSrc.userAmount;
        } else {
          pct = 100;
        }
      } else {
        if (richSrc && typeof richSrc.userPercentage === "number" && richSrc.userPercentage !== null) {
          pct = richSrc.userPercentage as 100 | 60 | 30;
          if (typeof richSrc.userAmount === "number") amount = richSrc.userAmount;
        } else {
          pct = 100;
        }
      }
      let t: "INTERNACIONAL" | "NACIONAL" | "REGIONAL" = "NACIONAL";
      const rawType = src.type;
      if (rawType === "INTERNACIONAL" || rawType === "NACIONAL" || rawType === "REGIONAL") t = rawType;
      const plusRaw = richSrc?.plusItems ?? src?.plusItems;
      const plusItems = Array.isArray(plusRaw)
        ? plusRaw
            .filter((pl) => pl && pl.selected !== false)
            .map((pl) => ({
              concepto: pl.concepto,
              amount: Number(pl.amount) || 0,
              id: pl.id ?? `${date}_${pl.concepto}`,
            }))
        : null;
      entries.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 9) + `_${date}`,
        date: String(date || ""),
        type: t,
        percentage: pct,
        amount: Number.isFinite(Number(amount)) ? Number(amount) : 0,
        location: typeof src?.location === "string" ? src.location : (src?.location ?? null),
        source: "NATURAL_DAY_OUT_OF_BASE" as const,
        previousJourneyId: typeof src?.previousJourneyId === "string" ? src.previousJourneyId : (src?.previousJourneyId ?? null),
        nextJourneyId: typeof src?.nextJourneyId === "string" ? src.nextJourneyId : (src?.nextJourneyId ?? null),
        confirmedByUser: true,
        dismissedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
        syncStatus: "pending" as const,
        plusItems: plusItems && plusItems.length > 0 ? plusItems : null,
      });
    }
    if (entries.length > 0) {
      await upsertNaturalDayDiets(entries);
    }
    const dates = selectedItems.map((d) => (typeof d === "string" ? d : d.date)).filter(Boolean);
    await dismissNaturalDayDiets(dates);
    setPendingDietsVisible(false);
    qc.invalidateQueries({ queryKey: ["dietas-resumen"] }).catch(() => {});
    qc.invalidateQueries({ queryKey: ["km-resumen"] }).catch(() => {});
    qc.invalidateQueries({ queryKey: ["viaje-resumen"] }).catch(() => {});
    setPendingConfirmRichItems(null);
  }, [pendingDiets, qc]);

  const handleConfirmPendingDiets = useCallback(
    async (selectedItems: Array<string | DetectedDiet>) => {
      try {
        setPendingDietsSaving(true);

        const rawRichItems: DetectedDiet[] = [];
        const dates: string[] = [];
        const sinDietaDates = new Set<string>();
        for (const it of selectedItems) {
          if (it && typeof it === "object" && "date" in it) {
            if (it.removed) continue;
            if (it.userPercentage === "SIN_DIETA") {
              dates.push(it.date);
              sinDietaDates.add(it.date);
              continue;
            }
            rawRichItems.push(it);
            dates.push(it.date);
          } else if (typeof it === "string") {
            dates.push(it);
          }
        }
        const richItems = rawRichItems.map(toMissingDay);
        setPendingConfirmRichItems(richItems.length > 0 ? richItems : null);

        const richByDate = new Map<string, DetectedMissingNaturalDay>();
        for (const r of richItems) richByDate.set(r.date, r);

        const arrivalsNeedingModal: DetectedMissingNaturalDay[] = [];
        const initialChoices = new Map<string, { percentage: 100 | 60 | 30 | null; amount: number }>();

        for (const sinDate of sinDietaDates) {
          initialChoices.set(sinDate, { percentage: null, amount: 0 });
        }

        for (const d of dates) {
          if (sinDietaDates.has(d)) continue;
          const pending = pendingDiets.find((p) => p.date === d);
          if (!pending?.isBaseArrivalDay) continue;
          const rich = richByDate.get(d);
          const hasUserPct = rich && typeof rich.userPercentage === "number" && rich.userPercentage !== null;
          if (hasUserPct) {
            initialChoices.set(d, {
              percentage: rich!.userPercentage as 100 | 60 | 30,
              amount: typeof rich!.userAmount === "number" ? rich!.userAmount : pending.amount,
            });
          } else {
            arrivalsNeedingModal.push(rich ?? pending);
          }
        }

        if (arrivalsNeedingModal.length === 0) {
          const finalItems = richItems.length > 0
            ? (richItems as Array<string | DetectedMissingNaturalDay>)
            : dates;
          await upsertAllPendingSelections(finalItems, initialChoices);
          return;
        }

        setArrivalSelectorChoices(initialChoices);
        setArrivalSelectorQueue(arrivalsNeedingModal);
        setPendingDietsSaving(false);

        const first = arrivalsNeedingModal[0];
        let arrivalHHMM: string | null = null;
        if (first.previousJourneyId) {
          const all = await import("@/lib/local-storage").then((m) => m.listarJornadas());
          const j = all.find((x: any) => x.id === first.previousJourneyId);
          if (j && j.horaFin) arrivalHHMM = j.horaFin;
        }
        setArrivalSelectorDay({
          date: first.date,
          type: first.type,
          location: first.location || null,
          arrivalTime: arrivalHHMM,
          routeLabel: first.type,
        });
        setArrivalSelectorVisible(true);

      } catch (e: any) {
        Alert.alert(t("common.error"), e?.message || String(e));
      } finally {
        const anyArrivalDates = Array.isArray(selectedItems)
          ? new Set(selectedItems.map((x) => (typeof x === "string" ? x : x?.date)).filter(Boolean))
          : new Set<string>();
        if (!pendingDiets.find((p) => p.isBaseArrivalDay && anyArrivalDates.has(p.date))) setPendingDietsSaving(false);
      }
    },
    [pendingDiets, t, upsertAllPendingSelections, toMissingDay],
  );

  const handleArrivalChoiceConfirm = useCallback(async (choice: { percentage: 100|60|30|null; amount: number }) => {
    try {
      setPendingDietsSaving(true);
      const queue = arrivalSelectorQueue.slice();
      const current = queue.shift();
      const choices = new Map(arrivalSelectorChoices);
      if (current) {
        choices.set(current.date, choice);
      }
      setArrivalSelectorChoices(choices);

      if (queue.length > 0) {
        const next = queue[0];
        setArrivalSelectorQueue(queue);
        let arrivalHHMM: string | null = null;
        if (next.previousJourneyId) {
          const all = await import("@/lib/local-storage").then((m) => m.listarJornadas());
          const j = all.find((x: any) => x.id === next.previousJourneyId);
          if (j && j.horaFin) arrivalHHMM = j.horaFin;
        }
        setArrivalSelectorDay({
          date: next.date,
          type: next.type,
          location: next.location || null,
          arrivalTime: arrivalHHMM,
          routeLabel: next.type,
        });
        setPendingDietsSaving(false);
        return;
      }

      setArrivalSelectorQueue([]);
      setArrivalSelectorVisible(false);
      setArrivalSelectorDay(null);

      const richByDate = new Map<string, DetectedMissingNaturalDay>();
      if (pendingConfirmRichItems) {
        for (const r of pendingConfirmRichItems) richByDate.set(r.date, r);
      } else {
        for (const p of pendingDiets) richByDate.set(p.date, p);
      }

      const selectedDatesSet = new Set<string>();
      const finalRichItems: DetectedMissingNaturalDay[] = [];
      const nonArrivalDates = new Set<string>();

      const nonArrivals = pendingDiets.filter((p) => !p.isBaseArrivalDay);
      for (const p of nonArrivals) nonArrivalDates.add(p.date);
      for (const r of (pendingConfirmRichItems ?? [])) {
        if (!r.isBaseArrivalDay) nonArrivalDates.add(r.date);
      }

      for (const [date, ch] of choices.entries()) {
        if (ch.percentage == null) {
          nonArrivalDates.delete(date);
          continue;
        }
        selectedDatesSet.add(date);
        const src = richByDate.get(date);
        const merged: DetectedMissingNaturalDay = src
          ? { ...src, userPercentage: ch.percentage, userAmount: ch.amount }
          : {
              date,
              type: (pendingDiets.find((p) => p.date === date)?.type ?? "NACIONAL") as any,
              percentage: ch.percentage,
              amount: ch.amount,
              userPercentage: ch.percentage,
              userAmount: ch.amount,
            };
        finalRichItems.push(merged);
      }
      for (const date of nonArrivalDates) {
        if (selectedDatesSet.has(date)) continue;
        selectedDatesSet.add(date);
        const src = richByDate.get(date);
        if (src) finalRichItems.push(src);
      }

      const finalItems: Array<string | DetectedMissingNaturalDay> = pendingConfirmRichItems && finalRichItems.length > 0
        ? finalRichItems
        : Array.from(selectedDatesSet);
      await upsertAllPendingSelections(finalItems, choices);
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message || String(e));
    } finally {
      setPendingDietsSaving(false);
      setPendingDietsBannerVisible(false);
      setPendingDiets([]);
    }
  }, [arrivalSelectorQueue, arrivalSelectorChoices, pendingDiets, pendingConfirmRichItems, t, upsertAllPendingSelections]);

  const handleArrivalChoiceClose = useCallback(async () => {
    setArrivalSelectorVisible(false);
    setArrivalSelectorDay(null);
    setArrivalSelectorQueue([]);
    setPendingConfirmRichItems(null);
    setPendingDietsSaving(false);
    try {
      await dismissNaturalDayDiets(pendingDiets.map((d) => d.date));
      setPendingDietsVisible(false);
      setPendingDietsBannerVisible(false);
      setPendingDiets([]);
    } catch {}
  }, [pendingDiets, t]);

  const handleCancelPendingDiets = useCallback(() => {
    dismissNaturalDayDiets(pendingDiets.map(d => d.date)).catch(() => {});
    setPendingDietsVisible(false);
    setPendingDiets([]);
    setPendingDietsBannerVisible(false);
    setArrivalSelectorVisible(false);
    setArrivalSelectorDay(null);
    setArrivalSelectorQueue([]);
    setPendingConfirmRichItems(null);
  }, [pendingDiets]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              qc.invalidateQueries({ queryKey: ["dietas-resumen"] });
              qc.invalidateQueries({ queryKey: ["km-resumen"] });
              qc.invalidateQueries({ queryKey: ["viaje-resumen"] });
              qc.invalidateQueries({ queryKey: ["morocco-summary"] });
              qc.invalidateQueries({ queryKey: ["ferry-extras-summary"] });
            }}
            tintColor={Colors.light.tint}
          />
        }
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t("dietas.title")}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Pressable
              onPress={async () => {
                try {
                  await clearDismissedNaturalDayDietsInRange(periodo.from, periodo.to);
                  const fresh = await detectMissingOutOfBaseDietDays({
                    fromDate: periodo.from,
                    toDate: periodo.to,
                  });
                  setPendingDiets(fresh);
                  if (fresh && fresh.length > 0) {
                    setPendingDietsVisible(true);
                    setPendingDietsBannerVisible(true);
                  } else {
                    setPendingDietsBannerVisible(false);
                  }
                } catch {}
              }}
              hitSlop={8}
              style={({ pressed }) => [
                {
                  flexDirection: "row",
                  alignItems: "center",
                  height: 44,
                  paddingHorizontal: 14,
                  borderRadius: 22,
                  backgroundColor: "#fff",
                  borderWidth: 1,
                  borderColor: Colors.light.tint,
                  opacity: pressed ? 0.9 : 1,
                },
              ]}
            >
              <Ionicons name="refresh-outline" size={18} color={Colors.light.tint} />
              <Text style={{ color: Colors.light.tint, fontSize: 13, fontWeight: "600", marginLeft: 6 }}>
                Re-evaluar
              </Text>
            </Pressable>
            <Pressable
              onPress={() => router.push("/usuario")}
              hitSlop={8}
              style={({ pressed }) => [
                {
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  borderWidth: 1,
                  borderColor: Colors.light.border,
                  backgroundColor: Colors.light.surface,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.9 : 1,
                },
              ]}
            >
              <Ionicons name="settings-outline" size={20} color={Colors.light.tint} />
            </Pressable>
          </View>
        </View>

        {pendingDietsBannerVisible && pendingDiets.length > 0 && (
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 12,
              padding: 14,
              marginHorizontal: 16,
              marginVertical: 8,
              borderRadius: 12,
              backgroundColor: "rgba(254, 243, 199, 1)",
              borderWidth: 1,
              borderColor: Colors.light.tint,
              opacity: 0.95,
            }}
          >
            <Ionicons
              name="alert-circle-outline"
              size={22}
              color={Colors.light.tint}
              style={{ paddingTop: 1 }}
            />
            <View style={{ flex: 1, flexDirection: "column", gap: 6 }}>
              <Text
                style={{
                  fontSize: 15,
                  fontWeight: "bold",
                  color: Colors.light.tint,
                }}
              >
                ⚠ {pendingDiets.length} dietas fuera de base pendientes de revisar
              </Text>
              <Text
                style={{
                  fontSize: 13,
                  color: Colors.light.text,
                  opacity: 0.8,
                }}
              >
                Días naturales sin jornada propia detectados. Pulsa para confirmarlas o descartarlas.
              </Text>
              <View style={{ flexDirection: "row", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
                <Pressable
                  style={({ pressed }) => ({
                    alignSelf: "flex-start",
                    backgroundColor: Colors.light.tint,
                    paddingVertical: 8,
                    paddingHorizontal: 16,
                    borderRadius: 8,
                    opacity: pressed ? 0.85 : 1,
                  })}
                  onPress={() => {
                    setPendingDietsVisible(true);
                    setPendingDietsBannerVisible(false);
                  }}
                >
                  <Text
                    style={{
                      color: "#FFFFFF",
                      fontSize: 14,
                      fontWeight: "bold",
                    }}
                  >
                    Revisar ahora
                  </Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => ({
                    alignSelf: "flex-start",
                    backgroundColor: "#fff",
                    borderWidth: 1,
                    borderColor: Colors.light.tint,
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    opacity: pressed ? 0.85 : 1,
                    maxWidth: "100%",
                  })}
                  onPress={async () => {
                    try {
                      await clearDismissedNaturalDayDietsInRange(periodo.from, periodo.to);
                      const fresh = await detectMissingOutOfBaseDietDays({
                        fromDate: periodo.from,
                        toDate: periodo.to,
                      });
                      setPendingDiets(fresh);
                      if (fresh.length > 0) {
                        setPendingDietsVisible(true);
                      }
                      setPendingDietsBannerVisible(fresh.length > 0);
                    } catch {}
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Ionicons name="refresh-outline" size={14} color={Colors.light.tint} />
                    <Text
                      style={{
                        color: Colors.light.tint,
                        fontSize: 13,
                        fontWeight: "600",
                        flexShrink: 1,
                      }}
                      numberOfLines={2}
                    >
                      Re-evaluar (olvidar cancelados)
                    </Text>
                  </View>
                </Pressable>
              </View>
            </View>
          </View>
        )}

        <View style={styles.periodoNav}>
          <Pressable onPress={() => setPeriodoIdx((p) => p + 1)}>
            <Ionicons name="chevron-back" size={22} color={Colors.light.tint} />
          </Pressable>
          <Text style={styles.periodoText}>{periodo.label}</Text>
          <Pressable onPress={() => setPeriodoIdx((p) => Math.max(0, p - 1))}>
            <Ionicons
              name="chevron-forward"
              size={22}
              color={periodoIdx === 0 ? Colors.light.border : Colors.light.tint}
            />
          </Pressable>
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.saveBtn,
            { opacity: pressed ? 0.85 : 1, marginTop: 8, backgroundColor: Colors.light.tint },
          ]}
          onPress={() => {
            router.push({ pathname: "/usuario", params: { section: "estimacion_nomina", from: periodo.from, to: periodo.to } } as any);
          }}
        >
          <Ionicons name="calculator-outline" size={18} color="#fff" />
          <Text style={styles.saveBtnText}>Estimación de nómina</Text>
        </Pressable>

        {!isMoroccoMode && hasOffsiteDates && (
          <View style={styles.refCard}>
            <Pressable
              style={({ pressed }) => [
                styles.saveBtn,
                { opacity: pressed ? 0.85 : 1, marginTop: 4, backgroundColor: Colors.light.tint },
                savingOffsite && styles.btnDisabled,
              ]}
              onPress={() => setShowOffsiteForm((p) => !p)}
              disabled={savingOffsite}
            >
              <Ionicons name="add-circle-outline" size={18} color="#fff" />
              <Text style={styles.saveBtnText}>{t("dietas.offsiteWeeklyRestButton")}</Text>
            </Pressable>
            <Text style={styles.refFooterText}>{t("dietas.offsiteWeeklyRestHint")}</Text>

            {showOffsiteForm && (
              <>
                <View style={{ marginTop: 12 }}>
                  <Text style={styles.refLabel}>{t("dietas.offsiteWeeklyRestDate")}</Text>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    {(offsiteDatesQuery.data || []).length === 0 ? (
                      <Text style={styles.refFooterText}>{t("dietas.offsiteWeeklyRestNoDates")}</Text>
                    ) : (
                      (offsiteDatesQuery.data || []).map((d) => {
                        const active = offsiteDate === d;
                        return (
                          <Pressable
                            key={d}
                            style={({ pressed }) => [
                              styles.chip,
                              active && styles.chipActive,
                              { opacity: pressed ? 0.85 : 1 },
                            ]}
                            onPress={() => {
                              setOffsiteDate(d);
                              setOffsiteAmountTouched(false);
                              const isSunday = new Date(`${d}T00:00:00`).getDay() === 0;
                              if (isSunday) setOffsitePlusSunday(true);
                            }}
                          >
                            <Text style={[styles.chipText, active && styles.chipTextActive]}>{formatFecha(d)}</Text>
                          </Pressable>
                        );
                      })
                    )}
                  </View>
                </View>

                <View style={{ marginTop: 12 }}>
                  <Text style={styles.refLabel}>{t("dietas.offsiteWeeklyRestType")}</Text>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    {(["WEEKLY_REDUCED", "WEEKLY_COMPLETE"] as const).map((rt) => (
                      <Pressable
                        key={rt}
                        style={({ pressed }) => [
                          styles.chip,
                          offsiteRestType === rt && styles.chipActive,
                          { opacity: pressed ? 0.85 : 1 },
                        ]}
                        onPress={() => { setOffsiteRestType(rt); setOffsiteAmountTouched(false); }}
                      >
                        <Text style={[styles.chipText, offsiteRestType === rt && styles.chipTextActive]}>
                          {rt === "WEEKLY_REDUCED" ? t("dietas.offsiteWeeklyRestReduced") : t("dietas.offsiteWeeklyRestComplete")}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                <View style={{ marginTop: 12 }}>
                  <Text style={styles.refLabel}>{t("dietas.offsiteWeeklyRestBase")}</Text>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    {(["NACIONAL", "INTERNACIONAL"] as const).map((b) => (
                      <Pressable
                        key={b}
                        style={({ pressed }) => [
                          styles.chip,
                          offsiteBase === b && styles.chipActive,
                          { opacity: pressed ? 0.85 : 1 },
                        ]}
                        onPress={() => { setOffsiteBase(b); setOffsiteAmountTouched(false); }}
                      >
                        <Text style={[styles.chipText, offsiteBase === b && styles.chipTextActive]}>
                          {b === "NACIONAL" ? t("common.nacional") : t("common.internacional")}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                <View style={{ marginTop: 12 }}>
                  <Pressable
                    style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 8, opacity: pressed ? 0.85 : 1 }]}
                    onPress={() => { setOffsitePlusSunday((v) => !v); setOffsiteAmountTouched(false); }}
                  >
                    <Ionicons name={offsitePlusSunday ? "checkbox" : "square-outline"} size={18} color={Colors.light.tint} />
                    <Text style={styles.refLabel}>{t("dietas.offsiteWeeklyRestPlusSunday")}</Text>
                  </Pressable>
                  <View style={{ height: 8 }} />
                  <Pressable
                    style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 8, opacity: pressed ? 0.85 : 1 }]}
                    onPress={() => { setOffsitePlusHoliday((v) => !v); setOffsiteAmountTouched(false); }}
                  >
                    <Ionicons name={offsitePlusHoliday ? "checkbox" : "square-outline"} size={18} color={Colors.light.tint} />
                    <Text style={styles.refLabel}>{t("dietas.offsiteWeeklyRestPlusHoliday")}</Text>
                  </Pressable>
                </View>

                <View style={{ marginTop: 12 }}>
                  <Text style={styles.refLabel}>{t("dietas.offsiteWeeklyRestAmount")}</Text>
                  <TextInput
                    style={styles.input}
                    value={offsiteAmount}
                    onChangeText={(v) => { setOffsiteAmount(v); setOffsiteAmountTouched(true); }}
                    keyboardType="decimal-pad"
                    placeholder={suggestedOffsiteBaseAmount.toFixed(2)}
                    placeholderTextColor="#9CA3AF"
                  />
                  <Text style={styles.refFooterText}>
                    {t("dietas.offsiteWeeklyRestAutoHint")} {suggestedOffsiteBaseAmount.toFixed(2)} EUR
                  </Text>
                  <View style={{ marginTop: 8, gap: 4 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={styles.refFooterText}>Plus</Text>
                      <Text style={[styles.refFooterText, { fontFamily: "Inter_600SemiBold", color: Colors.light.warning }]}>
                        {suggestedOffsitePlusAmount.toFixed(2)} EUR
                      </Text>
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={styles.refFooterText}>{t("common.total")}</Text>
                      <Text style={[styles.refFooterText, { fontFamily: "Inter_700Bold", color: Colors.light.text }]}>
                        {effectiveOffsiteTotalAmount.toFixed(2)} EUR
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={{ marginTop: 12 }}>
                  <Text style={styles.refLabel}>{t("dietas.offsiteWeeklyRestNote")}</Text>
                  <TextInput
                    style={styles.input}
                    value={offsiteNote}
                    onChangeText={setOffsiteNote}
                    placeholder={t("dietas.offsiteWeeklyRestNotePlaceholder")}
                    placeholderTextColor="#9CA3AF"
                  />
                </View>

                <Pressable
                  style={({ pressed }) => [
                    styles.saveBtn,
                    { opacity: pressed ? 0.85 : 1, marginTop: 12 },
                    savingOffsite && styles.btnDisabled,
                  ]}
                  disabled={savingOffsite}
                  onPress={async () => {
                    if (!offsiteDate) {
                      Alert.alert(t("common.error"), t("dietas.offsiteWeeklyRestPickDate"));
                      return;
                    }
                    const amountParsed = offsiteAmount.trim() ? parseFloat(offsiteAmount) : null;
                    if (amountParsed == null || !Number.isFinite(amountParsed) || amountParsed < 0) {
                      Alert.alert(t("common.error"), t("usuario.ratesPositive"));
                      return;
                    }
                    setSavingOffsite(true);
                    try {
                      await addOffsiteWeeklyRestEntry({
                        date: offsiteDate,
                        restType: offsiteRestType,
                        base: offsiteBase,
                        plusSunday: offsitePlusSunday,
                        plusHoliday: offsitePlusHoliday,
                        amount: amountParsed,
                        note: offsiteNote.trim() || null,
                      });
                      setOffsiteDate("");
                      setOffsiteNote("");
                      setOffsitePlusSunday(false);
                      setOffsitePlusHoliday(false);
                      setOffsiteAmountTouched(false);
                      setOffsiteAmount("");
                      qc.invalidateQueries({ queryKey: ["day-extra-entries"] });
                      qc.invalidateQueries({ queryKey: ["dietas-resumen"] });
                      qc.invalidateQueries({ queryKey: ["km-resumen"] });
                      qc.invalidateQueries({ queryKey: ["viaje-resumen"] });
                      qc.invalidateQueries({ queryKey: ["offsite-weekly-rest-dates"] });
                    } catch (e: any) {
                      if (Platform.OS === "web") window.alert(e?.message || String(e));
                      else Alert.alert(t("common.error"), e?.message || String(e));
                    } finally {
                      setSavingOffsite(false);
                    }
                  }}
                >
                  {savingOffsite ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                  )}
                  <Text style={styles.saveBtnText}>{t("dietas.offsiteWeeklyRestSave")}</Text>
                </Pressable>
              </>
            )}
          </View>
        )}

        {isMoroccoMode && ferryConfig.paymentMode !== "morocco_diet" && moroccoQuery.data ? (
          <View style={styles.totalCard}>
            <View style={styles.totalIcon}>
              <Ionicons name={ferryConfig.paymentMode === "morocco_trip" ? "airplane" : "bed"} size={32} color={Colors.light.accent} />
            </View>
            <Text style={styles.totalLabel}>
              {ferryConfig.paymentMode === "morocco_trip" ? t("morocco.summary.totalTrips") : t("morocco.summary.totalNights")}
            </Text>
            <Text style={styles.totalValue}>
              {(moroccoQuery.data.totalDieta + moroccoQuery.data.totalExtras).toFixed(2)} EUR
            </Text>
            <Text style={styles.totalSub}>
              {moroccoQuery.data.count} {t("historial.jornadas")}
              {ferryConfig.paymentMode === "morocco_trip"
                ? ` · ${ferryConfig.tripRate.toFixed(2)} €/${t("morocco.summary.byTrip")}`
                : ` · ${ferryConfig.pernightRate.toFixed(2)} €/${t("morocco.summary.byPernight")}`}
            </Text>
            {moroccoQuery.data.totalExtras > 0 && (
              <Text style={[styles.totalSub, { color: Colors.light.warning }]}>
                +{moroccoQuery.data.totalExtras.toFixed(2)} € {t("historial.extras")}
              </Text>
            )}
          </View>
        ) : null}

        {!isMoroccoMode && paymentMode === "km" ? (
          kmResumenQuery.isLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={Colors.light.tint} />
            </View>
          ) : kmData ? (
            <>
              <View style={styles.totalCard}>
                <View style={styles.totalIcon}>
                  <Ionicons name="wallet" size={32} color={Colors.light.accent} />
                </View>
                <Text style={styles.totalLabel}>{t("dietas.summary")}</Text>
                <Text style={styles.totalValue}>{grandTotal.toFixed(2)} EUR</Text>
                <View style={[styles.summaryRow, { flexWrap: "wrap" }]}>
                  <View style={[styles.summaryItem, { flexBasis: "48%" }]}>
                    <Text style={styles.summaryLabel}>{t("dietas.totalKm")}</Text>
                    <Text style={styles.summaryValue}>{(kmData.totalKm || 0).toFixed(0)} km</Text>
                  </View>
                  <View style={[styles.summaryItem, { flexBasis: "48%" }]}>
                    <Text style={styles.summaryLabel}>{t("dietas.totalKmAmount")}</Text>
                    <Text style={styles.summaryValue}>{(kmData.totalImporte || 0).toFixed(2)} €</Text>
                  </View>
                  <View style={[styles.summaryItem, { flexBasis: "48%" }]}>
                    <Text style={styles.summaryLabel}>{t("dietas.totalDiets")}</Text>
                    <Text style={styles.summaryValue}>{Number(kmData.dietas?.totalDietas || 0).toFixed(2)} €</Text>
                  </View>
                  <View style={[styles.summaryItem, { flexBasis: "48%" }]}>
                    <Text style={styles.summaryLabel}>{t("dietas.totalExtras")}</Text>
                    <Text style={styles.summaryValue}>{totalExtras.toFixed(2)} €</Text>
                  </View>
                  <View style={[styles.summaryItem, { flexBasis: "48%" }]}>
                    <Text style={styles.summaryLabel}>{t("dietas.totalPlus")}</Text>
                    <Text style={styles.summaryValue}>{totalPlus.toFixed(2)} €</Text>
                  </View>
                </View>
                <Text style={styles.totalSub}>
                  {t("dietas.periodLabel")} {periodo.label} · {(kmData.totalKm || 0).toFixed(0)} km
                </Text>
              </View>

              {kmData.dietas && kmData.dietas.totalDietas > 0 && (
                <View style={styles.extrasCard}>
                  <View style={styles.extrasHeader}>
                    <Ionicons name="cash-outline" size={18} color={Colors.light.tint} />
                    <Text style={[styles.extrasTitle, { color: Colors.light.tint }]}>{t("dietas.totalDiets")}</Text>
                    <Text style={[styles.extrasTotal, { color: Colors.light.text }]}>
                      {Number(kmData.dietas.totalDietas || 0).toFixed(2)} EUR
                    </Text>
                  </View>
                  {kmData.dietas.desglose.map((d: any) => (
                    <View key={`dietas-${d.tipo}`} style={styles.extrasRow}>
                      <Text style={styles.extrasType}>{extraTipoLabel(d.tipo)}</Text>
                      <Text style={styles.extrasQty}>{d.cantidad}x</Text>
                      <Text style={styles.extrasAmount}>{Number(d.total || 0).toFixed(2)} EUR</Text>
                    </View>
                  ))}
                </View>
              )}

              {kmData.desglose.length > 0 ? (
                <View style={styles.tableCard}>
                  <View style={styles.tableHeader}>
                    <Text style={[styles.tableCell, styles.tableCellType]}>{t("dietas.type")}</Text>
                    <Text style={[styles.tableCell, styles.tableCellQty]}>{t("dietas.kmQty")}</Text>
                    <Text style={[styles.tableCell, styles.tableCellTotal]}>{t("common.total")}</Text>
                  </View>
                  {kmData.desglose.map((d: any) => (
                    <View key={d.tipo} style={styles.tableRow}>
                      <Text style={[styles.tableCell, styles.tableCellType]}>
                        {d.tipo === "NACIONAL" ? t("common.nacional") : d.tipo === "REGIONAL" ? t("common.regional") : t("common.internacional")}
                      </Text>
                      <Text style={[styles.tableCell, styles.tableCellQty]}>{Number(d.cantidad || 0).toFixed(0)}</Text>
                      <Text style={[styles.tableCell, styles.tableCellTotal]}>
                        {Number(d.total || 0).toFixed(2)} EUR
                      </Text>
                    </View>
                  ))}
                  <View style={[styles.tableRow, { borderBottomWidth: 0, backgroundColor: Colors.light.background }]}>
                    <Text style={[styles.tableCell, styles.tableCellType, { fontFamily: "Inter_700Bold" }]}>
                      {t("common.total")}
                    </Text>
                    <Text style={[styles.tableCell, styles.tableCellQty, { fontFamily: "Inter_700Bold", color: Colors.light.text }]}>
                      {Number(kmData.totalKm || 0).toFixed(0)}
                    </Text>
                    <Text style={[styles.tableCell, styles.tableCellTotal, { fontFamily: "Inter_700Bold" }]}>
                      {Number(kmData.totalImporte || 0).toFixed(2)} EUR
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={styles.empty}>
                  <Ionicons name="speedometer-outline" size={48} color={Colors.light.border} />
                  <Text style={styles.emptyText}>{t("dietas.noKm")}</Text>
                </View>
              )}

              {((kmData.extras && kmData.extras.totalExtras > 0) || (kmData.plus && kmData.plus.totalPlus > 0)) && (
                <View style={styles.extrasCard}>
                  <View style={styles.extrasHeader}>
                    <Ionicons name="add-circle" size={18} color={Colors.light.warning} />
                    <Text style={styles.extrasTitle}>{t("dietas.accumulatedExtras")}</Text>
                    <Text style={styles.extrasTotal}>
                      {((kmData.extras?.totalExtras || 0) + (kmData.plus?.totalPlus || 0)).toFixed(2)} EUR
                    </Text>
                  </View>
                  {kmData.extras && kmData.extras.desglose.map((e: any) => (
                    <View key={`day-${e.tipo}`} style={styles.extrasRow}>
                      <Text style={styles.extrasType}>{extraTipoLabel(e.tipo)}</Text>
                      <Text style={styles.extrasQty}>{e.cantidad}x</Text>
                      <Text style={styles.extrasAmount}>{e.total.toFixed(2)} EUR</Text>
                    </View>
                  ))}
                  {kmData.plus && kmData.plus.desglose.map((e: any) => (
                    <View key={`plus-${e.tipo}`} style={styles.extrasRow}>
                      <Text style={styles.extrasType}>{e.tipo}</Text>
                      <Text style={styles.extrasQty}>{e.cantidad}x</Text>
                      <Text style={styles.extrasAmount}>{e.total.toFixed(2)} EUR</Text>
                    </View>
                  ))}
                </View>
              )}
            </>
          ) : null
        ) : !isMoroccoMode && paymentMode === "viaje" ? (
          viajeResumenQuery.isLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={Colors.light.tint} />
            </View>
          ) : viajeData ? (
            <>
              <View style={styles.totalCard}>
                <View style={styles.totalIcon}>
                  <Ionicons name="wallet" size={32} color={Colors.light.accent} />
                </View>
                <Text style={styles.totalLabel}>{t("dietas.summary")}</Text>
                <Text style={styles.totalValue}>{grandTotal.toFixed(2)} EUR</Text>
                <View style={[styles.summaryRow, { flexWrap: "wrap" }]}>
                  <View style={[styles.summaryItem, { flexBasis: "48%" }]}>
                    <Text style={styles.summaryLabel}>{t("dietas.totalTrips")}</Text>
                    <Text style={styles.summaryValue}>{Number(viajeData.totalViajes || 0)}</Text>
                  </View>
                  <View style={[styles.summaryItem, { flexBasis: "48%" }]}>
                    <Text style={styles.summaryLabel}>{t("dietas.totalTripAmount")}</Text>
                    <Text style={styles.summaryValue}>{(viajeData.totalImporte || 0).toFixed(2)} €</Text>
                  </View>
                  <View style={[styles.summaryItem, { flexBasis: "48%" }]}>
                    <Text style={styles.summaryLabel}>{t("dietas.totalDiets")}</Text>
                    <Text style={styles.summaryValue}>{Number(viajeData.dietas?.totalDietas || 0).toFixed(2)} €</Text>
                  </View>
                  <View style={[styles.summaryItem, { flexBasis: "48%" }]}>
                    <Text style={styles.summaryLabel}>{t("dietas.totalExtras")}</Text>
                    <Text style={styles.summaryValue}>{totalExtras.toFixed(2)} €</Text>
                  </View>
                  <View style={[styles.summaryItem, { flexBasis: "48%" }]}>
                    <Text style={styles.summaryLabel}>{t("dietas.totalPlus")}</Text>
                    <Text style={styles.summaryValue}>{totalPlus.toFixed(2)} €</Text>
                  </View>
                </View>
                <Text style={styles.totalSub}>
                  {t("dietas.periodLabel")} {periodo.label} · {Number(viajeData.totalViajes || 0)} {t("historial.jornadas")}
                </Text>
              </View>

              {viajeData.dietas && viajeData.dietas.totalDietas > 0 && (
                <View style={styles.extrasCard}>
                  <View style={styles.extrasHeader}>
                    <Ionicons name="cash-outline" size={18} color={Colors.light.tint} />
                    <Text style={[styles.extrasTitle, { color: Colors.light.tint }]}>{t("dietas.totalDiets")}</Text>
                    <Text style={[styles.extrasTotal, { color: Colors.light.text }]}>
                      {Number(viajeData.dietas.totalDietas || 0).toFixed(2)} EUR
                    </Text>
                  </View>
                  {viajeData.dietas.desglose.map((d: any) => (
                    <View key={`dietas-${d.tipo}`} style={styles.extrasRow}>
                      <Text style={styles.extrasType}>{extraTipoLabel(d.tipo)}</Text>
                      <Text style={styles.extrasQty}>{d.cantidad}x</Text>
                      <Text style={styles.extrasAmount}>{Number(d.total || 0).toFixed(2)} EUR</Text>
                    </View>
                  ))}
                </View>
              )}

              {viajeData.desglose && viajeData.desglose.length > 0 ? (
                <View style={styles.tableCard}>
                  <View style={styles.tableHeader}>
                    <Text style={[styles.tableCell, styles.tableCellType]}>{t("dietas.type")}</Text>
                    <Text style={[styles.tableCell, styles.tableCellQty]}>{t("dietas.qty")}</Text>
                    <Text style={[styles.tableCell, styles.tableCellTotal]}>{t("common.total")}</Text>
                  </View>
                  {viajeData.desglose.map((d: any) => (
                    <View key={d.tipo} style={styles.tableRow}>
                      <Text style={[styles.tableCell, styles.tableCellType]}>
                        {d.tipo === "NACIONAL" ? t("common.nacional") : d.tipo === "REGIONAL" ? t("common.regional") : t("common.internacional")}
                      </Text>
                      <Text style={[styles.tableCell, styles.tableCellQty]}>{Number(d.cantidad || 0)}</Text>
                      <Text style={[styles.tableCell, styles.tableCellTotal]}>
                        {Number(d.total || 0).toFixed(2)} EUR
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <View style={styles.empty}>
                  <Ionicons name="swap-horizontal-outline" size={48} color={Colors.light.border} />
                  <Text style={styles.emptyText}>{t("dietas.noTrips")}</Text>
                </View>
              )}

              {((viajeData.extras && viajeData.extras.totalExtras > 0) || (viajeData.plus && viajeData.plus.totalPlus > 0)) && (
                <View style={styles.extrasCard}>
                  <View style={styles.extrasHeader}>
                    <Ionicons name="add-circle" size={18} color={Colors.light.warning} />
                    <Text style={styles.extrasTitle}>{t("dietas.accumulatedExtras")}</Text>
                    <Text style={styles.extrasTotal}>
                      {((viajeData.extras?.totalExtras || 0) + (viajeData.plus?.totalPlus || 0)).toFixed(2)} EUR
                    </Text>
                  </View>
                  {viajeData.extras && viajeData.extras.desglose.map((e: any) => (
                    <View key={`day-${e.tipo}`} style={styles.extrasRow}>
                      <Text style={styles.extrasType}>{extraTipoLabel(e.tipo)}</Text>
                      <Text style={styles.extrasQty}>{e.cantidad}x</Text>
                      <Text style={styles.extrasAmount}>{e.total.toFixed(2)} EUR</Text>
                    </View>
                  ))}
                  {viajeData.plus && viajeData.plus.desglose.map((e: any) => (
                    <View key={`plus-${e.tipo}`} style={styles.extrasRow}>
                      <Text style={styles.extrasType}>{e.tipo}</Text>
                      <Text style={styles.extrasQty}>{e.cantidad}x</Text>
                      <Text style={styles.extrasAmount}>{e.total.toFixed(2)} EUR</Text>
                    </View>
                  ))}
                </View>
              )}
            </>
          ) : null
        ) : (
          resumenQuery.isLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={Colors.light.tint} />
            </View>
          ) : data ? (
            <>
              {!(isMoroccoMode && ferryConfig.paymentMode !== "morocco_diet") && paymentMode === "dietas" && (
                <View style={styles.totalCard}>
                  <View style={styles.totalIcon}>
                    <Ionicons name="wallet" size={32} color={Colors.light.accent} />
                  </View>
                  <Text style={styles.totalLabel}>{t("dietas.summary")}</Text>
                  <Text style={styles.totalValue}>{grandTotal.toFixed(2)} EUR</Text>
                  <View style={styles.summaryRow}>
                    <View style={styles.summaryItem}>
                      <Text style={styles.summaryLabel}>{t("dietas.totalDiets")}</Text>
                      <Text style={styles.summaryValue}>{data.total.toFixed(2)} €</Text>
                    </View>
                    <View style={styles.summaryItem}>
                      <Text style={styles.summaryLabel}>{t("dietas.totalExtras")}</Text>
                      <Text style={styles.summaryValue}>{totalExtras.toFixed(2)} €</Text>
                    </View>
                    <View style={styles.summaryItem}>
                      <Text style={styles.summaryLabel}>{t("dietas.totalPlus")}</Text>
                      <Text style={styles.summaryValue}>{totalPlus.toFixed(2)} €</Text>
                    </View>
                  </View>
                  <Text style={styles.totalSub}>{t("dietas.periodLabel")} {periodo.label}</Text>
                </View>
              )}

              {!(isMoroccoMode && ferryConfig.paymentMode !== "morocco_diet") && paymentMode === "dietas" && (
                data.desglose.length > 0 ? (
                  <View style={styles.tableCard}>
                    <View style={styles.tableHeader}>
                      <Text style={[styles.tableCell, styles.tableCellType]}>{t("dietas.type")}</Text>
                      <Text style={[styles.tableCell, styles.tableCellQty]}>{t("dietas.qty")}</Text>
                      <Text style={[styles.tableCell, styles.tableCellTotal]}>{t("common.total")}</Text>
                    </View>
                    {data.desglose.map((d) => (
                      <View key={d.tipo} style={styles.tableRow}>
                        <Text style={[styles.tableCell, styles.tableCellType]}>
                          {d.tipo.startsWith("FUERA_BASE_") ? extraTipoLabel(d.tipo) : t(`common.dietType.${d.tipo}`)}
                        </Text>
                        <Text style={[styles.tableCell, styles.tableCellQty]}>{d.cantidad}</Text>
                        <Text style={[styles.tableCell, styles.tableCellTotal]}>
                          {d.total.toFixed(2)} EUR
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <View style={styles.empty}>
                    <Ionicons name="receipt-outline" size={48} color={Colors.light.border} />
                    <Text style={styles.emptyText}>{paymentMode === "dietas" ? t("dietas.noDiets") : t("dietas.noDietsMode")}</Text>
                  </View>
                )
              )}

              {paymentMode === "dietas" && ((data.extras && data.extras.totalExtras > 0) || (data.plus && data.plus.totalPlus > 0)) && (
                <View style={styles.extrasCard}>
                  <View style={styles.extrasHeader}>
                    <Ionicons name="add-circle" size={18} color={Colors.light.warning} />
                    <Text style={styles.extrasTitle}>{t("dietas.accumulatedExtras")}</Text>
                    <Text style={styles.extrasTotal}>
                      {((data.extras?.totalExtras || 0) + (data.plus?.totalPlus || 0)).toFixed(2)} EUR
                    </Text>
                  </View>
                  {data.extras && data.extras.desglose.map((e) => (
                    <View key={`day-${e.tipo}`} style={styles.extrasRow}>
                      <Text style={styles.extrasType}>{extraTipoLabel(e.tipo)}</Text>
                      <Text style={styles.extrasQty}>{e.cantidad}x</Text>
                      <Text style={styles.extrasAmount}>{e.total.toFixed(2)} EUR</Text>
                    </View>
                  ))}
                  {data.plus && data.plus.desglose.map((e) => (
                    <View key={`plus-${e.tipo}`} style={styles.extrasRow}>
                      <Text style={styles.extrasType}>{e.tipo}</Text>
                      <Text style={styles.extrasQty}>{e.cantidad}x</Text>
                      <Text style={styles.extrasAmount}>{e.total.toFixed(2)} EUR</Text>
                    </View>
                  ))}
                </View>
              )}
            </>
          ) : null
        )}

            <View style={styles.refCard}>
              <Text style={styles.refTitle}>{t("dietas.dayExtraRates")}</Text>
              <View style={styles.refRow}>
                <Text style={styles.refLabel}>{t("usuario.saturday")}</Text>
                <Text style={styles.refValue}>{dayExtras.extra_saturday.toFixed(2)} EUR</Text>
              </View>
              <View style={styles.refRow}>
                <Text style={styles.refLabel}>{t("usuario.sunday")}</Text>
                <Text style={styles.refValue}>{dayExtras.extra_sunday.toFixed(2)} EUR</Text>
              </View>
              <View style={styles.refRow}>
                <Text style={styles.refLabel}>{t("usuario.holiday")}</Text>
                <Text style={styles.refValue}>{dayExtras.extra_holiday.toFixed(2)} EUR</Text>
              </View>
            </View>

            {ferryExtras && ferryExtras.count > 0 && (ferryExtras.totalTransitDiet > 0 || ferryExtras.totalCabinOvernight > 0 || ferryExtras.totalCountryChange > 0) && (
              <View style={styles.extrasCard}>
                <View style={styles.extrasHeader}>
                  <MaterialCommunityIcons name="ferry" size={18} color="#0284c7" />
                  <Text style={[styles.extrasTitle, { color: "#0284c7" }]}>Extras Ferry / Transbordo</Text>
                  <Text style={[styles.extrasTotal, { color: "#0284c7" }]}>
                    {ferryExtras.totalAmount.toFixed(2)} EUR
                  </Text>
                </View>
                {ferryExtras.totalTransitDiet > 0 && (
                  <View style={styles.extrasRow}>
                    <Text style={styles.extrasType}>Dieta tránsito</Text>
                    <Text style={styles.extrasQty}>{ferryExtras.totalTransitDiet}x</Text>
                    <Text style={styles.extrasAmount}>{(ferryExtras.totalTransitDiet * ferryExtras.transitRate).toFixed(2)} EUR</Text>
                  </View>
                )}
                {ferryExtras.totalCabinOvernight > 0 && (
                  <View style={styles.extrasRow}>
                    <Text style={styles.extrasType}>Pernocta camarote</Text>
                    <Text style={styles.extrasQty}>{ferryExtras.totalCabinOvernight}x</Text>
                    <Text style={styles.extrasAmount}>{(ferryExtras.totalCabinOvernight * ferryExtras.cabinRate).toFixed(2)} EUR</Text>
                  </View>
                )}
                {ferryExtras.totalCountryChange > 0 && (
                  <View style={styles.extrasRow}>
                    <Text style={styles.extrasType}>Cambio de país</Text>
                    <Text style={styles.extrasQty}>{ferryExtras.totalCountryChange}x</Text>
                    <Text style={styles.extrasAmount}>-</Text>
                  </View>
                )}
                <View style={{ borderTopWidth: 1, borderTopColor: Colors.light.border, marginTop: 6, paddingTop: 6 }}>
                  <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textSecondary }}>
                    {ferryExtras.count} jornadas con extras ferry en este periodo
                  </Text>
                </View>
              </View>
            )}

            {!(isMoroccoMode && ferryConfig.paymentMode !== "morocco_diet") && (
              <View style={styles.refCard}>
                <Pressable
                  style={({ pressed }) => [styles.refToggleRow, { opacity: pressed ? 0.85 : 1 }]}
                  onPress={() => setShowReferencePrices((prev) => !prev)}
                >
                  <Text style={styles.refTitle}>{t("dietas.toggleReferencePrices")}</Text>
                  <Ionicons
                    name={showReferencePrices ? "chevron-up" : "chevron-down"}
                    size={18}
                    color={Colors.light.textSecondary}
                  />
                </Pressable>

                {showReferencePrices && (
                  <>
                    {customRates && customRates.length > 0 && (
                      <View style={styles.refCustomBadge}>
                        <Ionicons name="checkmark-circle" size={14} color={Colors.light.accent} />
                        <Text style={styles.refCustomText}>{t("dietas.customRates")}</Text>
                      </View>
                    )}
                    <View style={styles.refRow}>
                      <Text style={styles.refLabel}>{t("dietas.intl100")}</Text>
                      <Text style={styles.refValue}>{findRate(customRates, "INTERNACIONAL", 100).toFixed(2)} EUR</Text>
                    </View>
                    <View style={styles.refRow}>
                      <Text style={styles.refLabel}>{t("dietas.intl60")}</Text>
                      <Text style={styles.refValue}>{findRate(customRates, "INTERNACIONAL", 60).toFixed(2)} EUR</Text>
                    </View>
                    <View style={styles.refRow}>
                      <Text style={styles.refLabel}>{t("dietas.intl30")}</Text>
                      <Text style={styles.refValue}>{findRate(customRates, "INTERNACIONAL", 30).toFixed(2)} EUR</Text>
                    </View>
                    <View style={[styles.refRow, { marginTop: 8 }]}>
                      <Text style={styles.refLabel}>{t("dietas.nac100")}</Text>
                      <Text style={styles.refValue}>{findRate(customRates, "NACIONAL", 100).toFixed(2)} EUR</Text>
                    </View>
                    <View style={styles.refRow}>
                      <Text style={styles.refLabel}>{t("dietas.nac60")}</Text>
                      <Text style={styles.refValue}>{findRate(customRates, "NACIONAL", 60).toFixed(2)} EUR</Text>
                    </View>
                    <View style={styles.refRow}>
                      <Text style={styles.refLabel}>{t("dietas.nac30")}</Text>
                      <Text style={styles.refValue}>{findRate(customRates, "NACIONAL", 30).toFixed(2)} EUR</Text>
                    </View>
                    <View style={[styles.refRow, { marginTop: 8 }]}>
                      <Text style={styles.refLabel}>{t("dietas.reg100")}</Text>
                      <Text style={styles.refValue}>{findRate(customRates, "REGIONAL", 100).toFixed(2)} EUR</Text>
                    </View>
                    <View style={styles.refRow}>
                      <Text style={styles.refLabel}>{t("dietas.reg60")}</Text>
                      <Text style={styles.refValue}>{findRate(customRates, "REGIONAL", 60).toFixed(2)} EUR</Text>
                    </View>
                    <View style={styles.refRow}>
                      <Text style={styles.refLabel}>{t("dietas.reg30")}</Text>
                      <Text style={styles.refValue}>{findRate(customRates, "REGIONAL", 30).toFixed(2)} EUR</Text>
                    </View>

                    <Text style={styles.refFooterText}>{t("dietas.referencePricesConfigHint")}</Text>
                    <Text style={styles.refFooterText}>{t("dietas.referencePricesDisclaimer")}</Text>
                  </>
                )}
              </View>
            )}

        <View style={{ height: 100 }} />
      </ScrollView>

      <PendingNaturalDietsModal
        visible={pendingDietsVisible}
        detected={pendingDiets}
        onClose={handleCancelPendingDiets}
        onConfirm={handleConfirmPendingDiets}
        loading={pendingDietsSaving}
        autoPlusesCfg={{
          sunday: dayExtras?.extra_sunday ? Number(dayExtras.extra_sunday) || 0 : 0,
          holiday: dayExtras?.extra_holiday ? Number(dayExtras.extra_holiday) || 0 : 0,
        }}
      />

      <ArrivalDayDietSelectorModal
        visible={arrivalSelectorVisible}
        day={arrivalSelectorDay}
        onClose={handleArrivalChoiceClose}
        onConfirm={handleArrivalChoiceConfirm}
        loading={pendingDietsSaving}
      />
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
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingTop: 16,
    paddingBottom: 4,
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: Colors.light.tint,
  },
  periodoNav: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 16,
    paddingVertical: 10,
  },
  periodoText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
    minWidth: 130,
    textAlign: "center" as const,
  },
  loadingWrap: {
    paddingTop: 80,
    alignItems: "center" as const,
  },
  totalCard: {
    backgroundColor: Colors.light.surface,
    borderRadius: 20,
    padding: 24,
    alignItems: "center" as const,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    marginBottom: 16,
  },
  totalIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.light.accentLight,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    marginBottom: 12,
  },
  totalLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.light.textSecondary,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
  },
  totalValue: {
    fontSize: 32,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
    marginTop: 4,
  },
  totalSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    marginTop: 4,
  },
  summaryRow: {
    flexDirection: "row" as const,
    gap: 10,
    marginTop: 14,
    width: "100%" as const,
    justifyContent: "space-between" as const,
  },
  summaryItem: {
    flex: 1,
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  summaryLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: Colors.light.textSecondary,
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
  },
  tableCard: {
    backgroundColor: Colors.light.surface,
    borderRadius: 14,
    overflow: "hidden" as const,
    marginBottom: 16,
  },
  tableHeader: {
    flexDirection: "row" as const,
    backgroundColor: Colors.light.tint,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  tableRow: {
    flexDirection: "row" as const,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  tableCell: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  tableCellType: {
    flex: 1,
    color: Colors.light.text,
  },
  tableCellQty: {
    width: 50,
    textAlign: "center" as const,
    color: Colors.light.textSecondary,
  },
  tableCellTotal: {
    width: 90,
    textAlign: "right" as const,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.accent,
  },
  empty: {
    alignItems: "center" as const,
    paddingTop: 40,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
  },
  refCard: {
    backgroundColor: Colors.light.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  refTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
    marginBottom: 10,
  },
  refToggleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
  },
  refCustomBadge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    marginBottom: 8,
  },
  refCustomText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: Colors.light.accent,
  },
  refRow: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    paddingVertical: 4,
  },
  refLabel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
  },
  refValue: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
  },
  refFooterText: {
    marginTop: 10,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    lineHeight: 16,
  },
  extrasCard: {
    backgroundColor: Colors.light.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: Colors.light.warning,
  },
  extrasHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginBottom: 10,
  },
  extrasTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
    flex: 1,
  },
  extrasTotal: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: Colors.light.warning,
  },
  extrasRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingVertical: 5,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  extrasType: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.light.text,
  },
  extrasQty: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: Colors.light.textSecondary,
    marginRight: 12,
  },
  extrasAmount: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.accent,
    minWidth: 80,
    textAlign: "right" as const,
  },
  input: {
    marginTop: 6,
    backgroundColor: Colors.light.background,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: Colors.light.text,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.background,
  },
  chipActive: {
    borderColor: Colors.light.tint,
    backgroundColor: Colors.light.accentLight,
  },
  chipText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    color: Colors.light.textSecondary,
  },
  chipTextActive: {
    color: Colors.light.tint,
  },
  saveBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    backgroundColor: Colors.light.tint,
    borderRadius: 12,
    paddingVertical: 12,
  },
  saveBtnText: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
    color: "#fff",
  },
  btnDisabled: {
    opacity: 0.6,
  },
  plusCard: {
    backgroundColor: Colors.light.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: Colors.light.tint,
  },
});
