import React, { useState, useEffect, useMemo } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { todayStr, nowTimeStr, detectCrossSundayMonday, isSpainSummerTime } from "@/lib/utils";
import {
  crearJornadaCompleta,
  getLastLugarFin,
  getRecentPlaces,
  addRecentPlace,
  type PlusItem,
} from "@/lib/local-storage";
import { useSync } from "@/lib/sync-context";
import { useI18n } from "@/lib/i18n-context";

type TipoRuta = "NACIONAL" | "INTERNACIONAL" | "REGIONAL_INTL" | "NAC_INTL" | "NAC_REGIONAL";

function parseConduccion(text: string): number | undefined {
  if (!text.trim()) return undefined;
  if (text.includes(":")) {
    const [h, m] = text.split(":");
    return (parseInt(h) || 0) * 60 + (parseInt(m) || 0);
  }
  const num = parseFloat(text);
  if (isNaN(num)) return undefined;
  return Math.round(num * 60);
}

function parseConduccionValidated(text: string): { minutes: number | null; error: string | null } {
  const cleaned = text.trim();
  if (!cleaned) return { minutes: null, error: null };
  if (cleaned.includes(":")) {
    const parts = cleaned.split(":");
    if (parts.length !== 2) return { minutes: null, error: "common.invalidFormat" };
    const h = parseInt(parts[0]);
    const m = parseInt(parts[1]);
    if (isNaN(h) || isNaN(m)) return { minutes: null, error: "common.invalidFormat" };
    if (m < 0 || m > 59) return { minutes: null, error: "common.minutesRange" };
    const total = h * 60 + m;
    if (total < 0) return { minutes: null, error: "common.invalidFormat" };
    return { minutes: total, error: null };
  }
  const normalized = cleaned.replace(",", ".");
  const num = parseFloat(normalized);
  if (isNaN(num)) return { minutes: null, error: "common.invalidFormat" };
  const total = Math.round(num * 60);
  if (total < 0) return { minutes: null, error: "common.invalidFormat" };
  return { minutes: total, error: null };
}

