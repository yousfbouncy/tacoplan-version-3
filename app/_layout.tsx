import "@/lib/autostart/task";
import "react-native-url-polyfill/auto";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Font from "expo-font";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/query-client";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { SyncProvider } from "@/lib/sync-context";
import SyncToastOverlay from "@/components/SyncToast";
import { PeriodProvider, usePeriod } from "@/lib/period-context";
import { I18nProvider, useI18n } from "@/lib/i18n-context";
import { FerryProvider } from "@/lib/ferry-context";
import { TachographProvider } from "@/lib/tachograph/tachograph-context";
import PeriodSetupModal from "@/components/PeriodSetupModal";
import OnboardingSetup from "@/components/OnboardingSetup";
import BaseLocationSetup from "@/components/BaseLocationSetup";
import LoginScreen from "@/app/login";
import { ActivityIndicator, View } from "react-native";
import Colors from "@/constants/colors";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import UpdateGate from "@/components/UpdateGate";
import WeeklySurveyModal from "@/components/WeeklySurveyModal";
import { userScopedKey } from "@/lib/user-scope";
import { supabase } from "@/lib/supabase";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";

SplashScreen.preventAutoHideAsync();

const ONBOARDING_KEY = "tacoplan_onboarding_completed";
const BASE_LOCATION_SKIP_KEY = "tacoplan_base_location_skip_once";

function AuthGate() {
  const { isLoading, isAuthenticated } = useAuth();

  useEffect(() => {
    if (Platform.OS === "web") return;
    let sub: any = null;
    (async () => {
      try {
        const Notifications = await import("expo-notifications");
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert: true,
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
          }),
        });

        sub = Notifications.addNotificationResponseReceivedListener((response: any) => {
          try {
            const data = response?.notification?.request?.content?.data || {};
            if (data?.target === "jornada") {
              router.push("/(tabs)");
            }
          } catch {}
        });
      } catch {}
    })();
    return () => {
      try { sub?.remove?.(); } catch {}
    };
  }, []);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: Colors.light.background }}>
        <ActivityIndicator size="large" color={Colors.light.tint} />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return <OnboardingGate />;
}

