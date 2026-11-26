import "@/lib/autostart/task";
import "@/lib/autostart/driving";
import "react-native-url-polyfill/auto";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Font from "expo-font";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/query-client";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { SyncProvider, useSync } from "@/lib/sync-context";
import SyncToastOverlay from "@/components/SyncToast";
import { PeriodProvider, usePeriod } from "@/lib/period-context";
import { I18nProvider, useI18n } from "@/lib/i18n-context";
import { FerryProvider } from "@/lib/ferry-context";
import { TachographProvider } from "@/lib/tachograph/tachograph-context";
import PeriodSetupModal from "@/components/PeriodSetupModal";
import OnboardingSetup from "@/components/OnboardingSetup";
import ReferralOnboardingGate from "@/components/ReferralOnboardingGate";
import ExistingAccountSetup from "@/components/ExistingAccountSetup";
import BaseLocationSetup from "@/components/BaseLocationSetup";
import LoginScreen from "@/app/login";
import { ActivityIndicator, AppState, View, Text } from "react-native";
import Colors from "@/constants/colors";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import UpdateGate from "@/components/UpdateGate";
import EmailConsentPrompt from "@/components/EmailConsentPrompt";
import WeeklySurveyModal from "@/components/WeeklySurveyModal";
import { StartupFlowProvider, useStartupFlow } from "@/lib/startup-flow";
import { flushPendingDriverActivities } from "@/lib/driver-activities";

import { pollTrafficLocationRequest } from "@/lib/traffic-location";
import RequiredAppPermissions from "@/components/RequiredAppPermissions";
import { userScopedKey } from "@/lib/user-scope";
import { hydrateCompanyDriver } from "@/lib/enterprise-onboarding";
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
  const { isLoading, isAuthenticated, user } = useAuth();
  const signedInPreviously = useRef(false);
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (isAuthenticated) { signedInPreviously.current = true; return; }
    if (!signedInPreviously.current) return;
    signedInPreviously.current = false;
    // Stop an existing monitor on an actual logout, never on a cold login
    // screen where no native GPS service was started by this session.
    void Promise.all([
      import("@/lib/autostart/driving").then(m => m.stopDrivingMonitoring()),
      import("@/lib/autostart/service").then(m => m.suspendAutoStartMonitoring()),
    ]).catch(e => console.warn("[LOCATION] stop on logout", e));
  }, [isAuthenticated]);

  // Location monitoring is intentionally NOT started in AuthGate: this
  // component mounts before the required permissions and setup screens.
  // Android permission grants must never trigger GPS services while the
  // navigation tree is still being created. Dashboard starts opted-in
  // monitoring only when onboarding and first sync have settled.

  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;
    let busy = false;
    const flush = async () => {
      if (busy) return;
      busy = true;
      try { await flushPendingDriverActivities(user.id); }
      finally { busy = false; }
    };
    void flush();
    const app = AppState.addEventListener("change", state => {
      if (state === "active") void flush();
    });
    const interval = setInterval(() => { void flush(); }, 60 * 1000);
    return () => { app.remove(); clearInterval(interval); };
  }, [isAuthenticated, user?.id]);

  useEffect(() => {
    if (!isAuthenticated || !user?.id || Platform.OS === "web") return;
    // A short foreground poll supplements normal app-activation and never forces
    // location access unless the conductor explicitly enabled sharing.
    void pollTrafficLocationRequest();
    const ticker = setInterval(() => { void pollTrafficLocationRequest(); }, 15000);
    const app = AppState.addEventListener("change", state => {
      if (state === "active") void pollTrafficLocationRequest();
    });
    return () => { clearInterval(ticker); app.remove(); };
  }, [isAuthenticated, user?.id]);

  useEffect(() => {
    if (Platform.OS === "web" || !isAuthenticated) return;
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

        if (Platform.OS === "android") {
          // Android notification-channel settings persist after creation.
          // A dedicated channel avoids mixing traffic assignments with shifts.
          await Notifications.setNotificationChannelAsync("traffic-assigned-v2", {
            name: "Nuevos viajes de Tráfico",
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 180, 90, 180, 90, 180, 90, 270],
            sound: "tacoplan_viaje_3.wav",
          });
        }

        const handledPushIds = new Set<string>();
        const onResponse = (response: any) => {
          try {
            const id = String(response?.notification?.request?.identifier || "");
            if (id && handledPushIds.has(id)) return;
            if (id) handledPushIds.add(id);
            const data = response?.notification?.request?.content?.data || {};
            if (data?.target === "jornada") {
              router.push("/(tabs)");
            } else if (data?.target === "traffic_location") {
              void pollTrafficLocationRequest();
              router.push("/(tabs)");
            } else if (data?.target === "viaje" && typeof data?.tripId === "string") {
              // Viajes loads the assigned trip from the cloud on focus.
              router.push("/(tabs)/viajes");
            }
          } catch {}
        };
        sub = Notifications.addNotificationResponseReceivedListener(onResponse);
        // A cold-start push tap may happen before this listener is ready.
        // Replay it once after authentication and clear the native response.
        const previousResponse = await Notifications.getLastNotificationResponseAsync();
        if (previousResponse) {
          onResponse(previousResponse);
          await Notifications.clearLastNotificationResponseAsync();
        }
      } catch {}
    })();
    return () => {
      try { sub?.remove?.(); } catch {}
    };
  }, [isAuthenticated]);

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

  return <RequiredAppPermissions><OnboardingGate /></RequiredAppPermissions>;
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

        // Company settings are authoritative: complete invitation and hydrate
        // this device before evaluating the local onboarding flag.
        if(user?.id){
          try {
            const companyConfigured=await hydrateCompanyDriver(user.id);
            if(companyConfigured){
              setNeedsOnboarding(false);
              setNeedsBaseLocation(false);
              setChecking(false);
              return;
            }
          } catch (error) {
            console.warn("[ENTERPRISE] Onboarding hydration unavailable",error);
          }
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
      user?.id ? <ReferralOnboardingGate key={user.id} userId={user.id}><OnboardingSetup onComplete={() => setNeedsOnboarding(false)} /></ReferralOnboardingGate> : <OnboardingSetup onComplete={() => setNeedsOnboarding(false)} />
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
    <ExistingAccountSetup>
      <PeriodProvider>
        <PeriodSetupGate />
      </PeriodProvider>
    </ExistingAccountSetup>
  );
}

