import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  TextInput,
  StyleSheet,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { PeriodMode, PeriodConfig, usePeriod, computeRange } from "@/lib/period-context";
import { useI18n } from "@/lib/i18n-context";

export default function PeriodSetupModal({ visible }: { visible: boolean }) {
  const { saveConfig } = usePeriod();
  const { t } = useI18n();
  const [mode, setMode] = useState<PeriodMode>("AUTO_01_30");
  const [manualFrom, setManualFrom] = useState("1");
  const [manualTo, setManualTo] = useState("30");

  const preview = computeRange(
    mode,
    parseInt(manualFrom, 10) || 1,
    parseInt(manualTo, 10) || 30
  );

  const handleSave = async () => {
    const cfg: PeriodConfig = {
      mode,
      manualFrom: parseInt(manualFrom, 10) || 1,
      manualTo: parseInt(manualTo, 10) || 30,
    };
    await saveConfig(cfg);
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Ionicons name="calendar" size={28} color={Colors.light.tint} />
            <Text style={styles.title}>{t("period.title")}</Text>
          </View>
          <Text style={styles.subtitle}>
            {t("period.desc")}
          </Text>

          <Pressable
            style={[styles.option, mode === "AUTO_01_30" && styles.optionSelected]}
            onPress={() => setMode("AUTO_01_30")}
          >
            <Ionicons
              name={mode === "AUTO_01_30" ? "radio-button-on" : "radio-button-off"}
              size={22}
              color={mode === "AUTO_01_30" ? Colors.light.tint : "#9CA3AF"}
            />
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>{t("period.auto0130")} {t("period.recommended")}</Text>
              <Text style={styles.optionDesc}>{t("period.auto0130Desc")}</Text>
            </View>
          </Pressable>

          <Pressable
            style={[styles.option, mode === "AUTO_20_20" && styles.optionSelected]}
            onPress={() => setMode("AUTO_20_20")}
          >
            <Ionicons
              name={mode === "AUTO_20_20" ? "radio-button-on" : "radio-button-off"}
              size={22}
              color={mode === "AUTO_20_20" ? Colors.light.tint : "#9CA3AF"}
            />
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>{t("period.auto2020")}</Text>
              <Text style={styles.optionDesc}>{t("period.auto2020Desc")}</Text>
            </View>
          </Pressable>

          <Pressable
            style={[styles.option, mode === "MANUAL" && styles.optionSelected]}
            onPress={() => setMode("MANUAL")}
          >
            <Ionicons
              name={mode === "MANUAL" ? "radio-button-on" : "radio-button-off"}
              size={22}
              color={mode === "MANUAL" ? Colors.light.tint : "#9CA3AF"}
            />
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>{t("period.manual")}</Text>
              <Text style={styles.optionDesc}>{t("period.manualDesc")}</Text>
            </View>
          </Pressable>

          {mode === "MANUAL" && (
            <View style={styles.manualRow}>
              <Text style={styles.manualLabel}>{t("period.fromDayLabel")}</Text>
              <TextInput
                style={styles.manualInput}
                value={manualFrom}
                onChangeText={(v) => setManualFrom(v.replace(/[^0-9]/g, ""))}
                keyboardType="number-pad"
                maxLength={2}
                selectTextOnFocus
              />
              <Text style={styles.manualLabel}>{t("period.toDayLabel")}</Text>
              <TextInput
                style={styles.manualInput}
                value={manualTo}
                onChangeText={(v) => setManualTo(v.replace(/[^0-9]/g, ""))}
                keyboardType="number-pad"
                maxLength={2}
                selectTextOnFocus
              />
            </View>
          )}

          <View style={styles.previewBox}>
            <Text style={styles.previewLabel}>{t("period.previewLabel")}</Text>
            <Text style={styles.previewValue}>{preview.label}</Text>
          </View>

          <Pressable
            style={({ pressed }) => [styles.saveBtn, { opacity: pressed ? 0.85 : 1 }]}
            onPress={handleSave}
          >
            <Ionicons name="checkmark-circle" size={20} color="#fff" />
            <Text style={styles.saveBtnText}>{t("common.confirm")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 400,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  title: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#6B7280",
    marginBottom: 16,
    lineHeight: 20,
  },
  option: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    marginBottom: 10,
  },
  optionSelected: {
    borderColor: Colors.light.tint,
    backgroundColor: `${Colors.light.tint}08`,
  },
  optionText: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
  },
  optionDesc: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#6B7280",
    marginTop: 2,
  },
  manualRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  manualLabel: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: Colors.light.text,
  },
  manualInput: {
    borderWidth: 1.5,
    borderColor: Colors.light.tint,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    width: 48,
    textAlign: "center",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
  },
  previewBox: {
    backgroundColor: "#F0F9FF",
    borderRadius: 8,
    padding: 12,
    marginTop: 4,
    marginBottom: 16,
  },
  previewLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#6B7280",
  },
  previewValue: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.tint,
    marginTop: 2,
  },
  saveBtn: {
    backgroundColor: Colors.light.tint,
    borderRadius: 10,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  saveBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
});
