import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { supabase } from "@/lib/supabase";

type ResponseItem = {
  id: number;
  notification_title: string;
  form_kind: string;
  user_email: string;
  submitted_at: string;
  schema: { questions?: Array<{ id: string; label: string }> };
  answers: Record<string, string>;
};
const LIMIT = 30;

export default function AdminNotificationFormResponses({ kind = "form" }: { kind?: "form" | "survey" }) {
  const [items, setItems] = useState<ResponseItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async (offset: number) => {
    offset ? setMoreLoading(true) : setLoading(true);
    setError("");
    try {
      const { data, error: reqError } = await supabase.rpc("tacoplan_admin_notification_answers_by_kind", {
        p_kind: kind,
        p_limit: LIMIT,
        p_offset: offset,
      });
      if (reqError) throw reqError;
      const newItems = Array.isArray(data?.responses) ? data.responses as ResponseItem[] : [];
      setTotal(Number(data?.total || 0));
      setItems(old => offset ? [...old, ...newItems.filter(x => !old.some(p => p.id === x.id))] : newItems);
    } catch (e: any) {
      setError(e?.message || "No se han podido cargar las respuestas.");
    } finally {
      setLoading(false);
      setMoreLoading(false);
    }
  }, [kind]);
  useEffect(() => { void load(0); }, [load]);
  return (
    <View style={styles.root}>
      <View style={styles.heading}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{kind === "survey" ? "Encuestas enviadas por notificación" : "Respuestas a formularios enviados"}</Text>
          <Text style={styles.secondary}>{total} respuestas recibidas</Text>
        </View>
        <Pressable style={styles.button} onPress={() => void load(0)}>
          <Text style={styles.buttonText}>Actualizar</Text>
        </Pressable>
      </View>
      {loading ? <ActivityIndicator color="#2563EB" /> : null}
      {!!error ? <Text style={styles.error}>{error}</Text> : null}
      {!loading && items.length === 0 ? <Text style={styles.secondary}>Cuando los usuarios respondan, aparecerán aquí.</Text> : null}
      {items.map(item => (
        <View key={item.id} style={styles.card}>
          <Text style={styles.itemTitle}>{item.notification_title || "Notificación"}</Text>
          <Text style={styles.secondary}>{item.user_email || "Usuario"} · {new Date(item.submitted_at).toLocaleString("es-ES")}</Text>
          <Text style={styles.secondary}>{item.form_kind === "survey" ? "Encuesta" : "Formulario"}</Text>
          {(item.schema?.questions || []).map(q => (
            <View key={q.id} style={styles.answer}>
              <Text style={styles.question}>{q.label}</Text>
              <Text style={styles.response}>{item.answers?.[q.id] || "Sin respuesta"}</Text>
            </View>
          ))}
        </View>
      ))}
      {items.length < total && !loading ? (
        <Pressable disabled={moreLoading} style={styles.button} onPress={() => void load(items.length)}>
          <Text style={styles.buttonText}>{moreLoading ? "Cargando..." : "Cargar más respuestas"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  root: { gap: 13, marginTop: 14 },
  heading: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { color: "#0F172A", fontSize: 17, fontFamily: "Inter_700Bold" },
  secondary: { color: "#64748B", fontSize: 12, lineHeight: 19, fontFamily: "Inter_400Regular" },
  button: { borderWidth: 1, borderColor: "#BFDBFE", borderRadius: 11, backgroundColor: "#EFF6FF", padding: 12, alignSelf: "flex-start" },
  buttonText: { color: "#1D4ED8", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  error: { color: "#B91C1C", fontSize: 13 },
  card: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E2E8F0", padding: 17, borderRadius: 17, gap: 6 },
  itemTitle: { color: "#0F172A", fontSize: 15, fontFamily: "Inter_700Bold" },
  answer: { marginTop: 8, gap: 3 },
  question: { color: "#475569", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  response: { color: "#0F172A", fontSize: 14, fontFamily: "Inter_400Regular" },
});
