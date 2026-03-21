import React from "react";
import { View, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSync } from "@/lib/sync-context";
import { useAuth } from "@/lib/auth-context";
import Colors from "@/constants/colors";

export default function SyncStatusBadge() {
  const { syncStatus } = useSync();
  const { isGuest } = useAuth();

  if (isGuest) return null;

  let iconName: keyof typeof Ionicons.glyphMap = "cloud-outline";
  let color = Colors.light.textSecondary;

  switch (syncStatus) {
    case "syncing":
      iconName = "cloud-upload-outline";
      color = Colors.light.warning;
      break;
    case "synced":
      iconName = "cloud-done-outline";
      color = Colors.light.success;
      break;
    case "error":
      iconName = "cloud-offline-outline";
      color = Colors.light.danger;
      break;
    case "offline":
      iconName = "cloud-offline-outline";
      color = Colors.light.textSecondary;
      break;
    default:
      iconName = "cloud-outline";
      color = Colors.light.textSecondary;
  }

  return (
    <View style={styles.container}>
      <Ionicons name={iconName} size={18} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginRight: 8,
  },
});
