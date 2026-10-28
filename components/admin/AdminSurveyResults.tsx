import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { RefreshCw } from "lucide-react-native";
import { supabase } from "@/lib/supabase";

type SurveyReport = {
  total: number;
  unique_users: number;
  satisfaction: Record<string, number>;
  difficulty: Record<string, number>;
};
type SurveyAnswer = {
  id: number;
  user_id: string;
  email: string;
  satisfaction: string;
  difficulty: string;
  suggestion: string;
  week_start: string;
  submitted_at: string;
};

const PAGE_SIZE = 30;
const SATISFACTION: [string, string][] = [
  ["muy_bien", "Muy buena"], ["bien", "Buena"], ["regular", "Regular"], ["mal", "Mala"],
];
const DIFFICULTY: [string, string][] = [
  ["ninguno", "Sin dificultades"], ["dificil", "Difícil de usar"],
  ["errores", "Errores"], ["funciones", "Faltan funciones"],
];

function dateText(value?: string) {
  if (!value) return "Sin fecha";
  const d = new Date(value);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString("es-ES", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : value;
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statNumber}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Distribution({
  heading, data, labels,
}: { heading: string; data: Record<string, number>; labels: [string, string][] }) {
  const total = Object.values(data).reduce((sum, count) => sum + Number(count || 0), 0);
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{heading}</Text>
      {labels.map(([key, label]) => {
        const count = Number(data[key] || 0);
        const percent = total ? Math.round((count / total) * 100) : 0;
        return (
          <View key={key} style={styles.distRow}>
            <View style={styles.distLabelRow}>
              <Text style={styles.body}>{label}</Text>
              <Text style={styles.secondary}>{count} · {percent}%</Text>
            </View>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${percent}%` }]} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

export default function AdminSurveyResults() {
  const [report, setReport] = useState<SurveyReport | null>(null);
  const [answers, setAnswers] = useState<SurveyAnswer[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const offset = useRef(0);
  const busy = useRef(false);
  const mounted = useRef(true);

  const load = useCallback(async (reset: boolean) => {
    if (busy.current) return;
    busy.current = true;
    if (reset) { setLoading(true); setError(""); }
    else setLoadingMore(true);
    try {
      const startOffset = reset ? 0 : offset.current;
      const [overview, page] = await Promise.all([
        reset ? supabase.rpc("tacoplan_admin_survey_results") : Promise.resolve({ data: null, error: null }),
        supabase.rpc("tacoplan_admin_survey_answers", { p_offset: startOffset, p_limit: PAGE_SIZE }),
      ]);
      if (overview.error) throw overview.error;
      if (page.error) throw page.error;
      const items = Array.isArray(page.data) ? page.data as SurveyAnswer[] : [];
      if (!mounted.current) return;
      if (reset) {
        setReport((overview.data || { total: 0, unique_users: 0, satisfaction: {}, difficulty: {} }) as SurveyReport);
        setAnswers(items);
      } else {
        setAnswers(previous => {
          const existing = new Set(previous.map(item => item.id));
          return [...previous, ...items.filter(item => !existing.has(item.id))];
        });
      }
      offset.current = startOffset + items.length;
      setHasMore(items.length === PAGE_SIZE);
    } catch (e: any) {
      if (mounted.current) setError(String(e?.message || "No se pudieron consultar las encuestas."));
    } finally {
      busy.current = false;
      if (mounted.current) { setLoading(false); setLoadingMore(false); }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load(true);
    return () => { mounted.current = false; };
  }, [load]);

  return (
    <View style={styles.container}>
      <View style={styles.headingRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.introTitle}>Encuestas de usuarios</Text>
          <Text style={styles.secondary}>Respuestas semanales guardadas en Tacoplan. Solo tu cuenta administradora puede consultarlas.</Text>
        </View>
        <Pressable
          accessibilityLabel="Actualizar encuestas"
          accessibilityRole="button"
          onPress={() => void load(true)}
          disabled={loading || loadingMore}
          style={styles.refresh}
        >
          <RefreshCw size={18} color="#2563EB" />
        </Pressable>
      </View>

      {loading ? <View style={styles.loading}><ActivityIndicator color="#2563EB" /><Text style={styles.secondary}>Cargando respuestas…</Text></View> : null}
      {!!error ? <View style={styles.errorCard}><Text style={styles.errorText}>{error}</Text></View> : null}

      {!loading && report ? (
        <>
          <View style={styles.stats}>
            <StatBox label="Respuestas recibidas" value={Number(report.total || 0)} />
            <StatBox label="Usuarios que respondieron" value={Number(report.unique_users || 0)} />
          </View>
          <Distribution heading="Valoración de Tacoplan" data={report.satisfaction || {}} labels={SATISFACTION} />
          <Distribution heading="Dificultades comunicadas" data={report.difficulty || {}} labels={DIFFICULTY} />

          <View style={styles.sectionHeading}>
            <Text style={styles.sectionTitle}>Todas las respuestas</Text>
            <Text style={styles.secondary}>Ordenadas de más reciente a más antigua</Text>
          </View>

          {answers.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.body}>Todavía no hay respuestas. Aparecerán aquí cuando los usuarios completen su encuesta semanal.</Text>
            </View>
          ) : answers.map((answer) => (
            <View key={answer.id} style={styles.card}>
              <View style={styles.answerHeading}>
                <Text style={styles.email} numberOfLines={2}>{answer.email || "Usuario"}</Text>
                <Text style={styles.secondary}>{dateText(answer.submitted_at)}</Text>
              </View>
              <Text style={styles.week}>Semana del {answer.week_start || "—"}</Text>
              <Text style={styles.detail}>Valoración: <Text style={styles.detailStrong}>{SATISFACTION.find(([key]) => key === answer.satisfaction)?.[1] || answer.satisfaction}</Text></Text>
              <Text style={styles.detail}>Dificultad: <Text style={styles.detailStrong}>{DIFFICULTY.find(([key]) => key === answer.difficulty)?.[1] || answer.difficulty}</Text></Text>
              <Text style={styles.detail}>Sugerencia: <Text style={styles.detailStrong}>{answer.suggestion?.trim() || "Sin comentario"}</Text></Text>
            </View>
          ))}

          {hasMore && answers.length > 0 ? (
            <Pressable onPress={() => void load(false)} disabled={loadingMore} style={styles.moreButton}>
              {loadingMore ? <ActivityIndicator color="#2563EB" /> : <Text style={styles.moreText}>Cargar más respuestas</Text>}
            </Pressable>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 14, paddingBottom: 24 },
  headingRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  introTitle: { fontFamily: "Inter_700Bold", fontSize: 20, color: "#0F172A", marginBottom: 6 },
  secondary: { fontFamily: "Inter_400Regular", color: "#64748B", fontSize: 12, lineHeight: 18 },
  refresh: { width: 42, height: 42, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D9E5F6", borderRadius: 12, alignItems: "center", justifyContent: "center" },
  stats: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  statBox: { flexGrow: 1, minWidth: 140, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5EAF4", borderRadius: 18, padding: 18 },
  statNumber: { fontFamily: "Inter_700Bold", color: "#0F172A", fontSize: 30 },
  statLabel: { fontFamily: "Inter_500Medium", color: "#64748B", fontSize: 12, marginTop: 4 },
  card: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5EAF4", borderRadius: 18, padding: 17, gap: 6 },
  cardTitle: { fontFamily: "Inter_700Bold", color: "#0F172A", fontSize: 15, marginBottom: 8 },
  distRow: { marginTop: 5, gap: 6 },
  distLabelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  body: { fontFamily: "Inter_500Medium", fontSize: 13, color: "#334155", flexShrink: 1 },
  barTrack: { height: 7, borderRadius: 7, backgroundColor: "#E5EAF4", overflow: "hidden" },
  barFill: { height: 7, backgroundColor: "#2563EB", borderRadius: 7 },
  sectionHeading: { marginTop: 8, gap: 4 },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 17, color: "#0F172A" },
  answerHeading: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 6 },
  email: { fontFamily: "Inter_700Bold", color: "#0F172A", fontSize: 14, maxWidth: "100%" },
  week: { fontFamily: "Inter_500Medium", color: "#2563EB", fontSize: 12, marginBottom: 4 },
  detail: { fontFamily: "Inter_400Regular", fontSize: 13, color: "#475569", lineHeight: 19 },
  detailStrong: { fontFamily: "Inter_600SemiBold", color: "#0F172A" },
  loading: { padding: 24, gap: 10, alignItems: "center" },
  errorCard: { padding: 14, backgroundColor: "#FEF2F2", borderRadius: 12 },
  errorText: { fontFamily: "Inter_500Medium", color: "#B91C1C", fontSize: 13 },
  moreButton: { borderWidth: 1, borderColor: "#BFDBFE", borderRadius: 14, padding: 16, alignItems: "center", backgroundColor: "#EFF6FF" },
  moreText: { fontFamily: "Inter_600SemiBold", color: "#2563EB", fontSize: 14 },
});
