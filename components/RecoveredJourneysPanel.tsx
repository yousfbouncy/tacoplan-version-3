import React, { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import Colors from "@/constants/driver-theme";
import { supabase } from "@/lib/supabase";

type RecoveredJourney = {
  jornada_id: string;
  fecha_inicio: string;
  fecha_fin: string | null;
  hora_inicio: string | null;
  hora_fin: string | null;
  lugar_inicio: string | null;
  lugar_fin: string | null;
  tipo_ruta: string | null;
  estado: string;
  evidencia: Record<string, unknown> | null;
};

function displayDate(date: string | null): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return date || "Sin fecha";
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

export default function RecoveredJourneysPanel({ userId }: { userId?: string | null }) {
  const [visible, setVisible] = useState(false);
  const recoveredQuery = useQuery<RecoveredJourney[]>({
    queryKey: ["jornadas-recuperacion", userId],
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from("jornadas_recuperacion")
        .select("jornada_id,fecha_inicio,fecha_fin,hora_inicio,hora_fin,lugar_inicio,lugar_fin,tipo_ruta,estado,evidencia")
        .eq("user_id", userId)
        .order("fecha_inicio", { ascending: false });
      if (error) throw error;
      return (data ?? []) as RecoveredJourney[];
    },
  });

  const items = recoveredQuery.data ?? [];
  if (!userId || (items.length === 0 && !recoveredQuery.isError)) return null;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          setVisible(true);
          void recoveredQuery.refetch();
        }}
        style={{
          marginHorizontal: 16,
          marginBottom: 10,
          backgroundColor: Colors.light.surface,
          borderWidth: 1,
          borderColor: Colors.light.warning,
          borderRadius: 16,
          padding: 13,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Ionicons name="folder-open-outline" size={25} color={Colors.light.warning} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: Colors.light.text, fontSize: 14, fontFamily: "Inter_700Bold" }}>
            Jornadas recuperadas{items.length ? ` (${items.length})` : ""}
          </Text>
          <Text style={{ color: Colors.light.textSecondary, fontSize: 12, fontFamily: "Inter_400Regular" }}>
            {recoveredQuery.isError
              ? "No se pudieron cargar. Toca para reintentar."
              : "Registros originales incompletos. Consulta los recorridos y los datos conservados."}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={19} color={Colors.light.warning} />
      </Pressable>

      <Modal visible={visible} transparent animationType="slide" onRequestClose={() => setVisible(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0, 0, 0, 0.72)", justifyContent: "center", padding: 14 }}>
          <View style={{ backgroundColor: Colors.light.surface, borderRadius: 20, padding: 16, maxHeight: "88%" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Ionicons name="shield-checkmark-outline" size={23} color={Colors.light.tint} />
              <Text style={{ color: Colors.light.text, fontSize: 18, fontFamily: "Inter_700Bold", flex: 1 }}>
                Jornadas recuperadas
              </Text>
              <Pressable accessibilityLabel="Cerrar" onPress={() => setVisible(false)} hitSlop={12}>
                <Ionicons name="close" size={23} color={Colors.light.text} />
              </Pressable>
            </View>
            <Text style={{ color: Colors.light.textSecondary, fontSize: 12, lineHeight: 18, marginBottom: 12 }}>
              Se han rescatado los identificadores y los recorridos. Las horas desconocidas NO se han inventado.
              Estos registros no se suman a conducción, nómina, dietas ni descansos hasta completar su verificación.
            </Text>
            {recoveredQuery.isLoading && <ActivityIndicator color={Colors.light.tint} />}
            {recoveredQuery.isError && (
              <Pressable onPress={() => void recoveredQuery.refetch()}>
                <Text style={{ color: Colors.light.warning, marginBottom: 8 }}>Error al cargar. Reintentar</Text>
              </Pressable>
            )}
            <ScrollView showsVerticalScrollIndicator={false}>
              {items.map((item) => {
                const end = item.lugar_fin?.trim() || "Fin no recuperado";
                const start = item.lugar_inicio?.trim() || "Inicio no recuperado";
                return (
                  <View key={item.jornada_id} style={{
                    borderWidth: 1,
                    borderColor: Colors.light.border,
                    borderRadius: 14,
                    padding: 13,
                    marginBottom: 10,
                    gap: 6,
                    backgroundColor: Colors.light.background,
                  }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <Text style={{ fontSize: 14, color: Colors.light.text, fontFamily: "Inter_700Bold" }}>
                        {displayDate(item.fecha_inicio)}
                      </Text>
                      <Text style={{ color: Colors.light.warning, fontSize: 11, fontFamily: "Inter_600SemiBold" }}>
                        PENDIENTE DE COMPLETAR
                      </Text>
                    </View>
                    <Text style={{ color: Colors.light.text, fontSize: 13, fontFamily: "Inter_600SemiBold" }}>
                      {start} → {end}
                    </Text>
                    <Text style={{ color: Colors.light.textSecondary, fontSize: 12 }}>
                      Inicio: {item.hora_inicio ?? "Sin recuperar"} · Fin: {item.hora_fin ?? "Sin recuperar"}
                    </Text>
                    <Text style={{ color: Colors.light.textSecondary, fontSize: 11 }}>
                      Tipo: {item.tipo_ruta || "Por verificar"} · ID: {item.jornada_id}
                    </Text>
                    {item.evidencia?.eliminado_antes_de_borrar_cuenta === true && (
                      <Text style={{ color: Colors.light.warning, fontSize: 11 }}>
                        Este registro fue eliminado individualmente antes del borrado de la cuenta.
                      </Text>
                    )}
                  </View>
                );
              })}
            </ScrollView>
            <Pressable
              onPress={() => setVisible(false)}
              style={{ backgroundColor: Colors.light.primary, borderRadius: 12, padding: 12, marginTop: 8, alignItems: "center" }}
            >
              <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 14 }}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}
