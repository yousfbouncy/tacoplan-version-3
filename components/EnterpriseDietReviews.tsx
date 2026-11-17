import React, { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { supabase } from "@/lib/supabase";

type Review = {
  id: string;
  status: string;
  jornada_date?: string | null;
  original_diet_type?: string | null;
  proposed_diet_type?: string | null;
  original_amount?: number | null;
  proposed_amount?: number | null;
  change_reason?: string | null;
  driver_observation?: string | null;
  traffic_observation?: string | null;
  created_at?: string | null;
};
type Dashboard = { member?: { role: string } | null; reviews?: Review[] };
const API = "https://tacoplan.es/api/empresas/";
const amount = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("es-ES", { style: "currency", currency: "EUR" })
    : "—";

async function request(path: string, body?: Record<string, unknown>): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Inicia sesión para consultar tus revisiones.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(API + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: "Bearer " + session.access_token,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "No se pudo consultar la revisión.");
    return result;
  } finally { clearTimeout(timeout); }
}

export default function EnterpriseDietReviews() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await request("dashboard") as Dashboard;
      const driver = data.member?.role === "driver";
      setAvailable(driver);
      setReviews(driver && Array.isArray(data.reviews) ? data.reviews : []);
      setError("");
    } catch (e) {
      // A user outside Tacoplan Empresas should not receive an enterprise banner.
      setError(e instanceof Error ? e.message : "No se pudo consultar la revisión.");
    } finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const respond = useCallback(async (reviewId: string, response: "accept" | "dispute") => {
    if (busy) return;
    if (response === "dispute" && comment.trim().length < 5) {
      Alert.alert("Comentario necesario", "Explica tu discrepancia con al menos cinco caracteres.");
      return;
    }
    setBusy(true);
    try {
      await request("action", {
        action: "respond", reviewId, response, observation: comment.trim(),
      });
      setSelected(null);
      setComment("");
      await refresh();
    } catch (e) {
      Alert.alert("Revisión de dieta", e instanceof Error ? e.message : "No se pudo guardar tu respuesta.");
    } finally { setBusy(false); }
  }, [busy, comment, refresh]);

  if (!available && !reviews.length) return null;
  const pending = reviews.filter(r => r.status === "awaiting_driver");
  const recent = reviews.filter(r => ["confirmed", "accepted", "disputed"].includes(r.status)).slice(0, 4);
  if (!pending.length && !recent.length) return null;

  return <View style={styles.container} accessibilityLabel="Revisiones de dietas por Tráfico">
    <Text style={styles.title}>Revisión de dietas · Tráfico</Text>
    <Text style={styles.help}>Tus registros originales se conservan. Las modificaciones requieren tu respuesta.</Text>
    {loading ? <ActivityIndicator color="#72B9FF" /> : null}
    {error ? <Text style={styles.help}>No se pudo actualizar: {error}</Text> : null}
    {pending.map(r => {
      const active = selected === r.id;
      return <View key={r.id} style={styles.card}>
        <Text style={styles.heading}>Cambio propuesto {r.jornada_date ? "· " + r.jornada_date : ""}</Text>
        <Text style={styles.body}>{r.original_diet_type || "Dieta registrada"} → {r.proposed_diet_type || "Sin dieta"}</Text>
        <Text style={styles.body}>Registrado: {amount(r.original_amount)} · Propuesto: {amount(r.proposed_amount)}</Text>
        {r.change_reason ? <Text style={styles.body}>Motivo: {r.change_reason}</Text> : null}
        {r.traffic_observation ? <Text style={styles.body}>Tráfico: {r.traffic_observation}</Text> : null}
        {active ? <>
          <TextInput
            style={styles.input}
            multiline
            maxLength={2000}
            placeholder="Comentario opcional al aceptar; obligatorio si no estás de acuerdo"
            placeholderTextColor="#9AAAC1"
            value={comment}
            onChangeText={setComment}
            editable={!busy}
          />
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" style={styles.accept} disabled={busy}
              onPress={() => void respond(r.id,"accept")}>
              <Text style={styles.actionText}>Aceptar cambios</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.dispute} disabled={busy}
              onPress={() => void respond(r.id,"dispute")}>
              <Text style={styles.actionText}>No estoy de acuerdo</Text>
            </Pressable>
          </View>
          <Pressable onPress={() => { setSelected(null); setComment(""); }} disabled={busy}>
            <Text style={styles.help}>Cancelar</Text>
          </Pressable>
        </> : <Pressable accessibilityRole="button" style={styles.open}
            onPress={() => { setSelected(r.id); setComment(""); }}>
          <Text style={styles.actionText}>Revisar propuesta</Text>
        </Pressable>}
      </View>;
    })}
    {recent.map(r => <View key={r.id} style={styles.confirmed}>
      <Text style={styles.heading}>{r.status === "confirmed" ? "Dieta confirmada por Tráfico" :
        r.status === "accepted" ? "Modificación aceptada" : "Discrepancia registrada"}
        {r.jornada_date ? " · " + r.jornada_date : ""}</Text>
      <Text style={styles.help}>{r.status === "confirmed" ? "Sin cambios. No necesitas responder." :
        r.status === "accepted" ? "Has aceptado la propuesta." : "Tu desacuerdo ha quedado registrado."}</Text>
      {r.driver_observation ? <Text style={styles.help}>Tu comentario: {r.driver_observation}</Text> : null}
    </View>)}
  </View>;
}
const styles = StyleSheet.create({
  container: { marginHorizontal: 16, marginVertical: 10, backgroundColor: "#10243B", borderWidth: 1,
    borderColor: "#33516E", borderRadius: 16, padding: 14, gap: 10 },
  title: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  heading: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  help: { color: "#B9C8D9", fontSize: 12, lineHeight: 18 },
  body: { color: "#E0E9F4", fontSize: 13, marginTop: 4 },
  card: { backgroundColor: "#18334F", borderRadius: 12, padding: 12, gap: 6 },
  confirmed: { backgroundColor: "#17354A", padding: 12, borderRadius: 10, gap: 4 },
  input: { borderColor: "#607B96", borderWidth: 1, borderRadius: 10, padding: 10,
    minHeight: 56, color: "#FFFFFF", textAlignVertical: "top" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  open: { backgroundColor: "#2463A8", padding: 11, borderRadius: 10, alignSelf: "flex-start" },
  accept: { backgroundColor: "#166F55", padding: 11, borderRadius: 10 },
  dispute: { backgroundColor: "#935036", padding: 11, borderRadius: 10 },
  actionText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
});
