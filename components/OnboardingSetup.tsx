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
import { userScopedKey } from "@/lib/user-scope";
import { useAuth } from "@/lib/auth-context";
import { markOnboardingCompleted, saveUserConfig } from "@/lib/config-service";

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
  reg_100: string;
  reg_60: string;
  reg_30: string;
}

interface DayExtras {
  extra_saturday: string;
  extra_sunday: string;
  extra_holiday: string;
  offsite_weekly_reduced_nacional: string;
  offsite_weekly_reduced_internacional: string;
  offsite_weekly_complete_nacional: string;
  offsite_weekly_complete_internacional: string;
}

interface PaymentConfig {
  mode: "morocco_trip" | "morocco_pernight" | "morocco_diet";
  tripRate: string;
  pernightRate: string;
}

interface BaseLocationForm {
  base_name: string;
  base_city: string;
  base_country: string;
  base_address: string;
  base_latitude: string;
  base_longitude: string;
  base_radius_km: string;
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
  nac_100: "0",
  nac_60: "0",
  nac_30: "0",
  intl_100: "0",
  intl_60: "0",
  intl_30: "0",
  reg_100: "0",
  reg_60: "0",
  reg_30: "0",
};

const DEFAULT_EXTRAS: DayExtras = {
  extra_saturday: "0",
  extra_sunday: "0",
  extra_holiday: "0",
  offsite_weekly_reduced_nacional: "0",
  offsite_weekly_reduced_internacional: "0",
  offsite_weekly_complete_nacional: "0",
  offsite_weekly_complete_internacional: "0",
};

