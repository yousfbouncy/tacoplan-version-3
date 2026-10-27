import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Tabs } from "expo-router";
import { BlurView } from "expo-blur";
import { Platform, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import React from "react";

import Colors from "@/constants/driver-theme";
import { useI18n } from "@/lib/i18n-context";

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const isIOS = Platform.OS === "ios";
  const { t } = useI18n();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.light.tint,
        tabBarInactiveTintColor: Colors.light.tabIconDefault,
        tabBarLabelStyle: {
          fontFamily: "Inter_500Medium",
          fontSize: 11,
        },
        tabBarStyle: {
          position: "absolute" as const,
          backgroundColor: isIOS ? "transparent" : Colors.light.background,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: Colors.light.border,
          elevation: 8,
          height: 62 + Math.max(insets.bottom, 12),
          paddingTop: 7,
          paddingBottom: Math.max(insets.bottom, 12),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={65}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[
                StyleSheet.absoluteFill,
              { backgroundColor: Colors.light.background },
              ]}
            />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tabs.dashboard"),
          tabBarIcon: ({ color, size, focused }) => (
            <View style={styles.iconWrap}>{focused && <LinearGradient colors={["#43BFFF", "#0876EC"]} style={[StyleSheet.absoluteFill, styles.iconWrapActive]} />}<Ionicons name="home-outline" size={size} color={focused ? "#FFFFFF" : (typeof color === "string" ? color : Colors.light.tint)} /></View>
          ),
        }}
      />
      <Tabs.Screen
        name="historial"
        options={{
          title: t("tabs.historial"),
          tabBarIcon: ({ color, size, focused }) => (
            <View style={styles.iconWrap}>{focused && <LinearGradient colors={["#43BFFF", "#0876EC"]} style={[StyleSheet.absoluteFill, styles.iconWrapActive]} />}<Ionicons name="list-outline" size={size} color={focused ? "#FFFFFF" : (typeof color === "string" ? color : Colors.light.tint)} /></View>
          ),
        }}
      />
      <Tabs.Screen
        name="dietas"
        options={{
          title: t("tabs.dietas"),
          tabBarIcon: ({ color, size, focused }) => (
            <View style={styles.iconWrap}>{focused && <LinearGradient colors={["#43BFFF", "#0876EC"]} style={[StyleSheet.absoluteFill, styles.iconWrapActive]} />}<Ionicons name="server-outline" size={size} color={focused ? "#FFFFFF" : (typeof color === "string" ? color : Colors.light.tint)} /></View>
          ),
        }}
      />
      <Tabs.Screen
        name="viajes"
        options={{
          title: t("tabs.viajes"),
          tabBarIcon: ({ color, size, focused }) => (
            <View style={styles.iconWrap}>{focused && <LinearGradient colors={["#43BFFF", "#0876EC"]} style={[StyleSheet.absoluteFill, styles.iconWrapActive]} />}<Ionicons name="cube-outline" size={size} color={focused ? "#FFFFFF" : (typeof color === "string" ? color : Colors.light.tint)} /></View>
          ),
        }}
      />
      <Tabs.Screen
        name="usuario"
        options={{
          title: t("tabs.more"),
          tabBarIcon: ({ color, size, focused }) => (
            <View style={styles.iconWrap}>{focused && <LinearGradient colors={["#43BFFF", "#0876EC"]} style={[StyleSheet.absoluteFill, styles.iconWrapActive]} />}<Ionicons name="ellipsis-horizontal" size={size} color={focused ? "#FFFFFF" : (typeof color === "string" ? color : Colors.light.tint)} /></View>
          ),
        }}
      />
      <Tabs.Screen
        name="tacografo"
        options={{
          title: t("tabs.tacografo"),
          href: null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="speedometer" size={size} color={typeof color === "string" ? color : Colors.light.tint} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: { width: 54, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  iconWrapActive: { borderRadius: 18 },
});
