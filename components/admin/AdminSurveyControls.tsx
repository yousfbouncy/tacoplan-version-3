import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { supabase } from "@/lib/supabase";

type Frequency = "once" | "every_2_days" | "weekly" | "biweekly" | "monthly";
type Audience = "all" | "new_users" | "first_jornada" | "recurring";
type SurveySettings = { enabled: boolean; mandatory: boolean; frequency: Frequency; audience: Audience };

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: "once", label: "Una vez" }, { value: "every_2_days", label: "Cada 2 días" },
  { value: "weekly", label: "Semanal" }, { value: "biweekly", label: "Quincenal" },
  { value: "monthly", label: "Mensual" },
];
const AUDIENCES: { value: Audience; label: string }[] = [
  { value: "all", label: "Todos" }, { value: "new_users", label: "Nuevos (primeros 7 días)" },
  { value: "first_jornada", label: "Con primera jornada" }, { value: "recurring", label: "Recurrentes (2+ jornadas)" },
];

export default function AdminSurveyControls() {
  const [settings, setSettings] = useState<SurveySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("tacoplan_survey_settings")
      .select("enabled,mandatory,frequency,audience").eq("id", "weekly_survey").single();
    if (error || !data) setFeedback("No se ha podido cargar la configuración: " + (error?.message || ""));
    else { setSettings(data as SurveySettings); setFeedback(""); }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const save = async () => {
    if (!settings || saving) return;
    setSaving(true); setFeedback("");
    const { data: auth } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("tacoplan_survey_settings")
      .update({ ...settings, updated_by: auth.user?.id || null, updated_at: new Date().toISOString() })
      .eq("id", "weekly_survey").select("id").single();
    setFeedback(error || !data ? "No se guardó: " + (error?.message || "Sin permisos") : "Configuración guardada. Se aplicará en las aplicaciones actualizadas.");
    setSaving(false);
  };
  if (loading) return <ActivityIndicator color="#2563EB" />;
  if (!settings) return <Pressable onPress={() => void load()}><Text>Reintentar carga de configuración</Text><Text>{feedback}</Text></Pressable>;
  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Control de encuestas</Text>
      <Text style={styles.description}>Activa, pausa y define quién recibe el cuestionario al abrir la app.</Text>
      <Text style={styles.label}>Estado</Text>
      <View style={styles.row}>
        {([true,false] as const).map(v => <Pressable key={String(v)} style={[styles.choice,settings.enabled===v&&styles.selected]} onPress={() => setSettings({...settings,enabled:v})}>
          <Text style={styles.text}>{v?"Activada":"Pausada"}</Text>
        </Pressable>)}
      </View>
      <Text style={styles.label}>Frecuencia</Text>
      <View style={styles.row}>{FREQUENCIES.map(o => <Pressable key={o.value} style={[styles.choice,settings.frequency===o.value&&styles.selected]} onPress={() => setSettings({...settings,frequency:o.value})}><Text style={styles.text}>{o.label}</Text></Pressable>)}</View>
      <Text style={styles.label}>Destinatarios</Text>
      <View style={styles.row}>{AUDIENCES.map(o => <Pressable key={o.value} style={[styles.choice,settings.audience===o.value&&styles.selected]} onPress={() => setSettings({...settings,audience:o.value})}><Text style={styles.text}>{o.label}</Text></Pressable>)}</View>
      <Text style={styles.label}>Respuesta</Text>
      <View style={styles.row}>{([true,false] as const).map(v => <Pressable key={String(v)} style={[styles.choice,settings.mandatory===v&&styles.selected]} onPress={() => setSettings({...settings,mandatory:v})}><Text style={styles.text}>{v?"Obligatoria":"Opcional"}</Text></Pressable>)}</View>
      <Pressable style={[styles.save,saving&&{opacity:0.5}]} disabled={saving} onPress={() => void save()}><Text style={styles.saveText}>{saving?"Guardando...":"Guardar configuración"}</Text></Pressable>
      {!!feedback && <Text style={styles.feedback}>{feedback}</Text>}
      <Text style={styles.description}>Las respuestas anteriores se conservan. En versiones antiguas de la aplicación puede seguir apareciendo la encuesta hasta actualizar.</Text>
    </View>
  );
}
const styles=StyleSheet.create({
  card:{backgroundColor:"#FFFFFF",borderWidth:1,borderColor:"#E5EAF4",borderRadius:18,padding:18,gap:10},
  heading:{fontWeight:"800",color:"#0F172A",fontSize:17},description:{color:"#64748B",fontSize:12,lineHeight:18},
  label:{fontWeight:"700",color:"#334155",fontSize:13,marginTop:5},
  row:{flexDirection:"row",flexWrap:"wrap",gap:8},
  choice:{backgroundColor:"#F1F5F9",paddingVertical:10,paddingHorizontal:12,borderRadius:10,borderWidth:1,borderColor:"#CBD5E1"},
  selected:{backgroundColor:"#DBEAFE",borderColor:"#2563EB"},text:{fontSize:12,color:"#0F172A",fontWeight:"600"},
  save:{backgroundColor:"#2563EB",borderRadius:12,padding:13,alignItems:"center",marginTop:7},saveText:{fontWeight:"700",color:"#FFF"},feedback:{color:"#334155",fontSize:12}
});
