import AsyncStorage from "@react-native-async-storage/async-storage";
import { userScopedKey } from "@/lib/user-scope";
import { supabase } from "@/lib/supabase";
import { fetchDayExtras, fetchDietRates, fetchHolidays, upsertDayExtras, upsertDietRates } from "@/lib/user-cloud";
import { syncAll } from "@/lib/sync-service";

const SETTINGS_KEY = "tacoplan_user_settings";
const PERIOD_KEY = "tacoplan_period_config";
const FERRY_KEY = "tacoplan_ferry_config";
const ONBOARDING_KEY = "tacoplan_onboarding_completed";
const HOLIDAYS_CACHE_KEY = "tacoplan_user_holidays_cache";
const DEVICE_ID_GLOBAL_KEY = "tacoplan_device_id_global";

export type UserConfig = {
  settings: Record<string, any>;
  period: Record<string, any>;
  ferry: Record<string, any>;
  onboarding: Record<string, any>;
  holidays: any[];
};

const NUMERIC_MERGE_KEYS = new Set<string>([
  "nac_100",
  "nac_60",
  "nac_30",
  "intl_100",
  "intl_60",
  "intl_30",
  "reg_100",
  "reg_60",
  "reg_30",
  "extra_saturday",
  "extra_sunday",
  "extra_holiday",
  "offsite_weekly_reduced_nacional",
  "offsite_weekly_reduced_internacional",
  "offsite_weekly_complete_nacional",
  "offsite_weekly_complete_internacional",
  "price_per_km",
  "price_per_km_nacional",
  "price_per_km_internacional",
  "price_per_km_regional",
  "price_per_trip",
  "price_per_trip_nacional",
  "price_per_trip_internacional",
  "price_per_trip_regional",
  "period_start_day",
  "period_end_day",
  "base_latitude",
  "base_longitude",
  "base_radius_km",
]);

function mergePreferLocal(local: Record<string, any>, incoming: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...local };
  for (const [k, v] of Object.entries(incoming)) {
    const localVal = out[k];
    const localHas = localVal != null && String(localVal).trim() !== "";
    if (!localHas && v != null) {
      out[k] = v;
      continue;
    }
    if (NUMERIC_MERGE_KEYS.has(k) && v != null) {
      const ln = parseFloat(String(localVal ?? "").replace(",", "."));
      const vn = parseFloat(String(v ?? "").replace(",", "."));
      const localIsZero = Number.isFinite(ln) && ln === 0;
      const incomingNonZero = Number.isFinite(vn) && vn !== 0;
      if (localIsZero && incomingNonZero) out[k] = String(v);
    }
  }
  return out;
}

function mapRatesToSettings(rates: any[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const r of rates || []) {
    const prefix = r.trip_type === "NACIONAL" ? "nac" : r.trip_type === "REGIONAL" ? "reg" : "intl";
    out[`${prefix}_${r.percent}`] = String(r.amount ?? "0");
  }
  return out;
}

function mapExtrasToSettings(extras: any | null): Record<string, any> {
  if (!extras) return {};
  const out: Record<string, any> = {};
  const keys = [
    "extra_saturday",
    "extra_sunday",
    "extra_holiday",
    "offsite_weekly_reduced_nacional",
    "offsite_weekly_reduced_internacional",
    "offsite_weekly_complete_nacional",
    "offsite_weekly_complete_internacional",
  ];
  for (const k of keys) {
    if ((extras as any)[k] != null) out[k] = String((extras as any)[k]);
  }
  return out;
}