function OnboardingGate() {
  const [checking, setChecking] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [needsBaseLocation, setNeedsBaseLocation] = useState(false);
  const [canSkipBaseLocation, setCanSkipBaseLocation] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    (async () => {
      try {
        let localCompleted = false;
        const raw = await AsyncStorage.getItem(await userScopedKey(ONBOARDING_KEY, user?.id ?? null));
        if (raw) {
          const data = JSON.parse(raw);
          if (data.completed) {
            localCompleted = true;
          }
        }

        if (!user?.id) {
          setNeedsOnboarding(!localCompleted);
          setChecking(false);
          return;
        }

        // Si este usuario ya terminó el alta y tiene una base local configurada,
        // abrir Inicio sin bloquear cada arranque por una petición al perfil.
        // Un dispositivo nuevo o una configuración incompleta siguen el control remoto.
        if (localCompleted) {
          try {
            const rawSettings = await AsyncStorage.getItem(await userScopedKey("tacoplan_user_settings", user.id));
            const localSettings = rawSettings ? JSON.parse(rawSettings) : null;
            const hasLocalBase = Boolean(
              String(localSettings?.base_name || "").trim() &&
              String(localSettings?.base_city || "").trim() &&
              String(localSettings?.base_country || "").trim(),
            );
            if (hasLocalBase) {
              setNeedsOnboarding(false);
              setNeedsBaseLocation(false);
              setChecking(false);
              return;
            }
          } catch {}
        }

        try {
          const applyBaseRequirement = async (profileLike: any) => {
            const hasBase =
              String(profileLike?.base_name || "").trim() !== "" &&
              String(profileLike?.base_city || "").trim() !== "" &&
              String(profileLike?.base_country || "").trim() !== "";
            const skipUsed = await AsyncStorage.getItem(await userScopedKey(BASE_LOCATION_SKIP_KEY, user.id));
            setCanSkipBaseLocation(!skipUsed);
            setNeedsBaseLocation(!hasBase);
          };

          const fetchProfileResilient = async (fields: string[]): Promise<{ data: any; error: any; fallbackBase: boolean }> => {
            const fullFields = fields.join(",");
            const first = await supabase.from("profiles").select(fullFields).eq("id", user.id).maybeSingle();
            if (!first.error) return { data: first.data, error: null, fallbackBase: false };
            if (String(first.error?.code || "") !== "42703") return { data: null, error: first.error, fallbackBase: false };
            const safeFields = fields.filter((f) => !f.startsWith("base_"));
            const second = await supabase.from("profiles").select(safeFields.join(",")).eq("id", user.id).maybeSingle();
            return { data: second.data || null, error: second.error || null, fallbackBase: true };
          };

          const fields1 = [
            "id","onboarding_completed","payment_mode",
            "price_per_km","price_per_km_nacional","price_per_km_internacional","price_per_km_regional",
            "price_per_trip","price_per_trip_nacional","price_per_trip_internacional","price_per_trip_regional",
            "base_name","base_city","base_country",
          ];
          const { data: profile, error: profileErr } = await fetchProfileResilient(fields1);
          if (profileErr) {
            console.error("[ONBOARDING] profiles fetch error", profileErr);
            setNeedsOnboarding(!localCompleted);
            setChecking(false);
            return;
          }
          if (!profile) {
            const base: any = {
              id: user.id,
              email: user.email ?? "",
              display_name: (user as any).name ?? "",
              updated_at: new Date().toISOString(),
              onboarding_completed: false,
            };
            const inserted = await supabase.from("profiles").insert(base).select("id,onboarding_completed").maybeSingle();
            if (inserted.error) {
              const fallbackBase: any = {
                id: user.id,
                email: user.email ?? "",
                display_name: (user as any).name ?? "",
                updated_at: new Date().toISOString(),
              };
              const inserted2 = await supabase.from("profiles").insert(fallbackBase).select("id").maybeSingle();
              if (inserted2.error) {
                console.error("[ONBOARDING] profiles insert error", inserted2.error);
              }
            }
          }

          const fields2 = ["id","onboarding_completed","payment_mode","price_per_km","price_per_trip","base_name","base_city","base_country"];
          const refreshedRes = await fetchProfileResilient(fields2);
          const refreshed = refreshedRes.data;

          const remoteCompleted = (refreshed as any)?.onboarding_completed === true;
          if (remoteCompleted) {
            try {
              await AsyncStorage.setItem(
                await userScopedKey(ONBOARDING_KEY, user.id),
                JSON.stringify({ completed: true, completedAt: new Date().toISOString() }),
              );
            } catch {}
            setNeedsOnboarding(false);
            await applyBaseRequirement(refreshed);
            setChecking(false);
            return;
          }

          const [jRes, rRes, eRes, hRes] = await Promise.all([
            supabase.from("jornadas").select("id").eq("user_id", user.id).limit(1),
            supabase.from("user_diet_rates").select("user_id").eq("user_id", user.id).limit(1),
            supabase.from("user_day_extras").select("*").eq("user_id", user.id).maybeSingle(),
            supabase.from("user_holidays").select("id").eq("user_id", user.id).limit(1),
          ]);

          const hasHistory = (jRes.data?.length ?? 0) > 0;
          const hasRates = (rRes.data?.length ?? 0) > 0;
          const hasHolidays = (hRes.data?.length ?? 0) > 0;
          const profileHasNonDefault =
            profile != null &&
            (String((profile as any).payment_mode || "") !== "" && String((profile as any).payment_mode || "") !== "dietas" ||
              Number((profile as any).price_per_km || 0) !== 0 ||
              Number((profile as any).price_per_km_nacional || 0) !== 0 ||
              Number((profile as any).price_per_km_internacional || 0) !== 0 ||
              Number((profile as any).price_per_km_regional || 0) !== 0 ||
              Number((profile as any).price_per_trip || 0) !== 0 ||
              Number((profile as any).price_per_trip_nacional || 0) !== 0 ||
              Number((profile as any).price_per_trip_internacional || 0) !== 0 ||
              Number((profile as any).price_per_trip_regional || 0) !== 0);
          const extras = eRes.error ? null : eRes.data;
          const extrasHasNonZero =
            extras != null &&
            (Number(extras.extra_saturday || 0) !== 0 ||
              Number(extras.extra_sunday || 0) !== 0 ||
              Number(extras.extra_holiday || 0) !== 0 ||
              Number((extras as any).offsite_weekly_reduced_nacional || 0) !== 0 ||
              Number((extras as any).offsite_weekly_reduced_internacional || 0) !== 0 ||
              Number((extras as any).offsite_weekly_complete_nacional || 0) !== 0 ||
              Number((extras as any).offsite_weekly_complete_internacional || 0) !== 0);

          const hasCloudData = hasHistory || hasRates || hasHolidays || extrasHasNonZero || profileHasNonDefault;
          if (hasCloudData) {
            try {
              await supabase
                .from("profiles")
                .update({ onboarding_completed: true, updated_at: new Date().toISOString() } as any)
                .eq("id", user.id);
            } catch {}
            try {
              await AsyncStorage.setItem(
                await userScopedKey(ONBOARDING_KEY, user.id),
                JSON.stringify({ completed: true, completedAt: new Date().toISOString() }),
              );
            } catch {}
            setNeedsOnboarding(false);
            await applyBaseRequirement(profile);
            setChecking(false);
            return;
          }

          setNeedsOnboarding(!localCompleted);
          if (localCompleted) await applyBaseRequirement(profile);
          setChecking(false);
          return;
        } catch (e) {
          console.error("[ONBOARDING] profiles check exception", e);
          setNeedsOnboarding(!localCompleted);
          setChecking(false);
          return;
        }
      } catch {
        setNeedsOnboarding(true);
        setChecking(false);
      }
    })();
  }, [user?.id]);

  if (checking) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: Colors.light.background }}>
        <ActivityIndicator size="large" color={Colors.light.tint} />
      </View>
    );
  }

  if (needsOnboarding) {
    return (
      <OnboardingSetup
        onComplete={() => setNeedsOnboarding(false)}
      />
    );
  }

  if (needsBaseLocation && user?.id) {
    return (
      <BaseLocationSetup
        userId={user.id}
        allowSkipOnce={canSkipBaseLocation}
        onSkip={async () => {
          await AsyncStorage.setItem(
            await userScopedKey(BASE_LOCATION_SKIP_KEY, user.id),
            JSON.stringify({ usedAt: new Date().toISOString() }),
          );
          setCanSkipBaseLocation(false);
          setNeedsBaseLocation(false);
        }}
        onComplete={async () => {
          await AsyncStorage.removeItem(await userScopedKey(BASE_LOCATION_SKIP_KEY, user.id)).catch(() => {});
          setNeedsBaseLocation(false);
          setCanSkipBaseLocation(false);
        }}
      />
    );
  }

  return (
    <PeriodProvider>
      <PeriodSetupGate />
    </PeriodProvider>
  );
}

