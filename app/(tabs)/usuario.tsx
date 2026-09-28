import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, router, useLocalSearchParams } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Sharing from "expo-sharing";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import { registerPushToken, useAuth } from "@/lib/auth-context";
import OnboardingGuide from "@/components/OnboardingGuide";
import { useFerry, type RouteMode, type PaymentMode } from "@/lib/ferry-context";
import { usePeriod, PeriodMode, computeRange } from "@/lib/period-context";
import { useI18n } from "@/lib/i18n-context";
import { useSync } from "@/lib/sync-context";
import { listarJornadas, eliminarJornada, listarCompensaciones, getAllFerryRests, getAllViajes, getResumenDietas, getResumenKm, getResumenViaje, type Jornada, type Compensacion } from "@/lib/local-storage";
import { userScopedKey } from "@/lib/user-scope";
import { createHoliday, deleteHoliday as deleteHolidayCloud, fetchHolidays } from "@/lib/user-cloud";
import { getUserConfig, saveUserConfig } from "@/lib/config-service";
import { supabase } from "@/lib/supabase";

function safeHaptic() {
  if (Platform.OS !== "web") {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

function formatFechaES(dateStr: string): string {
  const m = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(dateStr || "");
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function daysBetweenInclusive(from: string, to: string): number {
  if (!isIsoDate(from) || !isIsoDate(to)) return 0;
  const a = new Date(from + "T12:00:00");
  const b = new Date(to + "T12:00:00");
  const diff = Math.floor((b.getTime() - a.getTime()) / 86400000) + 1;
  return Number.isFinite(diff) && diff > 0 ? diff : 0;
}

function formatEUR(value: number): string {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  try {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(safe);
  } catch {
    const fixed = safe.toFixed(2);
    const parts = fixed.split(".");
    const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return `${intPart},${parts[1]} €`;
  }
}

function formatPct(value: number): string {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  const s = safe.toFixed(2).replace(".", ",");
  return `${s}%`;
}

function isZero(value: number): boolean {
  return Math.abs(Number(value) || 0) < 0.005;
}

const SETTINGS_KEY = "tacoplan_user_settings";

interface UserSettings {
  nac_100: string;
  nac_60: string;
  nac_30: string;
  intl_100: string;
  intl_60: string;
  intl_30: string;
  reg_100: string;
  reg_60: string;
  reg_30: string;
  extra_saturday: string;
  extra_sunday: string;
  extra_holiday: string;
  offsite_weekly_reduced_nacional: string;
  offsite_weekly_reduced_internacional: string;
  offsite_weekly_complete_nacional: string;
  offsite_weekly_complete_internacional: string;
  payment_mode: "dietas" | "viaje" | "km";
  price_per_km: string;
  price_per_km_nacional: string;
  price_per_km_internacional: string;
  price_per_km_regional: string;
  price_per_trip: string;
  price_per_trip_nacional: string;
  price_per_trip_internacional: string;
  price_per_trip_regional: string;
  period_start_day: string;
  period_end_day: string;
  base_name: string;
  base_city: string;
  base_country: string;
  base_address: string;
  base_latitude: string;
  base_longitude: string;
  base_radius_km: string;
}

const DEFAULT_SETTINGS: UserSettings = {
  nac_100: "0",
  nac_60: "0",
  nac_30: "0",
  intl_100: "0",
  intl_60: "0",
  intl_30: "0",
  reg_100: "0",
  reg_60: "0",
  reg_30: "0",
  extra_saturday: "0",
  extra_sunday: "0",
  extra_holiday: "0",
  offsite_weekly_reduced_nacional: "0",
  offsite_weekly_reduced_internacional: "0",
  offsite_weekly_complete_nacional: "0",
  offsite_weekly_complete_internacional: "0",
  payment_mode: "dietas",
  price_per_km: "0",
  price_per_km_nacional: "0",
  price_per_km_internacional: "0",
  price_per_km_regional: "0",
  price_per_trip: "0",
  price_per_trip_nacional: "0",
  price_per_trip_internacional: "0",
  price_per_trip_regional: "0",
  period_start_day: "20",
  period_end_day: "19",
  base_name: "",
  base_city: "",
  base_country: "",
  base_address: "",
  base_latitude: "",
  base_longitude: "",
  base_radius_km: "20",
};

interface Holiday {
  id: number;
  date: string;
  name: string;
}

function SectionHeader({ title, icon }: { title: string; icon: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Ionicons name={icon as any} size={18} color={Colors.light.tint} />
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function PriceField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.priceRow}>
      <Text style={styles.priceLabel}>{label}</Text>
      <View style={styles.priceInputWrap}>
        <TextInput
          style={styles.priceInput}
          value={value}
          onChangeText={onChange}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor="#9CA3AF"
          selectTextOnFocus
        />
        <Text style={styles.priceUnit}>EUR</Text>
      </View>
    </View>
  );
}

function ValueField({
  label,
  value,
  onChange,
  unit,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit: string;
  keyboardType?: "default" | "numeric" | "number-pad" | "decimal-pad";
}) {
  return (
    <View style={styles.priceRow}>
      <Text style={styles.priceLabel}>{label}</Text>
      <View style={styles.priceInputWrap}>
        <TextInput
          style={styles.priceInput}
          value={value}
          onChangeText={onChange}
          keyboardType={keyboardType || "decimal-pad"}
          placeholder="0"
          placeholderTextColor="#9CA3AF"
          selectTextOnFocus
        />
        <Text style={styles.priceUnit}>{unit}</Text>
      </View>
    </View>
  );
}

function NominaTable({
  rows,
}: {
  rows: Array<{
    concepto: string;
    cantidad: string;
    precio: string;
    total: string;
    secondary?: string;
  }>;
}) {
  return (
    <View style={styles.table}>
      <View style={[styles.tableRow, styles.tableHeaderRow]}>
        <Text style={[styles.tableCell, styles.tableHeaderText, styles.tableCellConcepto]}>Concepto</Text>
        <Text style={[styles.tableCell, styles.tableHeaderText, styles.tableCellCantidad]}>Cantidad</Text>
        <Text style={[styles.tableCell, styles.tableHeaderText, styles.tableCellPrecio]}>Precio</Text>
        <Text style={[styles.tableCell, styles.tableHeaderText, styles.tableCellTotal]}>Total</Text>
      </View>
      {rows.map((r, idx) => (
        <View key={`${r.concepto}-${idx}`} style={styles.tableRow}>
          <View style={[styles.tableCell, styles.tableCellConcepto]}>
            <Text style={styles.tableText}>{r.concepto}</Text>
            {r.secondary ? <Text style={styles.tableSecondary}>{r.secondary}</Text> : null}
          </View>
          <Text style={[styles.tableCell, styles.tableText, styles.tableCellCantidad]}>{r.cantidad}</Text>
          <Text style={[styles.tableCell, styles.tableText, styles.tableCellPrecio]}>{r.precio}</Text>
          <Text style={[styles.tableCell, styles.tableText, styles.tableCellTotal]}>{r.total}</Text>
        </View>
      ))}
    </View>
  );
}

function ImportExportCard() {
  const { config: ferryConfig } = useFerry();
  const { triggerDeleteSync } = useSync();
  const qc = useQueryClient();
  const { t } = useI18n();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const exportBackup = useCallback(async () => {
    if (!userId) return;
    const generatedAt = new Date().toISOString();
    const [settingsRaw, periodRaw, recentRaw, moroccoTripsRaw] = await Promise.all([
      AsyncStorage.getItem(await userScopedKey("tacoplan_user_settings", userId)).catch(() => null),
      AsyncStorage.getItem(await userScopedKey("tacoplan_period_config", userId)).catch(() => null),
      AsyncStorage.getItem(await userScopedKey("tacoplan_recent_places", userId)).catch(() => null),
      AsyncStorage.getItem(await userScopedKey("tacoplan_morocco_trips", userId)).catch(() => null),
    ]);
    const settings = settingsRaw ? JSON.parse(settingsRaw) : null;
    const periodConfig = periodRaw ? JSON.parse(periodRaw) : null;
    const recentPlaces = recentRaw ? JSON.parse(recentRaw) : [];
    const moroccoTrips = moroccoTripsRaw ? JSON.parse(moroccoTripsRaw) : [];
    const jornadas: Jornada[] = await listarJornadas();
    const compensaciones: Compensacion[] = await listarCompensaciones();
    const ferryRests = await getAllFerryRests();
    const viajes = await getAllViajes();
    const backup = {
      version: 1,
      generatedAt,
      settings,
      periodConfig,
      ferryConfig,
      recentPlaces,
      moroccoTrips,
      jornadas,
      compensaciones,
      ferryRests,
      viajes,
    };
    const json = JSON.stringify(backup, null, 2);
    const fileName = `tacoplan-backup-${generatedAt.substring(0,10)}.json`;
    if (typeof window !== "undefined") {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }, 0);
    } else {
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        const uri = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
        await Sharing.shareAsync(uri, {
          mimeType: "application/json",
          dialogTitle: "Exportar backup de Tacoplan",
          UTI: "public.json",
        }).catch(() => {});
      }
    }
  }, [ferryConfig, userId]);

  const clearCacheData = useCallback(async () => {
    if (!userId) return;
    const confirmText = "Esto borrará historial y dietas (compensaciones) del dispositivo. ¿Continuar?";
    const doClear = async () => {
      const jornadas = await listarJornadas();
      for (const j of jornadas) {
        await eliminarJornada(j.id);
        triggerDeleteSync(j.id);
      }
      await AsyncStorage.multiRemove([
        await userScopedKey("tacoplan_jornadas", userId),
        await userScopedKey("tacoplan_compensaciones", userId),
        await userScopedKey("tacoplan_ferry_rests", userId),
        await userScopedKey("tacoplan_active_ferry_rest", userId),
      ]);
      await qc.invalidateQueries({ queryKey: ["jornadas"] });
      await qc.invalidateQueries({ queryKey: ["estado-legal"] });
      await qc.invalidateQueries({ queryKey: ["compensaciones"] });
      await qc.invalidateQueries({ queryKey: ["ferry-rests"] });
      safeHaptic();
      Alert.alert("Limpieza completada", "Historial y dietas borrados.");
    };

    if (Platform.OS === "web") {
      if (window.confirm(confirmText)) {
        await doClear();
      }
      return;
    }

    Alert.alert("Limpiar caché", confirmText, [
      { text: t("common.cancel"), style: "cancel" },
      { text: "Borrar", style: "destructive", onPress: () => { void doClear(); } },
    ]);
  }, [qc, t, triggerDeleteSync, userId]);

  return (
    <View style={styles.card}>
      <SectionHeader title="Importar / Exportar" icon="swap-vertical-outline" />
      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.light.textSecondary, marginBottom: 10 }}>
        - Importar PDF/JSON de Tacoplan o guardar un backup completo para compartir/Drive.
      </Text>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Pressable
          style={({ pressed }) => [styles.saveBtn, { opacity: pressed ? 0.85 : 1, flex: 1 }]}
          onPress={() => router.push("/importar")}
        >
          <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
          <Text style={styles.saveBtnText}>Importar PDF/JSON</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.saveBtn, { opacity: pressed ? 0.85 : 1, flex: 1, backgroundColor: Colors.light.tint }]}
          onPress={exportBackup}
        >
          <Ionicons name="cloud-download-outline" size={18} color="#fff" />
          <Text style={styles.saveBtnText}>Guardar datos</Text>
        </Pressable>
      </View>
      <Pressable
        style={({ pressed }) => [
          styles.saveBtn,
          {
            opacity: pressed ? 0.85 : 1,
            marginTop: 10,
            backgroundColor: Colors.light.danger,
          },
        ]}
        onPress={clearCacheData}
      >
        <Ionicons name="trash-outline" size={18} color="#fff" />
        <Text style={styles.saveBtnText}>Limpiar caché (Historial + Dietas)</Text>
      </Pressable>
    </View>
  );
}

function PeriodSettingsCard() {
  const { config, saveConfig, getPeriod } = usePeriod();
  const { t } = useI18n();
  const [mode, setMode] = useState<PeriodMode>(config.mode);
  const [mFrom, setMFrom] = useState(String(config.manualFrom));
  const [mTo, setMTo] = useState(String(config.manualTo));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMode(config.mode);
    setMFrom(String(config.manualFrom));
    setMTo(String(config.manualTo));
  }, [config]);

  const preview = computeRange(
    mode,
    parseInt(mFrom, 10) || 1,
    parseInt(mTo, 10) || 30
  );

  const handleSave = async () => {
    if (mode === "MANUAL") {
      const sd = parseInt(mFrom, 10);
      const ed = parseInt(mTo, 10);
      if (isNaN(sd) || sd < 1 || sd > 31) {
        Alert.alert(t("common.error"), t("usuario.startDayRange"));
        return;
      }
      if (isNaN(ed) || ed < 1 || ed > 31) {
        Alert.alert(t("common.error"), t("usuario.endDayRange"));
        return;
      }
    }
    setSaving(true);
    try {
      await saveConfig({
        mode,
        manualFrom: parseInt(mFrom, 10) || 1,
        manualTo: parseInt(mTo, 10) || 30,
      });
      safeHaptic();
      const modeLabel =
        mode === "AUTO_MONTH"
          ? "Mes natural"
          : mode === "AUTO_01_30"
            ? t("usuario.del") + " 1 " + t("usuario.al") + " 30"
            : mode === "AUTO_20_20"
              ? t("usuario.del") + " 21 " + t("usuario.al") + " 20"
              : mFrom + " " + t("usuario.al") + " " + mTo;
      Alert.alert(t("usuario.saved"), `${t("usuario.periodConfigured")} ${modeLabel}`);
    } catch {
      Alert.alert(t("common.error"), t("usuario.couldNotSave"));
    }
    setSaving(false);
  };

  return (
    <View style={styles.card}>
      <SectionHeader title={t("usuario.accountingPeriod")} icon="calendar-number-outline" />

      <Pressable
        style={[styles.periodOption, mode === "AUTO_01_30" && styles.periodOptionSel]}
        onPress={() => setMode("AUTO_01_30")}
      >
        <Ionicons
          name={mode === "AUTO_01_30" ? "radio-button-on" : "radio-button-off"}
          size={20}
          color={mode === "AUTO_01_30" ? Colors.light.tint : "#9CA3AF"}
        />
        <Text style={styles.periodOptionText}>{t("usuario.auto0130")}</Text>
      </Pressable>

      <Pressable
        style={[styles.periodOption, mode === "AUTO_20_20" && styles.periodOptionSel]}
        onPress={() => setMode("AUTO_20_20")}
      >
        <Ionicons
          name={mode === "AUTO_20_20" ? "radio-button-on" : "radio-button-off"}
          size={20}
          color={mode === "AUTO_20_20" ? Colors.light.tint : "#9CA3AF"}
        />
        <Text style={styles.periodOptionText}>{t("usuario.auto2020")}</Text>
      </Pressable>

      <Pressable
        style={[styles.periodOption, mode === "AUTO_MONTH" && styles.periodOptionSel]}
        onPress={() => setMode("AUTO_MONTH")}
      >
        <Ionicons
          name={mode === "AUTO_MONTH" ? "radio-button-on" : "radio-button-off"}
          size={20}
          color={mode === "AUTO_MONTH" ? Colors.light.tint : "#9CA3AF"}
        />
        <Text style={styles.periodOptionText}>Mes natural</Text>
      </Pressable>

      <Pressable
        style={[styles.periodOption, mode === "MANUAL" && styles.periodOptionSel]}
        onPress={() => setMode("MANUAL")}
      >
        <Ionicons
          name={mode === "MANUAL" ? "radio-button-on" : "radio-button-off"}
          size={20}
          color={mode === "MANUAL" ? Colors.light.tint : "#9CA3AF"}
        />
        <Text style={styles.periodOptionText}>{t("usuario.manual")}</Text>
      </Pressable>

      {mode === "MANUAL" && (
        <View style={styles.periodCompactRow}>
          <Text style={styles.periodLabel}>{t("usuario.del")}</Text>
          <TextInput
            style={styles.periodSmallInput}
            value={mFrom}
            onChangeText={(v) => setMFrom(v.replace(/[^0-9]/g, ""))}
            keyboardType="number-pad"
            maxLength={2}
            selectTextOnFocus
          />
          <Text style={styles.periodLabel}>{t("usuario.al")}</Text>
          <TextInput
            style={styles.periodSmallInput}
            value={mTo}
            onChangeText={(v) => setMTo(v.replace(/[^0-9]/g, ""))}
            keyboardType="number-pad"
            maxLength={2}
            selectTextOnFocus
          />
        </View>
      )}

      <View style={styles.periodPreviewBox}>
        <Text style={styles.periodPreviewLabel}>{t("usuario.currentPeriod")}</Text>
        <Text style={styles.periodPreviewValue}>{preview.label}</Text>
      </View>

      <Pressable
        style={({ pressed }) => [styles.periodSaveBtn, { opacity: pressed ? 0.85 : 1 }]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Ionicons name="checkmark-circle" size={16} color="#fff" />
        )}
        <Text style={styles.periodSaveBtnText}>{t("usuario.savePeriod")}</Text>
      </Pressable>
    </View>
  );
}

