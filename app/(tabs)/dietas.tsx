import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  Platform,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Colors from "@/constants/colors";
import { usePeriod } from "@/lib/period-context";
import { useI18n } from "@/lib/i18n-context";
import { getResumenDietas, findRate, getMoroccoJornadaSummary, getFerryExtrasSummary, type UserDietRate, type UserDayExtras } from "@/lib/local-storage";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useAuth } from "@/lib/auth-context";
import { getApiUrl } from "@/lib/query-client";
import { useSync } from "@/lib/sync-context";
import { useFerry } from "@/lib/ferry-context";

type ResumenDietas = {
  total: number;
  desglose: Array<{ tipo: string; cantidad: number; total: number }>;
  extras: { totalExtras: number; desglose: Array<{ tipo: string; cantidad: number; total: number }> };
  plus: { totalPlus: number; desglose: Array<{ tipo: string; cantidad: number; total: number }> };
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
  const { user, isGuest, getAccessToken } = useAuth();
  const { syncVersion } = useSync();
  const { config: ferryConfig, isMoroccoMode } = useFerry();
  const [periodoIdx, setPeriodoIdx] = useState(0);
  const [customRates, setCustomRates] = useState<UserDietRate[] | null>(null);
  const [dayExtras, setDayExtras] = useState<UserDayExtras>({ extra_saturday: 10, extra_sunday: 15, extra_holiday: 20 });

  const { getPeriod } = usePeriod();

  const loadConfig = useCallback(async () => {
    try {
      const local = await AsyncStorage.getItem("tacoplan_user_settings");
      if (local) {
        const s = JSON.parse(local);
        setCustomRates([
          { trip_type: "NACIONAL", percent: 100, amount: parseFloat(s.nac_100) || 54.30 },
          { trip_type: "NACIONAL", percent: 60, amount: parseFloat(s.nac_60) || 32.58 },
          { trip_type: "NACIONAL", percent: 30, amount: parseFloat(s.nac_30) || 16.29 },
          { trip_type: "INTERNACIONAL", percent: 100, amount: parseFloat(s.intl_100) || 72.77 },
          { trip_type: "INTERNACIONAL", percent: 60, amount: parseFloat(s.intl_60) || 43.66 },
          { trip_type: "INTERNACIONAL", percent: 30, amount: parseFloat(s.intl_30) || 21.83 },
          { trip_type: "REGIONAL", percent: 100, amount: parseFloat(s.reg_100) || 0 },
          { trip_type: "REGIONAL", percent: 60, amount: parseFloat(s.reg_60) || 0 },
          { trip_type: "REGIONAL", percent: 30, amount: parseFloat(s.reg_30) || 0 },
        ]);
        setDayExtras({
          extra_saturday: parseFloat(s.extra_saturday) || 10,
          extra_sunday: parseFloat(s.extra_sunday) || 15,
          extra_holiday: parseFloat(s.extra_holiday) || 20,
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
        const ratesData = await ratesRes.json();
        if (ratesData.rates && ratesData.rates.length > 0) setCustomRates(ratesData.rates);
      }
      if (extrasRes.ok) {
        const extrasData = await extrasRes.json();
        const ex = extrasData.extras;
        if (ex) {
          setDayExtras({
            extra_saturday: Number(ex.extra_saturday) || 10,
            extra_sunday: Number(ex.extra_sunday) || 15,
            extra_holiday: Number(ex.extra_holiday) || 20,
          });
        }
      }
    } catch (_) {}
  }, [isGuest, user, getAccessToken]);

  useFocusEffect(
    useCallback(() => {
      loadConfig();
    }, [loadConfig])
  );

  const periodo = useMemo(() => {
    return getPeriod(periodoIdx);
  }, [periodoIdx, getPeriod]);

  const resumenQuery = useQuery<ResumenDietas>({
    queryKey: ["dietas-resumen", periodo.from, periodo.to, syncVersion],
    queryFn: () => getResumenDietas(periodo.from, periodo.to),
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

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={resumenQuery.isRefetching}
            onRefresh={() => {
              qc.invalidateQueries({ queryKey: ["dietas-resumen"] });
              qc.invalidateQueries({ queryKey: ["ferry-extras-summary"] });
            }}
            tintColor={Colors.light.tint}
          />
        }
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t("dietas.title")}</Text>
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

        {resumenQuery.isLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={Colors.light.tint} />
          </View>
        ) : data ? (
          <>
            {!(isMoroccoMode && ferryConfig.paymentMode !== "morocco_diet") && (
            <View style={styles.totalCard}>
              <View style={styles.totalIcon}>
                <Ionicons name="wallet" size={32} color={Colors.light.accent} />
              </View>
              <Text style={styles.totalLabel}>{t("dietas.totalDiets")}</Text>
              <Text style={styles.totalValue}>{data.total.toFixed(2)} EUR</Text>
              <Text style={styles.totalSub}>{t("dietas.periodLabel")} {periodo.label}</Text>
            </View>
            )}

            {!(isMoroccoMode && ferryConfig.paymentMode !== "morocco_diet") && (
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
                      {t(`common.dietType.${d.tipo}`)}
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
                <Text style={styles.emptyText}>{t("dietas.noDiets")}</Text>
              </View>
            ))}

            {!(isMoroccoMode && ferryConfig.paymentMode !== "morocco_diet") && (
            <View style={styles.refCard}>
              <Text style={styles.refTitle}>{t("dietas.yourRates")}</Text>
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
            </View>
            )}

            {((data.extras && data.extras.totalExtras > 0) || (data.plus && data.plus.totalPlus > 0)) && (
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
                    <Text style={styles.extrasType}>{t(`common.dayFlag.${e.tipo}`)}</Text>
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
          </>
        ) : null}

        <View style={{ height: 100 }} />
      </ScrollView>
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
  plusCard: {
    backgroundColor: Colors.light.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: Colors.light.tint,
  },
});
