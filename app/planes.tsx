import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Colors from "@/constants/colors";
import { WEB_HIDE_BILLING_UI } from "@/lib/utils";

export default function PlanesScreen() {
  const hidden = Platform.OS === "web" && WEB_HIDE_BILLING_UI;

  if (hidden) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Planes próximamente</Text>
        <Text style={styles.desc}>Tacoplan está actualmente en fase beta gratuita.</Text>
        <Pressable
          style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
          onPress={() => router.replace("/")}
        >
          <Text style={styles.btnText}>Volver al inicio</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Planes</Text>
      <Text style={styles.desc}>Página en construcción.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: Colors.light.background,
  },
  title: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
    textAlign: "center",
  },
  desc: {
    marginTop: 10,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    textAlign: "center",
    maxWidth: 460,
  },
  btn: {
    marginTop: 18,
    backgroundColor: Colors.light.tint,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  btnText: {
    color: "#fff",
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
});

