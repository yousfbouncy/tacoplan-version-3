import React, { useState, useMemo, memo, useEffect } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  TextInput,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";

type DietType = "INTERNACIONAL" | "NACIONAL" | "REGIONAL";
type DietPercentage = 100 | 60 | 30;
type SinDiet = "SIN_DIETA";

export type PlusItemUi = {
  concepto: string;
  amount: number;
  id: string;
  selected?: boolean;
};

export interface DetectedDiet {
  date: string;
  type: DietType;
  percentage: DietPercentage;
  amount: number;
  location?: string | null;
  previousJourneyId?: string | null;
  nextJourneyId?: string | null;
  isBaseArrivalDay?: boolean;

  // Campos richer mejora:
  previousJourneyStartAt?: string | null;
  previousJourneyEndAt?: string | null;
  previousJourneyLugarInicio?: string | null;
  previousJourneyLugarFin?: string | null;
  arrivesAtBase?: boolean;
  arrivalHHMM?: string | null;
  nextJourneyStartAt?: string | null;
  nextJourneyLugarInicio?: string | null;
  isDomingo?: boolean;
  isFestivo?: boolean;
  motivo?: string;
  plusItems?: PlusItemUi[];

  // Campos user-editable dentro del modal (mutables):
  userPercentage?: DietPercentage | SinDiet | null;
  userAmount?: number;
  removed?: boolean;
}

export interface PendingNaturalDietsModalProps {
  visible: boolean;
  detected: DetectedDiet[];
  onClose: () => void;
  onConfirm: (items: DetectedDiet[] | string[]) => Promise<void> | void;
  loading?: boolean;
  /** Función para recalcular importe en vivo al cambiar %. Si no se pasa, usa amount original. */
  findRate?: (type: DietType, percentage: DietPercentage) => number;
  /** Configuración de importes automáticos para Domingo y Festivo (tarifas de Settings). */
  autoPlusesCfg?: { sunday: number; holiday: number };
  // Modo edición: abrir modal para EDITAR 1 sola dieta ya guardada (en vez de detección pendiente).
  // - editMode=true => título cambia, NO se puede eliminar la fila, confirmar llama a onConfirmEditMode.
  // - initialEditItems: array de 1 elemento (la dieta) convertida a DetectedDiet (llamador historial hace la conversión)
  // - onConfirmEditMode: callback guardado, recibe los items resultantes (igual estructura DetectedDiet)
  editMode?: boolean;
  initialEditItems?: DetectedDiet[];
  onConfirmEditMode?: (items: DetectedDiet[]) => Promise<void> | void;
}

const normalizeFechaES = (fechaISO: string): string => {
  if (!fechaISO) return "";
  const [year, month, day] = fechaISO.split("-");
  if (!year || !month || !day) return fechaISO;
  return `${day}/${month}/${year}`;
};

const horaHHMMfromISO = (iso?: string | null): string | null => {
  if (!iso) return null;
  // "2026-09-10T15:30:00.000Z" o "2026-09-10T15:30"
  const m = String(iso).match(/T(\d{1,2}:\d{2})/);
  if (m) return m[1];
  return null;
};

const fechaESplusHHMM = (iso?: string | null): string => {
  if (!iso) return "";
  const datePart = String(iso).slice(0, 10);
  const hh = horaHHMMfromISO(iso);
  return (datePart ? normalizeFechaES(datePart) : "") + (hh ? ` a las ${hh}` : "");
};

const getTypePillStyle = (type: DietType) => {
  switch (type) {
    case "INTERNACIONAL":
      return { backgroundColor: "#FEF3C7", color: "#92400E", label: "Internacional" };
    case "NACIONAL":
      return { backgroundColor: "#EEF2FF", color: "#3730A3", label: "Nacional" };
    case "REGIONAL":
      return { backgroundColor: "#EEF2FF", color: "#3730A3", label: "Regional" };
  }
};

