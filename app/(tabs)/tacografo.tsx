import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Clipboard,
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  SectionList,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { formatMinutosHoras } from "@/lib/utils";
import { useI18n } from "@/lib/i18n-context";
import { useTachograph } from "@/lib/tachograph/tachograph-context";
import type {
  TachographActivity,
  TachographBondState,
  TachographConnectionState,
  TachographCreditsState,
  TachographEvent,
  TachographFifoState,
  TachographScanDevice,
  TachographTransportState,
  TachographDetectedServices,
} from "@/lib/tachograph/types";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/lib/auth-context";
import { bleDiagnostic, friendlyBleError, type BleHardwareDiagnostic } from "@/lib/tachograph/tachographBluetoothService";
import { supabase } from "@/lib/supabase";

type Tab = "live" | "record";

function formatNullableMinutes(mins: number | null | undefined): string {
  if (mins == null) return "No disponible";
  return formatMinutosHoras(mins);
}

function formatNullableNumber(n: number | null | undefined, suffix = ""): string {
  if (n == null) return "No disponible";
  return `${n}${suffix}`;
}

const ADMIN_ALLOWED_EMAILS = new Set(["yosf.bouncy@gmail.com"]);

async function isTacographAdmin(userId: string | undefined, email: string | undefined): Promise<boolean> {
  if (email && ADMIN_ALLOWED_EMAILS.has(String(email).toLowerCase())) return true;
  if (!userId) return false;
  try {
    const { data, error } = await supabase
      .from("admin_users")
      .select("user_id,is_active,module_tachograph")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return false;
    if (!data?.user_id) return false;
    if ((data as any).is_active === false) return false;
    const moduleTacho = (data as any).module_tachograph;
    if (moduleTacho != null && moduleTacho !== true && moduleTacho !== "true" && moduleTacho !== 1) return false;
    return true;
  } catch {
    return false;
  }
}

function AdminGateFallbackScreen() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.light.background }}>
      <View style={{ flex: 1, paddingTop: insets.top, paddingHorizontal: 24, alignItems: "center", justifyContent: "center" }}>
        <View style={{
          width: 84,
          height: 84,
          borderRadius: 24,
          backgroundColor: Colors.light.surface,
          borderWidth: 1,
          borderColor: Colors.light.border,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 24,
        }}>
          <Ionicons name="build-outline" size={40} color={Colors.light.textSecondary} />
        </View>
        <Text style={{
          fontSize: 22,
          fontFamily: "Inter_700Bold",
          color: Colors.light.text,
          marginBottom: 10,
          textAlign: "center",
        }}>
          Tacógrafo
        </Text>
        <Text style={{
          fontSize: 14,
          fontFamily: "Inter_500Medium",
          color: Colors.light.textSecondary,
          textAlign: "center",
          maxWidth: 340,
          lineHeight: 22,
        }}>
          Esta funcionalidad está en desarrollo y solo está disponible para cuentas de administrador.
        </Text>
        <Text style={{
          marginTop: 8,
          fontSize: 13,
          fontFamily: "Inter_500Medium",
          color: Colors.light.textSecondary,
          textAlign: "center",
          maxWidth: 340,
          opacity: 0.85,
        }}>
          {t("dashboard.pendingCompensations").includes("Compensaciones") ? "" : ""}
          Si necesitas acceder contacta con soporte.
        </Text>
      </View>
    </SafeAreaView>
  );
}

export default function TacografoScreen() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [adminCheckLoading, setAdminCheckLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setAdminCheckLoading(true);
      const ok = await isTacographAdmin(user?.id, user?.email);
      if (!alive) return;
      setIsAdmin(ok);
      setAdminCheckLoading(false);
    })();
    return () => { alive = false; };
  }, [user?.id, user?.email]);

  if (adminCheckLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.light.background, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={Colors.light.tint} />
      </View>
    );
  }
  if (!isAdmin) {
    return <AdminGateFallbackScreen />;
  }
  return <TacografoScreenContent />;
}

