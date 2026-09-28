import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { queryClient } from "@/lib/query-client";
import {
  applyImportBundle,
  buildImportSummaryMessage,
  formatPreviewLines,
  parseImportDocument,
  type ImportMode,
  type ParsedImportBundle,
} from "@/lib/import-service";
import { useAuth } from "@/lib/auth-context";
import type { DayExtraEntry, FerryRestRecord, Jornada, TachoActivity, Viaje } from "@/lib/local-storage";

type Props = {
  extractPdfText?: ((bytes: Uint8Array) => Promise<string | null>) | null;
  legacyPdfFallback?: ((bytes: Uint8Array) => Promise<{
    jornadas?: Jornada[];
    dayExtraEntries?: DayExtraEntry[];
    ferryRests?: FerryRestRecord[];
    viajes?: Viaje[];
    tachoActivities?: TachoActivity[];
  } | null>) | null;
};

type ModeOption = {
  key: ImportMode;
  title: string;
  description: string;
};

const MODE_OPTIONS: ModeOption[] = [
  {
    key: "new_only",
    title: "Solo jornadas nuevas",
    description: "Omite coincidencias detectadas por id o por contenido.",
  },
  {
    key: "overwrite_matching",
    title: "Sobrescribir coincidentes",
    description: "Reemplaza jornadas coincidentes manteniendo el historial actual estable.",
  },
  {
    key: "import_all",
    title: "Importar todo",
    description: "Añade también coincidencias por contenido si no comparten el mismo id.",
  },
];

async function readAssetBytes(asset: DocumentPicker.DocumentPickerAsset): Promise<Uint8Array> {
  const file = (asset as any).file as File | undefined;
  const cloneBytes = (ab: ArrayBuffer) => {
    const src = new Uint8Array(ab);
    const out = new Uint8Array(src.byteLength);
    out.set(src);
    return out;
  };

  if (file && typeof file.arrayBuffer === "function") {
    return cloneBytes(await file.arrayBuffer());
  }

  const res = await fetch(asset.uri);
  if (!res.ok) throw new Error("No se pudo leer el archivo seleccionado");
  return cloneBytes(await res.arrayBuffer());
}

async function readAssetText(asset: DocumentPicker.DocumentPickerAsset): Promise<string> {
  const file = (asset as any).file as File | undefined;
  if (file && typeof file.text === "function") {
    return await file.text();
  }
  const res = await fetch(asset.uri);
  if (!res.ok) throw new Error("No se pudo leer el archivo seleccionado");
  return await res.text();
}

async function askConfirmation(message: string): Promise<boolean> {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.confirm(message);
  }
  return await new Promise<boolean>((resolve) => {
    Alert.alert("Confirmar importación", message, [
      { text: "Cancelar", style: "cancel", onPress: () => resolve(false) },
      { text: "Importar", onPress: () => resolve(true) },
    ]);
  });
}

