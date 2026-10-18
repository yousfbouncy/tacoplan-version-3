import React, { useCallback, useEffect, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/lib/auth-context";
import { enableAutoStart, disableAutoStart, syncAutoStartProposals } from "@/lib/autostart/service";
import { readAutoStartState, setAutoStartState, type Proposal } from "@/lib/autostart/task";
import { supabase } from "@/lib/supabase";

export default function AutoStartScreen() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const refresh = useCallback(async () => {
    const state = await readAutoStartState();
    setEnabled(state.enabled && state.userId === user?.id);
    setProposals(state.proposals.filter(p => p.userId === user?.id));
    if (user?.id) {
      try { await syncAutoStartProposals(user.id); } catch {}
      const r = await supabase.from("autostart_proposals").select("id,detected_at,status").eq("user_id", user.id).eq("status", "pending").order("detected_at", { ascending: false });
      if (!r.error && r.data) setProposals(r.data.map(p => ({ id: p.id, userId: user.id, detectedAt: p.detected_at, createdAt: p.detected_at, status: "pending", source: "location" })));
    }
  }, [user?.id]);
  useEffect(() => { refresh().catch(() => {}); }, [refresh]);
  const toggle = async () => {
    if (!user?.id || busy) return;
    setBusy(true);
    try {
      if (enabled) await disableAutoStart();
      else await enableAutoStart(user.id);
      await refresh();
    } catch (e: any) { Alert.alert("AutoStart", e?.message || String(e)); }
    finally { setBusy(false); }
  };
  const dismiss = async (id: string) => {
    if (!user?.id) return;
    const { error } = await supabase.from("autostart_proposals").update({ status: "dismissed" }).eq("id", id).eq("user_id", user.id);
    if (error) { Alert.alert("AutoStart", error.message); return; }
    const state = await readAutoStartState();
    await setAutoStartState({ ...state, proposals: state.proposals.filter(p => p.id !== id) });
    await refresh();
  };
  return <ScrollView contentContainerStyle={styles.container}>
    <Text style={styles.heading}>Tacoplan AutoStart</Text>
    <Text style={styles.body}>Detecta un posible inicio tras 3 minutos de movimiento a 12 km/h o más. No crea jornadas legales automáticamente.</Text>
    <Pressable disabled={busy || Platform.OS === "web"} onPress={toggle} style={styles.button}>
      <Text style={styles.buttonText}>{busy ? "Procesando..." : enabled ? "Desactivar AutoStart" : "Activar AutoStart"}</Text>
    </Pressable>
    <Text style={styles.body}>{enabled ? "Detección activa según los permisos y restricciones del sistema." : "Detección desactivada."}</Text>
    <Text style={styles.heading}>Inicios detectados</Text>
    <Pressable onPress={refresh} style={styles.secondary}><Text>Actualizar propuestas</Text></Pressable>
    {proposals.length === 0 ? <Text style={styles.body}>Sin propuestas pendientes en este dispositivo.</Text> : proposals.map(p => <View key={p.id} style={styles.card}>
      <Text>{new Date(p.detectedAt).toLocaleString("es-ES")}</Text>
      <Text style={styles.body}>Propuesta provisional. Confirma manualmente la jornada en la pantalla principal.</Text>
      <Pressable onPress={() => dismiss(p.id)} style={styles.secondary}><Text>Descartar propuesta</Text></Pressable>
    </View>)}
    <Text style={styles.body}>La ubicación funciona en segundo plano solo donde Android/iOS lo permitan. Las propuestas no modifican dietas, descansos ni nóminas.</Text>
  </ScrollView>;
}
const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 60, gap: 16, backgroundColor: "#fff", flexGrow: 1 },
  heading: { fontSize: 22, fontWeight: "700", color: "#0F4C75" },
  body: { color: "#52616B", lineHeight: 22 },
  button: { backgroundColor: "#0F4C75", borderRadius: 12, padding: 18, alignItems: "center" },
  buttonText: { color: "white", fontWeight: "700" },
  secondary: { backgroundColor: "#e7eef3", borderRadius: 10, padding: 12, alignItems: "center" },
  card: { borderWidth: 1, borderColor: "#e4e4e4", borderRadius: 12, padding: 16, gap: 12 },
});
