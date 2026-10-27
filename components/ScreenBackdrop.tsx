import { StatusBar } from "expo-status-bar";
import React from "react";
import { StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
/** Decorative only: existing screens own their content and navigation. */
export default function ScreenBackdrop() {
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    <StatusBar style="light" />
    <LinearGradient colors={["#071426", "#102F50", "#0B2038", "#071426"]} locations={[0, 0.42, 0.72, 1]} style={{ height: 320 }} />
  </View>;
}