export default function OnboardingSetup({ onComplete }: Props) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const { user } = useAuth();
  const userId = user?.id ?? null;

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
  const [userPaymentMode, setUserPaymentMode] = useState<"dietas" | "viaje" | "km">("dietas");
  const [pricePerKmNac, setPricePerKmNac] = useState("0");
  const [pricePerKmIntl, setPricePerKmIntl] = useState("0");
  const [pricePerKmReg, setPricePerKmReg] = useState("0");
  const [pricePerTripNac, setPricePerTripNac] = useState("0");
  const [pricePerTripIntl, setPricePerTripIntl] = useState("0");
  const [pricePerTripReg, setPricePerTripReg] = useState("0");
  const [payment, setPayment] = useState<PaymentConfig>({
    mode: "morocco_diet",
    tripRate: "0",
    pernightRate: "0",
  });
  const [baseLocation, setBaseLocation] = useState<BaseLocationForm>({
    base_name: "",
    base_city: "",
    base_country: "",
    base_address: "",
    base_latitude: "",
    base_longitude: "",
    base_radius_km: "20",
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [settingsRaw, periodRaw, ferryRaw] = await Promise.all([
          AsyncStorage.getItem(await userScopedKey(SETTINGS_KEY, userId)),
          AsyncStorage.getItem(await userScopedKey(PERIOD_KEY, userId)),
          AsyncStorage.getItem(await userScopedKey(FERRY_KEY, userId)),
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
            reg_100: s.reg_100 ?? DEFAULT_DIETS.reg_100,
            reg_60: s.reg_60 ?? DEFAULT_DIETS.reg_60,
            reg_30: s.reg_30 ?? DEFAULT_DIETS.reg_30,
          });
          setExtras({
            extra_saturday: s.extra_saturday ?? DEFAULT_EXTRAS.extra_saturday,
            extra_sunday: s.extra_sunday ?? DEFAULT_EXTRAS.extra_sunday,
            extra_holiday: s.extra_holiday ?? DEFAULT_EXTRAS.extra_holiday,
            offsite_weekly_reduced_nacional: s.offsite_weekly_reduced_nacional ?? DEFAULT_EXTRAS.offsite_weekly_reduced_nacional,
            offsite_weekly_reduced_internacional: s.offsite_weekly_reduced_internacional ?? DEFAULT_EXTRAS.offsite_weekly_reduced_internacional,
            offsite_weekly_complete_nacional: s.offsite_weekly_complete_nacional ?? DEFAULT_EXTRAS.offsite_weekly_complete_nacional,
            offsite_weekly_complete_internacional: s.offsite_weekly_complete_internacional ?? DEFAULT_EXTRAS.offsite_weekly_complete_internacional,
          });
          if (s.payment_mode === "dietas" || s.payment_mode === "viaje" || s.payment_mode === "km") {
            setUserPaymentMode(s.payment_mode);
          }
          const fallbackKm = s.price_per_km != null ? String(s.price_per_km) : "0";
          setPricePerKmNac(s.price_per_km_nacional != null ? String(s.price_per_km_nacional) : fallbackKm);
          setPricePerKmIntl(s.price_per_km_internacional != null ? String(s.price_per_km_internacional) : fallbackKm);
          setPricePerKmReg(s.price_per_km_regional != null ? String(s.price_per_km_regional) : fallbackKm);
          const fallbackTrip = s.price_per_trip != null ? String(s.price_per_trip) : "0";
          setPricePerTripNac(s.price_per_trip_nacional != null ? String(s.price_per_trip_nacional) : fallbackTrip);
          setPricePerTripIntl(s.price_per_trip_internacional != null ? String(s.price_per_trip_internacional) : fallbackTrip);
          setPricePerTripReg(s.price_per_trip_regional != null ? String(s.price_per_trip_regional) : fallbackTrip);
          if (s.driver_profile) setProfile(s.driver_profile);
          if (s.operation_zone) setZone(s.operation_zone);
          if (s.trip_types) setTripTypes(s.trip_types);
          setBaseLocation({
            base_name: s.base_name ?? "",
            base_city: s.base_city ?? "",
            base_country: s.base_country ?? "",
            base_address: s.base_address ?? "",
            base_latitude: s.base_latitude != null ? String(s.base_latitude) : "",
            base_longitude: s.base_longitude != null ? String(s.base_longitude) : "",
            base_radius_km: s.base_radius_km != null ? String(s.base_radius_km) : "20",
          });
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
  }, [userId]);

  const showPaymentSection = profile === "morocco" || profile === "ferry";
  const showUserPaymentSection = profile === "standard";

  function toggleTrip(key: keyof TripTypes) {
    setTripTypes((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function validate(): string[] {
    const errs: string[] = [];
    if (!profile) errs.push(t("onboarding.errorProfile"));
    if (!zone) errs.push(t("onboarding.errorZone"));
    if (!baseLocation.base_name.trim()) errs.push("Indica el nombre de tu base");
    if (!baseLocation.base_city.trim()) errs.push("Indica la ciudad de tu base");
    if (!baseLocation.base_country.trim()) errs.push("Indica el país de tu base");
    const baseRadius = parseFloat(baseLocation.base_radius_km.replace(",", "."));
    if (!Number.isFinite(baseRadius) || baseRadius <= 0) errs.push("El radio de base debe ser mayor que 0");
    if (!tripTypes.nacional && !tripTypes.internacional && !tripTypes.morocco && !tripTypes.ferry)
      errs.push(t("onboarding.errorTripType"));
    if (!periodMode) errs.push(t("onboarding.errorPeriod"));
    if (periodMode === "MANUAL") {
      const from = parseInt(manualFrom, 10);
      const to = parseInt(manualTo, 10);
      if (isNaN(from) || isNaN(to) || from < 1 || from > 31 || to < 1 || to > 31)
        errs.push(t("onboarding.errorManualDays"));
    }
    if (showUserPaymentSection) {
      const kmNac = parseFloat(pricePerKmNac);
      const kmIntl = parseFloat(pricePerKmIntl);
      const kmReg = parseFloat(pricePerKmReg);
      const tripNac = parseFloat(pricePerTripNac);
      const tripIntl = parseFloat(pricePerTripIntl);
      const tripReg = parseFloat(pricePerTripReg);
      if (userPaymentMode === "km" && (
        isNaN(kmNac) || kmNac < 0 || isNaN(kmIntl) || kmIntl < 0 || isNaN(kmReg) || kmReg < 0
      )) errs.push(t("usuario.pricePerKm") + " >= 0");
      if (userPaymentMode === "viaje" && (
        isNaN(tripNac) || tripNac < 0 || isNaN(tripIntl) || tripIntl < 0 || isNaN(tripReg) || tripReg < 0
      )) errs.push(t("usuario.pricePerTrip") + " >= 0");
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
      if (!userId) {
        Alert.alert(t("common.error"), t("common.notAuthenticated"));
        return;
      }
      const existingRaw = await AsyncStorage.getItem(await userScopedKey(SETTINGS_KEY, userId));
      const existingSettings = existingRaw ? JSON.parse(existingRaw) : {};
      const userSettings = {
        ...existingSettings,
        ...diets,
        ...extras,
        payment_mode: userPaymentMode,
        price_per_km: pricePerKmNac,
        price_per_km_nacional: pricePerKmNac,
        price_per_km_internacional: pricePerKmIntl,
        price_per_km_regional: pricePerKmReg,
        price_per_trip: pricePerTripNac,
        price_per_trip_nacional: pricePerTripNac,
        price_per_trip_internacional: pricePerTripIntl,
        price_per_trip_regional: pricePerTripReg,
        driver_profile: profile,
        operation_zone: zone,
        trip_types: tripTypes,
        base_name: baseLocation.base_name.trim(),
        base_city: baseLocation.base_city.trim(),
        base_country: baseLocation.base_country.trim(),
        base_address: baseLocation.base_address.trim(),
        base_latitude: baseLocation.base_latitude.trim(),
        base_longitude: baseLocation.base_longitude.trim(),
        base_radius_km: baseLocation.base_radius_km.trim() || "20",
        period_type: periodMode,
        period_start_day: periodMode === "AUTO_20_20" ? "21" : periodMode === "MANUAL" ? manualFrom : "1",
        period_end_day: periodMode === "AUTO_20_20" ? "20" : periodMode === "MANUAL" ? manualTo : "30",
      };

      const periodConfig = {
        mode: periodMode,
        manualFrom: periodMode === "MANUAL" ? parseInt(manualFrom, 10) : periodMode === "AUTO_20_20" ? 21 : 1,
        manualTo: periodMode === "MANUAL" ? parseInt(manualTo, 10) : periodMode === "AUTO_20_20" ? 20 : 30,
      };

      const isMoroccoOrFerry = profile === "morocco" || profile === "ferry";
      const ferryConfig = {
        crossesFerry: isMoroccoOrFerry,
        routeMode: profile === "morocco" ? "morocco" : "spain",
        paymentMode: isMoroccoOrFerry ? payment.mode : "spain_diet",
        tripRate: parseFloat(payment.tripRate) || 0,
        pernightRate: parseFloat(payment.pernightRate) || 0,
        ferryRestEnabled: profile === "ferry",
      };
      await saveUserConfig(userId, { settings: userSettings, period: periodConfig, ferry: ferryConfig });

      const onboardingData = {
        completed: true,
        driverProfile: profile,
        operationZone: zone,
        tripTypes,
        completedAt: new Date().toISOString(),
      };
      await AsyncStorage.setItem(await userScopedKey(ONBOARDING_KEY, userId), JSON.stringify(onboardingData));
      await markOnboardingCompleted(userId);

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
    { key: "reg_100", label: t("onboarding.dietReg100") },
    { key: "reg_60", label: t("onboarding.dietReg60") },
    { key: "reg_30", label: t("onboarding.dietReg30") },
  ];

  const extraFields: { key: keyof DayExtras; label: string }[] = [
    { key: "extra_saturday", label: t("onboarding.extraSaturday") },
    { key: "extra_sunday", label: t("onboarding.extraSunday") },
    { key: "extra_holiday", label: t("onboarding.extraHoliday") },
  ];

  const offsiteFields: { key: keyof DayExtras; label: string }[] = [
    { key: "offsite_weekly_reduced_nacional", label: t("onboarding.offsiteWeeklyReducedNacional") },
    { key: "offsite_weekly_reduced_internacional", label: t("onboarding.offsiteWeeklyReducedInternacional") },
    { key: "offsite_weekly_complete_nacional", label: t("onboarding.offsiteWeeklyCompleteNacional") },
    { key: "offsite_weekly_complete_internacional", label: t("onboarding.offsiteWeeklyCompleteInternacional") },
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

        <SectionHeader title="Lugar de base" icon="business-outline" />
        <Text style={s.subtitleInline}>
          Indica tu lugar de base para mejorar el cálculo de descansos semanales, descansos fuera de base y compensaciones.
        </Text>
        <View style={s.gridContainer}>
          <View style={s.gridItem}>
            <Text style={s.inputLabel}>Nombre de la base</Text>
            <TextInput
              style={s.input}
              value={baseLocation.base_name}
              onChangeText={(val) => setBaseLocation((prev) => ({ ...prev, base_name: val }))}
              placeholder="Base Abrera"
              placeholderTextColor={Colors.light.textSecondary}
            />
          </View>
          <View style={s.gridItem}>
            <Text style={s.inputLabel}>Ciudad</Text>
            <TextInput
              style={s.input}
              value={baseLocation.base_city}
              onChangeText={(val) => setBaseLocation((prev) => ({ ...prev, base_city: val }))}
              placeholder="Abrera"
              placeholderTextColor={Colors.light.textSecondary}
            />
          </View>
          <View style={s.gridItem}>
            <Text style={s.inputLabel}>País</Text>
            <TextInput
              style={s.input}
              value={baseLocation.base_country}
              onChangeText={(val) => setBaseLocation((prev) => ({ ...prev, base_country: val }))}
              placeholder="España"
              placeholderTextColor={Colors.light.textSecondary}
            />
          </View>
          <View style={s.gridItem}>
            <Text style={s.inputLabel}>Radio base</Text>
            <TextInput
              style={s.input}
              value={baseLocation.base_radius_km}
              onChangeText={(val) => setBaseLocation((prev) => ({ ...prev, base_radius_km: val }))}
              keyboardType="decimal-pad"
              placeholder="20"
              placeholderTextColor={Colors.light.textSecondary}
            />
          </View>
          <View style={[s.gridItem, { width: "100%" as any }]}>
            <Text style={s.inputLabel}>Dirección opcional</Text>
            <TextInput
              style={s.input}
              value={baseLocation.base_address}
              onChangeText={(val) => setBaseLocation((prev) => ({ ...prev, base_address: val }))}
              placeholder="Calle, polígono o centro operativo"
              placeholderTextColor={Colors.light.textSecondary}
            />
          </View>
          <View style={s.gridItem}>
            <Text style={s.inputLabel}>Latitud opcional</Text>
            <TextInput
              style={s.input}
              value={baseLocation.base_latitude}
              onChangeText={(val) => setBaseLocation((prev) => ({ ...prev, base_latitude: val }))}
              keyboardType="decimal-pad"
              placeholder="41.5167"
              placeholderTextColor={Colors.light.textSecondary}
            />
          </View>
          <View style={s.gridItem}>
            <Text style={s.inputLabel}>Longitud opcional</Text>
            <TextInput
              style={s.input}
              value={baseLocation.base_longitude}
              onChangeText={(val) => setBaseLocation((prev) => ({ ...prev, base_longitude: val }))}
              keyboardType="decimal-pad"
              placeholder="1.9020"
              placeholderTextColor={Colors.light.textSecondary}
            />
          </View>
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
        <View style={s.subsectionDivider} />
        <Text style={s.subsectionLabel}>{t("usuario.offsiteWeeklyRestRates")}</Text>
        <View style={s.gridContainer}>
          {offsiteFields.map((f) => (
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

        {showUserPaymentSection && (
          <>
            <SectionHeader title={t("usuario.paymentMode")} icon="card-outline" />
            <View style={s.chipRow}>
              {(["dietas", "viaje", "km"] as const).map((pm) => (
                <Pressable
                  key={pm}
                  style={[s.chip, userPaymentMode === pm && s.chipActive]}
                  onPress={() => setUserPaymentMode(pm)}
                >
                  <Text style={[s.chipText, userPaymentMode === pm && s.chipTextActive]}>
                    {pm === "dietas"
                      ? t("usuario.paymentModeDietas")
                      : pm === "viaje"
                        ? t("usuario.paymentModeTrip")
                        : t("usuario.paymentModeKm")}
                  </Text>
                </Pressable>
              ))}
            </View>

            {userPaymentMode === "km" && (
              <>
                <View style={[s.gridContainer, { marginTop: 10 }]}>
                  <View style={s.gridItem}>
                    <Text style={s.inputLabel}>{t("usuario.pricePerKmNacional")}</Text>
                    <TextInput
                      style={s.input}
                      value={pricePerKmNac}
                      onChangeText={setPricePerKmNac}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={Colors.light.textSecondary}
                    />
                  </View>
                  <View style={s.gridItem}>
                    <Text style={s.inputLabel}>{t("usuario.pricePerKmInternacional")}</Text>
                    <TextInput
                      style={s.input}
                      value={pricePerKmIntl}
                      onChangeText={setPricePerKmIntl}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={Colors.light.textSecondary}
                    />
                  </View>
                  <View style={s.gridItem}>
                    <Text style={s.inputLabel}>{t("usuario.pricePerKmRegional")}</Text>
                    <TextInput
                      style={s.input}
                      value={pricePerKmReg}
                      onChangeText={setPricePerKmReg}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={Colors.light.textSecondary}
                    />
                  </View>
                </View>
                <View style={s.warningBox}>
                  <Text style={s.warningTitle}>{t("usuario.kmWarningTitle")}</Text>
                  <Text style={s.warningText}>{t("usuario.kmWarningText")}</Text>
                </View>
              </>
            )}

            {userPaymentMode === "viaje" && (
              <View style={[s.gridContainer, { marginTop: 10 }]}>
                <View style={s.gridItem}>
                  <Text style={s.inputLabel}>{t("usuario.pricePerTripNacional")}</Text>
                  <TextInput
                    style={s.input}
                    value={pricePerTripNac}
                    onChangeText={setPricePerTripNac}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={Colors.light.textSecondary}
                  />
                </View>
                <View style={s.gridItem}>
                  <Text style={s.inputLabel}>{t("usuario.pricePerTripInternacional")}</Text>
                  <TextInput
                    style={s.input}
                    value={pricePerTripIntl}
                    onChangeText={setPricePerTripIntl}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={Colors.light.textSecondary}
                  />
                </View>
                <View style={s.gridItem}>
                  <Text style={s.inputLabel}>{t("usuario.pricePerTripRegional")}</Text>
                  <TextInput
                    style={s.input}
                    value={pricePerTripReg}
                    onChangeText={setPricePerTripReg}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={Colors.light.textSecondary}
                  />
                </View>
              </View>
            )}
          </>
        )}

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
  subtitleInline: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    lineHeight: 18,
    marginBottom: 8,
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
  subsectionDivider: {
    height: 1,
    backgroundColor: Colors.light.border,
    marginTop: 14,
    marginBottom: 10,
  },
  subsectionLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
    marginBottom: 10,
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
  warningBox: {
    backgroundColor: Colors.light.warning + "15",
    padding: 10,
    borderRadius: 10,
    marginTop: 10,
  },
  warningTitle: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    color: Colors.light.warning,
    marginBottom: 4,
  },
  warningText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    lineHeight: 16,
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
