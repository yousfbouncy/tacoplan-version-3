import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import Colors from "@/constants/colors";
import NotificationActionButton from "@/components/notifications/NotificationActionButton";
import { getNotificationActions, openNotificationUrl } from "@/lib/notification-links";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";

type Question = {
  id: string;
  label: string;
  type: "choice" | "text";
  options?: string[];
  required?: boolean;
};
type NotificationForm = { kind: "survey" | "form"; questions: Question[] };

type Props = {
  visible: boolean;
  title: string;
  body: string;
  buttonText?: string | null;
  buttonUrl?: string | null;
  data?: any;
  notificationId?: string | null;
  onClose: () => void;
};

function readForm(data: any): NotificationForm | null {
  const value = data?.form;
  if (!value || (value.kind !== "form" && value.kind !== "survey") ||
    !Array.isArray(value.questions) || !value.questions.length || value.questions.length > 6) return null;
  const questions: Question[] = value.questions.filter((q: any) =>
    q && typeof q.id === "string" && typeof q.label === "string" &&
    (q.type === "text" || q.type === "choice")
  );
  return questions.length === value.questions.length ? { kind: value.kind, questions } : null;
}

export default function NotificationDetailModal({
  visible, title, body, buttonText, buttonUrl, data, notificationId, onClose,
}: Props) {
  const { user } = useAuth();
  const actions = getNotificationActions({ button_text: buttonText, button_url: buttonUrl, data });
  const form = readForm(data);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setAnswers({});
    setSubmitted(false);
    setError("");
    if (!visible || !form || !notificationId || !user?.id) return;
    let active = true;
    setChecking(true);
    void supabase.from("notification_form_responses").select("id")
      .eq("notification_id", notificationId).eq("user_id", user.id).maybeSingle()
      .then(({ data: previous, error: readError }) => {
        if (!active) return;
        if (!readError && previous?.id) setSubmitted(true);
      }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [visible, notificationId, user?.id]);

  const submit = useCallback(async () => {
    if (!notificationId || !user?.id || !form || saving) return;
    for (const question of form.questions) {
      if (question.required && !String(answers[question.id] || "").trim()) {
        setError("Completa las preguntas obligatorias para enviar.");
        return;
      }
    }
    setSaving(true);
    setError("");
    const { error: submitError } = await supabase.rpc("tacoplan_submit_notification_form", {
      p_notification_id: notificationId,
      p_answers: answers,
    });
    if (submitError) setError(submitError.message || "No se pudo enviar el formulario.");
    else setSubmitted(true);
    setSaving(false);
  }, [answers, form, notificationId, saving, user?.id]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.overlay}>
        <View style={styles.card}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.eyebrow}>{form?.kind === "survey" ? "ENCUESTA" : form ? "FORMULARIO" : "NOTIFICACIÓN"}</Text>
            <Text style={styles.title}>{title || "Notificación"}</Text>
            <Text style={styles.body}>{body || ""}</Text>

            {form ? (
              checking ? <ActivityIndicator color={Colors.light.tint} style={{ marginVertical: 15 }} /> :
              submitted ? <View style={styles.success}><Text style={styles.successText}>Respuesta enviada correctamente. Gracias por participar.</Text></View> :
              <View style={styles.questionList}>
                {form.questions.map((q, index) => (
                  <View key={q.id} style={styles.question}>
                    <Text style={styles.questionLabel}>{index + 1}. {q.label}{q.required ? " *" : ""}</Text>
                    {q.type === "choice" ? (
                      <View style={styles.choiceList}>
                        {(q.options || []).map((option, indexOption) => (
                          <Pressable key={indexOption} accessibilityRole="radio"
                            accessibilityState={{ checked: answers[q.id] === option }}
                            style={[styles.choice, answers[q.id] === option && styles.choiceSelected]}
                            onPress={() => setAnswers(prev => ({ ...prev, [q.id]: option }))}>
                            <Text style={styles.choiceText}>{answers[q.id] === option ? "●" : "○"}  {option}</Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : (
                      <TextInput multiline textAlignVertical="top" maxLength={1000}
                        value={answers[q.id] || ""}
                        onChangeText={text => setAnswers(prev => ({ ...prev, [q.id]: text }))}
                        style={styles.textarea} placeholder="Escribe tu respuesta..." placeholderTextColor="#94A3B8" />
                    )}
                  </View>
                ))}
                {!!error && <Text style={styles.error}>{error}</Text>}
                <NotificationActionButton label={saving ? "Enviando..." : "Enviar respuestas"}
                  onPress={() => { if (!saving) void submit(); }} />
              </View>
            ) : null}

            <View style={styles.actions}>
              {actions.map((action, index) => (
                <NotificationActionButton key={index} label={action.label}
                  onPress={async () => {
                    const opened = await openNotificationUrl(action.url);
                    if (opened) onClose();
                  }} />
              ))}
              <Pressable style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.9 }]} onPress={onClose}>
                <Text style={styles.secondaryBtnText}>Cerrar</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.58)", justifyContent: "center", alignItems: "center", padding: 20 },
  card: { backgroundColor: "#fff", borderRadius: 18, padding: 23, width: "100%", maxWidth: 460, maxHeight: "88%",
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 8 },
  eyebrow: { color: Colors.light.tint, fontSize: 11, fontFamily: "Inter_700Bold", marginBottom: 9 },
  title: { fontSize: 19, fontFamily: "Inter_700Bold", color: Colors.light.text, marginBottom: 9 },
  body: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#374151", lineHeight: 21, marginBottom: 16 },
  questionList: { gap: 14, marginBottom: 16 },
  question: { gap: 8 },
  questionLabel: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#0F172A" },
  choiceList: { gap: 7 },
  choice: { borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 10, padding: 12, backgroundColor: "#F8FAFC" },
  choiceSelected: { borderColor: "#2563EB", backgroundColor: "#EFF6FF" },
  choiceText: { fontSize: 13, color: "#334155" },
  textarea: { minHeight: 78, borderWidth: 1, borderRadius: 10, borderColor: "#CBD5E1", padding: 11,
    fontSize: 14, color: "#0F172A" },
  actions: { gap: 10, marginTop: 12 },
  success: { padding: 14, backgroundColor: "#EFFCF4", borderRadius: 11, marginBottom: 12 },
  successText: { color: "#166534", fontFamily: "Inter_600SemiBold" },
  error: { color: "#B91C1C", fontSize: 12 },
  secondaryBtn: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: Colors.light.border,
    backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  secondaryBtnText: { fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.light.textSecondary },
});
