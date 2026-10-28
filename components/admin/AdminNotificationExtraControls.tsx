import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

export type ExtraAction = { label: string; url: string };
export type EditableQuestion = { id: string; label: string; type: "text" | "choice"; options: string[]; required: boolean };
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
const MAX_OPTIONS = 8;
const MIN_OPTIONS = 2;

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
  const updateOption = (questionIndex: number, optionIndex: number, value: string) =>
    onQuestionsChange(questions.map((question, i) =>
      i === questionIndex
        ? { ...question, options: (question.options || ["", ""]).map((answer, j) => j === optionIndex ? value : answer) }
        : question
    ));
  const addOption = (questionIndex: number) =>
    onQuestionsChange(questions.map((question, i) =>
      i === questionIndex && (question.options || ["", ""]).length < MAX_OPTIONS
        ? { ...question, options: [...(question.options || ["", ""]), ""] }
        : question
    ));
  const removeOption = (questionIndex: number, optionIndex: number) =>
    onQuestionsChange(questions.map((question, i) =>
      i === questionIndex && (question.options || ["", ""]).length > MIN_OPTIONS
        ? { ...question, options: question.options.filter((_, j) => j !== optionIndex) }
        : question
    ));
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
                <View style={styles.optionsGroup}>
                  <Text style={styles.label}>Respuestas posibles · {(q.options || ["", ""]).length} de {MAX_OPTIONS}</Text>
                  {(q.options || ["", ""]).map((option, optionIndex) => (
                    <View key={optionIndex} style={styles.optionRow}>
                      <Text style={styles.optionNumber}>{optionIndex + 1}.</Text>
                      <TextInput
                        accessibilityLabel={`Respuesta ${optionIndex + 1} de la pregunta ${index + 1}`}
                        placeholder={`Escribe la respuesta ${optionIndex + 1}`}
                        placeholderTextColor="#94A3B8"
                        style={[styles.input, styles.optionInput]}
                        value={option}
                        maxLength={100}
                        onChangeText={value => updateOption(index, optionIndex, value)}
                      />
                      {(q.options || []).length > MIN_OPTIONS ? (
                        <SmallButton label="Quitar" onPress={() => removeOption(index, optionIndex)} />
                      ) : null}
                    </View>
                  ))}
                  <SmallButton
                    label="+ Añadir respuesta"
                    disabled={(q.options || ["", ""]).length >= MAX_OPTIONS}
                    onPress={() => addOption(index)}
                  />
                  <Text style={styles.hint}>Añade una respuesta por campo. El usuario podrá elegir una de ellas.</Text>
                </View>
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
              onQuestionsChange([...questions, { id, label: "", type: "choice", options: ["", ""], required: true }]);
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
  optionsGroup: { gap: 10 },
  optionRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  optionNumber: { width: 20, fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#475569" },
  optionInput: { flex: 1, minWidth: 150 },
});
