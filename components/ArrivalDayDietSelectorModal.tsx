import React, { useState, useMemo, memo, useEffect } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { findRate, loadDietDerivationContext, type NaturalDayDietType } from "@/lib/local-storage";

type DietPercentage = 100 | 60 | 30;

export interface ArrivalDayDietSelectorModalProps {
  visible: boolean;
  day: null | {
    date: string;
    type: NaturalDayDietType;
    location?: string | null;
    arrivalTime?: string | null;
    routeLabel?: string;
  };
  onClose: () => void;
  onConfirm: (choice: { percentage: DietPercentage | null; amount: number }) => Promise<void> | void;
  loading?: boolean;
}

const normalizeFechaES = (fechaISO: string): string => {
  const [year, month, day] = fechaISO.split("-");
  return `${day}/${month}/${year}`;
};

const getTypePillStyle = (type: NaturalDayDietType) => {
  switch (type) {
    case "INTERNACIONAL":
      return { backgroundColor: "#FEF3C7", color: "#92400E" };
    case "NACIONAL":
    case "REGIONAL":
      return { backgroundColor: "#EEF2FF", color: "#3730A3" };
  }
};

function ArrivalDayDietSelectorModal({
  visible,
  day,
  onClose,
  onConfirm,
  loading = false,
}: ArrivalDayDietSelectorModalProps) {
  const [selectedPct, setSelectedPct] = useState<DietPercentage | 0>(100);
  const [customRates, setCustomRates] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (visible) {
      setSelectedPct(100);
      (async () => {
        try {
          const ctx = await loadDietDerivationContext();
          if (!cancelled && ctx && ctx.customRates) setCustomRates(ctx.customRates);
        } catch {}
      })();
    }
    return () => { cancelled = true; };
  }, [visible, day?.date]);

  const options = useMemo(() => {
    if (!day) return [] as Array<{ pct: DietPercentage; amount: number }>;
    const calc = (p: DietPercentage) => {
      try {
        return findRate(customRates || [], day.type, p);
      } catch {
        return 0;
      }
    };
    return ([100, 60, 30] as DietPercentage[]).map((pct) => ({ pct, amount: calc(pct) }));
  }, [customRates, day]);

  const amountForSelected = useMemo(() => {
    if (selectedPct === 0) return 0;
    return options.find((o) => o.pct === selectedPct)?.amount ?? 0;
  }, [selectedPct, options]);

  const handleConfirm = () => {
    const percentage = selectedPct === 0 ? null : (selectedPct as DietPercentage);
    const amount = percentage == null ? 0 : (options.find(o => o.pct === percentage)?.amount ?? 0);
    onConfirm({ percentage, amount });
  };

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible && Boolean(day)}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <Ionicons
                name="car-sport-outline"
                size={24}
                color={Colors.light.tint}
              />
              <Text style={styles.title}>Dieta del día {day ? normalizeFechaES(day.date) : ""}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons
                name="close-circle-outline"
                size={26}
                color={Colors.light.textSecondary}
              />
            </Pressable>
          </View>

          {day ? (
            <>
              <View style={styles.headerInfo}>
                <View style={[styles.typePill, { backgroundColor: getTypePillStyle(day.type).backgroundColor }]}>
                  <Text style={[styles.typePillText, { color: getTypePillStyle(day.type).color }]}>
                    {day.routeLabel || day.type}
                  </Text>
                </View>
                {day.location ? (
                  <Text style={styles.locationLine}>📍 {day.location}</Text>
                ) : null}
                {day.arrivalTime ? (
                  <Text style={styles.locationLine}>
                    Llegada a base: {day.arrivalTime}
                  </Text>
                ) : null}
              </View>

              <Text style={styles.questionText}>
                Selecciona el porcentaje de dieta que corresponde a este día de regreso a base:
              </Text>

              <View style={styles.optionsWrap}>
                {options.map(({ pct, amount }) => {
                  const isActive = selectedPct === pct;
                  return (
                    <Pressable
                      key={pct}
                      onPress={() => setSelectedPct(pct)}
                      style={({ pressed }) => [
                        styles.optionCard,
                        isActive && styles.optionCardActive,
                        { opacity: (pressed && !loading) ? 0.9 : 1 },
                      ]}
                      disabled={loading}
                    >
                      <Text style={[styles.optionPct, isActive && { color: Colors.light.tint }]}>
                        {pct}%
                      </Text>
                      <Text style={[styles.optionAmount, isActive && { color: Colors.light.tint }]}>
                        {amount.toFixed(2)} €
                      </Text>
                      {isActive && (
                        <View style={styles.checkActive}>
                          <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                        </View>
                      )}
                    </Pressable>
                  );
                })}
                <Pressable
                  onPress={() => setSelectedPct(0)}
                  style={({ pressed }) => [
                    styles.optionCard,
                    styles.optionNone,
                    selectedPct === 0 && styles.optionCardActive,
                    { opacity: (pressed && !loading) ? 0.9 : 1 },
                  ]}
                  disabled={loading}
                >
                  <Text style={[styles.optionPct, selectedPct === 0 && { color: Colors.light.tint }]}>
                    Sin dieta
                  </Text>
                  <Text style={[styles.optionAmount, selectedPct === 0 && { color: Colors.light.tint }]}>
                    0,00 €
                  </Text>
                  {selectedPct === 0 && (
                    <View style={styles.checkActive}>
                      <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                    </View>
                  )}
                </Pressable>
              </View>

              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Importe seleccionado</Text>
                <Text style={styles.summaryValue}>{amountForSelected.toFixed(2)} €</Text>
              </View>

              <View style={styles.buttonsRow}>
                <Pressable
                  style={({ pressed }) => [
                    styles.cancelBtn,
                    { opacity: pressed || loading ? 0.85 : 1 },
                  ]}
                  onPress={onClose}
                  disabled={loading}
                >
                  <Text style={styles.cancelBtnText}>Cancelar</Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.confirmBtn,
                    loading && { opacity: 0.6 },
                    { opacity: (pressed && !loading) ? 0.85 : 1 },
                  ]}
                  onPress={handleConfirm}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.confirmBtnText}>Guardar dieta</Text>
                  )}
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15,20,30,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    backgroundColor: "#FFFFFF",
    width: "92%",
    maxWidth: 520,
    borderRadius: 16,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    color: Colors.light.text,
    flex: 1,
  },
  headerInfo: {
    backgroundColor: "#F8F9FA",
    borderRadius: 12,
    padding: 12,
    gap: 6,
    marginBottom: 16,
  },
  typePill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  typePillText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  locationLine: {
    fontSize: 13,
    color: Colors.light.text,
    opacity: 0.85,
  },
  questionText: {
    fontSize: 14,
    color: Colors.light.text,
    opacity: 0.9,
    marginBottom: 12,
    lineHeight: 20,
  },
  optionsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 8,
  },
  optionCard: {
    flexBasis: "48%",
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#F5F6F8",
    borderWidth: 1.5,
    borderColor: "transparent",
    position: "relative",
  },
  optionNone: {
    flexBasis: "100%",
    borderStyle: "dashed",
    borderColor: "#CBD5E1",
    backgroundColor: "#FFFFFF",
  },
  optionCardActive: {
    borderColor: Colors.light.tint,
    backgroundColor: "#F1F5F9",
  },
  optionPct: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.light.text,
  },
  optionAmount: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    marginTop: 4,
  },
  checkActive: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.light.tint,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.1)",
    marginTop: 12,
    paddingTop: 14,
  },
  summaryLabel: {
    fontSize: 14,
    color: Colors.light.text,
    opacity: 0.7,
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: "bold",
    color: Colors.light.text,
  },
  buttonsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 18,
    gap: 10,
  },
  cancelBtn: {
    flex: 0.45,
    backgroundColor: Colors.light.border,
    opacity: 0.35,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.light.text,
  },
  confirmBtn: {
    flex: 0.55,
    backgroundColor: Colors.light.tint,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFFFFF",
    textAlign: "center",
  },
});

export default memo(ArrivalDayDietSelectorModal);
