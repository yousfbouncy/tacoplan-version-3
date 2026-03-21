import React, { useState, useMemo, useEffect, useCallback } from "react";
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
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import {
  formatFecha,
  formatDescanso,
  formatMinutosHoras,
} from "@/lib/utils";
import { usePeriod } from "@/lib/period-context";
import { useI18n } from "@/lib/i18n-context";
import { useFerry } from "@/lib/ferry-context";
import {
  listarJornadas,
  eliminarJornada,
  listarCompensaciones,
  getAllViajes,
  getAllFerryRests,
  getActiveFerryRest,
  updateFerryRest,
  deleteFerryRest,
  updateJornadaFerryData,
  type Jornada,
  type Compensacion,
  type Viaje,
  type FerryRestRecord,
  type ActiveFerryRest,
  type FerryInterruption,
  getFerryInterruptionsTotalMin,
} from "@/lib/local-storage";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  getLegalStatusColor,
  getLegalStatusLabel,
  getSeverityColor,
  getSeverityLabel,
} from "@/lib/legalEngine";
import { useSync } from "@/lib/sync-context";

function getLegalStatus(item: Jornada): { color: string; label: string } {
  if (!item.fechaFin) return { color: Colors.light.textSecondary, label: "-" };

  if (item.legalSummary) {
    return {
      color: getLegalStatusColor(item.legalSummary.status),
      label: getLegalStatusLabel(item.legalSummary.status),
    };
  }

  const durMin = item.duracionJornadaMin || 0;
  const condMin = item.conduccionMin || Math.round(durMin * 0.65);

  if (
    item.tipoDescansoAnterior === "INFRACCION_DESCANSO" ||
    condMin > 10 * 60 ||
    durMin > 15 * 60
  ) {
    return { color: Colors.light.danger, label: "Infraccion" };
  }

  if (
    item.tipoDescansoAnterior === "DESCANSO_DIARIO_REDUCIDO" ||
    condMin > 9 * 60 ||
    durMin > 13 * 60
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

function clasificarDescansoLocal(minutos: number): { tipo: string; labelKey: string; color: string } {
  if (minutos < 9 * 60) return { tipo: "INFRACCION", labelKey: "historial.restInfraction", color: Colors.light.danger };
  if (minutos < 11 * 60) return { tipo: "REDUCIDO_DIARIO", labelKey: "historial.dailyReduced", color: Colors.light.warning };
  if (minutos < 24 * 60) return { tipo: "COMPLETO_DIARIO", labelKey: "historial.dailyComplete", color: Colors.light.success };
  if (minutos < 45 * 60) return { tipo: "REDUCIDO_SEMANAL", labelKey: "historial.weeklyReduced", color: Colors.light.warning };
  return { tipo: "COMPLETO_SEMANAL", labelKey: "historial.weeklyComplete", color: Colors.light.success };
}

function RestGapItem({
  restMin,
  compensacion,
  isFerryRest,
  ferryJornada,
  onEditFerryJornada,
}: {
  restMin: number;
  compensacion?: Compensacion;
  isFerryRest?: boolean;
  ferryJornada?: Jornada;
  onEditFerryJornada?: (jornada: Jornada) => void;
}) {
  const { t } = useI18n();
  const info = clasificarDescansoLocal(restMin);
  const isReduced = info.tipo === "REDUCIDO_DIARIO" || info.tipo === "REDUCIDO_SEMANAL";
  const isInfraction = info.tipo === "INFRACCION" && !isFerryRest;

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
  const displayLabel = isFerryRest ? t("ferry.restInFerry") : t(info.labelKey);

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
}: {
  item: Jornada;
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
  viajes: Viaje[];
}) {
  const { t } = useI18n();
  const isCerrada = !!item.fechaFin;
  const status = getLegalStatus(item);
  const statusLabel = status.label === "Infraccion" ? t("dashboard.infraction") : status.label === "Advertencia" ? t("dashboard.warning") : status.label === "Legal" ? t("dashboard.legal") : status.label;
  const durMin = item.duracionJornadaMin || 0;
  const condMin = item.conduccionMin || Math.round(durMin * 0.65);
  const matchedViajes = findViajesForJornada(item, viajes);

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
              <View style={[styles.infoChip, { backgroundColor: Colors.light.accent + "18" }]}>
                <Ionicons name="airplane" size={11} color={Colors.light.accent} />
                <Text style={[styles.chipLabel, { color: Colors.light.accent }]}>{t("morocco.diet.tripPayment")}</Text>
              </View>
            ) : item.moroccoPaymentMode === "morocco_pernight" ? (
              <>
                <View style={[styles.infoChip, { backgroundColor: Colors.light.accent + "18" }]}>
                  <Ionicons name="bed" size={11} color={Colors.light.accent} />
                  <Text style={[styles.chipLabel, { color: Colors.light.accent }]}>{t("onboarding.paymentPernight")}</Text>
                </View>
                <View style={styles.infoChip}>
                  <Text style={styles.chipLabel}>{t(tipoRutaKey[item.tipoRuta] || "common.nacional")}</Text>
                </View>
              </>
            ) : (
              <View style={styles.infoChip}>
                <Text style={styles.chipLabel}>{t(tipoRutaKey[item.tipoRuta] || "common.nacional")}</Text>
              </View>
            )}
            {item.moroccoPaymentMode !== "morocco_trip" && item.dietaPercent != null && item.dietaPercent > 0 && (
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
                  const full = item.dietaImporteEur ? parseFloat(item.dietaImporteEur) : 0;
                  const dayEx = item.dayExtraEur ? parseFloat(item.dayExtraEur) : 0;
                  const base = full - dayEx;
                  return base > 0 ? `${base.toFixed(2)} \u20AC` : "";
                })()}
              </Text>
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
  const { triggerDeleteSync, syncVersion } = useSync();
  const { getPeriod } = usePeriod();
  const [periodoIdx, setPeriodoIdx] = useState(0);

  const periodo = useMemo(() => {
    return getPeriod(periodoIdx);
  }, [periodoIdx, getPeriod]);

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
  const ferryRests = useMemo(() => allFerryRests.filter((fr) => {
    if (!fr.fecha) return false;
    return fr.fecha >= periodo.from && fr.fecha <= periodo.to;
  }), [allFerryRests, periodo.from, periodo.to]);

  const activeFerryQuery = useQuery<ActiveFerryRest | null>({
    queryKey: ["active-ferry-rest", syncVersion],
    queryFn: () => getActiveFerryRest(),
  });
  const activeFerry = activeFerryQuery.data ?? null;

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

  useEffect(() => {
    if (editingFerryJornada) {
      setEditFjDest(editingFerryJornada.ferryDestination || "");
      setEditFjRestType(editingFerryJornada.ferryRestType || "11h");
      setEditFjTransit(editingFerryJornada.ferryExtras?.transitDiet || 0);
      setEditFjCabin(editingFerryJornada.ferryExtras?.cabinOvernight || 0);
    }
  }, [editingFerryJornada]);

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
    | { type: "rest-gap"; restMin: number; afterJornadaId: string; compensacion?: Compensacion; isFerryRest?: boolean; ferryJornada?: Jornada }
    | { type: "ferry-rest"; ferryRest: FerryRestRecord }
    | { type: "active-ferry"; activeFerry: ActiveFerryRest };

  const listItems = useMemo<ListItem[]>(() => {
    const sorted = [...jornadasData];

    const allEvents: Array<{ ts: number; item: ListItem }> = [];

    for (const j of sorted) {
      const ts = j.startAt ? new Date(j.startAt).getTime() : j.endAt ? new Date(j.endAt).getTime() : 0;
      allEvents.push({ ts, item: { type: "jornada", jornada: j } });
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
        if (!current.fechaFin && current.descansoAnteriorMin && current.descansoAnteriorMin > 0) {
          items.push({
            type: "rest-gap",
            restMin: current.descansoAnteriorMin,
            afterJornadaId: `open-${current.id}`,
            compensacion: compMap.get(current.id),
          });
        } else if (current.fechaFin) {
          let nextJornada: Jornada | null = null;
          for (let j = i + 1; j < allEvents.length; j++) {
            if (allEvents[j].item.type === "jornada") {
              nextJornada = (allEvents[j].item as any).jornada;
              break;
            }
          }
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
              });
            }
          }
        }
      }
    }

    return items;
  }, [jornadasData, compMap, ferryRests, activeFerry]);

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

  const totalDietas = jornadasData.reduce((acc, j) => {
    if (!j.dietaImporteEur) return acc;
    const dietaFull = parseFloat(j.dietaImporteEur);
    const dayExtra = j.dayExtraEur ? parseFloat(j.dayExtraEur) : 0;
    return acc + (dietaFull - dayExtra);
  }, 0);
  const totalExtras = jornadasData.reduce((acc, j) => {
    const dayExtra = j.dayExtraEur ? parseFloat(j.dayExtraEur) : 0;
    const plus = j.plusItems ? j.plusItems.reduce((s, i) => s + i.importe, 0) : 0;
    return acc + dayExtra + plus;
  }, 0);
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
        <Pressable onPress={() => router.push("/exportar")} hitSlop={10}>
          <Ionicons name="download-outline" size={22} color={Colors.light.tint} />
        </Pressable>
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
            <Text style={styles.summaryValue}>{(totalDietas + totalFerryExtras).toFixed(2)} \u20AC</Text>
            {totalExtras > 0 && (
              <Text style={styles.summaryExtras}>+{totalExtras.toFixed(2)} \u20AC {t("historial.extras")}</Text>
            )}
            {totalFerryExtras > 0 && (
              <Text style={[styles.summaryExtras, { color: "#0284c7" }]}>
                {totalFerryExtras.toFixed(2)} \u20AC ferry
              </Text>
            )}
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
          keyExtractor={(item) =>
            item.type === "jornada" ? item.jornada.id : item.type === "ferry-rest" ? `ferry-${item.ferryRest.id}` : item.type === "active-ferry" ? "active-ferry" : `rest-${item.afterJornadaId}`
          }
          renderItem={({ item: listItem }) => {
            if (listItem.type === "rest-gap") {
              return (
                <RestGapItem
                  restMin={listItem.restMin}
                  compensacion={listItem.compensacion}
                  isFerryRest={listItem.isFerryRest}
                  ferryJornada={listItem.ferryJornada}
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
            return (
              <JornadaItem
                item={listItem.jornada}
                onDelete={(id) => deleteMutation.mutate(id)}
                onEdit={(id) => router.push({ pathname: "/editar-jornada", params: { id } })}
                viajes={allViajes}
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

              {editFerry && editFerry.interruptions && editFerry.interruptions.length > 0 && (
                <View style={{ marginBottom: 12, backgroundColor: Colors.light.surface, borderRadius: 8, padding: 10 }}>
                  {editFerry.interruptions.map((int: any, idx: number) => {
                    const isNew = "start" in int;
                    const intStartDate = isNew ? new Date(int.start) : null;
                    const intEndDate = isNew && int.end ? new Date(int.end) : null;
                    const intStartStr = intStartDate ? `${String(intStartDate.getHours()).padStart(2, "0")}:${String(intStartDate.getMinutes()).padStart(2, "0")}` : "";
                    const intEndStr = intEndDate ? `${String(intEndDate.getHours()).padStart(2, "0")}:${String(intEndDate.getMinutes()).padStart(2, "0")}` : "";
                    const durMin = isNew && int.start && int.end ? Math.max(0, Math.round((new Date(int.end).getTime() - new Date(int.start).getTime()) / 60000)) : 0;

                    const updateIntTime = (field: "start" | "end", value: string) => {
                      const [h, m] = value.split(":").map(Number);
                      if (isNaN(h) || isNaN(m)) return;
                      const baseDate = field === "start" ? new Date(int.start) : new Date(int.end || int.start);
                      baseDate.setHours(h, m, 0, 0);
                      const newInts = [...editFerry.interruptions];
                      newInts[idx] = { ...newInts[idx], [field]: baseDate.toISOString() };
                      setEditFerry({ ...editFerry, interruptions: newInts });
                    };

                    return (
                      <View key={idx} style={{ marginBottom: idx < editFerry.interruptions.length - 1 ? 8 : 0 }}>
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
                                const updated = { ...editFerry, interruptions: editFerry.interruptions.filter((_: any, i: number) => i !== idx) };
                                setEditFerry(updated);
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

                      const currentInterruptions = editFerry.interruptions || [];
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
});
