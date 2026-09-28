import React, { useState, useMemo, useCallback, useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  Platform,
  ActivityIndicator,
  TextInput,
  Alert,
  Modal,
  FlatList,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Colors from "@/constants/colors";
import {
  calcDayExtra,
  listarJornadas,
  getResumenDietas,
  getResumenKm,
  getAllViajes,
  getAllFerryRests,
  getFerryExtrasSummary,
  type Jornada,
  type Viaje,
  type Parada,
  type UserDietRate,
  type UserDayExtras,
  type DayExtraEntry,
  type FerryRestRecord,
  findRate,
  listDayExtraEntries,
  getAllNaturalDayDiets,
  type NaturalDayDietEntry,
} from "@/lib/local-storage";
import { useFerry } from "@/lib/ferry-context";
import {
  formatFecha,
  formatMinutosHoras,
  todayStr,
} from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n-context";
import { userScopedKey } from "@/lib/user-scope";
import { fetchDayExtras, fetchDietRates } from "@/lib/user-cloud";

type ExportContent = "historial" | "dietas" | "viajes" | "ambos" | "todo";
type ReportOptions = { showAmounts: boolean; showPluses: boolean };

const REPORT_OPTIONS_KEY = "tacoplan_report_options";

function escapeHtml(value: unknown): string {
  const s = String(value ?? "");
  return s.replace(/[&<>"']/g, (ch) => {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === "\"") return "&quot;";
    return "&#39;";
  });
}

