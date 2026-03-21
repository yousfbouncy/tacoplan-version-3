import React, { useState, useCallback } from "react";
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
  ActivityIndicator,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import {
  getViajeById,
  marcarLlegada,
  marcarSalida,
  completarViaje,
  addParada,
  updateViaje,
  removeParada,
  updateParada,
  getViajePlaces,
  type Viaje,
  type Parada,
} from "@/lib/local-storage";
import { useI18n } from "@/lib/i18n-context";


function formatDateTimeShort(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} ${hh}:${mi}`;
}

export default function ViajeDetalleScreen() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const router = useRouter();
  const qc = useQueryClient();

  const [showAddModal, setShowAddModal] = useState(false);
  const [showCompletarModal, setShowCompletarModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTime, setEditingTime] = useState<{ paradaId: string; field: "llegada" | "salida" } | null>(null);
  const [editDateValue, setEditDateValue] = useState("");
  const [editTimeValue, setEditTimeValue] = useState("");

  const [addTipo, setAddTipo] = useState<"CARGA" | "DESCARGA">("CARGA");
  const [addLugar, setAddLugar] = useState("");
  const [addCitaFecha, setAddCitaFecha] = useState("");
  const [addCitaHora, setAddCitaHora] = useState("");

  const [finLugar, setFinLugar] = useState("");
  const [finHora, setFinHora] = useState("");
  const [finNota, setFinNota] = useState("");

  const [editCliente, setEditCliente] = useState("");
  const [editNotas, setEditNotas] = useState("");

  const [placeSuggestions, setPlaceSuggestions] = useState<string[]>([]);
  const [allPlaces, setAllPlaces] = useState<string[]>([]);

  const viajeQuery = useQuery<Viaje | null>({
    queryKey: ["viaje-detalle", id],
    queryFn: () => getViajeById(id || ""),
    enabled: !!id,
  });

  const viaje = viajeQuery.data;

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["viaje-detalle", id] });
    qc.invalidateQueries({ queryKey: ["viajes-en-curso"] });
    qc.invalidateQueries({ queryKey: ["viajes-completados"] });
  }, [qc, id]);

  const hapticSuccess = () => {
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const hapticImpact = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const llegadaMutation = useMutation({
    mutationFn: async ({ paradaId, datetime }: { paradaId: string; datetime?: string }) => {
      await marcarLlegada(id!, paradaId, datetime);
    },
    onSuccess: () => {
      hapticSuccess();
      invalidate();
    },
    onError: (e: Error) => Alert.alert(t("common.error"), e.message),
  });

  const salidaMutation = useMutation({
    mutationFn: async ({ paradaId, datetime }: { paradaId: string; datetime?: string }) => {
      await marcarSalida(id!, paradaId, datetime);
    },
    onSuccess: () => {
      hapticSuccess();
      invalidate();
    },
    onError: (e: Error) => Alert.alert(t("common.error"), e.message),
  });

  const addParadaMutation = useMutation({
    mutationFn: async () => {
      if (!addLugar.trim()) throw new Error(t("viajes.placeRequired"));
      await addParada(id!, {
        tipo: addTipo,
        lugar: addLugar.trim(),
        citaFecha: addCitaFecha || undefined,
        citaHora: addCitaHora || undefined,
      });
    },
    onSuccess: () => {
      hapticSuccess();
      setShowAddModal(false);
      setAddLugar("");
      setAddCitaFecha("");
      setAddCitaHora("");
      invalidate();
    },
    onError: (e: Error) => Alert.alert(t("common.error"), e.message),
  });

  const completarMutation = useMutation({
    mutationFn: async () => {
      await completarViaje(id!, {
        finLugar: finLugar || undefined,
        finHora: finHora || undefined,
        finViajeNota: finNota || undefined,
      });
    },
    onSuccess: () => {
      hapticSuccess();
      setShowCompletarModal(false);
      invalidate();
    },
    onError: (e: Error) => Alert.alert(t("common.error"), e.message),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      await updateViaje(id!, {
        cliente: editCliente,
        notas: editNotas,
      });
    },
    onSuccess: () => {
      hapticSuccess();
      setShowEditModal(false);
      invalidate();
    },
    onError: (e: Error) => Alert.alert(t("common.error"), e.message),
  });

  const [editParadaModal, setEditParadaModal] = useState<Parada | null>(null);
  const [editParadaLugar, setEditParadaLugar] = useState("");
  const [editParadaTipo, setEditParadaTipo] = useState<"CARGA" | "DESCARGA">("CARGA");
  const [editParadaCitaFecha, setEditParadaCitaFecha] = useState("");
  const [editParadaCitaHora, setEditParadaCitaHora] = useState("");

  const removeParadaMutation = useMutation({
    mutationFn: async (paradaId: string) => {
      await removeParada(id!, paradaId);
    },
    onSuccess: () => {
      hapticSuccess();
      invalidate();
    },
    onError: (e: Error) => Alert.alert(t("common.error"), e.message),
  });

  const updateParadaMutation = useMutation({
    mutationFn: async () => {
      if (!editParadaModal) return;
      if (!editParadaLugar.trim()) throw new Error(t("viajes.placeRequired"));
      await updateParada(id!, editParadaModal.id, {
        tipo: editParadaTipo,
        lugar: editParadaLugar.trim(),
        citaFecha: editParadaCitaFecha || null,
        citaHora: editParadaCitaHora || null,
      });
    },
    onSuccess: () => {
      hapticSuccess();
      setEditParadaModal(null);
      invalidate();
    },
    onError: (e: Error) => Alert.alert(t("common.error"), e.message),
  });

  const openEditParada = (p: Parada) => {
    setEditParadaModal(p);
    setEditParadaLugar(p.lugar);
    setEditParadaTipo(p.tipo);
    setEditParadaCitaFecha(p.citaFecha || "");
    setEditParadaCitaHora(p.citaHora || "");
  };

  const confirmDeleteParada = (paradaId: string) => {
    if (Platform.OS === "web") {
      if (window.confirm(t("viajes.confirmDeleteStop") || "¿Eliminar esta parada?")) {
        removeParadaMutation.mutate(paradaId);
      }
    } else {
      Alert.alert(
        t("viajes.confirmDeleteStop") || "¿Eliminar parada?",
        "",
        [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("common.delete"), style: "destructive", onPress: () => removeParadaMutation.mutate(paradaId) },
        ],
      );
    }
  };

  const handleLlegada = (paradaId: string) => {
    hapticImpact();
    llegadaMutation.mutate({ paradaId });
  };

  const handleSalida = (paradaId: string) => {
    hapticImpact();
    salidaMutation.mutate({ paradaId });
  };

  const handleEditTime = (paradaId: string, field: "llegada" | "salida") => {
    setEditingTime({ paradaId, field });
    const parada = viaje?.paradas.find((p) => p.id === paradaId);
    const existingIso = field === "llegada" ? parada?.llegadaReal : parada?.salidaReal;
    if (existingIso) {
      const d = new Date(existingIso);
      if (!isNaN(d.getTime())) {
        setEditDateValue(
          `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`
        );
        setEditTimeValue(
          `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
        );
        return;
      }
    }
    const now = new Date();
    setEditDateValue(
      `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`
    );
    setEditTimeValue("");
  };

  const confirmEditTime = () => {
    if (!editingTime || !editTimeValue.trim()) {
      setEditingTime(null);
      return;
    }
    let targetDate = new Date();
    const dateParts = editDateValue.trim().split("/");
    if (dateParts.length === 3) {
      const day = parseInt(dateParts[0], 10);
      const month = parseInt(dateParts[1], 10) - 1;
      const year = parseInt(dateParts[2], 10);
      if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
        targetDate = new Date(year, month, day);
      }
    }
    const timeParts = editTimeValue.split(":");
    if (timeParts.length === 2) {
      targetDate.setHours(parseInt(timeParts[0], 10), parseInt(timeParts[1], 10), 0, 0);
    }
    const iso = targetDate.toISOString();
    if (editingTime.field === "llegada") {
      llegadaMutation.mutate({ paradaId: editingTime.paradaId, datetime: iso });
    } else {
      salidaMutation.mutate({ paradaId: editingTime.paradaId, datetime: iso });
    }
    setEditingTime(null);
  };

  const openAddModal = async (tipo: "CARGA" | "DESCARGA") => {
    setAddTipo(tipo);
    setAddLugar("");
    setAddCitaFecha("");
    setAddCitaHora("");
    const p = await getViajePlaces();
    setAllPlaces(p);
    setPlaceSuggestions([]);
    setShowAddModal(true);
  };

  const openEditModal = () => {
    if (!viaje) return;
    setEditCliente(viaje.cliente || "");
    setEditNotas(viaje.notas || "");
    setShowEditModal(true);
  };

  const handleCompletarPress = () => {
    if (!viaje) return;
    const allLlegadas = viaje.paradas.every((p) => p.llegadaConfirmada);
    if (!allLlegadas) {
      Alert.alert(t("viajes.cannotComplete"), t("viajes.allStopsMustHaveArrival"));
      return;
    }
    setFinLugar("");
    setFinHora("");
    setFinNota("");
    setShowCompletarModal(true);
  };

  const handleAddLugarChange = (v: string) => {
    setAddLugar(v);
    if (v.trim().length > 0) {
      const filtered = allPlaces.filter((p) => p.toLowerCase().includes(v.toLowerCase()));
      setPlaceSuggestions(filtered.slice(0, 5));
    } else {
      setPlaceSuggestions([]);
    }
  };

  const selectAddPlace = (place: string) => {
    setAddLugar(place);
    setPlaceSuggestions([]);
  };

  if (viajeQuery.isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.light.tint} size="large" />
        </View>
      </View>
    );
  }

  if (!viaje) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={Colors.light.tint} />
          </Pressable>
          <Text style={styles.topBarTitle}>{t("viajes.tripNotFound")}</Text>
          <View style={{ width: 36 }} />
        </View>
      </View>
    );
  }

  const isEnCurso = viaje.estado === "EN_CURSO";
  const cargas = viaje.paradas.filter((p) => p.tipo === "CARGA");
  const descargas = viaje.paradas.filter((p) => p.tipo === "DESCARGA");

  const renderParada = (p: Parada, idx: number) => {
    const isCarga = p.tipo === "CARGA";
    const color = isCarga ? Colors.light.success : Colors.light.accent;
    const label = isCarga ? t("viajes.load").toUpperCase() : t("viajes.unload").toUpperCase();
    const llegadaBtnLabel = isCarga ? t("viajes.arrivalToLoad") : t("viajes.arrivalToUnload");
    const salidaBtnLabel = isCarga ? t("viajes.departureFromLoad") : t("viajes.departureFromUnload");

    return (
      <View key={p.id} style={[styles.paradaCard, { borderLeftColor: color }]}>
        <View style={styles.paradaTopRow}>
          <View style={[styles.tipoBadge, { backgroundColor: color + "18" }]}>
            <Text style={[styles.tipoBadgeText, { color }]}>{label} {idx + 1}</Text>
          </View>
          <Text style={[styles.paradaLugar, { flex: 1 }]}>{p.lugar}</Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Pressable onPress={() => openEditParada(p)} hitSlop={8}>
              <Ionicons name="pencil-outline" size={16} color={Colors.light.textSecondary} />
            </Pressable>
            {viaje.paradas.length > 1 && (
              <Pressable onPress={() => confirmDeleteParada(p.id)} hitSlop={8}>
                <Ionicons name="trash-outline" size={16} color={Colors.light.danger} />
              </Pressable>
            )}
          </View>
        </View>

        <Text style={styles.citaText}>
          {t("viajes.appointment")}: {p.citaFecha ? `${p.citaFecha}${p.citaHora ? ` ${p.citaHora}` : ""}` : t("viajes.noAppointment")}
        </Text>

        <View style={styles.timeSection}>
          <View style={styles.timeRow}>
            <Text style={styles.timeLabel}>{t("viajes.arrival")}</Text>
            {p.llegadaConfirmada ? (
              <View style={styles.timeConfirmed}>
                <Ionicons name="checkmark-circle" size={16} color={Colors.light.success} />
                <Text style={styles.timeValue}>{formatDateTimeShort(p.llegadaReal)}</Text>
                {isEnCurso && (
                  <Pressable onPress={() => handleEditTime(p.id, "llegada")} hitSlop={8}>
                    <Ionicons name="pencil-outline" size={14} color={Colors.light.textSecondary} />
                  </Pressable>
                )}
              </View>
            ) : isEnCurso ? (
              <Pressable
                style={[styles.timeBtn, { backgroundColor: color }]}
                onPress={() => handleLlegada(p.id)}
              >
                <Ionicons name="log-in-outline" size={18} color="#fff" />
                <Text style={styles.timeBtnText}>{llegadaBtnLabel}</Text>
              </Pressable>
            ) : (
              <Text style={styles.timePending}>-</Text>
            )}
          </View>

          <View style={styles.timeRow}>
            <Text style={styles.timeLabel}>{t("viajes.departure")}</Text>
            {p.salidaConfirmada ? (
              <View style={styles.timeConfirmed}>
                <Ionicons name="checkmark-circle" size={16} color={Colors.light.success} />
                <Text style={styles.timeValue}>{formatDateTimeShort(p.salidaReal)}</Text>
                {isEnCurso && (
                  <Pressable onPress={() => handleEditTime(p.id, "salida")} hitSlop={8}>
                    <Ionicons name="pencil-outline" size={14} color={Colors.light.textSecondary} />
                  </Pressable>
                )}
              </View>
            ) : p.llegadaConfirmada && isEnCurso ? (
              <Pressable
                style={[styles.timeBtn, { backgroundColor: color }]}
                onPress={() => handleSalida(p.id)}
              >
                <Ionicons name="log-out-outline" size={18} color="#fff" />
                <Text style={styles.timeBtnText}>{salidaBtnLabel}</Text>
              </Pressable>
            ) : (
              <Text style={styles.timePending}>{p.llegadaConfirmada ? "-" : t("viajes.registerArrivalFirst")}</Text>
            )}
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={Colors.light.tint} />
        </Pressable>
        <Text style={styles.topBarTitle}>{t("viajes.tripDetail")}</Text>
        <Pressable onPress={openEditModal} style={styles.editBtn}>
          <Ionicons name="create-outline" size={20} color={Colors.light.tint} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t("viajes.status")}</Text>
            <View style={[styles.estadoBadge, { backgroundColor: isEnCurso ? Colors.light.tint + "18" : Colors.light.success + "18" }]}>
              <Text style={[styles.estadoBadgeText, { color: isEnCurso ? Colors.light.tint : Colors.light.success }]}>
                {isEnCurso ? t("viajes.inProgress") : t("viajes.completed")}
              </Text>
            </View>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t("viajes.mode")}</Text>
            <Text style={styles.infoValue}>{viaje.modoViaje === "COMPLETO" ? t("viajes.complete") : viaje.modoViaje === "SOLO_CARGA" ? t("viajes.loadOnly") : t("viajes.unloadOnly")}</Text>
          </View>
          {viaje.cliente && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>{t("viajes.client")}</Text>
              <Text style={styles.infoValue}>{viaje.cliente}</Text>
            </View>
          )}
          {viaje.notas && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>{t("common.notes")}</Text>
              <Text style={[styles.infoValue, { flex: 1, textAlign: "right" }]}>{viaje.notas}</Text>
            </View>
          )}
        </View>

        {cargas.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>{t("viajes.loads")}</Text>
            {cargas.map((p, i) => renderParada(p, i))}
          </>
        )}

        {descargas.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>{t("viajes.unloads")}</Text>
            {descargas.map((p, i) => renderParada(p, i))}
          </>
        )}

        <View style={styles.addParadaRow}>
          <Pressable style={[styles.addParadaBtn, { backgroundColor: Colors.light.success + "12" }]} onPress={() => openAddModal("CARGA")}>
            <Ionicons name="add" size={18} color={Colors.light.success} />
            <Text style={[styles.addParadaBtnText, { color: Colors.light.success }]}>{t("viajes.load")}</Text>
          </Pressable>
          <Pressable style={[styles.addParadaBtn, { backgroundColor: Colors.light.accent + "12" }]} onPress={() => openAddModal("DESCARGA")}>
            <Ionicons name="add" size={18} color={Colors.light.accent} />
            <Text style={[styles.addParadaBtnText, { color: Colors.light.accent }]}>{t("viajes.unload")}</Text>
          </Pressable>
        </View>

        {viaje.finLugar || viaje.finHora || viaje.finViajeNota ? (
          <View style={styles.infoCard}>
            <Text style={[styles.sectionTitle, { marginBottom: 8 }]}>{t("viajes.tripEnd")}</Text>
            {viaje.finLugar && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>{t("common.place")}</Text>
                <Text style={styles.infoValue}>{viaje.finLugar}</Text>
              </View>
            )}
            {viaje.finHora && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>{t("common.time")}</Text>
                <Text style={styles.infoValue}>{viaje.finHora}</Text>
              </View>
            )}
            {viaje.finViajeNota && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>{t("common.notes")}</Text>
                <Text style={[styles.infoValue, { flex: 1, textAlign: "right" }]}>{viaje.finViajeNota}</Text>
              </View>
            )}
          </View>
        ) : null}

        {isEnCurso && (
          <Pressable
            style={[styles.completarBtn, completarMutation.isPending && { opacity: 0.6 }]}
            onPress={handleCompletarPress}
            disabled={completarMutation.isPending}
          >
            {completarMutation.isPending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
                <Text style={styles.completarBtnText}>{t("viajes.finishTrip")}</Text>
              </>
            )}
          </Pressable>
        )}
      </ScrollView>

      <Modal visible={showAddModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t("viajes.addStop")}</Text>
              <Pressable onPress={() => setShowAddModal(false)} hitSlop={8}>
                <Ionicons name="close" size={24} color={Colors.light.textSecondary} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={styles.tipoToggle}>
                <Pressable
                  style={[styles.tipoBtn, addTipo === "CARGA" && { backgroundColor: Colors.light.success + "20", borderColor: Colors.light.success }]}
                  onPress={() => setAddTipo("CARGA")}
                >
                  <Text style={[styles.tipoBtnText, addTipo === "CARGA" && { color: Colors.light.success }]}>{t("viajes.load")}</Text>
                </Pressable>
                <Pressable
                  style={[styles.tipoBtn, addTipo === "DESCARGA" && { backgroundColor: Colors.light.accent + "20", borderColor: Colors.light.accent }]}
                  onPress={() => setAddTipo("DESCARGA")}
                >
                  <Text style={[styles.tipoBtnText, addTipo === "DESCARGA" && { color: Colors.light.accent }]}>{t("viajes.unload")}</Text>
                </Pressable>
              </View>

              <Text style={styles.inputLabel}>{t("viajes.placeRequired")} *</Text>
              <TextInput
                style={styles.input}
                value={addLugar}
                onChangeText={handleAddLugarChange}
                placeholder={t("viajes.stopPlace")}
                placeholderTextColor={Colors.light.textSecondary}
              />
              {placeSuggestions.length > 0 && (
                <View style={styles.suggestionsBox}>
                  {placeSuggestions.map((s, i) => (
                    <Pressable key={i} style={styles.suggestionItem} onPress={() => selectAddPlace(s)}>
                      <Ionicons name="location-outline" size={14} color={Colors.light.textSecondary} />
                      <Text style={styles.suggestionText}>{s}</Text>
                    </Pressable>
                  ))}
                </View>
              )}

              <Text style={styles.inputLabel}>{t("viajes.appointmentDateOptional")}</Text>
              <TextInput
                style={styles.input}
                value={addCitaFecha}
                onChangeText={setAddCitaFecha}
                placeholder="AAAA-MM-DD"
                placeholderTextColor={Colors.light.textSecondary}
              />
              <Text style={styles.inputLabel}>{t("viajes.appointmentTimeOptional")}</Text>
              <TextInput
                style={styles.input}
                value={addCitaHora}
                onChangeText={setAddCitaHora}
                placeholder="HH:MM"
                placeholderTextColor={Colors.light.textSecondary}
              />

              <Pressable
                style={[styles.submitBtn, addParadaMutation.isPending && { opacity: 0.6 }]}
                onPress={() => addParadaMutation.mutate()}
                disabled={addParadaMutation.isPending}
              >
                {addParadaMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.submitBtnText}>{t("viajes.add")}</Text>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showCompletarModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t("viajes.finishTrip")}</Text>
              <Pressable onPress={() => setShowCompletarModal(false)} hitSlop={8}>
                <Ionicons name="close" size={24} color={Colors.light.textSecondary} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.inputLabel}>{t("viajes.placeOptional")}</Text>
              <TextInput
                style={styles.input}
                value={finLugar}
                onChangeText={setFinLugar}
                placeholder={t("viajes.placeOptional")}
                placeholderTextColor={Colors.light.textSecondary}
              />
              <Text style={styles.inputLabel}>{t("viajes.timeOptional")}</Text>
              <TextInput
                style={styles.input}
                value={finHora}
                onChangeText={setFinHora}
                placeholder="HH:MM"
                placeholderTextColor={Colors.light.textSecondary}
              />
              <Text style={styles.inputLabel}>{t("viajes.noteOptional")}</Text>
              <TextInput
                style={[styles.input, { minHeight: 60 }]}
                value={finNota}
                onChangeText={setFinNota}
                placeholder={t("viajes.noteOptional")}
                placeholderTextColor={Colors.light.textSecondary}
                multiline
              />
              <Pressable
                style={[styles.submitBtn, { backgroundColor: Colors.light.success }, completarMutation.isPending && { opacity: 0.6 }]}
                onPress={() => completarMutation.mutate()}
                disabled={completarMutation.isPending}
              >
                {completarMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.submitBtnText}>{t("viajes.finishTrip")}</Text>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showEditModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t("viajes.editTrip")}</Text>
              <Pressable onPress={() => setShowEditModal(false)} hitSlop={8}>
                <Ionicons name="close" size={24} color={Colors.light.textSecondary} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.inputLabel}>{t("viajes.client")}</Text>
              <TextInput
                style={styles.input}
                value={editCliente}
                onChangeText={setEditCliente}
                placeholder={t("viajes.clientName")}
                placeholderTextColor={Colors.light.textSecondary}
              />
              <Text style={styles.inputLabel}>{t("common.notes")}</Text>
              <TextInput
                style={[styles.input, { minHeight: 60 }]}
                value={editNotas}
                onChangeText={setEditNotas}
                placeholder={t("viajes.tripNotes")}
                placeholderTextColor={Colors.light.textSecondary}
                multiline
              />
              <Pressable
                style={[styles.submitBtn, updateMutation.isPending && { opacity: 0.6 }]}
                onPress={() => updateMutation.mutate()}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.submitBtnText}>{t("common.save")}</Text>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={!!editingTime} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: "50%" as any }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingTime?.field === "llegada" ? t("viajes.editArrival") : t("viajes.editDeparture")}
              </Text>
              <Pressable onPress={() => setEditingTime(null)} hitSlop={8}>
                <Ionicons name="close" size={24} color={Colors.light.textSecondary} />
              </Pressable>
            </View>
            <Text style={styles.inputLabel}>{t("viajes.dateFormat")}</Text>
            <TextInput
              style={styles.input}
              value={editDateValue}
              onChangeText={setEditDateValue}
              placeholder="DD/MM/AAAA"
              placeholderTextColor={Colors.light.textSecondary}
              autoFocus
            />
            <Text style={[styles.inputLabel, { marginTop: 8 }]}>Hora (HH:MM)</Text>
            <TextInput
              style={styles.input}
              value={editTimeValue}
              onChangeText={setEditTimeValue}
              placeholder="HH:MM"
              placeholderTextColor={Colors.light.textSecondary}
            />
            <Pressable style={styles.submitBtn} onPress={confirmEditTime}>
              <Text style={styles.submitBtnText}>Confirmar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={!!editParadaModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t("viajes.editStop") || "Editar parada"}</Text>
              <Pressable onPress={() => setEditParadaModal(null)} hitSlop={8}>
                <Ionicons name="close" size={24} color={Colors.light.textSecondary} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={styles.tipoToggle}>
                <Pressable
                  style={[styles.tipoBtn, editParadaTipo === "CARGA" && { backgroundColor: Colors.light.success + "20", borderColor: Colors.light.success }]}
                  onPress={() => setEditParadaTipo("CARGA")}
                >
                  <Text style={[styles.tipoBtnText, editParadaTipo === "CARGA" && { color: Colors.light.success }]}>{t("viajes.load")}</Text>
                </Pressable>
                <Pressable
                  style={[styles.tipoBtn, editParadaTipo === "DESCARGA" && { backgroundColor: Colors.light.accent + "20", borderColor: Colors.light.accent }]}
                  onPress={() => setEditParadaTipo("DESCARGA")}
                >
                  <Text style={[styles.tipoBtnText, editParadaTipo === "DESCARGA" && { color: Colors.light.accent }]}>{t("viajes.unload")}</Text>
                </Pressable>
              </View>

              <Text style={styles.inputLabel}>{t("viajes.placeRequired")} *</Text>
              <TextInput
                style={styles.input}
                value={editParadaLugar}
                onChangeText={setEditParadaLugar}
                placeholder={t("viajes.stopPlace")}
                placeholderTextColor={Colors.light.textSecondary}
              />

              <Text style={styles.inputLabel}>{t("viajes.appointmentDateOptional")}</Text>
              <TextInput
                style={styles.input}
                value={editParadaCitaFecha}
                onChangeText={setEditParadaCitaFecha}
                placeholder="DD/MM/AAAA"
                placeholderTextColor={Colors.light.textSecondary}
              />
              <Text style={styles.inputLabel}>{t("viajes.appointmentTimeOptional")}</Text>
              <TextInput
                style={styles.input}
                value={editParadaCitaHora}
                onChangeText={setEditParadaCitaHora}
                placeholder="HH:MM"
                placeholderTextColor={Colors.light.textSecondary}
              />

              <Pressable
                style={[styles.submitBtn, updateParadaMutation.isPending && { opacity: 0.6 }]}
                onPress={() => updateParadaMutation.mutate()}
                disabled={updateParadaMutation.isPending}
              >
                {updateParadaMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.submitBtnText}>{t("common.save")}</Text>
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
  loadingWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.light.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  editBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.light.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  topBarTitle: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === "web" ? 50 : 40,
  },
  infoCard: {
    backgroundColor: Colors.light.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  infoLabel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
  },
  infoValue: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
  },
  estadoBadge: {
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  estadoBadgeText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
    marginBottom: 6,
    marginTop: 4,
  },
  paradaCard: {
    backgroundColor: Colors.light.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderLeftWidth: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  paradaTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  tipoBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tipoBadgeText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  paradaLugar: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
    flex: 1,
  },
  citaText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    marginBottom: 8,
  },
  timeSection: {
    gap: 8,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 40,
  },
  timeLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
    width: 60,
  },
  timeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    flex: 1,
    justifyContent: "center",
    marginLeft: 8,
  },
  timeBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  timeConfirmed: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
    justifyContent: "flex-end",
  },
  timeValue: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
  },
  timePending: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    flex: 1,
    textAlign: "right",
  },
  addParadaRow: {
    flexDirection: "row",
    gap: 8,
    marginVertical: 8,
  },
  addParadaBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 12,
    borderRadius: 10,
  },
  addParadaBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  completarBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.light.tint,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 16,
    marginBottom: 20,
  },
  completarBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
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
    maxHeight: "85%" as any,
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
    marginTop: 10,
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
  tipoToggle: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 4,
  },
  tipoBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  tipoBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.textSecondary,
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
  submitBtn: {
    backgroundColor: Colors.light.tint,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 16,
    marginBottom: 10,
  },
  submitBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
});