function FerrySettingsCard() {
  const { t } = useI18n();
  const { config, updateConfig } = useFerry();
  const [tripRate, setTripRate] = useState(String(config.tripRate || ""));
  const [pernightRate, setPernightRate] = useState(String(config.pernightRate || ""));
  const [ferryTransitRate, setFerryTransitRate] = useState(String(config.ferryTransitRate ?? 54.30));
  const [ferryCabinRate, setFerryCabinRate] = useState(String(config.ferryCabinRate ?? 54.30));

  useEffect(() => {
    setTripRate(config.tripRate ? String(config.tripRate) : "");
    setPernightRate(config.pernightRate ? String(config.pernightRate) : "");
    setFerryTransitRate(String(config.ferryTransitRate ?? 54.30));
    setFerryCabinRate(String(config.ferryCabinRate ?? 54.30));
  }, [config.tripRate, config.pernightRate, config.ferryTransitRate, config.ferryCabinRate]);

  const toggleFerry = () => {
    const next = !config.crossesFerry;
    updateConfig({
      crossesFerry: next,
      ...(next ? {} : { routeMode: "spain", paymentMode: "spain_diet", ferryRestEnabled: false }),
    });
    safeHaptic();
  };

  const setRouteMode = (rm: RouteMode) => {
    updateConfig({
      routeMode: rm,
      paymentMode: rm === "spain" ? "spain_diet" : config.paymentMode === "spain_diet" ? "morocco_diet" : config.paymentMode,
    });
  };

  const setPaymentMode = (pm: PaymentMode) => {
    updateConfig({ paymentMode: pm });
  };

  const saveFerryRates = () => {
    const tr = parseFloat(tripRate) || 0;
    const pr = parseFloat(pernightRate) || 0;
    const ftr = Number.isFinite(parseFloat(ferryTransitRate)) ? parseFloat(ferryTransitRate) : 54.30;
    const fcr = Number.isFinite(parseFloat(ferryCabinRate)) ? parseFloat(ferryCabinRate) : 54.30;
    updateConfig({ tripRate: tr, pernightRate: pr, ferryTransitRate: ftr, ferryCabinRate: fcr });
    safeHaptic();
    Alert.alert(t("ferry.saved"), t("ferry.configSaved"));
  };

  return (
    <View style={styles.card}>
      <SectionHeader title={t("ferry.sectionTitle")} icon="boat-outline" />

      <Pressable style={styles.ferryToggleRow} onPress={toggleFerry}>
        <View style={styles.ferryToggleLabel}>
          <MaterialCommunityIcons name="ferry" size={20} color={Colors.light.tint} />
          <Text style={styles.ferryToggleText}>{t("ferry.crossesFerry")}</Text>
        </View>
        <View style={[styles.toggleTrack, config.crossesFerry && styles.toggleTrackOn]}>
          <View style={[styles.toggleThumb, config.crossesFerry && styles.toggleThumbOn]} />
        </View>
      </Pressable>

      {config.crossesFerry && (
        <>
          <Text style={[styles.subsectionLabel, { marginTop: 12 }]}>{t("ferry.routeMode")}</Text>

          <Pressable
            style={[styles.periodOption, config.routeMode === "spain" && styles.periodOptionSel]}
            onPress={() => setRouteMode("spain")}
          >
            <Ionicons
              name={config.routeMode === "spain" ? "radio-button-on" : "radio-button-off"}
              size={20}
              color={config.routeMode === "spain" ? Colors.light.tint : "#9CA3AF"}
            />
            <Text style={styles.periodOptionText}>{t("ferry.routeSpain")}</Text>
          </Pressable>

          <Pressable
            style={[styles.periodOption, config.routeMode === "morocco" && styles.periodOptionSel]}
            onPress={() => setRouteMode("morocco")}
          >
            <Ionicons
              name={config.routeMode === "morocco" ? "radio-button-on" : "radio-button-off"}
              size={20}
              color={config.routeMode === "morocco" ? Colors.light.tint : "#9CA3AF"}
            />
            <Text style={styles.periodOptionText}>{t("ferry.routeMorocco")}</Text>
          </Pressable>

          {config.routeMode === "morocco" && (
            <>
              <Text style={[styles.subsectionLabel, { marginTop: 12 }]}>{t("ferry.paymentMode")}</Text>

              {(["morocco_trip", "morocco_pernight", "morocco_diet"] as PaymentMode[]).map((pm) => (
                <Pressable
                  key={pm}
                  style={[styles.periodOption, config.paymentMode === pm && styles.periodOptionSel]}
                  onPress={() => setPaymentMode(pm)}
                >
                  <Ionicons
                    name={config.paymentMode === pm ? "radio-button-on" : "radio-button-off"}
                    size={20}
                    color={config.paymentMode === pm ? Colors.light.tint : "#9CA3AF"}
                  />
                  <Text style={styles.periodOptionText}>
                    {pm === "morocco_trip" ? t("ferry.paymentMoroccoTrip") : pm === "morocco_pernight" ? t("ferry.paymentMoroccoPernight") : t("ferry.paymentMoroccoDiet")}
                  </Text>
                </Pressable>
              ))}

              {config.paymentMode === "morocco_trip" && (
                <PriceField label={t("ferry.tripRate")} value={tripRate} onChange={setTripRate} />
              )}

              {config.paymentMode === "morocco_pernight" && (
                <PriceField label={t("ferry.pernightRate")} value={pernightRate} onChange={setPernightRate} />
              )}

              {(config.paymentMode === "morocco_trip" || config.paymentMode === "morocco_pernight") && (
                <Pressable
                  style={({ pressed }) => [styles.saveBtn, { opacity: pressed ? 0.85 : 1, marginTop: 8 }]}
                  onPress={saveFerryRates}
                >
                  <Ionicons name="checkmark-circle" size={18} color="#fff" />
                  <Text style={styles.saveBtnText}>{t("usuario.saveRates")}</Text>
                </Pressable>
              )}
            </>
          )}

          <View style={styles.subsectionDivider} />

          <Pressable style={styles.ferryToggleRow} onPress={() => { updateConfig({ ferryRestEnabled: !config.ferryRestEnabled }); safeHaptic(); }}>
            <View style={styles.ferryToggleLabel}>
              <Ionicons name="moon-outline" size={18} color={Colors.light.tint} />
              <Text style={styles.ferryToggleText}>{t("ferry.ferryRestEnabled")}</Text>
            </View>
            <View style={[styles.toggleTrack, config.ferryRestEnabled && styles.toggleTrackOn]}>
              <View style={[styles.toggleThumb, config.ferryRestEnabled && styles.toggleThumbOn]} />
            </View>
          </Pressable>
          {config.ferryRestEnabled && (
            <>
              <Text style={styles.ferryHint}>{t("ferry.ferryRestEnabledDesc")}</Text>

              <View style={{ marginTop: 12 }}>
                <Text style={[styles.subsectionLabel, { marginBottom: 4 }]}>{t("ferry.extrasRatesTitle")}</Text>
                <PriceField label={t("ferry.transitDietRate")} value={ferryTransitRate} onChange={setFerryTransitRate} />
                <PriceField label={t("ferry.cabinOvernightRate")} value={ferryCabinRate} onChange={setFerryCabinRate} />
                <Pressable
                  style={({ pressed }) => [styles.saveBtn, { opacity: pressed ? 0.85 : 1, marginTop: 8 }]}
                  onPress={saveFerryRates}
                >
                  <Ionicons name="checkmark-circle" size={18} color="#fff" />
                  <Text style={styles.saveBtnText}>{t("usuario.saveRates")}</Text>
                </Pressable>
              </View>
            </>
          )}
        </>
      )}
    </View>
  );
}