function PendingNaturalDietsModal({
  visible,
  detected,
  onClose,
  onConfirm,
  loading = false,
  findRate,
  autoPlusesCfg,
  editMode = false,
  initialEditItems,
  onConfirmEditMode,
}: PendingNaturalDietsModalProps) {
  const sundayAmt = Math.max(0, Number(autoPlusesCfg?.sunday) || 0);
  const holidayAmt = Math.max(0, Number(autoPlusesCfg?.holiday) || 0);

  // sourceItems: en editMode, initialEditItems tiene prioridad
  const sourceItems: DetectedDiet[] = editMode && initialEditItems && initialEditItems.length > 0
    ? initialEditItems
    : detected;

  // selected = fecha seleccionada para guardar (checkbox principal)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // percentages: date -> pct user seleccionado (null=sin dieta)
  const [percentages, setPercentages] = useState<Map<string, DietPercentage | SinDiet | null>>(new Map());
  // removed dates (usuario pulsa eliminar fila)
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  // plus selections: `date||plusId` => bool
  const [plusSel, setPlusSel] = useState<Map<string, boolean>>(new Map());
  // cards expandidas (show all fields collapsed/expanded)
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // manual plus inputs por fecha: concepto + texto importe (string porque es input)
  const [manualPlusConcepto, setManualPlusConcepto] = useState<Map<string, string>>(new Map());
  const [manualPlusAmount, setManualPlusAmount] = useState<Map<string, string>>(new Map());
  // manual pluses AÑADIDOS por fecha (persisten dentro de la sesión modal): date => PlusItemUi[]
  // Estos pluses SIEMPRE van seleccionados por defecto, y se pueden quitar con checkbox o eliminar con 🗑️
  const [manualPlusesByDate, setManualPlusesByDate] = useState<Map<string, PlusItemUi[]>>(new Map());
  // Flags Domingo/Festivo editables por el usuario dentro del modal (inicialmente: los que vengan de detected)
  const [domingoByDate, setDomingoByDate] = useState<Map<string, boolean>>(new Map());
  const [festivoByDate, setFestivoByDate] = useState<Map<string, boolean>>(new Map());

  useEffect(() => {
    if (visible) {
      const s = new Set<string>();
      const p = new Map<string, DietPercentage | SinDiet | null>();
      const ps = new Map<string, boolean>();
      const r = new Set<string>();
      const dm = new Map<string, boolean>();
      const fm = new Map<string, boolean>();
      const mp = new Map<string, PlusItemUi[]>();
      for (const d of sourceItems) {
        if (!d.removed) s.add(d.date);
        if (d.removed) r.add(d.date);
        if (d.isBaseArrivalDay) {
          p.set(d.date, null);
        } else if (d.userPercentage) {
          p.set(d.date, d.userPercentage as DietPercentage | SinDiet);
        } else {
          p.set(d.date, d.percentage);
        }
        // Flags Domingo/Festivo iniciales
        dm.set(d.date, !!d.isDomingo);
        fm.set(d.date, !!d.isFestivo);
        // Plus built-in + pluses existentes: seleccionar por defecto
        if (Array.isArray(d.plusItems) && d.plusItems.length > 0) {
          for (const pl of d.plusItems) {
            const plKey = `${d.date}||${pl.id}`;
            if (pl.selected !== false) ps.set(plKey, true);
            // Los pluses ya existentes NO vuelven a entrar como "manuales" para no duplicarlos;
            // los recuperamos via getAllPlusesForDate desde el item originalmente.
          }
          // Extraer pluses manuales que NO sean built-in y meterlos en manualPlusesByDate
          // para que se muestren en la sección "Añadir plus manual" (con 🗑️ editable).
          const manuales = d.plusItems.filter((pl) =>
            pl.id !== "auto_domingo" && pl.id !== "auto_festivo"
          );
          if (manuales.length > 0) mp.set(d.date, manuales);
        }
        if (d.isDomingo && sundayAmt > 0) ps.set(`${d.date}||auto_domingo`, true);
        if (d.isFestivo && holidayAmt > 0) ps.set(`${d.date}||auto_festivo`, true);
      }
      setSelected(s);
      setPercentages(p);
      setPlusSel(ps);
      setRemoved(r);
      setDomingoByDate(dm);
      setFestivoByDate(fm);
      setManualPlusesByDate(mp);
      setExpanded(new Set(editMode && sourceItems[0]?.date ? [sourceItems[0].date] : []));
      setManualPlusConcepto(new Map());
      setManualPlusAmount(new Map());
    }
  }, [visible, sourceItems, sundayAmt, holidayAmt, editMode]);

  const toggleDate = (date: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const toggleExpand = (date: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(date)) n.delete(date);
      else n.add(date);
      return n;
    });
  };

  const setPct = (date: string, pct: DietPercentage | SinDiet | null) => {
    setPercentages((prev) => {
      const n = new Map(prev);
      n.set(date, pct);
      return n;
    });
    // Asegurar que "sin dieta" => NO añade NDDE (lo gestionamos en confirm)
  };

  const removeRow = (date: string) => {
    setRemoved((prev) => new Set(prev).add(date));
    setSelected((prev) => {
      const n = new Set(prev);
      n.delete(date);
      return n;
    });
  };

  const toggleDomingo = (date: string) => {
    const willBeActive = !(domingoByDate.get(date) === true);
    setDomingoByDate((prev) => {
      const n = new Map(prev);
      n.set(date, willBeActive);
      return n;
    });
    setPlusSel((prev) => {
      const n = new Map(prev);
      const key = `${date}||auto_domingo`;
      if (willBeActive && sundayAmt > 0) n.set(key, true);
      else n.delete(key);
      return n;
    });
  };

  const toggleFestivo = (date: string) => {
    const willBeActive = !(festivoByDate.get(date) === true);
    setFestivoByDate((prev) => {
      const n = new Map(prev);
      n.set(date, willBeActive);
      return n;
    });
    setPlusSel((prev) => {
      const n = new Map(prev);
      const key = `${date}||auto_festivo`;
      if (willBeActive && holidayAmt > 0) n.set(key, true);
      else n.delete(key);
      return n;
    });
  };

  const togglePlus = (date: string, plusId: string) => {
    setPlusSel((prev) => {
      const n = new Map(prev);
      const key = `${date}||${plusId}`;
      n.set(key, !n.get(key));
      return n;
    });
  };

  const addManualPlus = (date: string) => {
    const conceptoRaw = manualPlusConcepto.get(date) || "";
    const concepto = conceptoRaw.trim();
    const amountStr = manualPlusAmount.get(date) || "";
    const amountNum = parseFloat(amountStr.replace(",", "."));
    if (!concepto) {
      Alert.alert("Concepto obligatorio", "Introduce un concepto para el plus antes de añadirlo.");
      return;
    }
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      Alert.alert("Importe inválido", "Introduce un importe numérico mayor que 0.");
      return;
    }
    const id = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const newPlus: PlusItemUi = {
      id,
      concepto: concepto.slice(0, 120),
      amount: +(amountNum).toFixed(2),
      selected: true,
    };
    setManualPlusesByDate((prev) => {
      const n = new Map(prev);
      const list = n.get(date) || [];
      n.set(date, [...list, newPlus]);
      return n;
    });
    setPlusSel((prev) => {
      const n = new Map(prev);
      n.set(`${date}||${id}`, true);
      return n;
    });
    setManualPlusConcepto((prev) => {
      const n = new Map(prev);
      n.delete(date);
      return n;
    });
    setManualPlusAmount((prev) => {
      const n = new Map(prev);
      n.delete(date);
      return n;
    });
  };

  const deleteManualPlus = (date: string, plusId: string) => {
    setManualPlusesByDate((prev) => {
      const n = new Map(prev);
      const list = (n.get(date) || []).filter((p) => p.id !== plusId);
      if (list.length === 0) n.delete(date);
      else n.set(date, list);
      return n;
    });
    setPlusSel((prev) => {
      const n = new Map(prev);
      n.set(`${date}||${plusId}`, false);
      return n;
    });
  };

  // Devuelve los pluses "built-in" de Domingo y Festivo para una fecha
  const getBuiltinPlusesForDate = (date: string): PlusItemUi[] => {
    const out: PlusItemUi[] = [];
    const dom = domingoByDate.get(date);
    const fest = festivoByDate.get(date);
    if (dom && sundayAmt > 0) {
      out.push({
        id: "auto_domingo",
        concepto: "Domingo",
        amount: +sundayAmt.toFixed(2),
        selected: plusSel.get(`${date}||auto_domingo`) !== false,
      });
    }
    if (fest && holidayAmt > 0) {
      out.push({
        id: "auto_festivo",
        concepto: "Festivo",
        amount: +holidayAmt.toFixed(2),
        selected: plusSel.get(`${date}||auto_festivo`) !== false,
      });
    }
    return out;
  };

  // Unión de pluses (FUENTE DE VERDAD ÚNICA):
  //   Prioridad (misma id → última gana y las demás se descartan):
  //     1. manualPlusesByDate (usuario gestiona 🗑 añadir/eliminar aquí)
  //     2. built-in Domingo/Festivo (toggle checkbox)
  //     3. item.plusItems original (solo IDs que no estén en 1 ni en 2)
  //   Así NUNCA hay duplicados (bug "2 filas iguales de Formación")
  const getAllPlusesForDate = (item: DetectedDiet): PlusItemUi[] => {
    const manual = manualPlusesByDate.get(item.date) || [];
    const builtin = getBuiltinPlusesForDate(item.date);
    const sourcePlus = Array.isArray(item.plusItems) ? item.plusItems : [];
    const manualIds = new Set(manual.map(p => p.id));
    const builtinIds = new Set(builtin.map(p => p.id));
    const fromSource = sourcePlus.filter(pl => !manualIds.has(pl.id) && !builtinIds.has(pl.id));
    const merged: PlusItemUi[] = [];
    const seen = new Set<string>();
    for (const pl of [...manual, ...builtin, ...fromSource]) {
      if (seen.has(pl.id)) continue;
      seen.add(pl.id);
      merged.push(pl);
    }
    return merged;
  };

  const computeAmountForItem = (item: DetectedDiet): number => {
    const pctRaw = percentages.get(item.date);
    if (pctRaw === "SIN_DIETA") return 0;
    const pct: DietPercentage | null = (pctRaw as DietPercentage | null) ?? null;
    if (!pct) return 0; // sin elección aún
    if (typeof findRate === "function") {
      return Number(findRate(item.type, pct)) || 0;
    }
    // fallback: proporcional respecto al percentage original
    if (item.percentage > 0 && item.amount != null) {
      return +(item.amount * (pct / item.percentage)).toFixed(2);
    }
    return 0;
  };

  const computePlusForItem = (item: DetectedDiet): number => {
    const all = getAllPlusesForDate(item);
    if (all.length === 0) return 0;
    let sum = 0;
    for (const pl of all) {
      if (plusSel.get(`${item.date}||${pl.id}`) !== false) {
        sum += Number(pl.amount) || 0;
      }
    }
    return +sum.toFixed(2);
  };

  const visibleItems = useMemo(
    () => sourceItems.filter((d) => !removed.has(d.date)),
    [sourceItems, removed]
  );

  const totalAmount = useMemo(() => {
    let sum = 0;
    for (const item of visibleItems) {
      if (!selected.has(item.date)) continue;
      sum += computeAmountForItem(item);
      sum += computePlusForItem(item);
    }
    return +sum.toFixed(2);
  }, [visibleItems, selected, percentages, plusSel, findRate, sourceItems]);

  const hasPendingArrivalWithoutPct = useMemo(() => {
    for (const item of visibleItems) {
      if (!selected.has(item.date)) continue;
      if (item.isBaseArrivalDay) {
        const pct = percentages.get(item.date);
        if (!pct) return true; // obliga a elegir
      }
    }
    return false;
  }, [visibleItems, selected, percentages]);

  const handleConfirm = async () => {
    // Build richer confirmed items with final user choices
    const finalItems: DetectedDiet[] = [];
    for (const item of visibleItems) {
      if (editMode) {
        // En editMode NO se evalúa selected/removed (siempre se guarda la única fila editada)
      } else {
        if (!selected.has(item.date)) continue;
        if (removed.has(item.date)) continue;
      }
      const pctRaw = percentages.get(item.date);
      if (item.isBaseArrivalDay && !pctRaw) continue; // espera elegir
      if (pctRaw === "SIN_DIETA") continue;
      const finalPct = (pctRaw as DietPercentage) ?? item.percentage;
      const finalAmount = computeAmountForItem(item);
      const finalIsDomingo = domingoByDate.get(item.date) === true;
      const finalIsFestivo = festivoByDate.get(item.date) === true;
      const finalPlusesPre: PlusItemUi[] = getAllPlusesForDate(item)
        .filter((pl) => plusSel.get(`${item.date}||${pl.id}`) !== false)
        .map((pl) => ({
          id: pl.id,
          concepto: pl.concepto,
          amount: Number(pl.amount) || 0,
          selected: true,
        }));
      const finalPluses: PlusItemUi[] = [];
      const finalSeenPluses = new Set<string>();
      for (const pl of finalPlusesPre) {
        if (finalSeenPluses.has(pl.id)) continue;
        finalSeenPluses.add(pl.id);
        finalPluses.push(pl);
      }
      finalItems.push({
        ...item,
        userPercentage: finalPct,
        userAmount: finalAmount,
        removed: false,
        plusItems: finalPluses,
        isDomingo: finalIsDomingo,
        isFestivo: finalIsFestivo,
      });
    }
    if (editMode) {
      // Modo edición: siempre hay 1 sola fila; no queremos depender de selected para guardar
      if (typeof onConfirmEditMode === "function") {
        // Si user seleccionó SIN_DIETA → finalItems.length=0; enviamos array vacío para que caller maneje borrado/SIN_DIETA
        await onConfirmEditMode(finalItems);
      }
    } else {
      // Modo detección pendiente: enviamos DetectedDiet[] richer (con userPercentage, plusItems, removed).
      try {
        await onConfirm(finalItems);
      } catch (e) {
        // Fallback extremo: si onConfirm espera solo fechas string, probar con dates
        console.warn("[PendingNaturalDietsModal] onConfirm falló con objetos, reintentando con fechas:", e);
        try {
          await (onConfirm as any)(finalItems.map((i) => i.date));
        } catch (e2) {
          console.error("[PendingNaturalDietsModal] onConfirm fallback también falló:", e2);
        }
      }
    }
  };

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <Ionicons
                name="restaurant-outline"
                size={24}
                color={Colors.light.tint}
              />
              <Text style={styles.title}>
                {editMode ? "Editar dieta fuera de base" : "Dietas pendientes fuera de base"}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons
                name="close-circle-outline"
                size={26}
                color={Colors.light.textSecondary}
              />
            </Pressable>
          </View>

          <Text style={styles.subtitle}>
            Revisa cada día, confirma porcentaje y pluses antes de guardar.
            Los días de llegada a base requieren elegir porcentaje obligatoriamente.
          </Text>

          {visibleItems.length === 0 ? (
            <>
              <View style={styles.emptyState}>
                <Ionicons
                  name="checkmark-circle"
                  size={48}
                  color={Colors.light.success}
                />
                <Text style={styles.emptyText}>
                  No hay días pendientes detectados.
                </Text>
              </View>
              <Pressable
                style={({ pressed }) => [
                  styles.singleButton,
                  { opacity: pressed ? 0.85 : 1 },
                ]}
                onPress={onClose}
              >
                <Text style={styles.singleButtonText}>Cerrar</Text>
              </Pressable>
            </>
          ) : (
            <>
              <ScrollView
                style={styles.listScroll}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={true}
              >
                {visibleItems.map((item) => {
                  const isChecked = selected.has(item.date);
                  const pillStyle = getTypePillStyle(item.type);
                  const isExpanded = expanded.has(item.date);
                  const pctRaw = percentages.get(item.date);
                  const isSinDieta = pctRaw === "SIN_DIETA";
                  const arrivalPctPending = Boolean(item.isBaseArrivalDay && !pctRaw);
                  const liveAmount = computeAmountForItem(item);
                  const livePlus = computePlusForItem(item);
                  const plusList = getAllPlusesForDate(item);

                  const pctOptions: Array<{ label: string; value: DietPercentage | SinDiet | null }> = [
                    { label: "100%", value: 100 },
                    { label: "60%", value: 60 },
                    { label: "30%", value: 30 },
                    { label: "Sin dieta", value: "SIN_DIETA" },
                  ];

                  return (
                    <View key={item.date} style={[styles.row, { padding: 0 }]}>
                      {/* Row header + checkbox */}
                      <Pressable
                        style={({ pressed }) => [
                          styles.rowHeader,
                          { opacity: pressed ? 0.92 : 1 },
                        ]}
                        onPress={() => editMode ? toggleExpand(item.date) : toggleDate(item.date)}
                      >
                        <View style={styles.checkboxOuter}>
                          {(editMode || isChecked) ? (
                            <View style={styles.checkboxChecked}>
                              <Ionicons
                                name="checkmark"
                                size={16}
                                color="#FFFFFF"
                              />
                            </View>
                          ) : (
                            <View style={styles.checkboxUnchecked} />
                          )}
                        </View>
                        <View style={styles.rowContent}>
                          <View style={styles.rowTop}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                              <Text style={styles.dateText}>
                                {normalizeFechaES(item.date)}
                              </Text>
                              {item.isBaseArrivalDay && (
                                <View style={[styles.pillBase, { backgroundColor: "#ECFDF5" }]}>
                                  <Text style={{ fontSize: 11, color: "#065F46", fontWeight: "700" }}>
                                    Llegada a base
                                  </Text>
                                </View>
                              )}
                              {domingoByDate.get(item.date) === true && (
                                <View style={[styles.pillBase, { backgroundColor: "#FFF7ED" }]}>
                                  <Text style={{ fontSize: 11, color: "#9A3412", fontWeight: "700" }}>
                                    Domingo
                                  </Text>
                                </View>
                              )}
                              {festivoByDate.get(item.date) === true && (
                                <View style={[styles.pillBase, { backgroundColor: "#FCE7F3" }]}>
                                  <Text style={{ fontSize: 11, color: "#9D174D", fontWeight: "700" }}>
                                    Festivo
                                  </Text>
                                </View>
                              )}
                            </View>
                            <Text style={styles.amountText}>
                              {Number(liveAmount + livePlus).toFixed(2)} €
                            </Text>
                          </View>

                          {item.location ? (
                            <Text style={styles.locationText}>
                              📍 {item.location}
                            </Text>
                          ) : null}

                          <View style={styles.pillsRow}>
                            <View
                              style={[
                                styles.pill,
                                { backgroundColor: pillStyle.backgroundColor },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.pillText,
                                  { color: pillStyle.color },
                                ]}
                              >
                                {pillStyle.label}
                              </Text>
                            </View>
                            <View style={styles.pillPercentage}>
                              <Text style={styles.pillPercentageText}>
                                {isSinDieta ? "Sin dieta" : pctRaw ? `${pctRaw}%` : "Seleccionar %"}
                              </Text>
                            </View>
                          </View>

                          {/* Actions: Expand + Remove row */}
                          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6, gap: 8 }}>
                            <Pressable
                              hitSlop={8}
                              onPress={() => toggleExpand(item.date)}
                              style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                            >
                              <Ionicons
                                name={isExpanded ? "chevron-up" : "chevron-down"}
                                size={14}
                                color={Colors.light.textSecondary}
                              />
                              <Text style={{ fontSize: 12, color: Colors.light.textSecondary }}>
                                {isExpanded ? "Ocultar detalles" : "Ver todos los datos"}
                              </Text>
                            </Pressable>
                            {!editMode && (
                              <Pressable
                                hitSlop={8}
                                onPress={() => removeRow(item.date)}
                                style={styles.removeBtn}
                              >
                                <Ionicons name="trash-outline" size={14} color="#B91C1C" />
                                <Text style={{ fontSize: 12, color: "#B91C1C", fontWeight: "600", marginLeft: 4 }}>
                                  Eliminar
                                </Text>
                              </Pressable>
                            )}
                          </View>

                          {arrivalPctPending && (
                            <View style={styles.pendingArrival}>
                              <Ionicons name="alert-circle" size={14} color="#B45309" />
                              <Text style={{ fontSize: 12, color: "#92400E", marginLeft: 6 }}>
                                Selecciona porcentaje obligatorio antes de guardar.
                              </Text>
                            </View>
                          )}
                        </View>
                      </Pressable>

                      {/* Expandible detalle */}
                      {isExpanded && (
                        <View style={styles.expandBlock}>
                          {/* ROW 1: Jornada anterior + Fin jornada anterior */}
                          <View style={styles.twoCols}>
                            <View style={styles.cell}>
                              <Text style={styles.fieldLabel}>Jornada anterior (inicio)</Text>
                              <Text style={styles.fieldValue}>
                                {fechaESplusHHMM(item.previousJourneyStartAt) || "—"}
                              </Text>
                            </View>
                            <View style={styles.cell}>
                              <Text style={styles.fieldLabel}>Fin jornada anterior</Text>
                              <Text style={styles.fieldValue}>
                                {fechaESplusHHMM(item.previousJourneyEndAt) || "—"}
                              </Text>
                            </View>
                          </View>

                          {/* ROW 2: Origen + Destino */}
                          <View style={styles.twoCols}>
                            <View style={styles.cell}>
                              <Text style={styles.fieldLabel}>Origen (anterior)</Text>
                              <Text style={styles.fieldValue}>
                                {item.previousJourneyLugarInicio || "—"}
                              </Text>
                            </View>
                            <View style={styles.cell}>
                              <Text style={styles.fieldLabel}>Destino (anterior)</Text>
                              <Text style={styles.fieldValue}>
                                {item.previousJourneyLugarFin || item.location || "—"}
                              </Text>
                            </View>
                          </View>

                          {/* ROW 3: Llegada a base + hora */}
                          <View style={styles.twoCols}>
                            <View style={styles.cell}>
                              <Text style={styles.fieldLabel}>Llegada a base</Text>
                              <Text style={[styles.fieldValue, { fontWeight: "700", color: item.arrivesAtBase ? "#065F46" : "#374151" }]}>
                                {item.arrivesAtBase ? "Sí" : "No"}
                              </Text>
                            </View>
                            <View style={styles.cell}>
                              <Text style={styles.fieldLabel}>Hora de llegada</Text>
                              <Text style={styles.fieldValue}>
                                {item.arrivesAtBase && item.arrivalHHMM ? `${item.arrivalHHMM} h` : "—"}
                              </Text>
                            </View>
                          </View>

                          {/* ROW 4: Día detectado + Tipo */}
                          <View style={styles.twoCols}>
                            <View style={styles.cell}>
                              <Text style={styles.fieldLabel}>Día de dieta detectado</Text>
                              <Text style={styles.fieldValue}>
                                {normalizeFechaES(item.date)}
                              </Text>
                            </View>
                            <View style={styles.cell}>
                              <Text style={styles.fieldLabel}>Tipo de dieta</Text>
                              <Text style={[styles.fieldValue, { fontWeight: "700" }]}>
                                {pillStyle.label}
                              </Text>
                            </View>
                          </View>

                          {/* ROW 5: Porcentaje selector + Importe live */}
                          <View style={{ marginTop: 10 }}>
                            <Text style={styles.fieldLabel}>Porcentaje de dieta</Text>
                            <View style={styles.pctGrid}>
                              {pctOptions.map((opt) => {
                                const active = pctRaw === opt.value;
                                const isSin = opt.value === "SIN_DIETA";
                                return (
                                  <Pressable
                                    key={String(opt.value)}
                                    style={({ pressed }) => [
                                      styles.pctBtn,
                                      active && !isSin && styles.pctBtnActive,
                                      active && isSin && styles.pctBtnSin,
                                      { opacity: pressed ? 0.85 : 1 },
                                    ]}
                                    onPress={() => setPct(item.date, opt.value)}
                                  >
                                    <Text
                                      style={[
                                        styles.pctBtnText,
                                        active && !isSin && { color: "#FFFFFF" },
                                        active && isSin && { color: "#7F1D1D" },
                                      ]}
                                    >
                                      {opt.label}
                                    </Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                          </View>

                          {/* ROW 6: Importe dieta + Domingo/Festivo checkboxes interactivos + Motivo */}
                          <View style={[styles.twoCols, { marginTop: 10 }]}>
                            <View style={styles.cell}>
                              <Text style={styles.fieldLabel}>Importe dieta</Text>
                              <Text style={[styles.fieldValue, { fontSize: 16, color: Colors.light.tint, fontWeight: "700" }]}>
                                {liveAmount.toFixed(2)} €
                              </Text>
                            </View>
                            <View style={styles.cell}>
                              <Text style={styles.fieldLabel}>Domingo · Festivo (toca para cambiar)</Text>
                              <View style={{ flexDirection: "column", gap: 6, marginTop: 2 }}>
                                <Pressable
                                  onPress={() => toggleDomingo(item.date)}
                                  style={({ pressed }) => [
                                    {
                                      flexDirection: "row",
                                      alignItems: "center",
                                      gap: 10,
                                      paddingVertical: 4,
                                      paddingHorizontal: 2,
                                      opacity: pressed ? 0.85 : 1,
                                    },
                                  ]}
                                >
                                  <View style={styles.checkboxOuter}>
                                    {domingoByDate.get(item.date) === true ? (
                                      <View style={[styles.checkboxChecked, { backgroundColor: "#C2410C" }]}>
                                        <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                                      </View>
                                    ) : (
                                      <View style={styles.checkboxUnchecked} />
                                    )}
                                  </View>
                                  <Text style={{ fontSize: 13, color: "#9A3412", fontWeight: "600" }}>
                                    Domingo
                                  </Text>
                                  {domingoByDate.get(item.date) === true && sundayAmt > 0 && (
                                    <Text style={{ fontSize: 12, color: Colors.light.textSecondary, marginLeft: "auto" }}>
                                      +{sundayAmt.toFixed(2)} €
                                    </Text>
                                  )}
                                </Pressable>

                                <Pressable
                                  onPress={() => toggleFestivo(item.date)}
                                  style={({ pressed }) => [
                                    {
                                      flexDirection: "row",
                                      alignItems: "center",
                                      gap: 10,
                                      paddingVertical: 4,
                                      paddingHorizontal: 2,
                                      opacity: pressed ? 0.85 : 1,
                                    },
                                  ]}
                                >
                                  <View style={styles.checkboxOuter}>
                                    {festivoByDate.get(item.date) === true ? (
                                      <View style={[styles.checkboxChecked, { backgroundColor: "#9D174D" }]}>
                                        <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                                      </View>
                                    ) : (
                                      <View style={styles.checkboxUnchecked} />
                                    )}
                                  </View>
                                  <Text style={{ fontSize: 13, color: "#9D174D", fontWeight: "600" }}>
                                    Festivo
                                  </Text>
                                  {festivoByDate.get(item.date) === true && holidayAmt > 0 && (
                                    <Text style={{ fontSize: 12, color: Colors.light.textSecondary, marginLeft: "auto" }}>
                                      +{holidayAmt.toFixed(2)} €
                                    </Text>
                                  )}
                                </Pressable>
                              </View>
                            </View>
                          </View>

                          <View style={{ marginTop: 8 }}>
                            <Text style={styles.fieldLabel}>Motivo de detección</Text>
                            <Text style={styles.fieldValue}>
                              {item.motivo || "Dieta fuera de base no registrada"}
                            </Text>
                          </View>

                          {/* Pluses asociados y manuales */}
                          <View style={styles.plusSection}>
                            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                              <Text style={{ fontSize: 13, fontWeight: "700", color: Colors.light.text }}>
                                Pluses {plusList.length > 0 ? `(${plusList.length})` : ""}
                              </Text>
                              <Text style={{ fontSize: 12, color: Colors.light.textSecondary }}>
                                {livePlus.toFixed(2)} €
                              </Text>
                            </View>

                            {plusList.length === 0 && (
                              <Text style={{ fontSize: 12, color: Colors.light.textSecondary, marginBottom: 10, opacity: 0.7 }}>
                                No hay pluses asociados. Añade uno manualmente abajo.
                              </Text>
                            )}

                            {plusList.map((pl) => {
                              const key = `${item.date}||${pl.id}`;
                              const ok = plusSel.get(key) !== false;
                              const isManual = pl.id.startsWith("manual_");
                              return (
                                <View key={pl.id} style={styles.plusRow}>
                                  <Pressable
                                    onPress={() => togglePlus(item.date, pl.id)}
                                    style={({ pressed }) => [
                                      { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, opacity: pressed ? 0.9 : 1 },
                                    ]}
                                  >
                                    <View style={styles.checkboxOuter}>
                                      {ok ? (
                                        <View style={styles.checkboxChecked}>
                                          <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                                        </View>
                                      ) : (
                                        <View style={styles.checkboxUnchecked} />
                                      )}
                                    </View>
                                    <View style={{ flex: 1 }}>
                                      <Text style={{ fontSize: 13, fontWeight: "600", color: Colors.light.text }}>
                                        {pl.concepto}
                                      </Text>
                                      <Text style={{ fontSize: 11.5, color: Colors.light.textSecondary, opacity: 0.8 }}>
                                        {isManual
                                          ? "Plus manual. Puedes eliminarlo con la papelera."
                                          : "Plus de la jornada origen. No se duplicará con jornadas."}
                                      </Text>
                                    </View>
                                  </Pressable>
                                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                    <Text style={{ fontSize: 13, fontWeight: "700", color: Colors.light.text }}>
                                      {Number(pl.amount).toFixed(2)} €
                                    </Text>
                                    {isManual && (
                                      <Pressable
                                        hitSlop={8}
                                        onPress={() => deleteManualPlus(item.date, pl.id)}
                                        style={({ pressed }) => [
                                          styles.plusDeleteBtn,
                                          { opacity: pressed ? 0.7 : 1 },
                                        ]}
                                      >
                                        <Ionicons name="trash-outline" size={15} color="#B91C1C" />
                                      </Pressable>
                                    )}
                                  </View>
                                </View>
                              );
                            })}

                            {/* Añadir plus manual */}
                            <View style={styles.addPlusBlock}>
                              <Text style={[styles.fieldLabel, { marginBottom: 6 }]}>Añadir plus manual</Text>
                              <View style={{ marginBottom: 6 }}>
                                <TextInput
                                  style={styles.textInput}
                                  placeholder="Concepto: ej. Kilómetros extra, Peaje, Dieta hotel..."
                                  placeholderTextColor="#9CA3AF"
                                  value={manualPlusConcepto.get(item.date) || ""}
                                  onChangeText={(text) => {
                                    setManualPlusConcepto((prev) => {
                                      const n = new Map(prev);
                                      n.set(item.date, text);
                                      return n;
                                    });
                                  }}
                                  maxLength={120}
                                />
                              </View>
                              <View style={{ flexDirection: "row", gap: 8 }}>
                                <TextInput
                                  style={[styles.textInput, { flex: 1 }]}
                                  placeholder="0.00"
                                  placeholderTextColor="#9CA3AF"
                                  keyboardType="decimal-pad"
                                  value={manualPlusAmount.get(item.date) || ""}
                                  onChangeText={(text) => {
                                    setManualPlusAmount((prev) => {
                                      const n = new Map(prev);
                                      n.set(item.date, text);
                                      return n;
                                    });
                                  }}
                                />
                                <Pressable
                                  style={({ pressed }) => [
                                    styles.addPlusBtn,
                                    { opacity: pressed ? 0.85 : 1 },
                                  ]}
                                  onPress={() => addManualPlus(item.date)}
                                >
                                  <Ionicons name="add" size={16} color="#FFFFFF" />
                                  <Text style={styles.addPlusBtnText}>Añadir plus</Text>
                                </Pressable>
                              </View>
                            </View>
                          </View>
                        </View>
                      )}
                    </View>
                  );
                })}
              </ScrollView>

              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total (dietas + pluses seleccionados)</Text>
                <Text style={styles.totalValue}>
                  {totalAmount.toFixed(2)} €
                </Text>
              </View>

              {hasPendingArrivalWithoutPct && (
                <View style={[styles.pendingArrival, { marginTop: 10, marginBottom: -2 }]}>
                  <Ionicons name="alert-circle" size={16} color="#B45309" />
                  <Text style={{ fontSize: 12, color: "#92400E", marginLeft: 6 }}>
                    Hay días de llegada a base sin porcentaje seleccionado (no asumimos 100%).
                  </Text>
                </View>
              )}

              <View style={styles.buttonsRow}>
                <Pressable
                  style={({ pressed }) => [
                    styles.cancelBtn,
                    { opacity: pressed ? 0.85 : 1 },
                  ]}
                  onPress={onClose}
                  disabled={loading}
                >
                  <Text style={styles.cancelBtnText}>Cancelar</Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.confirmBtn,
                    (loading || (!editMode && selected.size === 0) || hasPendingArrivalWithoutPct) && { opacity: 0.5 },
                    pressed ? { opacity: 0.85 } : null,
                  ]}
                  onPress={handleConfirm}
                  disabled={loading || (!editMode && selected.size === 0) || hasPendingArrivalWithoutPct}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.confirmBtnText}>
                      {editMode ? "Guardar cambios" : `Guardar ${selected.size} dieta(s)`}
                    </Text>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15,20,30,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    backgroundColor: "#FFFFFF",
    width: "94%",
    maxWidth: 560,
    maxHeight: "92%",
    borderRadius: 16,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
    color: Colors.light.text,
    flex: 1,
  },
  subtitle: {
    fontSize: 13.5,
    color: Colors.light.text,
    opacity: 0.85,
    marginBottom: 16,
    lineHeight: 20,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
    gap: 12,
  },
  emptyText: {
    fontSize: 15,
    color: Colors.light.textSecondary,
    textAlign: "center",
  },
  singleButton: {
    backgroundColor: Colors.light.tint,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 16,
  },
  singleButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
  listScroll: {
    maxHeight: 520,
  },
  listContent: {
    gap: 10,
  },
  row: {
    borderRadius: 12,
    backgroundColor: "#F8F9FA",
    overflow: "hidden",
  },
  rowHeader: {
    flexDirection: "row",
    padding: 12,
    gap: 12,
  },
  checkboxOuter: {
    paddingTop: 2,
  },
  checkboxChecked: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.light.tint,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxUnchecked: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: "#C4C9D1",
  },
  rowContent: {
    flex: 1,
    gap: 4,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dateText: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.light.text,
  },
  amountText: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.light.tint,
  },
  locationText: {
    fontSize: 13,
    opacity: 0.7,
    color: Colors.light.text,
  },
  pillsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
    flexWrap: "wrap",
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
  },
  pillText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  pillPercentage: {
    backgroundColor: "#E5E7EB",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  pillPercentageText: {
    fontSize: 11,
    fontWeight: "600",
    color: Colors.light.text,
  },
  pillBase: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  removeBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "rgba(185, 28, 28, 0.08)",
  },
  pendingArrival: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    backgroundColor: "#FFFBEB",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  expandBlock: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 4,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.06)",
  },
  twoCols: {
    flexDirection: "row",
    gap: 12,
    marginTop: 10,
  },
  cell: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: 11.5,
    color: Colors.light.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.3,
    fontWeight: "700",
    marginBottom: 3,
  },
  fieldValue: {
    fontSize: 13.5,
    color: Colors.light.text,
    lineHeight: 18,
  },
  pctGrid: {
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
    flexWrap: "wrap",
  },
  pctBtn: {
    flex: 1,
    minWidth: 80,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  pctBtnActive: {
    backgroundColor: Colors.light.tint,
    borderColor: Colors.light.tint,
  },
  pctBtnSin: {
    backgroundColor: "#FEE2E2",
    borderColor: "#FCA5A5",
  },
  pctBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.light.text,
  },
  plusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.05)",
    gap: 8,
  },
  plusSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.06)",
  },
  plusDeleteBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: "rgba(185, 28, 28, 0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  addPlusBlock: {
    marginTop: 12,
    padding: 10,
    backgroundColor: "#F8F9FA",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.05)",
  },
  textInput: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 9,
    fontSize: 13,
    color: Colors.light.text,
  },
  addPlusBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: Colors.light.tint,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 9,
  },
  addPlusBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.1)",
    marginTop: 12,
    paddingTop: 12,
  },
  totalLabel: {
    fontSize: 14,
    opacity: 0.8,
    color: Colors.light.text,
  },
  totalValue: {
    fontSize: 20,
    fontWeight: "bold",
    color: Colors.light.text,
  },
  buttonsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 16,
    gap: 10,
  },
  cancelBtn: {
    flex: 0.45,
    backgroundColor: Colors.light.border,
    opacity: 0.4,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.light.text,
  },
  confirmBtn: {
    flex: 0.55,
    backgroundColor: Colors.light.tint,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFFFFF",
    textAlign: "center",
  },
});

export default memo(PendingNaturalDietsModal);
