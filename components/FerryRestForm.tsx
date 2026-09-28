import React, { useState, useMemo, useCallback } from "react";
import {
  StyleSheet,
  Text,
  View,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  Alert,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { useI18n } from "@/lib/i18n-context";
import {
  validateFerryRest,
  computeFerryRestEnd,
  type FerryRest,
  type FerryInterruption,
} from "@/lib/ferryEngine";
import { addFerryRest, type FerryRestRecord } from "@/lib/local-storage";

interface Props {
  visible: boolean;
  onClose: () => void;
  onSaved?: (record: FerryRestRecord) => void;
}

function formatTimeHHMM(isoOrDate: string): string {
  const d = new Date(isoOrDate);
  if (isNaN(d.getTime())) return "--:--";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function validationReasonKey(reason: string): string {
  const map: Record<string, string> = {
    START_TIME_REQUIRED: "ferry.validation.noStartTime",
    INVALID_START_TIME: "ferry.validation.noStartTime",
    MAX_2_INTERRUPTIONS: "ferry.restForm.maxInterruptions",
    NEGATIVE_INTERRUPTION_TIME: "ferry.restForm.interruptionOrder",
    INTERRUPTION_END_BEFORE_START: "ferry.restForm.interruptionOrder",
    TOTAL_INTERRUPTIONS_EXCEED_60MIN: "ferry.restForm.maxTotalInterruption",
    OVERLAPPING_INTERRUPTIONS: "ferry.restForm.interruptionOverlap",
  };
  return map[reason] || reason;
}

export default function FerryRestForm({ visible, onClose, onSaved }: Props) {
  const { t } = useI18n();
  const [startHour, setStartHour] = useState(nowHHMM());
  const [restType, setRestType] = useState<"9h" | "11h">("9h");
  const [interruptions, setInterruptions] = useState<Array<{ startHH: string; endHH: string }>>([]);
  const [saving, setSaving] = useState(false);

  const fecha = todayStr();

  const parseMinutes = useCallback((hhmm: string): number => {
    const parts = hhmm.split(":");
    if (parts.length !== 2) return -1;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return -1;
    return h * 60 + m;
  }, []);

  const ferryRest = useMemo((): FerryRest => {
    const startIso = `${fecha}T${startHour}:00`;
    const ints: FerryInterruption[] = interruptions.map((i) => ({
      startMin: parseMinutes(i.startHH) >= 0 ? parseMinutes(i.startHH) : 0,
      endMin: parseMinutes(i.endHH) >= 0 ? parseMinutes(i.endHH) : 0,
    }));
    return { startTime: startIso, restType, interruptions: ints };
  }, [startHour, restType, interruptions, fecha, parseMinutes]);

  const validation = useMemo(() => validateFerryRest(ferryRest), [ferryRest]);

  const totalInterruptionMin = useMemo(() => {
    return ferryRest.interruptions.reduce((sum, i) => sum + Math.max(0, i.endMin - i.startMin), 0);
  }, [ferryRest.interruptions]);

  const addInterruption = () => {
    if (interruptions.length >= 2) return;
    setInterruptions((prev) => [...prev, { startHH: "", endHH: "" }]);
  };

  const removeInterruption = (idx: number) => {
    setInterruptions((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateInterruption = (idx: number, field: "startHH" | "endHH", value: string) => {
    setInterruptions((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item))
    );
  };

  const handleSave = async () => {
    if (!validation.valid) return;
    setSaving(true);
    try {
      const record = await addFerryRest({
        fecha,
        startTime: ferryRest.startTime,
        restType,
        interruptions: ferryRest.interruptions,
        interruptionTotalMin: totalInterruptionMin,
        endTime: validation.computedEnd || undefined,
        isValid: true,
        invalidReason: null,
      });
      onSaved?.(record);
      resetForm();
      onClose();
    } catch {
      Alert.alert(t("common.error"), t("ferry.restForm.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setStartHour(nowHHMM());
    setRestType("9h");
    setInterruptions([]);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{t("ferry.restForm.title")}</Text>
            <Pressable onPress={handleClose} hitSlop={12}>
              <Ionicons name="close" size={24} color={Colors.light.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>{t("ferry.restForm.startTime")}</Text>
              <View style={styles.timeInputRow}>
                <Ionicons name="time-outline" size={20} color={Colors.light.tint} />
                <TextInput
                  style={styles.timeInput}
                  value={startHour}
                  onChangeText={setStartHour}
                  placeholder="HH:MM"
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                />
                <Pressable
                  style={styles.nowBtn}
                  onPress={() => setStartHour(nowHHMM())}
                >
                  <Text style={styles.nowBtnText}>{t("common.now")}</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>{t("ferry.restForm.restType")}</Text>
              <View style={styles.segmentRow}>
                <Pressable
                  style={[styles.segment, restType === "9h" && styles.segmentActive]}
                  onPress={() => setRestType("9h")}
                >
                  <Ionicons
                    name="moon-outline"
                    size={18}
                    color={restType === "9h" ? "#fff" : Colors.light.textSecondary}
                  />
                  <Text
                    style={[styles.segmentText, restType === "9h" && styles.segmentTextActive]}
                  >
                    {t("ferry.restForm.rest9h")}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.segment, restType === "11h" && styles.segmentActive]}
                  onPress={() => setRestType("11h")}
                >
                  <Ionicons
                    name="bed-outline"
                    size={18}
                    color={restType === "11h" ? "#fff" : Colors.light.textSecondary}
                  />
                  <Text
                    style={[styles.segmentText, restType === "11h" && styles.segmentTextActive]}
                  >
                    {t("ferry.restForm.rest11h")}
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <View style={styles.sectionHeader}>
                <Text style={styles.label}>{t("ferry.restForm.interruptions")}</Text>
                <Text style={styles.interruptionCount}>
                  {totalInterruptionMin} / 60 {t("common.minutes")}
                </Text>
              </View>

              {interruptions.map((inter, idx) => (
                <View key={idx} style={styles.interruptionCard}>
                  <View style={styles.interruptionHeader}>
                    <Text style={styles.interruptionTitle}>
                      {t("ferry.restForm.interruptionNum")} {idx + 1}
                    </Text>
                    <Pressable onPress={() => removeInterruption(idx)} hitSlop={8}>
                      <Ionicons name="trash-outline" size={18} color={Colors.light.danger} />
                    </Pressable>
                  </View>
                  <View style={styles.interruptionFields}>
                    <View style={styles.interruptionField}>
                      <Text style={styles.smallLabel}>{t("ferry.restForm.interruptionStart")}</Text>
                      <TextInput
                        style={styles.timeInputSmall}
                        value={inter.startHH}
                        onChangeText={(v) => updateInterruption(idx, "startHH", v)}
                        placeholder="HH:MM"
                        keyboardType="numbers-and-punctuation"
                        maxLength={5}
                      />
                    </View>
                    <Ionicons
                      name="arrow-forward"
                      size={16}
                      color={Colors.light.textSecondary}
                      style={styles.arrowIcon}
                    />
                    <View style={styles.interruptionField}>
                      <Text style={styles.smallLabel}>{t("ferry.restForm.interruptionEnd")}</Text>
                      <TextInput
                        style={styles.timeInputSmall}
                        value={inter.endHH}
                        onChangeText={(v) => updateInterruption(idx, "endHH", v)}
                        placeholder="HH:MM"
                        keyboardType="numbers-and-punctuation"
                        maxLength={5}
                      />
                    </View>
                  </View>
                </View>
              ))}

              {interruptions.length < 2 && (
                <Pressable style={styles.addInterruptionBtn} onPress={addInterruption}>
                  <Ionicons name="add-circle-outline" size={20} color={Colors.light.tint} />
                  <Text style={styles.addInterruptionText}>
                    {t("ferry.restForm.addInterruption")}
                  </Text>
                </Pressable>
              )}
            </View>

            <View style={styles.resultCard}>
              <View style={styles.resultRow}>
                <View
                  style={[
                    styles.statusBadge,
                    validation.valid ? styles.statusValid : styles.statusInvalid,
                  ]}
                >
                  <Ionicons
                    name={validation.valid ? "checkmark-circle" : "alert-circle"}
                    size={16}
                    color={validation.valid ? Colors.light.success : Colors.light.danger}
                  />
                  <Text
                    style={[
                      styles.statusText,
                      { color: validation.valid ? Colors.light.success : Colors.light.danger },
                    ]}
                  >
                    {validation.valid
                      ? t("ferry.restForm.valid")
                      : t("ferry.restForm.invalid")}
                  </Text>
                </View>
              </View>

              {!validation.valid && validation.reason && (
                <Text style={styles.reasonText}>
                  {t(validationReasonKey(validation.reason))}
                </Text>
              )}

              {validation.valid && validation.computedEnd && (
                <View style={styles.computedEndRow}>
                  <Ionicons name="flag-outline" size={18} color={Colors.light.tint} />
                  <Text style={styles.computedEndLabel}>
                    {t("ferry.restForm.computedEnd")}:
                  </Text>
                  <Text style={styles.computedEndValue}>
                    {formatTimeHHMM(validation.computedEnd)}
                  </Text>
                </View>
              )}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Pressable style={styles.cancelBtn} onPress={handleClose}>
              <Ionicons name="close" size={18} color={Colors.light.tint} />
              <Text style={styles.cancelBtnText}>{t("common.cancel")}</Text>
            </Pressable>
            <Pressable
              style={[styles.saveBtn, (!validation.valid || saving) && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={!validation.valid || saving}
            >
              <Ionicons name="checkmark" size={18} color="#fff" />
              <Text style={styles.saveBtnText}>
                {saving ? t("common.loading") : t("ferry.restForm.save")}
              </Text>
            </Pressable>
          </View>
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
    padding: 16,
  },
  container: {
    backgroundColor: Colors.light.surface,
    borderRadius: 20,
    width: "100%",
    maxWidth: 420,
    maxHeight: "90%",
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700" as const,
    color: Colors.light.text,
  },
  scrollArea: {
    flexGrow: 0,
    flexShrink: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  fieldGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: "600" as const,
    color: Colors.light.text,
    marginBottom: 8,
  },
  timeInputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 12 : 4,
    gap: 10,
  },
  timeInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600" as const,
    color: Colors.light.text,
    letterSpacing: 1,
  },
  nowBtn: {
    backgroundColor: Colors.light.tint + "15",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  nowBtnText: {
    fontSize: 13,
    fontWeight: "600" as const,
    color: Colors.light.tint,
  },
  segmentRow: {
    flexDirection: "row",
    gap: 10,
  },
  segment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.light.background,
  },
  segmentActive: {
    backgroundColor: Colors.light.tint,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: "600" as const,
    color: Colors.light.textSecondary,
  },
  segmentTextActive: {
    color: "#fff",
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  interruptionCount: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    fontWeight: "500" as const,
  },
  interruptionCard: {
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  interruptionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  interruptionTitle: {
    fontSize: 13,
    fontWeight: "600" as const,
    color: Colors.light.text,
  },
  interruptionFields: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  interruptionField: {
    flex: 1,
  },
  smallLabel: {
    fontSize: 11,
    color: Colors.light.textSecondary,
    marginBottom: 4,
  },
  timeInputSmall: {
    backgroundColor: Colors.light.surface,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 10 : 6,
    fontSize: 16,
    fontWeight: "600" as const,
    color: Colors.light.text,
    textAlign: "center" as const,
    letterSpacing: 1,
  },
  arrowIcon: {
    marginBottom: Platform.OS === "ios" ? 12 : 10,
  },
  addInterruptionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.tint + "40",
    borderStyle: "dashed",
  },
  addInterruptionText: {
    fontSize: 14,
    color: Colors.light.tint,
    fontWeight: "500" as const,
  },
  resultCard: {
    backgroundColor: Colors.light.background,
    borderRadius: 14,
    padding: 16,
    marginBottom: 8,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusValid: {
    backgroundColor: Colors.light.success + "15",
  },
  statusInvalid: {
    backgroundColor: Colors.light.danger + "15",
  },
  statusText: {
    fontSize: 13,
    fontWeight: "600" as const,
  },
  reasonText: {
    fontSize: 13,
    color: Colors.light.danger,
    marginTop: 8,
    lineHeight: 18,
  },
  computedEndRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  computedEndLabel: {
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  computedEndValue: {
    fontSize: 20,
    fontWeight: "700" as const,
    color: Colors.light.tint,
    letterSpacing: 1,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
    gap: 12,
  },
  cancelBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  cancelBtnText: {
    fontSize: 15,
    color: Colors.light.tint,
    fontWeight: "600" as const,
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.light.tint,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveBtnText: {
    fontSize: 15,
    color: "#fff",
    fontWeight: "600" as const,
  },
});
