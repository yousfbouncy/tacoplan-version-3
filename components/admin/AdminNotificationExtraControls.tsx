import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

export type ExtraAction = { label: string; url: string };
export type EditableQuestion = { id: string; label: string; type: "text" | "choice"; optionsText: string; required: boolean };
export type FormKind = "none" | "survey" | "form";

type Props = {
  actions: ExtraAction[];
  onActionsChange: (actions: ExtraAction[]) => void;
  formKind: FormKind;
  onFormKindChange: (kind: FormKind) => void;
  questions: EditableQuestion[];
  onQuestionsChange: (questions: EditableQuestion[]) => void;
};

const MAX_BUTTONS = 4; // Includes the original primary button.
const MAX_QUESTIONS = 6;

function SmallButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled}
      style={[styles.smallButton, disabled && { opacity: 0.4 }]}>
      <Text style={styles.smallButtonText}>{label}</Text>
    </Pressable>
  );
}

export default function AdminNotificationExtraControls({
  actions, onActionsChange, formKind, onFormKindChange, questions, onQuestionsChange,
}: Props) {
  const updateAction = (index: number, key: keyof ExtraAction, value: string) =>
    onActionsChange(actions.map((item, i) => i === index ? { ...item, [key]: value } : item));
  const updateQuestion = (index: number, change: Partial<EditableQuestion>) =>
    onQuestionsChange(questions.map((item, i) => i === index ? { ...item, ...change } : item));
  return (
    <View style={styles.root}>
      <Text style={styles.heading}>Botones adicionales (hasta {MAX_BUTTONS} en total)</Text>
      <Text style={styles.hint}>Escribe el texto y el enlace de cada botón. Puedes usar uno solo o varios.</Text>
      {actions.map((item, index) => (
        <View key={index} style={styles.group}>
          <Text style={styles.label}>Botón {index + 2}</Text>
          <TextInput placeholder="Texto del botón" placeholderTextColor="#94A3B8" style={styles.input}
            value={item.label} onChangeText={text => updateAction(index, "label", text)} />
          <TextInput placeholder="https://..." placeholderTextColor="#94A3B8" style={styles.input}
            autoCapitalize="none" value={item.url} onChangeText={text => updateAction(index, "url", text)} />
          <SmallButton label="Quitar botón" onPress={() => onActionsChange(actions.filter((_, i) => i !== index))} />
        </View>
      ))}
      <SmallButton label="+ Añadir botón" disabled={actions.length >= MAX_BUTTONS - 1}
        onPress={() => onActionsChange([...actions, { label: "", url: "" }])} />

      <Text style={[styles.heading, { marginTop: 14 }]}>Tipo de contenido</Text>
      <View style={styles.row}>
        {([["none", "Aviso"], ["survey", "Encuesta"], ["form", "Formulario"]] as const).map(([key, label]) => (
          <Pressable key={key} onPress={() => onFormKindChange(key)}
            style={[styles.pill, formKind === key && styles.pillActive]}>
            <Text style={[styles.pillText, formKind === key && styles.pillTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {formKind !== "none" ? (
        <View style={styles.form}>
          <Text style={styles.hint}>Las respuestas se guardan en Tacoplan para verlas en tu panel Admin. Máximo 6 preguntas.</Text>
          {questions.map((q, index) => (
            <View style={styles.group} key={q.id}>
              <Text style={styles.label}>Pregunta {index + 1}</Text>
              <TextInput placeholder="Escribe la pregunta" placeholderTextColor="#94A3B8" style={styles.input}
                value={q.label} onChangeText={text => updateQuestion(index, { label: text })} maxLength={200} />
              <View style={styles.row}>
                <SmallButton label={q.type === "choice" ? "● Opciones" : "○ Opciones"}
                  onPress={() => updateQuestion(index, { type: "choice" })} />
                <SmallButton label={q.type === "text" ? "● Respuesta escrita" : "○ Respuesta escrita"}
                  onPress={() => updateQuestion(index, { type: "text" })} />
              </View>
              {q.type === "choice" ? (
                <TextInput placeholder="Opciones separadas por comas (Ej. Sí, No, A veces)"
                  placeholderTextColor="#94A3B8" style={styles.input} value={q.optionsText}
                  onChangeText={text => updateQuestion(index, { optionsText: text })} maxLength={600} />
              ) : null}
              <View style={styles.row}>
                <SmallButton label={q.required ? "● Obligatoria" : "○ Opcional"}
                  onPress={() => updateQuestion(index, { required: !q.required })} />
                <SmallButton label="Eliminar pregunta"
                  onPress={() => onQuestionsChange(questions.filter((_, i) => i !== index))} />
              </View>
            </View>
          ))}
          <SmallButton label="+ Añadir pregunta" disabled={questions.length >= MAX_QUESTIONS}
            onPress={() => {
              const id = "q" + (Math.max(0, ...questions.map(q => Number(q.id.slice(1)) || 0)) + 1);
              onQuestionsChange([...questions, { id, label: "", type: "choice", optionsText: "", required: true }]);
            }} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 9 },
  heading: { color: "#0F172A", fontSize: 15, fontFamily: "Inter_700Bold" },
  hint: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18, color: "#64748B" },
  label: { fontFamily: "Inter_600SemiBold", color: "#334155", fontSize: 12 },
  group: { gap: 8, backgroundColor: "#F8FAFC", borderRadius: 14, padding: 13, borderWidth: 1, borderColor: "#E2E8F0" },
  input: { minHeight: 43, backgroundColor: "#FFFFFF", borderColor: "#CBD5E1", borderWidth: 1, borderRadius: 10, padding: 11, fontSize: 14, color: "#0F172A" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  smallButton: { alignSelf: "flex-start", backgroundColor: "#EFF6FF", borderColor: "#BFDBFE", borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9 },
  smallButtonText: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: "#1D4ED8" },
  pill: { borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10 },
  pillActive: { backgroundColor: "#DBEAFE", borderColor: "#2563EB" },
  pillText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#475569" },
  pillTextActive: { color: "#1D4ED8" },
  form: { gap: 12 },
});
