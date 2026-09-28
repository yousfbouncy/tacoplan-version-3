import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as Updates from "expo-updates";
import Colors from "@/constants/colors";
import { decideUpdateAction } from "@/lib/update-service";

type GateStatus =
  | { type: "checking" }
  | { type: "up_to_date" }
  | { type: "ota_available"; message: string | null }
  | { type: "downloading_ota" }
  | { type: "update_required"; apkUrl: string | null; message: string | null; minRequiredVersion: string | null }
  | { type: "update_optional"; apkUrl: string | null; message: string | null; latestVersion: string | null };

function devLog(...args: any[]) {
  if (__DEV__) console.log(...args);
}

export default function UpdateGate() {
  const [status, setStatus] = useState<GateStatus>({ type: "checking" });
  const lastCheckAtRef = useRef<number>(0);
  const checkingRef = useRef(false);

  const runCheck = useCallback(async (reason: string) => {
    if (checkingRef.current) return;
    const now = Date.now();
    if (now - lastCheckAtRef.current < 30_000) return;
    checkingRef.current = true;
    lastCheckAtRef.current = now;

    devLog("[UPDATES] Checking updates:", { reason, platform: Platform.OS });
    setStatus((s) => (s.type === "update_required" ? s : { type: "checking" }));
    try {
      const { decision } = await decideUpdateAction();
      if (decision.kind === "required") {
        setStatus({
          type: "update_required",
          apkUrl: decision.apkUrl,
          message: decision.message,
          minRequiredVersion: decision.minRequiredVersion,
        });
      } else if (decision.kind === "ota") {
        setStatus({ type: "ota_available", message: decision.message });
      } else if (decision.kind === "optional") {
        setStatus({
          type: "update_optional",
          apkUrl: decision.apkUrl,
          message: decision.message,
          latestVersion: decision.latestVersion,
        });
      } else {
        setStatus({ type: "up_to_date" });
      }
    } catch (e) {
      devLog("[UPDATES] Check failed:", e);
      setStatus({ type: "up_to_date" });
    } finally {
      checkingRef.current = false;
    }
  }, []);

  useEffect(() => {
    runCheck("app_start");
  }, [runCheck]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        runCheck("app_resume");
      }
    });
    return () => sub.remove();
  }, [runCheck]);

  const forceVisible = status.type === "update_required";
  const otaVisible = status.type === "ota_available" || status.type === "downloading_ota";
  const optionalVisible = status.type === "update_optional";

  const onOpenUrl = useCallback(async (url: string | null) => {
    if (!url) {
      devLog("[UPDATES] No apk_url configured.");
      return;
    }
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        devLog("[UPDATES] Cannot open url:", url);
        return;
      }
      await Linking.openURL(url);
    } catch (e) {
      devLog("[UPDATES] openURL failed:", e);
    }
  }, []);

  const onUpdateNow = useCallback(async () => {
    if (status.type !== "ota_available") return;
    if (!Updates.isEnabled) {
      devLog("[UPDATES] expo-updates disabled, cannot fetch OTA.");
      setStatus({ type: "up_to_date" });
      return;
    }
    try {
      setStatus({ type: "downloading_ota" });
      devLog("[UPDATES] Downloading OTA update...");
      await Updates.fetchUpdateAsync();
      devLog("[UPDATES] Reloading app...");
      await Updates.reloadAsync();
    } catch (e) {
      devLog("[UPDATES] OTA download/reload failed:", e);
      setStatus({ type: "up_to_date" });
    }
  }, [status]);

  const title = useMemo(() => {
    if (status.type === "ota_available") return "Actualización disponible";
    if (status.type === "update_optional") return "Nueva versión disponible";
    if (status.type === "update_required") return "Actualización obligatoria";
    return "";
  }, [status.type]);

  const body = useMemo(() => {
    if (status.type === "ota_available") {
      return status.message || "Hay una actualización disponible. Puedes actualizar ahora.";
    }
    if (status.type === "update_optional") {
      return status.message || "Hay una versión nueva disponible. Puedes actualizar cuando quieras.";
    }
    if (status.type === "update_required") {
      return status.message || "Debes instalar la nueva actualización para continuar.";
    }
    return "";
  }, [status]);

  return (
    <>
      <Modal visible={forceVisible} transparent={false} animationType="fade">
        <View style={styles.forceRoot}>
          <View style={styles.forceCard}>
            <Text style={styles.forceTitle}>{title}</Text>
            <Text style={styles.forceBody}>{body}</Text>
            <Pressable style={styles.primaryBtn} onPress={() => onOpenUrl(status.type === "update_required" ? status.apkUrl : null)}>
              <Text style={styles.primaryBtnText}>Actualizar</Text>
            </Pressable>
            <Text style={styles.forceMeta}>
              {status.type === "update_required" && status.minRequiredVersion ? `Versión mínima: ${status.minRequiredVersion}` : ""}
            </Text>
          </View>
        </View>
      </Modal>

      <Modal
        visible={otaVisible || optionalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (status.type === "ota_available" || status.type === "update_optional") setStatus({ type: "up_to_date" });
        }}
      >
        <View style={styles.overlay}>
          <View style={styles.card}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.body}>{body}</Text>

            {status.type === "downloading_ota" && (
              <Text style={styles.body}>Descargando…</Text>
            )}

            {status.type === "ota_available" && (
              <View style={styles.row}>
                <Pressable style={[styles.btn, styles.secondaryBtn]} onPress={() => setStatus({ type: "up_to_date" })}>
                  <Text style={styles.secondaryBtnText}>Ahora no</Text>
                </Pressable>
                <Pressable style={[styles.btn, styles.primaryBtn]} onPress={onUpdateNow}>
                  <Text style={styles.primaryBtnText}>Actualizar ahora</Text>
                </Pressable>
              </View>
            )}

            {status.type === "update_optional" && (
              <View style={styles.row}>
                <Pressable style={[styles.btn, styles.secondaryBtn]} onPress={() => setStatus({ type: "up_to_date" })}>
                  <Text style={styles.secondaryBtnText}>Cancelar</Text>
                </Pressable>
                <Pressable style={[styles.btn, styles.primaryBtn]} onPress={() => onOpenUrl(status.apkUrl)}>
                  <Text style={styles.primaryBtnText}>Actualizar</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  forceRoot: {
    flex: 1,
    backgroundColor: Colors.light.background,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  forceCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  forceTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
    marginBottom: 10,
  },
  forceBody: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#374151",
    lineHeight: 20,
    marginBottom: 16,
  },
  forceMeta: {
    marginTop: 10,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#6B7280",
    textAlign: "center",
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 420,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  title: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
    marginBottom: 10,
  },
  body: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#374151",
    lineHeight: 20,
    marginBottom: 16,
  },
  row: {
    flexDirection: "row",
    gap: 10,
  },
  btn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtn: {
    backgroundColor: Colors.light.tint,
  },
  primaryBtnText: {
    color: "#fff",
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  secondaryBtn: {
    backgroundColor: "#F3F4F6",
  },
  secondaryBtnText: {
    color: "#111827",
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
});
