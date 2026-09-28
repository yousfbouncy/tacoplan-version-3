import { useState, useMemo, useEffect, useCallback } from "react";
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  Pressable,
  Alert,
  Platform,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  ScrollView,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import {
  formatFecha,
  formatDescanso,
  formatMinutosHoras,
  formatDateForDisplay,
  parseDisplayDateToISO,
} from "@/lib/utils";
import { usePeriod } from "@/lib/period-context";
import { useI18n } from "@/lib/i18n-context";
import { useFerry } from "@/lib/ferry-context";
import { useAuth } from "@/lib/auth-context";
import {
  listarJornadas,
  eliminarJornada,
  listarCompensaciones,
  getAllViajes,
  getAllFerryRests,
  getActiveFerryRest,
  listDayExtraEntries,
  deleteDayExtraEntry,
  updateDayExtraEntry,
  updateFerryRest,
  deleteFerryRest,
  updateJornadaFerryData,
  splitOffsiteWeeklyRestEntry,
  calcDayExtra,
  type UserDayExtras,
  type DayExtraEntry,
  type Jornada,
  type Compensacion,
  type Viaje,
  type FerryRestRecord,
  type ActiveFerryRest,
  type FerryInterruption,
  getFerryInterruptionsTotalMin,
} from "@/lib/local-storage";

const PDF_DIETS_DEBUG_URL = "http://127.0.0.1:7777/event";
const PDF_DIETS_DEBUG_SESSION = "pdf-diets-not-saved";
const PDF_DIETS_DEBUG_RUN = "pre-fix";
const JORNADA_DATE_DEBUG_URL = "http://127.0.0.1:7777/event";
const JORNADA_DATE_DEBUG_SESSION = "jornada-date-drift";
const JORNADA_DATE_DEBUG_RUN = "pre-fix";
const historialDietDebugSeen = new Set<string>();
const historialDateDebugSeen = new Set<string>();

function reportHistorialDietDebug(kind: "manual" | "imported", item: Jornada, totalCalculado: number, paymentMode: string): void {
  const key = `${kind}:${item.id}`;
  if (historialDietDebugSeen.has(key) || typeof fetch !== "function") return;
  historialDietDebugSeen.add(key);
  fetch(PDF_DIETS_DEBUG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: PDF_DIETS_DEBUG_SESSION,
      runId: PDF_DIETS_DEBUG_RUN,
      hypothesisId: "B",
      location: "historial:JornadaItem:render",
      msg: `[DEBUG] ${kind.toUpperCase()} DIETA DEBUG`,
      data: {
        kind,
        id: item.id,
        paymentMode,
        dietaImporteEur: item.dietaImporteEur,
        dietBaseEur: item.dietBaseEur,
        dietaPercent: item.dietaPercent,
        dietaModo: item.dietaModo,
        dietaManualTipo: item.dietaManualTipo,
        dietaManualPct: item.dietaManualPct,
        dietasItems: item.dietasItems,
        dayFlag: item.dayFlag,
        dayExtraEur: item.dayExtraEur,
        plusItems: item.plusItems,
        pernocta: item.pernocta,
        totalCalculado,
      },
      ts: Date.now(),
    }),
  }).catch(() => {
    historialDietDebugSeen.delete(key);
  });
}

function reportJornadaDateDebug(item: Jornada, renderedDate: string): void {
  const key = `${item.id}:${item.updatedAt || ""}:${renderedDate}`;
  if (historialDateDebugSeen.has(key) || typeof fetch !== "function") return;
  historialDateDebugSeen.add(key);
  let timezone: string | null = null;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {}
  fetch(JORNADA_DATE_DEBUG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: JORNADA_DATE_DEBUG_SESSION,
      runId: JORNADA_DATE_DEBUG_RUN,
      hypothesisId: "E",
      location: "historial:JornadaItem:renderDate",
      msg: "[JORNADA_DATE_DEBUG] jornada rendered in Historial",
      data: {
        timezone,
        timezoneOffset: new Date().getTimezoneOffset(),
        platform: Platform.OS,
        jornadaId: item.id,
        fechaInicio: item.fechaInicio,
        horaInicio: item.horaInicio,
        fechaFin: item.fechaFin,
        horaFin: item.horaFin,
        startAt: item.startAt,
        endAt: item.endAt,
        fechaMostradaHistorial: renderedDate,
      },
      ts: Date.now(),
    }),
  }).catch(() => {
    historialDateDebugSeen.delete(key);
  });
}
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  getLegalStatusColor,
  getLegalStatusLabel,
  getQualifiedSplitDailyRestFirstPartMin,
  getSeverityColor,
  getSplitDailyRestComputedTotalMin,
} from "@/lib/legalEngine";
import { useSync } from "@/lib/sync-context";
import { userScopedKey } from "@/lib/user-scope";
import PendingNaturalDietsModal, { type DetectedDiet } from "@/components/PendingNaturalDietsModal";
import ArrivalDayDietSelectorModal from "@/components/ArrivalDayDietSelectorModal";
import {
  detectMissingOutOfBaseDietDays,
  getAllNaturalDayDiets,
  deleteNaturalDayDiet,
  dismissNaturalDayDiets,
  upsertNaturalDayDiets,
  clearDismissedNaturalDayDietsInRange,
  type NaturalDayDietEntry,
  type DetectedMissingNaturalDay,
} from "@/lib/local-storage";

function getLegalStatus(item: Jornada): { color: string; label: string } {
  if (!item.fechaFin) return { color: Colors.light.textSecondary, label: "-" };

  if (item.legalSummary) {
    return {
      color: getLegalStatusColor(item.legalSummary.status),
      label: getLegalStatusLabel(item.legalSummary.status),
    };
  }

  const isDouble = (item as any).isDoubleDriving === true;
  const durMin = item.duracionJornadaMin || 0;
  const condMin = item.conduccionMin || Math.round(durMin * 0.65);

  const maxDutyForViolation = isDouble ? 21 * 60 : 15 * 60;
  const maxDutyForWarning = isDouble ? 19 * 60 : 13 * 60;

  if (
    item.tipoDescansoAnterior === "INFRACCION_DESCANSO" ||
    condMin > 10 * 60 ||
    durMin > maxDutyForViolation
  ) {
    return { color: Colors.light.danger, label: "Infraccion" };
  }

  if (
    item.tipoDescansoAnterior === "DESCANSO_DIARIO_REDUCIDO" ||
    condMin > 9 * 60 ||
    durMin > maxDutyForWarning
  ) {
    return { color: Colors.light.warning, label: "Advertencia" };
  }

  return { color: Colors.light.success, label: "Legal" };
}

function findViajesForJornada(jornada: Jornada, viajes: Viaje[]): Viaje[] {
  if (!jornada.startAt) return [];
  const jStart = new Date(jornada.startAt).getTime();
  const jEnd = jornada.endAt ? new Date(jornada.endAt).getTime() : Date.now();

  return viajes.filter((v) => {
    return v.paradas.some((p) => {
      if (p.llegadaReal) {
        const t = new Date(p.llegadaReal).getTime();
        if (t >= jStart && t <= jEnd) return true;
      }
      if (p.salidaReal) {
        const t = new Date(p.salidaReal).getTime();
        if (t >= jStart && t <= jEnd) return true;
      }
      if (p.citaFecha) {
        const citaStr = p.citaHora
          ? `${p.citaFecha}T${p.citaHora}:00`
          : `${p.citaFecha}T12:00:00`;
        const t = new Date(citaStr).getTime();
        if (t >= jStart && t <= jEnd) return true;
      }
      return false;
    });
  });
}

