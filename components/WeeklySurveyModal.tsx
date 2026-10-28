import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n-context";
import { supabase } from "@/lib/supabase";

type Satisfaction = "muy_bien" | "bien" | "regular" | "mal";
type Difficulty = "ninguno" | "dificil" | "errores" | "funciones";
type Language = "es" | "en" | "fr" | "ar";

const COPY = {
  es: {
    eyebrow: "ENCUESTA SEMANAL",
    title: "¿Qué tal va Tacoplan?",
    subtitle: "Tu opinión nos ayuda a mejorar la aplicación. Solo te lo preguntaremos una vez por semana.",
    satisfaction: "1. ¿Cómo valoras Tacoplan?",
    difficulty: "2. ¿Has tenido alguna dificultad?",
    suggestion: "3. ¿Qué mejorarías? (opcional)",
    placeholder: "Escribe tu opinión, propuesta o recomendación...",
    send: "Enviar valoración y continuar",
    sending: "Guardando...",
    error: "No se ha podido guardar la respuesta. Comprueba la conexión y vuelve a intentarlo.",
    footer: "Completa las dos primeras preguntas para continuar.",
    veryGood: "😍 Muy buena",
    good: "🙂 Buena",
    regular: "😐 Regular",
    bad: "😞 No era lo esperado",
    noProblem: "Funciona bien",
    hard: "Me cuesta usarla",
    bugs: "He encontrado errores",
    missing: "Me faltan funciones",
  },
  en: {
    eyebrow: "WEEKLY SURVEY",
    title: "How is Tacoplan going?",
    subtitle: "Your feedback helps us improve. We will ask only once per week.",
    satisfaction: "1. How would you rate Tacoplan?",
    difficulty: "2. Have you had any difficulties?",
    suggestion: "3. What would you improve? (optional)",
    placeholder: "Share your opinion or suggestion...",
    send: "Submit feedback and continue",
    sending: "Saving...",
    error: "We could not save your response. Check your connection and try again.",
    footer: "Answer the first two questions to continue.",
    veryGood: "😍 Very good",
    good: "🙂 Good",
    regular: "😐 Average",
    bad: "😞 Not what I expected",
    noProblem: "Works well",
    hard: "Difficult to use",
    bugs: "I found errors",
    missing: "Missing features",
  },
  fr: {
    eyebrow: "ENQUÊTE HEBDOMADAIRE",
    title: "Votre avis sur Tacoplan ?",
    subtitle: "Votre avis nous aide à progresser. Une seule demande par semaine.",
    satisfaction: "1. Comment évaluez-vous Tacoplan ?",
    difficulty: "2. Avez-vous rencontré des difficultés ?",
    suggestion: "3. Que souhaitez-vous améliorer ? (facultatif)",
    placeholder: "Votre avis ou suggestion...",
    send: "Envoyer et continuer",
    sending: "Enregistrement...",
    error: "Impossible d'enregistrer la réponse. Vérifiez la connexion et réessayez.",
    footer: "Répondez aux deux premières questions pour continuer.",
    veryGood: "😍 Très bonne",
    good: "🙂 Bonne",
    regular: "😐 Moyenne",
    bad: "😞 Décevante",
    noProblem: "Tout fonctionne",
    hard: "Difficile à utiliser",
    bugs: "J'ai trouvé des erreurs",
    missing: "Fonctions manquantes",
  },
  ar: {
    eyebrow: "استبيان أسبوعي",
    title: "ما رأيك في Tacoplan؟",
    subtitle: "رأيك يساعدنا على تحسين التطبيق. سنسألك مرة واحدة فقط كل أسبوع.",
    satisfaction: "١. كيف تقيم Tacoplan؟",
    difficulty: "٢. هل واجهت صعوبات؟",
    suggestion: "٣. ماذا تقترح لتحسينه؟ (اختياري)",
    placeholder: "اكتب رأيك أو اقتراحك...",
    send: "إرسال التقييم والمتابعة",
    sending: "جارٍ الحفظ...",
    error: "تعذر حفظ الإجابة. تحقق من الاتصال ثم حاول مجددًا.",
    footer: "أجب عن السؤالين الأولين للمتابعة.",
    veryGood: "😍 جيد جدًا",
    good: "🙂 جيد",
    regular: "😐 متوسط",
    bad: "😞 أقل من المتوقع",
    noProblem: "يعمل جيدًا",
    hard: "يصعب استخدامه",
    bugs: "وجدت أخطاء",
    missing: "تنقصه ميزات",
  },
} as const;

// Monday 00:00 in the device's local time. The server timestamp is stored in UTC,
// but comparison uses the user's local calendar week.
function thisWeekStartedAt(): number {
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - day).getTime();
}

