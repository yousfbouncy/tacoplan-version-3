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
import AsyncStorage from "@react-native-async-storage/async-storage";
import Colors from "@/constants/colors";
import {
  listarJornadas,
  getResumenDietas,
  getAllViajes,
  getAllFerryRests,
  getFerryExtrasSummary,
  type Jornada,
  type Viaje,
  type Parada,
  type UserDietRate,
  type UserDayExtras,
  type FerryRestRecord,
  findRate,
} from "@/lib/local-storage";
import { useFerry } from "@/lib/ferry-context";
import {
  formatFecha,
  formatMinutosHoras,
  todayStr,
} from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { getApiUrl } from "@/lib/query-client";
import { useI18n } from "@/lib/i18n-context";

type ExportContent = "historial" | "dietas" | "viajes" | "ambos" | "todo";

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
  const { user, isGuest, getAccessToken } = useAuth();
  const { config: ferryConfig } = useFerry();
  const fTransitRate = ferryConfig.ferryTransitRate ?? 54.30;
  const fCabinRate = ferryConfig.ferryCabinRate ?? 54.30;

  const [fechaDesde, setFechaDesde] = useState(getDefaultFrom());
  const [fechaHasta, setFechaHasta] = useState(todayStr());
  const [contenido, setContenido] = useState<ExportContent>("ambos");
  const [generando, setGenerando] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<"desde" | "hasta" | null>(null);

  const [customRates, setCustomRates] = useState<UserDietRate[] | null>(null);
  const [dayExtras, setDayExtras] = useState<UserDayExtras>({ extra_saturday: 10, extra_sunday: 15, extra_holiday: 20 });

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const local = await AsyncStorage.getItem("tacoplan_user_settings");
      if (local) {
        const s = JSON.parse(local);
        const pf = (v: any, fb: number) => { const n = parseFloat(v); return isNaN(n) ? fb : n; };
        setCustomRates([
          { trip_type: "NACIONAL", percent: 100, amount: pf(s.nac_100, 54.30) },
          { trip_type: "NACIONAL", percent: 60, amount: pf(s.nac_60, 32.58) },
          { trip_type: "NACIONAL", percent: 30, amount: pf(s.nac_30, 16.29) },
          { trip_type: "INTERNACIONAL", percent: 100, amount: pf(s.intl_100, 72.77) },
          { trip_type: "INTERNACIONAL", percent: 60, amount: pf(s.intl_60, 43.66) },
          { trip_type: "INTERNACIONAL", percent: 30, amount: pf(s.intl_30, 21.83) },
        ]);
        setDayExtras({
          extra_saturday: pf(s.extra_saturday, 10),
          extra_sunday: pf(s.extra_sunday, 15),
          extra_holiday: pf(s.extra_holiday, 20),
        });
      }
    } catch (_) {}

    if (isGuest || !user) return;
    try {
      const token = await getAccessToken();
      if (!token) return;
      const base = getApiUrl();
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      const [ratesRes, extrasRes] = await Promise.all([
        fetch(new URL("/api/user/diet-rates", base).toString(), { headers }),
        fetch(new URL("/api/user/day-extras", base).toString(), { headers }),
      ]);
      if (ratesRes.ok) {
        const rd = await ratesRes.json();
        if (rd.rates?.length > 0) setCustomRates(rd.rates);
      }
      if (extrasRes.ok) {
        const ed = await extrasRes.json();
        if (ed.extras) {
          setDayExtras({
            extra_saturday: ed.extras.extra_saturday ?? 10,
            extra_sunday: ed.extras.extra_sunday ?? 15,
            extra_holiday: ed.extras.extra_holiday ?? 20,
          });
        }
      }
    } catch (_) {}
  };

  const validateDates = (): boolean => {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(fechaDesde) || !dateRegex.test(fechaHasta)) return false;
    if (fechaDesde > fechaHasta) return false;
    return true;
  };

  const generarPDF = async () => {
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

      const resumen = await getResumenDietas(fechaDesde, fechaHasta);

      let historialHTML = "";
      let dietasHTML = "";
      let viajesHTML = "";
      const fechaDesdeF = formatFecha(fechaDesde);
      const fechaHastaF = formatFecha(fechaHasta);

      const includeHistorial = contenido === "historial" || contenido === "ambos" || contenido === "todo";
      const includeDietas = contenido === "dietas" || contenido === "ambos" || contenido === "todo";
      const includeViajes = contenido === "viajes" || contenido === "todo";

      const allFerryRests = await getAllFerryRests();
      const ferryRestsInRange = allFerryRests.filter((fr) => fr.fecha >= fechaDesde && fr.fecha <= fechaHasta);
      ferryRestsInRange.sort((a, b) => a.startTime.localeCompare(b.startTime));

      if (includeHistorial) {
        historialHTML = buildHistorialHTML(cerradas, fechaDesdeF, fechaHastaF, ferryRestsInRange);
      }
      if (includeDietas) {
        const ferryExtrasSummary = await getFerryExtrasSummary(fechaDesde, fechaHasta, fTransitRate, fCabinRate);
        dietasHTML = buildDietasHTML(cerradas, resumen, fechaDesdeF, fechaHastaF, ferryExtrasSummary);
      }
      if (includeViajes) {
        const allViajes = await getAllViajes();
        const filtered = allViajes.filter((v) => {
          const created = v.createdAt.substring(0, 10);
          return created >= fechaDesde && created <= fechaHasta;
        });
        filtered.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        viajesHTML = buildViajesHTML(filtered, fechaDesdeF, fechaHastaF);
      }

      const html = buildFullHTML(historialHTML, dietasHTML, viajesHTML, fechaDesdeF, fechaHastaF);

      if (Platform.OS === "web") {
        const printWindow = window.open("", "_blank");
        if (printWindow) {
          printWindow.document.write(html);
          printWindow.document.close();
          setTimeout(() => {
            printWindow.print();
          }, 400);
        }
      } else {
        const { uri } = await Print.printToFileAsync({ html, base64: false });
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(uri, {
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

  function buildHistorialHTML(jornadas: Jornada[], desde: string, hasta: string, ferryRestsInRange: FerryRestRecord[] = []): string {
    if (jornadas.length === 0 && ferryRestsInRange.length === 0) {
      return `<div class="section"><h2>${t("export.pdfHistorialTitle")}</h2><p class="empty">${t("export.pdfNoJornadas")}</p></div>`;
    }

    const totalConduccion = jornadas.reduce((s, j) => s + (j.conduccionMin || 0), 0);
    const totalDuracion = jornadas.reduce((s, j) => s + (j.duracionJornadaMin || 0), 0);
    const totalDieta = jornadas.reduce((s, j) => s + (j.dietaImporteEur ? parseFloat(j.dietaImporteEur) : 0), 0);
    const totalExtrasHistorial = jornadas.reduce((s, j) => s + (j.dayExtraEur ? parseFloat(j.dayExtraEur) : 0), 0);
    const totalPlus = jornadas.reduce((s, j) => s + ((j.plusItems || []).reduce((ps, p) => ps + p.importe, 0)), 0);

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

    for (const j of jornadas) {
      const ts = j.startAt ? new Date(j.startAt).getTime() : 0;
      const cond = j.conduccionMin ? formatMinutosHoras(j.conduccionMin) : "-";
      const dur = j.duracionJornadaMin ? formatMinutosHoras(j.duracionJornadaMin) : "-";
      const ruta = tipoRutaLabelI18n(j.tipoRuta);
      const dieta = j.dietaImporteEur ? `${j.dietaImporteEur} \u20AC` : "-";
      const extra = j.dayFlag && j.dayExtraEur && parseFloat(j.dayExtraEur) > 0
        ? `${dayFlagLabelI18n(j.dayFlag)} +${j.dayExtraEur}\u20AC`
        : "";
      const plusSum = (j.plusItems || []).reduce((s, p) => s + p.importe, 0);
      const plus = plusSum > 0 ? `${plusSum.toFixed(2)} \u20AC` : "-";
      const obsText = j.observaciones ? j.observaciones.substring(0, 30) : "-";

      combinedRows.push({ ts, html: `<tr>
        <td>${formatFecha(j.fechaInicio)}</td>
        <td>${j.lugarInicio || "-"}</td>
        <td>${j.lugarFin || "-"}</td>
        <td>${ruta}</td>
        <td class="num">${cond}</td>
        <td class="num">${dur}</td>
        <td class="num">${dieta}</td>
        <td>${extra}</td>
        <td class="num">${plus}</td>
        <td>${obsText}</td>
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

      combinedRows.push({ ts, html: `<tr style="background: #e0f2fe;">
        <td>\u{1F6A2} ${formatFecha(fr.fecha)}</td>
        <td colspan="2">Descanso en Ferry ${fr.restType}${fr.destination ? " \u2192 " + fr.destination : ""}</td>
        <td>Ferry</td>
        <td class="num">${startStr}</td>
        <td class="num">${endStr}</td>
        <td class="num">${ferryAmount > 0 ? ferryAmount.toFixed(2) + " \u20AC" : "-"}</td>
        <td>${badges.join(", ")}${intInfo}</td>
        <td class="num">-</td>
        <td>${fr.isValid ? "\u2705" : "\u26A0\uFE0F"}</td>
      </tr>` });
    }

    combinedRows.sort((a, b) => a.ts - b.ts);
    const rows = combinedRows.map((r) => r.html).join("");

    const totalRow = `<tr style="font-weight: bold; background: #f0f0f0;">
      <td colspan="4"><strong>${t("export.pdfTotals")}</strong></td>
      <td class="num"><strong>${formatMinutosHoras(totalConduccion)}</strong></td>
      <td class="num"><strong>${formatMinutosHoras(totalDuracion)}</strong></td>
      <td class="num"><strong>${(totalDieta + totalFerryExtrasAmount).toFixed(2)} \u20AC</strong></td>
      <td><strong>${totalExtrasHistorial > 0 ? totalExtrasHistorial.toFixed(2) + " \u20AC" : "-"}</strong>${totalFerryExtrasAmount > 0 ? ` <span style="color:#0284c7;">(+${totalFerryExtrasAmount.toFixed(2)}\u20AC ferry)</span>` : ""}</td>
      <td class="num"><strong>${totalPlus > 0 ? totalPlus.toFixed(2) + " \u20AC" : "-"}</strong></td>
      <td></td>
    </tr>`;

    return `
      <div class="section">
        <h2>${t("export.pdfHistorialTitle")}</h2>
        <p class="subtitle">${jornadas.length} ${t("export.pdfJornadasCount")}${ferryRestsInRange.length > 0 ? ` + ${ferryRestsInRange.length} ferry` : ""} | ${t("export.pdfTotalDriving")}: ${formatMinutosHoras(totalConduccion)} | ${t("export.pdfTotalDuration")}: ${formatMinutosHoras(totalDuracion)}</p>
        <table>
          <thead>
            <tr>
              <th>${t("export.pdfDate")}</th>
              <th>${t("export.pdfOrigin")}</th>
              <th>${t("export.pdfDestination")}</th>
              <th>${t("export.pdfRoute")}</th>
              <th class="num">${t("export.pdfDriving")}</th>
              <th class="num">${t("export.pdfDuration")}</th>
              <th class="num">${t("export.pdfDiet")}</th>
              <th>${t("export.pdfExtra")}</th>
              <th class="num">${t("export.pdfPlus")}</th>
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
  ): string {
    const totalDietas = jornadas.reduce((s, j) => s + (j.dietaImporteEur ? parseFloat(j.dietaImporteEur) : 0), 0);
    const totalExtras = resumen.extras.totalExtras;
    const totalPlus = jornadas.reduce((s, j) => s + ((j.plusItems || []).reduce((ps, p) => ps + p.importe, 0)), 0);
    const ferryExtrasTotal = ferryExtrasSummary?.totalAmount || 0;
    const granTotal = Math.round((totalDietas + totalExtras + totalPlus + ferryExtrasTotal) * 100) / 100;

    const desgloseRows = resumen.desglose.map((d) => `
      <tr>
        <td>${dietaTipoLabelI18n(d.tipo)}</td>
        <td class="num">${d.cantidad}</td>
        <td class="num">${d.total.toFixed(2)} \u20AC</td>
      </tr>
    `).join("");

    const extrasRows = resumen.extras.desglose.map((e) => `
      <tr>
        <td>${dayFlagLabelI18n(e.tipo)}</td>
        <td class="num">${e.cantidad}</td>
        <td class="num">${e.total.toFixed(2)} \u20AC</td>
      </tr>
    `).join("");

    const jornadaRows = jornadas
      .filter((j) => j.dietaImporteEur && parseFloat(j.dietaImporteEur) > 0)
      .map((j) => {
        const extra = j.dayFlag && j.dayExtraEur && parseFloat(j.dayExtraEur) > 0
          ? parseFloat(j.dayExtraEur) : 0;
        const dietaBase = parseFloat(j.dietaImporteEur || "0");
        const plusSum = (j.plusItems || []).reduce((s, p) => s + p.importe, 0);
        return `<tr>
          <td>${formatFecha(j.fechaInicio)}</td>
          <td>${tipoRutaLabelI18n(j.tipoRuta)}</td>
          <td class="num">${j.dietaPercent != null ? j.dietaPercent + "%" : "-"}</td>
          <td class="num">${dietaBase.toFixed(2)} \u20AC</td>
          <td class="num">${extra > 0 ? extra.toFixed(2) + " \u20AC" : "-"}</td>
          <td class="num">${plusSum > 0 ? plusSum.toFixed(2) + " \u20AC" : "-"}</td>
          <td class="num">${(dietaBase + extra + plusSum).toFixed(2)} \u20AC</td>
        </tr>`;
      }).join("");

    return `
      <div class="section">
        <h2>${t("export.pdfDietSummary")}</h2>
        <div class="summary-grid">
          <div class="summary-box">
            <span class="summary-label">${t("export.pdfDiets")}</span>
            <span class="summary-value">${totalDietas.toFixed(2)} \u20AC</span>
          </div>
          <div class="summary-box">
            <span class="summary-label">${t("export.pdfDayExtras")}</span>
            <span class="summary-value">${totalExtras.toFixed(2)} \u20AC</span>
          </div>
          <div class="summary-box">
            <span class="summary-label">${t("export.pdfPlus")}</span>
            <span class="summary-value">${totalPlus.toFixed(2)} \u20AC</span>
          </div>
          ${ferryExtrasTotal > 0 ? `<div class="summary-box" style="border-color:#0284c7;">
            <span class="summary-label" style="color:#0284c7;">Extras Ferry</span>
            <span class="summary-value" style="color:#0284c7;">${ferryExtrasTotal.toFixed(2)} \u20AC</span>
          </div>` : ""}
          <div class="summary-box highlight">
            <span class="summary-label">${t("export.pdfTotal")}</span>
            <span class="summary-value">${granTotal.toFixed(2)} \u20AC</span>
          </div>
        </div>

        ${ferryExtrasSummary && ferryExtrasSummary.count > 0 ? `
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
            <thead><tr><th>${t("export.pdfType")}</th><th class="num">${t("export.pdfQty")}</th><th class="num">${t("export.pdfTotal")}</th></tr></thead>
            <tbody>${desgloseRows}</tbody>
          </table>
        ` : ""}

        ${resumen.extras.desglose.length > 0 ? `
          <h3>${t("export.pdfDayExtrasTitle")}</h3>
          <table class="small">
            <thead><tr><th>${t("export.pdfDayCol")}</th><th class="num">${t("export.pdfQty")}</th><th class="num">${t("export.pdfTotal")}</th></tr></thead>
            <tbody>${extrasRows}</tbody>
          </table>
        ` : ""}

        ${jornadaRows ? `
          <h3>${t("export.pdfDetailByJornada")}</h3>
          <table>
            <thead>
              <tr>
                <th>${t("export.pdfDate")}</th>
                <th>${t("export.pdfRoute")}</th>
                <th class="num">%</th>
                <th class="num">${t("export.pdfDiet")}</th>
                <th class="num">${t("export.pdfExtra")}</th>
                <th class="num">${t("export.pdfPlus")}</th>
                <th class="num">${t("export.pdfTotal")}</th>
              </tr>
            </thead>
            <tbody>${jornadaRows}</tbody>
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

  function buildFullHTML(historial: string, dietas: string, viajes: string, desde: string, hasta: string): string {
    const now = new Date();
    const generatedAt = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

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
          onPress={generarPDF}
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
});
