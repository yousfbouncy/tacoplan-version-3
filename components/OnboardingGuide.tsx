import React, { useState, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  Modal,
  Pressable,
  Dimensions,
  ScrollView,
  Platform,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { useI18n } from "@/lib/i18n-context";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

interface Step {
  icon: string;
  iconFamily: "ionicons" | "mci";
  color: string;
  titleKey: string;
  descKey: string;
  tips: string[];
}

const STEPS: Step[] = [
  {
    icon: "speedometer-outline",
    iconFamily: "ionicons",
    color: Colors.light.tint,
    titleKey: "guide.step1Title",
    descKey: "guide.step1Desc",
    tips: ["guide.step1Tip1", "guide.step1Tip2", "guide.step1Tip3"],
  },
  {
    icon: "play-circle-outline",
    iconFamily: "ionicons",
    color: Colors.light.success,
    titleKey: "guide.step2Title",
    descKey: "guide.step2Desc",
    tips: ["guide.step2Tip1", "guide.step2Tip2", "guide.step2Tip3"],
  },
  {
    icon: "stop-circle-outline",
    iconFamily: "ionicons",
    color: Colors.light.danger,
    titleKey: "guide.step3Title",
    descKey: "guide.step3Desc",
    tips: ["guide.step3Tip1", "guide.step3Tip2", "guide.step3Tip3", "guide.step3Tip4"],
  },
  {
    icon: "bed-outline",
    iconFamily: "ionicons",
    color: Colors.light.descansoSemanal,
    titleKey: "guide.step4Title",
    descKey: "guide.step4Desc",
    tips: ["guide.step4Tip1", "guide.step4Tip2", "guide.step4Tip3"],
  },
  {
    icon: "list-outline",
    iconFamily: "ionicons",
    color: Colors.light.tint,
    titleKey: "guide.step5Title",
    descKey: "guide.step5Desc",
    tips: ["guide.step5Tip1", "guide.step5Tip2", "guide.step5Tip3"],
  },
  {
    icon: "cash-outline",
    iconFamily: "ionicons",
    color: Colors.light.accent,
    titleKey: "guide.step6Title",
    descKey: "guide.step6Desc",
    tips: ["guide.step6Tip1", "guide.step6Tip2", "guide.step6Tip3"],
  },
  {
    icon: "cube-outline",
    iconFamily: "ionicons",
    color: Colors.light.internacional,
    titleKey: "guide.step7Title",
    descKey: "guide.step7Desc",
    tips: ["guide.step7Tip1", "guide.step7Tip2", "guide.step7Tip3"],
  },
  {
    icon: "settings-outline",
    iconFamily: "ionicons",
    color: Colors.light.textSecondary,
    titleKey: "guide.step8Title",
    descKey: "guide.step8Desc",
    tips: ["guide.step8Tip1", "guide.step8Tip2", "guide.step8Tip3"],
  },
];

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function OnboardingGuide({ visible, onClose }: Props) {
  const { t } = useI18n();
  const [currentStep, setCurrentStep] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const step = STEPS[currentStep];
  const isFirst = currentStep === 0;
  const isLast = currentStep === STEPS.length - 1;

  const goNext = () => {
    if (isLast) {
      setCurrentStep(0);
      onClose();
    } else {
      const next = currentStep + 1;
      setCurrentStep(next);
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  };

  const goPrev = () => {
    if (!isFirst) {
      const prev = currentStep - 1;
      setCurrentStep(prev);
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  };

  const handleClose = () => {
    setCurrentStep(0);
    onClose();
  };

  const IconComponent = step.iconFamily === "mci" ? MaterialCommunityIcons : Ionicons;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{t("guide.title")}</Text>
            <Pressable onPress={handleClose} hitSlop={12}>
              <Ionicons name="close" size={24} color={Colors.light.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.progressRow}>
            {STEPS.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.progressDot,
                  i === currentStep && styles.progressDotActive,
                  i < currentStep && styles.progressDotDone,
                ]}
              />
            ))}
          </View>

          <Text style={styles.stepCounter}>
            {currentStep + 1} / {STEPS.length}
          </Text>

          <ScrollView
            ref={scrollRef}
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.iconCircle, { backgroundColor: step.color + "18" }]}>
              <IconComponent name={step.icon as any} size={48} color={step.color} />
            </View>

            <Text style={styles.stepTitle}>{t(step.titleKey)}</Text>
            <Text style={styles.stepDesc}>{t(step.descKey)}</Text>

            <View style={styles.tipsContainer}>
              {step.tips.map((tipKey, i) => (
                <View key={i} style={styles.tipRow}>
                  <View style={[styles.tipBullet, { backgroundColor: step.color }]}>
                    <Text style={styles.tipBulletText}>{i + 1}</Text>
                  </View>
                  <Text style={styles.tipText}>{t(tipKey)}</Text>
                </View>
              ))}
            </View>
          </ScrollView>

          <View style={styles.navRow}>
            {!isFirst ? (
              <Pressable style={styles.navBtnSecondary} onPress={goPrev}>
                <Ionicons name="chevron-back" size={18} color={Colors.light.tint} />
                <Text style={styles.navBtnSecondaryText}>{t("common.back")}</Text>
              </Pressable>
            ) : (
              <Pressable style={styles.navBtnSecondary} onPress={handleClose}>
                <Text style={styles.navBtnSecondaryText}>{t("guide.skip")}</Text>
              </Pressable>
            )}

            <Pressable style={styles.navBtnPrimary} onPress={goNext}>
              <Text style={styles.navBtnPrimaryText}>
                {isLast ? t("guide.finish") : t("guide.next")}
              </Text>
              {!isLast && <Ionicons name="chevron-forward" size={18} color="#fff" />}
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
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.light.text,
  },
  progressRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 4,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.light.border,
  },
  progressDotActive: {
    width: 24,
    backgroundColor: Colors.light.tint,
    borderRadius: 4,
  },
  progressDotDone: {
    backgroundColor: Colors.light.tint + "60",
  },
  stepCounter: {
    textAlign: "center",
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginBottom: 4,
  },
  scrollArea: {
    flexGrow: 0,
    flexShrink: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    alignItems: "center",
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
    marginTop: 8,
  },
  stepTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: Colors.light.text,
    textAlign: "center",
    marginBottom: 8,
  },
  stepDesc: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 20,
  },
  tipsContainer: {
    width: "100%",
    gap: 12,
  },
  tipRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  tipBullet: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
    marginTop: 1,
  },
  tipBulletText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#fff",
  },
  tipText: {
    fontSize: 14,
    color: Colors.light.text,
    lineHeight: 20,
    flex: 1,
  },
  navRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
    gap: 12,
  },
  navBtnSecondary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  navBtnSecondaryText: {
    fontSize: 15,
    color: Colors.light.tint,
    fontWeight: "600",
  },
  navBtnPrimary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.light.tint,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  navBtnPrimaryText: {
    fontSize: 15,
    color: "#fff",
    fontWeight: "600",
  },
});
