import React, { useState, useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { useI18n } from "@/lib/i18n-context";

const SETTINGS_KEY = "tacoplan_user_settings";
const PERIOD_KEY = "tacoplan_period_config";
const FERRY_KEY = "tacoplan_ferry_config";
const ONBOARDING_KEY = "tacoplan_onboarding_completed";

type DriverProfile = "standard" | "morocco" | "ferry";
type OperationZone = "spain" | "europe" | "morocco" | "mixed";
type PeriodMode = "AUTO_01_30" | "AUTO_20_20" | "MANUAL";

interface TripTypes {
  nacional: boolean;
  internacional: boolean;
  morocco: boolean;
  ferry: boolean;
}

interface DietRates {
  nac_100: string;
  nac_60: string;
  nac_30: string;
  intl_100: string;
  intl_60: string;
  intl_30: string;
}

interface DayExtras {
  extra_saturday: string;
  extra_sunday: string;
  extra_holiday: string;
}

interface PaymentConfig {
  mode: "morocco_trip" | "morocco_pernight" | "morocco_diet";
  tripRate: string;
  pernightRate: string;
}

function safeHaptic() {
  if (Platform.OS !== "web") {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }
}

function SectionHeader({ title, icon }: { title: string; icon: string }) {
  return (
    <View style={s.sectionHeader}>
      <Ionicons name={icon as any} size={18} color={Colors.light.tint} />
      <Text style={s.sectionTitle}>{title}</Text>
    </View>
  );
}

interface Props {
  onComplete: () => void;
}

const DEFAULT_DIETS: DietRates = {
  nac_100: "54.30",
  nac_60: "32.58",
  nac_30: "16.29",
  intl_100: "72.77",
  intl_60: "43.66",
  intl_30: "21.83",
};

const DEFAULT_EXTRAS: DayExtras = {
  extra_saturday: "10",
  extra_sunday: "15",
  extra_holiday: "20",
};

export default function OnboardingSetup({ onComplete }: Props) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const webTopInset = Platform.OS === "web" ? 67 : 0;

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [zone, setZone] = useState<OperationZone | null>(null);
  const [tripTypes, setTripTypes] = useState<TripTypes>({
    nacional: false,
    internacional: false,
    morocco: false,
    ferry: false,
  });
  const [diets, setDiets] = useState<DietRates>(DEFAULT_DIETS);
  const [extras, setExtras] = useState<DayExtras>(DEFAULT_EXTRAS);
  const [periodMode, setPeriodMode] = useState<PeriodMode | null>(null);
  const [manualFrom, setManualFrom] = useState("1");
  const [manualTo, setManualTo] = useState("30");
  const [payment, setPayment] = useState<PaymentConfig>({
    mode: "morocco_diet",
    tripRate: "0",
    pernightRate: "0",
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [settingsRaw, periodRaw, ferryRaw] = await Promise.all([
          AsyncStorage.getItem(SETTINGS_KEY),
          AsyncStorage.getItem(PERIOD_KEY),
          AsyncStorage.getItem(FERRY_KEY),
        ]);
        if (settingsRaw) {
          const s = JSON.parse(settingsRaw);
          setDiets({
            nac_100: s.nac_100 ?? DEFAULT_DIETS.nac_100,
            nac_60: s.nac_60 ?? DEFAULT_DIETS.nac_60,
            nac_30: s.nac_30 ?? DEFAULT_DIETS.nac_30,
            intl_100: s.intl_100 ?? DEFAULT_DIETS.intl_100,
            intl_60: s.intl_60 ?? DEFAULT_DIETS.intl_60,
            intl_30: s.intl_30 ?? DEFAULT_DIETS.intl_30,
          });
          setExtras({
            extra_saturday: s.extra_saturday ?? DEFAULT_EXTRAS.extra_saturday,
            extra_sunday: s.extra_sunday ?? DEFAULT_EXTRAS.extra_sunday,
            extra_holiday: s.extra_holiday ?? DEFAULT_EXTRAS.extra_holiday,
          });
          if (s.driver_profile) setProfile(s.driver_profile);
          if (s.operation_zone) setZone(s.operation_zone);
          if (s.trip_types) setTripTypes(s.trip_types);
        }
        if (periodRaw) {
          const p = JSON.parse(periodRaw);
          if (p.mode) setPeriodMode(p.mode);
          if (p.manualFrom) setManualFrom(String(p.manualFrom));
          if (p.manualTo) setManualTo(String(p.manualTo));
        }
        if (ferryRaw) {
          const f = JSON.parse(ferryRaw);
          if (f.paymentMode && f.paymentMode !== "spain_diet") {
            setPayment({
              mode: f.paymentMode,
              tripRate: String(f.tripRate || 0),
              pernightRate: String(f.pernightRate || 0),
            });
          }
        }
      } catch {}
      setLoading(false);
    })();
  }, []);

  const showPaymentSection = profile === "morocco" || profile === "ferry";

  function toggleTrip(key: keyof TripTypes) {
    setTripTypes((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function validate(): string[] {
    const errs: string[] = [];
    if (!profile) errs.push(t("onboarding.errorProfile"));
    if (!zone) errs.push(t("onboarding.errorZone"));
    if (!tripTypes.nacional && !tripTypes.internacional && !tripTypes.morocco && !tripTypes.ferry)
      errs.push(t("onboarding.errorTripType"));
    if (!periodMode) errs.push(t("onboarding.errorPeriod"));
    if (periodMode === "MANUAL") {
      const from = parseInt(manualFrom, 10);
      const to = parseInt(manualTo, 10);
      if (isNaN(from) || isNaN(to) || from < 1 || from > 31 || to < 1 || to > 31)
        errs.push(t("onboarding.errorManualDays"));
    }
    if (showPaymentSection && payment.mode === "morocco_trip") {
      const rate = parseFloat(payment.tripRate);
      if (isNaN(rate) || rate <= 0) errs.push(t("onboarding.tripRate") + " > 0");
    }
    if (showPaymentSection && payment.mode === "morocco_pernight") {
      const rate = parseFloat(payment.pernightRate);
      if (isNaN(rate) || rate <= 0) errs.push(t("onboarding.pernightRate") + " > 0");
    }
    return errs;
  }

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: Colors.light.background }}>
        <ActivityIndicator size="large" color={Colors.light.tint} />
      </View>
    );
  }

  async function handleSave() {
    const errs = validate();
    if (errs.length > 0) {
      setErrors(errs);
      if (Platform.OS === "web") {
        alert(errs.join("\n"));
      } else {
        Alert.alert(t("common.error"), errs.join("\n"));
      }
      return;
    }
    setErrors([]);
    setSaving(true);
    try {
      const existingRaw = await AsyncStorage.getItem(SETTINGS_KEY);
      const existingSettings = existingRaw ? JSON.parse(existingRaw) : {};
      const userSettings = {
        ...existingSettings,
        ...diets,
        ...extras,
        driver_profile: profile,
        operation_zone: zone,
        trip_types: tripTypes,
        period_start_day: periodMode === "AUTO_20_20" ? "21" : periodMode === "MANUAL" ? manualFrom : "1",
        period_end_day: periodMode === "AUTO_20_20" ? "20" : periodMode === "MANUAL" ? manualTo : "30",
      };
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(userSettings));

      const periodConfig = {
        mode: periodMode,
        manualFrom: periodMode === "MANUAL" ? parseInt(manualFrom, 10) : periodMode === "AUTO_20_20" ? 21 : 1,
        manualTo: periodMode === "MANUAL" ? parseInt(manualTo, 10) : periodMode === "AUTO_20_20" ? 20 : 30,
      };
      await AsyncStorage.setItem(PERIOD_KEY, JSON.stringify(periodConfig));

      const isMoroccoOrFerry = profile === "morocco" || profile === "ferry";
      const ferryConfig = {
        crossesFerry: isMoroccoOrFerry,
        routeMode: profile === "morocco" ? "morocco" : "spain",
        paymentMode: isMoroccoOrFerry ? payment.mode : "spain_diet",
        tripRate: parseFloat(payment.tripRate) || 0,
        pernightRate: parseFloat(payment.pernightRate) || 0,
        ferryRestEnabled: profile === "ferry",
      };
      await AsyncStorage.setItem(FERRY_KEY, JSON.stringify(ferryConfig));

      const onboardingData = {
        completed: true,
        driverProfile: profile,
        operationZone: zone,
        tripTypes,
        completedAt: new Date().toISOString(),
      };
      await AsyncStorage.setItem(ONBOARDING_KEY, JSON.stringify(onboardingData));

      safeHaptic();
      onComplete();
    } catch (err) {
      if (Platform.OS === "web") {
        alert(t("common.error"));
      } else {
        Alert.alert(t("common.error"));
      }
    } finally {
      setSaving(false);
    }
  }

  const profileOptions: { key: DriverProfile; label: string; icon: string }[] = [
    { key: "standard", label: t("onboarding.profileStandard"), icon: "car-outline" },
    { key: "morocco", label: t("onboarding.profileMorocco"), icon: "globe-outline" },
    { key: "ferry", label: t("onboarding.profileFerry"), icon: "boat-outline" },
  ];

  const zoneOptions: { key: OperationZone; label: string }[] = [
    { key: "spain", label: t("onboarding.zoneSpain") },
    { key: "europe", label: t("onboarding.zoneEurope") },
    { key: "morocco", label: t("onboarding.zoneMorocco") },
    { key: "mixed", label: t("onboarding.zoneMixed") },
  ];

  const tripOptions: { key: keyof TripTypes; label: string }[] = [
    { key: "nacional", label: t("onboarding.tripNacional") },
    { key: "internacional", label: t("onboarding.tripInternacional") },
    { key: "morocco", label: t("onboarding.tripMorocco") },
    { key: "ferry", label: t("onboarding.tripFerry") },
  ];

  const dietFields: { key: keyof DietRates; label: string }[] = [
    { key: "nac_100", label: t("onboarding.dietNac100") },
    { key: "nac_60", label: t("onboarding.dietNac60") },
    { key: "nac_30", label: t("onboarding.dietNac30") },
    { key: "intl_100", label: t("onboarding.dietIntl100") },
    { key: "intl_60", label: t("onboarding.dietIntl60") },
    { key: "intl_30", label: t("onboarding.dietIntl30") },
  ];

  const extraFields: { key: keyof DayExtras; label: string }[] = [
    { key: "extra_saturday", label: t("onboarding.extraSaturday") },
    { key: "extra_sunday", label: t("onboarding.extraSunday") },
    { key: "extra_holiday", label: t("onboarding.extraHoliday") },
  ];

  const periodOptions: { key: PeriodMode; label: string }[] = [
    { key: "AUTO_01_30", label: t("onboarding.period0130") },
    { key: "AUTO_20_20", label: t("onboarding.period2020") },
    { key: "MANUAL", label: t("onboarding.periodManual") },
  ];

  const paymentOptions: { key: PaymentConfig["mode"]; label: string }[] = [
    { key: "morocco_trip", label: t("onboarding.paymentTrip") },
    { key: "morocco_pernight", label: t("onboarding.paymentPernight") },
    { key: "morocco_diet", label: t("onboarding.paymentDiet") },
  ];

  return (
    <View style={[s.container, { paddingTop: (insets.top || webTopInset) }]}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, { paddingBottom: 120 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={s.header}>
          <Ionicons name="settings-outline" size={32} color={Colors.light.tint} />
          <Text style={s.title}>{t("onboarding.title")}</Text>
          <Text style={s.subtitle}>{t("onboarding.subtitle")}</Text>
        </View>

        <SectionHeader title={t("onboarding.sectionProfile")} icon="person-outline" />
        <View style={s.optionRow}>
          {profileOptions.map((opt) => (
            <Pressable
              key={opt.key}
              style={[s.profileCard, profile === opt.key && s.profileCardActive]}
              onPress={() => setProfile(opt.key)}
            >
              <Ionicons
                name={opt.icon as any}
                size={24}
                color={profile === opt.key ? "#fff" : Colors.light.tint}
              />
              <Text style={[s.profileLabel, profile === opt.key && s.profileLabelActive]}>
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <SectionHeader title={t("onboarding.sectionZone")} icon="map-outline" />
        <View style={s.chipRow}>
          {zoneOptions.map((opt) => (
            <Pressable
              key={opt.key}
              style={[s.chip, zone === opt.key && s.chipActive]}
              onPress={() => setZone(opt.key)}
            >
              <Text style={[s.chipText, zone === opt.key && s.chipTextActive]}>{opt.label}</Text>
            </Pressable>
          ))}
        </View>

        <SectionHeader title={t("onboarding.sectionTripTypes")} icon="compass-outline" />
        <View style={s.checkboxGroup}>
          {tripOptions.map((opt) => (
            <Pressable
              key={opt.key}
              style={s.checkboxRow}
              onPress={() => toggleTrip(opt.key)}
            >
              <Ionicons
                name={tripTypes[opt.key] ? "checkbox" : "square-outline"}
                size={22}
                color={tripTypes[opt.key] ? Colors.light.tint : Colors.light.textSecondary}
              />
              <Text style={s.checkboxLabel}>{opt.label}</Text>
            </Pressable>
          ))}
        </View>

        <SectionHeader title={t("onboarding.sectionDiets")} icon="cash-outline" />
        <View style={s.gridContainer}>
          {dietFields.map((f) => (
            <View key={f.key} style={s.gridItem}>
              <Text style={s.inputLabel}>{f.label}</Text>
              <TextInput
                style={s.input}
                value={diets[f.key]}
                onChangeText={(val) => setDiets((prev) => ({ ...prev, [f.key]: val }))}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={Colors.light.textSecondary}
              />
            </View>
          ))}
        </View>

        <SectionHeader title={t("onboarding.sectionExtras")} icon="add-circle-outline" />
        <View style={s.gridContainer}>
          {extraFields.map((f) => (
            <View key={f.key} style={s.gridItem}>
              <Text style={s.inputLabel}>{f.label}</Text>
              <TextInput
                style={s.input}
                value={extras[f.key]}
                onChangeText={(val) => setExtras((prev) => ({ ...prev, [f.key]: val }))}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={Colors.light.textSecondary}
              />
            </View>
          ))}
        </View>

        <SectionHeader title={t("onboarding.sectionPeriod")} icon="calendar-outline" />
        <View style={s.chipRow}>
          {periodOptions.map((opt) => (
            <Pressable
              key={opt.key}
              style={[s.chip, periodMode === opt.key && s.chipActive]}
              onPress={() => setPeriodMode(opt.key)}
            >
              <Text style={[s.chipText, periodMode === opt.key && s.chipTextActive]}>
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
        {periodMode === "MANUAL" && (
          <View style={s.manualRow}>
            <View style={s.manualField}>
              <Text style={s.inputLabel}>{t("onboarding.periodFrom")}</Text>
              <TextInput
                style={s.input}
                value={manualFrom}
                onChangeText={setManualFrom}
                keyboardType="number-pad"
                placeholder="1"
                placeholderTextColor={Colors.light.textSecondary}
              />
            </View>
            <View style={s.manualField}>
              <Text style={s.inputLabel}>{t("onboarding.periodTo")}</Text>
              <TextInput
                style={s.input}
                value={manualTo}
                onChangeText={setManualTo}
                keyboardType="number-pad"
                placeholder="30"
                placeholderTextColor={Colors.light.textSecondary}
              />
            </View>
          </View>
        )}

        {showPaymentSection && (
          <>
            <SectionHeader title={t("onboarding.sectionPayment")} icon="wallet-outline" />
            <View style={s.chipRow}>
              {paymentOptions.map((opt) => (
                <Pressable
                  key={opt.key}
                  style={[s.chip, payment.mode === opt.key && s.chipActive]}
                  onPress={() => setPayment((prev) => ({ ...prev, mode: opt.key }))}
                >
                  <Text style={[s.chipText, payment.mode === opt.key && s.chipTextActive]}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            {payment.mode === "morocco_trip" && (
              <View style={s.manualRow}>
                <View style={s.manualField}>
                  <Text style={s.inputLabel}>{t("onboarding.tripRate")}</Text>
                  <TextInput
                    style={s.input}
                    value={payment.tripRate}
                    onChangeText={(val) => setPayment((prev) => ({ ...prev, tripRate: val }))}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={Colors.light.textSecondary}
                  />
                </View>
              </View>
            )}
            {payment.mode === "morocco_pernight" && (
              <View style={s.manualRow}>
                <View style={s.manualField}>
                  <Text style={s.inputLabel}>{t("onboarding.pernightRate")}</Text>
                  <TextInput
                    style={s.input}
                    value={payment.pernightRate}
                    onChangeText={(val) => setPayment((prev) => ({ ...prev, pernightRate: val }))}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={Colors.light.textSecondary}
                  />
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>

      <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, Platform.OS === "web" ? 34 : 16) }]}>
        {errors.length > 0 && (
          <View style={s.errorBox}>
            {errors.map((err, i) => (
              <Text key={i} style={s.errorText}>{err}</Text>
            ))}
          </View>
        )}
        <Pressable
          style={[s.saveButton, saving && s.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
              <Text style={s.saveButtonText}>{t("onboarding.saveButton")}</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  header: {
    alignItems: "center",
    marginBottom: 24,
    paddingTop: 12,
  },
  title: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
    marginTop: 8,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    textAlign: "center",
    marginTop: 6,
    paddingHorizontal: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 24,
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
  },
  optionRow: {
    flexDirection: "row",
    gap: 10,
  },
  profileCard: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: Colors.light.surface,
    borderWidth: 2,
    borderColor: Colors.light.border,
    gap: 6,
  },
  profileCardActive: {
    backgroundColor: Colors.light.tint,
    borderColor: Colors.light.tint,
  },
  profileLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
  },
  profileLabelActive: {
    color: "#fff",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: Colors.light.surface,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  chipActive: {
    backgroundColor: Colors.light.tint,
    borderColor: Colors.light.tint,
  },
  chipText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.light.text,
  },
  chipTextActive: {
    color: "#fff",
  },
  checkboxGroup: {
    gap: 4,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  checkboxLabel: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.light.text,
  },
  gridContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  gridItem: {
    width: "47%" as any,
  },
  inputLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: Colors.light.textSecondary,
    marginBottom: 4,
  },
  input: {
    backgroundColor: Colors.light.surface,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.light.text,
  },
  manualRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 10,
  },
  manualField: {
    flex: 1,
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.light.background,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  errorBox: {
    backgroundColor: Colors.light.danger + "15",
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
  },
  errorText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.light.danger,
  },
  saveButton: {
    backgroundColor: Colors.light.tint,
    borderRadius: 12,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
});
