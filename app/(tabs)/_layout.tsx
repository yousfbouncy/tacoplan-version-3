import { Tabs } from "expo-router";
import { BlurView } from "expo-blur";
import { Platform, StyleSheet, useColorScheme, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import React from "react";

import Colors from "@/constants/colors";
import { useI18n } from "@/lib/i18n-context";

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
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
          backgroundColor: isIOS ? "transparent" : "#fff",
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: "#E5EAF0",
          elevation: 8,
          height: isWeb ? 84 : 76,
          paddingTop: 7,
          paddingBottom: isWeb ? 12 : 8,
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[
                StyleSheet.absoluteFill,
              { backgroundColor: "#fff" },
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
            <View style={[styles.iconWrap, focused && styles.iconWrapActive]}><Ionicons name="home-outline" size={size} color={focused ? "#fff" : (typeof color === "string" ? color : Colors.light.tint)} /></View>
          ),
        }}
      />
      <Tabs.Screen
        name="historial"
        options={{
          title: t("tabs.historial"),
          tabBarIcon: ({ color, size, focused }) => (
            <View style={[styles.iconWrap, focused && styles.iconWrapActive]}><Ionicons name="list-outline" size={size} color={focused ? "#fff" : (typeof color === "string" ? color : Colors.light.tint)} /></View>
          ),
        }}
      />
      <Tabs.Screen
        name="dietas"
        options={{
          title: t("tabs.dietas"),
          tabBarIcon: ({ color, size, focused }) => (
            <View style={[styles.iconWrap, focused && styles.iconWrapActive]}><Ionicons name="server-outline" size={size} color={focused ? "#fff" : (typeof color === "string" ? color : Colors.light.tint)} /></View>
          ),
        }}
      />
      <Tabs.Screen
        name="viajes"
        options={{
          title: t("tabs.viajes"),
          tabBarIcon: ({ color, size, focused }) => (
            <View style={[styles.iconWrap, focused && styles.iconWrapActive]}><Ionicons name="cube-outline" size={size} color={focused ? "#fff" : (typeof color === "string" ? color : Colors.light.tint)} /></View>
          ),
        }}
      />
      <Tabs.Screen
        name="usuario"
        options={{
          title: t("tabs.more"),
          tabBarIcon: ({ color, size, focused }) => (
            <View style={[styles.iconWrap, focused && styles.iconWrapActive]}><Ionicons name="ellipsis-horizontal" size={size} color={focused ? "#fff" : (typeof color === "string" ? color : Colors.light.tint)} /></View>
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
  iconWrap: { width: 40, height: 30, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  iconWrapActive: { backgroundColor: "#1478D4" },
});