function formatDateTimeShort(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} ${hh}:${mi}`;
}

function normalizeFerryInterruptions(
  interruptions: FerryRestRecord["interruptions"] | Jornada["ferryInterruptions"] | null | undefined,
): FerryInterruption[] {
  if (!interruptions || interruptions.length === 0) return [];
  return (interruptions as any[])
    .map((int) => {
      if (int && typeof int.start === "string") {
        return { start: int.start, end: typeof int.end === "string" ? int.end : null };
      }
      return null;
    })
    .filter((v): v is FerryInterruption => !!v);
}

function clasificarDescansoLocal(minutos: number): { tipo: string; labelKey: string; color: string } {
  if (minutos < 9 * 60) return { tipo: "INFRACCION", labelKey: "historial.restInfraction", color: Colors.light.danger };
  if (minutos < 11 * 60) return { tipo: "REDUCIDO_DIARIO", labelKey: "historial.dailyReduced", color: Colors.light.warning };
  if (minutos < 24 * 60) return { tipo: "COMPLETO_DIARIO", labelKey: "historial.dailyComplete", color: Colors.light.success };
  if (minutos < 45 * 60) return { tipo: "REDUCIDO_SEMANAL", labelKey: "historial.weeklyReduced", color: Colors.light.warning };
  return { tipo: "COMPLETO_SEMANAL", labelKey: "historial.weeklyComplete", color: Colors.light.success };
}

function isSplitDailyCompleteForHistory(restMin: number, restJornada?: Jornada): boolean {
  return !!restJornada &&
    restMin >= 9 * 60 &&
    restMin < 11 * 60 &&
    restJornada.tipoDescansoAnterior === "DESCANSO_DIARIO_COMPLETO";
}

function formatSplitDailyRestLabel(t: (key: string) => string): string {
  return t("historial.dailyCompleteSplitPrefix");
}

function formatSplitDailyRestSummary(
  t: (key: string) => string,
  firstPartMin: number,
  finalPartMin: number,
  totalMin: number,
): string {
  return `${formatDescanso(finalPartMin)} ${t("historial.dailySplitContinuousShort")} + ${formatDescanso(firstPartMin)} ${t("historial.dailySplitDuringShiftShort")} = ${formatDescanso(totalMin)}`;
}

function formatRestLocationStatus(value: Jornada["previousRestInBase"] | Compensacion["sourceRestInBase"] | undefined): string | null {
  if (value === "in_base") return "En base";
  if (value === "out_of_base") return "Fuera de base";
  if (value === "unknown") return "Ubicación desconocida";
  return null;
}

function formatRestLegalType(value: Jornada["previousRestLegalType"] | Compensacion["sourceRestLegalType"] | undefined): string | null {
  if (value === "weekly_normal") return "Descanso semanal normal";
  if (value === "weekly_reduced") return "Descanso semanal reducido";
  if (value === "weekly_invalid") return "Descanso inferior a 24h";
  return null;
}

function formatCompensationLabel(minutos: number | null | undefined): string | null {
  if (minutos == null || minutos <= 0) return "Sin compensación generada";
  return `Compensación generada: ${formatMinutosHoras(minutos)}`;
}

function RestGapItem({
  restMin,
  compensacion,
  isFerryRest,
  ferryJornada,
  restJornada,
  previousRestSourceJornada,
  onEditFerryJornada,
}: {
  restMin: number;
  compensacion?: Compensacion;
  isFerryRest?: boolean;
  ferryJornada?: Jornada;
  restJornada?: Jornada;
  previousRestSourceJornada?: Jornada;
  onEditFerryJornada?: (jornada: Jornada) => void;
}) {
  const { t } = useI18n();
  const isSplitDailyComplete = isSplitDailyCompleteForHistory(restMin, restJornada);
  const splitFirstPartMin = getQualifiedSplitDailyRestFirstPartMin(previousRestSourceJornada);
  const splitComputedTotalMin = getSplitDailyRestComputedTotalMin(restMin, previousRestSourceJornada);
  const info = isSplitDailyComplete
    ? { tipo: "COMPLETO_DIARIO", labelKey: "historial.dailyComplete", color: Colors.light.success }
    : clasificarDescansoLocal(restMin);
  const isReduced = info.tipo === "REDUCIDO_DIARIO" || info.tipo === "REDUCIDO_SEMANAL";
  const isInfraction = info.tipo === "INFRACCION" && !isFerryRest;
  const restLegalLabel = formatRestLegalType(restJornada?.previousRestLegalType ?? compensacion?.sourceRestLegalType);
  const restLocationLabel = formatRestLocationStatus(restJornada?.previousRestInBase ?? compensacion?.sourceRestInBase);
  const restDistanceLabel =
    restJornada?.previousRestDistanceKm != null
      ? `${restJornada.previousRestDistanceKm.toFixed(1)} km de la base`
      : compensacion?.sourceRestDistanceKm != null
        ? `${compensacion.sourceRestDistanceKm.toFixed(1)} km de la base`
        : null;
  const restCompLabel = formatCompensationLabel(
    restJornada?.previousRestCompGeneratedMin
      ?? (compensacion ? compensacion.horasDeuda * 60 + compensacion.minutosDeuda : null),
  );

  if (isFerryRest && ferryJornada) {
    const FERRY_BLUE = "#0284c7";
    const FERRY_BG = "#e0f2fe";
    const ints = ferryJornada.ferryInterruptions || [];
    let intTotalMin = 0;
    for (const int of ints) {
      if (int.start && int.end) {
        intTotalMin += Math.max(0, Math.round((new Date(int.end).getTime() - new Date(int.start).getTime()) / 60000));
      }
    }
    const restType = ferryJornada.ferryRestType || "11h";
    const dest = ferryJornada.ferryDestination || "";
    const extras = ferryJornada.ferryExtras;
    const isMorocco = dest.toLowerCase().includes("marr") || dest.toLowerCase().includes("morocco") || dest.toLowerCase().includes("tanger") || (extras?.countryChange && dest.toLowerCase().includes("mar"));
    const ferryStart = ferryJornada.endAt ? formatDateTimeShort(ferryJornada.endAt) : "";

    return (
      <Pressable onPress={() => onEditFerryJornada?.(ferryJornada)} style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1 }]}>
        <View style={[styles.restGap, { backgroundColor: FERRY_BG, borderLeftWidth: 3, borderLeftColor: FERRY_BLUE, borderRadius: 10, marginVertical: 4, paddingVertical: 2 }]}>
          <View style={[styles.restGapContent, { paddingVertical: 8 }]}>
            <View style={styles.restGapLeft}>
              <MaterialCommunityIcons name="ferry" size={18} color={FERRY_BLUE} />
              <Text style={[styles.restGapDuration, { color: FERRY_BLUE, fontSize: 14 }]}>
                {formatDescanso(restMin)}
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <View style={[styles.restGapTypeBadge, { backgroundColor: FERRY_BLUE + "18" }]}>
                <View style={[styles.statusDot, { backgroundColor: FERRY_BLUE }]} />
                <Text style={[styles.restGapTypeText, { color: FERRY_BLUE }]}>Descanso en Ferry/Tren</Text>
              </View>
              {isMorocco && (
                <View style={[styles.restGapTypeBadge, { backgroundColor: "#F97316" + "18" }]}>
                  <Text style={[styles.restGapTypeText, { color: "#F97316" }]}>Marruecos</Text>
                </View>
              )}
            </View>
          </View>
          <View style={{ paddingHorizontal: 12, paddingBottom: 6, gap: 3 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: FERRY_BLUE }}>
                {restType} · {ferryStart}{dest ? ` \u2192 ${dest}` : ""}
              </Text>
              <Ionicons name="create-outline" size={14} color={FERRY_BLUE} />
            </View>
            {ints.length > 0 && (
              <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textSecondary }}>
                Interrupciones: {ints.length} ({intTotalMin} min total)
              </Text>
            )}
            {extras && (extras.transitDiet > 0 || extras.cabinOvernight > 0) && (
              <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textSecondary }}>
                {extras.transitDiet > 0 ? `${extras.transitDiet} dieta tránsito` : ""}{extras.transitDiet > 0 && extras.cabinOvernight > 0 ? " · " : ""}{extras.cabinOvernight > 0 ? `${extras.cabinOvernight} pernocta camarote` : ""}
              </Text>
            )}
          </View>
        </View>
      </Pressable>
    );
  }

  const displayColor = isFerryRest ? Colors.light.success : info.color;
  const displayLabel = isFerryRest
    ? t("ferry.restInFerry")
    : isSplitDailyComplete
      ? formatSplitDailyRestLabel(t)
      : t(info.labelKey);

  return (
    <View style={[styles.restGap, isInfraction && styles.restGapDanger, !isFerryRest && isReduced && styles.restGapWarning]}>
      <View style={styles.restGapLine} />
      <View style={styles.restGapContent}>
        <View style={styles.restGapLeft}>
          <Ionicons
            name={isFerryRest ? "boat-outline" : isInfraction ? "alert-circle" : isReduced ? "warning" : "bed-outline"}
            size={14}
            color={displayColor}
          />
          <Text style={[styles.restGapDuration, { color: displayColor }]}>
            {formatDescanso(restMin)}
          </Text>
        </View>
        <View style={[styles.restGapTypeBadge, { backgroundColor: displayColor + "18" }]}>
          <View style={[styles.statusDot, { backgroundColor: displayColor }]} />
          <Text style={[styles.restGapTypeText, { color: displayColor }]}>{displayLabel}</Text>
        </View>
      </View>
      {compensacion && !compensacion.compensada && (
        <View style={styles.restGapAlert}>
          <Ionicons name="alert-circle" size={12} color={Colors.light.warning} />
          <Text style={styles.restGapAlertText}>
            {t("historial.pendingCompensate")} {compensacion.horasDeuda}h {compensacion.minutosDeuda}m {t("historial.beforeDate")} {formatFecha(compensacion.fechaLimite)}
          </Text>
        </View>
      )}
      {compensacion && compensacion.compensada && (
        <View style={styles.restGapAlert}>
          <Ionicons name="checkmark-circle" size={12} color={Colors.light.success} />
          <Text style={[styles.restGapAlertText, { color: Colors.light.success }]}>
            {t("historial.compensated")}{compensacion.fechaCompensacion ? ` ${formatFecha(compensacion.fechaCompensacion)}` : ""}
          </Text>
        </View>
      )}
      {!isFerryRest && isSplitDailyComplete && splitComputedTotalMin != null && (
        <View style={styles.restGapMeta}>
          <Text style={[styles.restGapMetaText, styles.restGapMetaTextSuccess]}>
            {formatSplitDailyRestSummary(t, splitFirstPartMin ?? 3 * 60, restMin, splitComputedTotalMin)}
          </Text>
        </View>
      )}
      {!isFerryRest && !isSplitDailyComplete && (restLegalLabel || restLocationLabel || restDistanceLabel || restCompLabel) && (
        <View style={styles.restGapMeta}>
          {restLegalLabel && (
            <Text style={styles.restGapMetaText}>
              {restLegalLabel} - {formatDescanso(restMin)}
            </Text>
          )}
          {restLocationLabel && <Text style={styles.restGapMetaText}>{restLocationLabel}</Text>}
          {restDistanceLabel && <Text style={styles.restGapMetaText}>{restDistanceLabel}</Text>}
          {restCompLabel && <Text style={styles.restGapMetaText}>{restCompLabel}</Text>}
        </View>
      )}
      <View style={styles.restGapLine} />
    </View>
  );
}

function ActiveFerryItem({ item }: { item: ActiveFerryRest }) {
  const { t } = useI18n();
  const startTime = new Date(item.startTime);
  const endTime = new Date(item.computedEnd);
  const startStr = `${String(startTime.getHours()).padStart(2, "0")}:${String(startTime.getMinutes()).padStart(2, "0")}`;
  const endStr = `${String(endTime.getHours()).padStart(2, "0")}:${String(endTime.getMinutes()).padStart(2, "0")}`;

  const now = Date.now();
  const startMs = startTime.getTime();
  let totalIntMin = 0;
  for (const int of item.interruptions) {
    if (int.end) {
      totalIntMin += Math.max(0, Math.round((new Date(int.end).getTime() - new Date(int.start).getTime()) / 60000));
    } else {
      totalIntMin += Math.max(0, Math.round((now - new Date(int.start).getTime()) / 60000));
    }
  }
  const elapsedMin = Math.max(0, Math.round((now - startMs) / 60000) - totalIntMin);
  const targetMin = item.restType === "9h" ? 540 : 660;
  const remainingMin = Math.max(0, targetMin - elapsedMin);
  const intCount = item.interruptions?.length || 0;

  return (
    <View style={[styles.restGap, { backgroundColor: Colors.light.tint + "12", borderLeftWidth: 3, borderLeftColor: Colors.light.tint }]}>
      <View style={styles.restGapLine} />
      <View style={[styles.restGapContent, { paddingVertical: 6 }]}>
        <View style={styles.restGapLeft}>
          <MaterialCommunityIcons name="ferry" size={16} color={Colors.light.tint} />
          <Text style={[styles.restGapDuration, { color: Colors.light.tint }]}>
            {item.restType} · {startStr} → {endStr}
          </Text>
        </View>
        <View style={[styles.restGapTypeBadge, { backgroundColor: Colors.light.tint + "18" }]}>
          <View style={[styles.statusDot, { backgroundColor: Colors.light.tint }]} />
          <Text style={[styles.restGapTypeText, { color: Colors.light.tint }]}>{t("ferry.ferryActive")}</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 4 }}>
        <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.tint }}>
          {t("ferry.accumulated")}: {elapsedMin} min
        </Text>
        {remainingMin > 0 && (
          <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textSecondary }}>
            {t("ferry.countdown")}: {Math.floor(remainingMin / 60)}h{String(remainingMin % 60).padStart(2, "0")}m
          </Text>
        )}
        {intCount > 0 && (
          <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textSecondary }}>
            {intCount} int.
          </Text>
        )}
      </View>
      <View style={styles.restGapLine} />
    </View>
  );
}

function OffsiteWeeklyRestItem({
  entry,
  extrasCfg,
  onEdit,
  onDelete,
}: {
  entry: DayExtraEntry;
  extrasCfg: UserDayExtras;
  onEdit?: (entry: DayExtraEntry) => void;
  onDelete?: (id: string) => void;
}) {
  const { t } = useI18n();
  const split = splitOffsiteWeeklyRestEntry(entry, extrasCfg);
  const restLabel =
    entry.offsiteRestType === "WEEKLY_REDUCED"
      ? t("dietas.offsiteWeeklyRestReduced")
      : t("dietas.offsiteWeeklyRestComplete");
  const baseLabel = entry.offsiteBase === "INTERNACIONAL" ? t("common.internacional") : t("common.nacional");

  return (
    <View style={[styles.card, { backgroundColor: Colors.light.tint + "08", borderLeftWidth: 3, borderLeftColor: Colors.light.tint }]}>
      <View style={styles.cardTop}>
        <View style={styles.cardDates}>
          <Text style={styles.dateText}>{formatFecha(entry.date)}</Text>
          <View style={[styles.infoChip, { backgroundColor: Colors.light.tint + "10" }]}>
            <Text style={[styles.chipLabel, { color: Colors.light.tint }]}>{t("dietas.offsiteWeeklyRestHistorialTitle")}</Text>
          </View>
        </View>
        <View style={styles.cardActions}>
          <Pressable
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onEdit?.(entry);
            }}
            hitSlop={8}
          >
            <Ionicons name="create-outline" size={18} color={Colors.light.tint} />
          </Pressable>
          <Pressable
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              const doDelete = () => onDelete?.(entry.id);
              if (Platform.OS === "web") {
                if (window.confirm(t("historial.deleteQuestion"))) doDelete();
              } else {
                Alert.alert(t("common.delete"), t("historial.deleteQuestion"), [
                  { text: t("common.cancel"), style: "cancel" },
                  { text: t("common.delete"), style: "destructive", onPress: doDelete },
                ]);
              }
            }}
            hitSlop={8}
          >
            <Ionicons name="trash-outline" size={18} color={Colors.light.danger} />
          </Pressable>
        </View>
      </View>
      <View style={styles.cardBottom}>
        <View style={styles.infoChip}>
          <Text style={styles.chipLabel}>{restLabel}</Text>
        </View>
        <View style={styles.infoChip}>
          <Text style={styles.chipLabel}>{baseLabel}</Text>
        </View>
        {entry.plusSunday && (
          <View style={styles.infoChip}>
            <Text style={styles.chipLabel}>{t("dietas.offsiteWeeklyRestPlusSunday")}</Text>
          </View>
        )}
        {entry.plusHoliday && (
          <View style={styles.infoChip}>
            <Text style={styles.chipLabel}>{t("dietas.offsiteWeeklyRestPlusHoliday")}</Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        <Text style={styles.dietaAmount}>{split.totalAmount > 0 ? `${split.totalAmount.toFixed(2)} \u20AC` : ""}</Text>
      </View>
      <View style={{ paddingHorizontal: 16, paddingBottom: entry.note ? 6 : 10, gap: 4 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary }}>Tipo de descanso</Text>
          <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>
            {split.restAmount.toFixed(2)} \u20AC
          </Text>
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary }}>Plus</Text>
          <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.warning }}>
            {split.plusAmount.toFixed(2)} \u20AC
          </Text>
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: Colors.light.text }}>{t("common.total")}</Text>
          <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: Colors.light.text }}>
            {split.totalAmount.toFixed(2)} \u20AC
          </Text>
        </View>
        <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textSecondary }}>
          {restLabel} · {baseLabel}
        </Text>
      </View>
      {entry.note ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
          <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textSecondary }}>
            {entry.note}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function FerryRestItem({ item, onPress, onDelete, transitRate, cabinRate }: { item: FerryRestRecord; onPress?: () => void; onDelete?: (id: string) => void; transitRate: number; cabinRate: number }) {
  const { t } = useI18n();
  const startTime = new Date(item.startTime);
  const endTime = item.endTime ? new Date(item.endTime) : (item as any).computedEnd ? new Date((item as any).computedEnd) : new Date(item.startTime);
  const startStr = `${String(startTime.getHours()).padStart(2, "0")}:${String(startTime.getMinutes()).padStart(2, "0")}`;
  const endStr = `${String(endTime.getHours()).padStart(2, "0")}:${String(endTime.getMinutes()).padStart(2, "0")}`;
  const dateStr = formatFecha(item.fecha);

  const isComplete = item.isComplete !== undefined ? item.isComplete : item.isValid;
  const sMs = new Date(item.startTime).getTime();
  const eMs = item.endTime ? new Date(item.endTime).getTime() : sMs;
  const totalElapsedMin = Math.round(Math.max(0, (eMs - sMs) / 60000));
  const intMs = (item.interruptions || []).reduce((sum: number, ii: any) => {
    const iStart = ii.start ? new Date(ii.start).getTime() : (ii.startMin != null ? sMs + ii.startMin * 60000 : 0);
    const iEnd = ii.end ? new Date(ii.end).getTime() : (ii.endMin != null ? sMs + ii.endMin * 60000 : eMs);
    return sum + Math.max(0, Math.min(iEnd, eMs) - Math.max(iStart, sMs));
  }, 0);
  const intTotalMin = Math.round(intMs / 60000);
  const effRestMin = item.accumulatedRestMin ?? Math.max(0, totalElapsedMin - intTotalMin);
  const requiredMin = item.restType === "9h" ? 540 : 660;
  let ferryStatusColor = Colors.light.success;
  let ferryStatusText = "";
  if (effRestMin >= requiredMin) {
    if (effRestMin >= 660) {
      ferryStatusText = t("ferry.finishModal.dailyComplete") || "Diario completo (≥11h)";
    } else {
      ferryStatusText = t("ferry.finishModal.dailyReduced") || "Diario reducido (≥9h <11h)";
    }
    ferryStatusColor = Colors.light.success;
  } else if (!isComplete && !item.endTime) {
    ferryStatusText = t("ferry.incompleteRest");
    ferryStatusColor = Colors.light.warning;
  } else {
    ferryStatusText = t("ferry.finishModal.insufficient") || "Insuficiente (<9h)";
    ferryStatusColor = Colors.light.danger;
  }
  const intCount = item.interruptions?.length || 0;

  const td = item.ferryExtras?.transitDiet || 0;
  const co = item.ferryExtras?.cabinOvernight || 0;
  const extrasAmount = (td * transitRate) + (co * cabinRate);

  return (
    <View style={[styles.card, { backgroundColor: "#e0f2fe", borderLeftWidth: 3, borderLeftColor: "#0284c7" }]}>
      <View style={styles.cardTop}>
        <View style={styles.cardDates}>
          <MaterialCommunityIcons name="ferry" size={16} color="#0284c7" />
          <Text style={[styles.dateText, { color: "#0284c7", fontFamily: "Inter_600SemiBold" }]}>
            {dateStr} {startStr} → {endStr}
          </Text>
        </View>
        <View style={styles.cardActions}>
          <Pressable
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onPress?.();
            }}
            hitSlop={8}
          >
            <Ionicons name="create-outline" size={18} color="#0284c7" />
          </Pressable>
          <Pressable
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              if (Platform.OS === "web") {
                if (window.confirm(t("ferry.confirmDelete"))) onDelete?.(item.id);
              } else {
                Alert.alert(t("common.delete"), t("ferry.confirmDelete"), [
                  { text: t("common.cancel"), style: "cancel" },
                  { text: t("common.delete"), style: "destructive", onPress: () => onDelete?.(item.id) },
                ]);
              }
            }}
            hitSlop={8}
          >
            <Ionicons name="trash-outline" size={18} color={Colors.light.danger} />
          </Pressable>
        </View>
      </View>

      <View style={styles.cardRoute}>
        <Text style={[styles.routeText, { color: "#0284c7", fontFamily: "Inter_600SemiBold" }]}>
          Descanso en Ferry · {item.restType}
        </Text>
        {item.destination ? (
          <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: "#0369a1", marginLeft: 4 }}>
            → {item.destination}
          </Text>
        ) : null}
      </View>

      {intCount > 0 && (
        <View style={{ paddingHorizontal: 14, paddingBottom: 4 }}>
          {(item.interruptions as any[]).map((int: any, idx: number) => {
            const isNew = "start" in int;
            const intStartStr = isNew ? new Date(int.start).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : `${int.startMin} min`;
            const intEndStr = isNew ? (int.end ? new Date(int.end).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "...") : `${int.endMin} min`;
            return (
              <Text key={idx} style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: "#0369a1" }}>
                Int. #{idx + 1}: {intStartStr} → {intEndStr}
              </Text>
            );
          })}
        </View>
      )}

      <View style={[styles.cardBottom, { flexWrap: "wrap" as const }]}>
        <View style={[styles.statusChip, { backgroundColor: ferryStatusColor + "18" }]}>
          <View style={[styles.statusDot, { backgroundColor: ferryStatusColor }]} />
          <Text style={[styles.chipLabel, { color: ferryStatusColor }]}>{ferryStatusText}</Text>
        </View>
        {td > 0 && (
          <View style={[styles.infoChip, { backgroundColor: "#0284c7" + "18" }]}>
            <Text style={[styles.chipLabel, { color: "#0284c7" }]}>Tránsito x{td}</Text>
          </View>
        )}
        {co > 0 && (
          <View style={[styles.infoChip, { backgroundColor: "#0284c7" + "18" }]}>
            <Ionicons name="bed-outline" size={11} color="#0284c7" />
            <Text style={[styles.chipLabel, { color: "#0284c7" }]}>Camarote x{co}</Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        {extrasAmount > 0 && (
          <Text style={[styles.dietaAmount, { color: "#0284c7" }]}>
            {extrasAmount.toFixed(2)} {"\u20AC"}
          </Text>
        )}
      </View>
    </View>
  );
}

function JornadaItem({
  item,
  onDelete,
  onEdit,
  viajes,
  billingMode,
}: {
  item: Jornada;
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
  viajes: Viaje[];
  billingMode: "dietas" | "km" | "viaje";
}) {
  const { t } = useI18n();
  const isCerrada = !!item.fechaFin;
  const status = getLegalStatus(item);
  const statusLabel = status.label === "Infraccion" ? t("dashboard.infraction") : status.label === "Advertencia" ? t("dashboard.warning") : status.label === "Legal" ? t("dashboard.legal") : status.label;
  const durMin = item.duracionJornadaMin || 0;
  const condMin = item.conduccionMin || Math.round(durMin * 0.65);
  const matchedViajes = findViajesForJornada(item, viajes);
  const pm = item.moroccoPaymentMode ? (item.paymentMode || "dietas") : billingMode;
  const kmTotal = item.kmTotal != null ? item.kmTotal : (item.kmInicio != null && item.kmFin != null ? (item.kmFin - item.kmInicio) : null);
  const kmRate = item.pricePerKm;
  const kmImporte = item.importeKm != null
    ? item.importeKm
    : (kmTotal != null && kmRate != null ? kmTotal * kmRate : null);
  const tripImporte = item.importeViaje != null ? item.importeViaje : (item.pricePerTrip != null ? item.pricePerTrip : null);
  const visibleDietTotal = (() => {
    if (pm === "km") return kmImporte != null && kmImporte > 0 ? kmImporte : 0;
    if (pm === "viaje") return tripImporte != null && tripImporte > 0 ? tripImporte : 0;
    const full = item.dietaImporteEur ? parseFloat(item.dietaImporteEur) : 0;
    const dayEx = item.dayExtraEur ? parseFloat(item.dayExtraEur) : 0;
    const base = full - dayEx;
    return base > 0 ? base : 0;
  })();

  // #region debug-point B:historial-render
  if (String(item.id || "").startsWith("pdf_")) {
    reportHistorialDietDebug("imported", item, visibleDietTotal, pm);
  } else if (visibleDietTotal > 0) {
    reportHistorialDietDebug("manual", item, visibleDietTotal, pm);
  }
  // #endregion

  // #region debug-point E:historial-date-render
  reportJornadaDateDebug(item, item.fechaInicio || "");
  // #endregion

  const tipoRutaKey: Record<string, string> = {
    NACIONAL: "common.nacional",
    INTERNACIONAL: "common.internacional",
    REGIONAL: "common.regional",
    REGIONAL_INTL: "common.regionalIntl",
    NAC_INTL: "common.nacIntl",
    NAC_REGIONAL: "common.nacRegional",
  };

  return (
    <View style={[styles.card, !isCerrada && styles.cardOpen]}>
      <View style={styles.cardTop}>
        <View style={styles.cardDates}>
          <Text style={styles.dateText}>
            {formatFecha(item.fechaInicio)} {item.horaInicio}
          </Text>
          {isCerrada && (
            <>
              <Ionicons name="arrow-forward" size={14} color={Colors.light.textSecondary} />
              <Text style={styles.dateText}>
                {formatFecha(item.fechaFin)} {item.horaFin}
              </Text>
            </>
          )}
          {!isCerrada && (
            <View style={styles.openBadge}>
              <Text style={styles.openBadgeText}>{t("historial.open")}</Text>
            </View>
          )}
        </View>
        <View style={styles.cardActions}>
          <Pressable
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onEdit(item.id);
            }}
            hitSlop={8}
          >
            <Ionicons name="create-outline" size={18} color={Colors.light.tint} />
          </Pressable>
          <Pressable
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              if (Platform.OS === "web") {
                const ok = window.confirm(t("historial.deleteQuestion"));
                if (ok) onDelete(item.id);
              } else {
                Alert.alert(t("common.delete"), t("historial.deleteQuestion"), [
                  { text: t("common.cancel"), style: "cancel" },
                  { text: t("common.delete"), style: "destructive", onPress: () => onDelete(item.id) },
                ]);
              }
            }}
            hitSlop={8}
          >
            <Ionicons name="trash-outline" size={18} color={Colors.light.danger} />
          </Pressable>
        </View>
      </View>

      <View style={styles.cardRoute}>
        <Ionicons name="location-outline" size={14} color={Colors.light.textSecondary} />
        <Text style={styles.routeText}>
          {item.lugarInicio}
          {item.lugarFin ? ` \u2192 ${item.lugarFin}` : ""}
        </Text>
      </View>

      {matchedViajes.length > 0 && (
        <View style={styles.viajesSection}>
          {matchedViajes.map((v) => {
            const places = v.paradas.map((p) => p.lugar).join(" \u2192 ");
            const firstTime = v.paradas.find((p) => p.llegadaReal)?.llegadaReal;
            return (
              <Pressable
                key={v.id}
                style={styles.viajeRow}
                onPress={() => router.push({ pathname: "/viaje-detalle", params: { id: v.id } })}
              >
                <View style={styles.viajeIconWrap}>
                  <Ionicons name="swap-horizontal" size={14} color={Colors.light.tint} />
                </View>
                <View style={styles.viajeInfo}>
                  <Text style={styles.viajeCliente} numberOfLines={1}>
                    {v.cliente || t("viajes.trip")}
                    {firstTime ? ` \u00B7 ${formatDateTimeShort(firstTime)}` : ""}
                  </Text>
                  <Text style={styles.viajePlaces} numberOfLines={1}>{places}</Text>
                </View>
                <View style={[styles.viajeEstadoBadge, { backgroundColor: v.estado === "EN_CURSO" ? Colors.light.tint + "18" : Colors.light.success + "18" }]}>
                  <Text style={[styles.viajeEstadoText, { color: v.estado === "EN_CURSO" ? Colors.light.tint : Colors.light.success }]}>
                    {v.estado === "EN_CURSO" ? t("viajes.inProgress") : t("viajes.completed")}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.light.textSecondary} />
              </Pressable>
            );
          })}
        </View>
      )}

      {(item as any).isDoubleDriving === true && (
        <View style={{ marginTop: 10, gap: 4 }}>
          <View style={[styles.infoChip, {
            alignSelf: "flex-start" as const,
            backgroundColor: Colors.light.accent + "18",
            paddingVertical: 4,
            paddingHorizontal: 10,
          }]}>
            <Ionicons name="people" size={11} color={Colors.light.accent} />
            <Text style={[styles.chipLabel, { color: Colors.light.accent, fontFamily: "Inter_600SemiBold" }]}>
              Doble conducción
            </Text>
          </View>
          {typeof (item as any).secondDriverName === "string" && (item as any).secondDriverName && (
            <Text style={{
              fontSize: 12,
              fontFamily: "Inter_400Regular",
              color: Colors.light.textSecondary,
              paddingLeft: 2,
            }}>
              Segundo conductor: {(item as any).secondDriverName}
            </Text>
          )}
        </View>
      )}

      {isCerrada && (
        <>
          <View style={styles.cardStats}>
            <View style={styles.statItem}>
              <Ionicons name="time-outline" size={13} color={Colors.light.textSecondary} />
              <Text style={styles.statText}>{formatMinutosHoras(durMin)}</Text>
            </View>
            <View style={styles.statItem}>
              <Ionicons name="car-outline" size={13} color={Colors.light.textSecondary} />
              <Text style={styles.statText}>{formatMinutosHoras(condMin)}</Text>
            </View>
            {pm === "km" && kmTotal != null && (
              <View style={styles.statItem}>
                <Ionicons name="speedometer-outline" size={13} color={Colors.light.textSecondary} />
                <Text style={styles.statText}>{kmTotal} km</Text>
              </View>
            )}
          </View>
          {item.legalSummary && (item.legalSummary.infractions.length > 0 || item.legalSummary.warnings.length > 0) && (
            <View style={styles.legalDetails}>
              {item.legalSummary.infractions.map((inf: any, i: number) => (
                <View key={`inf-${i}`} style={styles.legalDetailRow}>
                  <Ionicons name="alert-circle" size={12} color={getSeverityColor(inf.severity)} />
                  <Text style={[styles.legalDetailText, { color: getSeverityColor(inf.severity) }]} numberOfLines={2}>
                    {inf.description}
                  </Text>
                </View>
              ))}
              {item.legalSummary.warnings.map((w: any, i: number) => (
                <View key={`w-${i}`} style={styles.legalDetailRow}>
                  <Ionicons name="warning" size={12} color={Colors.light.warning} />
                  <Text style={[styles.legalDetailText, { color: Colors.light.warning }]} numberOfLines={2}>
                    {w.description}
                  </Text>
                </View>
              ))}
            </View>
          )}
          <View style={styles.cardBottom}>
            {item.moroccoPaymentMode === "morocco_trip" ? (
              <>
                <View style={[styles.infoChip, { backgroundColor: Colors.light.accent + "18" }]}>
                  <Ionicons name="airplane" size={11} color={Colors.light.accent} />
                  <Text style={[styles.chipLabel, { color: Colors.light.accent }]}>{t("morocco.diet.tripPayment")}</Text>
                </View>
                <View style={styles.infoChip}>
                  <Text style={styles.chipLabel}>{t((item.tipoRuta ? tipoRutaKey[item.tipoRuta as keyof typeof tipoRutaKey] : undefined) || "common.nacional")}</Text>
                </View>
              </>
            ) : item.moroccoPaymentMode === "morocco_pernight" ? (
              <>
                <View style={[styles.infoChip, { backgroundColor: Colors.light.accent + "18" }]}>
                  <Ionicons name="bed" size={11} color={Colors.light.accent} />
                  <Text style={[styles.chipLabel, { color: Colors.light.accent }]}>{t("onboarding.paymentPernight")}</Text>
                </View>
                <View style={styles.infoChip}>
                  <Text style={styles.chipLabel}>{t((item.tipoRuta ? tipoRutaKey[item.tipoRuta as keyof typeof tipoRutaKey] : undefined) || "common.nacional")}</Text>
                </View>
              </>
            ) : (
              <View style={styles.infoChip}>
                <Text style={styles.chipLabel}>{t((item.tipoRuta ? tipoRutaKey[item.tipoRuta as keyof typeof tipoRutaKey] : undefined) || "common.nacional")}</Text>
              </View>
            )}
            {pm === "km" && (
              <View style={[styles.infoChip, { backgroundColor: Colors.light.tint + "10" }]}>
                <Text style={[styles.chipLabel, { color: Colors.light.tint }]}>{t("usuario.paymentModeKm")}</Text>
              </View>
            )}
            {pm === "viaje" && (
              <View style={[styles.infoChip, { backgroundColor: Colors.light.tint + "10" }]}>
                <Text style={[styles.chipLabel, { color: Colors.light.tint }]}>{t("usuario.paymentModeTrip")}</Text>
              </View>
            )}
            {pm === "dietas" && item.moroccoPaymentMode !== "morocco_trip" && item.dietaPercent != null && item.dietaPercent > 0 && (
              <View style={[styles.infoChip, { backgroundColor: Colors.light.accentLight }]}>
                <Text style={[styles.chipLabel, { color: Colors.light.accent }]}>{item.dietaPercent}%</Text>
              </View>
            )}
            {item.pernocta && (
              <View style={[styles.infoChip, { backgroundColor: Colors.light.accentLight }]}>
                <Ionicons name="moon" size={11} color={Colors.light.accent} />
                <Text style={[styles.chipLabel, { color: Colors.light.accent }]}>{t("dashboard.pernocta")}</Text>
              </View>
            )}
            {item.dayFlag && item.dayExtraEur && parseFloat(item.dayExtraEur) > 0 && (
              <View style={[styles.infoChip, { backgroundColor: Colors.light.warning + "18" }]}>
                <Ionicons name="add-circle-outline" size={11} color={Colors.light.warning} />
                <Text style={[styles.chipLabel, { color: Colors.light.warning }]}>
                  {t(`common.dayFlag.${item.dayFlag}`)} +{item.dayExtraEur}\u20AC
                </Text>
              </View>
            )}
            <View style={[styles.statusChip, { backgroundColor: status.color + "18" }]}>
              <View style={[styles.statusDot, { backgroundColor: status.color }]} />
              <Text style={[styles.chipLabel, { color: status.color }]}>{statusLabel}</Text>
            </View>
            {item.dietCalculatedAt && (
              <View style={[styles.infoChip, { backgroundColor: Colors.light.tint + "10" }]}>
                <Ionicons name="lock-closed" size={10} color={Colors.light.tint} />
              </View>
            )}
            <View style={{ flex: 1 }} />
            <View style={{ alignItems: "flex-end" as const }}>
              <Text style={styles.dietaAmount}>
                {(() => {
                  if (pm === "km") {
                    return kmImporte != null && kmImporte > 0 ? `${kmImporte.toFixed(2)} \u20AC` : "";
                  }
                  if (pm === "viaje") {
                    return tripImporte != null && tripImporte > 0 ? `${tripImporte.toFixed(2)} \u20AC` : "";
                  }
                  const full = item.dietaImporteEur ? parseFloat(item.dietaImporteEur) : 0;
                  const dayEx = item.dayExtraEur ? parseFloat(item.dayExtraEur) : 0;
                  const base = full - dayEx;
                  return base > 0 ? `${base.toFixed(2)} \u20AC` : "";
                })()}
              </Text>
              {pm === "km" && kmTotal != null && kmRate != null && (
                <Text style={styles.cardExtrasAmount}>
                  {kmTotal} km \u00D7 {kmRate.toFixed(2)} \u20AC
                </Text>
              )}
              {pm === "viaje" && item.pricePerTrip != null && Number.isFinite(item.pricePerTrip) && item.pricePerTrip > 0 && (
                <Text style={styles.cardExtrasAmount}>
                  1 \u00D7 {item.pricePerTrip.toFixed(2)} \u20AC
                </Text>
              )}
              {(() => {
                const dayEx = item.dayExtraEur ? parseFloat(item.dayExtraEur) : 0;
                const plusTotal = item.plusItems ? item.plusItems.reduce((s, i) => s + i.importe, 0) : 0;
                const extrasTotal = dayEx + plusTotal;
                return extrasTotal > 0 ? (
                  <Text style={styles.cardExtrasAmount}>+{extrasTotal.toFixed(2)} \u20AC {t("historial.extras")}</Text>
                ) : null;
              })()}
            </View>
          </View>
          {item.plusItems && item.plusItems.length > 0 && (
            <View style={styles.plusSection}>
              {item.plusItems.map((pi, idx) => (
                <View key={idx} style={styles.plusRow}>
                  <Text style={styles.plusConcepto} numberOfLines={1}>{pi.concepto}</Text>
                  <Text style={styles.plusImporte}>{pi.importe.toFixed(2)} \u20AC</Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}

export default function HistorialScreen() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const qc = useQueryClient();
  const { triggerSync, triggerDeleteSync, triggerDeleteDayExtraEntrySync, syncVersion } = useSync();
  const { getPeriod } = usePeriod();
  const { user } = useAuth();
  const [periodoIdx, setPeriodoIdx] = useState(0);
  const [billingMode, setBillingMode] = useState<"dietas" | "km" | "viaje">("dietas");
  const [dayExtrasCfg, setDayExtrasCfg] = useState<UserDayExtras>({
    extra_saturday: 0,
    extra_sunday: 0,
    extra_holiday: 0,
    offsite_weekly_reduced_nacional: 0,
    offsite_weekly_reduced_internacional: 0,
    offsite_weekly_complete_nacional: 0,
    offsite_weekly_complete_internacional: 0,
  });
  const [pendingDietsVisible, setPendingDietsVisible] = useState(false);
  const [pendingDietsBannerVisible, setPendingDietsBannerVisible] = useState(false);
  const [pendingDiets, setPendingDiets] = useState<DetectedMissingNaturalDay[]>([]);
  const [pendingDietsSaving, setPendingDietsSaving] = useState(false);
  const [naturalDayDiets, setNaturalDayDiets] = useState<NaturalDayDietEntry[]>([]);
  const [arrivalSelectorVisible, setArrivalSelectorVisible] = useState(false);
  const [arrivalSelectorDay, setArrivalSelectorDay] = useState<Parameters<typeof ArrivalDayDietSelectorModal>[0]["day"]>(null);
  const [pendingConfirmedDiets, setPendingConfirmedDiets] = useState<DetectedDiet[]>([]);
  const [arrivalSelectorQueue, setArrivalSelectorQueue] = useState<DetectedDiet[]>([]);
  // NDDE Modo edición: abrir PendingNaturalDietsModal en editMode con 1 fila
  const [nddEditItem, setNddEditItem] = useState<NaturalDayDietEntry | null>(null);
  const [nddEditVisible, setNddEditVisible] = useState(false);

  const periodo = useMemo(() => {
    return getPeriod(periodoIdx);
  }, [periodoIdx, getPeriod]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          const raw = await AsyncStorage.getItem(await userScopedKey("tacoplan_user_settings", user?.id));
          if (!active) return;
          if (raw) {
            const s = JSON.parse(raw);
            if (s.payment_mode === "km" || s.payment_mode === "viaje" || s.payment_mode === "dietas") {
              setBillingMode(s.payment_mode);
            }
            const pf = (v: any, fb: number) => {
              const n = parseFloat(String(v ?? "").replace(",", "."));
              return Number.isFinite(n) ? n : fb;
            };
            setDayExtrasCfg((prev) => ({
              extra_saturday: pf(s.extra_saturday, prev.extra_saturday),
              extra_sunday: pf(s.extra_sunday, prev.extra_sunday),
              extra_holiday: pf(s.extra_holiday, prev.extra_holiday),
              offsite_weekly_reduced_nacional: pf(s.offsite_weekly_reduced_nacional, prev.offsite_weekly_reduced_nacional),
              offsite_weekly_reduced_internacional: pf(s.offsite_weekly_reduced_internacional, prev.offsite_weekly_reduced_internacional),
              offsite_weekly_complete_nacional: pf(s.offsite_weekly_complete_nacional, prev.offsite_weekly_complete_nacional),
              offsite_weekly_complete_internacional: pf(s.offsite_weekly_complete_internacional, prev.offsite_weekly_complete_internacional),
            }));
          }
        } catch {}
      })();
      return () => {
        active = false;
      };
    }, [user?.id])
  );

  const jornadasQuery = useQuery<Jornada[]>({
    queryKey: ["jornadas", periodo.from, periodo.to, syncVersion],
    queryFn: () => listarJornadas(periodo.from, periodo.to),
  });

  const compsQuery = useQuery<Compensacion[]>({
    queryKey: ["compensaciones", syncVersion],
    queryFn: () => listarCompensaciones(),
  });

  const viajesQuery = useQuery<Viaje[]>({
    queryKey: ["all-viajes", syncVersion],
    queryFn: () => getAllViajes(),
  });

  const allViajes = viajesQuery.data || [];

  const { config: ferryConfig } = useFerry();
  const fTransitRate = ferryConfig.ferryTransitRate ?? 54.30;
  const fCabinRate = ferryConfig.ferryCabinRate ?? 54.30;

  const ferryRestsQuery = useQuery<FerryRestRecord[]>({
    queryKey: ["ferry-rests", syncVersion],
    queryFn: () => getAllFerryRests(),
  });
  const allFerryRests = ferryRestsQuery.data || [];

  const extraDaysQuery = useQuery<DayExtraEntry[]>({
    queryKey: ["day-extra-entries", periodo.from, periodo.to, syncVersion],
    queryFn: () => listDayExtraEntries(periodo.from, periodo.to),
  });
  const extraDaysSplit = useMemo(() => {
    const list = extraDaysQuery.data || [];
    let offsiteBase = 0;
    let offsitePlus = 0;
    let otherExtras = 0;
    for (const e of list) {
      if (e.entryType === "offsite_weekly_rest") {
        const split = splitOffsiteWeeklyRestEntry(e, dayExtrasCfg);
        offsiteBase = Math.round((offsiteBase + (split.restAmount || 0)) * 100) / 100;
        offsitePlus = Math.round((offsitePlus + (split.plusAmount || 0)) * 100) / 100;
        continue;
      }
      if (e.dayFlag) {
        const amt = e.amount != null ? Number(e.amount) : calcDayExtra(e.dayFlag, dayExtrasCfg);
        if (Number.isFinite(amt) && amt > 0) otherExtras = Math.round((otherExtras + amt) * 100) / 100;
      }
    }
    return {
      offsiteBase,
      offsitePlus,
      otherExtras,
      totalExtras: Math.round((offsitePlus + otherExtras) * 100) / 100,
    };
  }, [extraDaysQuery.data, dayExtrasCfg]);
  const ferryRests = useMemo(() => allFerryRests.filter((fr) => {
    if (!fr.fecha) return false;
    return fr.fecha >= periodo.from && fr.fecha <= periodo.to;
  }), [allFerryRests, periodo.from, periodo.to]);

  const activeFerryQuery = useQuery<ActiveFerryRest | null>({
    queryKey: ["active-ferry-rest", syncVersion],
    queryFn: () => getActiveFerryRest(),
  });
  const activeFerry = activeFerryQuery.data ?? null;

  const refreshNaturalDayDiets = useCallback(async () => {
    const nats = await getAllNaturalDayDiets();
    setNaturalDayDiets(nats);
    const det = await detectMissingOutOfBaseDietDays({
      fromDate: periodo.from,
      toDate: periodo.to,
    });
    if (det.length > 0) {
      setPendingDiets(det);
      setPendingDietsBannerVisible(true);
    } else {
      setPendingDiets([]);
      setPendingDietsBannerVisible(false);
    }
  }, [periodo.from, periodo.to]);

  useEffect(() => {
    refreshNaturalDayDiets();
  }, [refreshNaturalDayDiets, syncVersion, periodo.from, periodo.to]);

  const [editFerry, setEditFerry] = useState<FerryRestRecord | null>(null);
  const [editFerryStartTime, setEditFerryStartTime] = useState("");
  const [editFerryEndTime, setEditFerryEndTime] = useState("");
  const [editFerryRestType, setEditFerryRestType] = useState<"9h" | "11h">("9h");
  const [editFerryDest, setEditFerryDest] = useState("");
  const [editFerryTransit, setEditFerryTransit] = useState(0);
  const [editFerryCabin, setEditFerryCabin] = useState(0);

  const [editingFerryJornada, setEditingFerryJornada] = useState<Jornada | null>(null);
  const [editFjDest, setEditFjDest] = useState("");
  const [editFjRestType, setEditFjRestType] = useState<"9h" | "11h">("11h");
  const [editFjTransit, setEditFjTransit] = useState(0);
  const [editFjCabin, setEditFjCabin] = useState(0);

  const [editOffsite, setEditOffsite] = useState<DayExtraEntry | null>(null);
  const [editOffsiteDate, setEditOffsiteDate] = useState("");
  const [editOffsiteDateInput, setEditOffsiteDateInput] = useState("");
  const [editOffsiteRestType, setEditOffsiteRestType] = useState<"WEEKLY_REDUCED" | "WEEKLY_COMPLETE">("WEEKLY_COMPLETE");
  const [editOffsiteBase, setEditOffsiteBase] = useState<"NACIONAL" | "INTERNACIONAL">("NACIONAL");
  const [editOffsitePlusSunday, setEditOffsitePlusSunday] = useState(false);
  const [editOffsitePlusHoliday, setEditOffsitePlusHoliday] = useState(false);
  const [editOffsiteAmount, setEditOffsiteAmount] = useState("");
  const [editOffsiteNote, setEditOffsiteNote] = useState("");

  useEffect(() => {
    if (editingFerryJornada) {
      setEditFjDest(editingFerryJornada.ferryDestination || "");
      setEditFjRestType(editingFerryJornada.ferryRestType || "11h");
      setEditFjTransit(editingFerryJornada.ferryExtras?.transitDiet || 0);
      setEditFjCabin(editingFerryJornada.ferryExtras?.cabinOvernight || 0);
    }
  }, [editingFerryJornada]);

  useEffect(() => {
    if (!editOffsite) return;
    const split = splitOffsiteWeeklyRestEntry(editOffsite, dayExtrasCfg);
    setEditOffsiteDate(editOffsite.date);
    setEditOffsiteDateInput(formatDateForDisplay(editOffsite.date));
    setEditOffsiteRestType((editOffsite.offsiteRestType as any) === "WEEKLY_REDUCED" ? "WEEKLY_REDUCED" : "WEEKLY_COMPLETE");
    setEditOffsiteBase((editOffsite.offsiteBase as any) === "INTERNACIONAL" ? "INTERNACIONAL" : "NACIONAL");
    setEditOffsitePlusSunday(!!editOffsite.plusSunday);
    setEditOffsitePlusHoliday(!!editOffsite.plusHoliday);
    setEditOffsiteAmount((Number.isFinite(split.restAmount) ? split.restAmount : 0).toFixed(2));
    setEditOffsiteNote(editOffsite.note || "");
  }, [editOffsite, dayExtrasCfg]);

  const saveFerryJornadaEdit = useMutation({
    mutationFn: async () => {
      if (!editingFerryJornada) return;
      await updateJornadaFerryData(editingFerryJornada.id, {
        ferryDestination: editFjDest || undefined,
        ferryRestType: editFjRestType,
        ferryExtras: {
          transitDiet: editFjTransit,
          cabinOvernight: editFjCabin,
          countryChange: editingFerryJornada.ferryExtras?.countryChange || false,
        },
      });
    },
    onSuccess: () => {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditingFerryJornada(null);
      qc.invalidateQueries({ queryKey: ["jornadas"] });
    },
    onError: (e: Error) => Alert.alert(t("common.error"), e.message),
  });

  const openFerryEdit = useCallback((item: FerryRestRecord) => {
    const st = new Date(item.startTime);
    const et = item.endTime ? new Date(item.endTime) : (item as any).computedEnd ? new Date((item as any).computedEnd) : null;
    setEditFerry(item);
    setEditFerryStartTime(`${String(st.getHours()).padStart(2, "0")}:${String(st.getMinutes()).padStart(2, "0")}`);
    setEditFerryEndTime(et ? `${String(et.getHours()).padStart(2, "0")}:${String(et.getMinutes()).padStart(2, "0")}` : "");
    setEditFerryRestType(item.restType);
    setEditFerryDest(item.destination || "");
    setEditFerryTransit(item.ferryExtras?.transitDiet || 0);
    setEditFerryCabin(item.ferryExtras?.cabinOvernight || 0);
  }, []);

  const compMap = useMemo(() => {
    const map = new Map<string, Compensacion>();
    if (compsQuery.data) {
      for (const c of compsQuery.data) {
        if (c.jornadaId) map.set(c.jornadaId, c);
      }
    }
    return map;
  }, [compsQuery.data]);

  const jornadasData = jornadasQuery.data || [];

  type ListItem =
    | { type: "jornada"; jornada: Jornada }
    | { type: "rest-gap"; restMin: number; afterJornadaId: string; compensacion?: Compensacion; isFerryRest?: boolean; ferryJornada?: Jornada; restJornada?: Jornada; previousRestSourceJornada?: Jornada }
    | { type: "ferry-rest"; ferryRest: FerryRestRecord }
    | { type: "active-ferry"; activeFerry: ActiveFerryRest }
    | { type: "offsite-weekly-rest"; entry: DayExtraEntry }
    | { type: "natural_day_diet"; naturalDayDiet: NaturalDayDietEntry };

  const listItems = useMemo<ListItem[]>(() => {
    const sorted = [...jornadasData];

    const allEvents: Array<{ ts: number; item: ListItem }> = [];

    for (const j of sorted) {
      const ts = j.startAt ? new Date(j.startAt).getTime() : j.endAt ? new Date(j.endAt).getTime() : 0;
      allEvents.push({ ts, item: { type: "jornada", jornada: j } });
    }

    const filteredNDDs = naturalDayDiets.filter((ndd) => {
      if (!ndd.confirmedByUser) return false;
      if (ndd.dismissedAt) return false;
      if (ndd.date < periodo.from || ndd.date > periodo.to) return false;
      return true;
    });
    for (const ndd of filteredNDDs) {
      const ts = new Date(`${ndd.date}T23:59:59`).getTime();
      allEvents.push({ ts, item: { type: "natural_day_diet", naturalDayDiet: ndd } });
    }

    const offsiteEntries = (extraDaysQuery.data || []).filter((e) => e.entryType === "offsite_weekly_rest");
    for (const e of offsiteEntries) {
      const ts = new Date(`${e.date}T23:59:58`).getTime();
      allEvents.push({ ts, item: { type: "offsite-weekly-rest", entry: e } });
    }

    const linkedJornadaIds = new Set(ferryRests.map((fr) => fr.linkedJornadaId).filter(Boolean));

    for (const fr of ferryRests) {
      const ts = new Date(fr.startTime).getTime() + 1;
      allEvents.push({ ts, item: { type: "ferry-rest", ferryRest: fr } });
    }

    for (const j of sorted) {
      if (linkedJornadaIds.has(j.id)) continue;
      if (j.ferryPending && !j.ferryRestCompleted) continue;
      const hasFerryData = j.ferryRestCompleted || (j.ferryExtras && ((j.ferryExtras.transitDiet || 0) > 0 || (j.ferryExtras.cabinOvernight || 0) > 0 || j.ferryExtras.countryChange));
      if (hasFerryData) {
        const endAt = j.endAt || j.startAt || j.fechaInicio;
        const syntheticRecord: FerryRestRecord = {
          id: `synth-${j.id}`,
          fecha: j.fechaFin || j.fechaInicio,
          startTime: endAt,
          endTime: new Date(new Date(endAt).getTime() + ((j.ferryRestType === "11h" ? 660 : 540) * 60000)).toISOString(),
          restType: (j.ferryRestType as "9h" | "11h") || "9h",
          interruptions: j.ferryInterruptions || [],
          interruptionTotalMin: getFerryInterruptionsTotalMin(j.ferryInterruptions || []),
          linkedJornadaId: j.id,
          isValid: true,
          isComplete: true,
          invalidReason: null,
          createdAt: (j as any).updatedAt || (j as any).createdAt || new Date().toISOString(),
          destination: j.ferryDestination || undefined,
          ferryExtras: j.ferryExtras || undefined,
        };
        const ts = new Date(endAt).getTime() + 1;
        allEvents.push({ ts, item: { type: "ferry-rest", ferryRest: syntheticRecord } });
      }
    }

    if (activeFerry) {
      const ts = new Date(activeFerry.startTime).getTime();
      allEvents.push({ ts, item: { type: "active-ferry", activeFerry } });
    }

    allEvents.sort((a, b) => b.ts - a.ts);

    const items: ListItem[] = [];
    for (let i = 0; i < allEvents.length; i++) {
      const ev = allEvents[i];
      items.push(ev.item);

      if (ev.item.type === "jornada") {
        const current = ev.item.jornada;
        let previousJornadaForRest: Jornada | null = null;
        for (let j = i + 1; j < allEvents.length; j++) {
          if (allEvents[j].item.type === "jornada") {
            previousJornadaForRest = (allEvents[j].item as any).jornada;
            break;
          }
        }
        if (!current.fechaFin && current.descansoAnteriorMin && current.descansoAnteriorMin > 0) {
          items.push({
            type: "rest-gap",
            restMin: current.descansoAnteriorMin,
            afterJornadaId: `open-${current.id}`,
            compensacion: compMap.get(current.id),
            restJornada: current,
            previousRestSourceJornada: previousJornadaForRest ?? undefined,
          });
        } else if (current.fechaFin) {
          const nextJornada = previousJornadaForRest;
          if (nextJornada && current.startAt && nextJornada.endAt) {
            const currentStart = new Date(current.startAt).getTime();
            const nextEnd = new Date(nextJornada.endAt).getTime();
            const gapMs = currentStart - nextEnd;
            if (gapMs > 0) {
              const isFromFerry = current.previousRestSource === "ferry_rest" && current.previousRestValid === true;
              const gapMin = isFromFerry && current.descansoAnteriorMin != null
                ? current.descansoAnteriorMin
                : Math.round(gapMs / 60000);
              items.push({
                type: "rest-gap",
                restMin: gapMin,
                afterJornadaId: current.id,
                compensacion: compMap.get(current.id),
                isFerryRest: isFromFerry,
                ferryJornada: isFromFerry && nextJornada ? nextJornada : undefined,
                restJornada: current,
                previousRestSourceJornada: nextJornada,
              });
            }
          }
        }
      }
    }

    return items;
  }, [jornadasData, compMap, ferryRests, activeFerry, extraDaysQuery.data, naturalDayDiets, periodo.from, periodo.to]);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await eliminarJornada(id);
      return id;
    },
    onSuccess: (id: string) => {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ["jornadas"] });
      qc.invalidateQueries({ queryKey: ["estado-legal"] });
      qc.invalidateQueries({ queryKey: ["compensaciones"] });
      triggerDeleteSync(id);
    },
  });

  const deleteDayExtraMutation = useMutation({
    mutationFn: async (id: string) => {
      await deleteDayExtraEntry(id);
      return id;
    },
    onSuccess: (id: string) => {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      qc.invalidateQueries({ queryKey: ["day-extra-entries"] });
      qc.invalidateQueries({ queryKey: ["dietas-resumen"] });
      qc.invalidateQueries({ queryKey: ["km-resumen"] });
      qc.invalidateQueries({ queryKey: ["viaje-resumen"] });
      qc.invalidateQueries({ queryKey: ["offsite-weekly-rest-dates"] });
      triggerDeleteDayExtraEntrySync(id);
    },
    onError: (e: Error) => Alert.alert(t("common.error"), e.message),
  });

  const updateOffsiteMutation = useMutation({
    mutationFn: async () => {
      if (!editOffsite) return null;
      const isoDate = editOffsiteDate;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new Error("Fecha inválida");
      const amtRaw = editOffsiteAmount.trim().replace(",", ".");
      const amt = amtRaw ? parseFloat(amtRaw) : 0;
      if (!Number.isFinite(amt) || amt < 0) throw new Error("Importe inválido");
      const updated = await updateDayExtraEntry(editOffsite.id, {
        date: isoDate,
        restType: editOffsiteRestType,
        base: editOffsiteBase,
        plusSunday: editOffsitePlusSunday,
        plusHoliday: editOffsitePlusHoliday,
        amount: Math.round(amt * 100) / 100,
        note: editOffsiteNote.trim() || null,
      });
      return updated;
    },
    onSuccess: () => {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditOffsite(null);
      qc.invalidateQueries({ queryKey: ["day-extra-entries"] });
      qc.invalidateQueries({ queryKey: ["dietas-resumen"] });
      qc.invalidateQueries({ queryKey: ["km-resumen"] });
      qc.invalidateQueries({ queryKey: ["viaje-resumen"] });
      qc.invalidateQueries({ queryKey: ["offsite-weekly-rest-dates"] });
      triggerSync();
    },
    onError: (e: Error) => Alert.alert(t("common.error"), e.message),
  });

  const upsertAllPendingSelections = useCallback(async (
    items: DetectedDiet[],
  ) => {
    const nowIso = new Date().toISOString();
    const entries: NaturalDayDietEntry[] = [];
    const dismissDates: string[] = [];
    for (const item of items) {
      if (!item?.date) continue;
      if (item.removed === true) {
        dismissDates.push(item.date);
        continue;
      }
      const finalPct = item.userPercentage != null && item.userPercentage !== ("SIN_DIETA" as any)
        ? (item.userPercentage as 100 | 60 | 30)
        : null;
      if (item.isBaseArrivalDay && finalPct == null) {
        dismissDates.push(item.date);
        continue;
      }
      const effectivePct: 100 | 60 | 30 = finalPct ?? item.percentage;
      const effectiveAmount = Number.isFinite(Number(item.userAmount)) && item.userAmount != null
        ? Number(item.userAmount)
        : Number.isFinite(Number(item.amount)) ? Number(item.amount) : 0;
      let t: "INTERNACIONAL" | "NACIONAL" | "REGIONAL" = "NACIONAL";
      const rawType = item.type;
      if (rawType === "INTERNACIONAL" || rawType === "NACIONAL" || rawType === "REGIONAL") t = rawType;
      const plusItems = Array.isArray(item.plusItems)
        ? item.plusItems
            .filter((pl) => pl && (pl.selected !== false))
            .map((pl) => ({
              id: pl.id,
              concepto: pl.concepto,
              amount: Number.isFinite(Number(pl.amount)) ? Number(pl.amount) : 0,
            }))
        : undefined;
      entries.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 9) + `_${item.date}`,
        date: item.date,
        type: t,
        percentage: effectivePct,
        amount: effectiveAmount,
        location: typeof item?.location === "string" ? item.location : (item?.location ?? null),
        source: "NATURAL_DAY_OUT_OF_BASE" as const,
        previousJourneyId: typeof item?.previousJourneyId === "string" ? item.previousJourneyId : (item?.previousJourneyId ?? null),
        nextJourneyId: typeof item?.nextJourneyId === "string" ? item.nextJourneyId : (item?.nextJourneyId ?? null),
        confirmedByUser: true,
        dismissedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
        syncStatus: "pending" as const,
        plusItems: plusItems && plusItems.length > 0 ? plusItems : null,
      });
      dismissDates.push(item.date);
    }
    if (entries.length > 0) {
      await upsertNaturalDayDiets(entries);
    }
    if (dismissDates.length > 0) {
      await dismissNaturalDayDiets(Array.from(new Set(dismissDates)));
    }
    setPendingDietsVisible(false);
    setArrivalSelectorVisible(false);
    setArrivalSelectorDay(null);
    setArrivalSelectorQueue([]);
    setPendingConfirmedDiets([]);
    qc.invalidateQueries({ queryKey: ["dietas-resumen"] }).catch(() => {});
    qc.invalidateQueries({ queryKey: ["km-resumen"] }).catch(() => {});
    qc.invalidateQueries({ queryKey: ["viaje-resumen"] }).catch(() => {});
    await refreshNaturalDayDiets();
  }, [qc, refreshNaturalDayDiets]);

  const handleConfirmPendingDiets = useCallback(
    async (items: DetectedDiet[] | string[]) => {
      try {
        setPendingDietsSaving(true);
        const richer: DetectedDiet[] = Array.isArray(items) && items.length > 0 && typeof (items[0] as any) === "object" && (items[0] as DetectedDiet)?.date
          ? (items as DetectedDiet[])
          : (items as string[])
              .map((d) => {
                const date = typeof d === "string" ? d : (d as any)?.date;
                if (!date) return null;
                const src = pendingDiets.find((p) => p.date === date);
                if (!src) return null;
                return src as unknown as DetectedDiet;
              })
              .filter((v): v is DetectedDiet => !!v);

        setPendingConfirmedDiets(richer);

        const arrivalsPending = richer.filter((r) =>
          r.isBaseArrivalDay === true && r.userPercentage == null
        );

        if (arrivalsPending.length === 0) {
          await upsertAllPendingSelections(richer);
          return;
        }

        setArrivalSelectorQueue(arrivalsPending);
        setPendingDietsSaving(false);

        const first = arrivalsPending[0];
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
        setPendingDietsSaving(false);
      }
    },
    [pendingDiets, t, upsertAllPendingSelections],
  );

  const handleArrivalChoiceConfirm = useCallback(async (choice: { percentage: 100|60|30|null; amount: number }) => {
    try {
      setPendingDietsSaving(true);
      const queue = arrivalSelectorQueue.slice();
      const current = queue.shift();

      const updatedRicher = pendingConfirmedDiets.slice();
      if (current) {
        const idx = updatedRicher.findIndex((r) => r.date === current.date);
        if (idx >= 0) {
          updatedRicher[idx] = {
            ...updatedRicher[idx],
            userPercentage: choice.percentage as any,
            userAmount: choice.amount,
          };
        } else {
          updatedRicher.push({
            ...current,
            userPercentage: choice.percentage as any,
            userAmount: choice.amount,
          });
        }
        setPendingConfirmedDiets(updatedRicher);
      }

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

      await upsertAllPendingSelections(updatedRicher);
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message || String(e));
    } finally {
      setPendingDietsSaving(false);
    }
  }, [arrivalSelectorQueue, pendingConfirmedDiets, t, upsertAllPendingSelections]);

  const handleArrivalChoiceClose = useCallback(async () => {
    setArrivalSelectorVisible(false);
    setArrivalSelectorDay(null);
    setArrivalSelectorQueue([]);
    setPendingConfirmedDiets([]);
    setPendingDietsSaving(false);
    try {
      await dismissNaturalDayDiets(pendingDiets.map((d) => d.date));
      setPendingDietsVisible(false);
      setPendingDietsBannerVisible(false);
      setPendingDiets([]);
    } catch {}
  }, [pendingDiets, t]);

  const handleCancelPendingDiets = useCallback(async () => {
    try {
      await dismissNaturalDayDiets(pendingDiets.map((d) => d.date));
    } catch {}
    setPendingDietsVisible(false);
    setPendingDietsBannerVisible(false);
    setPendingDiets([]);
    setArrivalSelectorVisible(false);
    setArrivalSelectorDay(null);
    setArrivalSelectorQueue([]);
    setPendingConfirmedDiets([]);
  }, [pendingDiets, t]);

  const totalKm = billingMode === "km" ? jornadasData.reduce((acc, j) => {
    const km = j.kmTotal != null ? j.kmTotal : (j.kmInicio != null && j.kmFin != null ? (j.kmFin - j.kmInicio) : 0);
    return acc + (Number.isFinite(km) ? km : 0);
  }, 0) : 0;
  const naturalDayDietsTotal = useMemo(() => {
    return naturalDayDiets.reduce((acc, ndd) => {
      if (!ndd.confirmedByUser || ndd.dismissedAt) return acc;
      if (ndd.date < periodo.from || ndd.date > periodo.to) return acc;
      return acc + (Number.isFinite(ndd.amount) ? ndd.amount : 0);
    }, 0);
  }, [naturalDayDiets, periodo.from, periodo.to]);

  const totalBaseBilling = jornadasData.reduce((acc, j) => {
    if (billingMode === "km") {
      const kmTotal = j.kmTotal != null ? j.kmTotal : (j.kmInicio != null && j.kmFin != null ? (j.kmFin - j.kmInicio) : null);
      const importeKm = j.importeKm != null ? j.importeKm : (kmTotal != null && j.pricePerKm != null ? kmTotal * j.pricePerKm : 0);
      return acc + (Number.isFinite(importeKm) ? importeKm : 0);
    }
    if (billingMode === "viaje") {
      const importeViaje = j.importeViaje != null ? j.importeViaje : (j.pricePerTrip != null ? j.pricePerTrip : 0);
      return acc + (Number.isFinite(importeViaje) ? importeViaje : 0);
    }
    if (!j.dietaImporteEur) return acc;
    const dietaFull = parseFloat(j.dietaImporteEur);
    const dayExtra = j.dayExtraEur ? parseFloat(j.dayExtraEur) : 0;
    const base = dietaFull - dayExtra;
    return acc + (Number.isFinite(base) ? base : 0);
  }, 0) + (extraDaysSplit.offsiteBase || 0) + naturalDayDietsTotal;
  const totalExtras = jornadasData.reduce((acc, j) => {
    const dayExtra = j.dayExtraEur ? parseFloat(j.dayExtraEur) : 0;
    const plus = j.plusItems ? j.plusItems.reduce((s, i) => s + i.importe, 0) : 0;
    return acc + dayExtra + plus;
  }, 0) + (extraDaysSplit.totalExtras || 0);
  const totalFerryExtras = useMemo(() => {
    let total = 0;
    const linkedJornadaIds = new Set<string>();
    for (const fr of ferryRests) {
      if (fr.linkedJornadaId) linkedJornadaIds.add(fr.linkedJornadaId);
      if (!fr.ferryExtras) continue;
      const td = Number(fr.ferryExtras.transitDiet) || 0;
      const co = Number(fr.ferryExtras.cabinOvernight) || 0;
      if (td > 0) total += td * fTransitRate;
      if (co > 0) total += co * fCabinRate;
    }
    for (const j of jornadasData) {
      if (!j.ferryExtras || linkedJornadaIds.has(j.id)) continue;
      const td = Number(j.ferryExtras.transitDiet) || 0;
      const co = Number(j.ferryExtras.cabinOvernight) || 0;
      if (td > 0) total += td * fTransitRate;
      if (co > 0) total += co * fCabinRate;
    }
    return total;
  }, [ferryRests, jornadasData, fTransitRate, fCabinRate]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t("historial.title")}</Text>
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
                await refreshNaturalDayDiets();
              } catch {}
            }}
            hitSlop={8}
            style={({ pressed }) => [
              styles.reportBtn,
              {
                backgroundColor: "#fff",
                borderWidth: 1,
                borderColor: Colors.light.tint,
                opacity: pressed ? 0.9 : 1,
              },
            ]}
          >
            <Ionicons name="refresh-outline" size={16} color={Colors.light.tint} />
            <Text style={{ color: Colors.light.tint, fontSize: 13, fontWeight: "600", marginLeft: 4 }}>
              Re-evaluar dietas
            </Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/exportar")}
            style={({ pressed }) => [styles.reportBtn, { opacity: pressed ? 0.9 : 1 }]}
            hitSlop={8}
          >
            <Ionicons name="document-text-outline" size={16} color="#fff" />
            <Text style={styles.reportBtnText}>{t("Generar informe")}</Text>
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

      {(jornadasData.length > 0 || ferryRests.length > 0) && (
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>
            {jornadasData.length} {t("historial.journeys")}
            {ferryRests.length > 0 ? ` · ${ferryRests.length} ferry` : ""}
          </Text>
          <View style={{ alignItems: "flex-end" as const }}>
            <Text style={styles.summaryValue}>{(totalBaseBilling + totalFerryExtras).toFixed(2)} \u20AC</Text>
            {totalExtras > 0 && (
              <Text style={styles.summaryExtras}>+{totalExtras.toFixed(2)} \u20AC {t("historial.extras")}</Text>
            )}
            {totalFerryExtras > 0 && (
              <Text style={[styles.summaryExtras, { color: "#0284c7" }]}>
                {totalFerryExtras.toFixed(2)} \u20AC ferry
              </Text>
            )}
            {totalKm > 0 && (
              <Text style={styles.summaryExtras}>{totalKm} km</Text>
            )}
          </View>
        </View>
      )}

      {pendingDietsBannerVisible && pendingDiets.length > 0 && (
        <View
          style={{
            backgroundColor: "#FEF3C7",
            borderWidth: 1,
            borderColor: Colors.light.tint,
            opacity: 0.3,
            borderRadius: 12,
            padding: 14,
            marginHorizontal: 16,
            marginBottom: 10,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Ionicons name="warning-outline" size={22} color={Colors.light.tint} />
            <Text
              style={{
                fontSize: 16,
                fontWeight: "bold",
                color: Colors.light.tint,
                marginLeft: 8,
              }}
            >
              Dietas pendientes detectadas
            </Text>
          </View>
          <Text
            style={{
              fontSize: 14,
              color: Colors.light.text,
              opacity: 0.8,
              marginTop: 6,
            }}
          >
            Hay {pendingDiets.length} días fuera de base sin dieta registrada.
          </Text>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Pressable
              onPress={async () => {
                try {
                  const fresh = await detectMissingOutOfBaseDietDays({
                    fromDate: periodo.from,
                    toDate: periodo.to,
                  });
                  setPendingDiets(fresh);
                  setPendingDietsBannerVisible(false);
                  if (fresh && fresh.length > 0) {
                    setPendingDietsVisible(true);
                  }
                } catch {
                  setPendingDietsBannerVisible(false);
                  if (pendingDiets.length > 0) setPendingDietsVisible(true);
                }
              }}
              style={{
                backgroundColor: Colors.light.tint,
                paddingVertical: 8,
                paddingHorizontal: 16,
                borderRadius: 8,
                flexShrink: 0,
              }}
            >
              <Text style={{ color: "#fff", fontSize: 14, fontWeight: "600" }}>Revisar</Text>
            </Pressable>
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
                  }
                  setPendingDietsBannerVisible(fresh.length > 0);
                } catch {}
              }}
              style={{
                backgroundColor: "#fff",
                borderWidth: 1,
                borderColor: Colors.light.tint,
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 8,
                maxWidth: "100%",
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
                    flexWrap: "wrap",
                  }}
                  numberOfLines={2}
                >
                  Re-evaluar (olvidar cancelados)
                </Text>
              </View>
            </Pressable>
          </View>
        </View>
      )}

      {jornadasQuery.isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.light.tint} />
        </View>
      ) : (
        <FlatList
          data={listItems}
          keyExtractor={(item) => {
            if (item.type === "jornada") return "j_" + item.jornada.id;
            if (item.type === "ferry-rest") return `ferry-${item.ferryRest.id}`;
            if (item.type === "active-ferry") return "active-ferry";
            if (item.type === "offsite-weekly-rest") return `offsite-${item.entry.id}`;
            if (item.type === "natural_day_diet") return "ndd_" + item.naturalDayDiet.id;
            return `rest-${item.afterJornadaId}`;
          }}
          renderItem={({ item: listItem }) => {
            if (listItem.type === "rest-gap") {
              return (
                <RestGapItem
                  restMin={listItem.restMin}
                  compensacion={listItem.compensacion}
                  isFerryRest={listItem.isFerryRest}
                  ferryJornada={listItem.ferryJornada}
                  restJornada={listItem.restJornada}
                previousRestSourceJornada={listItem.previousRestSourceJornada}
                  onEditFerryJornada={(j) => setEditingFerryJornada(j)}
                />
              );
            }
            if (listItem.type === "active-ferry") {
              return <ActiveFerryItem item={listItem.activeFerry} />;
            }
            if (listItem.type === "ferry-rest") {
              const isSynthetic = listItem.ferryRest.id.startsWith("synth-");
              return (
                <FerryRestItem
                  item={listItem.ferryRest}
                  onPress={() => openFerryEdit(listItem.ferryRest)}
                  onDelete={(id) => {
                    const doDelete = async () => {
                      if (isSynthetic) {
                        const jornadaId = id.replace("synth-", "");
                        await updateJornadaFerryData(jornadaId, {
                          ferryExtras: { transitDiet: 0, cabinOvernight: 0, countryChange: false },
                          ferryRestCompleted: false,
                        });
                        qc.invalidateQueries({ queryKey: ["jornadas"] });
                      } else {
                        await deleteFerryRest(id);
                        qc.invalidateQueries({ queryKey: ["ferry-rests"] });
                      }
                      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                    };
                    doDelete();
                  }}
                  transitRate={fTransitRate}
                  cabinRate={fCabinRate}
                />
              );
            }
            if (listItem.type === "offsite-weekly-rest") {
              return (
                <OffsiteWeeklyRestItem
                  entry={listItem.entry}
                  extrasCfg={dayExtrasCfg}
                  onEdit={(e) => setEditOffsite(e)}
                  onDelete={(id) => deleteDayExtraMutation.mutate(id)}
                />
              );
            }
            if (listItem.type === "natural_day_diet") {
              const ndd = listItem.naturalDayDiet;
              const pillBg = ndd.type === "INTERNACIONAL" ? "#FEF3C7" : "#EEF2FF";
              const formatDateDDMM = (iso: string) => {
                const d = new Date(iso);
                const dd = String(d.getDate()).padStart(2, "0");
                const mm = String(d.getMonth() + 1).padStart(2, "0");
                const yy = d.getFullYear();
                return `${dd}/${mm}/${yy}`;
              };
              return (
                <View
                  style={{
                    backgroundColor: Colors.light.surface,
                    borderWidth: 1,
                    borderColor: Colors.light.border,
                    opacity: 0.6,
                    borderRadius: 14,
                    padding: 14,
                    marginHorizontal: 16,
                    marginVertical: 8,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <View style={{ flex: 1, flexDirection: "column", gap: 4 }}>
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <Text style={{ fontSize: 14, fontWeight: "bold", color: Colors.light.text }}>Dieta fuera de base</Text>
                      <View
                        style={{
                          backgroundColor: pillBg,
                          borderRadius: 100,
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                          marginLeft: 8,
                        }}
                      >
                        <Text style={{ fontSize: 11, fontWeight: "bold" }}>{ndd.type}</Text>
                      </View>
                      {ndd.isDomingo === true && (
                        <View style={{
                          backgroundColor: "#FFF7ED",
                          borderRadius: 100,
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                          marginLeft: 6,
                        }}>
                          <Text style={{ fontSize: 11, color: "#9A3412", fontWeight: "700" }}>
                            Domingo
                          </Text>
                        </View>
                      )}
                      {ndd.isFestivo === true && (
                        <View style={{
                          backgroundColor: "#FCE7F3",
                          borderRadius: 100,
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                          marginLeft: 6,
                        }}>
                          <Text style={{ fontSize: 11, color: "#9D174D", fontWeight: "700" }}>
                            Festivo
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text style={{ fontSize: 13, color: Colors.light.text, opacity: 0.7 }}>{formatDateDDMM(ndd.date)}</Text>
                    {ndd.location ? (
                      <Text style={{ fontSize: 12, color: Colors.light.text, opacity: 0.6 }}>📍 {ndd.location}</Text>
                    ) : null}
                    <Text style={{ fontSize: 11, color: Colors.light.text, opacity: 0.5 }}>
                      Día natural sin jornada propia · {ndd.percentage}%
                    </Text>
                    {ndd.plusItems && ndd.plusItems.length > 0 && (() => {
                      const plusTotal = ndd.plusItems.reduce((s, i) => s + (Number(i.amount) || 0), 0);
                      return (
                        <View style={{ marginTop: 6 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
                            <Text style={{ fontSize: 11.5, fontWeight: "700", color: Colors.light.text, opacity: 0.75 }}>
                              Pluses ({ndd.plusItems.length})
                            </Text>
                            <Text style={{ fontSize: 11.5, color: Colors.light.tint, marginLeft: 8, fontWeight: "700" }}>
                              +{plusTotal.toFixed(2)} €
                            </Text>
                          </View>
                          {ndd.plusItems.map((pi, idx) => (
                            <View key={pi.id || idx} style={[styles.plusRow, { marginLeft: 0, marginRight: 0, borderBottomWidth: idx < ndd.plusItems!.length - 1 ? 1 : 0 }]}>
                              <Text style={styles.plusConcepto} numberOfLines={1}>{pi.concepto}</Text>
                              <Text style={styles.plusImporte}>{(Number(pi.amount) || 0).toFixed(2)} €</Text>
                            </View>
                          ))}
                        </View>
                      );
                    })()}
                  </View>
                  <View style={{ alignItems: "flex-end", flexDirection: "column", gap: 8 }}>
                    <Text style={{ fontSize: 17, fontWeight: "bold", color: Colors.light.tint }}>
                      {ndd.amount.toFixed(2)} €
                    </Text>
                    <View style={{ flexDirection: "row", gap: 12 }}>
                      <Pressable
                        onPress={() => {
                          // Abre el modal COMPLETO (no el menú tosco anterior)
                          // en modo editMode con 1 sola fila editable:
                          // porcentajes 100/60/30/SIN, tipo, Domingo, Festivo,
                          // pluses built-in + añadir/eliminar manuales, importe live, etc.
                          setNddEditItem(ndd);
                          setNddEditVisible(true);
                        }}
                        hitSlop={8}
                      >
                        <Ionicons name="create-outline" size={18} color={Colors.light.tint} />
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          const doDelete = async () => {
                            await deleteNaturalDayDiet(ndd.id);
                            qc.invalidateQueries({ queryKey: ["dietas-resumen"] });
                            qc.invalidateQueries({ queryKey: ["km-resumen"] });
                            qc.invalidateQueries({ queryKey: ["viaje-resumen"] });
                            await refreshNaturalDayDiets();
                          };
                          if (Platform.OS === "web") {
                            if (window.confirm("¿Eliminar dieta del día?")) doDelete();
                          } else {
                            Alert.alert("¿Eliminar dieta del día?", "", [
                              { text: t("common.cancel"), style: "cancel" },
                              {
                                text: t("common.delete"),
                                style: "destructive",
                                onPress: doDelete,
                              },
                            ]);
                          }
                        }}
                        hitSlop={8}
                      >
                        <Ionicons name="trash-outline" size={18} color="#EF4444" />
                      </Pressable>
                    </View>
                  </View>
                </View>
              );
            }
            return (
              <JornadaItem
                item={listItem.jornada}
                onDelete={(id) => deleteMutation.mutate(id)}
                onEdit={(id) => router.push({ pathname: "/editar-jornada", params: { id } })}
                viajes={allViajes}
                billingMode={billingMode}
              />
            );
          }}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          scrollEnabled={listItems.length > 0}
          refreshControl={
            <RefreshControl
              refreshing={jornadasQuery.isRefetching}
              onRefresh={() => {
                qc.invalidateQueries({ queryKey: ["jornadas"] });
                qc.invalidateQueries({ queryKey: ["compensaciones"] });
                qc.invalidateQueries({ queryKey: ["all-viajes"] });
                qc.invalidateQueries({ queryKey: ["day-extra-entries"] });
                refreshNaturalDayDiets();
              }}
              tintColor={Colors.light.tint}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="document-text-outline" size={48} color={Colors.light.border} />
              <Text style={styles.emptyText}>{t("historial.emptyPeriod")}</Text>
            </View>
          }
        />
      )}

      <Modal visible={!!editOffsite} transparent animationType="fade" onRequestClose={() => setEditOffsite(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
              <View style={{ alignItems: "center", marginBottom: 14 }}>
                <View style={{ backgroundColor: Colors.light.tint + "18", width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
                  <Ionicons name="bed-outline" size={24} color={Colors.light.tint} />
                </View>
                <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.text }}>
                  Editar descanso fuera de base
                </Text>
              </View>

              <View style={styles.ferryEditRow}>
                <Text style={styles.ferryEditLabel}>Fecha</Text>
                <TextInput
                  value={editOffsiteDateInput}
                  onChangeText={(v) => {
                    setEditOffsiteDateInput(v);
                    const iso = parseDisplayDateToISO(v);
                    if (iso) setEditOffsiteDate(iso);
                  }}
                  placeholder="DD/MM/YYYY"
                  placeholderTextColor="#9CA3AF"
                  style={[styles.ferryEditInput, { flex: 1 }]}
                />
              </View>

              <View style={styles.ferryEditRow}>
                <Text style={styles.ferryEditLabel}>Tipo</Text>
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" as const }}>
                  <Pressable
                    onPress={() => setEditOffsiteRestType("WEEKLY_COMPLETE")}
                    style={[styles.ferryEditToggle, editOffsiteRestType === "WEEKLY_COMPLETE" && styles.ferryEditToggleActive]}
                  >
                    <Text style={[styles.ferryEditToggleText, editOffsiteRestType === "WEEKLY_COMPLETE" && styles.ferryEditToggleTextActive]}>
                      Completo
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setEditOffsiteRestType("WEEKLY_REDUCED")}
                    style={[styles.ferryEditToggle, editOffsiteRestType === "WEEKLY_REDUCED" && styles.ferryEditToggleActive]}
                  >
                    <Text style={[styles.ferryEditToggleText, editOffsiteRestType === "WEEKLY_REDUCED" && styles.ferryEditToggleTextActive]}>
                      Reducido
                    </Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.ferryEditRow}>
                <Text style={styles.ferryEditLabel}>Base</Text>
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" as const }}>
                  <Pressable
                    onPress={() => setEditOffsiteBase("NACIONAL")}
                    style={[styles.ferryEditToggle, editOffsiteBase === "NACIONAL" && styles.ferryEditToggleActive]}
                  >
                    <Text style={[styles.ferryEditToggleText, editOffsiteBase === "NACIONAL" && styles.ferryEditToggleTextActive]}>
                      Nacional
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setEditOffsiteBase("INTERNACIONAL")}
                    style={[styles.ferryEditToggle, editOffsiteBase === "INTERNACIONAL" && styles.ferryEditToggleActive]}
                  >
                    <Text style={[styles.ferryEditToggleText, editOffsiteBase === "INTERNACIONAL" && styles.ferryEditToggleTextActive]}>
                      Internacional
                    </Text>
                  </Pressable>
                </View>
              </View>

              <View style={{ gap: 8, marginBottom: 10 }}>
                <Pressable
                  style={styles.ferryToggleRow}
                  onPress={() => setEditOffsitePlusSunday((v) => !v)}
                >
                  <View style={styles.ferryToggleLabel}>
                    <Ionicons name={editOffsitePlusSunday ? "checkbox" : "square-outline"} size={18} color={Colors.light.tint} />
                    <Text style={styles.ferryToggleText}>Plus domingo</Text>
                  </View>
                </Pressable>
                <Pressable
                  style={styles.ferryToggleRow}
                  onPress={() => setEditOffsitePlusHoliday((v) => !v)}
                >
                  <View style={styles.ferryToggleLabel}>
                    <Ionicons name={editOffsitePlusHoliday ? "checkbox" : "square-outline"} size={18} color={Colors.light.tint} />
                    <Text style={styles.ferryToggleText}>Plus festivo</Text>
                  </View>
                </Pressable>
              </View>

              <View style={styles.ferryEditRow}>
                <Text style={styles.ferryEditLabel}>Importe descanso</Text>
                <TextInput
                  value={editOffsiteAmount}
                  onChangeText={setEditOffsiteAmount}
                  placeholder="0.00"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="decimal-pad"
                  style={[styles.ferryEditInput, { flex: 1 }]}
                />
              </View>

              <View style={styles.ferryEditRow}>
                <Text style={styles.ferryEditLabel}>Nota</Text>
                <TextInput
                  value={editOffsiteNote}
                  onChangeText={setEditOffsiteNote}
                  placeholder="(opcional)"
                  placeholderTextColor="#9CA3AF"
                  style={[styles.ferryEditInput, { flex: 1 }]}
                />
              </View>

              {(() => {
                const baseRaw = editOffsiteAmount.trim().replace(",", ".");
                const baseAmt = baseRaw ? parseFloat(baseRaw) : 0;
                const baseSafe = Number.isFinite(baseAmt) && baseAmt >= 0 ? Math.round(baseAmt * 100) / 100 : 0;
                const plusAmt =
                  (editOffsitePlusSunday ? calcDayExtra("DOMINGO", dayExtrasCfg) : 0) +
                  (editOffsitePlusHoliday ? calcDayExtra("FESTIVO", dayExtrasCfg) : 0);
                const totalAmt = Math.round((baseSafe + plusAmt) * 100) / 100;
                return (
                  <View style={{ backgroundColor: Colors.light.background, borderRadius: 12, padding: 12, marginTop: 6 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary }}>Tipo de descanso</Text>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>{baseSafe.toFixed(2)} €</Text>
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary }}>Plus</Text>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.warning }}>{plusAmt.toFixed(2)} €</Text>
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: Colors.light.text }}>{t("common.total")}</Text>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: Colors.light.text }}>{totalAmt.toFixed(2)} €</Text>
                    </View>
                  </View>
                );
              })()}

              <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                <Pressable
                  style={({ pressed }) => [styles.ferryEditBtnSecondary, { flex: 1, opacity: pressed ? 0.85 : 1 }]}
                  onPress={() => setEditOffsite(null)}
                >
                  <Text style={styles.ferryEditToggleText}>{t("common.cancel")}</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.ferryEditBtnPrimary, { flex: 1, opacity: pressed ? 0.85 : 1 }]}
                  disabled={updateOffsiteMutation.isPending}
                  onPress={() => updateOffsiteMutation.mutate()}
                >
                  {updateOffsiteMutation.isPending ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={[styles.ferryEditToggleText, { color: "#fff" }]}>{t("common.save")}</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={!!editFerry} transparent animationType="fade" onRequestClose={() => setEditFerry(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
              <View style={{ alignItems: "center", marginBottom: 14 }}>
                <View style={{ backgroundColor: Colors.light.tint + "18", width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
                  <MaterialCommunityIcons name="ferry" size={24} color={Colors.light.tint} />
                </View>
                <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.text }}>{t("ferry.editFerry")}</Text>
                {editFerry && (
                  <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textSecondary, marginTop: 2 }}>
                    {editFerry.fecha}
                  </Text>
                )}
              </View>

              <View style={styles.ferryEditRow}>
                <Text style={styles.ferryEditLabel}>{t("ferry.restType")}</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable
                    onPress={() => setEditFerryRestType("9h")}
                    style={[styles.ferryEditToggle, editFerryRestType === "9h" && styles.ferryEditToggleActive]}
                  >
                    <Text style={[styles.ferryEditToggleText, editFerryRestType === "9h" && styles.ferryEditToggleTextActive]}>9h</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setEditFerryRestType("11h")}
                    style={[styles.ferryEditToggle, editFerryRestType === "11h" && styles.ferryEditToggleActive]}
                  >
                    <Text style={[styles.ferryEditToggleText, editFerryRestType === "11h" && styles.ferryEditToggleTextActive]}>11h</Text>
                  </Pressable>
                </View>
              </View>

              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={[styles.ferryEditRow, { flex: 1 }]}>
                  <Text style={styles.ferryEditLabel}>{t("ferry.startTime")}</Text>
                  <TextInput
                    style={styles.ferryEditInput}
                    value={editFerryStartTime}
                    onChangeText={setEditFerryStartTime}
                    placeholder="HH:MM"
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                  />
                </View>
                <View style={[styles.ferryEditRow, { flex: 1 }]}>
                  <Text style={styles.ferryEditLabel}>{t("ferry.endTime")}</Text>
                  <TextInput
                    style={styles.ferryEditInput}
                    value={editFerryEndTime}
                    onChangeText={setEditFerryEndTime}
                    placeholder="HH:MM"
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                  />
                </View>
              </View>

              {editFerry && (() => {
                const requiredMin = editFerryRestType === "9h" ? 540 : 660;

                const [sH, sM] = editFerryStartTime.split(":").map(Number);
                const [eH, eM] = editFerryEndTime.split(":").map(Number);
                let accumMin = 0;
                let intTotalMin = 0;
                if (!isNaN(sH) && !isNaN(sM) && !isNaN(eH) && !isNaN(eM)) {
                  let elapsedMin = (eH * 60 + eM) - (sH * 60 + sM);
                  if (elapsedMin <= 0) elapsedMin += 24 * 60;
                  const rawIntMs = (editFerry.interruptions || []).reduce((sum: number, ii: any) => {
                    const iStart = ii.start ? new Date(ii.start).getTime() : 0;
                    const iEnd = ii.end ? new Date(ii.end).getTime() : iStart;
                    return sum + Math.max(0, iEnd - iStart);
                  }, 0);
                  intTotalMin = Math.round(rawIntMs / 60000);
                  accumMin = Math.max(0, elapsedMin - intTotalMin);
                }
                const accumH = Math.floor(accumMin / 60);
                const accumM = accumMin % 60;
                const isComplete = accumMin >= requiredMin;
                const editClassColor = isComplete ? Colors.light.success : accumMin < (editFerryRestType === "9h" ? 540 : 660) ? Colors.light.danger : Colors.light.warning;
                let editClassText = "";
                if (isComplete && accumMin >= 660) editClassText = t("ferry.finishModal.dailyComplete") || "Diario completo (≥11h)";
                else if (isComplete) editClassText = t("ferry.finishModal.dailyReduced") || "Diario reducido (≥9h <11h)";
                else editClassText = t("ferry.finishModal.insufficient") || "Insuficiente (<9h)";

                return (
                  <>
                    <View style={[styles.ferryEditRow, { backgroundColor: Colors.light.surface, borderRadius: 8, padding: 10, marginBottom: 10 }]}>
                      <View>
                        <Text style={[styles.ferryEditLabel, { marginBottom: 2 }]}>{t("ferry.accumulated")}</Text>
                        <Text style={{ fontSize: 16, fontFamily: "Inter_600SemiBold", color: isComplete ? Colors.light.success : Colors.light.warning }}>
                          {accumH}h:{String(accumM).padStart(2, "0")}
                        </Text>
                      </View>
                      <View style={[styles.ferryEditToggle, {
                        backgroundColor: editClassColor + "18",
                        borderColor: editClassColor,
                      }]}>
                        <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: editClassColor }}>
                          {editClassText}
                        </Text>
                      </View>
                    </View>

                    {editFerry.interruptions && editFerry.interruptions.length > 0 && (
                      <View style={[styles.ferryEditRow, { backgroundColor: Colors.light.surface, borderRadius: 8, padding: 10, marginBottom: 10 }]}>
                        <View>
                          <Text style={[styles.ferryEditLabel, { marginBottom: 2 }]}>{t("ferry.interruptionsUsed")}</Text>
                          <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>
                            {editFerry.interruptions.length} ({intTotalMin} min / 60 max)
                          </Text>
                        </View>
                      </View>
                    )}
                  </>
                );
              })()}

              {editFerry && normalizeFerryInterruptions(editFerry.interruptions).length > 0 && (
                <View style={{ marginBottom: 12, backgroundColor: Colors.light.surface, borderRadius: 8, padding: 10 }}>
                  {normalizeFerryInterruptions(editFerry.interruptions).map((int: FerryInterruption, idx: number) => {
                    const intStartDate = new Date(int.start);
                    const intEndDate = int.end ? new Date(int.end) : null;
                    const intStartStr = intStartDate ? `${String(intStartDate.getHours()).padStart(2, "0")}:${String(intStartDate.getMinutes()).padStart(2, "0")}` : "";
                    const intEndStr = intEndDate ? `${String(intEndDate.getHours()).padStart(2, "0")}:${String(intEndDate.getMinutes()).padStart(2, "0")}` : "";
                    const durMin = int.start && int.end ? Math.max(0, Math.round((new Date(int.end).getTime() - new Date(int.start).getTime()) / 60000)) : 0;

                    const updateIntTime = (field: "start" | "end", value: string) => {
                      const [h, m] = value.split(":").map(Number);
                      if (isNaN(h) || isNaN(m)) return;
                      const baseDate = field === "start" ? new Date(int.start) : new Date(int.end || int.start);
                      baseDate.setHours(h, m, 0, 0);
                      const newInts = [...normalizeFerryInterruptions(editFerry.interruptions)];
                      newInts[idx] = { ...newInts[idx], [field]: baseDate.toISOString() };
                      setEditFerry({ ...editFerry, interruptions: newInts as FerryInterruption[] });
                    };

                    return (
                      <View key={idx} style={{ marginBottom: idx < normalizeFerryInterruptions(editFerry.interruptions).length - 1 ? 8 : 0 }}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                          <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.textSecondary }}>
                            #{idx + 1}
                          </Text>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            {durMin > 0 && (
                              <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: durMin > 60 ? Colors.light.danger : Colors.light.warning }}>{durMin} min</Text>
                            )}
                            <Pressable
                              onPress={() => {
                                const updatedInts = normalizeFerryInterruptions(editFerry.interruptions).filter((_: any, i: number) => i !== idx);
                                const updated = { ...editFerry, interruptions: updatedInts as FerryInterruption[] };
                                setEditFerry(updated as FerryRestRecord);
                              }}
                              hitSlop={8}
                            >
                              <Ionicons name="trash-outline" size={16} color={Colors.light.danger} />
                            </Pressable>
                          </View>
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <TextInput
                            style={[styles.ferryEditInput, { flex: 1, fontSize: 14, textAlign: "center" }]}
                            value={intStartStr}
                            onChangeText={(v) => updateIntTime("start", v)}
                            placeholder="HH:MM"
                            placeholderTextColor={Colors.light.textSecondary}
                            keyboardType="numbers-and-punctuation"
                          />
                          <Text style={{ fontSize: 13, color: Colors.light.textSecondary }}>→</Text>
                          <TextInput
                            style={[styles.ferryEditInput, { flex: 1, fontSize: 14, textAlign: "center" }]}
                            value={intEndStr}
                            onChangeText={(v) => updateIntTime("end", v)}
                            placeholder="HH:MM"
                            placeholderTextColor={Colors.light.textSecondary}
                            keyboardType="numbers-and-punctuation"
                          />
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}

              <View style={styles.ferryEditRow}>
                <Text style={styles.ferryEditLabel}>Destino</Text>
                <TextInput
                  style={styles.ferryEditInput}
                  value={editFerryDest}
                  onChangeText={setEditFerryDest}
                  placeholder="Ej: Tánger, Nador..."
                  placeholderTextColor={Colors.light.textSecondary}
                />
              </View>

              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={[styles.ferryEditRow, { flex: 1 }]}>
                  <Text style={styles.ferryEditLabel}>Dietas tránsito</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Pressable
                      onPress={() => setEditFerryTransit(Math.max(0, editFerryTransit - 1))}
                      style={[styles.ferryEditToggle, { paddingHorizontal: 10 }]}
                    >
                      <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.textSecondary }}>−</Text>
                    </Pressable>
                    <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text, minWidth: 24, textAlign: "center" as const }}>{editFerryTransit}</Text>
                    <Pressable
                      onPress={() => setEditFerryTransit(editFerryTransit + 1)}
                      style={[styles.ferryEditToggle, { paddingHorizontal: 10 }]}
                    >
                      <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.tint }}>+</Text>
                    </Pressable>
                  </View>
                </View>
                <View style={[styles.ferryEditRow, { flex: 1 }]}>
                  <Text style={styles.ferryEditLabel}>Pernoctas camarote</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Pressable
                      onPress={() => setEditFerryCabin(Math.max(0, editFerryCabin - 1))}
                      style={[styles.ferryEditToggle, { paddingHorizontal: 10 }]}
                    >
                      <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.textSecondary }}>−</Text>
                    </Pressable>
                    <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text, minWidth: 24, textAlign: "center" as const }}>{editFerryCabin}</Text>
                    <Pressable
                      onPress={() => setEditFerryCabin(editFerryCabin + 1)}
                      style={[styles.ferryEditToggle, { paddingHorizontal: 10 }]}
                    >
                      <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.tint }}>+</Text>
                    </Pressable>
                  </View>
                </View>
              </View>

              <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
                <Pressable
                  style={({ pressed }) => [styles.ferryEditBtnDanger, { opacity: pressed ? 0.85 : 1 }]}
                  onPress={() => {
                    if (!editFerry) return;
                    const doDelete = () => {
                      deleteFerryRest(editFerry.id).then(() => {
                        setEditFerry(null);
                        qc.invalidateQueries({ queryKey: ["ferry-rests"] });
                        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                      });
                    };
                    if (Platform.OS === "web") {
                      if (window.confirm(t("ferry.confirmDelete"))) doDelete();
                    } else {
                      Alert.alert(t("ferry.confirmDelete"), "", [
                        { text: t("common.cancel"), style: "cancel" },
                        { text: t("common.delete"), style: "destructive", onPress: doDelete },
                      ]);
                    }
                  }}
                >
                  <Ionicons name="trash-outline" size={16} color="#fff" />
                </Pressable>

                <Pressable
                  style={({ pressed }) => [styles.ferryEditBtnSecondary, { flex: 1, opacity: pressed ? 0.85 : 1 }]}
                  onPress={() => setEditFerry(null)}
                >
                  <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.textSecondary }}>{t("common.cancel")}</Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [styles.ferryEditBtnPrimary, { flex: 1, opacity: pressed ? 0.85 : 1 }]}
                  onPress={async () => {
                    if (!editFerry) return;
                    try {
                      const [sH, sM] = editFerryStartTime.split(":").map(Number);
                      const [eH, eM] = editFerryEndTime.split(":").map(Number);
                      if (isNaN(sH) || isNaN(sM) || isNaN(eH) || isNaN(eM)) {
                        Alert.alert(t("common.error"), t("ferry.invalidTime"));
                        return;
                      }

                      const origStart = new Date(editFerry.startTime);
                      origStart.setHours(sH, sM, 0, 0);
                      const newStartISO = origStart.toISOString();

                      const endRef = new Date(editFerry.endTime || editFerry.startTime);
                      endRef.setHours(eH, eM, 0, 0);
                      if (endRef.getTime() <= origStart.getTime()) {
                        endRef.setDate(endRef.getDate() + 1);
                      }
                      const newEndISO = endRef.toISOString();

                      const currentInterruptions = normalizeFerryInterruptions(editFerry.interruptions);
                      const rawIntMs = currentInterruptions.reduce((sum: number, ii: any) => {
                        const iStart = ii.start ? new Date(ii.start).getTime() : 0;
                        const iEnd = ii.end ? new Date(ii.end).getTime() : iStart;
                        return sum + Math.max(0, iEnd - iStart);
                      }, 0);
                      const intTotalMin = Math.round(rawIntMs / 60000);
                      const requiredMin = editFerryRestType === "9h" ? 540 : 660;

                      let elapsedMin = (eH * 60 + eM) - (sH * 60 + sM);
                      if (elapsedMin <= 0) elapsedMin += 24 * 60;
                      let accumMin = Math.max(0, elapsedMin - intTotalMin);

                      const isValid = accumMin >= requiredMin;
                      const isComplete = accumMin >= requiredMin;

                      const updatedExtras = {
                        transitDiet: editFerryTransit,
                        cabinOvernight: editFerryCabin,
                        countryChange: editFerry.ferryExtras?.countryChange || false,
                      };

                      if (editFerry.id.startsWith("synth-")) {
                        const jornadaId = editFerry.id.replace("synth-", "");
                        await updateJornadaFerryData(jornadaId, {
                          ferryExtras: updatedExtras,
                          ferryDestination: editFerryDest || null,
                          ferryRestType: editFerryRestType,
                          ferryInterruptions: currentInterruptions,
                        });
                      } else {
                        await updateFerryRest(editFerry.id, {
                          startTime: newStartISO,
                          endTime: newEndISO,
                          restType: editFerryRestType,
                          interruptions: currentInterruptions,
                          accumulatedRestMin: Math.max(0, accumMin),
                          interruptionTotalMin: intTotalMin,
                          isValid,
                          isComplete,
                          invalidReason: !isValid ? "ferry.finishModal.insufficient" : null,
                          destination: editFerryDest || undefined,
                          ferryExtras: updatedExtras,
                        });
                      }

                      setEditFerry(null);
                      await qc.invalidateQueries({ queryKey: ["ferry-rests"] });
                      await qc.invalidateQueries({ queryKey: ["jornadas"] });
                      await qc.refetchQueries({ queryKey: ["ferry-rests"] });
                      await qc.refetchQueries({ queryKey: ["jornadas"] });
                      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    } catch (e: any) {
                      Alert.alert(t("common.error"), e?.message || String(e));
                    }
                  }}
                >
                  <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" }}>{t("common.save")}</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={!!editingFerryJornada} transparent animationType="fade" onRequestClose={() => setEditingFerryJornada(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
              <View style={{ alignItems: "center", marginBottom: 14 }}>
                <View style={{ backgroundColor: "#0284c7" + "18", width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
                  <MaterialCommunityIcons name="ferry" size={24} color="#0284c7" />
                </View>
                <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Editar Descanso Ferry</Text>
              </View>

              <View style={styles.ferryEditRow}>
                <Text style={styles.ferryEditLabel}>{t("ferry.restType")}</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable
                    onPress={() => setEditFjRestType("9h")}
                    style={[styles.ferryEditToggle, editFjRestType === "9h" && styles.ferryEditToggleActive]}
                  >
                    <Text style={[styles.ferryEditToggleText, editFjRestType === "9h" && styles.ferryEditToggleTextActive]}>9h</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setEditFjRestType("11h")}
                    style={[styles.ferryEditToggle, editFjRestType === "11h" && styles.ferryEditToggleActive]}
                  >
                    <Text style={[styles.ferryEditToggleText, editFjRestType === "11h" && styles.ferryEditToggleTextActive]}>11h</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.ferryEditRow}>
                <Text style={styles.ferryEditLabel}>Destino</Text>
                <TextInput
                  style={styles.ferryEditInput}
                  value={editFjDest}
                  onChangeText={setEditFjDest}
                  placeholder="Ej: Tánger, Nador..."
                  placeholderTextColor={Colors.light.textSecondary}
                />
              </View>

              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={[styles.ferryEditRow, { flex: 1 }]}>
                  <Text style={styles.ferryEditLabel}>Dietas tránsito</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Pressable
                      onPress={() => setEditFjTransit(Math.max(0, editFjTransit - 1))}
                      style={[styles.ferryEditToggle, { paddingHorizontal: 10 }]}
                    >
                      <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.textSecondary }}>−</Text>
                    </Pressable>
                    <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text, minWidth: 24, textAlign: "center" }}>{editFjTransit}</Text>
                    <Pressable
                      onPress={() => setEditFjTransit(editFjTransit + 1)}
                      style={[styles.ferryEditToggle, { paddingHorizontal: 10 }]}
                    >
                      <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.tint }}>+</Text>
                    </Pressable>
                  </View>
                </View>
                <View style={[styles.ferryEditRow, { flex: 1 }]}>
                  <Text style={styles.ferryEditLabel}>Pernoctas camarote</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Pressable
                      onPress={() => setEditFjCabin(Math.max(0, editFjCabin - 1))}
                      style={[styles.ferryEditToggle, { paddingHorizontal: 10 }]}
                    >
                      <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.textSecondary }}>−</Text>
                    </Pressable>
                    <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text, minWidth: 24, textAlign: "center" }}>{editFjCabin}</Text>
                    <Pressable
                      onPress={() => setEditFjCabin(editFjCabin + 1)}
                      style={[styles.ferryEditToggle, { paddingHorizontal: 10 }]}
                    >
                      <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.tint }}>+</Text>
                    </Pressable>
                  </View>
                </View>
              </View>

              <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                <Pressable
                  style={({ pressed }) => [styles.ferryEditBtnSecondary, { flex: 1, opacity: pressed ? 0.85 : 1 }]}
                  onPress={() => setEditingFerryJornada(null)}
                >
                  <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.textSecondary }}>{t("common.cancel")}</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.ferryEditBtnPrimary, { flex: 1, opacity: pressed ? 0.85 : 1 }]}
                  onPress={() => saveFerryJornadaEdit.mutate()}
                  disabled={saveFerryJornadaEdit.isPending}
                >
                  <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" }}>{t("common.save")}</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <PendingNaturalDietsModal
        visible={pendingDietsVisible}
        detected={pendingDiets}
        onClose={handleCancelPendingDiets}
        onConfirm={handleConfirmPendingDiets}
        loading={pendingDietsSaving}
        autoPlusesCfg={{
          sunday: dayExtrasCfg?.extra_sunday ? Number(dayExtrasCfg.extra_sunday) || 0 : 0,
          holiday: dayExtrasCfg?.extra_holiday ? Number(dayExtrasCfg.extra_holiday) || 0 : 0,
        }}
      />

      {/* Editor NDDE: modal completo en editMode para 1 sola fila */}
      <PendingNaturalDietsModal
        visible={nddEditVisible && nddEditItem !== null}
        detected={[]}
        editMode={true}
        initialEditItems={
          nddEditItem
            ? [
                {
                  date: nddEditItem.date,
                  type: nddEditItem.type as any,
                  percentage: nddEditItem.percentage as any,
                  amount: Number(nddEditItem.amount) || 0,
                  location: nddEditItem.location ?? null,
                  previousJourneyId: nddEditItem.previousJourneyId ?? null,
                  nextJourneyId: nddEditItem.nextJourneyId ?? null,
                  isBaseArrivalDay: false,
                  isDomingo: nddEditItem.isDomingo === true,
                  isFestivo: nddEditItem.isFestivo === true,
                  motivo: "",
                  plusItems: Array.isArray(nddEditItem.plusItems)
                    ? nddEditItem.plusItems.map((p) => ({
                        id: p.id,
                        concepto: p.concepto,
                        amount: Number(p.amount) || 0,
                        selected: true,
                      }))
                    : [],
                  userPercentage: nddEditItem.percentage as any,
                  userAmount: Number(nddEditItem.amount) || 0,
                  removed: false,
                },
              ]
            : []
        }
        onClose={() => {
          setNddEditVisible(false);
          setNddEditItem(null);
        }}
        onConfirm={() => {}}
        loading={pendingDietsSaving}
        autoPlusesCfg={{
          sunday: dayExtrasCfg?.extra_sunday ? Number(dayExtrasCfg.extra_sunday) || 0 : 0,
          holiday: dayExtrasCfg?.extra_holiday ? Number(dayExtrasCfg.extra_holiday) || 0 : 0,
        }}
        onConfirmEditMode={async (finalItems) => {
          try {
            if (!nddEditItem) return;
            const result = finalItems[0];
            if (!result) {
              // finalItems.length === 0 → usuario eligió SIN_DIETA; consideramos que NO borramos silenciosamente
              // (si queréis borrar lo cambiaré — ahora solo cerramos sin cambios)
              setNddEditVisible(false);
              setNddEditItem(null);
              return;
            }
            // Construir updated NDDE mergando cambios del modal sobre el original
            const safePct: 100 | 60 | 30 =
              result.userPercentage === 60 ? 60 : result.userPercentage === 30 ? 30 : 100;
            const typeUpper = String(result.type || nddEditItem.type).toUpperCase();
            const safeType: "INTERNACIONAL" | "NACIONAL" | "REGIONAL" =
              typeUpper === "NACIONAL" ? "NACIONAL" : typeUpper === "REGIONAL" ? "REGIONAL" : "INTERNACIONAL";
            const finalAmount = Number.isFinite(result.userAmount) && result.userAmount != null
              ? +Number(result.userAmount).toFixed(2)
              : Number(result.amount) || 0;
            const updated: NaturalDayDietEntry = {
              ...nddEditItem,
              percentage: safePct,
              type: safeType,
              amount: finalAmount,
              location: result.location ?? nddEditItem.location ?? null,
              isDomingo: result.isDomingo === true ? true : false,
              isFestivo: result.isFestivo === true ? true : false,
              confirmedByUser: true,
              updatedAt: new Date().toISOString(),
              syncStatus: "pending",
              plusItems: Array.isArray(result.plusItems) && result.plusItems.length > 0
                ? result.plusItems.map((pl) => ({
                    concepto: String(pl.concepto || "plus").trim().slice(0, 240),
                    amount: Math.max(0, Math.min(99999, +(Number(pl.amount) || 0).toFixed(2))),
                    id: String(pl.id || `manual_${Date.now()}_${Math.floor(Math.random() * 9999)}`),
                  }))
                : null,
            };
            // Guarda + invalida TODAS las queries para refresco inmediato Inicio / Historial / Dietas:
            await upsertNaturalDayDiets([updated]);
            await Promise.all([
              qc.invalidateQueries({ queryKey: ["jornadas"] }).catch(() => {}),
              qc.invalidateQueries({ queryKey: ["compensaciones"] }).catch(() => {}),
              qc.invalidateQueries({ queryKey: ["all-viajes"] }).catch(() => {}),
              qc.invalidateQueries({ queryKey: ["day-extra-entries"] }).catch(() => {}),
              qc.invalidateQueries({ queryKey: ["dietas-resumen"] }).catch(() => {}),
              qc.invalidateQueries({ queryKey: ["km-resumen"] }).catch(() => {}),
              qc.invalidateQueries({ queryKey: ["viaje-resumen"] }).catch(() => {}),
              qc.invalidateQueries({ queryKey: ["estado-legal"] }).catch(() => {}),
              qc.invalidateQueries({ queryKey: ["offsite-weekly-rest-dates"] }).catch(() => {}),
            ]);
            await refreshNaturalDayDiets();
            setNddEditVisible(false);
            setNddEditItem(null);
          } catch (err) {
            console.error("[historial.tsx] onConfirmEditMode error:", err);
            if (Platform.OS === "web") {
              window.alert(`Error al guardar cambios: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: Colors.light.tint,
  },
  reportBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: Colors.light.tint,
  },
  reportBtnText: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    color: "#fff",
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
  summaryRow: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  summaryLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.light.textSecondary,
  },
  summaryValue: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    color: Colors.light.accent,
  },
  summaryExtras: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: Colors.light.warning,
    marginTop: 2,
  },
  loadingWrap: {
    flex: 1,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === "web" ? 118 : 100,
  },
  card: {
    backgroundColor: Colors.light.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  cardOpen: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.light.warning,
  },
  cardTop: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    marginBottom: 6,
  },
  cardActions: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
  },
  cardDates: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    flexShrink: 1,
  },
  dateText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
  },
  openBadge: {
    backgroundColor: Colors.light.warning + "20",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  openBadgeText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.warning,
  },
  cardRoute: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    marginBottom: 8,
  },
  routeText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    flex: 1,
  },
  cardStats: {
    flexDirection: "row" as const,
    gap: 14,
    marginBottom: 8,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  statItem: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
  },
  statText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: Colors.light.textSecondary,
  },
  compRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  compText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    flex: 1,
  },
  cardBottom: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    flexWrap: "wrap" as const,
    gap: 6,
  },
  infoChip: {
    backgroundColor: Colors.light.background,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
  },
  statusChip: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  chipLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: Colors.light.textSecondary,
  },
  dietaAmount: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    color: Colors.light.accent,
  },
  cardExtrasAmount: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: Colors.light.warning,
    marginTop: 1,
  },
  legalDetails: {
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    padding: 8,
    gap: 4,
    marginBottom: 8,
  },
  legalDetailRow: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: 5,
  },
  legalDetailText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    flex: 1,
    lineHeight: 15,
  },
  restGap: {
    marginVertical: 2,
    paddingHorizontal: 4,
  },
  restGapDanger: {},
  restGapWarning: {},
  restGapLine: {
    height: 1,
    backgroundColor: Colors.light.border,
    marginHorizontal: 12,
  },
  restGapContent: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  restGapLeft: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  restGapDuration: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  restGapTypeBadge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  restGapTypeText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
  },
  restGapAlert: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 5,
    paddingHorizontal: 8,
    paddingBottom: 6,
  },
  restGapAlertText: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    color: Colors.light.warning,
    flex: 1,
  },
  restGapMeta: {
    paddingHorizontal: 8,
    paddingBottom: 6,
    gap: 2,
  },
  restGapMetaText: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
  },
  restGapMetaTextSuccess: {
    color: Colors.light.success,
    fontFamily: "Inter_500Medium",
  },
  empty: {
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingTop: 80,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
  },
  plusSection: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
    gap: 3,
  },
  plusRow: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
  },
  plusConcepto: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    flex: 1,
    marginRight: 8,
  },
  plusImporte: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: Colors.light.accent,
  },
  plusTotalRow: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    marginTop: 2,
  },
  plusTotalLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.textSecondary,
  },
  plusTotalValue: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.tint,
  },
  viajesSection: {
    backgroundColor: Colors.light.tint + "08",
    borderRadius: 8,
    padding: 6,
    marginBottom: 8,
    gap: 4,
  },
  viajeRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  viajeIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.light.tint + "14",
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  viajeInfo: {
    flex: 1,
    gap: 1,
  },
  viajeCliente: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
  },
  viajePlaces: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
  },
  viajeEstadoBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  viajeEstadoText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center" as const,
    alignItems: "center" as const,
    padding: 20,
  },
  modalCard: {
    backgroundColor: Colors.light.background,
    borderRadius: 16,
    padding: 20,
    width: "100%" as any,
    maxWidth: 380,
    maxHeight: "85%" as any,
  },
  ferryEditRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: 12,
  },
  ferryEditLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.light.textSecondary,
  },
  ferryEditInput: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
    textAlign: "center" as const,
    padding: 6,
    backgroundColor: Colors.light.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
    width: 100,
  },
  ferryEditToggle: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.surface,
  },
  ferryEditToggleActive: {
    backgroundColor: Colors.light.tint,
    borderColor: Colors.light.tint,
  },
  ferryEditToggleText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
  },
  ferryEditToggleTextActive: {
    color: "#fff",
  },
  ferryEditBtnPrimary: {
    backgroundColor: Colors.light.tint,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  ferryEditBtnSecondary: {
    backgroundColor: Colors.light.surface,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  ferryEditBtnDanger: {
    backgroundColor: Colors.light.danger,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  ferryToggleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    backgroundColor: Colors.light.surface,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  ferryToggleLabel: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
  },
  ferryToggleText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
  },
});
