import React, { useState, useCallback, useMemo } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  Platform,
  Modal,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { todayStr, nowTimeStr, formatFecha } from "@/lib/utils";
import { useI18n } from "@/lib/i18n-context";
import {
  getViajesEnCurso,
  getViajesCompletados,
  crearViaje,
  eliminarViaje,
  getViajePlaces,
  type Viaje,
  type ModoViaje,
} from "@/lib/local-storage";

export default function ViajesScreen() {
  const { t } = useI18n();
  const MODO_LABELS: Record<ModoViaje, string> = {
    COMPLETO: t("viajes.complete"),
    SOLO_CARGA: t("viajes.loadOnly"),
    SOLO_DESCARGA: t("viajes.unloadOnly"),
  };
  const insets = useSafeAreaInsets();
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const qc = useQueryClient();
  const router = useRouter();

  const [showNuevoModal, setShowNuevoModal] = useState(false);

  const [modo, setModo] = useState<ModoViaje>("COMPLETO");
  const [cliente, setCliente] = useState("");
  const [paradasForm, setParadasForm] = useState<Array<{ tipo: "CARGA" | "DESCARGA"; lugar: string; citaFecha: string; citaHora: string }>>([
    { tipo: "CARGA", lugar: "", citaFecha: "", citaHora: "" },
  ]);

  const [placeSuggestions, setPlaceSuggestions] = useState<string[]>([]);
  const [activePlaceIdx, setActivePlaceIdx] = useState<number | null>(null);
  const [allPlaces, setAllPlaces] = useState<string[]>([]);

  const invalidateAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["viajes-en-curso"] });
    qc.invalidateQueries({ queryKey: ["viajes-completados"] });
  }, [qc]);

  useFocusEffect(
    useCallback(() => {
      invalidateAll();
    }, [invalidateAll])
  );

  const enCursoQuery = useQuery<Viaje[]>({
    queryKey: ["viajes-en-curso"],
    queryFn: getViajesEnCurso,
  });

  const completadosQuery = useQuery<Viaje[]>({
    queryKey: ["viajes-completados"],
    queryFn: getViajesCompletados,
  });

  const loadPlaces = useCallback(async () => {
    const p = await getViajePlaces();
    setAllPlaces(p);
  }, []);

  const crearMutation = useMutation({
    mutationFn: async () => {
      const validParadas = paradasForm.filter((p) => p.lugar.trim());
      if (validParadas.length === 0) throw new Error(t("viajes.errorNoStops"));
      if (modo === "COMPLETO") {
        const hasC = validParadas.some((p) => p.tipo === "CARGA");
        const hasD = validParadas.some((p) => p.tipo === "DESCARGA");
        if (!hasC || !hasD) throw new Error(t("viajes.errorCompleteMode"));
      }
      if (modo === "SOLO_CARGA" && !validParadas.some((p) => p.tipo === "CARGA")) {
        throw new Error(t("viajes.errorLoadMode"));
      }
      if (modo === "SOLO_DESCARGA" && !validParadas.some((p) => p.tipo === "DESCARGA")) {
        throw new Error(t("viajes.errorUnloadMode"));
      }
      return crearViaje({
        cliente: cliente.trim() || undefined,
        modoViaje: modo,
        paradas: validParadas.map((p) => ({
          tipo: p.tipo,
          lugar: p.lugar.trim(),
          citaFecha: p.citaFecha || undefined,
          citaHora: p.citaHora || undefined,
        })),
      });
    },
    onSuccess: (viaje) => {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowNuevoModal(false);
      resetForm();
      invalidateAll();
      router.push({ pathname: "/viaje-detalle", params: { id: viaje.id } });
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const eliminarMutation = useMutation({
    mutationFn: (id: string) => eliminarViaje(id),
    onSuccess: () => {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      invalidateAll();
    },
  });

  const resetForm = () => {
    setModo("COMPLETO");
    setCliente("");
    setParadasForm([{ tipo: "CARGA", lugar: "", citaFecha: "", citaHora: "" }]);
    setPlaceSuggestions([]);
    setActivePlaceIdx(null);
  };

  const addParadaForm = (tipo: "CARGA" | "DESCARGA") => {
    setParadasForm((prev) => [...prev, { tipo, lugar: "", citaFecha: "", citaHora: "" }]);
  };

  const removeParadaForm = (idx: number) => {
    setParadasForm((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateParadaForm = (idx: number, field: string, value: string) => {
    setParadasForm((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));
    if (field === "lugar") {
      if (value.trim().length > 0) {
        const filtered = allPlaces.filter((p) => p.toLowerCase().includes(value.toLowerCase()));
        setPlaceSuggestions(filtered.slice(0, 5));
        setActivePlaceIdx(idx);
      } else {
        setPlaceSuggestions([]);
        setActivePlaceIdx(null);
      }
    }
  };

  const selectPlace = (idx: number, place: string) => {
    updateParadaForm(idx, "lugar", place);
    setPlaceSuggestions([]);
    setActivePlaceIdx(null);
  };

  const handleEliminar = (id: string) => {
    if (Platform.OS === "web") {
      if (window.confirm(t("viajes.deleteQuestion"))) eliminarMutation.mutate(id);
    } else {
      Alert.alert(t("common.delete"), t("viajes.deleteQuestion"), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("common.delete"), style: "destructive", onPress: () => eliminarMutation.mutate(id) },
      ]);
    }
  };

  const openNuevoModal = async () => {
    resetForm();
    await loadPlaces();
    setShowNuevoModal(true);
  };

  const enCurso = enCursoQuery.data || [];
  const completados = completadosQuery.data || [];

  const countParadas = (v: Viaje) => {
    const c = v.paradas.filter((p) => p.tipo === "CARGA").length;
    const d = v.paradas.filter((p) => p.tipo === "DESCARGA").length;
    return { cargas: c, descargas: d };
  };

  const renderViajeCard = (item: Viaje, isEnCurso: boolean) => {
    const counts = countParadas(item);
    const createdDate = item.createdAt ? new Date(item.createdAt) : null;
    const dateStr = createdDate
      ? `${String(createdDate.getDate()).padStart(2, "0")}/${String(createdDate.getMonth() + 1).padStart(2, "0")}/${createdDate.getFullYear()}`
      : "";

    return (
      <Pressable
        key={item.id}
        style={[styles.card, isEnCurso && styles.activeCard]}
        onPress={() => router.push({ pathname: "/viaje-detalle", params: { id: item.id } })}
      >
        <View style={styles.cardTop}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {isEnCurso && (
              <View style={styles.activeBadge}>
                <Text style={styles.activeBadgeText}>{t("viajes.inProgress")}</Text>
              </View>
            )}
            <Text style={styles.cardDate}>{dateStr}</Text>
          </View>
          <Pressable onPress={() => handleEliminar(item.id)} hitSlop={8}>
            <Ionicons name="trash-outline" size={16} color={Colors.light.danger} />
          </Pressable>
        </View>

        {item.cliente ? (
          <Text style={styles.clienteText} numberOfLines={1}>{item.cliente}</Text>
        ) : null}

        <View style={styles.cardBottom}>
          <View style={styles.infoChip}>
            <Ionicons name="swap-vertical-outline" size={12} color={Colors.light.textSecondary} />
            <Text style={styles.chipLabel}>{MODO_LABELS[item.modoViaje]}</Text>
          </View>
          {counts.cargas > 0 && (
            <View style={[styles.infoChip, { backgroundColor: Colors.light.success + "12" }]}>
              <Ionicons name="arrow-down-circle-outline" size={12} color={Colors.light.success} />
              <Text style={[styles.chipLabel, { color: Colors.light.success }]}>{counts.cargas}C</Text>
            </View>
          )}
          {counts.descargas > 0 && (
            <View style={[styles.infoChip, { backgroundColor: Colors.light.accent + "12" }]}>
              <Ionicons name="arrow-up-circle-outline" size={12} color={Colors.light.accent} />
              <Text style={[styles.chipLabel, { color: Colors.light.accent }]}>{counts.descargas}D</Text>
            </View>
          )}
          {!isEnCurso && (
            <View style={[styles.statusChip, { backgroundColor: Colors.light.success + "18" }]}>
              <View style={[styles.statusDot, { backgroundColor: Colors.light.success }]} />
              <Text style={[styles.chipLabel, { color: Colors.light.success }]}>{t("viajes.completed")}</Text>
            </View>
          )}
        </View>

        {item.paradas.length > 0 && (
          <View style={styles.paradasPreview}>
            {item.paradas.slice(0, 3).map((p, i) => (
              <Text key={p.id} style={styles.paradaPreviewText} numberOfLines={1}>
                {p.tipo === "CARGA" ? "↓" : "↑"} {p.lugar}
              </Text>
            ))}
            {item.paradas.length > 3 && (
              <Text style={styles.paradaPreviewText}>+{item.paradas.length - 3} {t("viajes.more")}</Text>
            )}
          </View>
        )}
      </Pressable>
    );
  };

  const renderParadaInput = (p: typeof paradasForm[0], idx: number) => (
    <View key={idx} style={styles.paradaBlock}>
      <View style={styles.paradaHeader}>
        <View style={styles.paradaTipoRow}>
          <Pressable
            style={[styles.tipoMiniBtn, p.tipo === "CARGA" && { backgroundColor: Colors.light.success + "20", borderColor: Colors.light.success }]}
            onPress={() => updateParadaForm(idx, "tipo", "CARGA")}
          >
            <Text style={[styles.tipoMiniBtnText, p.tipo === "CARGA" && { color: Colors.light.success }]}>{t("viajes.load")}</Text>
          </Pressable>
          <Pressable
            style={[styles.tipoMiniBtn, p.tipo === "DESCARGA" && { backgroundColor: Colors.light.accent + "20", borderColor: Colors.light.accent }]}
            onPress={() => updateParadaForm(idx, "tipo", "DESCARGA")}
          >
            <Text style={[styles.tipoMiniBtnText, p.tipo === "DESCARGA" && { color: Colors.light.accent }]}>{t("viajes.unload")}</Text>
          </Pressable>
        </View>
        {paradasForm.length > 1 && (
          <Pressable onPress={() => removeParadaForm(idx)} hitSlop={8}>
            <Ionicons name="close-circle-outline" size={20} color={Colors.light.danger} />
          </Pressable>
        )}
      </View>

      <TextInput
        style={styles.input}
        value={p.lugar}
        onChangeText={(v) => updateParadaForm(idx, "lugar", v)}
        placeholder={t("viajes.placeRequired")}
        placeholderTextColor={Colors.light.textSecondary}
      />
      {activePlaceIdx === idx && placeSuggestions.length > 0 && (
        <View style={styles.suggestionsBox}>
          {placeSuggestions.map((s, si) => (
            <Pressable key={si} style={styles.suggestionItem} onPress={() => selectPlace(idx, s)}>
              <Ionicons name="location-outline" size={14} color={Colors.light.textSecondary} />
              <Text style={styles.suggestionText}>{s}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <View style={styles.citaRow}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={p.citaFecha}
          onChangeText={(v) => updateParadaForm(idx, "citaFecha", v)}
          placeholder={t("viajes.appointmentDateOptional")}
          placeholderTextColor={Colors.light.textSecondary}
        />
        <TextInput
          style={[styles.input, { width: 90 }]}
          value={p.citaHora}
          onChangeText={(v) => updateParadaForm(idx, "citaHora", v)}
          placeholder="HH:MM"
          placeholderTextColor={Colors.light.textSecondary}
        />
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t("viajes.title")}</Text>
        <Pressable
          onPress={() => router.push("/usuario")}
          hitSlop={8}
          style={({ pressed }) => [
            {
              width: 44,
              height: 44,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: Colors.light.border,
              backgroundColor: Colors.light.surface,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.9 : 1,
            },
          ]}
        >
          <Ionicons name="settings-outline" size={20} color={Colors.light.tint} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={enCursoQuery.isRefetching || completadosQuery.isRefetching}
            onRefresh={invalidateAll}
            tintColor={Colors.light.tint}
          />
        }
      >
        <Pressable style={styles.nuevoBtn} onPress={openNuevoModal}>
          <Ionicons name="add-circle-outline" size={22} color="#fff" />
          <Text style={styles.nuevoBtnText}>{t("viajes.newTrip")}</Text>
        </Pressable>

        {enCursoQuery.isLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={Colors.light.tint} />
          </View>
        ) : (
          <>
            {enCurso.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t("viajes.inProgress")}</Text>
                {enCurso.map((v) => renderViajeCard(v, true))}
              </View>
            )}

            {completados.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t("viajes.completed")}</Text>
                {completados.map((v) => renderViajeCard(v, false))}
              </View>
            )}

            {enCurso.length === 0 && completados.length === 0 && (
              <View style={styles.empty}>
                <Ionicons name="cube-outline" size={48} color={Colors.light.border} />
                <Text style={styles.emptyText}>{t("viajes.noTrips")}</Text>
                <Text style={styles.emptySubText}>{t("viajes.noTripsCreate")}</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>

      <Modal visible={showNuevoModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t("viajes.newTrip")}</Text>
              <Pressable onPress={() => setShowNuevoModal(false)} hitSlop={8}>
                <Ionicons name="close" size={24} color={Colors.light.textSecondary} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.inputLabel}>{t("viajes.travelMode")}</Text>
              <View style={styles.modoRow}>
                {(["COMPLETO", "SOLO_CARGA", "SOLO_DESCARGA"] as ModoViaje[]).map((m) => (
                  <Pressable
                    key={m}
                    style={[styles.modoBtn, modo === m && styles.modoBtnActive]}
                    onPress={() => setModo(m)}
                  >
                    <Text style={[styles.modoBtnText, modo === m && styles.modoBtnTextActive]}>
                      {MODO_LABELS[m]}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.inputLabel}>{t("viajes.clientOptional")}</Text>
              <TextInput
                style={styles.input}
                value={cliente}
                onChangeText={setCliente}
                placeholder={t("viajes.clientPlaceholder")}
                placeholderTextColor={Colors.light.textSecondary}
              />

              <Text style={[styles.inputLabel, { marginTop: 16 }]}>{t("viajes.stops")}</Text>
              {paradasForm.map((p, i) => renderParadaInput(p, i))}

              <View style={styles.addParadaRow}>
                <Pressable style={[styles.addParadaBtn, { backgroundColor: Colors.light.success + "12" }]} onPress={() => addParadaForm("CARGA")}>
                  <Ionicons name="add" size={16} color={Colors.light.success} />
                  <Text style={[styles.addParadaBtnText, { color: Colors.light.success }]}>{t("viajes.load")}</Text>
                </Pressable>
                <Pressable style={[styles.addParadaBtn, { backgroundColor: Colors.light.accent + "12" }]} onPress={() => addParadaForm("DESCARGA")}>
                  <Ionicons name="add" size={16} color={Colors.light.accent} />
                  <Text style={[styles.addParadaBtnText, { color: Colors.light.accent }]}>{t("viajes.unload")}</Text>
                </Pressable>
              </View>

              <Pressable
                style={[styles.submitBtn, crearMutation.isPending && { opacity: 0.6 }]}
                onPress={() => crearMutation.mutate()}
                disabled={crearMutation.isPending}
              >
                {crearMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                    <Text style={styles.submitBtnText}>{t("viajes.saveTrip")}</Text>
                  </>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: Colors.light.tint,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === "web" ? 118 : 100,
  },
  loadingWrap: {
    paddingTop: 60,
    alignItems: "center",
  },
  nuevoBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.light.tint,
    borderRadius: 14,
    paddingVertical: 16,
    marginVertical: 12,
  },
  nuevoBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  section: {
    marginTop: 8,
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
    marginBottom: 8,
  },
  card: {
    backgroundColor: Colors.light.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  activeCard: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.light.tint,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  activeBadge: {
    backgroundColor: Colors.light.tint + "18",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  activeBadgeText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.tint,
  },
  cardDate: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
  },
  clienteText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
    marginBottom: 6,
  },
  cardBottom: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 4,
  },
  infoChip: {
    backgroundColor: Colors.light.background,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  statusChip: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  chipLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: Colors.light.textSecondary,
  },
  paradasPreview: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.light.border,
  },
  paradaPreviewText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    marginBottom: 2,
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
    gap: 8,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.textSecondary,
  },
  emptySubText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: Colors.light.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: "90%" as any,
    paddingBottom: Platform.OS === "web" ? 34 : 30,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
  },
  inputLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
    marginBottom: 4,
    marginTop: 8,
  },
  input: {
    backgroundColor: Colors.light.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.light.text,
  },
  modoRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 4,
  },
  modoBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  modoBtnActive: {
    backgroundColor: Colors.light.tint + "15",
    borderColor: Colors.light.tint,
  },
  modoBtnText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.textSecondary,
  },
  modoBtnTextActive: {
    color: Colors.light.tint,
  },
  paradaBlock: {
    backgroundColor: Colors.light.background,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  paradaHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  paradaTipoRow: {
    flexDirection: "row",
    gap: 6,
  },
  tipoMiniBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.surface,
  },
  tipoMiniBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.textSecondary,
  },
  citaRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
  },
  suggestionsBox: {
    backgroundColor: Colors.light.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
    marginTop: 2,
    marginBottom: 4,
  },
  suggestionItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  suggestionText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.light.text,
  },
  addParadaRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
    marginBottom: 8,
  },
  addParadaBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 10,
    borderRadius: 10,
  },
  addParadaBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  submitBtn: {
    backgroundColor: Colors.light.tint,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
    marginBottom: 10,
  },
  submitBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
});