export default function ImportScreenContent({ extractPdfText, legacyPdfFallback }: Props) {
  const insets = useSafeAreaInsets();
  const { getAccessToken, user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resultMsg, setResultMsg] = useState("");
  const [bundle, setBundle] = useState<ParsedImportBundle | null>(null);
  const [mode, setMode] = useState<ImportMode>("new_only");

  const previewLines = useMemo(() => (bundle ? formatPreviewLines(bundle.preview) : []), [bundle]);

  const duplicateSample = useMemo(() => {
    if (!bundle) return [];
    return bundle.duplicates.slice(0, 6);
  }, [bundle]);

  const clearPreview = () => {
    setBundle(null);
    setResultMsg("");
    setMode("new_only");
  };

  const handlePickFile = async () => {
    setLoading(true);
    setResultMsg("");
    try {
      const pickResult = await DocumentPicker.getDocumentAsync({
        type: ["application/json", "application/pdf"],
        copyToCacheDirectory: true,
      });
      if (pickResult.canceled) return;

      const file = pickResult.assets[0];
      const fileName = file.name || "archivo";
      const lowerName = fileName.toLowerCase();

      let nextBundle: ParsedImportBundle;
      if (lowerName.endsWith(".pdf")) {
        const bytes = await readAssetBytes(file);
        let extractedPdfText: string | null = null;
        if (extractPdfText) {
          try {
            extractedPdfText = await extractPdfText(bytes);
          } catch {
            extractedPdfText = null;
          }
        }
        nextBundle = await parseImportDocument({
          fileName,
          source: "pdf",
          bytes,
          extractedPdfText,
          legacyFallback: legacyPdfFallback,
        });
      } else {
        const text = await readAssetText(file);
        nextBundle = await parseImportDocument({
          fileName,
          source: "json",
          text,
        });
      }

      setBundle(nextBundle);
      setResultMsg(
        nextBundle.duplicates.length > 0
          ? `Archivo leído correctamente. Se han detectado ${nextBundle.duplicates.length} coincidencias.`
          : nextBundle.preview.jornadasCount === 0 && nextBundle.preview.specialRecordsCount === 0 && nextBundle.diagnostics
            ? "Se ha abierto una vista previa de diagnóstico del PDF. Revisa el análisis antes de importar."
            : "Archivo leído correctamente. Revisa la vista previa antes de importar.",
      );
    } catch (error: any) {
      setBundle(null);
      setResultMsg(error?.message || "Error al leer archivo");
    } finally {
      setLoading(false);
    }
  };

  const confirmImport = async () => {
    if (!bundle) {
      setResultMsg("No hay datos para importar");
      return;
    }

    const confirmation = await askConfirmation(
      `Se importará ${bundle.preview.jornadasCount} jornada(s).` +
      `\nModo: ${MODE_OPTIONS.find((option) => option.key === mode)?.title || mode}.` +
      `\nSe creará un backup automático antes de guardar.`,
    );
    if (!confirmation) return;

    setSaving(true);
    try {
      const result = await applyImportBundle(bundle, mode, user ? getAccessToken : null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["jornadas"] }),
        queryClient.invalidateQueries({ queryKey: ["estado-legal"] }),
        queryClient.invalidateQueries({ queryKey: ["compensaciones"] }),
        queryClient.invalidateQueries({ queryKey: ["dietas-resumen"] }),
        queryClient.invalidateQueries({ queryKey: ["km-resumen"] }),
        queryClient.invalidateQueries({ queryKey: ["viaje-resumen"] }),
        queryClient.invalidateQueries({ queryKey: ["all-viajes"] }),
        queryClient.invalidateQueries({ queryKey: ["viajes-en-curso"] }),
        queryClient.invalidateQueries({ queryKey: ["viajes-completados"] }),
        queryClient.invalidateQueries({ queryKey: ["ferry-rests"] }),
        queryClient.invalidateQueries({ queryKey: ["day-extra-entries"] }),
        queryClient.invalidateQueries({ queryKey: ["offsite-weekly-rest-dates"] }),
      ]);
      setResultMsg(`Importación completada. ${buildImportSummaryMessage(bundle, result)}`);
      setBundle(null);
    } catch (error: any) {
      setResultMsg(error?.message || "Error al importar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={Colors.light.text} />
        </Pressable>
        <Text style={styles.title}>Importar</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.card}>
        <Pressable style={styles.importBtn} onPress={handlePickFile} disabled={loading || saving}>
          {loading ? <ActivityIndicator color="#fff" /> : <Ionicons name="cloud-upload-outline" size={20} color="#fff" />}
          <Text style={styles.importText}>{loading ? "Leyendo archivo..." : "Seleccionar JSON / PDF"}</Text>
        </Pressable>
        {!!resultMsg && <Text style={styles.result}>{resultMsg}</Text>}
      </View>

      {bundle ? (
        <View style={styles.previewWrap}>
          <View style={styles.previewHeader}>
            <Text style={styles.previewTitle}>Vista previa</Text>
            <Pressable onPress={clearPreview}>
              <Text style={styles.clearText}>Limpiar</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.previewContent}>
            <View style={styles.summaryCard}>
              <Text style={styles.sectionTitle}>Resumen detectado</Text>
              {previewLines.map((line) => (
                <Text key={line} style={styles.summaryLine}>{line}</Text>
              ))}
              {bundle.generatedAt ? (
                <Text style={styles.summaryMeta}>Generado: {bundle.generatedAt}</Text>
              ) : null}
              {bundle.ownerHint ? (
                <Text style={styles.summaryMeta}>Referencia detectada: {bundle.ownerHint}</Text>
              ) : null}
            </View>

            {bundle.warnings.length > 0 ? (
              <View style={styles.warningCard}>
                <Text style={styles.sectionTitle}>Avisos</Text>
                {bundle.warnings.map((warning) => (
                  <Text key={warning.code} style={styles.warningText}>{warning.message}</Text>
                ))}
              </View>
            ) : null}

            {bundle.diagnostics ? (
              <View style={styles.summaryCard}>
                <Text style={styles.sectionTitle}>Diagnóstico del PDF</Text>
                <Text style={styles.summaryLine}>Páginas detectadas: {bundle.diagnostics.pageCount}</Text>
                <Text style={styles.summaryLine}>Texto extraído: {bundle.diagnostics.textLength} caracteres</Text>
                <Text style={styles.summaryLine}>Secciones: historial {bundle.diagnostics.sections.historial ? "sí" : "no"} · resumen {bundle.diagnostics.sections.resumen ? "sí" : "no"} · detalle {bundle.diagnostics.sections.detalle ? "sí" : "no"} · marcador {bundle.diagnostics.sections.marker ? "sí" : "no"}</Text>
                <Text style={styles.summaryLine}>Fechas: {bundle.diagnostics.dateCount}</Text>
                <Text style={styles.summaryLine}>Horas: {bundle.diagnostics.timeCount}</Text>
                <Text style={styles.summaryLine}>Rutas: {bundle.diagnostics.routeCount}</Text>
                <Text style={styles.summaryLine}>Importes: {bundle.diagnostics.amountCount}</Text>
                <Text style={styles.summaryLine}>Filas candidatas: {bundle.diagnostics.candidateRows}</Text>
                <Text style={styles.summaryLine}>Filas parseadas: {bundle.diagnostics.parsedRows}</Text>
                <Text style={styles.summaryMeta}>Primer bloque parseado: {bundle.diagnostics.firstParsedBlock || "-"}</Text>
                <Text style={styles.summaryMeta}>Último bloque parseado: {bundle.diagnostics.lastParsedBlock || "-"}</Text>
                <Text style={styles.summaryMeta}>Primeras 1000 letras:</Text>
                <Text style={styles.diagnosticText}>{bundle.diagnostics.textPreview || "-"}</Text>
                {bundle.diagnostics.rejectedRows.length > 0 ? (
                  <>
                    <Text style={styles.summaryMeta}>Filas rechazadas:</Text>
                    {bundle.diagnostics.rejectedRows.slice(0, 12).map((row) => (
                      <Text key={`${row.label}-${row.reason}`} style={styles.diagnosticText}>{row.label}: {row.reason}</Text>
                    ))}
                  </>
                ) : null}
              </View>
            ) : null}

            <View style={styles.modeCard}>
              <Text style={styles.sectionTitle}>Cómo importar</Text>
              {MODE_OPTIONS.map((option) => {
                const selected = mode === option.key;
                return (
                  <Pressable
                    key={option.key}
                    style={[styles.modeOption, selected && styles.modeOptionSelected]}
                    onPress={() => setMode(option.key)}
                  >
                    <View style={styles.modeOptionHeader}>
                      <Text style={[styles.modeTitle, selected && styles.modeTitleSelected]}>{option.title}</Text>
                      {selected ? <Ionicons name="checkmark-circle" size={18} color={Colors.light.tint} /> : null}
                    </View>
                    <Text style={styles.modeDescription}>{option.description}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.duplicatesCard}>
              <Text style={styles.sectionTitle}>Duplicados detectados</Text>
              <Text style={styles.summaryLine}>Total: {bundle.duplicates.length}</Text>
              {duplicateSample.map((duplicate) => (
                <Text key={`${duplicate.importedId}-${duplicate.existingId}-${duplicate.by}`} style={styles.duplicateLine}>
                  {duplicate.importedLabel} · {duplicate.by === "id" ? "mismo id" : "misma jornada"}
                </Text>
              ))}
              {bundle.duplicates.length > duplicateSample.length ? (
                <Text style={styles.summaryMeta}>Y {bundle.duplicates.length - duplicateSample.length} coincidencias más.</Text>
              ) : null}
            </View>
          </ScrollView>

          <Pressable style={[styles.confirmBtn, saving && { opacity: 0.75 }]} disabled={saving} onPress={confirmImport}>
            {saving ? <ActivityIndicator color="#fff" /> : <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />}
            <Text style={styles.confirmText}>{saving ? "Importando..." : "Confirmar importación"}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", color: Colors.light.tint },
  card: {
    marginHorizontal: 16,
    backgroundColor: Colors.light.surface,
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  importBtn: {
    backgroundColor: Colors.light.tint,
    borderRadius: 10,
    height: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  importText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 15 },
  result: { color: Colors.light.text, fontFamily: "Inter_400Regular", fontSize: 14 },
  previewWrap: { flex: 1, marginHorizontal: 16, marginTop: 12 },
  previewHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  previewTitle: { fontFamily: "Inter_700Bold", fontSize: 18, color: Colors.light.text },
  clearText: { fontFamily: "Inter_600SemiBold", color: Colors.light.danger, fontSize: 13 },
  previewContent: { paddingBottom: 120, gap: 12 },
  summaryCard: {
    backgroundColor: Colors.light.surface,
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  warningCard: {
    backgroundColor: "#FFF7ED",
    borderRadius: 12,
    padding: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: "#FDBA74",
  },
  modeCard: {
    backgroundColor: Colors.light.surface,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  duplicatesCard: {
    backgroundColor: Colors.light.surface,
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 16, color: Colors.light.text },
  summaryLine: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.light.text },
  summaryMeta: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.light.textSecondary },
  warningText: { fontFamily: "Inter_500Medium", fontSize: 14, color: "#9A3412" },
  modeOption: {
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  modeOptionSelected: {
    borderColor: Colors.light.tint,
    backgroundColor: `${Colors.light.tint}10`,
  },
  modeOptionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  modeTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.light.text },
  modeTitleSelected: { color: Colors.light.tint },
  modeDescription: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.light.textSecondary },
  duplicateLine: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.light.textSecondary },
  diagnosticText: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.light.textSecondary },
  confirmBtn: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 16,
    height: 48,
    borderRadius: 12,
    backgroundColor: Colors.light.success,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  confirmText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15 },
});