export default function WeeklySurveyModal({ enabled }: { enabled: boolean }) {
  const { user } = useAuth();
  const { locale } = useI18n();
  const language: Language = locale === "en" || locale === "fr" || locale === "ar" ? locale : "es";
  const copy = COPY[language];
  const rightToLeft = language === "ar";

  const [visible, setVisible] = useState(false);
  const [satisfaction, setSatisfaction] = useState<Satisfaction | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [suggestion, setSuggestion] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const checkId = useRef(0);
  const savingRef = useRef(false);

  const checkWeeklyResponse = useCallback(async () => {
    const id = ++checkId.current;
    if (!enabled || !user?.id) {
      setVisible(false);
      return;
    }
    if (savingRef.current) return;

    const { data, error: queryError } = await supabase
      .from("tacoplan_survey_responses")
      .select("updated_at")
      .eq("user_id", user.id)
      .maybeSingle();

    // A temporary network error must never trap a driver in an unusable app.
    // Check again next time the app comes to the foreground.
    if (queryError || id !== checkId.current || savingRef.current) return;

    const lastResponse = data?.updated_at ? new Date(data.updated_at).getTime() : 0;
    setVisible(!Number.isFinite(lastResponse) || lastResponse < thisWeekStartedAt());
  }, [enabled, user?.id]);

  useEffect(() => {
    void checkWeeklyResponse();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void checkWeeklyResponse();
    });
    return () => {
      checkId.current += 1;
      listener.remove();
    };
  }, [checkWeeklyResponse]);

  const submit = useCallback(async () => {
    if (!user?.id || !satisfaction || !difficulty || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const { error: saveError } = await supabase.rpc("tacoplan_submit_survey", {
        p_satisfaction: satisfaction,
        p_difficulty: difficulty,
        p_suggestion: suggestion.trim().slice(0, 2000),
      });
      if (saveError) throw saveError;
      checkId.current += 1;
      setVisible(false);
      setSatisfaction(null);
      setDifficulty(null);
      setSuggestion("");
    } catch {
      setError(copy.error);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [user?.id, satisfaction, difficulty, suggestion, copy.error]);

  return (
    <Modal
      visible={visible && enabled}
      animationType="fade"
      transparent
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={() => { /* Required survey: hardware back cannot dismiss it. */ }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.backdrop}
      >
        <View style={styles.card}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.iconCircle}>
              <Ionicons name="chatbubble-ellipses-outline" color="#6CB9FF" size={26} />
            </View>
            <Text style={[styles.eyebrow, rightToLeft && styles.rtl]}>{copy.eyebrow}</Text>
            <Text style={[styles.title, rightToLeft && styles.rtl]}>{copy.title}</Text>
            <Text style={[styles.subtitle, rightToLeft && styles.rtl]}>{copy.subtitle}</Text>

            <Text style={[styles.question, rightToLeft && styles.rtl]}>{copy.satisfaction}</Text>
            <View style={styles.choices}>
              {([
                ["muy_bien", copy.veryGood],
                ["bien", copy.good],
                ["regular", copy.regular],
                ["mal", copy.bad],
              ] as const).map(([value, label]) => (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: satisfaction === value }}
                  style={[styles.option, satisfaction === value && styles.selected]}
                  onPress={() => setSatisfaction(value)}
                >
                  <Text style={styles.optionLabel}>{label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.question, rightToLeft && styles.rtl]}>{copy.difficulty}</Text>
            <View style={styles.choices}>
              {([
                ["ninguno", copy.noProblem],
                ["dificil", copy.hard],
                ["errores", copy.bugs],
                ["funciones", copy.missing],
              ] as const).map(([value, label]) => (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: difficulty === value }}
                  style={[styles.option, difficulty === value && styles.selected]}
                  onPress={() => setDifficulty(value)}
                >
                  <Text style={styles.optionLabel}>{label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.question, rightToLeft && styles.rtl]}>{copy.suggestion}</Text>
            <TextInput
              accessibilityLabel={copy.suggestion}
              value={suggestion}
              onChangeText={setSuggestion}
              multiline
              maxLength={2000}
              textAlignVertical="top"
              placeholder={copy.placeholder}
              placeholderTextColor="#8394AB"
              style={[styles.textarea, rightToLeft && styles.rtl]}
            />
            {!!error && <Text style={styles.error}>{error}</Text>}
            <Text style={[styles.footer, rightToLeft && styles.rtl]}>{copy.footer}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !satisfaction || !difficulty || saving }}
              disabled={!satisfaction || !difficulty || saving}
              onPress={() => void submit()}
              style={[styles.button, (!satisfaction || !difficulty || saving) && styles.buttonDisabled]}
            >
              {saving ? <ActivityIndicator color="#FFF" size="small" /> : (
                <Text style={styles.buttonText}>{copy.send}</Text>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(1, 8, 19, 0.86)",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  card: {
    width: "100%",
    maxWidth: 480,
    maxHeight: "94%",
    borderRadius: 24,
    paddingVertical: 25,
    paddingHorizontal: 22,
    backgroundColor: "#101C2D",
    borderWidth: 1,
    borderColor: "#2B4562",
  },
  iconCircle: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: "#173653",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  eyebrow: { color: "#67B6FF", fontSize: 10, letterSpacing: 1.7, fontWeight: "800" },
  title: { color: "#F7FAFE", fontSize: 24, fontWeight: "800", marginTop: 7 },
  subtitle: { color: "#A7B7CC", fontSize: 13, lineHeight: 20, marginTop: 9, marginBottom: 7 },
  question: { color: "#F6F9FF", fontSize: 14, fontWeight: "700", marginTop: 20, marginBottom: 9 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: {
    backgroundColor: "#17283D",
    borderColor: "#334A64",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
    minWidth: "45%",
    flexGrow: 1,
    alignItems: "center",
  },
  selected: { backgroundColor: "#17496E", borderColor: "#51AAFA" },
  optionLabel: { color: "#EAF3FF", fontSize: 12, fontWeight: "600" },
  textarea: {
    borderWidth: 1,
    borderColor: "#334A64",
    borderRadius: 12,
    color: "#FFF",
    backgroundColor: "#17283D",
    minHeight: 86,
    padding: 12,
    fontSize: 14,
  },
  error: { color: "#FF8D97", fontSize: 12, lineHeight: 18, marginTop: 12 },
  footer: { color: "#91A5BD", fontSize: 11, marginTop: 16, marginBottom: 12 },
  button: { backgroundColor: "#1479CF", borderRadius: 13, padding: 16, alignItems: "center", justifyContent: "center" },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800", textAlign: "center" },
  rtl: { textAlign: "right", writingDirection: "rtl" },
});