export default function UsuarioScreen() {
  const { t } = useI18n();
  const params = useLocalSearchParams<{ section?: string; from?: string; to?: string }>();
  const sectionParam = typeof params.section === "string" ? params.section : undefined;
  const fromParam = typeof params.from === "string" ? params.from : undefined;
  const toParam = typeof params.to === "string" ? params.to : undefined;
  const insets = useSafeAreaInsets();
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const webBottomPad = Platform.OS === "web" ? 34 : 0;
  const { user, logout, deleteAccount, isAdmin } = useAuth();
  const { triggerSync, startRestore, syncStatus, lastSyncTime, syncVersion } = useSync();
  const userId = user?.id ?? null;
  const { getPeriod, config: periodConfig } = usePeriod();

  const scrollRef = useRef<ScrollView>(null);
  const sectionYs = useRef<Record<string, number>>({});

  const normalizeSectionKey = useCallback((key?: string) => {
    if (!key) return null;
    const map: Record<string, string> = {
      cuenta: "cuenta",
      account: "cuenta",
      perfil: "perfil",
      perfil_conductor: "perfil_conductor",
      import_export: "import_export",
      importar_exportar: "import_export",
      sync: "sync",
      sincronizacion: "sync",
      precios_ref: "precios_ref",
      precios_referencia: "precios_ref",
      precios_referencia_menu: "precios_ref",
      precios_dietas: "precios",
      precios_extras: "extras_day",
      precios_dia_especial: "extras_day",
      precios_fuera_base: "extras_offsite",
      precios_descanso_fuera_base: "extras_offsite",
      precios_km: "km_prices",
      precios_viaje: "trip_prices",
      cobro_nomina: "cobro_nomina",
      nomina: "cobro_nomina",
      periodos: "periodos",
      precios: "precios",
      extras: "extras_day",
      dia_especial: "extras_day",
      day_extras: "extras_day",
      tipo_cobro: "tipo_cobro",
      periodo: "periodo",
      festivos: "festivos",
      notificaciones: "notificaciones",
      seguridad: "seguridad",
      admin: "admin",
    };
    return map[key] || key;
  }, []);

  const activeSection = normalizeSectionKey(sectionParam);
  const showOnlySection = !!activeSection;
  const shouldShowSection = useCallback((key: string) => {
    if (!showOnlySection) return true;
    return activeSection === key;
  }, [activeSection, showOnlySection]);

  const headerTitle = useMemo(() => {
    if (!showOnlySection) return t("usuario.title");
    switch (activeSection) {
      case "cuenta": return "Cuenta";
      case "perfil": return t("usuario.profile");
      case "seguridad": return "Seguridad / Cuenta";
      case "sync": return "Sincronización";
      case "import_export": return "Importar / Exportar";
      case "precios_ref": return "Precios de referencia";
      case "precios": return "Dietas";
      case "extras_day": return "Día especial / Extras";
      case "extras_offsite": return "Descanso fuera de base";
      case "km_prices": return "Kilómetros";
      case "trip_prices": return "Precio por viaje";
      case "cobro_nomina": return "Cobro y nómina";
      case "config_nomina": return "Configuración de nómina";
      case "estimacion_nomina": return "Estimación de nómina";
      case "irpf_cotizacion": return "Cotización / IRPF orientativo";
      case "periodos": return "Periodos";
      case "extras": return t("usuario.dayExtras");
      case "tipo_cobro": return t("usuario.paymentMode");
      case "periodo": return "Periodo de contabilización";
      case "perfil_conductor": return t("ferry.sectionTitle");
      case "festivos": return t("usuario.holidays");
      case "notificaciones": return "Notificaciones";
      case "admin": return "Admin";
      default: return t("usuario.title");
    }
  }, [activeSection, showOnlySection, t]);

  const openSection = useCallback((section: string) => {
    router.push({ pathname: "/usuario", params: { section } } as any);
  }, []);

  const rootCategories = useMemo(
    () => [
      { key: "cuenta", label: "Cuenta", icon: "person-outline" as const },
      { key: "sync", label: "Sincronización", icon: "cloud-outline" as const },
      { key: "import_export", label: "Importar / Exportar", icon: "swap-vertical-outline" as const },
      { key: "precios_ref", label: "Precios de referencia", icon: "pricetag-outline" as const },
      { key: "cobro_nomina", label: "Cobro y nómina", icon: "wallet-outline" as const },
      { key: "periodos", label: "Periodos", icon: "calendar-outline" as const },
      { key: "perfil_conductor", label: "Perfil del conductor", icon: "car-outline" as const },
      { key: "festivos", label: "Festivos", icon: "flag-outline" as const },
      { key: "notificaciones", label: "Notificaciones", icon: "notifications-outline" as const },
      ...(isAdmin ? [{ key: "admin", label: "Admin", icon: "lock-closed-outline" as const }] : []),
      { key: "seguridad", label: "Seguridad", icon: "shield-checkmark-outline" as const },
    ],
    [isAdmin],
  );

  const renderMenuList = useCallback((items: Array<{ key: string; label: string; icon: any }>) => {
    return (
      <View>
        {items.map((it) => (
          <Pressable
            key={it.key}
            style={({ pressed }) => [
              styles.ferryToggleRow,
              { opacity: pressed ? 0.85 : 1 },
            ]}
            onPress={() => openSection(it.key)}
          >
            <View style={styles.ferryToggleLabel}>
              <Ionicons name={it.icon} size={18} color={Colors.light.tint} />
              <Text style={styles.ferryToggleText}>{it.label}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.light.textSecondary} />
          </Pressable>
        ))}
      </View>
    );
  }, [openSection]);

  useEffect(() => {
    const target = normalizeSectionKey(sectionParam);
    if (!target) return;
    const y = sectionYs.current[target];
    if (y == null) return;
    const id = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
    });
    return () => cancelAnimationFrame(id);
  }, [sectionParam, normalizeSectionKey]);

  const [profileName, setProfileName] = useState(user?.name || "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [pushRemindersEnabled, setPushRemindersEnabled] = useState(true);
  const [payrollNotificationsEnabled, setPayrollNotificationsEnabled] = useState(true);
  const [savingNotifPrefs, setSavingNotifPrefs] = useState(false);
  const [pushPermissionStatus, setPushPermissionStatus] = useState<string>("unknown");
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [loadingPushInfo, setLoadingPushInfo] = useState(false);
  const [sendingTestPush, setSendingTestPush] = useState(false);

  type PayrollConfig = {
    fixed_unit: "day" | "month";
    salario_base_bruto: string;
    plus_convenio: string;
    complemento: string;
    pagas_prorrateadas: string;
    productividad_fija: string;
    otros_conceptos_fijos: string;
    irpf_mode: "auto" | "manual";
    irpf_manual_pct: string;
    irpf_auto_applied_pct: string;
    ss_cc_pct: string;
    ss_desempleo_pct: string;
    ss_fp_pct: string;
    ss_mei_pct: string;
    dietas_cotizan: boolean;
    extras_cotizan: boolean;
    descanso_fuera_base_cotiza: boolean;
    pluses_cotizan: boolean;
  };

  const DEFAULT_PAYROLL_CONFIG: PayrollConfig = {
    fixed_unit: "day",
    salario_base_bruto: "0",
    plus_convenio: "0",
    complemento: "0",
    pagas_prorrateadas: "0",
    productividad_fija: "0",
    otros_conceptos_fijos: "0",
    irpf_mode: "auto",
    irpf_manual_pct: "0",
    irpf_auto_applied_pct: "0",
    ss_cc_pct: "4.70",
    ss_desempleo_pct: "1.55",
    ss_fp_pct: "0.10",
    ss_mei_pct: "0.13",
    dietas_cotizan: false,
    extras_cotizan: true,
    descanso_fuera_base_cotiza: true,
    pluses_cotizan: true,
  };

  const [payrollConfig, setPayrollConfig] = useState<PayrollConfig>(DEFAULT_PAYROLL_CONFIG);
  const [loadingPayrollConfig, setLoadingPayrollConfig] = useState(false);
  const [savingPayrollConfig, setSavingPayrollConfig] = useState(false);
  const [payrollEstimate, setPayrollEstimate] = useState<any | null>(null);
  const [loadingPayrollEstimate, setLoadingPayrollEstimate] = useState(false);

  const [settings, setSettings] = useState<UserSettings>({ ...DEFAULT_SETTINGS });
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [savingRates, setSavingRates] = useState(false);
  const [savingExtras, setSavingExtras] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loadingHolidays, setLoadingHolidays] = useState(false);
  const [newHolidayDate, setNewHolidayDate] = useState("");
  const [newHolidayName, setNewHolidayName] = useState("");
  const [addingHoliday, setAddingHoliday] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoadingSettings(true);
    try {
      if (!userId) {
        setLoadingSettings(false);
        return;
      }
      const cfg = await getUserConfig(userId);
      setSettings((prev) => {
        const merged = { ...prev, ...(cfg.settings as any) };
        const fallbackKm = merged.price_per_km ?? "0";
        if (merged.price_per_km_nacional == null) merged.price_per_km_nacional = fallbackKm;
        if (merged.price_per_km_internacional == null) merged.price_per_km_internacional = fallbackKm;
        if (merged.price_per_km_regional == null) merged.price_per_km_regional = fallbackKm;
        const fallbackTrip = merged.price_per_trip ?? "0";
        if (merged.price_per_trip_nacional == null) merged.price_per_trip_nacional = fallbackTrip;
        if (merged.price_per_trip_internacional == null) merged.price_per_trip_internacional = fallbackTrip;
        if (merged.price_per_trip_regional == null) merged.price_per_trip_regional = fallbackTrip;
        return merged;
      });
    } catch (e) {
      console.log("Failed to load settings:", e);
    }
    setLoadingSettings(false);
  }, [userId]);

  const loadHolidays = useCallback(async () => {
    if (!userId) return;
    setLoadingHolidays(true);
    try {
      const rows = await fetchHolidays(userId);
      setHolidays(rows.map((h) => ({ id: h.id, date: h.date, name: h.description || "" })));
    } catch (e: any) {
      console.log("Failed to load holidays:", e);
    }
    setLoadingHolidays(false);
  }, [userId]);

  const loadNotifPrefs = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await supabase
        .from("profiles")
        .select("notifications_enabled,push_reminders_enabled,payroll_notifications_enabled")
        .eq("id", userId)
        .maybeSingle();
      if (res.error) {
        const fallback = await supabase
          .from("profiles")
          .select("notifications_enabled,push_reminders_enabled")
          .eq("id", userId)
          .maybeSingle();
        if (fallback.error) return;
        setNotificationsEnabled((fallback.data as any)?.notifications_enabled !== false);
        setPushRemindersEnabled((fallback.data as any)?.push_reminders_enabled !== false);
        setPayrollNotificationsEnabled(true);
        return;
      }
      setNotificationsEnabled((res.data as any)?.notifications_enabled !== false);
      setPushRemindersEnabled((res.data as any)?.push_reminders_enabled !== false);
      setPayrollNotificationsEnabled((res.data as any)?.payroll_notifications_enabled !== false);
    } catch {}
  }, [userId]);

  const loadPushInfo = useCallback(async () => {
    if (!userId) return;
    if (Platform.OS === "web") {
      setPushPermissionStatus("unavailable");
      setPushToken(null);
      return;
    }
    setLoadingPushInfo(true);
    try {
      const Notifications = await import("expo-notifications");
      const perm = await Notifications.getPermissionsAsync().catch(() => null as any);
      const status = perm?.status ? String(perm.status) : "unknown";
      setPushPermissionStatus(status);

      const tokenRes = await supabase
        .from("push_tokens")
        .select("expo_push_token,updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setPushToken((tokenRes.data as any)?.expo_push_token ?? null);
    } catch {
      setPushPermissionStatus("unknown");
      setPushToken(null);
    } finally {
      setLoadingPushInfo(false);
    }
  }, [userId]);

  const requestAndSyncPushToken = useCallback(async () => {
    if (!userId) return;
    if (Platform.OS === "web") {
      Alert.alert("No disponible", "Las notificaciones push no están disponibles en web.");
      return;
    }
    if (loadingPushInfo) return;
    setLoadingPushInfo(true);
    try {
      const res = await registerPushToken();
      if (!res.ok) {
        setPushPermissionStatus(res.permissionStatus ? String(res.permissionStatus) : "unknown");
        Alert.alert("Error", res.message || "No se pudo registrar el token push");
        return;
      }
      setPushPermissionStatus(res.permissionStatus ? String(res.permissionStatus) : "granted");
      setNotificationsEnabled(true);
      setPushToken(res.expoPushToken || null);
      safeHaptic();
      Alert.alert("Notificaciones activadas", "Permiso concedido y token registrado.");
    } catch (e: any) {
      Alert.alert("Error", e?.message || String(e));
    } finally {
      setLoadingPushInfo(false);
    }
  }, [loadingPushInfo, userId]);

  const sendTestPush = useCallback(async () => {
    if (!userId) return;
    if (sendingTestPush) return;
    setSendingTestPush(true);
    try {
      const res: any = await (supabase as any).functions.invoke("send-self-test", {
        body: {
          title: "Tacoplan",
          body: "Notificación de prueba",
          data: { type: "test" },
        },
      });
      if (res?.error) throw res.error;
      safeHaptic();
      Alert.alert("OK", "Notificación de prueba enviada. Si no llega, revisa permisos y modo ahorro.");
    } catch (e: any) {
      Alert.alert("Error", e?.message || String(e));
    } finally {
      setSendingTestPush(false);
    }
  }, [sendingTestPush, userId]);

  const loadPayrollConfig = useCallback(async () => {
    if (!userId) return;
    setLoadingPayrollConfig(true);
    try {
      let loaded: any = null;
      try {
        const res = await supabase.from("profiles").select("payroll_config").eq("id", userId).maybeSingle();
        if (!res.error) loaded = (res.data as any)?.payroll_config ?? null;
      } catch {}

      if (!loaded) {
        const k = await userScopedKey("tacoplan_payroll_config", userId);
        const raw = await AsyncStorage.getItem(k).catch(() => null);
        loaded = raw ? JSON.parse(raw) : null;
      }

      if (loaded && typeof loaded === "object") {
        const hasNewSs =
          loaded.ss_cc_pct != null ||
          loaded.ss_desempleo_pct != null ||
          loaded.ss_fp_pct != null ||
          loaded.ss_mei_pct != null;
        const legacySsTotal = loaded.ss_trabajador_pct != null ? String(loaded.ss_trabajador_pct) : null;
        setPayrollConfig((prev) => ({
          ...prev,
          fixed_unit: loaded.fixed_unit === "month" ? "month" : "day",
          salario_base_bruto: String(loaded.salario_base_bruto ?? prev.salario_base_bruto),
          plus_convenio: String(loaded.plus_convenio ?? prev.plus_convenio),
          complemento: String(loaded.complemento ?? prev.complemento),
          pagas_prorrateadas: String(loaded.pagas_prorrateadas ?? prev.pagas_prorrateadas),
          productividad_fija: String(loaded.productividad_fija ?? prev.productividad_fija),
          otros_conceptos_fijos: String(loaded.otros_conceptos_fijos ?? prev.otros_conceptos_fijos),
          irpf_mode: loaded.irpf_mode === "manual" ? "manual" : "auto",
          irpf_manual_pct: String(loaded.irpf_manual_pct ?? prev.irpf_manual_pct),
          irpf_auto_applied_pct: String(loaded.irpf_auto_applied_pct ?? prev.irpf_auto_applied_pct),
          ss_cc_pct: hasNewSs ? String(loaded.ss_cc_pct ?? prev.ss_cc_pct) : (legacySsTotal ?? prev.ss_cc_pct),
          ss_desempleo_pct: hasNewSs ? String(loaded.ss_desempleo_pct ?? prev.ss_desempleo_pct) : "0",
          ss_fp_pct: hasNewSs ? String(loaded.ss_fp_pct ?? prev.ss_fp_pct) : "0",
          ss_mei_pct: hasNewSs ? String(loaded.ss_mei_pct ?? prev.ss_mei_pct) : "0",
          dietas_cotizan: loaded.dietas_cotizan === true,
          extras_cotizan: loaded.extras_cotizan !== false,
          descanso_fuera_base_cotiza: loaded.descanso_fuera_base_cotiza !== false,
          pluses_cotizan: loaded.pluses_cotizan !== false,
        }));
      } else {
        setPayrollConfig(DEFAULT_PAYROLL_CONFIG);
      }
    } catch {}
    setLoadingPayrollConfig(false);
  }, [userId]);

  const savePayrollConfig = useCallback(async () => {
    if (!userId) return;
    if (savingPayrollConfig) return;
    setSavingPayrollConfig(true);
    const nowIso = new Date().toISOString();
    try {
      const k = await userScopedKey("tacoplan_payroll_config", userId);
      await AsyncStorage.setItem(k, JSON.stringify({ ...payrollConfig, _updated_at: nowIso }));
      try {
        await supabase
          .from("profiles")
          .update({ payroll_config: payrollConfig, payroll_config_updated_at: nowIso, updated_at: nowIso } as any)
          .eq("id", userId);
      } catch {}
      safeHaptic();
      Alert.alert("Guardado", "Configuración de nómina actualizada.");
    } catch (e: any) {
      Alert.alert("Error", e?.message || String(e));
    }
    setSavingPayrollConfig(false);
  }, [payrollConfig, savingPayrollConfig, userId]);

  const applyIrpfRecommended = useCallback(async () => {
    if (!userId) return;
    const rec = Number((payrollEstimate as any)?.irpfRecommendedPct ?? 0);
    if (!Number.isFinite(rec) || rec <= 0) return;
    if (savingPayrollConfig) return;
    const nowIso = new Date().toISOString();
    const nextCfg = { ...payrollConfig, irpf_mode: "auto" as const, irpf_auto_applied_pct: String(rec) };
    setPayrollConfig(nextCfg);
    setSavingPayrollConfig(true);
    try {
      const k = await userScopedKey("tacoplan_payroll_config", userId);
      await AsyncStorage.setItem(k, JSON.stringify({ ...nextCfg, _updated_at: nowIso }));
      try {
        await supabase
          .from("profiles")
          .update({ payroll_config: nextCfg, payroll_config_updated_at: nowIso, updated_at: nowIso } as any)
          .eq("id", userId);
      } catch {}
      safeHaptic();
    } catch {}
    setSavingPayrollConfig(false);
  }, [payrollConfig, payrollEstimate, savingPayrollConfig, userId]);

  const estimateRange = useMemo(() => {
    const ok = (v?: string) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (ok(fromParam) && ok(toParam)) {
      const fmt = (s: string) => {
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
      };
      return { from: fromParam!, to: toParam!, label: `${fmt(fromParam!)} - ${fmt(toParam!)}` };
    }
    const p = getPeriod(0);
    return p;
  }, [fromParam, getPeriod, toParam]);

  const payrollVm = useMemo(() => {
    const e: any = payrollEstimate;
    if (!e) return null;

    const daysComputed = Number(e.daysComputed || 0);
    const baseDays = Number(e.baseDays || 0) || Math.max(1, daysComputed);
    const daysWorked = Number(e.daysWorked || 0);

    const pf = (v: any) => {
      const n = parseFloat(String(v ?? "0").replace(",", "."));
      return Number.isFinite(n) ? n : 0;
    };
    const round2 = (n: number) => Math.round(n * 100) / 100;

    const fixedUnit = payrollConfig.fixed_unit;
    const fixedConcepts: Array<{ key: keyof PayrollConfig; label: string }> = [
      { key: "salario_base_bruto", label: "Salario base" },
      { key: "plus_convenio", label: "Plus convenio" },
      { key: "complemento", label: "Complemento" },
      { key: "pagas_prorrateadas", label: "Pagas prorrateadas" },
      { key: "productividad_fija", label: "Productividad fija" },
      { key: "otros_conceptos_fijos", label: "Otros conceptos fijos" },
    ];

    const fixedRows = fixedConcepts
      .map((c) => {
        const amount = pf((payrollConfig as any)[c.key]);
        if (amount <= 0) return null;
        const isWorkedDayConcept = c.key === "complemento" || c.key === "productividad_fija";
        const conceptDays = fixedUnit === "day" ? daysWorked : (isWorkedDayConcept ? daysWorked : daysComputed);
        if (conceptDays <= 0) return null;
        if (fixedUnit === "day") {
          const total = round2(amount * conceptDays);
          return {
            concepto: c.label,
            cantidad: `${conceptDays} días`,
            precio: `${formatEUR(amount)}/día`,
            total: formatEUR(total),
            secondary: null as any,
          };
        }
        const priceDay = amount / Math.max(1, baseDays);
        const total = round2(priceDay * conceptDays);
        return {
          concepto: c.label,
          cantidad: `${conceptDays} días`,
          precio: `${formatEUR(priceDay)}/día`,
          total: formatEUR(total),
          secondary: `${formatEUR(amount)}/mes${isWorkedDayConcept ? " · prorratea por días trabajados" : ""}`,
        };
      })
      .filter(Boolean) as any[];

    const mapExtraLabel = (k: string) => {
      if (k === "SABADO") return "Sábado";
      if (k === "DOMINGO") return "Domingo";
      if (k === "FESTIVO") return "Festivo";
      if (k === "PLUS_DOMINGO") return "Plus domingo";
      if (k === "PLUS_FESTIVO") return "Plus festivo";
      return k;
    };

    const mapDietLabel = (k: string) => {
      if (k === "NAC_INTL_AUTO") return "Dieta NAC+INTL";
      if (/^NACIONAL_(100|60|30)$/.test(k)) return `Dieta nacional ${k.split("_")[1]}%`;
      if (/^INTERNACIONAL_(100|60|30)$/.test(k)) return `Dieta internacional ${k.split("_")[1]}%`;
      if (/^REGIONAL_(100|60|30)$/.test(k)) return `Dieta regional ${k.split("_")[1]}%`;
      if (k.startsWith("FUERA_BASE_WEEKLY_REDUCED_INTERNACIONAL")) return "Dieta · Descanso fuera de base reducido (Internacional)";
      if (k.startsWith("FUERA_BASE_WEEKLY_REDUCED_NACIONAL")) return "Dieta · Descanso fuera de base reducido (Nacional)";
      if (k.startsWith("FUERA_BASE_WEEKLY_COMPLETE_INTERNACIONAL")) return "Dieta · Descanso fuera de base completo (Internacional)";
      if (k.startsWith("FUERA_BASE_WEEKLY_COMPLETE_NACIONAL")) return "Dieta · Descanso fuera de base completo (Nacional)";
      return k;
    };

    const dietasDesglose = Array.isArray(e.dietasDesglose) ? e.dietasDesglose : [];
    const extrasDesglose = Array.isArray(e.extrasDesglose) ? e.extrasDesglose : [];
    const plusDesglose = Array.isArray(e.plusDesglose) ? e.plusDesglose : [];

    const offsiteItems = dietasDesglose.filter((it: any) => typeof it?.tipo === "string" && it.tipo.startsWith("FUERA_BASE_"));
    const dietItems = dietasDesglose.filter((it: any) => typeof it?.tipo === "string" && !it.tipo.startsWith("FUERA_BASE_"));

    const baseLabel =
      settings.payment_mode === "km"
        ? "Cobro por km"
        : settings.payment_mode === "viaje"
          ? "Cobro por viaje"
          : "Base";

    const varCotRows: any[] = [];
    if (!isZero(Number(e.baseVariable || 0))) {
      varCotRows.push({
        concepto: baseLabel,
        cantidad: "—",
        precio: "—",
        total: formatEUR(Number(e.baseVariable || 0)),
        secondary: null,
      });
    }

    if (payrollConfig.dietas_cotizan) {
      for (const it of dietItems) {
        const total = pf(it?.total);
        const qty = Number(it?.cantidad || 0);
        if (isZero(total)) continue;
        const price = qty > 0 ? total / qty : total;
        varCotRows.push({
          concepto: mapDietLabel(String(it?.tipo || "")),
          cantidad: qty > 0 ? String(qty) : "—",
          precio: qty > 0 ? formatEUR(price) : "—",
          total: formatEUR(total),
          secondary: null,
        });
      }
    }

    if (payrollConfig.extras_cotizan) {
      for (const it of extrasDesglose) {
        const total = pf(it?.total);
        const qty = Number(it?.cantidad || 0);
        if (isZero(total)) continue;
        const price = qty > 0 ? total / qty : total;
        varCotRows.push({
          concepto: mapExtraLabel(String(it?.tipo || "")),
          cantidad: qty > 0 ? String(qty) : "—",
          precio: qty > 0 ? formatEUR(price) : "—",
          total: formatEUR(total),
          secondary: null,
        });
      }
    }

    if (payrollConfig.pluses_cotizan) {
      for (const it of plusDesglose) {
        const total = pf(it?.total);
        const qty = Number(it?.cantidad || 0);
        if (isZero(total)) continue;
        const price = qty > 0 ? total / qty : total;
        varCotRows.push({
          concepto: String(it?.tipo || "Plus"),
          cantidad: qty > 0 ? String(qty) : "—",
          precio: qty > 0 ? formatEUR(price) : "—",
          total: formatEUR(total),
          secondary: null,
        });
      }
    }

    if (payrollConfig.descanso_fuera_base_cotiza) {
      for (const it of offsiteItems) {
        const total = pf(it?.total);
        const qty = Number(it?.cantidad || 0);
        if (isZero(total)) continue;
        const price = qty > 0 ? total / qty : total;
        varCotRows.push({
          concepto: mapDietLabel(String(it?.tipo || "")),
          cantidad: qty > 0 ? String(qty) : "—",
          precio: qty > 0 ? formatEUR(price) : "—",
          total: formatEUR(total),
          secondary: null,
        });
      }
    }

    const nonCotRows: any[] = [];

    if (!payrollConfig.dietas_cotizan) {
      for (const it of dietItems) {
        const total = pf(it?.total);
        const qty = Number(it?.cantidad || 0);
        if (isZero(total)) continue;
        const price = qty > 0 ? total / qty : total;
        nonCotRows.push({
          concepto: mapDietLabel(String(it?.tipo || "")),
          cantidad: qty > 0 ? String(qty) : "—",
          precio: qty > 0 ? formatEUR(price) : "—",
          total: formatEUR(total),
          secondary: null,
        });
      }
    }

    if (!payrollConfig.descanso_fuera_base_cotiza) {
      for (const it of offsiteItems) {
        const total = pf(it?.total);
        const qty = Number(it?.cantidad || 0);
        if (isZero(total)) continue;
        const price = qty > 0 ? total / qty : total;
        nonCotRows.push({
          concepto: mapDietLabel(String(it?.tipo || "")),
          cantidad: qty > 0 ? String(qty) : "—",
          precio: qty > 0 ? formatEUR(price) : "—",
          total: formatEUR(total),
          secondary: null,
        });
      }
    }

    if (!payrollConfig.extras_cotizan) {
      for (const it of extrasDesglose) {
        const total = pf(it?.total);
        const qty = Number(it?.cantidad || 0);
        if (isZero(total)) continue;
        const price = qty > 0 ? total / qty : total;
        nonCotRows.push({
          concepto: mapExtraLabel(String(it?.tipo || "")),
          cantidad: qty > 0 ? String(qty) : "—",
          precio: qty > 0 ? formatEUR(price) : "—",
          total: formatEUR(total),
          secondary: null,
        });
      }
    }

    if (!payrollConfig.pluses_cotizan) {
      for (const it of plusDesglose) {
        const total = pf(it?.total);
        const qty = Number(it?.cantidad || 0);
        if (isZero(total)) continue;
        const price = qty > 0 ? total / qty : total;
        nonCotRows.push({
          concepto: String(it?.tipo || "Plus"),
          cantidad: qty > 0 ? String(qty) : "—",
          precio: qty > 0 ? formatEUR(price) : "—",
          total: formatEUR(total),
          secondary: null,
        });
      }
    }

    const deductions: Array<{ label: string; amount: number; pct?: number }> = [];
    if (!isZero(Number(e.ssCc || 0))) deductions.push({ label: "Contingencias comunes", amount: Number(e.ssCc || 0), pct: Number(e.ssCcPct || 0) });
    if (!isZero(Number(e.ssDes || 0))) deductions.push({ label: "Desempleo", amount: Number(e.ssDes || 0), pct: Number(e.ssDesPct || 0) });
    if (!isZero(Number(e.ssFp || 0))) deductions.push({ label: "Formación profesional", amount: Number(e.ssFp || 0), pct: Number(e.ssFpPct || 0) });
    if (!isZero(Number(e.ssMei || 0))) deductions.push({ label: "MEI", amount: Number(e.ssMei || 0), pct: Number(e.ssMeiPct || 0) });

    return {
      periodLabel: String(e.periodLabel || `${formatFechaES(estimateRange.from)} - ${formatFechaES(estimateRange.to)}`),
      daysComputed,
      daysWorked,
      baseDays,
      fixedUnit,
      fixedRows,
      varCotRows,
      nonCotRows,
      fixedTotal: Number(e.fixedTotal || 0),
      varCotizable: Number(e.varCotizable || 0),
      totalNoCotizable: Number(e.totalNoCotizable || 0),
      brutoCotizable: Number(e.brutoCotizable || 0),
      brutoTotal: Number(e.brutoTotal || 0),
      ssTotal: Number(e.ss || 0),
      irpfTotal: Number(e.irpf || 0),
      neto: Number(e.neto || 0),
      deductions,
      irpfMode: String(e.irpfMode || payrollConfig.irpf_mode),
      irpfAppliedPct: Number(e.irpfAppliedPct || 0),
      irpfRecommendedPct: Number(e.irpfRecommendedPct || 0),
      irpfAnnualBase: Number(e.irpfAnnualBase || 0),
    };
  }, [estimateRange.from, estimateRange.to, payrollConfig, payrollEstimate, settings.payment_mode]);

  useEffect(() => {
    if (activeSection !== "estimacion_nomina") return;
    const from = estimateRange.from;
    const to = estimateRange.to;

    const pf = (v: any) => {
      const n = parseFloat(String(v ?? "0").replace(",", "."));
      return Number.isFinite(n) ? n : 0;
    };
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const fixedUnit = payrollConfig.fixed_unit;
    const fixedPerUnit =
      pf(payrollConfig.salario_base_bruto) +
      pf(payrollConfig.plus_convenio) +
      pf(payrollConfig.complemento) +
      pf(payrollConfig.pagas_prorrateadas) +
      pf(payrollConfig.productividad_fija) +
      pf(payrollConfig.otros_conceptos_fijos);

    setLoadingPayrollEstimate(true);
    (async () => {
      try {
        const daysComputed = daysBetweenInclusive(from, to);
        const baseDays = periodConfig.mode === "AUTO_01_30" ? 30 : daysComputed;
        const jornadas = await listarJornadas();
        const uniqueWorked = new Set<string>();
        for (const j of jornadas || []) {
          if (!j?.fechaInicio) continue;
          if (!j.fechaFin) continue;
          if (j.fechaInicio < from) continue;
          if (j.fechaInicio > to) continue;
          uniqueWorked.add(String(j.fechaInicio));
        }
        const daysWorked = uniqueWorked.size;

        const fixedConceptKeys: Array<keyof PayrollConfig> = [
          "salario_base_bruto",
          "plus_convenio",
          "complemento",
          "pagas_prorrateadas",
          "productividad_fija",
          "otros_conceptos_fijos",
        ];

        let fixedTotalRaw = 0;
        for (const k of fixedConceptKeys) {
          const amount = pf((payrollConfig as any)[k]);
          if (!Number.isFinite(amount) || amount <= 0) continue;

          if (fixedUnit === "day") {
            fixedTotalRaw += amount * daysWorked;
            continue;
          }

          const priceDay = amount / Math.max(1, baseDays);
          const multiplierDays = (k === "complemento" || k === "productividad_fija") ? daysWorked : daysComputed;
          fixedTotalRaw += priceDay * multiplierDays;
        }
        const fixedTotal = round2(fixedTotalRaw);

        let baseVariable = 0;
        let dietasTotal = 0;
        let descansoFueraBase = 0;
        let extras = 0;
        let pluses = 0;
        let dietasDesglose: any[] = [];
        let extrasDesglose: any[] = [];
        let plusDesglose: any[] = [];

        if (settings.payment_mode === "km") {
          const r: any = await getResumenKm(from, to);
          baseVariable = pf(r?.totalImporte);
          dietasTotal = pf(r?.dietas?.totalDietas);
          extras = pf(r?.extras?.totalExtras);
          pluses = pf(r?.plus?.totalPlus);
          dietasDesglose = Array.isArray(r?.dietas?.desglose) ? r.dietas.desglose : [];
          extrasDesglose = Array.isArray(r?.extras?.desglose) ? r.extras.desglose : [];
          plusDesglose = Array.isArray(r?.plus?.desglose) ? r.plus.desglose : [];
          const desg = dietasDesglose;
          for (const it of desg) {
            if (typeof it?.tipo === "string" && it.tipo.startsWith("FUERA_BASE_")) {
              descansoFueraBase += pf(it.total);
            }
          }
        } else if (settings.payment_mode === "viaje") {
          const r: any = await getResumenViaje(from, to);
          baseVariable = pf(r?.totalImporte);
          dietasTotal = pf(r?.dietas?.totalDietas);
          extras = pf(r?.extras?.totalExtras);
          pluses = pf(r?.plus?.totalPlus);
          dietasDesglose = Array.isArray(r?.dietas?.desglose) ? r.dietas.desglose : [];
          extrasDesglose = Array.isArray(r?.extras?.desglose) ? r.extras.desglose : [];
          plusDesglose = Array.isArray(r?.plus?.desglose) ? r.plus.desglose : [];
          const desg = dietasDesglose;
          for (const it of desg) {
            if (typeof it?.tipo === "string" && it.tipo.startsWith("FUERA_BASE_")) {
              descansoFueraBase += pf(it.total);
            }
          }
        } else {
          const r: any = await getResumenDietas(from, to);
          dietasTotal = pf(r?.total);
          extras = pf(r?.extras?.totalExtras);
          pluses = pf(r?.plus?.totalPlus);
          dietasDesglose = Array.isArray(r?.desglose) ? r.desglose : [];
          extrasDesglose = Array.isArray(r?.extras?.desglose) ? r.extras.desglose : [];
          plusDesglose = Array.isArray(r?.plus?.desglose) ? r.plus.desglose : [];
          const desg = dietasDesglose;
          for (const it of desg) {
            if (typeof it?.tipo === "string" && it.tipo.startsWith("FUERA_BASE_")) {
              descansoFueraBase += pf(it.total);
            }
          }
        }

        const dietasRegular = Math.max(0, round2(dietasTotal - descansoFueraBase));

        let varCotizable = 0;
        let varNoCotizable = 0;

        if (baseVariable > 0) varCotizable += baseVariable;
        if (dietasRegular > 0) (payrollConfig.dietas_cotizan ? (varCotizable += dietasRegular) : (varNoCotizable += dietasRegular));
        if (extras > 0) (payrollConfig.extras_cotizan ? (varCotizable += extras) : (varNoCotizable += extras));
        if (pluses > 0) (payrollConfig.pluses_cotizan ? (varCotizable += pluses) : (varNoCotizable += pluses));
        if (descansoFueraBase > 0) (payrollConfig.descanso_fuera_base_cotiza ? (varCotizable += descansoFueraBase) : (varNoCotizable += descansoFueraBase));

        const brutoCotizable = round2(fixedTotal + varCotizable);
        const totalNoCotizable = round2(varNoCotizable);
        const brutoTotal = round2(brutoCotizable + totalNoCotizable);

        const ssCcPct = pf(payrollConfig.ss_cc_pct);
        const ssDesPct = pf(payrollConfig.ss_desempleo_pct);
        const ssFpPct = pf(payrollConfig.ss_fp_pct);
        const ssMeiPct = pf(payrollConfig.ss_mei_pct);
        const ssCc = ssCcPct > 0 ? round2((brutoCotizable * ssCcPct) / 100) : 0;
        const ssDes = ssDesPct > 0 ? round2((brutoCotizable * ssDesPct) / 100) : 0;
        const ssFp = ssFpPct > 0 ? round2((brutoCotizable * ssFpPct) / 100) : 0;
        const ssMei = ssMeiPct > 0 ? round2((brutoCotizable * ssMeiPct) / 100) : 0;
        const ssPct = round2(ssCcPct + ssDesPct + ssFpPct + ssMeiPct);
        const ss = round2(ssCc + ssDes + ssFp + ssMei);

        const annual = brutoCotizable * 12;
        const irpfRecommendedPct =
          annual <= 12450 ? 8 :
            annual <= 20200 ? 12 :
              annual <= 35200 ? 15 :
                annual <= 60000 ? 18 :
                  20;
        const irpfAppliedPct = payrollConfig.irpf_mode === "manual" ? pf(payrollConfig.irpf_manual_pct) : pf(payrollConfig.irpf_auto_applied_pct);
        const irpf = irpfAppliedPct > 0 ? round2((brutoCotizable * irpfAppliedPct) / 100) : 0;

        const neto = round2(brutoTotal - ss - irpf);

        setPayrollEstimate({
          periodLabel: (estimateRange as any).label ?? `${from} - ${to}`,
          daysComputed,
          daysWorked,
          baseDays,
          fixedUnit,
          fixedPerUnit: round2(fixedPerUnit),
          fixedTotal: round2(fixedTotal),
          baseVariable: round2(baseVariable),
          dietas: round2(dietasTotal),
          extras: round2(extras),
          pluses: round2(pluses),
          descansoFueraBase: round2(descansoFueraBase),
          dietasDesglose,
          extrasDesglose,
          plusDesglose,
          varCotizable: round2(varCotizable),
          varNoCotizable: round2(varNoCotizable),
          brutoCotizable,
          totalNoCotizable,
          brutoTotal,
          ssPct: round2(ssPct),
          ssCcPct: round2(ssCcPct),
          ssDesPct: round2(ssDesPct),
          ssFpPct: round2(ssFpPct),
          ssMeiPct: round2(ssMeiPct),
          ssCc,
          ssDes,
          ssFp,
          ssMei,
          ss,
          irpfMode: payrollConfig.irpf_mode,
          irpfAppliedPct: round2(irpfAppliedPct),
          irpfRecommendedPct: round2(irpfRecommendedPct),
          irpfAnnualBase: round2(annual),
          irpf,
          neto,
        });
      } catch {
        setPayrollEstimate(null);
      } finally {
        setLoadingPayrollEstimate(false);
      }
    })();
  }, [activeSection, estimateRange, payrollConfig, settings, syncVersion]);

  useFocusEffect(
    useCallback(() => {
      loadSettings();
      loadHolidays();
      loadNotifPrefs();
      loadPushInfo();
      loadPayrollConfig();
    }, [loadSettings, loadHolidays, loadNotifPrefs, loadPayrollConfig, loadPushInfo])
  );

  const setNotifPref = useCallback(async (patch: Record<string, any>) => {
    if (!userId) return;
    if (savingNotifPrefs) return;
    setSavingNotifPrefs(true);
    const nowIso = new Date().toISOString();
    try {
      await supabase.from("profiles").update({ ...patch, updated_at: nowIso } as any).eq("id", userId);
      if ("notifications_enabled" in patch) {
        await supabase.from("push_tokens").update({ notifications_enabled: !!patch.notifications_enabled, updated_at: nowIso } as any).eq("user_id", userId);
      }
    } catch {}
    setSavingNotifPrefs(false);
  }, [userId, savingNotifPrefs]);

  useEffect(() => {
    if (user) {
      setProfileName(user.name || "");
    }
  }, [user]);

  const updateSetting = (key: keyof UserSettings, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const savePaymentConfig = async () => {
    if (!userId) {
      Alert.alert(t("common.error"), t("common.notAuthenticated"));
      return;
    }
    if (savingPayment) return;
    const km = parseFloat(settings.price_per_km);
    const kmNac = parseFloat(settings.price_per_km_nacional);
    const kmIntl = parseFloat(settings.price_per_km_internacional);
    const kmReg = parseFloat(settings.price_per_km_regional);
    const trip = parseFloat(settings.price_per_trip);
    const tripNac = parseFloat(settings.price_per_trip_nacional);
    const tripIntl = parseFloat(settings.price_per_trip_internacional);
    const tripReg = parseFloat(settings.price_per_trip_regional);
    const kmInvalid = settings.payment_mode === "km"
      ? isNaN(kmNac) || kmNac < 0 || isNaN(kmIntl) || kmIntl < 0 || isNaN(kmReg) || kmReg < 0
      : isNaN(km) || km < 0;
    const tripInvalid = settings.payment_mode === "viaje"
      ? isNaN(tripNac) || tripNac < 0 || isNaN(tripIntl) || tripIntl < 0 || isNaN(tripReg) || tripReg < 0
      : isNaN(trip) || trip < 0;
    if (kmInvalid || tripInvalid) {
      Alert.alert(t("common.error"), t("usuario.ratesPositive"));
      return;
    }
    setSavingPayment(true);
    if (settings.payment_mode === "viaje") {
      const fallback = settings.price_per_trip ?? "0";
      if (!settings.price_per_trip_nacional) settings.price_per_trip_nacional = fallback;
      if (!settings.price_per_trip_internacional) settings.price_per_trip_internacional = fallback;
      if (!settings.price_per_trip_regional) settings.price_per_trip_regional = fallback;
      settings.price_per_trip = settings.price_per_trip_nacional || fallback;
    }
    try {
      await saveUserConfig(userId, { settings });
      safeHaptic();
      Alert.alert(t("usuario.saved"), t("usuario.ratesUpdated"));
      triggerSync();
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message || String(e));
    } finally {
      setSavingPayment(false);
    }
  };

  const saveRates = async () => {
    if (!userId) {
      Alert.alert(t("common.error"), t("common.notAuthenticated"));
      return;
    }
    if (savingRates) return;
    const vals = {
      nac_100: parseFloat(settings.nac_100),
      nac_60: parseFloat(settings.nac_60),
      nac_30: parseFloat(settings.nac_30),
      intl_100: parseFloat(settings.intl_100),
      intl_60: parseFloat(settings.intl_60),
      intl_30: parseFloat(settings.intl_30),
      reg_100: parseFloat(settings.reg_100),
      reg_60: parseFloat(settings.reg_60),
      reg_30: parseFloat(settings.reg_30),
    };
    for (const [k, v] of Object.entries(vals)) {
      if (isNaN(v) || v < 0) {
        Alert.alert(t("common.error"), t("usuario.ratesPositive"));
        return;
      }
    }

    setSavingRates(true);
    try {
      await saveUserConfig(userId, { settings });
      safeHaptic();
      Alert.alert(t("usuario.saved"), t("usuario.ratesUpdated"));
      triggerSync();
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message || String(e));
    } finally {
      setSavingRates(false);
    }
  };

  const saveExtras = async () => {
    if (!userId) {
      Alert.alert(t("common.error"), t("common.notAuthenticated"));
      return;
    }
    if (savingExtras) return;
    const vals = {
      extra_saturday: parseFloat(settings.extra_saturday),
      extra_sunday: parseFloat(settings.extra_sunday),
      extra_holiday: parseFloat(settings.extra_holiday),
      offsite_weekly_reduced_nacional: parseFloat(settings.offsite_weekly_reduced_nacional),
      offsite_weekly_reduced_internacional: parseFloat(settings.offsite_weekly_reduced_internacional),
      offsite_weekly_complete_nacional: parseFloat(settings.offsite_weekly_complete_nacional),
      offsite_weekly_complete_internacional: parseFloat(settings.offsite_weekly_complete_internacional),
    };
    for (const [k, v] of Object.entries(vals)) {
      if (isNaN(v) || v < 0) {
        Alert.alert(t("common.error"), t("usuario.extrasPositive"));
        return;
      }
    }

    setSavingExtras(true);
    try {
      await saveUserConfig(userId, { settings });
      safeHaptic();
      Alert.alert(t("usuario.saved"), t("usuario.ratesUpdated"));
      triggerSync();
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message || String(e));
    } finally {
      setSavingExtras(false);
    }
  };

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      if (!userId) throw new Error("No autenticado");
      const radius = parseFloat(String(settings.base_radius_km || "20").replace(",", "."));
      if (!settings.base_name.trim() || !settings.base_city.trim() || !settings.base_country.trim()) {
        throw new Error("Completa nombre, ciudad y país de tu lugar de base");
      }
      if (!Number.isFinite(radius) || radius <= 0) {
        throw new Error("El radio de base debe ser mayor que 0");
      }
      await saveUserConfig(userId, {
        settings: {
          ...settings,
          driver_name: profileName,
        },
      });
      safeHaptic();
      Alert.alert(t("usuario.saved"), "Perfil y lugar de base actualizados");
    } catch (e: any) {
      Alert.alert("Error", e.message);
    }
    setSavingProfile(false);
  };

  const addHoliday = async () => {
    if (!newHolidayDate.trim() || !newHolidayName.trim()) {
      Alert.alert(t("common.error"), t("usuario.holidayRequired"));
      return;
    }
    setAddingHoliday(true);
    try {
      if (!userId) throw new Error("No autenticado");
      await createHoliday(userId, newHolidayDate, newHolidayName);
      safeHaptic();
      setNewHolidayDate("");
      setNewHolidayName("");
      loadHolidays();
    } catch (e: any) {
      Alert.alert("Error", e.message);
    }
    setAddingHoliday(false);
  };

  const deleteHoliday = async (id: number) => {
    Alert.alert(t("usuario.deleteHoliday"), t("usuario.deleteHolidayConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: async () => {
          try {
            if (!userId) throw new Error("No autenticado");
            await deleteHolidayCloud(userId, id);
            safeHaptic();
            loadHolidays();
          } catch (e: any) {
            Alert.alert("Error", e.message);
          }
        },
      },
    ]);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <View style={styles.header}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {showOnlySection && (
            <Pressable
              onPress={() => router.back()}
              hitSlop={10}
              style={{ marginRight: 10, width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: Colors.light.tint + "10" }}
            >
              <Ionicons name="chevron-back" size={20} color={Colors.light.tint} />
            </Pressable>
          )}
          <Text style={styles.headerTitle}>{headerTitle}</Text>
        </View>
      </View>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 100 + webBottomPad }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        nestedScrollEnabled
      >
        {!showOnlySection ? (
          <>
            <View style={styles.card}>
              <SectionHeader title="Ajustes" icon="settings-outline" />
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.light.textSecondary, marginBottom: 10 }}>
                Elige una categoría.
              </Text>
              {rootCategories.map((it) => (
                <Pressable
                  key={it.key}
                  style={({ pressed }) => [
                    styles.ferryToggleRow,
                    { opacity: pressed ? 0.85 : 1 },
                  ]}
                  onPress={() => openSection(it.key)}
                >
                  <View style={styles.ferryToggleLabel}>
                    <Ionicons name={it.icon} size={18} color={Colors.light.tint} />
                    <Text style={styles.ferryToggleText}>{it.label}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={Colors.light.textSecondary} />
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <>
        {(activeSection === "cuenta") && (
          <View style={styles.card}>
            <SectionHeader title="Cuenta" icon="person-outline" />
            <Pressable
              style={({ pressed }) => [styles.ferryToggleRow, { opacity: pressed ? 0.85 : 1 }]}
              onPress={() => openSection("perfil")}
            >
              <View style={styles.ferryToggleLabel}>
                <Ionicons name="person-circle-outline" size={18} color={Colors.light.tint} />
                <Text style={styles.ferryToggleText}>Perfil</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.light.textSecondary} />
            </Pressable>
            <View style={styles.subsectionDivider} />
            <Pressable
              style={({ pressed }) => [styles.ferryToggleRow, { opacity: pressed ? 0.85 : 1 }]}
              onPress={logout}
            >
              <View style={styles.ferryToggleLabel}>
                <Ionicons name="log-out-outline" size={18} color={Colors.light.danger} />
                <Text style={[styles.ferryToggleText, { color: Colors.light.danger }]}>Cerrar sesión</Text>
              </View>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.ferryToggleRow, { opacity: pressed ? 0.85 : 1 }]}
              onPress={async () => {
                setDeletingAccount(true);
                try {
                  await deleteAccount();
                } catch (e: any) {
                  Alert.alert("Error", e?.message || String(e));
                } finally {
                  setDeletingAccount(false);
                }
              }}
              disabled={deletingAccount}
            >
              <View style={styles.ferryToggleLabel}>
                {deletingAccount ? (
                  <ActivityIndicator size="small" color={Colors.light.danger} />
                ) : (
                  <Ionicons name="trash-outline" size={18} color={Colors.light.danger} />
                )}
                <Text style={[styles.ferryToggleText, { color: Colors.light.danger }]}>Eliminar cuenta</Text>
              </View>
            </Pressable>
          </View>
        )}

        {(activeSection === "precios_ref") && (
          <View style={styles.card}>
            <SectionHeader title="Precios de referencia" icon="pricetag-outline" />
            {renderMenuList([
              { key: "precios_dietas", label: "Dietas", icon: "cash-outline" as const },
              { key: "precios_extras", label: "Día especial / Extras", icon: "calendar-outline" as const },
              { key: "precios_fuera_base", label: "Descanso fuera de base", icon: "moon-outline" as const },
              ...(settings.payment_mode === "km" ? [{ key: "precios_km", label: "Kilómetros", icon: "speedometer-outline" as const }] : []),
              ...(settings.payment_mode === "viaje" ? [{ key: "precios_viaje", label: "Precio por viaje", icon: "car-outline" as const }] : []),
            ] as any)}
          </View>
        )}

        {(activeSection === "cobro_nomina") && (
          <View style={styles.card}>
            <SectionHeader title="Cobro y nómina" icon="wallet-outline" />
            {renderMenuList([
              { key: "tipo_cobro", label: "Tipo de cobro", icon: "card-outline" as const },
              { key: "config_nomina", label: "Configuración de nómina", icon: "settings-outline" as const },
              { key: "estimacion_nomina", label: "Estimación de nómina", icon: "calculator-outline" as const },
              { key: "irpf_cotizacion", label: "Cotización / IRPF orientativo", icon: "receipt-outline" as const },
            ] as any)}
          </View>
        )}

        {(activeSection === "periodos") && (
          <View style={styles.card}>
            <SectionHeader title="Periodos" icon="calendar-outline" />
            {renderMenuList([
              { key: "periodo", label: "Periodo de contabilización", icon: "calendar-outline" as const },
              { key: "periodo", label: "Periodo dietas / pluses", icon: "cash-outline" as const },
              { key: "periodo", label: "Ciclo de nómina", icon: "wallet-outline" as const },
            ] as any)}
          </View>
        )}

        {(activeSection === "perfil") && (
          <View
            style={styles.card}
            onLayout={(e) => {
              sectionYs.current.perfil = e.nativeEvent.layout.y;
            }}
          >
            <SectionHeader title={t("usuario.profile")} icon="person-outline" />
            <View style={styles.profileRow}>
              <Ionicons name="mail-outline" size={16} color={Colors.light.textSecondary} />
              <Text style={styles.profileEmail}>{user?.email || ""}</Text>
            </View>
            <Text style={styles.fieldLabel}>{t("usuario.name")}</Text>
            <View style={styles.inlineRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={profileName}
                onChangeText={setProfileName}
                placeholder={t("usuario.namePlaceholder")}
                placeholderTextColor="#9CA3AF"
              />
              <Pressable
                style={({ pressed }) => [
                  styles.iconBtn,
                  { opacity: pressed ? 0.7 : 1 },
                  savingProfile && styles.btnDisabled,
                ]}
                onPress={saveProfile}
                disabled={savingProfile}
              >
                {savingProfile ? (
                  <ActivityIndicator size="small" color={Colors.light.tint} />
                ) : (
                  <Ionicons name="checkmark-circle" size={28} color={Colors.light.success} />
                )}
              </Pressable>
            </View>
            <Text style={styles.fieldLabel}>Lugar de base</Text>
            <View style={styles.gridForm}>
              <TextInput
                style={[styles.input, styles.gridFormItem]}
                value={settings.base_name}
                onChangeText={(value) => updateSetting("base_name", value)}
                placeholder="Nombre de la base"
                placeholderTextColor="#9CA3AF"
              />
              <TextInput
                style={[styles.input, styles.gridFormItem]}
                value={settings.base_city}
                onChangeText={(value) => updateSetting("base_city", value)}
                placeholder="Ciudad"
                placeholderTextColor="#9CA3AF"
              />
              <TextInput
                style={[styles.input, styles.gridFormItem]}
                value={settings.base_country}
                onChangeText={(value) => updateSetting("base_country", value)}
                placeholder="País"
                placeholderTextColor="#9CA3AF"
              />
              <TextInput
                style={[styles.input, styles.gridFormItem]}
                value={settings.base_radius_km}
                onChangeText={(value) => updateSetting("base_radius_km", value)}
                keyboardType="decimal-pad"
                placeholder="Radio km"
                placeholderTextColor="#9CA3AF"
              />
              <TextInput
                style={[styles.input, { width: "100%" as any }]}
                value={settings.base_address}
                onChangeText={(value) => updateSetting("base_address", value)}
                placeholder="Dirección opcional"
                placeholderTextColor="#9CA3AF"
              />
              <TextInput
                style={[styles.input, styles.gridFormItem]}
                value={settings.base_latitude}
                onChangeText={(value) => updateSetting("base_latitude", value)}
                keyboardType="decimal-pad"
                placeholder="Latitud opcional"
                placeholderTextColor="#9CA3AF"
              />
              <TextInput
                style={[styles.input, styles.gridFormItem]}
                value={settings.base_longitude}
                onChangeText={(value) => updateSetting("base_longitude", value)}
                keyboardType="decimal-pad"
                placeholder="Longitud opcional"
                placeholderTextColor="#9CA3AF"
              />
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.saveBtn,
                { opacity: pressed ? 0.85 : 1, backgroundColor: Colors.light.tint },
                savingProfile && styles.btnDisabled,
              ]}
              onPress={saveProfile}
              disabled={savingProfile}
            >
              {savingProfile ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="save-outline" size={18} color="#fff" />
                  <Text style={styles.saveBtnText}>Guardar perfil y base</Text>
                </>
              )}
            </Pressable>
          </View>
        )}

        {(activeSection === "seguridad") && (
          <View style={styles.card}>
            <SectionHeader title="Seguridad" icon="shield-checkmark-outline" />
            {renderMenuList([
              { key: "cuenta", label: "Cuenta", icon: "person-outline" as const },
              { key: "import_export", label: "Eliminar datos del dispositivo", icon: "trash-outline" as const },
            ] as any)}
            <View style={styles.subsectionDivider} />
            <Pressable
              style={({ pressed }) => [styles.logoutBtn, { opacity: pressed ? 0.85 : 1, marginTop: 0 }]}
              onPress={async () => {
                if (Platform.OS === "web") {
                  if (window.confirm(t("usuario.logoutConfirm"))) {
                    await logout();
                  }
                } else {
                  Alert.alert(t("usuario.logout"), t("usuario.logoutConfirm"), [
                    { text: t("common.cancel"), style: "cancel" },
                    { text: t("usuario.logout"), style: "destructive", onPress: logout },
                  ]);
                }
              }}
            >
              <Ionicons name="log-out-outline" size={18} color="#fff" />
              <Text style={styles.logoutBtnText}>{t("usuario.logout")}</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.deleteAccountBtn,
                { opacity: pressed ? 0.85 : 1, marginTop: 10 },
                deletingAccount && styles.btnDisabled,
              ]}
              disabled={deletingAccount}
              onPress={async () => {
                const run = async () => {
                  setDeletingAccount(true);
                  try {
                    await deleteAccount();
                  } catch (e: any) {
                    Alert.alert("Error", e?.message || String(e));
                  } finally {
                    setDeletingAccount(false);
                  }
                };
                if (Platform.OS === "web") {
                  if (window.confirm(t("usuario.deleteAccountConfirm"))) {
                    await run();
                  }
                } else {
                  Alert.alert(t("usuario.deleteAccount"), t("usuario.deleteAccountConfirm"), [
                    { text: t("common.cancel"), style: "cancel" },
                    { text: t("usuario.deleteAccount"), style: "destructive", onPress: run },
                  ]);
                }
              }}
            >
              {deletingAccount ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="trash-outline" size={18} color="#fff" />
                  <Text style={styles.logoutBtnText}>{t("usuario.deleteAccount")}</Text>
                </>
              )}
            </Pressable>
          </View>
        )}

        {loadingSettings ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={Colors.light.tint} />
          </View>
        ) : (
          <>
            {shouldShowSection("import_export") && (
              <View
                onLayout={(e) => {
                  sectionYs.current.import_export = e.nativeEvent.layout.y;
                }}
              >
                <ImportExportCard />
              </View>
            )}
            {shouldShowSection("sync") && (
              <View
                style={styles.card}
                onLayout={(e) => {
                  sectionYs.current.sync = e.nativeEvent.layout.y;
                }}
              >
                <SectionHeader title="Sincronización" icon="cloud-outline" />
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.light.textSecondary, marginBottom: 10 }}>
                  Estado: {syncStatus}
                  {lastSyncTime ? ` · Última: ${lastSyncTime}` : ""}
                </Text>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Pressable
                    style={({ pressed }) => [styles.saveBtn, { opacity: pressed ? 0.85 : 1, flex: 1 }]}
                    onPress={triggerSync}
                  >
                    <Ionicons name="cloud-outline" size={18} color="#fff" />
                    <Text style={styles.saveBtnText}>Sincronizar ahora</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.saveBtn, { opacity: pressed ? 0.85 : 1, flex: 1, backgroundColor: Colors.light.tint }]}
                    onPress={startRestore}
                  >
                    <Ionicons name="cloud-download-outline" size={18} color="#fff" />
                    <Text style={styles.saveBtnText}>Restaurar nube</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {shouldShowSection("precios") && (
              <View
                style={styles.card}
                onLayout={(e) => {
                  sectionYs.current.precios = e.nativeEvent.layout.y;
                }}
              >
                <SectionHeader title={t("usuario.dietRates")} icon="cash-outline" />
                <Text style={styles.subsectionLabel}>{t("common.nacional")}</Text>
                <PriceField label="100%" value={settings.nac_100} onChange={(v) => updateSetting("nac_100", v)} />
                <PriceField label="60%" value={settings.nac_60} onChange={(v) => updateSetting("nac_60", v)} />
                <PriceField label="30%" value={settings.nac_30} onChange={(v) => updateSetting("nac_30", v)} />
                <View style={styles.subsectionDivider} />
                <Text style={styles.subsectionLabel}>{t("common.internacional")}</Text>
                <PriceField label="100%" value={settings.intl_100} onChange={(v) => updateSetting("intl_100", v)} />
                <PriceField label="60%" value={settings.intl_60} onChange={(v) => updateSetting("intl_60", v)} />
                <PriceField label="30%" value={settings.intl_30} onChange={(v) => updateSetting("intl_30", v)} />
                <View style={styles.subsectionDivider} />
                <Text style={styles.subsectionLabel}>{t("common.regional")}</Text>
                <PriceField label="100%" value={settings.reg_100} onChange={(v) => updateSetting("reg_100", v)} />
                <PriceField label="60%" value={settings.reg_60} onChange={(v) => updateSetting("reg_60", v)} />
                <PriceField label="30%" value={settings.reg_30} onChange={(v) => updateSetting("reg_30", v)} />
                <Pressable
                  style={({ pressed }) => [
                    styles.saveBtn,
                    { opacity: pressed ? 0.85 : 1 },
                    savingRates && styles.btnDisabled,
                  ]}
                  onPress={saveRates}
                  disabled={savingRates}
                >
                  {savingRates ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="checkmark-circle" size={18} color="#fff" />
                  )}
                  <Text style={styles.saveBtnText}>{t("usuario.saveRates")}</Text>
                </Pressable>
              </View>
            )}

            {shouldShowSection("extras_day") && (
              <View
                style={styles.card}
                onLayout={(e) => {
                  sectionYs.current.extras = e.nativeEvent.layout.y;
                }}
              >
                <SectionHeader title="Día especial / Extras" icon="calendar-outline" />
                <PriceField label={t("usuario.saturday")} value={settings.extra_saturday} onChange={(v) => updateSetting("extra_saturday", v)} />
                <PriceField label={t("usuario.sunday")} value={settings.extra_sunday} onChange={(v) => updateSetting("extra_sunday", v)} />
                <PriceField label={t("usuario.holiday")} value={settings.extra_holiday} onChange={(v) => updateSetting("extra_holiday", v)} />
                <Pressable
                  style={({ pressed }) => [
                    styles.saveBtn,
                    { opacity: pressed ? 0.85 : 1 },
                    savingExtras && styles.btnDisabled,
                  ]}
                  onPress={saveExtras}
                  disabled={savingExtras}
                >
                  {savingExtras ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="checkmark-circle" size={18} color="#fff" />
                  )}
                  <Text style={styles.saveBtnText}>{t("usuario.saveRates")}</Text>
                </Pressable>
              </View>
            )}

            {shouldShowSection("extras_offsite") && (
              <View style={styles.card}>
                <SectionHeader title="Descanso fuera de base" icon="moon-outline" />
                <Text style={styles.subsectionLabel}>{t("usuario.offsiteWeeklyRestRates")}</Text>
                <PriceField label={t("usuario.offsiteWeeklyCompleteInternacional")} value={settings.offsite_weekly_complete_internacional} onChange={(v) => updateSetting("offsite_weekly_complete_internacional", v)} />
                <PriceField label={t("usuario.offsiteWeeklyReducedInternacional")} value={settings.offsite_weekly_reduced_internacional} onChange={(v) => updateSetting("offsite_weekly_reduced_internacional", v)} />
                <PriceField label={t("usuario.offsiteWeeklyCompleteNacional")} value={settings.offsite_weekly_complete_nacional} onChange={(v) => updateSetting("offsite_weekly_complete_nacional", v)} />
                <PriceField label={t("usuario.offsiteWeeklyReducedNacional")} value={settings.offsite_weekly_reduced_nacional} onChange={(v) => updateSetting("offsite_weekly_reduced_nacional", v)} />
                <Pressable
                  style={({ pressed }) => [
                    styles.saveBtn,
                    { opacity: pressed ? 0.85 : 1 },
                    savingExtras && styles.btnDisabled,
                  ]}
                  onPress={saveExtras}
                  disabled={savingExtras}
                >
                  {savingExtras ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="checkmark-circle" size={18} color="#fff" />
                  )}
                  <Text style={styles.saveBtnText}>{t("usuario.saveRates")}</Text>
                </Pressable>
              </View>
            )}

            {shouldShowSection("tipo_cobro") && (
              <View
                style={styles.card}
                onLayout={(e) => {
                  sectionYs.current.tipo_cobro = e.nativeEvent.layout.y;
                }}
              >
                <SectionHeader title={t("usuario.paymentMode")} icon="card-outline" />
                <View style={{ gap: 8 }}>
                  {(["dietas", "viaje", "km"] as const).map((pm) => (
                    <Pressable
                      key={pm}
                      style={[styles.periodOption, settings.payment_mode === pm && styles.periodOptionSel]}
                      onPress={() => updateSetting("payment_mode", pm)}
                    >
                      <Ionicons
                        name={settings.payment_mode === pm ? "radio-button-on" : "radio-button-off"}
                        size={18}
                        color={settings.payment_mode === pm ? Colors.light.tint : "#9CA3AF"}
                      />
                      <Text style={styles.periodOptionText}>
                        {pm === "dietas" ? t("usuario.paymentModeDietas") : pm === "km" ? t("usuario.paymentModeKm") : t("usuario.paymentModeTrip")}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {settings.payment_mode === "km" && (
                  <>
                    <PriceField label={t("usuario.pricePerKmNacional")} value={settings.price_per_km_nacional} onChange={(v) => updateSetting("price_per_km_nacional", v)} />
                    <PriceField label={t("usuario.pricePerKmInternacional")} value={settings.price_per_km_internacional} onChange={(v) => updateSetting("price_per_km_internacional", v)} />
                    <PriceField label={t("usuario.pricePerKmRegional")} value={settings.price_per_km_regional} onChange={(v) => updateSetting("price_per_km_regional", v)} />
                    <View style={{ backgroundColor: "#FEF3C7", borderRadius: 10, padding: 10, marginTop: 6 }}>
                      <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: "#92400E" }}>
                        {t("usuario.kmWarningTitle")}
                      </Text>
                      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "#92400E", marginTop: 4 }}>
                        {t("usuario.kmWarningText")}
                      </Text>
                    </View>
                  </>
                )}
                {settings.payment_mode === "viaje" && (
                  <>
                    <PriceField label={t("usuario.pricePerTripNacional")} value={settings.price_per_trip_nacional} onChange={(v) => updateSetting("price_per_trip_nacional", v)} />
                    <PriceField label={t("usuario.pricePerTripInternacional")} value={settings.price_per_trip_internacional} onChange={(v) => updateSetting("price_per_trip_internacional", v)} />
                    <PriceField label={t("usuario.pricePerTripRegional")} value={settings.price_per_trip_regional} onChange={(v) => updateSetting("price_per_trip_regional", v)} />
                  </>
                )}

                <Pressable
                  style={({ pressed }) => [
                    styles.saveBtn,
                    { opacity: pressed ? 0.85 : 1 },
                    savingPayment && styles.btnDisabled,
                  ]}
                  onPress={savePaymentConfig}
                  disabled={savingPayment}
                >
                  {savingPayment ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="checkmark-circle" size={18} color="#fff" />
                  )}
                  <Text style={styles.saveBtnText}>{t("usuario.saveRates")}</Text>
                </Pressable>
              </View>
            )}

            {shouldShowSection("km_prices") && (
              <View style={styles.card}>
                <SectionHeader title="Kilómetros" icon="speedometer-outline" />
                <PriceField label={t("usuario.pricePerKmNacional")} value={settings.price_per_km_nacional} onChange={(v) => updateSetting("price_per_km_nacional", v)} />
                <PriceField label={t("usuario.pricePerKmInternacional")} value={settings.price_per_km_internacional} onChange={(v) => updateSetting("price_per_km_internacional", v)} />
                <PriceField label={t("usuario.pricePerKmRegional")} value={settings.price_per_km_regional} onChange={(v) => updateSetting("price_per_km_regional", v)} />
                <Pressable
                  style={({ pressed }) => [
                    styles.saveBtn,
                    { opacity: pressed ? 0.85 : 1 },
                    savingPayment && styles.btnDisabled,
                  ]}
                  onPress={savePaymentConfig}
                  disabled={savingPayment}
                >
                  {savingPayment ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="checkmark-circle" size={18} color="#fff" />
                  )}
                  <Text style={styles.saveBtnText}>{t("usuario.saveRates")}</Text>
                </Pressable>
              </View>
            )}

            {shouldShowSection("trip_prices") && (
              <View style={styles.card}>
                <SectionHeader title="Precio por viaje" icon="car-outline" />
                <PriceField label={t("usuario.pricePerTripNacional")} value={settings.price_per_trip_nacional} onChange={(v) => updateSetting("price_per_trip_nacional", v)} />
                <PriceField label={t("usuario.pricePerTripInternacional")} value={settings.price_per_trip_internacional} onChange={(v) => updateSetting("price_per_trip_internacional", v)} />
                <PriceField label={t("usuario.pricePerTripRegional")} value={settings.price_per_trip_regional} onChange={(v) => updateSetting("price_per_trip_regional", v)} />
                <Pressable
                  style={({ pressed }) => [
                    styles.saveBtn,
                    { opacity: pressed ? 0.85 : 1 },
                    savingPayment && styles.btnDisabled,
                  ]}
                  onPress={savePaymentConfig}
                  disabled={savingPayment}
                >
                  {savingPayment ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="checkmark-circle" size={18} color="#fff" />
                  )}
                  <Text style={styles.saveBtnText}>{t("usuario.saveRates")}</Text>
                </Pressable>
              </View>
            )}

            {shouldShowSection("config_nomina") && (
              <View style={styles.card}>
                <SectionHeader title="Configuración de nómina" icon="settings-outline" />
                {loadingPayrollConfig ? (
                  <ActivityIndicator color={Colors.light.tint} style={{ paddingVertical: 16 }} />
                ) : (
                  <>
                    <Text style={styles.subsectionLabel}>Conceptos fijos (bruto)</Text>
                    <View style={{ gap: 8, marginBottom: 6 }}>
                      {(["day", "month"] as const).map((u) => (
                        <Pressable
                          key={u}
                          style={[styles.periodOption, payrollConfig.fixed_unit === u && styles.periodOptionSel]}
                          onPress={() => setPayrollConfig((p) => ({ ...p, fixed_unit: u }))}
                        >
                          <Ionicons
                            name={payrollConfig.fixed_unit === u ? "radio-button-on" : "radio-button-off"}
                            size={18}
                            color={payrollConfig.fixed_unit === u ? Colors.light.tint : "#9CA3AF"}
                          />
                          <Text style={styles.periodOptionText}>
                            {u === "day" ? "Importe por día (acumulado)" : "Importe mensual"}
                          </Text>
                        </Pressable>
                      ))}
                    </View>

                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.light.textSecondary, marginBottom: 10 }}>
                      {payrollConfig.fixed_unit === "day"
                        ? "Introduce importes por día. La estimación multiplica por los días acumulados del periodo."
                        : "Introduce importes mensuales. La estimación usa el valor tal cual para el periodo."}
                    </Text>

                    <ValueField label="Salario base bruto" unit={payrollConfig.fixed_unit === "day" ? "EUR/día" : "EUR/mes"} value={payrollConfig.salario_base_bruto} onChange={(v) => setPayrollConfig((p) => ({ ...p, salario_base_bruto: v }))} />
                    <ValueField label="Plus convenio" unit={payrollConfig.fixed_unit === "day" ? "EUR/día" : "EUR/mes"} value={payrollConfig.plus_convenio} onChange={(v) => setPayrollConfig((p) => ({ ...p, plus_convenio: v }))} />
                    <ValueField label="Complemento" unit={payrollConfig.fixed_unit === "day" ? "EUR/día" : "EUR/mes"} value={payrollConfig.complemento} onChange={(v) => setPayrollConfig((p) => ({ ...p, complemento: v }))} />
                    <ValueField label="Pagas prorrateadas" unit={payrollConfig.fixed_unit === "day" ? "EUR/día" : "EUR/mes"} value={payrollConfig.pagas_prorrateadas} onChange={(v) => setPayrollConfig((p) => ({ ...p, pagas_prorrateadas: v }))} />
                    <ValueField label="Productividad fija" unit={payrollConfig.fixed_unit === "day" ? "EUR/día" : "EUR/mes"} value={payrollConfig.productividad_fija} onChange={(v) => setPayrollConfig((p) => ({ ...p, productividad_fija: v }))} />
                    <ValueField label="Otros conceptos fijos" unit={payrollConfig.fixed_unit === "day" ? "EUR/día" : "EUR/mes"} value={payrollConfig.otros_conceptos_fijos} onChange={(v) => setPayrollConfig((p) => ({ ...p, otros_conceptos_fijos: v }))} />

                    <View style={styles.subsectionDivider} />
                    <Text style={styles.subsectionLabel}>IRPF y cotización</Text>

                    <View style={{ gap: 8 }}>
                      {(["auto", "manual"] as const).map((m) => (
                        <Pressable
                          key={m}
                          style={[styles.periodOption, payrollConfig.irpf_mode === m && styles.periodOptionSel]}
                          onPress={() => setPayrollConfig((p) => ({ ...p, irpf_mode: m }))}
                        >
                          <Ionicons
                            name={payrollConfig.irpf_mode === m ? "radio-button-on" : "radio-button-off"}
                            size={18}
                            color={payrollConfig.irpf_mode === m ? Colors.light.tint : "#9CA3AF"}
                          />
                          <Text style={styles.periodOptionText}>{m === "auto" ? "IRPF automático (orientativo)" : "IRPF manual"}</Text>
                        </Pressable>
                      ))}
                    </View>

                    {payrollConfig.irpf_mode === "manual" && (
                      <ValueField label="IRPF" unit="%" value={payrollConfig.irpf_manual_pct} onChange={(v) => setPayrollConfig((p) => ({ ...p, irpf_manual_pct: v }))} />
                    )}
                    {payrollConfig.irpf_mode === "auto" && (
                      <>
                        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.light.textSecondary, marginTop: 8 }}>
                          IRPF orientativo. La app calcula un porcentaje recomendado según el acumulado. No se aplica automáticamente sin tu confirmación.
                        </Text>
                        <ValueField
                          label="IRPF aplicado (auto)"
                          unit="%"
                          value={payrollConfig.irpf_auto_applied_pct}
                          onChange={(v) => setPayrollConfig((p) => ({ ...p, irpf_auto_applied_pct: v }))}
                        />
                      </>
                    )}

                    <View style={styles.subsectionDivider} />
                    <Text style={styles.subsectionLabel}>Seguridad Social trabajador (porcentajes)</Text>
                    <ValueField label="Contingencias comunes" unit="%" value={payrollConfig.ss_cc_pct} onChange={(v) => setPayrollConfig((p) => ({ ...p, ss_cc_pct: v }))} />
                    <ValueField label="Desempleo" unit="%" value={payrollConfig.ss_desempleo_pct} onChange={(v) => setPayrollConfig((p) => ({ ...p, ss_desempleo_pct: v }))} />
                    <ValueField label="Formación profesional" unit="%" value={payrollConfig.ss_fp_pct} onChange={(v) => setPayrollConfig((p) => ({ ...p, ss_fp_pct: v }))} />
                    <ValueField label="MEI" unit="%" value={payrollConfig.ss_mei_pct} onChange={(v) => setPayrollConfig((p) => ({ ...p, ss_mei_pct: v }))} />

                    <View style={styles.subsectionDivider} />
                    <Text style={styles.subsectionLabel}>Variables cotizables</Text>

                    <Pressable
                      style={styles.ferryToggleRow}
                      onPress={() => setPayrollConfig((p) => ({ ...p, dietas_cotizan: !p.dietas_cotizan }))}
                    >
                      <View style={styles.ferryToggleLabel}>
                        <Ionicons name="cash-outline" size={18} color={Colors.light.tint} />
                        <Text style={styles.ferryToggleText}>Dietas cotizan</Text>
                      </View>
                      <View style={[styles.toggleTrack, payrollConfig.dietas_cotizan && styles.toggleTrackOn]}>
                        <View style={[styles.toggleThumb, payrollConfig.dietas_cotizan && styles.toggleThumbOn]} />
                      </View>
                    </Pressable>

                    <Pressable
                      style={styles.ferryToggleRow}
                      onPress={() => setPayrollConfig((p) => ({ ...p, extras_cotizan: !p.extras_cotizan }))}
                    >
                      <View style={styles.ferryToggleLabel}>
                        <Ionicons name="calendar-outline" size={18} color={Colors.light.tint} />
                        <Text style={styles.ferryToggleText}>Domingos / festivos / extras cotizan</Text>
                      </View>
                      <View style={[styles.toggleTrack, payrollConfig.extras_cotizan && styles.toggleTrackOn]}>
                        <View style={[styles.toggleThumb, payrollConfig.extras_cotizan && styles.toggleThumbOn]} />
                      </View>
                    </Pressable>

                    <Pressable
                      style={styles.ferryToggleRow}
                      onPress={() => setPayrollConfig((p) => ({ ...p, descanso_fuera_base_cotiza: !p.descanso_fuera_base_cotiza }))}
                    >
                      <View style={styles.ferryToggleLabel}>
                        <Ionicons name="moon-outline" size={18} color={Colors.light.tint} />
                        <Text style={styles.ferryToggleText}>Descanso fuera de base cotiza</Text>
                      </View>
                      <View style={[styles.toggleTrack, payrollConfig.descanso_fuera_base_cotiza && styles.toggleTrackOn]}>
                        <View style={[styles.toggleThumb, payrollConfig.descanso_fuera_base_cotiza && styles.toggleThumbOn]} />
                      </View>
                    </Pressable>

                    <Pressable
                      style={styles.ferryToggleRow}
                      onPress={() => setPayrollConfig((p) => ({ ...p, pluses_cotizan: !p.pluses_cotizan }))}
                    >
                      <View style={styles.ferryToggleLabel}>
                        <Ionicons name="add-circle-outline" size={18} color={Colors.light.tint} />
                        <Text style={styles.ferryToggleText}>Otros pluses cotizan</Text>
                      </View>
                      <View style={[styles.toggleTrack, payrollConfig.pluses_cotizan && styles.toggleTrackOn]}>
                        <View style={[styles.toggleThumb, payrollConfig.pluses_cotizan && styles.toggleThumbOn]} />
                      </View>
                    </Pressable>

                    <Pressable
                      style={({ pressed }) => [
                        styles.saveBtn,
                        { opacity: pressed ? 0.85 : 1, marginTop: 10 },
                        savingPayrollConfig && styles.btnDisabled,
                      ]}
                      onPress={savePayrollConfig}
                      disabled={savingPayrollConfig}
                    >
                      {savingPayrollConfig ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Ionicons name="checkmark-circle" size={18} color="#fff" />
                      )}
                      <Text style={styles.saveBtnText}>Guardar configuración de nómina</Text>
                    </Pressable>
                  </>
                )}
              </View>
            )}

            {shouldShowSection("estimacion_nomina") && (
              <>
                <View style={styles.card}>
                  <SectionHeader title="Resumen" icon="document-text-outline" />
                  <View style={styles.summaryTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.summaryLabel}>Periodo</Text>
                      <Text style={styles.summaryValue}>{payrollVm?.periodLabel || (estimateRange as any)?.label || ""}</Text>
                      <Text style={[styles.summaryLabel, { marginTop: 8 }]}>Días computados</Text>
                      <Text style={styles.summaryValue}>{String(payrollVm?.daysComputed || 0)}</Text>
                      {Number(payrollVm?.daysWorked || 0) > 0 ? (
                        <>
                          <Text style={[styles.summaryLabel, { marginTop: 8 }]}>Días trabajados</Text>
                          <Text style={styles.summaryValue}>{String(payrollVm?.daysWorked || 0)}</Text>
                        </>
                      ) : null}
                    </View>
                    <View style={styles.summaryRight}>
                      <Text style={styles.summaryLabel}>Bruto total estimado</Text>
                      <Text style={styles.summaryGross}>{formatEUR(Number(payrollVm?.brutoTotal || 0))}</Text>
                      <Text style={[styles.summaryLabel, { marginTop: 8 }]}>Neto estimado</Text>
                      <Text style={styles.summaryNet}>{formatEUR(Number(payrollVm?.neto || 0))}</Text>
                    </View>
                  </View>
                  <Text style={styles.summaryHint}>
                    Estimación orientativa. Puede variar según convenio, empresa, Seguridad Social, IRPF real, situación personal y regularizaciones.
                  </Text>
                </View>

                {loadingPayrollEstimate ? (
                  <View style={styles.card}>
                    <SectionHeader title="Calculando..." icon="time-outline" />
                    <ActivityIndicator color={Colors.light.tint} style={{ paddingVertical: 16 }} />
                  </View>
                ) : payrollVm ? (
                  <>
                    <View style={styles.card}>
                      <SectionHeader title="Devengos salariales fijos" icon="briefcase-outline" />
                      {payrollVm.fixedRows.length > 0 ? <NominaTable rows={payrollVm.fixedRows} /> : <Text style={styles.emptyText}>Sin conceptos fijos configurados.</Text>}
                      <View style={styles.subsectionDivider} />
                      <View style={styles.priceRow}>
                        <Text style={[styles.priceLabel, { fontFamily: "Inter_600SemiBold" }]}>Subtotal devengos fijos</Text>
                        <Text style={[styles.priceLabel, { fontFamily: "Inter_600SemiBold" }]}>{formatEUR(payrollVm.fixedTotal)}</Text>
                      </View>
                    </View>

                    <View style={styles.card}>
                      <SectionHeader title="Devengos variables cotizables" icon="trending-up-outline" />
                      {payrollVm.varCotRows.length > 0 ? <NominaTable rows={payrollVm.varCotRows} /> : <Text style={styles.emptyText}>Sin variables cotizables en el periodo.</Text>}
                      <View style={styles.subsectionDivider} />
                      <View style={styles.priceRow}>
                        <Text style={[styles.priceLabel, { fontFamily: "Inter_600SemiBold" }]}>Subtotal variables cotizables</Text>
                        <Text style={[styles.priceLabel, { fontFamily: "Inter_600SemiBold" }]}>{formatEUR(payrollVm.varCotizable)}</Text>
                      </View>
                    </View>

                    <View style={styles.card}>
                      <SectionHeader title="Devengos no cotizables" icon="cash-outline" />
                      {payrollVm.nonCotRows.length > 0 ? <NominaTable rows={payrollVm.nonCotRows} /> : <Text style={styles.emptyText}>Sin conceptos no cotizables en el periodo.</Text>}
                      <View style={styles.subsectionDivider} />
                      <View style={styles.priceRow}>
                        <Text style={[styles.priceLabel, { fontFamily: "Inter_600SemiBold" }]}>Subtotal no cotizable</Text>
                        <Text style={[styles.priceLabel, { fontFamily: "Inter_600SemiBold" }]}>{formatEUR(payrollVm.totalNoCotizable)}</Text>
                      </View>
                    </View>

                    <View style={styles.card}>
                      <SectionHeader title="Bases de cálculo" icon="layers-outline" />
                      <View style={styles.priceRow}>
                        <Text style={styles.priceLabel}>Total devengos fijos</Text>
                        <Text style={styles.priceLabel}>{formatEUR(payrollVm.fixedTotal)}</Text>
                      </View>
                      <View style={styles.priceRow}>
                        <Text style={styles.priceLabel}>Total variables cotizables</Text>
                        <Text style={styles.priceLabel}>{formatEUR(payrollVm.varCotizable)}</Text>
                      </View>
                      <View style={styles.priceRow}>
                        <Text style={[styles.priceLabel, { fontFamily: "Inter_600SemiBold" }]}>Bruto cotizable</Text>
                        <Text style={[styles.priceLabel, { fontFamily: "Inter_600SemiBold" }]}>{formatEUR(payrollVm.brutoCotizable)}</Text>
                      </View>
                      <View style={styles.priceRow}>
                        <Text style={styles.priceLabel}>Total no cotizable</Text>
                        <Text style={styles.priceLabel}>{formatEUR(payrollVm.totalNoCotizable)}</Text>
                      </View>
                      <View style={styles.subsectionDivider} />
                      <View style={styles.priceRow}>
                        <Text style={[styles.priceLabel, { fontFamily: "Inter_700Bold" } as any]}>Bruto total estimado</Text>
                        <Text style={[styles.priceLabel, { fontFamily: "Inter_700Bold" } as any]}>{formatEUR(payrollVm.brutoTotal)}</Text>
                      </View>
                    </View>

                    <View style={styles.card}>
                      <SectionHeader title="Deducciones" icon="remove-circle-outline" />
                      {payrollVm.deductions.length > 0 ? (
                        <>
                          {payrollVm.deductions.map((d, idx) => (
                            <View key={`${d.label}-${idx}`} style={styles.priceRow}>
                              <Text style={styles.priceLabel}>
                                {d.label}{d.pct != null ? ` (${formatPct(d.pct)})` : ""}
                              </Text>
                              <Text style={styles.priceLabel}>-{formatEUR(d.amount)}</Text>
                            </View>
                          ))}
                          {!isZero(payrollVm.ssTotal) ? (
                            <View style={[styles.priceRow, { marginTop: 4 }]}>
                              <Text style={[styles.priceLabel, { fontFamily: "Inter_600SemiBold" }]}>Total Seguridad Social</Text>
                              <Text style={[styles.priceLabel, { fontFamily: "Inter_600SemiBold" }]}>-{formatEUR(payrollVm.ssTotal)}</Text>
                            </View>
                          ) : (
                            <Text style={styles.emptyText}>Seguridad Social no aplicada.</Text>
                          )}
                        </>
                      ) : (
                        <Text style={styles.emptyText}>Sin deducciones de Seguridad Social aplicadas.</Text>
                      )}
                      {!isZero(payrollVm.irpfTotal) ? (
                        <View style={styles.priceRow}>
                          <Text style={styles.priceLabel}>IRPF</Text>
                          <Text style={styles.priceLabel}>-{formatEUR(payrollVm.irpfTotal)}</Text>
                        </View>
                      ) : null}
                    </View>

                    <View style={styles.card}>
                      <SectionHeader title="IRPF" icon="receipt-outline" />
                      <View style={styles.priceRow}>
                        <Text style={styles.priceLabel}>Modo IRPF</Text>
                        <Text style={styles.priceLabel}>{payrollVm.irpfMode === "manual" ? "Manual" : "Automático (orientativo)"}</Text>
                      </View>
                      <View style={styles.priceRow}>
                        <Text style={styles.priceLabel}>Base IRPF (periodo)</Text>
                        <Text style={styles.priceLabel}>{formatEUR(payrollVm.brutoCotizable)}</Text>
                      </View>
                      <View style={styles.priceRow}>
                        <Text style={styles.priceLabel}>Base anual estimada</Text>
                        <Text style={styles.priceLabel}>{formatEUR(payrollVm.irpfAnnualBase)}</Text>
                      </View>
                      <View style={styles.priceRow}>
                        <Text style={styles.priceLabel}>% aplicado</Text>
                        <Text style={styles.priceLabel}>{formatPct(payrollVm.irpfAppliedPct)}</Text>
                      </View>
                      <View style={styles.priceRow}>
                        <Text style={styles.priceLabel}>% recomendado</Text>
                        <Text style={styles.priceLabel}>{formatPct(payrollVm.irpfRecommendedPct)}</Text>
                      </View>

                      {isZero(payrollVm.irpfAppliedPct) ? (
                        <View style={styles.warnBox}>
                          <Text style={styles.warnText}>No se está aplicando IRPF. Revisa la configuración para una estimación más realista.</Text>
                          <Text style={[styles.warnText, { marginTop: 4 }]}>IRPF orientativo. Para cálculo oficial usar AEAT o gestoría.</Text>
                        </View>
                      ) : null}

                      {payrollVm.irpfMode !== "manual" &&
                      payrollVm.irpfRecommendedPct > 0 &&
                      Math.abs(payrollVm.irpfRecommendedPct - Number(payrollConfig.irpf_auto_applied_pct || 0)) >= 0.5 ? (
                        <Pressable
                          style={({ pressed }) => [
                            styles.saveBtn,
                            { opacity: pressed ? 0.85 : 1, marginTop: 10, backgroundColor: Colors.light.warning },
                            savingPayrollConfig && styles.btnDisabled,
                          ]}
                          disabled={savingPayrollConfig}
                          onPress={applyIrpfRecommended}
                        >
                          {savingPayrollConfig ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <Ionicons name="checkmark-circle" size={18} color="#fff" />
                          )}
                          <Text style={styles.saveBtnText}>Aplicar IRPF recomendado</Text>
                        </Pressable>
                      ) : null}
                    </View>

                    <View style={styles.card}>
                      <SectionHeader title="Resultado final" icon="checkmark-done-outline" />
                      <View style={styles.priceRow}>
                        <Text style={styles.priceLabel}>Bruto cotizable</Text>
                        <Text style={styles.priceLabel}>{formatEUR(payrollVm.brutoCotizable)}</Text>
                      </View>
                      <View style={styles.priceRow}>
                        <Text style={styles.priceLabel}>No cotizable</Text>
                        <Text style={styles.priceLabel}>{formatEUR(payrollVm.totalNoCotizable)}</Text>
                      </View>
                      {!isZero(payrollVm.ssTotal) ? (
                        <View style={styles.priceRow}>
                          <Text style={styles.priceLabel}>Seguridad Social</Text>
                          <Text style={styles.priceLabel}>-{formatEUR(payrollVm.ssTotal)}</Text>
                        </View>
                      ) : null}
                      {!isZero(payrollVm.irpfTotal) ? (
                        <View style={styles.priceRow}>
                          <Text style={styles.priceLabel}>IRPF</Text>
                          <Text style={styles.priceLabel}>-{formatEUR(payrollVm.irpfTotal)}</Text>
                        </View>
                      ) : null}
                      <View style={styles.subsectionDivider} />
                      <View style={styles.summaryNetRow}>
                        <Text style={styles.summaryNetLabel}>Neto estimado</Text>
                        <Text style={styles.summaryNet}>{formatEUR(payrollVm.neto)}</Text>
                      </View>
                      <Pressable
                        style={({ pressed }) => [styles.saveBtn, { opacity: pressed ? 0.85 : 1, marginTop: 14, backgroundColor: Colors.light.tint }]}
                        onPress={() => openSection("config_nomina")}
                      >
                        <Ionicons name="settings-outline" size={18} color="#fff" />
                        <Text style={styles.saveBtnText}>Ajustar configuración de nómina</Text>
                      </Pressable>
                    </View>
                  </>
                ) : (
                  <View style={styles.card}>
                    <SectionHeader title="Estimación de nómina" icon="calculator-outline" />
                    <Text style={styles.emptyText}>No se pudo calcular la estimación con los datos actuales.</Text>
                  </View>
                )}
              </>
            )}

            {shouldShowSection("irpf_cotizacion") && (
              <View style={styles.card}>
                <SectionHeader title="Cotización / IRPF orientativo" icon="receipt-outline" />
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.light.textSecondary, marginBottom: 10 }}>
                  Configura porcentajes y si cada variable cotiza desde “Configuración de nómina”. La estimación es orientativa.
                </Text>
                {renderMenuList([
                  { key: "config_nomina", label: "Configuración de nómina", icon: "settings-outline" as const },
                  { key: "estimacion_nomina", label: "Ver estimación de nómina", icon: "calculator-outline" as const },
                ] as any)}
              </View>
            )}

            {shouldShowSection("periodo") && (
              <View
                onLayout={(e) => {
                  sectionYs.current.periodo = e.nativeEvent.layout.y;
                }}
              >
                <PeriodSettingsCard />
              </View>
            )}

            {shouldShowSection("perfil_conductor") && (
              <View
                onLayout={(e) => {
                  sectionYs.current.perfil_conductor = e.nativeEvent.layout.y;
                }}
              >
                <FerrySettingsCard />
              </View>
            )}

            {shouldShowSection("notificaciones") && (
              <View
                style={styles.card}
                onLayout={(e) => {
                  sectionYs.current.notificaciones = e.nativeEvent.layout.y;
                }}
              >
                <SectionHeader title="Notificaciones" icon="notifications-outline" />

              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <Text style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.light.textSecondary }}>
                  Permiso del sistema
                </Text>
                <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.light.text }}>
                  {loadingPushInfo ? "..." : pushPermissionStatus}
                </Text>
              </View>

              {__DEV__ && pushToken ? (
                <View style={{ marginBottom: 10 }}>
                  <Text style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.light.textSecondary, marginBottom: 4 }}>
                    Token (debug)
                  </Text>
                  <Text selectable style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.light.textSecondary }}>
                    {pushToken}
                  </Text>
                </View>
              ) : null}

              <Pressable
                style={({ pressed }) => [
                  styles.saveBtn,
                  { opacity: pressed ? 0.85 : 1, marginBottom: 10, backgroundColor: Colors.light.tint },
                  loadingPushInfo && styles.btnDisabled,
                ]}
                disabled={loadingPushInfo}
                onPress={requestAndSyncPushToken}
              >
                {loadingPushInfo ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="notifications-outline" size={18} color="#fff" />
                )}
                <Text style={styles.saveBtnText}>Activar permisos / registrar token</Text>
              </Pressable>

              <Pressable
                style={styles.ferryToggleRow}
                disabled={savingNotifPrefs}
                onPress={async () => {
                  if (savingNotifPrefs) return;
                  const next = !notificationsEnabled;
                  if (!next) {
                    setNotificationsEnabled(false);
                    setPushRemindersEnabled(false);
                    setNotifPref({ notifications_enabled: false, push_reminders_enabled: false });
                    safeHaptic();
                    return;
                  }

                  setNotificationsEnabled(true);
                  const res = await registerPushToken();
                  if (!res.ok) {
                    setNotificationsEnabled(false);
                    setPushPermissionStatus(res.permissionStatus ? String(res.permissionStatus) : "unknown");
                    Alert.alert("Error", res.message || "No se pudo registrar el token push");
                    return;
                  }
                  setPushPermissionStatus(res.permissionStatus ? String(res.permissionStatus) : "granted");
                  setPushToken(res.expoPushToken || null);
                  setNotifPref({ notifications_enabled: true });
                  safeHaptic();
                }}
              >
                <View style={styles.ferryToggleLabel}>
                  <Ionicons name="notifications-outline" size={18} color={Colors.light.tint} />
                  <Text style={styles.ferryToggleText}>Activar notificaciones</Text>
                </View>
                <View style={[styles.toggleTrack, notificationsEnabled && styles.toggleTrackOn]}>
                  <View style={[styles.toggleThumb, notificationsEnabled && styles.toggleThumbOn]} />
                </View>
              </Pressable>
              <Text style={styles.ferryHint}>Tacoplan puede recordarte registrar tus jornadas para mantener tus datos al día.</Text>

              <View style={styles.subsectionDivider} />

              <Pressable
                style={styles.ferryToggleRow}
                disabled={!notificationsEnabled || savingNotifPrefs}
                onPress={() => {
                  if (!notificationsEnabled) return;
                  const next = !pushRemindersEnabled;
                  setPushRemindersEnabled(next);
                  setNotifPref({ push_reminders_enabled: next });
                  safeHaptic();
                }}
              >
                <View style={styles.ferryToggleLabel}>
                  <Ionicons name="alarm-outline" size={18} color={Colors.light.tint} />
                  <Text style={styles.ferryToggleText}>Recordatorios de jornadas</Text>
                </View>
                <View style={[styles.toggleTrack, pushRemindersEnabled && notificationsEnabled && styles.toggleTrackOn]}>
                  <View style={[styles.toggleThumb, pushRemindersEnabled && notificationsEnabled && styles.toggleThumbOn]} />
                </View>
              </Pressable>

              <View style={styles.subsectionDivider} />

              <Pressable
                style={styles.ferryToggleRow}
                disabled={!notificationsEnabled || savingNotifPrefs}
                onPress={() => {
                  if (!notificationsEnabled) return;
                  const next = !payrollNotificationsEnabled;
                  setPayrollNotificationsEnabled(next);
                  setNotifPref({ payroll_notifications_enabled: next });
                  safeHaptic();
                }}
              >
                <View style={styles.ferryToggleLabel}>
                  <Ionicons name="wallet-outline" size={18} color={Colors.light.tint} />
                  <Text style={styles.ferryToggleText}>Aviso nómina estimada</Text>
                </View>
                <View style={[styles.toggleTrack, payrollNotificationsEnabled && notificationsEnabled && styles.toggleTrackOn]}>
                  <View style={[styles.toggleThumb, payrollNotificationsEnabled && notificationsEnabled && styles.toggleThumbOn]} />
                </View>
              </Pressable>
              <Text style={styles.ferryHint}>Al cierre del ciclo, Tacoplan puede avisarte de que ya tienes la estimación del periodo.</Text>

              <View style={styles.subsectionDivider} />

              <Pressable
                style={({ pressed }) => [
                  styles.saveBtn,
                  { opacity: pressed ? 0.85 : 1, backgroundColor: Colors.light.warning },
                  (sendingTestPush || !notificationsEnabled || pushPermissionStatus !== "granted") && styles.btnDisabled,
                ]}
                disabled={sendingTestPush || !notificationsEnabled || pushPermissionStatus !== "granted"}
                onPress={sendTestPush}
              >
                {sendingTestPush ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="paper-plane-outline" size={18} color="#fff" />
                )}
                <Text style={styles.saveBtnText}>Enviar notificación de prueba</Text>
              </Pressable>
              </View>
            )}

            {shouldShowSection("admin") && isAdmin && (
              <View
                style={styles.card}
                onLayout={(e) => {
                  sectionYs.current.admin = e.nativeEvent.layout.y;
                }}
              >
                <SectionHeader title="Admin" icon="lock-closed-outline" />
                <Pressable
                  style={({ pressed }) => [styles.ferryToggleRow, { opacity: pressed ? 0.85 : 1 }]}
                  onPress={() => router.push("/admin")}
                >
                  <View style={styles.ferryToggleLabel}>
                    <Ionicons name="grid-outline" size={18} color={Colors.light.tint} />
                    <Text style={styles.ferryToggleText}>Panel Admin</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={Colors.light.textSecondary} />
                </Pressable>
              </View>
            )}
          </>
        )}

        {user && (!showOnlySection || activeSection === "festivos") && (
          <View
            style={styles.card}
            onLayout={(e) => {
              sectionYs.current.festivos = e.nativeEvent.layout.y;
            }}
          >
            <SectionHeader title={t("usuario.holidays")} icon="flag-outline" />
            {loadingHolidays ? (
              <ActivityIndicator color={Colors.light.tint} style={{ paddingVertical: 16 }} />
            ) : (
              <>
                <View style={styles.addHolidayRow}>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    value={newHolidayDate}
                    onChangeText={setNewHolidayDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#9CA3AF"
                  />
                  <TextInput
                    style={[styles.input, { flex: 1.5 }]}
                    value={newHolidayName}
                    onChangeText={setNewHolidayName}
                    placeholder={t("usuario.holidayName")}
                    placeholderTextColor="#9CA3AF"
                  />
                  <Pressable
                    style={({ pressed }) => [
                      styles.iconBtn,
                      { opacity: pressed ? 0.7 : 1 },
                      addingHoliday && styles.btnDisabled,
                    ]}
                    onPress={addHoliday}
                    disabled={addingHoliday}
                  >
                    {addingHoliday ? (
                      <ActivityIndicator size="small" color={Colors.light.success} />
                    ) : (
                      <Ionicons name="add-circle" size={28} color={Colors.light.success} />
                    )}
                  </Pressable>
                </View>
                {holidays.length === 0 ? (
                  <Text style={styles.emptyText}>{t("usuario.addHolidaysHint")}</Text>
                ) : (
                  holidays.map((h) => (
                    <View key={h.id} style={styles.holidayRow}>
                      <View style={styles.holidayInfo}>
                        <Text style={styles.holidayDate}>{h.date}</Text>
                        <Text style={styles.holidayName}>{h.name}</Text>
                      </View>
                      <Pressable onPress={() => deleteHoliday(h.id)} hitSlop={8}>
                        <Ionicons name="trash-outline" size={18} color={Colors.light.danger} />
                      </Pressable>
                    </View>
                  ))
                )}
              </>
            )}
          </View>
        )}
          </>
        )}
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
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: Colors.light.tint,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    flexGrow: 1,
  },
  loadingWrap: {
    paddingTop: 60,
    alignItems: "center" as const,
  },
  card: {
    backgroundColor: Colors.light.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  sectionHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
  },
  subsectionLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.tint,
    marginBottom: 6,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  subsectionDivider: {
    height: 1,
    backgroundColor: Colors.light.border,
    marginVertical: 12,
  },
  summaryTop: {
    flexDirection: "row" as const,
    gap: 12,
  },
  summaryRight: {
    alignItems: "flex-end" as const,
    minWidth: 150,
  },
  summaryLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: Colors.light.textSecondary,
  },
  summaryValue: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
  },
  summaryGross: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
  },
  summaryNet: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: Colors.light.tint,
  },
  summaryHint: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    marginTop: 12,
    lineHeight: 16,
  },
  summaryNetRow: {
    flexDirection: "row" as const,
    alignItems: "baseline" as const,
    justifyContent: "space-between" as const,
  },
  summaryNetLabel: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
  },
  warnBox: {
    backgroundColor: "#FEF3C7",
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
  },
  warnText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: "#92400E",
  },
  priceRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: 8,
  },
  priceLabel: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: Colors.light.text,
    minWidth: 80,
  },
  priceInputWrap: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  priceInput: {
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    color: Colors.light.text,
    textAlign: "right" as const,
    width: 100,
  },
  priceUnit: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.light.textSecondary,
    width: 30,
  },
  table: {
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 12,
    overflow: "hidden" as const,
  },
  tableRow: {
    flexDirection: "row" as const,
    alignItems: "stretch" as const,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  tableHeaderRow: {
    backgroundColor: `${Colors.light.tint}08`,
    borderTopWidth: 0,
  },
  tableCell: {
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  tableCellConcepto: {
    flex: 2.2,
  },
  tableCellCantidad: {
    flex: 1,
    textAlign: "right" as const,
  },
  tableCellPrecio: {
    flex: 1.2,
    textAlign: "right" as const,
  },
  tableCellTotal: {
    flex: 1.2,
    textAlign: "right" as const,
  },
  tableHeaderText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.textSecondary,
  },
  tableText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.light.text,
  },
  tableSecondary: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  saveBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
    backgroundColor: Colors.light.tint,
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 14,
  },
  saveBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  profileRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    marginBottom: 12,
  },
  profileEmail: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
  },
  fieldLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.light.textSecondary,
    marginBottom: 4,
  },
  inlineRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
  },
  gridForm: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 8,
  },
  gridFormItem: {
    width: "48%" as any,
  },
  input: {
    backgroundColor: Colors.light.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.light.text,
  },
  iconBtn: {
    padding: 4,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  logoutBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    backgroundColor: Colors.light.danger,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  deleteAccountBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    backgroundColor: "#7F1D1D",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  logoutBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  guestBanner: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    backgroundColor: "#EFF6FF",
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  guestBannerText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.light.text,
    lineHeight: 18,
  },
  addHolidayRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    marginBottom: 10,
  },
  holidayRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  holidayInfo: {
    flex: 1,
    gap: 2,
  },
  holidayDate: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
  },
  holidayName: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
  },
  emptyText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    textAlign: "center" as const,
    paddingVertical: 12,
  },
  periodOption: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  periodOptionSel: {
    backgroundColor: `${Colors.light.tint}08`,
    borderRadius: 8,
  },
  periodOptionText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: Colors.light.text,
  },
  periodCompactRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginTop: 4,
    marginBottom: 8,
    paddingLeft: 28,
  },
  periodLabel: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: Colors.light.text,
  },
  periodSmallInput: {
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Colors.light.tint,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
    textAlign: "center" as const,
    width: 48,
  },
  periodPreviewBox: {
    backgroundColor: "#F0F9FF",
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
    marginBottom: 12,
  },
  periodPreviewLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#6B7280",
  },
  periodPreviewValue: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.tint,
    marginTop: 2,
  },
  periodSaveBtn: {
    backgroundColor: Colors.light.tint,
    borderRadius: 8,
    paddingVertical: 10,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
  },
  periodSaveBtnText: {
    color: "#fff",
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  ferryToggleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingVertical: 10,
  },
  ferryToggleLabel: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    flex: 1,
  },
  ferryToggleText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: Colors.light.text,
  },
  toggleTrack: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#D1D5DB",
    justifyContent: "center" as const,
    paddingHorizontal: 2,
  },
  toggleTrackOn: {
    backgroundColor: Colors.light.tint,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#fff",
  },
  toggleThumbOn: {
    alignSelf: "flex-end" as const,
  },
  ferryHint: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    marginTop: 4,
    marginLeft: 28,
  },
});