function TacografoScreenContent() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const {
    service,
    connectionState,
    device,
    live,
    eventsForJornada,
    bindActiveJornada,
    supported,
    startAutoFetch,
    stopAutoFetch,
    isAutoFetchRunning,
    fetchTachoFifoOnce,
    bondState,
    detectedServices,
    mtuNegotiated,
    transportState,
    fifoState,
    creditsState,
    creditsAvailable,
    creditsConsumed,
  } = useTachograph();
  const ctxUser = useAuth();
  const user = ctxUser.user;

  const [tab, setTab] = useState<Tab>("live");
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<TachographScanDevice[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [dayEvents, setDayEvents] = useState<TachographEvent[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [permMessage, setPermMessage] = useState<string | null>(null);
  const [diagTick, setDiagTick] = useState<number>(0);
  const [fetchTick, setFetchTick] = useState<number>(0);
  const [lastFetchResult, setLastFetchResult] = useState<{ fetchedCount: number; bytesTotal: number; at: string | null }>({ fetchedCount: 0, bytesTotal: 0, at: null });
  const [isFetching, setIsFetching] = useState(false);
  const [authorizedList, setAuthorizedList] = useState<any[]>([]);

  const rerenderDiag = () => setDiagTick((x) => x + 1);
  const rerenderFetch = () => setFetchTick((x) => x + 1);

  const reloadAuthorized = async () => {
    if (!service) return;
    try {
      const list = await service.listAuthorized();
      setAuthorizedList(list || []);
    } catch {}
  };

  useEffect(() => {
    reloadAuthorized();
  }, [service, connectionState]);

  const autoRunning = (() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = fetchTick;
    return isAutoFetchRunning();
  })();

  const snapshotDiag = useMemo<BleHardwareDiagnostic>(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = diagTick;
    return { ...bleDiagnostic, notes: [...(bleDiagnostic.notes || [])] };
  }, [diagTick]);

  useEffect(() => {
    const t = setInterval(() => {
      rerenderDiag();
      rerenderFetch();
    }, 1500);
    return () => clearInterval(t);
  }, []);

  const copyDiagnostic = async () => {
    const lines: string[] = [];
    lines.push("=== TACOPLAN BLE HARDWARE DIAGNOSTIC ===");
    lines.push(`GeneratedAt: ${new Date().toISOString()}`);
    lines.push(`Platform: ${snapshotDiag.platform}`);
    lines.push(`bleAvailable: ${snapshotDiag.bleAvailable}`);
    lines.push(`moduleImport: ${snapshotDiag.moduleImport}${snapshotDiag.moduleImportReason ? ` | ${snapshotDiag.moduleImportReason}` : ""}`);
    lines.push(`singletonCtor: ${snapshotDiag.singletonCtor}${snapshotDiag.singletonCtorReason ? ` | ${snapshotDiag.singletonCtorReason}` : ""}`);
    lines.push(`managerState: ${snapshotDiag.managerState ?? "-"}`);
    lines.push(`requestPermissions: ${snapshotDiag.requestPermissions ? JSON.stringify(snapshotDiag.requestPermissions) : "-"}`);
    lines.push(`foundDevices: ${found.length}`);
    lines.push(`bondState: ${bondState}`);
    lines.push(`transportState: ${transportState}`);
    lines.push(`fifoState: ${fifoState}`);
    lines.push(`creditsState: ${creditsState} | avail=${creditsAvailable ?? "null"} consumed=${creditsConsumed}`);
    lines.push(`mtuNegotiated: ${mtuNegotiated ?? "-"}`);
    if (detectedServices) {
      lines.push(`ITS services: download=${detectedServices.downloadService} diagnostic=${detectedServices.diagnosticService} allFound=${detectedServices.allServicesFound}`);
    }
    if (snapshotDiag.lastScanError) {
      lines.push("--- lastScanError ---");
      lines.push(`  message: ${snapshotDiag.lastScanError.rawMessage}`);
      lines.push(`  reason:  ${JSON.stringify(snapshotDiag.lastScanError.reason)}`);
      lines.push(`  errorCode: ${String(snapshotDiag.lastScanError.errorCode ?? "")}`);
      lines.push(`  androidErrorCode: ${String(snapshotDiag.lastScanError.androidErrorCode ?? "")}`);
      lines.push(`  iosErrorCode: ${String(snapshotDiag.lastScanError.iosErrorCode ?? "")}`);
      lines.push(`  attErrorCode: ${String(snapshotDiag.lastScanError.attErrorCode ?? "")}`);
      if (snapshotDiag.lastScanError.stack) lines.push(`  stack: ${snapshotDiag.lastScanError.stack.split("\n").slice(0, 4).join(" | ")}`);
    } else {
      lines.push("lastScanError: -");
    }
    if (snapshotDiag.lastConnectError) {
      lines.push("--- lastConnectError ---");
      lines.push(`  message: ${snapshotDiag.lastConnectError.rawMessage}`);
      lines.push(`  reason:  ${JSON.stringify(snapshotDiag.lastConnectError.reason)}`);
      lines.push(`  errorCode: ${String(snapshotDiag.lastConnectError.errorCode ?? "")}`);
      lines.push(`  androidErrorCode: ${String(snapshotDiag.lastConnectError.androidErrorCode ?? "")}`);
      lines.push(`  iosErrorCode: ${String(snapshotDiag.lastConnectError.iosErrorCode ?? "")}`);
      lines.push(`  attErrorCode: ${String(snapshotDiag.lastConnectError.attErrorCode ?? "")}`);
      if (snapshotDiag.lastConnectError.stack) lines.push(`  stack: ${snapshotDiag.lastConnectError.stack.split("\n").slice(0, 4).join(" | ")}`);
    } else {
      lines.push("lastConnectError: -");
    }
    lines.push("--- notes (últimos 15) ---");
    (snapshotDiag.notes || []).forEach((n, i) => lines.push(`  [${i + 1}] ${n}`));
    const text = lines.join("\n");
    try {
      if (Clipboard?.setString) {
        await Clipboard.setString(text);
        Alert.alert("Copiado", "Diagnóstico hardware copiado al portapapeles. Pégalo en el chat para que el desarrollador vea el reason exacto.");
      } else if ((Share as any)?.share) {
        await (Share as any).share({ message: text, title: "Tacoplan BLE diagnostic" });
      }
    } catch (e) {
      Alert.alert("No se pudo copiar", String(e instanceof Error ? e.message : e));
    }
  };

  const isExpoGoHint = (msg: string | null): boolean => {
    if (!msg) return false;
    return msg.includes("Expo Dev Build") || msg.includes("EAS") || msg.includes("BLE_UNSUPPORTED") || msg.includes("Expo Go");
  };

  useEffect(() => {
    if (!supported) {
      setPermMessage(t("tacho.bleDevBuildHint"));
    }
  }, [supported, t]);
  useEffect(() => {
    service?.setUserId(user?.id ?? null);
  }, [service, user?.id]);

  const refreshEventsForDay = async () => {
    if (!service) return;
    const evs = await service.eventsForDay(selectedDate);
    setDayEvents(evs);
    const jToday = evs.find((e) => !!e.jornadaId);
    if (jToday?.jornadaId) {
      bindActiveJornada({ id: jToday.jornadaId });
    }
  };

  useFocusEffect(
    React.useCallback(() => {
      refreshEventsForDay();
    }, [selectedDate, service]),
  );

  useEffect(() => {
    if (service) {
      refreshEventsForDay();
    }
  }, [service, connectionState]);

  const statusLabel = (() => {
    switch (connectionState) {
      case "connected":
      case "transport_ready":
        return t("tacho.statusConnected");
      case "disconnected":
        return t("tacho.statusDisconnected");
      case "scanning":
        return t("tacho.statusScanning");
      case "connecting":
      case "discovering":
      case "bonding":
      case "bonded":
      case "transport_init":
        return t("tacho.statusConnecting");
      case "unsupported":
        return t("tacho.statusUnsupported");
      case "error":
        return t("tacho.statusError");
      default:
        return t("tacho.statusDisconnected");
    }
  })();

  const statusColor = (() => {
    switch (connectionState) {
      case "connected":
      case "transport_ready":
      case "bonded":
        return Colors.light.success;
      case "connecting":
      case "discovering":
      case "scanning":
      case "bonding":
      case "transport_init":
        return Colors.light.tint;
      case "disconnected":
      case "idle":
      case "unsupported":
        return Colors.light.textSecondary;
      case "error":
      default:
        return Colors.light.danger;
    }
  })();

  const startScan = async () => {
    if (!service) {
      setPermMessage(t("tacho.bleDevBuildHint"));
      return;
    }
    const p = await service.ensurePermissions();
    bleDiagnostic.requestPermissions = { ok: p.ok, reason: p.reason };
    rerenderDiag();
    if (!p.ok) {
      const reason = p.reason || "";
      if (
        reason === "EXPO_GO_AND_WEB_UNSUPPORTED" ||
        reason === "BLE_UNSUPPORTED" ||
        reason === "BLE_UNSUPPORTED_IN_EXPO_GO" ||
        reason.includes("NativeEventEmitter") ||
        reason.includes("new NativeEventEmitter") ||
        reason.includes("requires anon-null") ||
        reason.includes("requires non-null")
      ) {
        setPermMessage(t("tacho.bleDevBuildHint"));
      } else if (reason === "PERMISSION_DENIED" || reason === "BLUETOOTH_OFF") {
        setPermMessage(friendlyBleError({ message: reason, reason }, "comprobar Bluetooth"));
      } else {
        setPermMessage(reason || "");
      }
      return;
    }
    setPermMessage(null);
    // FASE 2: Limpieza explícita lista antes de scan nuevo.
    setFound([]);
    setScanning(true);
    try {
      await service.startScan({
        onDeviceFound: (d) => {
          setFound((prev) => {
            if (prev.some((x) => x.identifier === d.identifier)) return prev;
            return [...prev, d];
          });
        },
        onDeviceUpdated: (d) => {
          // FASE 5: actualizar fila existente (RSSI cambia cada ADV).
          setFound((prev) => {
            const idx = prev.findIndex((x) => x.identifier === d.identifier);
            if (idx < 0) return [...prev, d];
            const next = [...prev];
            next[idx] = d;
            return next;
          });
        },
        onScanError: (e) => {
          const msg = e?.message || "";
          if (
            msg.includes("BLE_UNSUPPORTED") ||
            msg.includes("EXPO_GO") ||
            msg.includes("NativeEventEmitter")
          ) {
            setPermMessage(t("tacho.bleDevBuildHint"));
          } else {
            setPermMessage(msg);
          }
          setScanning(false);
          rerenderDiag();
        },
        onScanStopped: () => {
          setScanning(false);
          rerenderDiag();
        },
      });
    } catch (e) {
      setScanning(false);
      const msg = e instanceof Error ? e.message : String(e);
      setPermMessage(msg);
    }
    // FASE 4: NO hay setTimeout(stopScan, 12s) aquí. El BluetoothScanner lleva
    // su propio SAFETY_TIMEOUT_MS = 60s; el usuario puede parar manualmente.
  };

  const stopScan = () => {
    service?.stopScan();
    setScanning(false);
  };

  const authorize = async (scan: TachographScanDevice) => {
    if (!service) return;
    stopScan();
    await service.authorizeAndConnect(scan);
    reloadAuthorized();
  };

  const reconnectSaved = async (saved: any) => {
    if (!service) return;
    stopScan();
    const scanLike: TachographScanDevice = {
      identifier: saved.identifier,
      name: saved.name,
      rssi: saved.rssi ?? null,
    };
    await service.authorizeAndConnect(scanLike);
  };

  const disconnect = async () => {
    await service?.disconnect();
    reloadAuthorized();
  };

  const forgetDevice = async (saved: any) => {
    if (!service) return;
    Alert.alert(
      "Olvidar tacógrafo",
      `¿Eliminar ${saved.name || saved.identifier} de la lista de guardados?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            try {
              await service.removeAuthorized(saved.identifier);
              reloadAuthorized();
            } catch (e) {
              Alert.alert("No se pudo eliminar", String(e instanceof Error ? e.message : e));
            }
          },
        },
      ],
    );
  };

  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const dayLabel = selectedDate === todayStr
    ? t("tacho.today")
    : selectedDate === yesterdayStr
      ? t("tacho.yesterday")
      : `${t("tacho.otherDay")} ${selectedDate}`;

  const activityColor = (a: TachographActivity) => {
    switch (a) {
      case "DRIVING":
        return Colors.light.tint;
      case "WORK":
        return Colors.light.warning;
      case "AVAILABLE":
        return Colors.light.textSecondary;
      case "REST":
        return Colors.light.success;
      default:
        return Colors.light.border;
    }
  };
  const activityLabel = (a: TachographActivity) => {
    switch (a) {
      case "DRIVING":
        return t("tacho.activityDriving");
      case "WORK":
        return t("tacho.activityWork");
      case "AVAILABLE":
        return t("tacho.activityAvailable");
      case "REST":
        return t("tacho.activityRest");
      default:
        return t("tacho.activityUnknown");
    }
  };

  const renderEvent = (ev: TachographEvent) => {
    const time = ev.timestamp.slice(11, 16);
    if (ev.eventType === "country_entry" && ev.newCountry) {
      return (
        <View key={(ev.id || ev.eventUid)} style={styles.recordRow}>
          <View style={[styles.recordDot, { backgroundColor: Colors.light.tint }]} />
          <Text style={styles.recordTime}>{time}</Text>
          <Ionicons name="flag" size={14} color={Colors.light.tint} />
          <Text style={styles.recordText}>
            {t("tacho.eventCountryEntry")} {ev.newCountry}
          </Text>
          <View style={{ flex: 1 }} />
          <Text style={styles.recordSource}>{ev.source === "tachograph_ble" ? t("tacho.tachoValue") : t("tacho.manualValue")}</Text>
        </View>
      );
    }
    if (ev.eventType === "activity_change" && ev.newActivity) {
      return (
        <View key={(ev.id || ev.eventUid)} style={styles.recordRow}>
          <View style={[styles.recordDot, { backgroundColor: activityColor(ev.newActivity) }]} />
          <Text style={styles.recordTime}>{time}</Text>
          <Text style={[styles.recordText, { color: activityColor(ev.newActivity) }]}>
            {activityLabel(ev.newActivity)}
          </Text>
          {Number(ev.durationMin || 0) > 0 ? (
            <Text style={styles.recordDuration}>
              {formatMinutosHoras(ev.durationMin!)}
            </Text>
          ) : null}
          <View style={{ flex: 1 }} />
          <Text style={styles.recordSource}>{ev.source === "tachograph_ble" ? t("tacho.tachoValue") : t("tacho.manualValue")}</Text>
        </View>
      );
    }
    return (
      <View key={(ev.id || ev.eventUid)} style={styles.recordRow}>
        <View style={[styles.recordDot, { backgroundColor: Colors.light.border }]} />
        <Text style={styles.recordTime}>{time}</Text>
        <Text style={styles.recordText}>{ev.eventType}</Text>
      </View>
    );
  };

  const recordContent = useMemo(() => {
    const list = dayEvents.length > 0 ? dayEvents : eventsForJornada;
    return [...list].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }, [dayEvents, eventsForJornada]);

  // ===========================================================
  // FASE 20: Panel diagnóstico estados REALES 14 campos
  // ===========================================================
  const diagRows = buildFase20DiagnosticRows({
    snapshotDiag,
    supported,
    scanning,
    foundCount: found.length,
    connectionState,
    device,
    live,
    bondState,
    detectedServices,
    fifoState,
    creditsState,
    transportState,
  });

  // FASE 11: Consentimiento ITS del conductor (mientras UNKNOWN)
  const itsConsentHint = (() => {
    const s = live.itsConsentState || "UNKNOWN";
    if (s === "GRANTED") return null;
    if (connectionState !== "connected" && connectionState !== "transport_ready") return null;
    return "Activa el consentimiento ITS en el menú del tacógrafo con tu tarjeta de conductor insertada.";
  })();

  return (
    <SafeAreaView style={[styles.safe, { paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("tacho.title")}</Text>
        <View style={[styles.statusPill, { backgroundColor: statusColor + "22", borderColor: statusColor + "55" }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      <View style={styles.tabRow}>
        <Pressable
          onPress={() => setTab("live")}
          style={[styles.tabChip, tab === "live" && styles.tabChipActive]}
        >
          <Text style={[styles.tabText, tab === "live" && styles.tabTextActive]}>{t("tacho.live")}</Text>
        </Pressable>
        <Pressable
          onPress={() => setTab("record")}
          style={[styles.tabChip, tab === "record" && styles.tabChipActive]}
        >
          <Text style={[styles.tabText, tab === "record" && styles.tabTextActive]}>{t("tacho.record")}</Text>
        </Pressable>
      </View>

      {tab === "live" ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={async () => {
              setRefreshing(true);
              await refreshEventsForDay();
              setRefreshing(false);
            }} />
          }
        >
          {permMessage ? (
            isExpoGoHint(permMessage) ? (
              <View style={styles.calloutWarn}>
                <Text style={styles.calloutTitle}>{t("tacho.bleDevBuildHint")}</Text>
                <Text style={styles.calloutBody}>
                  Para buscar el tacógrafo REAL (tu Stoneridge SE5000, VDO, Actia, Efkon), necesitas compilar un build nativo.
                  {"\n"}
                  Expo Go NO incluye Bluetooth nativo → no puede detectar el tacógrafo.
                </Text>
              </View>
            ) : (
              <View style={styles.calloutError}>
                <Text style={styles.calloutTitle}>{permMessage}</Text>
              </View>
            )
          ) : null}

          {/* Diagnóstico hardware BLE + FASE 20 panel estados */}
          <View style={[styles.card, { marginTop: 8, borderColor: Colors.light.border + "99" }]}>
            <View style={[styles.cardRow, { paddingVertical: 2, marginBottom: 6 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="hardware-chip-outline" size={18} color={Colors.light.textSecondary} />
                <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.light.text }}>
                  Diagnóstico hardware Bluetooth
                </Text>
              </View>
              <Pressable onPress={copyDiagnostic} style={({ pressed }) => [
                styles.smallPrimaryBtn,
                { paddingHorizontal: 10, paddingVertical: 8, opacity: pressed ? 0.85 : 1 },
              ]}>
                <Text style={[styles.smallPrimaryBtnText, { fontSize: 12 }]}>Copiar diagnóstico</Text>
              </Pressable>
            </View>
            <Text style={{ color: Colors.light.textSecondary, fontSize: 11, marginBottom: 10, fontFamily: "Inter_400Regular" }}>
              Estados FASE 20 reales · Si no detecta tu tacógrafo, copia este diagnóstico y pégalo.
            </Text>
            {diagRows.map((row, i) => {
              const [label, value, status] = row as [string, string, string];
              const color = status === "ok"
                ? Colors.light.success
                : status === "fail"
                  ? Colors.light.danger
                  : Colors.light.warning;
              return (
                <View key={i} style={[styles.cardRow, { paddingVertical: 4, gap: 10 }]}>
                  <Text style={{ color: Colors.light.textSecondary, fontFamily: "Inter_500Medium", fontSize: 12.5, width: 170 }}>
                    {label}
                  </Text>
                  <Text style={{
                    color,
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 12,
                    textAlign: "right",
                    flex: 1,
                    flexWrap: "wrap",
                  }} numberOfLines={3}>
                    {value || "-"}
                  </Text>
                </View>
              );
            })}
            {(snapshotDiag.notes || []).length > 0 ? (
              <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: Colors.light.border + "66", paddingTop: 8 }}>
                <Text style={{ color: Colors.light.textSecondary, fontSize: 11, fontFamily: "Inter_500Medium", marginBottom: 4 }}>
                  Notas internas (últimas {(snapshotDiag.notes || []).length}):
                </Text>
                {(snapshotDiag.notes || []).slice(-6).map((n, i) => (
                  <Text key={i} style={{ color: Colors.light.textSecondary, fontSize: 10.5, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 14 }}>
                    · {n}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>

          {/* FASE 7: SECCIÓN SEPARADA "Tacógrafo guardado" */}
          {authorizedList.length > 0 && !scanning ? (
            <View style={styles.card}>
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4, gap: 8 }}>
                <Ionicons name="bookmark" size={16} color={Colors.light.tint} />
                <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13.5, color: Colors.light.text }}>
                  Tacógrafo guardado
                </Text>
              </View>
              <Text style={{ color: Colors.light.textSecondary, fontFamily: "Inter_400Regular", fontSize: 11.5, marginBottom: 8 }}>
                Solo se reconectará a los dispositivos guardados después de detectarlos en el scan actual.
              </Text>
              {authorizedList.map((saved) => {
                const name = saved.name || saved.model || saved.identifier;
                return (
                  <View key={saved.identifier || saved.id} style={[styles.scanItem, { marginTop: 6, paddingVertical: 8 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.scanItemName}>{name}</Text>
                      <Text style={{
                        color: Colors.light.textSecondary,
                        fontFamily: "JetBrainsMono_400Regular",
                        fontSize: 11,
                        marginTop: 2,
                        letterSpacing: 0.3,
                      }}>
                        MAC · {saved.identifier || "-"}
                      </Text>
                      <Text style={styles.scanItemSub}>
                        {saved.trusted ? "Autorizado" : "Guardado"}
                        {saved.lastSeenAt ? ` · Última vez: ${String(saved.lastSeenAt).slice(0, 16).replace("T", " ")}` : ""}
                      </Text>
                    </View>
                    <View style={{ flexDirection: "row", gap: 6 }}>
                      <Pressable
                        onPress={() => reconnectSaved(saved)}
                        style={({ pressed }) => [styles.smallPrimaryBtn, { opacity: pressed ? 0.8 : 1 }]}
                      >
                        <Text style={[styles.smallPrimaryBtnText, { fontSize: 12 }]}>Conectar</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => forgetDevice(saved)}
                        style={({ pressed }) => [styles.secondaryBtn, { opacity: pressed ? 0.8 : 1, paddingVertical: 8, paddingHorizontal: 10, flex: 0, minWidth: 0 }]}
                      >
                        <Text style={[styles.secondaryBtnText, { fontSize: 12 }]}>Olvidar</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}

          <View style={styles.card}>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>{t("tacho.deviceName")}</Text>
              <Text style={styles.cardValue}>
                {device?.name || device?.model || (connectionState === "connected" || connectionState === "transport_ready" ? "Smart Tacho 2" : "-")}
              </Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>{t("tacho.signal")}</Text>
              <Text style={styles.cardValue}>{device?.rssi != null ? `${device.rssi} dBm` : "-"}</Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>{t("tacho.lastSync")}</Text>
              <Text style={styles.cardValue}>
                {live.lastUpdatedAt ? live.lastUpdatedAt.slice(11, 19) : "-"}
              </Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>{t("tacho.source")}</Text>
              <Text style={styles.cardValue}>
                {live.dataSource === "tachograph_ble" ? t("tacho.tachoValue") : t("tacho.manualValue")}
              </Text>
            </View>
          </View>

          {/* FASE 11: Consentimiento ITS */}
          {itsConsentHint ? (
            <View style={styles.calloutWarn}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="shield-checkmark-outline" size={16} color={Colors.light.warning} />
                <Text style={[styles.calloutTitle, { color: Colors.light.warning }]}>
                  Consentimiento ITS requerido
                </Text>
              </View>
              <Text style={styles.calloutBody}>{itsConsentHint}</Text>
            </View>
          ) : null}

          <View style={styles.actionsRow}>
            {!scanning && connectionState !== "connected" && connectionState !== "transport_ready" && connectionState !== "bonded" ? (
              <Pressable onPress={startScan} style={styles.primaryBtn}>
                <Text style={styles.primaryBtnText}>{t("tacho.scan")}</Text>
              </Pressable>
            ) : scanning ? (
              <Pressable onPress={stopScan} style={styles.secondaryBtn}>
                <Text style={styles.secondaryBtnText}>Detener búsqueda</Text>
              </Pressable>
            ) : null}
            {connectionState === "connected" || connectionState === "transport_ready" || connectionState === "bonded" ? (
              <>
                <Pressable
                  onPress={async () => {
                    try {
                      setIsFetching(true);
                      const r = await fetchTachoFifoOnce();
                      setLastFetchResult({ ...r, at: new Date().toISOString() });
                    } finally {
                      setIsFetching(false);
                    }
                  }}
                  style={({ pressed }) => [styles.primaryBtn, { opacity: pressed || isFetching ? 0.7 : 1, minWidth: 190 }]}
                >
                  {isFetching ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <ActivityIndicator size="small" color="#fff" />
                      <Text style={styles.primaryBtnText}>Descargando datos…</Text>
                    </View>
                  ) : (
                    <Text style={styles.primaryBtnText}>⬇ Descargar datos del tacógrafo</Text>
                  )}
                </Pressable>
                <Pressable
                  onPress={() => (autoRunning ? stopAutoFetch() : startAutoFetch())}
                  style={({ pressed }) => [
                    autoRunning ? styles.smallPrimaryBtn : styles.secondaryBtn,
                    { opacity: pressed ? 0.85 : 1, paddingHorizontal: 12, paddingVertical: 10 },
                  ]}
                >
                  <Text style={[autoRunning ? styles.smallPrimaryBtnText : styles.secondaryBtnText, { fontSize: 12.5 }]}>
                    {autoRunning ? "⏸ Pausar auto-reco" : "▶ Auto-reco cada 5s"}
                  </Text>
                </Pressable>
                <Pressable onPress={disconnect} style={styles.secondaryBtn}>
                  <Text style={styles.secondaryBtnText}>{t("tacho.disconnect")}</Text>
                </Pressable>
              </>
            ) : null}
          </View>

          {(connectionState === "connected" || connectionState === "transport_ready" || connectionState === "bonded") ? (
            <View style={{ marginTop: 10, paddingHorizontal: 2, flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <View style={{
                paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
                backgroundColor: (live.dataSource === "tachograph_ble" ? Colors.light.success : Colors.light.warning) + "1A",
                borderWidth: 1,
                borderColor: (live.dataSource === "tachograph_ble" ? Colors.light.success : Colors.light.warning) + "55",
              }}>
                <Text style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 12,
                  color: live.dataSource === "tachograph_ble" ? Colors.light.success : Colors.light.warning,
                }}>
                  Origen: {live.dataSource === "tachograph_ble" ? "Tacógrafo ✅" : t("tacho.manualValue")}
                </Text>
              </View>
              <View style={{
                paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
                backgroundColor: (autoRunning ? Colors.light.tint : Colors.light.textSecondary) + "15",
                borderWidth: 1,
                borderColor: (autoRunning ? Colors.light.tint : Colors.light.textSecondary) + "55",
              }}>
                <Text style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 12,
                  color: autoRunning ? Colors.light.tint : Colors.light.textSecondary,
                }}>
                  {autoRunning ? "Auto-reco ACTIVO (5s)" : "Auto-reco pausado"}
                </Text>
              </View>
              <View style={{
                paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
                backgroundColor: Colors.light.border + "60",
                borderWidth: 1,
                borderColor: Colors.light.border,
              }}>
                <Text style={{
                  fontFamily: "Inter_500Medium",
                  fontSize: 12,
                  color: Colors.light.textSecondary,
                }}>
                  MTU · {mtuNegotiated ?? "default 23"}
                </Text>
              </View>
              {lastFetchResult.at ? (
                <View style={{
                  paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
                  backgroundColor: Colors.light.border + "60",
                  borderWidth: 1,
                  borderColor: Colors.light.border,
                }}>
                  <Text style={{
                    fontFamily: "Inter_500Medium",
                    fontSize: 12,
                    color: Colors.light.textSecondary,
                  }}>
                    Última descarga · {lastFetchResult.fetchedCount} · {lastFetchResult.bytesTotal} B · {lastFetchResult.at.slice(11, 19)}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {scanning ? (
            <View style={styles.scanSection}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <ActivityIndicator size="small" color={Colors.light.tint} />
                <Text style={styles.scanTitle}>{t("tacho.statusScanning")} · max 60s</Text>
              </View>
              {found.length === 0 ? (
                <Text style={styles.scanEmpty}>{t("tacho.emptyDevices")}</Text>
              ) : (
                <FlatList
                  data={[...found].sort((a, b) => {
                    const rank = (d: typeof found[number]) => {
                      const lower = ((d.name || "") + " " + (d.identifier || "")).toLowerCase();
                      const oui = (d.identifier || "").toLowerCase().slice(0, 8);
                      const knownOui = ["00:60:37"].some((x) => oui === x) ||
                        lower.includes("stoneridge") || lower.includes("vdo") ||
                        lower.includes("dtco") || lower.includes("continental") ||
                        lower.includes("actia") || lower.includes("iat-1") || lower.includes("iat1") ||
                        lower.includes("efkon");
                      let r = 0;
                      if (d.isSmartTacho2) r += 100;
                      if (d.advertisesItsGatt) r += 80;
                      if (knownOui) r += 50;
                      return r;
                    };
                    const ra = rank(a);
                    const rb = rank(b);
                    if (ra !== rb) return rb - ra;
                    const raRssi = Number.isFinite(a.rssi) ? (a.rssi as number) : -100;
                    const rbRssi = Number.isFinite(b.rssi) ? (b.rssi as number) : -100;
                    return rbRssi - raRssi;
                  })}
                  keyExtractor={(d) => d.identifier}
                  scrollEnabled={false}
                  renderItem={({ item }) => (
                    <ScanRow item={item} onPress={() => authorize(item)} />
                  )}
                />
              )}
            </View>
          ) : null}

          <View style={styles.card}>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>{t("tacho.driverStatus")}</Text>
              <Text style={[styles.cardValue, { color: activityColor(live.currentActivity), fontFamily: "Inter_600SemiBold" }]}>
                {activityLabel(live.currentActivity)}
              </Text>
            </View>
            {live.currentActivityStartedAt ? (
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Desde</Text>
                <Text style={styles.cardValue}>{live.currentActivityStartedAt.slice(11, 16)}</Text>
              </View>
            ) : null}
          </View>

          {/* FASE 21: KPIs — valor null → "No disponible" */}
          <View style={styles.kpiGrid}>
            <KpiBox
              title={t("tacho.continuousDriving")}
              value={formatNullableMinutes(live.continuousDrivingMin)}
              hint={t("tacho.remainingContinuous") + " " + formatNullableMinutes(live.remainingContinuousMin)}
              valueColor={Colors.light.tint}
            />
            <KpiBox
              title={t("tacho.accumulatedPause")}
              value={formatNullableMinutes(live.accumulatedPauseMin)}
              valueColor={Colors.light.success}
            />
            <KpiBox
              title={t("tacho.drivingDaily")}
              value={formatNullableMinutes(live.drivingTodayMin)}
              valueColor={Colors.light.text}
            />
            <KpiBox
              title={t("tacho.drivingWeekly")}
              value={formatNullableMinutes(live.drivingThisWeekMin)}
              hint={t("tacho.drivingBiweekly") + " " + formatNullableMinutes(live.drivingLastPlusThisWeekMin)}
              valueColor={Colors.light.warning}
            />
          </View>

          <View style={styles.card}>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>{t("tacho.currentActivity")}</Text>
              <Text style={styles.cardValue}>{activityLabel(live.currentActivity)}</Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>{t("tacho.vehicleSpeed")}</Text>
              <Text style={styles.cardValue}>
                {formatNullableNumber(live.speedKmh, " km/h")}
              </Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>{t("tacho.distance")}</Text>
              <Text style={styles.cardValue}>
                {live.distanceKm != null
                  ? `${live.distanceKm} km`
                  : live.odometerKm != null
                    ? `Odómetro: ${live.odometerKm} km`
                    : "No disponible"}
              </Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>{t("tacho.country")}</Text>
              <Text style={styles.cardValue}>{live.country || "No disponible"}</Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>{t("tacho.lastUpdated")}</Text>
              <Text style={styles.cardValue}>
                {live.lastUpdatedAt ? live.lastUpdatedAt.replace("T", " ").slice(0, 19) : "No disponible"}
              </Text>
            </View>
          </View>

          <View style={{ height: 120 }} />
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, flexDirection: "row", gap: 8 }}>
            <Pressable
              onPress={() => setSelectedDate(todayStr)}
              style={[styles.dayChip, selectedDate === todayStr && styles.dayChipActive]}
            >
              <Text style={[styles.dayChipText, selectedDate === todayStr && styles.dayChipTextActive]}>{t("tacho.today")}</Text>
            </Pressable>
            <Pressable
              onPress={() => setSelectedDate(yesterdayStr)}
              style={[styles.dayChip, selectedDate === yesterdayStr && styles.dayChipActive]}
            >
              <Text style={[styles.dayChipText, selectedDate === yesterdayStr && styles.dayChipTextActive]}>{t("tacho.yesterday")}</Text>
            </Pressable>
            <View style={{ flex: 1 }} />
            <Text style={{ alignSelf: "center", color: Colors.light.textSecondary, fontFamily: "Inter_500Medium" }}>
              {dayLabel}
            </Text>
          </View>
          <SectionList
            sections={[{ title: "", data: recordContent }]}
            keyExtractor={(e) => (e as TachographEvent).eventUid}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => {
              setRefreshing(true);
              await refreshEventsForDay();
              setRefreshing(false);
            }} />}
            ListEmptyComponent={
              <View style={{ padding: 24, alignItems: "center" }}>
                <Text style={{ color: Colors.light.textSecondary, fontFamily: "Inter_500Medium" }}>
                  {t("tacho.emptyRecord")}
                </Text>
                <Text style={{ color: Colors.light.textSecondary, marginTop: 6, textAlign: "center" }}>
                  {t("tacho.manualModeHint")}
                </Text>
              </View>
            }
            renderItem={({ item }) => renderEvent(item as TachographEvent)}
            contentContainerStyle={{ paddingBottom: 120 }}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

// ===========================================================
// ScanRow: FASE 3 mostrar nombre/localName/Dispositivo BLE,
// RSSI, serviceUUIDs, manufacturerDataHex, txPowerLevel, mtu.
// ===========================================================
function ScanRow(props: { item: TachographScanDevice; onPress: () => void }) {
  const { item, onPress } = props;
  const displayName = item.name || item.localName || "Dispositivo BLE";
  const lower = ((item.name || "") + " " + (item.identifier || "")).toLowerCase();
  const isStoneridge = lower.includes("stoneridge") || lower.includes("se5000") || lower.includes("se-5000") || (item.identifier || "").toLowerCase().startsWith("00:60:37");
  const isVdo = lower.includes("vdo") || lower.includes("dtco") || lower.includes("continental");
  const isActia = lower.includes("actia") || lower.includes("iat-1") || lower.includes("iat1");
  const isEfkon = lower.includes("efkon");
  const brandTag = isStoneridge
    ? "Stoneridge (OUI 00:60:37)"
    : isVdo
      ? "VDO / Continental"
      : isActia
        ? "ACTIA"
        : isEfkon
          ? "EFKON"
          : item.isSmartTacho2 || item.advertisesItsGatt
            ? "Anuncia UUIDs GATT ITS Smart 2"
            : "Marca / modelo desconocido";
  const knownBrand = isStoneridge || isVdo || isActia || isEfkon || item.isSmartTacho2 || item.advertisesItsGatt;
  const uuidsShort = (item.serviceUuids || []).slice(0, 3).map((u) => u.slice(0, 8)).join(", ");
  return (
    <View style={[styles.scanItem, knownBrand && { borderColor: Colors.light.tint + "88", backgroundColor: Colors.light.tint + "0A" }]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.scanItemName}>{displayName}</Text>
        <Text style={{
          color: Colors.light.textSecondary,
          fontFamily: "JetBrainsMono_400Regular",
          fontSize: 11,
          marginTop: 2,
          letterSpacing: 0.3,
        }}>
          MAC · {item.identifier || "-"}
        </Text>
        <Text style={styles.scanItemSub}>
          {brandTag}
          {item.rssi != null ? ` · ${item.rssi} dBm` : ""}
          {item.txPowerLevel != null ? ` · TX ${item.txPowerLevel} dBm` : ""}
          {item.mtu != null ? ` · MTU ${item.mtu}` : ""}
          {uuidsShort ? ` · UUID ${uuidsShort}` : ""}
          {item.manufacturerDataHex ? ` · MFG 0x${item.manufacturerDataHex.slice(0, 12)}${item.manufacturerDataHex.length > 12 ? "…" : ""}` : ""}
        </Text>
      </View>
      <Pressable
        onPress={onPress}
        style={styles.smallPrimaryBtn}
      >
        <Text style={styles.smallPrimaryBtnText}>Conectar</Text>
      </Pressable>
    </View>
  );
}

// ===========================================================
// buildFase20DiagnosticRows: 14+ estados REALES FASE 20
// ===========================================================
function buildFase20DiagnosticRows(p: {
  snapshotDiag: BleHardwareDiagnostic;
  supported: boolean;
  scanning: boolean;
  foundCount: number;
  connectionState: TachographConnectionState;
  device: any;
  live: any;
  bondState: TachographBondState;
  detectedServices: TachographDetectedServices | null;
  fifoState: TachographFifoState;
  creditsState: TachographCreditsState;
  transportState: TachographTransportState;
}): [string, string, "ok" | "warn" | "fail", string?][] {
  const result: [string, string, "ok" | "warn" | "fail"][] = [];
  // 1. Bluetooth: Disponible / No disponible
  {
    const ok = p.supported && p.snapshotDiag.bleAvailable;
    result.push([
      "Bluetooth",
      ok ? "Disponible" : "No disponible (web / Expo Go sin módulo nativo)",
      ok ? "ok" : "fail",
    ]);
  }
  // 2. Estado: PoweredOn / PoweredOff / etc.
  {
    const st = p.snapshotDiag.managerState || "Pendiente";
    const status: "ok" | "warn" | "fail" =
      st === "PoweredOn" ? "ok" :
        st === "PoweredOff" || st === "Unauthorized" ? "fail" : "warn";
    result.push(["Estado BLE", st, status]);
  }
  // 3. Permisos
  {
    const req = p.snapshotDiag.requestPermissions;
    if (!req) {
      result.push(["Permisos", "Aún no solicitados (pulsa Buscar)", "warn"]);
    } else if (req.ok) {
      result.push(["Permisos", "OK", "ok"]);
    } else {
      result.push(["Permisos", `Denegados: ${req.reason || ""}`, "fail"]);
    }
  }
  // 4. Escaneo activo / detenido
  {
    result.push(["Escaneo", p.scanning ? "Activo (Buscando dispositivos...)" : "Detenido", p.scanning ? "warn" : "ok"]);
  }
  // 5. Dispositivos reales encontrados
  {
    result.push(["Dispositivos reales", `${p.foundCount} encontrados`, p.foundCount > 0 ? "ok" : "warn"]);
  }
  // 6. Dispositivo seleccionado
  {
    if (p.device) {
      const rssi = p.device.rssi != null ? ` · ${p.device.rssi} dBm` : "";
      result.push([
        "Dispositivo seleccionado",
        `${p.device.name || p.device.model || "Tacógrafo"} · ${p.device.identifier || p.live?.connectedDeviceId || ""}${rssi}`,
        "ok",
      ]);
    } else if (p.live?.connectedDeviceId) {
      result.push(["Dispositivo seleccionado", `${p.live.connectedDeviceId}`, "warn"]);
    } else {
      result.push(["Dispositivo seleccionado", "Ninguno (pulsa Buscar y selecciona)", "warn"]);
    }
  }
  // 7. Conexión
  {
    const st = p.connectionState;
    const status: "ok" | "warn" | "fail" =
      st === "connected" || st === "transport_ready" || st === "bonded" ? "ok" :
        st === "error" ? "fail" :
          st === "connecting" || st === "discovering" || st === "bonding" || st === "transport_init" || st === "scanning" ? "warn" : "warn";
    const label = ({
      idle: "Desconectado",
      scanning: "Buscando...",
      connecting: "Conectando",
      discovering: "Descubriendo servicios",
      bonding: "Emparejando",
      bonded: "Emparejado",
      connected: "Conectado",
      transport_init: "Iniciando transporte ITS",
      transport_ready: "Transporte ITS listo",
      disconnected: "Desconectado",
      unsupported: "BLE no soportado",
      error: "Error de conexión",
    } as any)[st] || st;
    result.push(["Conexión", label, status]);
  }
  // 8. Tacógrafo ITS detectado
  {
    const its = p.detectedServices;
    if (!its) {
      result.push(["Tacógrafo ITS Smart 2", "No detectado (aún no conectado)", "warn"]);
    } else if (its.allServicesFound) {
      result.push(["Tacógrafo ITS Smart 2", "Servicios ITS detectados (Download + Diagnostic)", "ok"]);
    } else {
      const parts: string[] = [];
      if (its.downloadService) parts.push("Download+FIFO+Credits");
      if (its.diagnosticService) parts.push("Diagnostic+FIFO+Credits");
      result.push([
        "Tacógrafo ITS Smart 2",
        parts.length ? `Parcial: ${parts.join(" + ")}` : "No detectado (UUIDs ITS no encontrados en services)",
        parts.length ? "warn" : "fail",
      ]);
    }
  }
  // 9. Pairing
  {
    const bs = p.bondState;
    const status: "ok" | "warn" | "fail" = bs === "BONDED" ? "ok" : bs === "BONDING" ? "warn" : bs === "NOT_BONDED" ? "warn" : bs === "UNKNOWN" ? "warn" : "warn";
    const label = ({
      NOT_BONDED: "Pendiente",
      BONDING: "Emparejando...",
      BONDED: "Emparejado",
      UNKNOWN: "Pendiente (Gestionado por SO)",
    } as any)[bs] || bs;
    result.push(["Pairing / Bonding", label, status]);
  }
  // 10. FIFO
  {
    const label = ({
      NOT_AVAILABLE: "No disponible",
      PREPARING: "Preparando",
      READY: "Listo",
      ERROR: "Error",
    } as any)[p.fifoState] || p.fifoState;
    const status: "ok" | "warn" | "fail" = p.fifoState === "READY" ? "ok" : p.fifoState === "ERROR" ? "fail" : "warn";
    result.push(["FIFO ITS", label, status]);
  }
  // 11. Credits
  {
    const label = ({
      NOT_AVAILABLE: "No disponible",
      PREPARING: "Preparando",
      READY: `Listo (disponibles=${p.live?.creditsAvailable ?? "?"}, consumidos=${p.live?.creditsConsumed ?? 0})`,
      FLOW_CLOSED: "Flow cerrado (0xFF/-1)",
      ERROR: "Error",
    } as any)[p.creditsState] || p.creditsState;
    const status: "ok" | "warn" | "fail" = p.creditsState === "READY" ? "ok" : p.creditsState === "ERROR" || p.creditsState === "FLOW_CLOSED" ? "fail" : "warn";
    result.push(["Credits ITS", label, status]);
  }
  // 12. Transporte ITS
  {
    const label = ({
      NOT_STARTED: "No iniciado",
      INITIALIZING: "Inicializando",
      READY: "Listo",
      ERROR: "Error",
    } as any)[p.transportState] || p.transportState;
    const status: "ok" | "warn" | "fail" = p.transportState === "READY" ? "ok" : p.transportState === "ERROR" ? "fail" : "warn";
    result.push(["Transporte ITS", label, status]);
  }
  // 13. MTU negociado
  {
    const mtu = p.live?.mtuNegotiated ?? null;
    result.push([
      "MTU ATT",
      mtu != null ? `${mtu} bytes (payload max ${Math.max(20, mtu - 3)})` : "Por defecto 23 (20 bytes payload)",
      (mtu ?? 23) >= 23 ? "ok" : "warn",
    ]);
  }
  // 14. Consentimiento ITS conductor
  {
    const cs = p.live?.itsConsentState || "UNKNOWN";
    const label = ({
      NOT_REQUIRED: "No requerido",
      REQUIRED: "Requerido (actívalo en menú tacógrafo)",
      GRANTED: "Concedido",
      DENIED: "Denegado",
      UNKNOWN: "Desconocido (conecta primero)",
    } as any)[cs] || cs;
    const status: "ok" | "warn" | "fail" = cs === "GRANTED" || cs === "NOT_REQUIRED" ? "ok" : cs === "DENIED" ? "fail" : "warn";
    result.push(["Consentimiento ITS", label, status]);
  }
  return result as any;
}

function KpiBox(props: {
  title: string;
  value: string;
  hint?: string;
  valueColor?: string;
}) {
  return (
    <View style={kpiStyles.box}>
      <Text style={kpiStyles.title}>{props.title}</Text>
      <Text style={[kpiStyles.value, props.valueColor ? { color: props.valueColor } : null]}>{props.value}</Text>
      {props.hint ? <Text style={kpiStyles.hint}>{props.hint}</Text> : null}
    </View>
  );
}

const kpiStyles = StyleSheet.create({
  box: {
    flex: 1,
    minWidth: "48%",
    backgroundColor: Colors.light.surface,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 14,
    padding: 14,
    margin: 4,
  },
  title: {
    color: Colors.light.textSecondary,
    fontFamily: "Inter_500Medium",
    fontSize: 12,
  },
  value: {
    color: Colors.light.text,
    fontFamily: "Inter_600SemiBold",
    fontSize: 20,
    marginTop: 6,
  },
  hint: {
    color: Colors.light.textSecondary,
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    marginTop: 4,
  },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.light.background },
  header: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    gap: 6,
  },
  statusDot: { width: 8, height: 8, borderRadius: 999 },
  statusText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  tabRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  tabChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: Colors.light.surface,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  tabChipActive: {
    backgroundColor: Colors.light.tint + "14",
    borderColor: Colors.light.tint + "66",
  },
  tabText: {
    color: Colors.light.textSecondary,
    fontFamily: "Inter_500Medium",
    fontSize: 13,
  },
  tabTextActive: {
    color: Colors.light.tint,
    fontFamily: "Inter_600SemiBold",
  },
  content: { paddingHorizontal: 16, paddingTop: 6 },
  card: {
    backgroundColor: Colors.light.surface,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 16,
    padding: 14,
    marginVertical: 8,
  },
  cardRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
    gap: 12,
  },
  cardLabel: {
    color: Colors.light.textSecondary,
    fontFamily: "Inter_500Medium",
    fontSize: 13,
  },
  cardValue: {
    color: Colors.light.text,
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    textAlign: "right",
    flexShrink: 1,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: Colors.light.tint,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryBtnText: {
    color: "#fff",
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  secondaryBtn: {
    flex: 1,
    backgroundColor: Colors.light.surface,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryBtnText: {
    color: Colors.light.text,
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  smallPrimaryBtn: {
    backgroundColor: Colors.light.tint,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  smallPrimaryBtnText: {
    color: "#fff",
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
  },
  scanSection: {
    marginTop: 12,
    padding: 14,
    backgroundColor: Colors.light.surface,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 16,
  },
  scanTitle: {
    color: Colors.light.text,
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  scanEmpty: {
    color: Colors.light.textSecondary,
    fontFamily: "Inter_500Medium",
    fontSize: 13,
  },
  scanItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
    marginTop: 6,
  },
  scanItemName: {
    color: Colors.light.text,
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  scanItemSub: {
    color: Colors.light.textSecondary,
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    marginTop: 2,
  },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -4,
    marginTop: 8,
  },
  calloutWarn: {
    backgroundColor: Colors.light.warning + "14",
    borderColor: Colors.light.warning + "55",
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginTop: 8,
  },
  calloutError: {
    backgroundColor: Colors.light.danger + "14",
    borderColor: Colors.light.danger + "55",
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginTop: 8,
  },
  calloutTitle: {
    color: Colors.light.text,
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  calloutBody: {
    color: Colors.light.textSecondary,
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    marginTop: 4,
  },
  dayChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.surface,
  },
  dayChipActive: {
    backgroundColor: Colors.light.tint + "14",
    borderColor: Colors.light.tint + "55",
  },
  dayChipText: {
    color: Colors.light.textSecondary,
    fontFamily: "Inter_500Medium",
    fontSize: 12,
  },
  dayChipTextActive: {
    color: Colors.light.tint,
    fontFamily: "Inter_600SemiBold",
  },
  recordRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 10,
  },
  recordDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  recordTime: {
    color: Colors.light.textSecondary,
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    width: 50,
  },
  recordText: {
    color: Colors.light.text,
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    flexShrink: 1,
  },
  recordDuration: {
    color: Colors.light.textSecondary,
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    marginStart: 6,
  },
  recordSource: {
    color: Colors.light.textSecondary,
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: Colors.light.border,
  },
});