function mapProfileToSettings(profile: any | null): Record<string, any> {
  if (!profile) return {};
  const out: Record<string, any> = {};
  if (profile.display_name != null) out.driver_name = profile.display_name;
  if (profile.driver_profile != null) out.driver_profile = profile.driver_profile;
  if (profile.operation_zone != null) out.operation_zone = profile.operation_zone;
  if (profile.trip_types != null) out.trip_types = profile.trip_types;
  if (profile.payment_mode != null) out.payment_mode = profile.payment_mode;
  const numKeys = [
    "price_per_km",
    "price_per_km_nacional",
    "price_per_km_internacional",
    "price_per_km_regional",
    "price_per_trip",
    "price_per_trip_nacional",
    "price_per_trip_internacional",
    "price_per_trip_regional",
  ];
  for (const k of numKeys) {
    if (profile[k] != null) out[k] = String(profile[k]);
  }
  if (profile.period_type) out.period_type = profile.period_type;
  if (profile.period_start_day != null) out.period_start_day = String(profile.period_start_day);
  if (profile.period_end_day != null) out.period_end_day = String(profile.period_end_day);
  if (profile.base_name != null) out.base_name = profile.base_name;
  if (profile.base_city != null) out.base_city = profile.base_city;
  if (profile.base_country != null) out.base_country = profile.base_country;
  if (profile.base_address != null) out.base_address = profile.base_address;
  if (profile.base_latitude != null) out.base_latitude = String(profile.base_latitude);
  if (profile.base_longitude != null) out.base_longitude = String(profile.base_longitude);
  if (profile.base_radius_km != null) out.base_radius_km = String(profile.base_radius_km);
  if (profile.base_configured_at != null) out.base_configured_at = profile.base_configured_at;
  if (profile.base_updated_at != null) out.base_updated_at = profile.base_updated_at;
  return out;
}

