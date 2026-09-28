import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, TouchableOpacity, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSync } from "@/lib/sync-context";
import Colors from "@/constants/colors";

export default function SyncToast() {
  const { syncToast, dismissToast } = useSync();
  const insets = useSafeAreaInsets();
  const topOffset = Platform.OS === "web" ? 67 : insets.top + 10;
  const translateY = useRef(new Animated.Value(-100)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (syncToast?.visible) {
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 80,
          friction: 10,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: -100,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [syncToast?.visible]);

  if (!syncToast) return null;

  const bgColor = syncToast.type === "error" ? Colors.light.danger
    : syncToast.type === "info" ? Colors.light.tint
    : Colors.light.success;

  const iconName = syncToast.type === "error" ? "cloud-offline-outline"
    : syncToast.type === "info" ? "information-circle-outline"
    : "cloud-done-outline";

  return (
    <Animated.View
      style={[
        styles.container,
        {
          top: topOffset,
          backgroundColor: bgColor,
          transform: [{ translateY }],
          opacity,
        },
      ]}
      pointerEvents="box-none"
    >
      <TouchableOpacity style={styles.content} onPress={dismissToast} activeOpacity={0.8}>
        <Ionicons name={iconName as any} size={18} color="#fff" />
        <Text style={styles.text} numberOfLines={2}>{syncToast.message}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 20,
    right: 20,
    borderRadius: 12,
    zIndex: 9999,
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  text: {
    color: "#fff",
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    flex: 1,
  },
});
