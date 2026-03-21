import "@/lib/suppress-font-errors";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Font from "expo-font";
import React, { useEffect, useState } from "react";
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
import PeriodSetupModal from "@/components/PeriodSetupModal";
import OnboardingSetup from "@/components/OnboardingSetup";
import LoginScreen from "@/app/login";
import { ActivityIndicator, LogBox, View } from "react-native";
import Colors from "@/constants/colors";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";

SplashScreen.preventAutoHideAsync();
LogBox.ignoreLogs(["timeout exceeded"]);

const ONBOARDING_KEY = "tacoplan_onboarding_completed";

function AuthGate() {
  const { isLoading, isAuthenticated, isGuest } = useAuth();

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

  if (isGuest) {
    return (
      <PeriodProvider>
        <PeriodSetupGate />
      </PeriodProvider>
    );
  }

  return <OnboardingGate />;
}

function OnboardingGate() {
  const [checking, setChecking] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(ONBOARDING_KEY);
        if (raw) {
          const data = JSON.parse(raw);
          if (data.completed) {
            setNeedsOnboarding(false);
            setChecking(false);
            return;
          }
        }
        setNeedsOnboarding(true);
      } catch {
        setNeedsOnboarding(true);
      }
      setChecking(false);
    })();
  }, []);

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
    </>
  );
}

function loadWebFonts(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve();
      return;
    }
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap";
    link.rel = "stylesheet";
    link.onload = () => {
      const style = document.createElement("style");
      style.textContent = `
        [style*="Inter_400Regular"] { font-family: 'Inter', sans-serif !important; font-weight: 400 !important; }
        [style*="Inter_500Medium"] { font-family: 'Inter', sans-serif !important; font-weight: 500 !important; }
        [style*="Inter_600SemiBold"] { font-family: 'Inter', sans-serif !important; font-weight: 600 !important; }
        [style*="Inter_700Bold"] { font-family: 'Inter', sans-serif !important; font-weight: 700 !important; }
      `;
      document.head.appendChild(style);
      resolve();
    };
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
}

export default function RootLayout() {
  const [fontReady, setFontReady] = useState(false);

  useEffect(() => {
    async function loadFonts() {
      try {
        if (Platform.OS === "web") {
          await loadWebFonts();
        } else {
          await Font.loadAsync({
            Inter_400Regular,
            Inter_500Medium,
            Inter_600SemiBold,
            Inter_700Bold,
          });
        }
      } catch {
      }
      setFontReady(true);
    }
    loadFonts();
  }, []);

  useEffect(() => {
    if (fontReady) {
      SplashScreen.hideAsync();
    }
  }, [fontReady]);

  if (!fontReady) return null;

  return (
    <ErrorBoundary>
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView>
            <AuthProvider>
              <SyncProvider>
                <FerryProvider>
                  <AuthGate />
                  <SyncToastOverlay />
                </FerryProvider>
              </SyncProvider>
            </AuthProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </I18nProvider>
    </ErrorBoundary>
  );
}