function extractDietRatesFromSettings(settings: Record<string, any>) {
  const get = (k: string) => {
    const n = parseFloat(String(settings[k] ?? "0").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };
  return [
    { trip_type: "NACIONAL", percent: 100, amount: get("nac_100") },
    { trip_type: "NACIONAL", percent: 60, amount: get("nac_60") },
    { trip_type: "NACIONAL", percent: 30, amount: get("nac_30") },
    { trip_type: "INTERNACIONAL", percent: 100, amount: get("intl_100") },
    { trip_type: "INTERNACIONAL", percent: 60, amount: get("intl_60") },
    { trip_type: "INTERNACIONAL", percent: 30, amount: get("intl_30") },
    { trip_type: "REGIONAL", percent: 100, amount: get("reg_100") },
    { trip_type: "REGIONAL", percent: 60, amount: get("reg_60") },
    { trip_type: "REGIONAL", percent: 30, amount: get("reg_30") },
  ] as any[];
}

function extractDayExtrasFromSettings(settings: Record<string, any>) {
  const get = (k: string) => {
    const n = parseFloat(String(settings[k] ?? "0").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };
  return {
    extra_saturday: get("extra_saturday"),
    extra_sunday: get("extra_sunday"),
    extra_holiday: get("extra_holiday"),
    offsite_weekly_reduced_nacional: get("offsite_weekly_reduced_nacional"),
    offsite_weekly_reduced_internacional: get("offsite_weekly_reduced_internacional"),
    offsite_weekly_complete_nacional: get("offsite_weekly_complete_nacional"),
    offsite_weekly_complete_internacional: get("offsite_weekly_complete_internacional"),
  };
}

function extractProfileConfigFromSettings(settings: Record<string, any>) {
  const getNum = (k: string) => {
    const n = parseFloat(String(settings[k] ?? "0").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };
  const paymentMode = String(settings.payment_mode || "dietas");
  const payload: Record<string, any> = {
    payment_mode: paymentMode,
    price_per_km: getNum("price_per_km"),
    price_per_km_nacional: getNum("price_per_km_nacional"),
    price_per_km_internacional: getNum("price_per_km_internacional"),
    price_per_km_regional: getNum("price_per_km_regional"),
    price_per_trip: getNum("price_per_trip"),
    price_per_trip_nacional: getNum("price_per_trip_nacional"),
    price_per_trip_internacional: getNum("price_per_trip_internacional"),
    price_per_trip_regional: getNum("price_per_trip_regional"),
  };
  if (settings.driver_profile) payload.driver_profile = settings.driver_profile;
  if (settings.operation_zone) payload.operation_zone = settings.operation_zone;
  if (settings.trip_types != null) payload.trip_types = settings.trip_types;
  if (settings.period_type) payload.period_type = settings.period_type;
  if (settings.period_start_day != null) payload.period_start_day = parseInt(String(settings.period_start_day), 10);
  if (settings.period_end_day != null) payload.period_end_day = parseInt(String(settings.period_end_day), 10);
  if (settings.base_name != null) payload.base_name = String(settings.base_name || "").trim() || null;
  if (settings.base_city != null) payload.base_city = String(settings.base_city || "").trim() || null;
  if (settings.base_country != null) payload.base_country = String(settings.base_country || "").trim() || null;
  if (settings.base_address != null) payload.base_address = String(settings.base_address || "").trim() || null;
  if (settings.base_latitude != null && String(settings.base_latitude).trim() !== "") {
    const lat = parseFloat(String(settings.base_latitude).replace(",", "."));
    payload.base_latitude = Number.isFinite(lat) ? lat : null;
  }
  if (settings.base_longitude != null && String(settings.base_longitude).trim() !== "") {
    const lng = parseFloat(String(settings.base_longitude).replace(",", "."));
    payload.base_longitude = Number.isFinite(lng) ? lng : null;
  }
  if (settings.base_radius_km != null && String(settings.base_radius_km).trim() !== "") {
    const radius = parseFloat(String(settings.base_radius_km).replace(",", "."));
    payload.base_radius_km = Number.isFinite(radius) ? radius : 20;
  }
  if (settings.base_configured_at) payload.base_configured_at = settings.base_configured_at;
  if (settings.base_updated_at) payload.base_updated_at = settings.base_updated_at;
  return payload;
}

async function getDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_ID_GLOBAL_KEY).catch(() => null);
  if (existing) return existing;
  const newId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  await AsyncStorage.setItem(DEVICE_ID_GLOBAL_KEY, newId).catch(() => {});
  return newId;
}

async function migrateLegacyKeyIfNeeded(baseKey: string, userId: string): Promise<void> {
  try {
    const scoped = await userScopedKey(baseKey, userId);
    const hasScoped = await AsyncStorage.getItem(scoped);
    if (hasScoped != null) return;
    const legacy = await AsyncStorage.getItem(baseKey);
    if (legacy != null) {
      await AsyncStorage.setItem(scoped, legacy);
    }
  } catch {}
}

function mapFerryRowToConfig(row: any | null): Record<string, any> {
  if (!row) return {};
  const out: Record<string, any> = {};
  if (row.crosses_ferry != null) out.crossesFerry = !!row.crosses_ferry;
  if (row.route_mode != null) out.routeMode = row.route_mode;
  if (row.payment_mode != null) out.paymentMode = row.payment_mode;
  if (row.trip_rate != null) out.tripRate = Number(row.trip_rate) || 0;
  if (row.pernight_rate != null) out.pernightRate = Number(row.pernight_rate) || 0;
  if (row.ferry_rest_enabled != null) out.ferryRestEnabled = !!row.ferry_rest_enabled;
  if (row.ferry_transit_rate != null) out.ferryTransitRate = Number(row.ferry_transit_rate) || 54.3;
  if (row.ferry_cabin_rate != null) out.ferryCabinRate = Number(row.ferry_cabin_rate) || 54.3;
  return out;
}

export async function getUserConfig(userId: string): Promise<UserConfig> {
  await Promise.all([
    migrateLegacyKeyIfNeeded(SETTINGS_KEY, userId),
    migrateLegacyKeyIfNeeded(PERIOD_KEY, userId),
    migrateLegacyKeyIfNeeded(FERRY_KEY, userId),
    migrateLegacyKeyIfNeeded(ONBOARDING_KEY, userId),
    migrateLegacyKeyIfNeeded(HOLIDAYS_CACHE_KEY, userId),
  ]);

  const [settingsRaw, periodRaw, ferryRaw, onboardingRaw, holidaysRaw] = await Promise.all([
    AsyncStorage.getItem(await userScopedKey(SETTINGS_KEY, userId)).catch(() => null),
    AsyncStorage.getItem(await userScopedKey(PERIOD_KEY, userId)).catch(() => null),
    AsyncStorage.getItem(await userScopedKey(FERRY_KEY, userId)).catch(() => null),
    AsyncStorage.getItem(await userScopedKey(ONBOARDING_KEY, userId)).catch(() => null),
    AsyncStorage.getItem(await userScopedKey(HOLIDAYS_CACHE_KEY, userId)).catch(() => null),
  ]);

  const localSettings = settingsRaw ? JSON.parse(settingsRaw) : {};
  const localPeriod = periodRaw ? JSON.parse(periodRaw) : {};
  const localFerry = ferryRaw ? JSON.parse(ferryRaw) : {};
  const localOnboarding = onboardingRaw ? JSON.parse(onboardingRaw) : {};
  const localHolidays = holidaysRaw ? JSON.parse(holidaysRaw) : [];

  try {
    const fetchProfileResilient = async (fields: string[]) => {
      const fullFields = fields.join(",");
      const first = await supabase.from("profiles").select(fullFields).eq("id", userId).maybeSingle();
      if (!first.error) return first.data || null;
      if (String(first.error?.code || "") !== "42703") throw first.error;
      const safeFields = fields.filter((f) => !f.startsWith("base_"));
      const second = await supabase.from("profiles").select(safeFields.join(",")).eq("id", userId).maybeSingle();
      if (second.error) throw second.error;
      return second.data || null;
    };
    const profileFields = [
      "display_name","onboarding_completed","driver_profile","operation_zone","trip_types","payment_mode",
      "price_per_km","price_per_km_nacional","price_per_km_internacional","price_per_km_regional",
      "price_per_trip","price_per_trip_nacional","price_per_trip_internacional","price_per_trip_regional",
      "period_type","period_start_day","period_end_day",
      "base_name","base_city","base_country","base_address","base_latitude","base_longitude","base_radius_km","base_configured_at","base_updated_at",
    ];
    const [profile, rates, extras, holidays, ferryRow] = await Promise.all([
      fetchProfileResilient(profileFields),
      fetchDietRates(userId),
      fetchDayExtras(userId),
      fetchHolidays(userId),
      (async () => {
        try {
          const res = await supabase.from("user_ferry_config").select("*").eq("user_id", userId).maybeSingle();
          return res.error ? null : (res.data ?? null);
        } catch {
          return null;
        }
      })(),
    ]);

    const fromCloud = {
      ...mapProfileToSettings(profile),
      ...mapRatesToSettings(rates),
      ...mapExtrasToSettings(extras),
    };

    const mergedSettings = mergePreferLocal(localSettings, fromCloud);
    const mergedFerry = mergePreferLocal(localFerry, mapFerryRowToConfig(ferryRow));

    await AsyncStorage.setItem(await userScopedKey(SETTINGS_KEY, userId), JSON.stringify(mergedSettings));
    await AsyncStorage.setItem(await userScopedKey(FERRY_KEY, userId), JSON.stringify(mergedFerry));
    await AsyncStorage.setItem(await userScopedKey(HOLIDAYS_CACHE_KEY, userId), JSON.stringify(holidays));

    return {
      settings: mergedSettings,
      period: localPeriod,
      ferry: mergedFerry,
      onboarding: localOnboarding,
      holidays,
    };
  } catch {
    return {
      settings: localSettings,
      period: localPeriod,
      ferry: localFerry,
      onboarding: localOnboarding,
      holidays: localHolidays,
    };
  }
}

export async function saveUserConfig(userId: string, data: { settings?: Record<string, any>; period?: Record<string, any>; ferry?: Record<string, any> }): Promise<void> {
  const settingsKey = await userScopedKey(SETTINGS_KEY, userId);
  const periodKey = await userScopedKey(PERIOD_KEY, userId);
  const ferryKey = await userScopedKey(FERRY_KEY, userId);

  const existingRaw = await AsyncStorage.getItem(settingsKey);
  const existing = existingRaw ? JSON.parse(existingRaw) : {};
  const incomingSettings = data.settings ? { ...data.settings } : null;
  if (incomingSettings) {
    const hasBase =
      String(incomingSettings.base_name ?? existing.base_name ?? "").trim() !== "" &&
      String(incomingSettings.base_city ?? existing.base_city ?? "").trim() !== "" &&
      String(incomingSettings.base_country ?? existing.base_country ?? "").trim() !== "";
    if (hasBase) {
      const nowIso = new Date().toISOString();
      incomingSettings.base_configured_at = existing.base_configured_at || incomingSettings.base_configured_at || nowIso;
      incomingSettings.base_updated_at = nowIso;
    }
  }
  const merged = data.settings
    ? { ...existing, ...incomingSettings, _updated_at: new Date().toISOString() }
    : existing;

  await AsyncStorage.setItem(settingsKey, JSON.stringify(merged));
  if (data.period) await AsyncStorage.setItem(periodKey, JSON.stringify(data.period));
  if (data.ferry) await AsyncStorage.setItem(ferryKey, JSON.stringify(data.ferry));

  try {
    const profilePayload = extractProfileConfigFromSettings(merged);
    const { error } = await supabase
      .from("profiles")
      .upsert({ id: userId, ...profilePayload, updated_at: new Date().toISOString() } as any, { onConflict: "id" });
    if (error) throw error;
  } catch {}

  try {
    await upsertDietRates(userId, extractDietRatesFromSettings(merged) as any);
  } catch {}

  try {
    await upsertDayExtras(userId, extractDayExtrasFromSettings(merged) as any);
  } catch {}

  try {
    const ferryRaw = await AsyncStorage.getItem(ferryKey);
    const ferry = ferryRaw ? JSON.parse(ferryRaw) : null;
    if (ferry) {
      const row: Record<string, any> = {
        user_id: userId,
        crosses_ferry: !!ferry.crossesFerry,
        route_mode: ferry.routeMode || "spain",
        payment_mode: ferry.paymentMode || "spain_diet",
        trip_rate: Number(ferry.tripRate) || 0,
        pernight_rate: Number(ferry.pernightRate) || 0,
        ferry_rest_enabled: !!ferry.ferryRestEnabled,
        updated_at: new Date().toISOString(),
      };
      if (ferry.ferryTransitRate != null) row.ferry_transit_rate = Number(ferry.ferryTransitRate) || 54.3;
      if (ferry.ferryCabinRate != null) row.ferry_cabin_rate = Number(ferry.ferryCabinRate) || 54.3;
      await supabase.from("user_ferry_config").upsert(row as any, { onConflict: "user_id" });
    }
  } catch {}
}

export async function markOnboardingCompleted(userId: string): Promise<void> {
  try {
    const deviceId = await getDeviceId();
    await supabase
      .from("profiles")
      .update({
        onboarding_completed: true,
        last_login_device_id: deviceId,
        last_login_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", userId);
    try {
      await supabase
        .from("profiles")
        .update({ created_device_id: deviceId, updated_at: new Date().toISOString() } as any)
        .eq("id", userId)
        .is("created_device_id", null);
    } catch {}
  } catch {}
  try {
    await AsyncStorage.setItem(await userScopedKey(ONBOARDING_KEY, userId), JSON.stringify({ completed: true, completedAt: new Date().toISOString() }));
  } catch {}
}

export async function syncUserData(userId: string): Promise<void> {
  void userId;
  await syncAll(async () => null);
}