function getDefaultFrom(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  d.setDate(20);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getMonths(t: (key: string) => string): string[] {
  return [
    t("export.pdfMonthJan"), t("export.pdfMonthFeb"), t("export.pdfMonthMar"),
    t("export.pdfMonthApr"), t("export.pdfMonthMay"), t("export.pdfMonthJun"),
    t("export.pdfMonthJul"), t("export.pdfMonthAug"), t("export.pdfMonthSep"),
    t("export.pdfMonthOct"), t("export.pdfMonthNov"), t("export.pdfMonthDec"),
  ];
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function parseIsoDate(iso: string): { day: number; month: number; year: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { day: d || 1, month: m || 1, year: y || 2026 };
}

function formatIso(day: number, month: number, year: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatDisplay(iso: string): string {
  const { day, month, year } = parseIsoDate(iso);
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

function DatePickerModal({
  visible,
  value,
  onConfirm,
  onCancel,
  title,
  months,
  dayLabel,
  monthLabel,
  yearLabel,
  cancelLabel,
  confirmLabel,
}: {
  visible: boolean;
  value: string;
  onConfirm: (iso: string) => void;
  onCancel: () => void;
  title: string;
  months: string[];
  dayLabel: string;
  monthLabel: string;
  yearLabel: string;
  cancelLabel: string;
  confirmLabel: string;
}) {
  const parsed = parseIsoDate(value);
  const [selDay, setSelDay] = useState(parsed.day);
  const [selMonth, setSelMonth] = useState(parsed.month);
  const [selYear, setSelYear] = useState(parsed.year);

  useEffect(() => {
    if (visible) {
      const p = parseIsoDate(value);
      setSelDay(p.day);
      setSelMonth(p.month);
      setSelYear(p.year);
    }
  }, [visible, value]);

  const maxDay = daysInMonth(selYear, selMonth);
  const clampedDay = Math.min(selDay, maxDay);

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 10 }, (_, i) => currentYear - 5 + i);
  const days = Array.from({ length: maxDay }, (_, i) => i + 1);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={dpStyles.overlay} onPress={onCancel}>
        <Pressable style={dpStyles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={dpStyles.title}>{title}</Text>

          <View style={dpStyles.columnsRow}>
            <View style={dpStyles.column}>
              <Text style={dpStyles.colLabel}>{dayLabel}</Text>
              <ScrollView style={dpStyles.scrollCol} showsVerticalScrollIndicator={false}>
                {days.map((d) => (
                  <Pressable
                    key={d}
                    style={[dpStyles.cell, clampedDay === d && dpStyles.cellActive]}
                    onPress={() => setSelDay(d)}
                  >
                    <Text style={[dpStyles.cellText, clampedDay === d && dpStyles.cellTextActive]}>
                      {String(d).padStart(2, "0")}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>

            <View style={[dpStyles.column, { flex: 1.5 }]}>
              <Text style={dpStyles.colLabel}>{monthLabel}</Text>
              <ScrollView style={dpStyles.scrollCol} showsVerticalScrollIndicator={false}>
                {months.map((m, idx) => (
                  <Pressable
                    key={idx}
                    style={[dpStyles.cell, selMonth === idx + 1 && dpStyles.cellActive]}
                    onPress={() => setSelMonth(idx + 1)}
                  >
                    <Text style={[dpStyles.cellText, selMonth === idx + 1 && dpStyles.cellTextActive]}>
                      {m}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>

            <View style={dpStyles.column}>
              <Text style={dpStyles.colLabel}>{yearLabel}</Text>
              <ScrollView style={dpStyles.scrollCol} showsVerticalScrollIndicator={false}>
                {years.map((y) => (
                  <Pressable
                    key={y}
                    style={[dpStyles.cell, selYear === y && dpStyles.cellActive]}
                    onPress={() => setSelYear(y)}
                  >
                    <Text style={[dpStyles.cellText, selYear === y && dpStyles.cellTextActive]}>
                      {y}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </View>

          <View style={dpStyles.preview}>
            <Ionicons name="calendar-outline" size={16} color={Colors.light.tint} />
            <Text style={dpStyles.previewText}>
              {String(clampedDay).padStart(2, "0")} {months[selMonth - 1]} {selYear}
            </Text>
          </View>

          <View style={dpStyles.actions}>
            <Pressable style={dpStyles.cancelBtn} onPress={onCancel}>
              <Text style={dpStyles.cancelText}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              style={dpStyles.confirmBtn}
              onPress={() => onConfirm(formatIso(clampedDay, selMonth, selYear))}
            >
              <Text style={dpStyles.confirmText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const dpStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  sheet: {
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 20,
    width: "100%",
    maxWidth: 380,
  },
  title: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
    textAlign: "center",
    marginBottom: 16,
  },
  columnsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  column: {
    flex: 1,
  },
  colLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.textSecondary,
    textAlign: "center",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  scrollCol: {
    maxHeight: 200,
    borderRadius: 10,
    backgroundColor: Colors.light.background,
  },
  cell: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "center",
    borderRadius: 8,
    marginHorizontal: 2,
    marginVertical: 1,
  },
  cellActive: {
    backgroundColor: Colors.light.tint,
  },
  cellText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: Colors.light.text,
  },
  cellTextActive: {
    color: "#fff",
    fontFamily: "Inter_700Bold",
  },
  preview: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    backgroundColor: Colors.light.tint + "0F",
    borderRadius: 10,
    marginBottom: 16,
  },
  previewText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.tint,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: Colors.light.background,
    alignItems: "center",
  },
  cancelText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.textSecondary,
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: Colors.light.tint,
    alignItems: "center",
  },
  confirmText: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },
});

export default function ExportarScreen() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const { user } = useAuth();
  const { config: ferryConfig } = useFerry();
  const fTransitRate = ferryConfig.ferryTransitRate ?? 54.30;
  const fCabinRate = ferryConfig.ferryCabinRate ?? 54.30;

  const [fechaDesde, setFechaDesde] = useState(getDefaultFrom());
  const [fechaHasta, setFechaHasta] = useState(todayStr());
  const [contenido, setContenido] = useState<ExportContent>("ambos");
  const [generando, setGenerando] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<"desde" | "hasta" | null>(null);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [reportOptions, setReportOptions] = useState<ReportOptions>({ showAmounts: true, showPluses: true });

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

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const local = await AsyncStorage.getItem(await userScopedKey("tacoplan_user_settings", user?.id));
      if (local) {
        const s = JSON.parse(local);
        const pf = (v: any, fb: number) => { const n = parseFloat(v); return isNaN(n) ? fb : n; };
        setCustomRates([
          { trip_type: "NACIONAL", percent: 100, amount: pf(s.nac_100, 0) },
          { trip_type: "NACIONAL", percent: 60, amount: pf(s.nac_60, 0) },
          { trip_type: "NACIONAL", percent: 30, amount: pf(s.nac_30, 0) },
          { trip_type: "INTERNACIONAL", percent: 100, amount: pf(s.intl_100, 0) },
          { trip_type: "INTERNACIONAL", percent: 60, amount: pf(s.intl_60, 0) },
          { trip_type: "INTERNACIONAL", percent: 30, amount: pf(s.intl_30, 0) },
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
    } catch (_) {}

    try {
      const raw = await AsyncStorage.getItem(await userScopedKey(REPORT_OPTIONS_KEY, user?.id));
      if (raw) {
        const parsed = JSON.parse(raw);
        setReportOptions({
          showAmounts: parsed?.showAmounts !== false,
          showPluses: parsed?.showPluses !== false,
        });
      }
    } catch {}

    if (!user) return;
    try {
      const [rates, extras] = await Promise.all([fetchDietRates(user.id), fetchDayExtras(user.id)]);
      if (rates.length > 0) setCustomRates(rates as any);
      setDayExtras((prev) => {
        const e: any = extras || {};
        const safe = (v: any, fb: number) => {
          const n = parseFloat(v);
          return Number.isFinite(n) ? n : fb;
        };
        return {
          extra_saturday: safe(e.extra_saturday, prev.extra_saturday),
          extra_sunday: safe(e.extra_sunday, prev.extra_sunday),
          extra_holiday: safe(e.extra_holiday, prev.extra_holiday),
          offsite_weekly_reduced_nacional: safe(e.offsite_weekly_reduced_nacional, prev.offsite_weekly_reduced_nacional),
          offsite_weekly_reduced_internacional: safe(e.offsite_weekly_reduced_internacional, prev.offsite_weekly_reduced_internacional),
          offsite_weekly_complete_nacional: safe(e.offsite_weekly_complete_nacional, prev.offsite_weekly_complete_nacional),
          offsite_weekly_complete_internacional: safe(e.offsite_weekly_complete_internacional, prev.offsite_weekly_complete_internacional),
        };
      });
    } catch (e) {
      console.error("[EXPORTAR] Failed to load rates/extras from Supabase", e);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        await AsyncStorage.setItem(await userScopedKey(REPORT_OPTIONS_KEY, user?.id), JSON.stringify(reportOptions));
      } catch {}
    })();
  }, [reportOptions, user?.id]);

  const validateDates = (): boolean => {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(fechaDesde) || !dateRegex.test(fechaHasta)) return false;
    if (fechaDesde > fechaHasta) return false;
    return true;
  };

  const generarPDF = async (opts: ReportOptions) => {
    if (!validateDates()) {
      if (Platform.OS === "web") {
        window.alert(t("export.invalidDates"));
      } else {
        Alert.alert(t("common.error"), t("export.invalidDates"));
      }
      return;
    }

    setGenerando(true);
    try {
      const jornadas = await listarJornadas(fechaDesde, fechaHasta);
      const cerradas = jornadas.filter((j) => !!j.fechaFin);
      cerradas.sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio));
      let paymentMode: "dietas" | "km" | "viaje" = "dietas";
      try {
        const raw = await AsyncStorage.getItem(await userScopedKey("tacoplan_user_settings", user?.id));
        if (raw) {
          const s = JSON.parse(raw);
          if (s.payment_mode === "km" || s.payment_mode === "viaje" || s.payment_mode === "dietas") {
            paymentMode = s.payment_mode;
          }
        }
      } catch {}

      let historialHTML = "";
      let dietasHTML = "";
      let viajesHTML = "";
      let exportedViajes: Viaje[] = [];
      const fechaDesdeF = formatFecha(fechaDesde);
      const fechaHastaF = formatFecha(fechaHasta);

      const includeHistorial = contenido === "historial" || contenido === "ambos" || contenido === "todo";
      const includeDietas = contenido === "dietas" || contenido === "ambos" || contenido === "todo";
      const includeViajes = contenido === "viajes" || contenido === "todo";

      const allFerryRests = await getAllFerryRests();
      const ferryRestsInRange = allFerryRests.filter((fr) => fr.fecha >= fechaDesde && fr.fecha <= fechaHasta);
      ferryRestsInRange.sort((a, b) => a.startTime.localeCompare(b.startTime));
      const extraDaysInRange = (includeHistorial || includeDietas) ? await listDayExtraEntries(fechaDesde, fechaHasta) : [];
      const natDiets = await getAllNaturalDayDiets();
      const natInRange = natDiets.filter((n) => n.confirmedByUser && !n.dismissedAt && n.date >= fechaDesde && n.date <= fechaHasta);

      if (includeHistorial) {
        historialHTML = buildHistorialHTML(cerradas, fechaDesdeF, fechaHastaF, ferryRestsInRange, extraDaysInRange, dayExtras, opts, paymentMode, natInRange);
      }
      if (includeDietas) {
        const ferryExtrasSummary = await getFerryExtrasSummary(fechaDesde, fechaHasta, fTransitRate, fCabinRate);
        if (paymentMode === "km") {
          const kmResumen = await getResumenKm(fechaDesde, fechaHasta);
          dietasHTML = buildKmHTML(cerradas, kmResumen, fechaDesdeF, fechaHastaF, ferryExtrasSummary, opts, natInRange);
        } else if (paymentMode === "viaje") {
          dietasHTML = buildViajeBillingHTML(cerradas, fechaDesdeF, fechaHastaF, ferryExtrasSummary, opts, extraDaysInRange, dayExtras, natInRange);
        } else {
          const resumen = await getResumenDietas(fechaDesde, fechaHasta);
          dietasHTML = buildDietasHTML(cerradas, resumen, fechaDesdeF, fechaHastaF, ferryExtrasSummary, opts, natInRange);
        }
      }
      if (includeViajes) {
        const allViajes = await getAllViajes();
        const filtered = allViajes.filter((v) => {
          const created = v.createdAt.substring(0, 10);
          return created >= fechaDesde && created <= fechaHasta;
        });
        filtered.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        viajesHTML = buildViajesHTML(filtered, fechaDesdeF, fechaHastaF);
        exportedViajes = filtered;
      }

      const exportPayload = {
        version: 2,
        range: { from: fechaDesde, to: fechaHasta },
        generatedAt: new Date().toISOString(),
        reportOptions: opts,
        jornadas: cerradas,
        ferryRests: ferryRestsInRange,
        viajes: exportedViajes,
      };
      const jsonStr = JSON.stringify(exportPayload);
      const payloadBase64 =
        typeof Buffer !== "undefined"
          ? Buffer.from(jsonStr).toString("base64")
          : (typeof btoa !== "undefined" ? btoa(unescape(encodeURIComponent(jsonStr))) : "");
      const html = buildFullHTML(historialHTML, dietasHTML, viajesHTML, fechaDesdeF, fechaHastaF, payloadBase64);

      const normalizeFilePart = (s: string) =>
        s
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-zA-Z0-9]/g, "");
      const displayNameRaw = (user?.name || user?.email || "Usuario").trim();
      const displayNamePretty = displayNameRaw
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => (w.length ? `${w[0].toUpperCase()}${w.slice(1).toLowerCase()}` : ""))
        .join("");
      const displayName = normalizeFilePart(displayNamePretty) || "Usuario";
      const month = new Date(`${fechaDesde}T12:00:00`).toLocaleString("es-ES", { month: "long" }).toUpperCase();
      const baseName = `Informe${displayName}${normalizeFilePart(month)}`;
      const fileName = `${baseName}.pdf`;

      if (Platform.OS === "web") {
        const printWindow = window.open("", "_blank");
        if (printWindow) {
          printWindow.document.write(html);
          printWindow.document.close();
          setTimeout(() => {
            try {
              printWindow.document.title = fileName;
            } catch {}
            printWindow.print();
          }, 400);
        }
      } else {
        const { uri } = await Print.printToFileAsync({ html, base64: false });
        let shareUri = uri;
        try {
          const dir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
          if (dir) {
            let target = `${dir}${fileName}`;
            const info = await FileSystem.getInfoAsync(target);
            if (info.exists) {
              target = `${dir}${baseName}_${Date.now()}.pdf`;
            }
            await FileSystem.copyAsync({ from: uri, to: target });
            shareUri = target;
          }
        } catch (e) {
          console.error("[EXPORTAR] Failed to set PDF filename (sharing original uri)", e);
        }
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(shareUri, {
            UTI: "com.adobe.pdf",
            mimeType: "application/pdf",
            dialogTitle: t("export.shareTitle"),
          });
        }
      }
    } catch (err) {
      console.error("PDF generation error:", err);
      if (Platform.OS === "web") {
        window.alert(t("export.pdfError"));
      } else {
        Alert.alert(t("common.error"), t("export.pdfError"));
      }
    } finally {
      setGenerando(false);
    }
  };

  function tipoRutaLabelI18n(tipo: string | null | undefined): string {
    if (!tipo) return "-";
    const map: Record<string, string> = {
      REGIONAL_INTL: "common.regionalIntl",
      NAC_INTL: "common.nacIntl",
      NACIONAL: "common.nacional",
      INTERNACIONAL: "common.internacional",
      NAC_REGIONAL: "common.nacRegional",
      NINGUNO: "common.none",
      REGIONAL: "common.regional",
    };
    return map[tipo] ? t(map[tipo]) : tipo;
  }

  function dayFlagLabelI18n(flag: string | null | undefined): string {
    if (!flag) return "";
    const map: Record<string, string> = {
      SABADO: "common.dayFlag.SABADO",
      DOMINGO: "common.dayFlag.DOMINGO",
      FESTIVO: "common.dayFlag.FESTIVO",
    };
    return map[flag] ? t(map[flag]) : flag;
  }

  function dietaTipoLabelI18n(tipo: string): string {
    const map: Record<string, string> = {
      INTERNACIONAL_100: "common.dietType.INTERNACIONAL_100",
      INTERNACIONAL_60: "common.dietType.INTERNACIONAL_60",
      INTERNACIONAL_30: "common.dietType.INTERNACIONAL_30",
      NACIONAL_100: "common.dietType.NACIONAL_100",
      NACIONAL_60: "common.dietType.NACIONAL_60",
      NACIONAL_30: "common.dietType.NACIONAL_30",
      NAC_INTL_AUTO: "common.dietType.NAC_INTL_AUTO",
      NAC_INTL_100: "common.dietType.NAC_INTL_100",
      NAC_INTL_60: "common.dietType.NAC_INTL_60",
      NAC_INTL_30: "common.dietType.NAC_INTL_30",
      REGIONAL_100: "common.dietType.REGIONAL_100",
      REGIONAL_60: "common.dietType.REGIONAL_60",
      REGIONAL_30: "common.dietType.REGIONAL_30",
      REGIONAL_INTL_100: "common.dietType.REGIONAL_INTL_100",
      REGIONAL_INTL_60: "common.dietType.REGIONAL_INTL_60",
      REGIONAL_INTL_30: "common.dietType.REGIONAL_INTL_30",
      NAC_REGIONAL_100: "common.dietType.NAC_REGIONAL_100",
      NAC_REGIONAL_60: "common.dietType.NAC_REGIONAL_60",
      NAC_REGIONAL_30: "common.dietType.NAC_REGIONAL_30",
    };
    return map[tipo] ? t(map[tipo]) : tipo;
  }

  function buildPlusLabel(j: Jornada): string {
    const items = j.plusItems || [];
    const conceptos = items.map((p) => (p.concepto || "").trim()).filter(Boolean);
    if (conceptos.length === 0) return "-";
    const label = conceptos.slice(0, 2).join(", ");
    return conceptos.length > 2 ? `${label} +${conceptos.length - 2}` : label;
  }

  function buildPlusCellHTML(
    items: Array<{ concepto: string; importe?: number; amount?: number }> | undefined | null,
    opts: ReportOptions,
    placeholder: string = "-"
  ): string {
    const list = Array.isArray(items) ? items.filter((p) => p && (p.concepto || "").trim()) : [];
    if (list.length === 0) return placeholder;
    const parts = list.map((p) => {
      const concepto = escapeHtml((p.concepto || "").trim());
      if (opts.showAmounts) {
        const imp = p.importe != null ? p.importe : p.amount != null ? p.amount : 0;
        const safeImp = Number.isFinite(imp) ? imp : 0;
        return `${concepto}<br/>${concepto} ${safeImp.toFixed(2)} \u20AC`;
      }
      return `${concepto}<br/>${concepto}`;
    });
    return parts.join("<br/>");
  }

  function buildDietLabel(j: Jornada): string {
    if (j.dietRule && j.dietRule.trim()) return j.dietRule.trim();
    if (j.dietaModo === "MANUAL" && j.dietaManualTipo) {
      return `${j.dietaManualTipo} ${(j.dietaManualPct || "100")} %`.replace(/\s+/g, " ").trim();
    }
    const items = j.dietasItems || [];
    if (items.length > 0) {
      return items.map((it) => `${it.tipo} ${it.pct}%`).join(" + ");
    }
    const ruta = tipoRutaLabelI18n(j.tipoRuta);
    return `${ruta} ${(j.dietaPercent ?? 100)}%`.trim();
  }

  function buildHistorialHTML(
    jornadas: Jornada[],
    desde: string,
    hasta: string,
    ferryRestsInRange: FerryRestRecord[] = [],
    extraDaysInRange: DayExtraEntry[] = [],
    dayExtrasCfg: UserDayExtras,
    opts: ReportOptions,
    billingMode: "dietas" | "km" | "viaje" = "dietas",
    naturalDayDiets: NaturalDayDietEntry[] = [],
  ): string {
    const validNatDiets = (naturalDayDiets || []).filter((n) => n.confirmedByUser && !n.dismissedAt);
    if (jornadas.length === 0 && ferryRestsInRange.length === 0 && extraDaysInRange.length === 0 && validNatDiets.length === 0) {
      return `<div class="section"><h2>${t("export.pdfHistorialTitle")}</h2><p class="empty">${t("export.pdfNoJornadas")}</p></div>`;
    }

    const totalConduccion = jornadas.reduce((s, j) => s + (j.conduccionMin || 0), 0);
    const totalDuracion = jornadas.reduce((s, j) => s + (j.duracionJornadaMin || 0), 0);
    const totalDietaJornadas = jornadas.reduce((s, j) => s + (j.dietaImporteEur ? parseFloat(j.dietaImporteEur) : 0), 0);
    const totalDietaNat = validNatDiets.reduce((s, n) => s + (n.amount || 0), 0);
    const totalDieta = Math.round((totalDietaJornadas + totalDietaNat) * 100) / 100;
    const totalKm = jornadas.reduce((s, j) => {
      const km = j.kmTotal != null ? j.kmTotal : (j.kmInicio != null && j.kmFin != null ? (j.kmFin - j.kmInicio) : 0);
      return s + (Number.isFinite(km) ? km : 0);
    }, 0);
    const totalKmImporte = jornadas.reduce((s, j) => {
      const km = j.kmTotal != null ? j.kmTotal : (j.kmInicio != null && j.kmFin != null ? (j.kmFin - j.kmInicio) : 0);
      const kmSafe = Number.isFinite(km) ? km : 0;
      const imp = j.importeKm != null ? j.importeKm : (j.pricePerKm != null ? kmSafe * j.pricePerKm : 0);
      return s + (Number.isFinite(imp) ? imp : 0);
    }, 0);
    const totalViajeImporte = jornadas.reduce((s, j) => {
      const imp = j.importeViaje != null ? j.importeViaje : (j.pricePerTrip != null ? j.pricePerTrip : 0);
      return s + (Number.isFinite(imp) ? imp : 0);
    }, 0);
    const totalExtrasHistorialJornadas = jornadas.reduce((s, j) => s + (j.dayExtraEur ? parseFloat(j.dayExtraEur) : 0), 0);
    let totalExtrasExtraDays = 0;
    let totalExtraDaysCount = 0;
    for (const e of extraDaysInRange) {
      const amt =
        e.amount != null
          ? Number(e.amount)
          : (e.entryType === "day_extra" && e.dayFlag ? calcDayExtra(e.dayFlag, dayExtrasCfg) : 0);
      if (Number.isFinite(amt) && amt > 0) {
        totalExtrasExtraDays += amt;
        totalExtraDaysCount += 1;
      }
    }
    const totalExtrasHistorial = Math.round((totalExtrasHistorialJornadas + totalExtrasExtraDays) * 100) / 100;
    const totalPlus = jornadas.reduce((s, j) => s + ((j.plusItems || []).reduce((ps, p) => ps + p.importe, 0)), 0);
    const totalDietCountJornadas = jornadas.reduce((s, j) => s + (j.dietaImporteEur && parseFloat(j.dietaImporteEur) > 0 ? 1 : 0), 0);
    const totalDietCount = totalDietCountJornadas + validNatDiets.length;
    const totalExtraCountJornadas = jornadas.reduce((s, j) => s + (j.dayFlag && j.dayExtraEur && parseFloat(j.dayExtraEur) > 0 ? 1 : 0), 0);
    const totalExtraCount = totalExtraCountJornadas + totalExtraDaysCount;
    const totalPlusCount = jornadas.reduce((s, j) => s + ((j.plusItems || []).length > 0 ? 1 : 0), 0);
    const totalViajeCount = jornadas.reduce((s, j) => {
      const imp = j.importeViaje != null ? j.importeViaje : (j.pricePerTrip != null ? j.pricePerTrip : 0);
      return s + (Number.isFinite(imp) && imp > 0 ? 1 : 0);
    }, 0);

    let totalFerryExtrasAmount = 0;
    const linkedIds = new Set<string>();
    for (const fr of ferryRestsInRange) {
      if (fr.linkedJornadaId) linkedIds.add(fr.linkedJornadaId);
      if (fr.ferryExtras) {
        totalFerryExtrasAmount += (fr.ferryExtras.transitDiet || 0) * fTransitRate;
        totalFerryExtrasAmount += (fr.ferryExtras.cabinOvernight || 0) * fCabinRate;
      }
    }
    for (const j of jornadas) {
      if (!j.ferryExtras || linkedIds.has(j.id)) continue;
      totalFerryExtrasAmount += (j.ferryExtras.transitDiet || 0) * fTransitRate;
      totalFerryExtrasAmount += (j.ferryExtras.cabinOvernight || 0) * fCabinRate;
    }

    type CombinedRow = { ts: number; html: string };
    const combinedRows: CombinedRow[] = [];

    type MixedItem = { type: "j"; data: Jornada } | { type: "n"; data: NaturalDayDietEntry };
    const mixedItems: MixedItem[] = [
      ...jornadas.map((j) => ({ type: "j" as const, data: j })),
      ...validNatDiets.map((n) => ({ type: "n" as const, data: n })),
    ];
    mixedItems.sort((a, b) => {
      const tsA = a.type === "j"
        ? new Date(a.data.fechaInicio + " " + (a.data.horaInicio || "00:00")).getTime()
        : new Date(a.data.date + "T12:00:00").getTime();
      const tsB = b.type === "j"
        ? new Date(b.data.fechaInicio + " " + (b.data.horaInicio || "00:00")).getTime()
        : new Date(b.data.date + "T12:00:00").getTime();
      return tsB - tsA;
    });

    for (const item of mixedItems) {
      if (item.type === "j") {
        const j = item.data;
        const ts = j.startAt ? new Date(j.startAt).getTime() : 0;
        const cond = j.conduccionMin ? formatMinutosHoras(j.conduccionMin) : "-";
        const dur = j.duracionJornadaMin ? formatMinutosHoras(j.duracionJornadaMin) : "-";
        const ruta = tipoRutaLabelI18n(j.tipoRuta);
        const inicio = `${formatFecha(j.fechaInicio)} ${j.horaInicio || ""}`.trim();
        const fin = j.fechaFin ? `${formatFecha(j.fechaFin)} ${j.horaFin || ""}`.trim() : "-";
        const km = j.kmTotal != null ? j.kmTotal : (j.kmInicio != null && j.kmFin != null ? (j.kmFin - j.kmInicio) : 0);
        const kmSafe = Number.isFinite(km) ? km : 0;
        const kmImporte = j.importeKm != null ? j.importeKm : (j.pricePerKm != null ? kmSafe * j.pricePerKm : 0);
        const viajeImporte = j.importeViaje != null ? j.importeViaje : (j.pricePerTrip != null ? j.pricePerTrip : 0);

        const isDouble = (j as any).isDoubleDriving === true;
        const secondDriver = isDouble ? ((j as any).secondDriverName || null) : null;

        const billingCell = (() => {
          if (billingMode === "km") {
            return opts.showAmounts ? (Number.isFinite(kmImporte) && kmImporte > 0 ? `${kmImporte.toFixed(2)} \u20AC` : "-") : `${Math.round(kmSafe)} km`;
          }
          if (billingMode === "viaje") {
            return opts.showAmounts ? (Number.isFinite(viajeImporte) && viajeImporte > 0 ? `${viajeImporte.toFixed(2)} \u20AC` : "-") : (Number.isFinite(viajeImporte) && viajeImporte > 0 ? "1" : "-");
          }
          return opts.showAmounts ? (j.dietaImporteEur ? `${j.dietaImporteEur} \u20AC` : "-") : buildDietLabel(j);
        })();

        const extraParts: string[] = [];
        if (isDouble) {
          extraParts.push(`<span style="color:${Colors.light.accent};font-weight:600;">DOBLE CONDUCCI\u00d3N</span>`);
        }
        if (j.dayFlag && j.dayExtraEur && parseFloat(j.dayExtraEur) > 0) {
          extraParts.push(opts.showAmounts ? `${dayFlagLabelI18n(j.dayFlag)} +${j.dayExtraEur}\u20AC` : `${dayFlagLabelI18n(j.dayFlag)}`);
        }
        if (billingMode === "km") {
          if (opts.showAmounts) {
            const p = j.pricePerKm != null && Number.isFinite(j.pricePerKm) ? j.pricePerKm : null;
            extraParts.push(`${Math.round(kmSafe)} km${p != null ? ` \u00b7 ${p.toFixed(2)} \u20AC/km` : ""}`);
          } else {
            extraParts.push(`${Math.round(kmSafe)} km`);
          }
        }
        const extra = extraParts.join(" \u00b7 ");
        const plusSum = (j.plusItems || []).reduce((s, p) => s + p.importe, 0);
        const plusCell = !opts.showPluses ? "-" : buildPlusCellHTML(j.plusItems, opts);
        let obsText = j.observaciones ? j.observaciones.substring(0, 30) : "-";
        if (isDouble && secondDriver) {
          const seg = `Segundo: ${secondDriver}`;
          obsText = obsText === "-" ? seg : `${seg} \u00b7 ${obsText}`;
        }
        const lugarInicioSafe = escapeHtml(j.lugarInicio || "-");
        const lugarFinSafe = escapeHtml(j.lugarFin || "-");
        const rutaSafe = escapeHtml(ruta);
        const inicioSafe = escapeHtml(inicio);
        const finSafe = escapeHtml(fin);
        const extraSafe = extra;
        const obsSafe = escapeHtml(obsText);

        const rowStyle = isDouble ? ` style="background: ${Colors.light.accent + "12"};"` : "";

        combinedRows.push({ ts, html: `<tr${rowStyle}>
        <td>${inicioSafe}</td>
        <td>${finSafe}</td>
        <td>${lugarInicioSafe}</td>
        <td>${lugarFinSafe}</td>
        <td>${rutaSafe}</td>
        <td class="num">${cond}</td>
        <td class="num">${dur}</td>
        <td${opts.showAmounts ? ' class="num"' : ""}>${billingCell}</td>
        <td>${extraSafe}</td>
        ${opts.showPluses ? `<td${opts.showAmounts ? ' class="num"' : ""}>${plusCell}</td>` : ""}
        <td>${obsSafe}</td>
      </tr>` });
      } else {
        const n = item.data;
        const ts = new Date(n.date + "T12:00:00").getTime();
        const fechaCell = formatFecha(n.date);
        const detalleParts: string[] = [];
        detalleParts.push(`<strong>DIETA FUERA DE BASE</strong>`);
        if (n.location) detalleParts.push(escapeHtml(n.location));
        const detalleCell = detalleParts.join(" | ");
        const tipoRutaCell = escapeHtml(`${n.type} ${n.percentage}%`);
        const infCell = "";
        const obsCell = "D\u00eda natural sin jornada propia";
        const billingCell = billingMode === "dietas"
          ? (opts.showAmounts ? `${n.amount.toFixed(2)} \u20AC` : `${n.type} ${n.percentage}%`)
          : billingMode === "km"
            ? (opts.showAmounts ? `${n.amount.toFixed(2)} \u20AC` : "-")
            : (opts.showAmounts ? `${n.amount.toFixed(2)} \u20AC` : "-");
        const plusCellNat = !opts.showPluses ? "" : buildPlusCellHTML(n.plusItems, opts);
        combinedRows.push({ ts, html: `<tr style="background: #fef3c7;">
        <td>${fechaCell}</td>
        <td>-</td>
        <td>${detalleCell}</td>
        <td>-</td>
        <td>${tipoRutaCell}</td>
        <td class="num">-</td>
        <td class="num">-</td>
        <td${opts.showAmounts ? ' class="num"' : ""}>${billingCell}</td>
        <td>${infCell}</td>
        ${opts.showPluses ? `<td${opts.showAmounts ? ' class="num"' : ""}>${plusCellNat}</td>` : ""}
        <td>${obsCell}</td>
      </tr>` });
      }
    }

    for (const e of extraDaysInRange) {
      const ts = new Date(`${e.date}T12:00:00`).getTime();
      const amount =
        e.amount != null
          ? Number(e.amount)
          : (e.entryType === "day_extra" && e.dayFlag ? calcDayExtra(e.dayFlag, dayExtrasCfg) : 0);
      const amountCell = opts.showAmounts ? (Number.isFinite(amount) && amount > 0 ? `${amount.toFixed(2)} \u20AC` : "-") : "1";
      const extraLabel = (() => {
        if (e.entryType === "offsite_weekly_rest") return t("dietas.offsiteWeeklyRestHistorialTitle");
        if (e.dayFlag) return dayFlagLabelI18n(e.dayFlag);
        return t("export.pdfExtra");
      })();
      const detailParts: string[] = [];
      if (e.entryType === "offsite_weekly_rest") {
        detailParts.push(e.offsiteRestType === "WEEKLY_REDUCED" ? t("dietas.offsiteWeeklyRestReduced") : t("dietas.offsiteWeeklyRestComplete"));
        detailParts.push(e.offsiteBase === "INTERNACIONAL" ? t("common.internacional") : t("common.nacional"));
        if (e.plusSunday) detailParts.push(t("dietas.offsiteWeeklyRestPlusSunday"));
        if (e.plusHoliday) detailParts.push(t("dietas.offsiteWeeklyRestPlusHoliday"));
      }
      const extraCell = [extraLabel, detailParts.length > 0 ? `(${detailParts.join(" \u00b7 ")})` : ""].filter(Boolean).join(" ");
      const obsText = e.note ? e.note.substring(0, 30) : "-";
      const extraCellSafe = escapeHtml(extraCell);
      const obsSafe = escapeHtml(obsText);
      combinedRows.push({ ts, html: `<tr style="background: ${Colors.light.tint}10;">
        <td>\u{1F6CC} ${formatFecha(e.date)}</td>
        <td>-</td>
        <td>-</td>
        <td>-</td>
        <td>${e.entryType === "offsite_weekly_rest" ? (e.offsiteBase === "INTERNACIONAL" ? t("common.internacional") : t("common.nacional")) : "-"}</td>
        <td class="num">-</td>
        <td class="num">-</td>
        <td class="num">${amountCell}</td>
        <td>${extraCellSafe}</td>
        ${opts.showPluses ? `<td class="num">-</td>` : ""}
        <td>${obsSafe}</td>
      </tr>` });
    }

    for (const fr of ferryRestsInRange) {
      const ts = new Date(fr.startTime).getTime();
      const st = new Date(fr.startTime);
      const et = fr.endTime ? new Date(fr.endTime) : st;
      const startStr = `${String(st.getHours()).padStart(2, "0")}:${String(st.getMinutes()).padStart(2, "0")}`;
      const endStr = `${String(et.getHours()).padStart(2, "0")}:${String(et.getMinutes()).padStart(2, "0")}`;
      const td = fr.ferryExtras?.transitDiet || 0;
      const co = fr.ferryExtras?.cabinOvernight || 0;
      const ferryAmount = (td * fTransitRate) + (co * fCabinRate);
      const badges: string[] = [];
      if (td > 0) badges.push(`Tr\u00e1nsito x${td}`);
      if (co > 0) badges.push(`Camarote x${co}`);
      const intCount = fr.interruptions?.length || 0;
      let intInfo = "";
      if (intCount > 0) {
        const ints = (fr.interruptions as any[]).map((int: any, idx: number) => {
          if ("start" in int) {
            const intSt = new Date(int.start).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
            const intEnd = int.end ? new Date(int.end).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "...";
            return `#${idx + 1}: ${intSt}\u2192${intEnd}`;
          }
          return `#${idx + 1}: ${int.startMin}-${int.endMin} min`;
        });
        intInfo = ` | Int: ${ints.join(", ")}`;
      }

      const destSafe = escapeHtml(fr.destination || "");
      const restTypeSafe = escapeHtml(fr.restType);
      combinedRows.push({ ts, html: `<tr style="background: #e0f2fe;">
        <td>\u{1F6A2} ${formatFecha(fr.fecha)} ${startStr}</td>
        <td>${formatFecha(fr.fecha)} ${endStr}</td>
        <td colspan="2">Descanso en Ferry ${restTypeSafe}${fr.destination ? " \u2192 " + destSafe : ""}</td>
        <td>Ferry</td>
        <td class="num">-</td>
        <td class="num">-</td>
        <td class="num">${opts.showAmounts ? (ferryAmount > 0 ? ferryAmount.toFixed(2) + " \u20AC" : "-") : "-"}</td>
        <td>${badges.join(", ")}${intInfo}</td>
        ${opts.showPluses ? `<td class="num">-</td>` : ""}
        <td>${fr.isValid ? "\u2705" : "\u26A0\uFE0F"}</td>
      </tr>` });
    }

    combinedRows.sort((a, b) => b.ts - a.ts);
    const rows = combinedRows.map((r) => r.html).join("");

    const billingHeader = billingMode === "km"
      ? t("export.pdfKmAmount")
      : billingMode === "viaje"
        ? t("export.pdfTripAmount")
        : t("export.pdfDiet");

    const totalBilling = billingMode === "km" ? totalKmImporte : billingMode === "viaje" ? totalViajeImporte : totalDieta;
    const totalBillingNoAmount = billingMode === "km" ? `${Math.round(totalKm)} km` : billingMode === "viaje" ? `${totalViajeCount}` : `${totalDietCount}`;

    const totalRow = `<tr style="font-weight: bold; background: #f0f0f0;">
      <td colspan="5"><strong>${t("export.pdfTotals")}</strong></td>
      <td class="num"><strong>${formatMinutosHoras(totalConduccion)}</strong></td>
      <td class="num"><strong>${formatMinutosHoras(totalDuracion)}</strong></td>
      <td${opts.showAmounts ? ' class="num"' : ""}><strong>${opts.showAmounts ? `${(totalBilling + totalFerryExtrasAmount).toFixed(2)} \u20AC` : `${totalBillingNoAmount}`}</strong></td>
      <td><strong>${opts.showAmounts ? (totalExtrasHistorial > 0 ? totalExtrasHistorial.toFixed(2) + " \u20AC" : "-") : `${totalExtraCount}`}</strong>${opts.showAmounts && totalFerryExtrasAmount > 0 ? ` <span style="color:#0284c7;">(+${totalFerryExtrasAmount.toFixed(2)}\u20AC ferry)</span>` : ""}</td>
      ${opts.showPluses ? `<td${opts.showAmounts ? ' class="num"' : ""}><strong>${opts.showAmounts ? (totalPlus > 0 ? totalPlus.toFixed(2) + " \u20AC" : "-") : `${totalPlusCount}`}</strong></td>` : ""}
      <td></td>
    </tr>`;

    return `
      <div class="section">
        <h2>${t("export.pdfHistorialTitle")}</h2>
        <p class="subtitle">${jornadas.length} ${t("export.pdfJornadasCount")}${validNatDiets.length > 0 ? ` + ${validNatDiets.length} dieta natural` : ""}${ferryRestsInRange.length > 0 ? ` + ${ferryRestsInRange.length} ferry` : ""}${extraDaysInRange.length > 0 ? ` + ${extraDaysInRange.length} ${t("export.pdfExtra").toLowerCase()}` : ""} | ${t("export.pdfTotalDriving")}: ${formatMinutosHoras(totalConduccion)} | ${t("export.pdfTotalDuration")}: ${formatMinutosHoras(totalDuracion)}</p>
        <table>
          <thead>
            <tr>
              <th>${t("export.pdfStart")}</th>
              <th>${t("export.pdfEnd")}</th>
              <th>${t("export.pdfOrigin")}</th>
              <th>${t("export.pdfDestination")}</th>
              <th>${t("export.pdfRoute")}</th>
              <th class="num">${t("export.pdfDriving")}</th>
              <th class="num">${t("export.pdfDuration")}</th>
              <th class="num">${billingHeader}</th>
              <th>${t("export.pdfExtra")}</th>
              ${opts.showPluses ? `<th class="num">${t("export.pdfPlus")}</th>` : ""}
              <th>${t("export.pdfObs")}</th>
            </tr>
          </thead>
          <tbody>${rows}${totalRow}</tbody>
        </table>
      </div>
    `;
  }

  function buildDietasHTML(
    jornadas: Jornada[],
    resumen: { total: number; desglose: Array<{ tipo: string; cantidad: number; total: number }>; extras: { totalExtras: number; desglose: Array<{ tipo: string; cantidad: number; total: number }> } },
    desde: string,
    hasta: string,
    ferryExtrasSummary?: { totalTransitDiet: number; totalCabinOvernight: number; totalCountryChange: number; totalAmount: number; transitRate: number; cabinRate: number; count: number },
    opts?: ReportOptions,
    naturalDayDiets: NaturalDayDietEntry[] = [],
  ): string {
    const validNatDiets = (naturalDayDiets || []).filter((n) => n.confirmedByUser && !n.dismissedAt);
    const totalDietasJornadas = jornadas.reduce((s, j) => s + (j.dietaImporteEur ? parseFloat(j.dietaImporteEur) : 0), 0);
    const totalDietasNat = validNatDiets.reduce((s, n) => s + (n.amount || 0), 0);
    const totalDietas = Math.round((totalDietasJornadas + totalDietasNat) * 100) / 100;
    const totalExtras = resumen.extras.totalExtras;
    const totalPlus = jornadas.reduce((s, j) => s + ((j.plusItems || []).reduce((ps, p) => ps + p.importe, 0)), 0);
    const ferryExtrasTotal = ferryExtrasSummary?.totalAmount || 0;
    const granTotal = Math.round((totalDietas + totalExtras + totalPlus + ferryExtrasTotal) * 100) / 100;
    const showAmounts = opts?.showAmounts !== false;
    const showPluses = opts?.showPluses !== false;
    const extraTipoLabel = (tipo: string) => {
      if (tipo === "FUERA_BASE") return t("dietas.offsiteWeeklyRestLabel");
      if (tipo.startsWith("FUERA_BASE_")) {
        const restBase = tipo.slice("FUERA_BASE_".length);
        const base = restBase.endsWith("_INTERNACIONAL") ? "INTERNACIONAL" : restBase.endsWith("_NACIONAL") ? "NACIONAL" : null;
        const rest = base ? restBase.slice(0, -(`_${base}`.length)) : restBase;
        const restLabel = rest === "WEEKLY_REDUCED" ? t("dietas.offsiteWeeklyRestReduced") : t("dietas.offsiteWeeklyRestComplete");
        const baseLabel = base === "INTERNACIONAL" ? t("common.internacional") : t("common.nacional");
        return `${restLabel} · ${baseLabel}`;
      }
      return dayFlagLabelI18n(tipo);
    };

    const desgloseRows = resumen.desglose.map((d) => `
      <tr>
        <td>${dietaTipoLabelI18n(d.tipo)}</td>
        <td class="num">${d.cantidad}</td>
        ${showAmounts ? `<td class="num">${d.total.toFixed(2)} \u20AC</td>` : ""}
      </tr>
    `).join("");

    const extrasRows = resumen.extras.desglose.map((e) => `
      <tr>
        <td>${extraTipoLabel(e.tipo)}</td>
        <td class="num">${e.cantidad}</td>
        ${showAmounts ? `<td class="num">${e.total.toFixed(2)} \u20AC</td>` : ""}
      </tr>
    `).join("");

    const reportOpts: ReportOptions = { showAmounts, showPluses };
    const jornadaRows = jornadas
      .filter((j) => j.dietaImporteEur && parseFloat(j.dietaImporteEur) > 0)
      .map((j) => {
        const extra = j.dayFlag && j.dayExtraEur && parseFloat(j.dayExtraEur) > 0
          ? parseFloat(j.dayExtraEur) : 0;
        const dietaBase = parseFloat(j.dietaImporteEur || "0");
        const plusSum = (j.plusItems || []).reduce((s, p) => s + p.importe, 0);
        const plusCellContent = showPluses ? buildPlusCellHTML(j.plusItems, reportOpts) : "";
        return `<tr>
          <td>${formatFecha(j.fechaInicio)}</td>
          <td>${tipoRutaLabelI18n(j.tipoRuta)}</td>
          <td class="num">${j.dietaPercent != null ? j.dietaPercent + "%" : "-"}</td>
          ${showAmounts ? `<td class="num">${dietaBase.toFixed(2)} \u20AC</td>` : ""}
          ${showAmounts ? `<td class="num">${extra > 0 ? extra.toFixed(2) + " \u20AC" : "-"}</td>` : ""}
          ${showPluses ? `<td class="num">${plusCellContent}</td>` : ""}
          ${showAmounts ? `<td class="num">${(dietaBase + extra + plusSum).toFixed(2)} \u20AC</td>` : ""}
        </tr>`;
      }).join("");

    const natDietRows = validNatDiets.map((n) => {
      const detalleParts: string[] = ["DIETA FUERA DE BASE"];
      if (n.location) detalleParts.push(escapeHtml(n.location));
      const detalleCell = detalleParts.join(" | ");
      const natAmount = Number(n.amount) || 0;
      const plusCellNatDiet = showPluses ? buildPlusCellHTML(n.plusItems, reportOpts) : "";
      return `<tr style="background: #fef3c7;">
        <td>${formatFecha(n.date)}</td>
        <td class="num">-</td>
        <td>${detalleCell}</td>
        <td class="num">${n.percentage}%</td>
        ${showAmounts ? `<td class="num">-</td>` : ""}
        ${showPluses ? `<td class="num">${plusCellNatDiet}</td>` : ""}
        ${showAmounts ? `<td class="num">${natAmount.toFixed(2)} \u20AC</td>` : ""}
      </tr>`;
    }).join("");

    const detalleBodyRows = [jornadaRows, natDietRows].filter(Boolean).join("");
    const totalDietCountFromDesglose = resumen.desglose.reduce((s, d) => s + (d.cantidad || 0), 0);

    return `
      <div class="section">
        <h2>${t("export.pdfDietSummary")}</h2>
        <div class="summary-grid">
          <div class="summary-box">
            <span class="summary-label">${t("export.pdfDiets")}</span>
            <span class="summary-value">${showAmounts ? `${totalDietas.toFixed(2)} \u20AC` : `${totalDietCountFromDesglose}`}</span>
          </div>
          <div class="summary-box">
            <span class="summary-label">${t("export.pdfDayExtras")}</span>
            <span class="summary-value">${showAmounts ? `${totalExtras.toFixed(2)} \u20AC` : `${resumen.extras.desglose.reduce((s, e) => s + (e.cantidad || 0), 0)}`}</span>
          </div>
          ${showPluses ? `<div class="summary-box">
            <span class="summary-label">${t("export.pdfPlus")}</span>
            <span class="summary-value">${showAmounts ? `${totalPlus.toFixed(2)} \u20AC` : `${jornadas.reduce((s, j) => s + ((j.plusItems || []).length), 0)}`}</span>
          </div>` : ""}
          ${ferryExtrasTotal > 0 ? `<div class="summary-box" style="border-color:#0284c7;">
            <span class="summary-label" style="color:#0284c7;">Extras Ferry</span>
            <span class="summary-value" style="color:#0284c7;">${showAmounts ? `${ferryExtrasTotal.toFixed(2)} \u20AC` : `${(ferryExtrasSummary?.totalTransitDiet || 0) + (ferryExtrasSummary?.totalCabinOvernight || 0)}`}</span>
          </div>` : ""}
          ${showAmounts ? `<div class="summary-box highlight">
            <span class="summary-label">${t("export.pdfTotal")}</span>
            <span class="summary-value">${granTotal.toFixed(2)} \u20AC</span>
          </div>` : ""}
        </div>

        ${showAmounts && ferryExtrasSummary && ferryExtrasSummary.count > 0 ? `
          <h3>Extras Ferry / Transbordo</h3>
          <table class="small">
            <thead><tr><th>Concepto</th><th class="num">Cantidad</th><th class="num">Importe/ud</th><th class="num">Total</th></tr></thead>
            <tbody>
              ${ferryExtrasSummary.totalTransitDiet > 0 ? `<tr><td>Dieta tr\u00e1nsito</td><td class="num">${ferryExtrasSummary.totalTransitDiet}</td><td class="num">${ferryExtrasSummary.transitRate.toFixed(2)} \u20AC</td><td class="num">${(ferryExtrasSummary.totalTransitDiet * ferryExtrasSummary.transitRate).toFixed(2)} \u20AC</td></tr>` : ""}
              ${ferryExtrasSummary.totalCabinOvernight > 0 ? `<tr><td>Pernocta camarote</td><td class="num">${ferryExtrasSummary.totalCabinOvernight}</td><td class="num">${ferryExtrasSummary.cabinRate.toFixed(2)} \u20AC</td><td class="num">${(ferryExtrasSummary.totalCabinOvernight * ferryExtrasSummary.cabinRate).toFixed(2)} \u20AC</td></tr>` : ""}
              ${ferryExtrasSummary.totalCountryChange > 0 ? `<tr><td>Cambio de pa\u00eds</td><td class="num">${ferryExtrasSummary.totalCountryChange}</td><td class="num">-</td><td class="num">-</td></tr>` : ""}
              <tr style="font-weight:bold; background:#e0f2fe;"><td colspan="3"><strong>Total Extras Ferry</strong></td><td class="num"><strong>${ferryExtrasSummary.totalAmount.toFixed(2)} \u20AC</strong></td></tr>
            </tbody>
          </table>
        ` : ""}

        ${resumen.desglose.length > 0 ? `
          <h3>${t("export.pdfByType")}</h3>
          <table class="small">
            <thead><tr><th>${t("export.pdfType")}</th><th class="num">${t("export.pdfQty")}</th>${showAmounts ? `<th class="num">${t("export.pdfTotal")}</th>` : ""}</tr></thead>
            <tbody>${desgloseRows}</tbody>
          </table>
        ` : ""}

        ${resumen.extras.desglose.length > 0 ? `
          <h3>${t("export.pdfDayExtrasTitle")}</h3>
          <table class="small">
            <thead><tr><th>${t("export.pdfDayCol")}</th><th class="num">${t("export.pdfQty")}</th>${showAmounts ? `<th class="num">${t("export.pdfTotal")}</th>` : ""}</tr></thead>
            <tbody>${extrasRows}</tbody>
          </table>
        ` : ""}

        ${detalleBodyRows ? `
          <h3>Detalle de dietas</h3>
          <table>
            <thead>
              <tr>
                <th>${t("export.pdfDate")}</th>
                <th>${t("export.pdfRoute")}</th>
                <th class="num">%</th>
                ${showAmounts ? `<th class="num">${t("export.pdfDiet")}</th>` : ""}
                ${showAmounts ? `<th class="num">${t("export.pdfExtra")}</th>` : ""}
                ${showPluses ? `<th class="num">${t("export.pdfPlus")}</th>` : ""}
                ${showAmounts ? `<th class="num">${t("export.pdfTotal")}</th>` : ""}
              </tr>
            </thead>
            <tbody>${detalleBodyRows}</tbody>
          </table>
        ` : ""}
      </div>
    `;
  }

  function buildKmHTML(
    jornadas: Jornada[],
    resumen: { totalKm: number; totalImporte: number; desglose: Array<{ tipo: string; cantidad: number; total: number }>; extras: { totalExtras: number; desglose: Array<{ tipo: string; cantidad: number; total: number }> }; plus: { totalPlus: number; desglose: Array<{ tipo: string; cantidad: number; total: number }> } },
    desde: string,
    hasta: string,
    ferryExtrasSummary?: { totalTransitDiet: number; totalCabinOvernight: number; totalCountryChange: number; totalAmount: number; transitRate: number; cabinRate: number; count: number },
    opts?: ReportOptions,
    naturalDayDiets: NaturalDayDietEntry[] = [],
  ): string {
    const showAmounts = opts?.showAmounts !== false;
    const showPluses = opts?.showPluses !== false;
    const ferryExtrasTotal = ferryExtrasSummary?.totalAmount || 0;
    const validNatDiets = (naturalDayDiets || []).filter((n) => n.confirmedByUser && !n.dismissedAt);
    const totalDietasNat = validNatDiets.reduce((s, n) => s + (n.amount || 0), 0);

    const jornadasKm = jornadas.filter((j) =>
      j.kmTotal != null || (j.kmInicio != null && j.kmFin != null)
    );
    const totalPlus = jornadasKm.reduce((s, j) => s + ((j.plusItems || []).reduce((ps, p) => ps + p.importe, 0)), 0);
    const granTotal = Math.round((resumen.totalImporte + resumen.extras.totalExtras + totalPlus + ferryExtrasTotal + totalDietasNat) * 100) / 100;

    const tipoLabel = (tipo: string) => {
      if (tipo === "NACIONAL") return t("common.nacional");
      if (tipo === "REGIONAL") return t("common.regional");
      if (tipo === "INTERNACIONAL") return t("common.internacional");
      return tipo;
    };
    const extraTipoLabel = (tipo: string) => {
      if (tipo === "FUERA_BASE") return t("dietas.offsiteWeeklyRestLabel");
      if (tipo.startsWith("FUERA_BASE_")) {
        const parts = tipo.split("_");
        const rest = parts[2];
        const base = parts[3];
        const restLabel = rest === "WEEKLY_REDUCED" ? t("dietas.offsiteWeeklyRestReduced") : t("dietas.offsiteWeeklyRestComplete");
        const baseLabel = base === "INTERNACIONAL" ? t("common.internacional") : t("common.nacional");
        return `${restLabel} · ${baseLabel}`;
      }
      return dayFlagLabelI18n(tipo);
    };

    const desgloseRows = resumen.desglose.map((d) => `
      <tr>
        <td>${tipoLabel(d.tipo)}</td>
        <td class="num">${Number(d.cantidad || 0).toFixed(0)}</td>
        ${showAmounts ? `<td class="num">${Number(d.total || 0).toFixed(2)} \u20AC</td>` : ""}
      </tr>
    `).join("");

    const extrasRows = resumen.extras.desglose.map((e) => `
      <tr>
        <td>${extraTipoLabel(e.tipo)}</td>
        <td class="num">${e.cantidad}</td>
        ${showAmounts ? `<td class="num">${e.total.toFixed(2)} \u20AC</td>` : ""}
      </tr>
    `).join("");

    const jornadaRows = jornadasKm.map((j) => {
      const km = j.kmTotal != null ? j.kmTotal : (j.kmInicio != null && j.kmFin != null ? (j.kmFin - j.kmInicio) : 0);
      const kmSafe = Number.isFinite(km) ? km : 0;
      const price = j.pricePerKm != null && Number.isFinite(j.pricePerKm) ? j.pricePerKm : null;
      const base = j.importeKm != null ? j.importeKm : (price != null ? kmSafe * price : 0);
      const baseSafe = Number.isFinite(base) ? base : 0;
      const extra = j.dayFlag && j.dayExtraEur && parseFloat(j.dayExtraEur) > 0 ? parseFloat(j.dayExtraEur) : 0;
      const plusSum = (j.plusItems || []).reduce((s, p) => s + p.importe, 0);
      const totalRow = baseSafe + extra + plusSum;
      return `<tr>
        <td>${formatFecha(j.fechaInicio)}</td>
        <td>${tipoRutaLabelI18n(j.tipoRuta)}</td>
        <td class="num">${Math.round(kmSafe)}</td>
        ${showAmounts ? `<td class="num">${price != null ? price.toFixed(2) + " \u20AC/km" : "-"}</td>` : ""}
        ${showAmounts ? `<td class="num">${baseSafe > 0 ? baseSafe.toFixed(2) + " \u20AC" : "-"}</td>` : ""}
        ${showAmounts ? `<td class="num">${extra > 0 ? extra.toFixed(2) + " \u20AC" : "-"}</td>` : ""}
        ${showPluses ? (showAmounts ? `<td class="num">${plusSum > 0 ? plusSum.toFixed(2) + " \u20AC" : "-"}</td>` : `<td class="num">${(j.plusItems || []).length}</td>`) : ""}
        ${showAmounts ? `<td class="num">${totalRow.toFixed(2)} \u20AC</td>` : ""}
      </tr>`;
    }).join("");

    const natDietRowsKm = validNatDiets.map((n) => {
      const detalleParts: string[] = ["DIETA FUERA DE BASE"];
      if (n.location) detalleParts.push(escapeHtml(n.location));
      const detalleCell = detalleParts.join(" | ");
      const natAmount = Number(n.amount) || 0;
      return `<tr style="background: #fef3c7;">
        <td>${formatFecha(n.date)}</td>
        <td class="num">-</td>
        <td>${detalleCell}</td>
        <td class="num">${n.percentage}%</td>
        ${showAmounts ? `<td class="num">-</td>` : ""}
        ${showAmounts ? `<td class="num">-</td>` : ""}
        ${showAmounts ? `<td class="num">-</td>` : ""}
        ${showPluses ? (showAmounts ? `<td class="num">-</td>` : `<td class="num">0</td>`) : ""}
        ${showAmounts ? `<td class="num">${natAmount.toFixed(2)} \u20AC</td>` : ""}
      </tr>`;
    }).join("");

    const detalleBodyRowsKm = [jornadaRows, natDietRowsKm].filter(Boolean).join("");

    return `
      <div class="section">
        <h2>${t("export.pdfKmSummary")}</h2>
        <div class="summary-grid">
          <div class="summary-box">
            <span class="summary-label">${t("export.pdfKm")}</span>
            <span class="summary-value">${Number(resumen.totalKm || 0).toFixed(0)} km</span>
          </div>
          <div class="summary-box">
            <span class="summary-label">${t("export.pdfKmAmount")}</span>
            <span class="summary-value">${showAmounts ? `${Number(resumen.totalImporte || 0).toFixed(2)} \u20AC` : "-"}</span>
          </div>
          <div class="summary-box">
            <span class="summary-label">${t("export.pdfDayExtras")}</span>
            <span class="summary-value">${showAmounts ? `${resumen.extras.totalExtras.toFixed(2)} \u20AC` : `${resumen.extras.desglose.reduce((s, e) => s + (e.cantidad || 0), 0)}`}</span>
          </div>
          ${validNatDiets.length > 0 ? `<div class="summary-box" style="border-color:#f59e0b;">
            <span class="summary-label" style="color:#b45309;">Dietas naturales</span>
            <span class="summary-value" style="color:#b45309;">${showAmounts ? `${totalDietasNat.toFixed(2)} \u20AC` : `${validNatDiets.length}`}</span>
          </div>` : ""}
          ${showPluses ? `<div class="summary-box">
            <span class="summary-label">${t("export.pdfPlus")}</span>
            <span class="summary-value">${showAmounts ? `${totalPlus.toFixed(2)} \u20AC` : `${jornadasKm.reduce((s, j) => s + ((j.plusItems || []).length), 0)}`}</span>
          </div>` : ""}
          ${ferryExtrasTotal > 0 ? `<div class="summary-box" style="border-color:#0284c7;">
            <span class="summary-label" style="color:#0284c7;">Extras Ferry</span>
            <span class="summary-value" style="color:#0284c7;">${showAmounts ? `${ferryExtrasTotal.toFixed(2)} \u20AC` : `${(ferryExtrasSummary?.totalTransitDiet || 0) + (ferryExtrasSummary?.totalCabinOvernight || 0)}`}</span>
          </div>` : ""}
          ${showAmounts ? `<div class="summary-box highlight">
            <span class="summary-label">${t("export.pdfTotal")}</span>
            <span class="summary-value">${granTotal.toFixed(2)} \u20AC</span>
          </div>` : ""}
        </div>

        ${resumen.desglose.length > 0 ? `
          <h3>${t("export.pdfByType")}</h3>
          <table class="small">
            <thead><tr><th>${t("export.pdfType")}</th><th class="num">${t("export.pdfKm")}</th>${showAmounts ? `<th class="num">${t("export.pdfTotal")}</th>` : ""}</tr></thead>
            <tbody>${desgloseRows}</tbody>
          </table>
        ` : ""}

        ${resumen.extras.desglose.length > 0 ? `
          <h3>${t("export.pdfDayExtrasTitle")}</h3>
          <table class="small">
            <thead><tr><th>${t("export.pdfDayCol")}</th><th class="num">${t("export.pdfQty")}</th>${showAmounts ? `<th class="num">${t("export.pdfTotal")}</th>` : ""}</tr></thead>
            <tbody>${extrasRows}</tbody>
          </table>
        ` : ""}

        ${detalleBodyRowsKm ? `
          <h3>Detalle de dietas</h3>
          <table>
            <thead>
              <tr>
                <th>${t("export.pdfDate")}</th>
                <th>${t("export.pdfRoute")}</th>
                <th class="num">${t("export.pdfKm")}</th>
                ${showAmounts ? `<th class="num">\u20AC/km</th>` : ""}
                ${showAmounts ? `<th class="num">${t("export.pdfKmAmount")}</th>` : ""}
                ${showAmounts ? `<th class="num">${t("export.pdfExtra")}</th>` : ""}
                ${showPluses ? `<th class="num">${t("export.pdfPlus")}</th>` : ""}
                ${showAmounts ? `<th class="num">${t("export.pdfTotal")}</th>` : ""}
              </tr>
            </thead>
            <tbody>${detalleBodyRowsKm}</tbody>
          </table>
        ` : ""}
      </div>
    `;
  }

  function buildViajeBillingHTML(
    jornadas: Jornada[],
    desde: string,
    hasta: string,
    ferryExtrasSummary?: { totalTransitDiet: number; totalCabinOvernight: number; totalCountryChange: number; totalAmount: number; transitRate: number; cabinRate: number; count: number },
    opts?: ReportOptions,
    extraDays: DayExtraEntry[] = [],
    dayExtrasCfg: UserDayExtras = {
      extra_saturday: 0,
      extra_sunday: 0,
      extra_holiday: 0,
      offsite_weekly_reduced_nacional: 0,
      offsite_weekly_reduced_internacional: 0,
      offsite_weekly_complete_nacional: 0,
      offsite_weekly_complete_internacional: 0,
    },
    naturalDayDiets: NaturalDayDietEntry[] = [],
  ): string {
    const showAmounts = opts?.showAmounts !== false;
    const showPluses = opts?.showPluses !== false;
    const ferryExtrasTotal = ferryExtrasSummary?.totalAmount || 0;
    const validNatDiets = (naturalDayDiets || []).filter((n) => n.confirmedByUser && !n.dismissedAt);
    const totalDietasNat = validNatDiets.reduce((s, n) => s + (n.amount || 0), 0);

    const jornadasViaje = jornadas.filter((j) =>
      j.importeViaje != null || j.pricePerTrip != null
    );
    const totalViajes = jornadasViaje.reduce((s, j) => {
      const imp = j.importeViaje != null ? j.importeViaje : (j.pricePerTrip != null ? j.pricePerTrip : 0);
      return s + (Number.isFinite(imp) ? imp : 0);
    }, 0);

    let totalExtras = 0;
    for (const j of jornadasViaje) {
      const extraImporte = j.dayFlag
        ? (j.dayExtraEur ? parseFloat(j.dayExtraEur) : calcDayExtra(j.dayFlag, dayExtrasCfg))
        : 0;
      if (Number.isFinite(extraImporte) && extraImporte > 0) totalExtras += extraImporte;
    }
    for (const e of extraDays) {
      const extraImporte = e.amount != null ? Number(e.amount) : (e.dayFlag ? calcDayExtra(e.dayFlag, dayExtrasCfg) : 0);
      if (Number.isFinite(extraImporte) && extraImporte > 0) totalExtras += extraImporte;
    }
    totalExtras = Math.round(totalExtras * 100) / 100;

    const totalPlus = jornadasViaje.reduce((s, j) => s + ((j.plusItems || []).reduce((ps, p) => ps + p.importe, 0)), 0);
    const granTotal = Math.round((totalViajes + totalExtras + totalPlus + ferryExtrasTotal + totalDietasNat) * 100) / 100;

    const jornadaRows = jornadasViaje.map((j) => {
      const base = j.importeViaje != null ? j.importeViaje : (j.pricePerTrip != null ? j.pricePerTrip : 0);
      const baseSafe = Number.isFinite(base) ? base : 0;
      const rate = j.pricePerTrip != null ? j.pricePerTrip : baseSafe;
      const rateSafe = Number.isFinite(rate) ? rate : 0;
      const extra = j.dayFlag
        ? (j.dayExtraEur ? parseFloat(j.dayExtraEur) : calcDayExtra(j.dayFlag, dayExtrasCfg))
        : 0;
      const extraSafe = Number.isFinite(extra) ? extra : 0;
      const plusSum = (j.plusItems || []).reduce((s, p) => s + p.importe, 0);
      const totalRow = baseSafe + extraSafe + plusSum;
      return `<tr>
        <td>${formatFecha(j.fechaInicio)}</td>
        <td>${tipoRutaLabelI18n(j.tipoRuta)}</td>
        ${showAmounts ? `<td class="num">${rateSafe > 0 ? rateSafe.toFixed(2) + " \u20AC" : "-"}</td>` : ""}
        ${showAmounts ? `<td class="num">${baseSafe > 0 ? baseSafe.toFixed(2) + " \u20AC" : "-"}</td>` : ""}
        ${showAmounts ? `<td class="num">${extraSafe > 0 ? extraSafe.toFixed(2) + " \u20AC" : "-"}</td>` : ""}
        ${showPluses ? (showAmounts ? `<td class="num">${plusSum > 0 ? plusSum.toFixed(2) + " \u20AC" : "-"}</td>` : `<td class="num">${(j.plusItems || []).length}</td>`) : ""}
        ${showAmounts ? `<td class="num">${totalRow.toFixed(2)} \u20AC</td>` : ""}
      </tr>`;
    }).join("");

    const natDietRowsViaje = validNatDiets.map((n) => {
      const detalleParts: string[] = ["DIETA FUERA DE BASE"];
      if (n.location) detalleParts.push(escapeHtml(n.location));
      const detalleCell = detalleParts.join(" | ");
      const natAmount = Number(n.amount) || 0;
      return `<tr style="background: #fef3c7;">
        <td>${formatFecha(n.date)}</td>
        <td class="num">-</td>
        <td>${detalleCell}</td>
        <td class="num">${n.percentage}%</td>
        ${showAmounts ? `<td class="num">-</td>` : ""}
        ${showAmounts ? `<td class="num">-</td>` : ""}
        ${showAmounts ? `<td class="num">-</td>` : ""}
        ${showPluses ? (showAmounts ? `<td class="num">-</td>` : `<td class="num">0</td>`) : ""}
        ${showAmounts ? `<td class="num">${natAmount.toFixed(2)} \u20AC</td>` : ""}
      </tr>`;
    }).join("");

    const detalleBodyRowsViaje = [jornadaRows, natDietRowsViaje].filter(Boolean).join("");

    return `
      <div class="section">
        <h2>${t("export.pdfTripSummary")}</h2>
        <div class="summary-grid">
          <div class="summary-box">
            <span class="summary-label">${t("export.pdfTripAmount")}</span>
            <span class="summary-value">${showAmounts ? `${totalViajes.toFixed(2)} \u20AC` : `${jornadasViaje.length}`}</span>
          </div>
          <div class="summary-box">
            <span class="summary-label">${t("export.pdfDayExtras")}</span>
            <span class="summary-value">${showAmounts ? `${totalExtras.toFixed(2)} \u20AC` : "-"}</span>
          </div>
          ${validNatDiets.length > 0 ? `<div class="summary-box" style="border-color:#f59e0b;">
            <span class="summary-label" style="color:#b45309;">Dietas naturales</span>
            <span class="summary-value" style="color:#b45309;">${showAmounts ? `${totalDietasNat.toFixed(2)} \u20AC` : `${validNatDiets.length}`}</span>
          </div>` : ""}
          ${showPluses ? `<div class="summary-box">
            <span class="summary-label">${t("export.pdfPlus")}</span>
            <span class="summary-value">${showAmounts ? `${totalPlus.toFixed(2)} \u20AC` : `${jornadasViaje.reduce((s, j) => s + ((j.plusItems || []).length), 0)}`}</span>
          </div>` : ""}
          ${ferryExtrasTotal > 0 ? `<div class="summary-box" style="border-color:#0284c7;">
            <span class="summary-label" style="color:#0284c7;">Extras Ferry</span>
            <span class="summary-value" style="color:#0284c7;">${showAmounts ? `${ferryExtrasTotal.toFixed(2)} \u20AC` : `${(ferryExtrasSummary?.totalTransitDiet || 0) + (ferryExtrasSummary?.totalCabinOvernight || 0)}`}</span>
          </div>` : ""}
          ${showAmounts ? `<div class="summary-box highlight">
            <span class="summary-label">${t("export.pdfTotal")}</span>
            <span class="summary-value">${granTotal.toFixed(2)} \u20AC</span>
          </div>` : ""}
        </div>

        ${detalleBodyRowsViaje ? `
          <h3>Detalle de dietas</h3>
          <table>
            <thead>
              <tr>
                <th>${t("export.pdfDate")}</th>
                <th>${t("export.pdfRoute")}</th>
                ${showAmounts ? `<th class="num">€/viaje</th>` : ""}
                ${showAmounts ? `<th class="num">${t("export.pdfTripAmount")}</th>` : ""}
                ${showAmounts ? `<th class="num">${t("export.pdfExtra")}</th>` : ""}
                ${showPluses ? `<th class="num">${t("export.pdfPlus")}</th>` : ""}
                ${showAmounts ? `<th class="num">${t("export.pdfTotal")}</th>` : ""}
              </tr>
            </thead>
            <tbody>${detalleBodyRowsViaje}</tbody>
          </table>
        ` : ""}
      </div>
    `;
  }

  function formatViajeDateTime(iso: string | null): string {
    if (!iso) return "-";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yy} ${hh}:${mi}`;
  }

  function buildViajesHTML(viajes: Viaje[], desde: string, hasta: string): string {
    if (viajes.length === 0) {
      return `<div class="section"><h2>${t("export.pdfTrips")}</h2><p class="empty">${t("export.pdfNoTrips")}</p></div>`;
    }

    const modoLabels: Record<string, string> = {
      COMPLETO: t("export.pdfComplete"),
      SOLO_CARGA: t("export.pdfLoadOnly"),
      SOLO_DESCARGA: t("export.pdfUnloadOnly"),
    };

    const viajeBlocks = viajes.map((v, idx) => {
      const estadoLabel = v.estado === "COMPLETADO" ? t("export.pdfCompleted") : t("export.pdfInProgress");
      const clienteText = v.cliente || "-";
      const modoText = modoLabels[v.modoViaje] || v.modoViaje;
      const createdDate = formatViajeDateTime(v.createdAt);

      const paradasRows = v.paradas.map((p) => {
        const tipoLabel = p.tipo === "CARGA" ? t("export.pdfLoad") : t("export.pdfUnload");
        const citaText = p.citaFecha
          ? `${formatFecha(p.citaFecha)}${p.citaHora ? " " + p.citaHora : ""}`
          : "-";
        const llegadaText = formatViajeDateTime(p.llegadaReal);
        const salidaText = formatViajeDateTime(p.salidaReal);

        return `<tr>
          <td><strong>${tipoLabel}</strong></td>
          <td>${p.lugar || "-"}</td>
          <td>${citaText}</td>
          <td>${llegadaText}</td>
          <td>${salidaText}</td>
        </tr>`;
      }).join("");

      const finInfo = v.estado === "COMPLETADO" && (v.finLugar || v.finHora)
        ? `<p style="margin-top:4px;font-size:10px;color:#374151;"><strong>${t("export.pdfEnd")}:</strong> ${v.finLugar || ""} ${v.finHora ? t("export.pdfAtTime") + " " + v.finHora : ""}</p>`
        : "";

      const notasInfo = v.notas
        ? `<p style="margin-top:4px;font-size:10px;color:#6b7280;"><strong>${t("export.pdfNotes")}:</strong> ${v.notas}</p>`
        : "";

      const finNotaInfo = v.finViajeNota
        ? `<p style="margin-top:4px;font-size:10px;color:#6b7280;"><strong>${t("export.pdfEndNote")}:</strong> ${v.finViajeNota}</p>`
        : "";

      return `
        <div style="margin-bottom:14px;padding:10px;border:1px solid #e5e7eb;border-radius:6px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-size:12px;font-weight:700;color:#1a1a2e;">${t("export.pdfTrip")} #${idx + 1} - ${clienteText}</span>
            <span style="font-size:10px;padding:2px 8px;border-radius:4px;background:${v.estado === "COMPLETADO" ? "#dcfce7" : "#fef3c7"};color:${v.estado === "COMPLETADO" ? "#166534" : "#92400e"};">${estadoLabel}</span>
          </div>
          <p style="font-size:10px;color:#6b7280;margin-bottom:6px;">${t("export.pdfMode")}: ${modoText} | ${t("export.pdfCreated")}: ${createdDate}</p>
          <table>
            <thead>
              <tr>
                <th>${t("export.pdfType")}</th>
                <th>${t("common.place")}</th>
                <th>${t("export.pdfAppointment")}</th>
                <th>${t("export.pdfArrival")}</th>
                <th>${t("export.pdfDeparture")}</th>
              </tr>
            </thead>
            <tbody>${paradasRows}</tbody>
          </table>
          ${finInfo}${notasInfo}${finNotaInfo}
        </div>
      `;
    }).join("");

    return `
      <div class="section">
        <h2>${t("export.pdfTrips")}</h2>
        <p class="subtitle">${viajes.length} ${t("export.pdfTrips").toLowerCase()}</p>
        ${viajeBlocks}
      </div>
    `;
  }

  function buildFullHTML(historial: string, dietas: string, viajes: string, desde: string, hasta: string, payloadBase64?: string): string {
    const now = new Date();
    const generatedAt = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const payloadChunks = payloadBase64
      ? payloadBase64.match(/.{1,120}/g)?.join("<br/>") || payloadBase64
      : "";

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
    font-size: 11px;
    color: #1a1a2e;
    padding: 20px;
    line-height: 1.4;
  }
  .report-header {
    border-bottom: 3px solid #2563EB;
    padding-bottom: 12px;
    margin-bottom: 16px;
  }
  .report-header h1 {
    font-size: 20px;
    color: #2563EB;
    margin-bottom: 4px;
  }
  .report-header .meta {
    font-size: 11px;
    color: #6b7280;
  }
  .section { margin-bottom: 20px; }
  h2 {
    font-size: 15px;
    color: #1a1a2e;
    border-bottom: 1px solid #e5e7eb;
    padding-bottom: 6px;
    margin-bottom: 10px;
  }
  h3 {
    font-size: 12px;
    color: #374151;
    margin: 12px 0 6px;
  }
  .subtitle {
    font-size: 11px;
    color: #6b7280;
    margin-bottom: 8px;
  }
  .empty { color: #9ca3af; font-style: italic; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 8px;
    font-size: 10px;
  }
  table.small { max-width: 400px; }
  th, td {
    border: 1px solid #e5e7eb;
    padding: 4px 6px;
    text-align: left;
  }
  th {
    background: #f3f4f6;
    font-weight: 600;
    font-size: 9px;
    text-transform: uppercase;
    color: #374151;
  }
  .num { text-align: right; }
  tr:nth-child(even) td { background: #fafbfc; }
  .summary-grid {
    display: flex;
    gap: 12px;
    margin-bottom: 12px;
  }
  .summary-box {
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 10px 14px;
    flex: 1;
    text-align: center;
  }
  .summary-box.highlight {
    background: #2563EB;
    border-color: #2563EB;
  }
  .summary-box.highlight .summary-label,
  .summary-box.highlight .summary-value { color: #fff; }
  .summary-label {
    display: block;
    font-size: 10px;
    color: #6b7280;
    margin-bottom: 2px;
  }
  .summary-value {
    display: block;
    font-size: 16px;
    font-weight: 700;
    color: #1a1a2e;
  }
  .footer {
    margin-top: 20px;
    border-top: 1px solid #e5e7eb;
    padding-top: 8px;
    font-size: 9px;
    color: #9ca3af;
    text-align: center;
  }
  .embedded-backup {
    margin-top: 4px;
    font-size: 1px;
    line-height: 1.05;
    color: transparent;
    white-space: normal;
    word-break: break-all;
    overflow-wrap: anywhere;
    max-width: 100%;
  }
  @media print {
    body { padding: 10px; }
    .section { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="report-header">
    <h1>Tacoplan - Informe</h1>
    <div class="meta">Periodo: ${desde} - ${hasta} | Generado: ${generatedAt}</div>
  </div>
  ${historial}
  ${dietas}
  ${viajes}
  ${payloadBase64 ? `<div class="embedded-backup" aria-hidden="true">TACOPLAN_DATA:${payloadChunks}</div>` : ""}
  <div class="footer">Generado por Tacoplan - Control de Tacografo CE 561/2006</div>
</body>
</html>`;
  }

  const months = getMonths(t);

  const contentOptions: { key: ExportContent; label: string; icon: string }[] = [
    { key: "historial", label: t("export.onlyHistorial"), icon: "document-text-outline" },
    { key: "dietas", label: t("export.onlyDietas"), icon: "cash-outline" },
    { key: "viajes", label: t("export.onlyViajes"), icon: "navigate-outline" },
    { key: "ambos", label: t("export.histDietas"), icon: "documents-outline" },
    { key: "todo", label: t("export.everything"), icon: "layers-outline" },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={Colors.light.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{t("export.title")}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <DatePickerModal
          visible={pickerTarget !== null}
          value={pickerTarget === "hasta" ? fechaHasta : fechaDesde}
          title={pickerTarget === "hasta" ? t("export.selectDateTo") : t("export.selectDateFrom")}
          months={months}
          dayLabel={t("export.day")}
          monthLabel={t("export.month")}
          yearLabel={t("export.year")}
          cancelLabel={t("common.cancel")}
          confirmLabel={t("common.confirm")}
          onCancel={() => setPickerTarget(null)}
          onConfirm={(iso) => {
            if (pickerTarget === "desde") setFechaDesde(iso);
            else setFechaHasta(iso);
            setPickerTarget(null);
          }}
        />

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t("export.dateRange")}</Text>
          <View style={styles.dateRow}>
            <Pressable style={styles.dateField} onPress={() => setPickerTarget("desde")}>
              <Text style={styles.dateLabel}>{t("common.from")}</Text>
              <View style={styles.datePickerBtn}>
                <Ionicons name="calendar-outline" size={16} color={Colors.light.tint} />
                <Text style={styles.datePickerText}>{formatDisplay(fechaDesde)}</Text>
              </View>
            </Pressable>
            <Ionicons name="arrow-forward" size={18} color={Colors.light.textSecondary} style={{ marginTop: 22 }} />
            <Pressable style={styles.dateField} onPress={() => setPickerTarget("hasta")}>
              <Text style={styles.dateLabel}>{t("common.to")}</Text>
              <View style={styles.datePickerBtn}>
                <Ionicons name="calendar-outline" size={16} color={Colors.light.tint} />
                <Text style={styles.datePickerText}>{formatDisplay(fechaHasta)}</Text>
              </View>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t("export.reportContent")}</Text>
          {contentOptions.map((opt) => (
            <Pressable
              key={opt.key}
              style={[
                styles.optionRow,
                contenido === opt.key && styles.optionRowActive,
              ]}
              onPress={() => setContenido(opt.key)}
            >
              <Ionicons
                name={opt.icon as any}
                size={20}
                color={contenido === opt.key ? Colors.light.tint : Colors.light.textSecondary}
              />
              <Text
                style={[
                  styles.optionText,
                  contenido === opt.key && styles.optionTextActive,
                ]}
              >
                {opt.label}
              </Text>
              {contenido === opt.key && (
                <Ionicons name="checkmark-circle" size={20} color={Colors.light.tint} style={{ marginLeft: "auto" }} />
              )}
            </Pressable>
          ))}
        </View>

        <View style={styles.infoCard}>
          <Ionicons name="information-circle-outline" size={16} color={Colors.light.tint} />
          <Text style={styles.infoText}>
            {t("export.info")}
          </Text>
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.generateBtn,
            { opacity: pressed ? 0.85 : 1 },
            generando && styles.generateBtnDisabled,
          ]}
          onPress={() => setOptionsVisible(true)}
          disabled={generando}
        >
          {generando ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="download-outline" size={20} color="#fff" />
          )}
          <Text style={styles.generateBtnText}>
            {generando ? t("export.generating") : t("export.generateAndDownload")}
          </Text>
        </Pressable>

        <Modal visible={optionsVisible} transparent animationType="fade" onRequestClose={() => setOptionsVisible(false)}>
          <Pressable style={styles.optOverlay} onPress={() => setOptionsVisible(false)}>
            <Pressable style={styles.optSheet} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.optTitle}>{t("export.reportOptionsTitle")}</Text>

              <Pressable
                style={({ pressed }) => [styles.optRow, { opacity: pressed ? 0.9 : 1 }]}
                onPress={() => setReportOptions((p) => ({ ...p, showAmounts: !p.showAmounts }))}
              >
                <Ionicons name={reportOptions.showAmounts ? "checkbox" : "square-outline"} size={20} color={Colors.light.tint} />
                <Text style={styles.optText}>{t("export.showAmounts")}</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.optRow, { opacity: pressed ? 0.9 : 1 }]}
                onPress={() => setReportOptions((p) => ({ ...p, showPluses: !p.showPluses }))}
              >
                <Ionicons name={reportOptions.showPluses ? "checkbox" : "square-outline"} size={20} color={Colors.light.tint} />
                <Text style={styles.optText}>{t("export.showPluses")}</Text>
              </Pressable>

              <View style={styles.optActions}>
                <Pressable style={({ pressed }) => [styles.optCancelBtn, { opacity: pressed ? 0.9 : 1 }]} onPress={() => setOptionsVisible(false)}>
                  <Text style={styles.optCancelText}>{t("common.cancel")}</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.optConfirmBtn, { opacity: pressed ? 0.9 : 1 }]}
                  onPress={() => {
                    setOptionsVisible(false);
                    generarPDF(reportOptions);
                  }}
                >
                  <Text style={styles.optConfirmText}>{t("export.generatePdf")}</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: Colors.light.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
    marginBottom: 12,
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  dateField: {
    flex: 1,
  },
  dateLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: Colors.light.textSecondary,
    marginBottom: 4,
  },
  datePickerBtn: {
    backgroundColor: Colors.light.background,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  datePickerText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 4,
  },
  optionRowActive: {
    backgroundColor: Colors.light.tint + "10",
  },
  optionText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    color: Colors.light.textSecondary,
  },
  optionTextActive: {
    color: Colors.light.tint,
    fontFamily: "Inter_600SemiBold",
  },
  infoCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: Colors.light.tint + "0A",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    lineHeight: 18,
  },
  generateBtn: {
    backgroundColor: Colors.light.tint,
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  generateBtnDisabled: {
    opacity: 0.6,
  },
  generateBtnText: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },
  optOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 16,
  },
  optSheet: {
    backgroundColor: Colors.light.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  optTitle: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
    marginBottom: 12,
  },
  optRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
  },
  optText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: Colors.light.text,
  },
  optActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  optCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.background,
    alignItems: "center",
  },
  optCancelText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.textSecondary,
  },
  optConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.light.tint,
    alignItems: "center",
  },
  optConfirmText: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },
});
