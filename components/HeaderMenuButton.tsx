import React from "react";
import { Pressable, View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

/** Entrada al menú de Tacoplan en la cabecera, no como pestaña inferior. */
export default function HeaderMenuButton() {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Abrir menú de Tacoplan"
      onPress={() => router.push("/(tabs)/usuario")}
      hitSlop={8}
      style={({ pressed }) => ({
        minWidth: 44, height: 42, paddingHorizontal: 9, borderRadius: 12,
        flexDirection: "row", gap: 5, alignItems: "center", justifyContent: "center",
        borderWidth: 1, borderColor: "#517BA8", backgroundColor: "#112B4B",
        opacity: pressed ? 0.78 : 1,
      })}
    >
      <Ionicons name="menu-outline" size={21} color="#FFFFFF" />
      <Text style={{ color: "#FFFFFF", fontFamily: "Inter_600SemiBold", fontSize: 12 }}>Menú</Text>
    </Pressable>
  );
}
