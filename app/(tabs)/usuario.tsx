import React, { useState, useEffect, useCallback } from "react";
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
import { useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { useAuth } from "@/lib/auth-context";
import OnboardingGuide from "@/components/OnboardingGuide";
import { getApiUrl } from "@/lib/query-client";
import { useFerry, type RouteMode, type PaymentMode } from "@/lib/ferry-context";
import { usePeriod, PeriodMode, computeRange } from "@/lib/period-context";
import { useI18n } from "@/lib/i18n-context";

function safeHaptic() {
  if (Platform.OS !== "web") {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }
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
  period_start_day: string;
  period_end_day: string;
}

const DEFAULT_SETTINGS: UserSettings = {
  nac_100: "54.30",
  nac_60: "32.58",
  nac_30: "16.29",
  intl_100: "72.77",
  intl_60: "43.66",
  intl_30: "21.83",
  reg_100: "0",
  reg_60: "0",
  reg_30: "0",
  extra_saturday: "10",
  extra_sunday: "15",
  extra_holiday: "20",
  period_start_day: "20",
  period_end_day: "19",
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
      const modeLabel = mode === "AUTO_01_30" ? t("usuario.del") + " 1 " + t("usuario.al") + " 30" : mode === "AUTO_20_20" ? t("usuario.del") + " 21 " + t("usuario.al") + " 20" : mFrom + " " + t("usuario.al") + " " + mTo;
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
  const insets = useSafeAreaInsets();
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const webBottomPad = Platform.OS === "web" ? 34 : 0;
  const { user, isGuest, logout, getAccessToken } = useAuth();

  const [profileName, setProfileName] = useState(user?.name || "");
  const [savingProfile, setSavingProfile] = useState(false);

  const [settings, setSettings] = useState<UserSettings>({ ...DEFAULT_SETTINGS });
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [savingRates, setSavingRates] = useState(false);
  const [savingExtras, setSavingExtras] = useState(false);

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loadingHolidays, setLoadingHolidays] = useState(false);
  const [newHolidayDate, setNewHolidayDate] = useState("");
  const [newHolidayName, setNewHolidayName] = useState("");
  const [addingHoliday, setAddingHoliday] = useState(false);

  const apiFetch = useCallback(
    async (path: string, options?: RequestInit) => {
      const token = await getAccessToken();
      const base = getApiUrl();
      const url = new URL(path, base).toString();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(url, { ...options, headers });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `Error ${res.status}`);
      }
      return res.json();
    },
    [getAccessToken],
  );

  const loadSettings = useCallback(async () => {
    setLoadingSettings(true);
    try {
      const local = await AsyncStorage.getItem(SETTINGS_KEY);
      if (local) {
        const parsed = JSON.parse(local);
        setSettings((prev) => ({ ...prev, ...parsed }));
      }

      if (!isGuest && user) {
        const [ratesData, extrasData] = await Promise.all([
          apiFetch("/api/user/diet-rates").catch(() => null),
          apiFetch("/api/user/day-extras").catch(() => null),
        ]);

        const newSettings: Partial<UserSettings> = {};
        if (ratesData?.rates) {
          for (const r of ratesData.rates) {
            const prefix = r.trip_type === "NACIONAL" ? "nac" : r.trip_type === "REGIONAL" ? "reg" : "intl";
            const key = `${prefix}_${r.percent}` as keyof UserSettings;
            if (key in DEFAULT_SETTINGS) {
              newSettings[key] = String(r.amount ?? DEFAULT_SETTINGS[key]);
            }
          }
        }
        if (extrasData?.extras) {
          const ex = extrasData.extras;
          newSettings.extra_saturday = String(ex.extra_saturday ?? DEFAULT_SETTINGS.extra_saturday);
          newSettings.extra_sunday = String(ex.extra_sunday ?? DEFAULT_SETTINGS.extra_sunday);
          newSettings.extra_holiday = String(ex.extra_holiday ?? DEFAULT_SETTINGS.extra_holiday);
        }

        if (Object.keys(newSettings).length > 0) {
          setSettings((prev) => {
            const merged = { ...prev, ...newSettings };
            AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
            return merged;
          });
        }
      }
    } catch (e) {
      console.log("Failed to load settings:", e);
    }
    setLoadingSettings(false);
  }, [isGuest, user, apiFetch]);

  const loadHolidays = useCallback(async () => {
    if (isGuest || !user) return;
    setLoadingHolidays(true);
    try {
      const data = await apiFetch("/api/user/holidays");
      setHolidays(data.holidays || []);
    } catch (e: any) {
      console.log("Failed to load holidays:", e);
    }
    setLoadingHolidays(false);
  }, [apiFetch, isGuest, user]);

  useFocusEffect(
    useCallback(() => {
      loadSettings();
      loadHolidays();
    }, [loadSettings, loadHolidays])
  );

  useEffect(() => {
    if (!isGuest && user) {
      setProfileName(user.name || "");
    }
  }, [user, isGuest]);

  const updateSetting = (key: keyof UserSettings, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const saveRates = async () => {
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
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

    if (!isGuest && user) {
      try {
        await apiFetch("/api/user/diet-rates", {
          method: "PUT",
          body: JSON.stringify({
            rates: [
              { trip_type: "NACIONAL", percent: 100, amount: vals.nac_100 },
              { trip_type: "NACIONAL", percent: 60, amount: vals.nac_60 },
              { trip_type: "NACIONAL", percent: 30, amount: vals.nac_30 },
              { trip_type: "INTERNACIONAL", percent: 100, amount: vals.intl_100 },
              { trip_type: "INTERNACIONAL", percent: 60, amount: vals.intl_60 },
              { trip_type: "INTERNACIONAL", percent: 30, amount: vals.intl_30 },
              { trip_type: "REGIONAL", percent: 100, amount: vals.reg_100 },
              { trip_type: "REGIONAL", percent: 60, amount: vals.reg_60 },
              { trip_type: "REGIONAL", percent: 30, amount: vals.reg_30 },
            ],
          }),
        });
      } catch (e: any) {
        console.log("API save rates failed (saved locally):", e);
      }
    }
    safeHaptic();
    Alert.alert(t("usuario.saved"), t("usuario.ratesUpdated"));
    setSavingRates(false);
  };

  const saveExtras = async () => {
    const vals = {
      extra_saturday: parseFloat(settings.extra_saturday),
      extra_sunday: parseFloat(settings.extra_sunday),
      extra_holiday: parseFloat(settings.extra_holiday),
    };
    for (const [k, v] of Object.entries(vals)) {
      if (isNaN(v) || v < 0) {
        Alert.alert(t("common.error"), t("usuario.extrasPositive"));
        return;
      }
    }

    setSavingExtras(true);
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

    if (!isGuest && user) {
      try {
        await apiFetch("/api/user/day-extras", {
          method: "PUT",
          body: JSON.stringify(vals),
        });
      } catch (e: any) {
        console.log("API save extras failed (saved locally):", e);
      }
    }
    safeHaptic();
    Alert.alert(t("usuario.saved"), t("usuario.ratesUpdated"));
    setSavingExtras(false);
  };

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      await apiFetch("/api/user/profile", {
        method: "PUT",
        body: JSON.stringify({ name: profileName }),
      });
      safeHaptic();
      Alert.alert(t("usuario.saved"), t("usuario.nameUpdated"));
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
      await apiFetch("/api/user/holidays", {
        method: "POST",
        body: JSON.stringify({ date: newHolidayDate, name: newHolidayName }),
      });
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
            await apiFetch(`/api/user/holidays/${id}`, { method: "DELETE" });
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
        <Text style={styles.headerTitle}>{t("usuario.title")}</Text>
      </View>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 100 + webBottomPad }]}
        showsVerticalScrollIndicator={false}
      >
        {!isGuest && user && (
          <View style={styles.card}>
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
            <Pressable
              style={({ pressed }) => [styles.logoutBtn, { opacity: pressed ? 0.85 : 1, marginTop: 12 }]}
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
          </View>
        )}

        {isGuest && (
          <View style={styles.card}>
            <View style={styles.guestBanner}>
              <Ionicons name="information-circle-outline" size={18} color={Colors.light.tint} />
              <Text style={styles.guestBannerText}>
                {t("usuario.guestBannerShort")}
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.logoutBtn, { opacity: pressed ? 0.85 : 1 }]}
              onPress={logout}
            >
              <Ionicons name="log-out-outline" size={18} color="#fff" />
              <Text style={styles.logoutBtnText}>{t("usuario.irAlLogin")}</Text>
            </Pressable>
          </View>
        )}

        {loadingSettings ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={Colors.light.tint} />
          </View>
        ) : (
          <>
            <View style={styles.card}>
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

            <View style={styles.card}>
              <SectionHeader title={t("usuario.dayExtras")} icon="calendar-outline" />
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

            <PeriodSettingsCard />

            <FerrySettingsCard />
          </>
        )}

        {!isGuest && user && (
          <View style={styles.card}>
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