function PeriodSetupGate() {
  const { isLoaded, needsSetup } = usePeriod();
  const { t } = useI18n();

  if (!isLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: Colors.light.background }}>
        <ActivityIndicator size="large" color={Colors.light.tint} />
      </View>
    );
  }

  return (
    <>
      <PeriodSetupModal visible={needsSetup} />
      <Stack screenOptions={{ headerBackTitle: t("common.back") }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen
          name="jornada-completa"
          options={{
            title: t("nav.jornadaCompleta"),
            headerShown: true,
            presentation: "modal",
          }}
        />
        <Stack.Screen
          name="exportar"
          options={{
            title: t("nav.exportPdf"),
            headerShown: false,
            presentation: "modal",
          }}
        />
        <Stack.Screen
          name="editar-jornada"
          options={{
            title: t("nav.editJornada"),
            headerShown: true,
            presentation: "modal",
          }}
        />
      </Stack>
      <WeeklySurveyModal enabled={!needsSetup} />
    </>
  );
}

export default function RootLayout() {
  const [bootReady, setBootReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadFontsAndHoldSplash() {
      try {
        // Usar las fuentes locales incluidas en el paquete: no depender de
        // Google Fonts ni de su DNS/CORS para abrir Tacoplan web.
        const fontAssets = {
          Inter_400Regular,
          Inter_500Medium,
          Inter_600SemiBold,
          Inter_700Bold,
          ...(Platform.OS === "web" ? {
            ...Ionicons.font,
            ...MaterialCommunityIcons.font,
          } : {}),
        };
        const loadingFonts = Font.loadAsync(fontAssets).catch((error) => {
          // Conservar la causa real para diagnosticar la URL del asset.
          console.warn("[FONTS] No se pudieron cargar todas las fuentes locales", error);
        });
        if (Platform.OS === "web") {
          // Un fallo de red en una fuente no debe bloquear 12 s toda la app.
          await Promise.race([
            loadingFonts,
            new Promise<void>((resolve) => setTimeout(resolve, 2500)),
          ]);
        } else {
          await loadingFonts;
        }
      } catch (error) {
        console.warn("[FONTS] Error al preparar las fuentes", error);
      }
      // Mostrar la app en cuanto estén las fuentes; no añadir 4 s artificiales.
      if (cancelled) return;
      try {
        await SplashScreen.hideAsync();
      } catch {}
      if (__DEV__) console.log("[SPLASH] Fonts ready, continuing app bootstrap");
      setBootReady(true);
    }
    loadFontsAndHoldSplash();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!bootReady) return null;

  return (
    <ErrorBoundary>
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView>
            <AuthProvider>
              <SyncProvider>
                <FerryProvider>
                  <TachographProvider>
                    <UpdateGate />
                    <AuthGate />
                    <SyncToastOverlay />
                  </TachographProvider>
                </FerryProvider>
              </SyncProvider>
            </AuthProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </I18nProvider>
    </ErrorBoundary>
  );
}