function PlaceSuggestions({
  places,
  filter,
  onSelect,
}: {
  places: string[];
  filter: string;
  onSelect: (place: string) => void;
}) {
  const filtered = places.filter((p) =>
    p.toLowerCase().includes(filter.toLowerCase())
  );
  if (filtered.length === 0) return null;
  return (
    <View style={sugStyles.container}>
      {filtered.map((place, i) => (
        <Pressable
          key={i}
          style={({ pressed }) => [
            sugStyles.item,
            pressed && { backgroundColor: Colors.light.background },
            i < filtered.length - 1 && sugStyles.itemBorder,
          ]}
          onPressIn={() => onSelect(place)}
        >
          <Ionicons name="time-outline" size={14} color={Colors.light.textSecondary} style={{ marginRight: 8 }} />
          <Text style={sugStyles.text} numberOfLines={1}>{place}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const sugStyles = StyleSheet.create({
  container: {
    position: "absolute" as const,
    top: "100%" as any,
    left: 0,
    right: 0,
    backgroundColor: Colors.light.surface,
    borderRadius: 10,
    maxHeight: 150,
    zIndex: 999,
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    borderWidth: 1,
    borderColor: Colors.light.border,
    marginTop: 2,
  },
  item: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  itemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  text: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.light.text,
    flex: 1,
  },
});

export default function JornadaCompletaScreen() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { triggerSync } = useSync();
  const [fechaInicio, setFechaInicio] = useState(todayStr());
  const [horaInicio, setHoraInicio] = useState("06:00");
  const [lugarInicio, setLugarInicio] = useState("");
  const [fechaFin, setFechaFin] = useState(todayStr());
  const [horaFin, setHoraFin] = useState(nowTimeStr());
  const [lugarFin, setLugarFin] = useState("");
  const [tipoRuta, setTipoRuta] = useState<TipoRuta>("NACIONAL");
  const [conduccionHoras, setConduccionHoras] = useState("");
  const [conduccionDomingoHoras, setConduccionDomingoHoras] = useState("");
  const [conduccionLunesHoras, setConduccionLunesHoras] = useState("");
  const [pernocta, setPernocta] = useState(false);
  const [dietaModo, setDietaModo] = useState<"AUTO" | "MANUAL">("AUTO");
  const [manualTipo, setManualTipo] = useState<"NACIONAL" | "INTERNACIONAL">("INTERNACIONAL");
  const [manualPct, setManualPct] = useState<"100" | "60" | "30">("100");
  const [plusItems, setPlusItems] = useState<PlusItem[]>([]);
  const [plusConcepto, setPlusConcepto] = useState("");
  const [plusImporte, setPlusImporte] = useState("");

  const [recentPlaces, setRecentPlaces] = useState<string[]>([]);
  const [showLugarInicioSug, setShowLugarInicioSug] = useState(false);
  const [showLugarFinSug, setShowLugarFinSug] = useState(false);

  useEffect(() => {
    getRecentPlaces().then(setRecentPlaces);
    getLastLugarFin().then((lugar) => {
      if (lugar) {
        setLugarInicio((prev) => (prev === "" ? lugar : prev));
      }
    });
  }, []);

  const isCrossSundayMonday = useMemo(() => {
    let resolvedFechaFin = fechaFin;
    if (resolvedFechaFin === fechaInicio && horaFin < horaInicio) {
      const d = new Date(resolvedFechaFin + "T12:00:00");
      d.setDate(d.getDate() + 1);
      resolvedFechaFin = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    return detectCrossSundayMonday(fechaInicio, resolvedFechaFin);
  }, [fechaInicio, horaInicio, fechaFin, horaFin]);

  const crossWeekTimeLabel = useMemo(() => {
    const isSummer = isSpainSummerTime(fechaInicio);
    return isSummer ? "02:00" : "01:00";
  }, [fechaInicio]);

  const conduccionDomingoParsed = useMemo(() => parseConduccionValidated(conduccionDomingoHoras), [conduccionDomingoHoras]);
  const conduccionLunesParsed = useMemo(() => parseConduccionValidated(conduccionLunesHoras), [conduccionLunesHoras]);

  const mutation = useMutation({
    mutationFn: async () => {
      const body: any = {
        fechaInicio,
        horaInicio,
        lugarInicio,
        fechaFin,
        horaFin,
        lugarFin,
        tipoRuta,
        pernocta,
        dietaModo,
      };
      if (isCrossSundayMonday && conduccionDomingoParsed.minutes != null && conduccionLunesParsed.minutes != null) {
        body.conduccionDomingoMin = conduccionDomingoParsed.minutes;
        body.conduccionLunesMin = conduccionLunesParsed.minutes;
        body.conduccionMin = conduccionDomingoParsed.minutes + conduccionLunesParsed.minutes;
      } else {
        const condMin = parseConduccion(conduccionHoras);
        if (condMin != null) {
          body.conduccionMin = condMin;
        }
      }
      if (dietaModo === "MANUAL") {
        body.dietaManualTipo = manualTipo;
        body.dietaManualPct = manualPct;
      }
      body.plusItems = plusItems;
      return crearJornadaCompleta(body);
    },
    onSuccess: () => {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (lugarInicio.trim()) addRecentPlace(lugarInicio.trim());
      if (lugarFin.trim()) addRecentPlace(lugarFin.trim());
      qc.invalidateQueries();
      triggerSync();
      router.back();
    },
    onError: (e: Error) => {
      Alert.alert("Error", e.message);
    },
  });

  const canSave = lugarInicio.trim() && lugarFin.trim() && !mutation.isPending;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.sectionTitle}>{t("jornada.start")}</Text>
      <View style={styles.fieldRow}>
        <View style={styles.fieldHalf}>
          <Text style={styles.fieldLabel}>{t("common.date")}</Text>
          <TextInput style={styles.input} value={fechaInicio} onChangeText={setFechaInicio} placeholder="YYYY-MM-DD" placeholderTextColor="#9CA3AF" />
        </View>
        <View style={styles.fieldHalf}>
          <Text style={styles.fieldLabel}>{t("common.time")}</Text>
          <TextInput style={styles.input} value={horaInicio} onChangeText={setHoraInicio} placeholder="HH:MM" placeholderTextColor="#9CA3AF" />
        </View>
      </View>
      <View style={[styles.field, { zIndex: 10 }]}>
        <Text style={styles.fieldLabel}>{t("common.place")}</Text>
        <View style={{ position: "relative" as const }}>
          <TextInput
            style={styles.input}
            value={lugarInicio}
            onChangeText={(t) => { setLugarInicio(t); setShowLugarInicioSug(true); }}
            onFocus={() => setShowLugarInicioSug(true)}
            onBlur={() => setTimeout(() => setShowLugarInicioSug(false), 200)}
            placeholder="Ciudad / Base"
            placeholderTextColor="#9CA3AF"
          />
          {showLugarInicioSug && recentPlaces.length > 0 && (
            <PlaceSuggestions
              places={recentPlaces}
              filter={lugarInicio}
              onSelect={(p) => { setLugarInicio(p); setShowLugarInicioSug(false); }}
            />
          )}
        </View>
      </View>

      <Text style={[styles.sectionTitle, { marginTop: 16 }]}>{t("jornada.end")}</Text>
      <View style={styles.fieldRow}>
        <View style={styles.fieldHalf}>
          <Text style={styles.fieldLabel}>{t("common.date")}</Text>
          <TextInput style={styles.input} value={fechaFin} onChangeText={setFechaFin} placeholder="YYYY-MM-DD" placeholderTextColor="#9CA3AF" />
        </View>
        <View style={styles.fieldHalf}>
          <Text style={styles.fieldLabel}>{t("common.time")}</Text>
          <TextInput style={styles.input} value={horaFin} onChangeText={setHoraFin} placeholder="HH:MM" placeholderTextColor="#9CA3AF" />
        </View>
      </View>
      <View style={[styles.field, { zIndex: 10 }]}>
        <Text style={styles.fieldLabel}>{t("common.place")}</Text>
        <View style={{ position: "relative" as const }}>
          <TextInput
            style={styles.input}
            value={lugarFin}
            onChangeText={(t) => { setLugarFin(t); setShowLugarFinSug(true); }}
            onFocus={() => setShowLugarFinSug(true)}
            onBlur={() => setTimeout(() => setShowLugarFinSug(false), 200)}
            placeholder="Ciudad / Base"
            placeholderTextColor="#9CA3AF"
          />
          {showLugarFinSug && recentPlaces.length > 0 && (
            <PlaceSuggestions
              places={recentPlaces}
              filter={lugarFin}
              onSelect={(p) => { setLugarFin(p); setShowLugarFinSug(false); }}
            />
          )}
        </View>
      </View>

      <Text style={[styles.sectionTitle, { marginTop: 16 }]}>{t("jornada.details")}</Text>
      <Text style={styles.fieldLabel}>{t("jornada.tripType")}</Text>
      <View style={styles.segmentRow}>
        {(["NACIONAL", "INTERNACIONAL", "REGIONAL_INTL", "NAC_INTL", "NAC_REGIONAL"] as const).map((rt) => (
          <Pressable
            key={rt}
            style={[styles.segmentFlex, tipoRuta === rt && styles.segmentActive]}
            onPress={() => setTipoRuta(rt)}
          >
            <Text style={[styles.segmentTextSmall, tipoRuta === rt && styles.segmentTextActive]}>
              {rt === "NACIONAL" ? t("jornada.nacShort") : rt === "INTERNACIONAL" ? t("jornada.intlShort") : rt === "REGIONAL_INTL" ? t("jornada.regIntlShort") : rt === "NAC_INTL" ? t("jornada.nacIntlShort") : t("jornada.nacRegShort")}
            </Text>
          </Pressable>
        ))}
      </View>

      {isCrossSundayMonday ? (
        <View style={styles.field}>
          <View style={{ backgroundColor: Colors.light.warning + "15", padding: 10, borderRadius: 8, marginBottom: 10 }}>
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.warning, marginBottom: 4 }}>
              {t("jornada.crossSundayMonday")}
            </Text>
            <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textSecondary }}>
              {t("jornada.separateDriving")}
            </Text>
          </View>
          <Text style={styles.fieldLabel}>
            {t("jornada.drivingSundayUntil")} {crossWeekTimeLabel} {t("jornada.ofMonday")}
          </Text>
          <TextInput
            style={[styles.input, conduccionDomingoParsed.error ? { borderColor: Colors.light.danger, borderWidth: 1 } : undefined]}
            value={conduccionDomingoHoras}
            onChangeText={setConduccionDomingoHoras}
            placeholder="Ej: 1 o 1:15"
            placeholderTextColor="#9CA3AF"
            keyboardType="default"
          />
          {conduccionDomingoParsed.error && (
            <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.danger, marginTop: 4 }}>
              {t(conduccionDomingoParsed.error)}
            </Text>
          )}
          <View style={{ height: 10 }} />
          <Text style={styles.fieldLabel}>
            {t("jornada.drivingMondayFrom")} {crossWeekTimeLabel}
          </Text>
          <TextInput
            style={[styles.input, conduccionLunesParsed.error ? { borderColor: Colors.light.danger, borderWidth: 1 } : undefined]}
            value={conduccionLunesHoras}
            onChangeText={setConduccionLunesHoras}
            placeholder="Ej: 8 o 8:30"
            placeholderTextColor="#9CA3AF"
            keyboardType="default"
          />
          {conduccionLunesParsed.error && (
            <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.danger, marginTop: 4 }}>
              {t(conduccionLunesParsed.error)}
            </Text>
          )}
          {conduccionDomingoParsed.minutes != null && conduccionLunesParsed.minutes != null && (
            <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.tint, marginTop: 6 }}>
              Total: {Math.floor((conduccionDomingoParsed.minutes + conduccionLunesParsed.minutes) / 60)}h{((conduccionDomingoParsed.minutes + conduccionLunesParsed.minutes) % 60) > 0 ? `:${String((conduccionDomingoParsed.minutes + conduccionLunesParsed.minutes) % 60).padStart(2, "0")}` : ""}
            </Text>
          )}
        </View>
      ) : (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{t("jornada.driving")}</Text>
          <TextInput
            style={styles.input}
            value={conduccionHoras}
            onChangeText={setConduccionHoras}
            placeholder="Ej: 9 o 9:30 (vacio = auto)"
            placeholderTextColor="#9CA3AF"
            keyboardType="default"
          />
        </View>
      )}

      <View style={styles.fieldRow}>
        <View style={styles.fieldHalf}>
          <Text style={styles.fieldLabel}>{t("jornada.pernocta")}</Text>
          <View style={styles.segmentRow}>
            <Pressable style={[styles.segmentSmall, pernocta && styles.segmentActive]} onPress={() => setPernocta(true)}>
              <Text style={[styles.segmentText, pernocta && styles.segmentTextActive]}>{t("common.yes")}</Text>
            </Pressable>
            <Pressable style={[styles.segmentSmall, !pernocta && styles.segmentActive]} onPress={() => setPernocta(false)}>
              <Text style={[styles.segmentText, !pernocta && styles.segmentTextActive]}>{t("common.no")}</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.fieldHalf}>
          <Text style={styles.fieldLabel}>{t("jornada.dietMode")}</Text>
          <View style={styles.segmentRow}>
            <Pressable style={[styles.segmentSmall, dietaModo === "AUTO" && styles.segmentActive]} onPress={() => setDietaModo("AUTO")}>
              <Text style={[styles.segmentText, dietaModo === "AUTO" && styles.segmentTextActive]}>{t("jornada.auto")}</Text>
            </Pressable>
            <Pressable style={[styles.segmentSmall, dietaModo === "MANUAL" && styles.segmentActive]} onPress={() => setDietaModo("MANUAL")}>
              <Text style={[styles.segmentText, dietaModo === "MANUAL" && styles.segmentTextActive]}>{t("jornada.manual")}</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {dietaModo === "MANUAL" && (
        <>
          <Text style={styles.fieldLabel}>{t("jornada.dietType")}</Text>
          <View style={styles.segmentRow}>
            <Pressable style={[styles.segment, manualTipo === "NACIONAL" && styles.segmentActive]} onPress={() => setManualTipo("NACIONAL")}>
              <Text style={[styles.segmentText, manualTipo === "NACIONAL" && styles.segmentTextActive]}>{t("common.nacional")}</Text>
            </Pressable>
            <Pressable style={[styles.segment, manualTipo === "INTERNACIONAL" && styles.segmentActive]} onPress={() => setManualTipo("INTERNACIONAL")}>
              <Text style={[styles.segmentText, manualTipo === "INTERNACIONAL" && styles.segmentTextActive]}>{t("common.internacional")}</Text>
            </Pressable>
          </View>
          <Text style={styles.fieldLabel}>{t("jornada.dietPercent")}</Text>
          <View style={styles.segmentRow}>
            {(["100", "60", "30"] as const).map((p) => (
              <Pressable key={p} style={[styles.segmentSmall, manualPct === p && styles.segmentActive]} onPress={() => setManualPct(p)}>
                <Text style={[styles.segmentText, manualPct === p && styles.segmentTextActive]}>{p}%</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      <View style={styles.plusSection}>
        <Text style={styles.fieldLabel}>{t("jornada.plusItems")}</Text>
        {plusItems.map((item, idx) => (
          <View key={idx} style={styles.plusItemRow}>
            <Text style={styles.plusItemText} numberOfLines={1}>{item.concepto}</Text>
            <Text style={styles.plusItemAmount}>{item.importe.toFixed(2)} \u20AC</Text>
            <Pressable onPress={() => setPlusItems(prev => prev.filter((_, i) => i !== idx))} hitSlop={6}>
              <Ionicons name="close-circle" size={18} color={Colors.light.danger} />
            </Pressable>
          </View>
        ))}
        <View style={styles.plusAddRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={plusConcepto}
            onChangeText={setPlusConcepto}
            placeholder={t("jornada.concept")}
            placeholderTextColor="#9CA3AF"
          />
          <TextInput
            style={[styles.input, { width: 80, textAlign: "right" as const }]}
            value={plusImporte}
            onChangeText={setPlusImporte}
            placeholder="EUR"
            placeholderTextColor="#9CA3AF"
            keyboardType="decimal-pad"
          />
          <Pressable
            onPress={() => {
              const imp = parseFloat(plusImporte.replace(",", "."));
              if (plusConcepto.trim() && !isNaN(imp) && imp > 0) {
                setPlusItems(prev => [...prev, { concepto: plusConcepto.trim(), importe: imp }]);
                setPlusConcepto("");
                setPlusImporte("");
              }
            }}
            hitSlop={8}
          >
            <Ionicons name="add-circle" size={28} color={Colors.light.tint} />
          </Pressable>
        </View>
        {plusItems.length > 0 && (
          <Text style={styles.plusTotal}>
            {t("jornada.totalPlus")} {plusItems.reduce((s, i) => s + i.importe, 0).toFixed(2)} \u20AC
          </Text>
        )}
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.btnPrimary,
          { opacity: pressed ? 0.85 : 1 },
          !canSave && styles.btnDisabled,
        ]}
        onPress={() => mutation.mutate()}
        disabled={!canSave}
      >
        {mutation.isPending ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <Ionicons name="checkmark-circle" size={20} color="#fff" />
            <Text style={styles.btnText}>{t("jornada.register")}</Text>
          </>
        )}
      </Pressable>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  content: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.tint,
    marginBottom: 8,
  },
  fieldRow: {
    flexDirection: "row" as const,
    gap: 12,
    marginBottom: 8,
  },
  fieldHalf: {
    flex: 1,
  },
  field: {
    marginBottom: 8,
  },
  fieldLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: Colors.light.textSecondary,
    marginBottom: 4,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: Colors.light.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: Colors.light.text,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  segmentRow: {
    flexDirection: "row" as const,
    gap: 6,
    marginBottom: 8,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.light.surface,
    alignItems: "center" as const,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  segmentFlex: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.light.surface,
    alignItems: "center" as const,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  segmentSmall: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.light.surface,
    alignItems: "center" as const,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  segmentActive: {
    backgroundColor: Colors.light.tint,
    borderColor: Colors.light.tint,
  },
  segmentText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.light.text,
  },
  segmentTextSmall: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: Colors.light.text,
  },
  segmentTextActive: {
    color: "#fff",
  },
  btnPrimary: {
    backgroundColor: Colors.light.success,
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    marginTop: 16,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  plusSection: {
    marginTop: 16,
    gap: 6,
  },
  plusItemRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    backgroundColor: Colors.light.surface,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  plusItemText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.light.text,
  },
  plusItemAmount: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.accent,
  },
  plusAddRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  plusTotal: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.tint,
    textAlign: "right" as const,
    marginTop: 2,
  },
});