function SequencedWeeklySurvey() {
  const { enabled, guideCompleted } = useStartupFlow();
  const { initialSyncSettled, showRecoveryPrompt, isRestoring, restoreComplete } = useSync();
  // Avoid a second modal while initial cloud data is being merged or when
  // the user is deciding whether to restore data on a new device.
  const [emailSettled,setEmailSettled] = useState(false);
  const ready = enabled && guideCompleted && initialSyncSettled && !showRecoveryPrompt && !isRestoring && !restoreComplete;
  return <><EmailConsentPrompt enabled={ready} onSettled={setEmailSettled}/><WeeklySurveyModal enabled={ready && emailSettled}/></>;
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
    <StartupFlowProvider enabled={!needsSetup}>
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
      <SequencedWeeklySurvey />
    </StartupFlowProvider>
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
        // On Android an unresolved font asset must not leave the root tree null
        // indefinitely after an OTA reload or a cold start.
        await Promise.race([
          loadingFonts,
          new Promise<void>((resolve) => setTimeout(resolve, Platform.OS === "web" ? 2500 : 6500)),
        ]);
      } catch (error) {
        console.warn("[FONTS] Error al preparar las fuentes", error);
      }
      // Render a visible native fallback before hiding the splash. Otherwise
      // the OS can expose an empty white activity if hydration is delayed.
      if (cancelled) return;
      if (__DEV__) console.log("[SPLASH] Fonts resolved or timed out; rendering root");
      setBootReady(true);
    }
    loadFontsAndHoldSplash();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!bootReady) return;
    void SplashScreen.hideAsync().catch(error =>
      console.warn("[SPLASH] Unable to hide splash:", error),
    );
  }, [bootReady]);

  if (!bootReady) return (
    <View onLayout={() => {
      // Keep a native loading surface visible even if the splash cannot hide.
      void SplashScreen.hideAsync().catch(() => {});
    }} style={{ flex: 1, backgroundColor: "#08182D", justifyContent: "center", alignItems: "center", padding: 24 }}>
      <ActivityIndicator size="large" color="#70B9FF" />
      <Text style={{ color: "#FFFFFF", fontSize: 17, fontWeight: "700", marginTop: 14 }}>Iniciando Tacoplan…</Text>
      <Text style={{ color: "#B9D0E7", fontSize: 12, marginTop: 8, textAlign: "center" }}>
        Preparando la aplicación. Tus jornadas guardadas se conservan.
      </Text>
    </View>
  );

  return (
    <ErrorBoundary>
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
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
