import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, AppState, Linking, Platform, Pressable, Switch, Text, View } from "react-native";
const openDeviceSettings = async () => {
  if (Platform.OS === "web") return;
  if (typeof Linking?.openSettings === "function") await Linking.openSettings();
};
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { getTrafficLocationConsent, setTrafficLocationConsent } from "@/lib/traffic-location";

type PermissionState = {
  location: "granted" | "denied" | "undetermined";
  background: "granted" | "denied" | "undetermined";
  notifications: "granted" | "denied" | "undetermined";
  gpsEnabled: boolean;
  locationCanAskAgain: boolean;
  notificationsCanAskAgain: boolean;
};
const titleStyle = { fontSize: 14, fontWeight: "600" as const, color: "#E7EEF8" };
const captionStyle = { marginTop: 4, fontSize: 12, lineHeight: 18, color: "#9BAAC0" };
const label = (s: PermissionState[keyof PermissionState]) =>
  s === "granted" ? "Autorizado" : s === "denied" ? "No autorizado" : "Sin decidir";

export default function TrafficLocationConsent() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [permissions, setPermissions] = useState<PermissionState | null>(null);
  const checkPermissions = useCallback(async () => {
    if (Platform.OS === "web") return;
    setChecking(true);
    try {
      const [foreground, background, notice, gpsEnabled] = await Promise.all([
        Location.getForegroundPermissionsAsync(),
        Location.getBackgroundPermissionsAsync(),
        Notifications.getPermissionsAsync(),
        Location.hasServicesEnabledAsync(),
      ]);
      const notificationGranted = notice.granted || (Platform.OS === "ios" && notice.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL);
      setPermissions({
        location: foreground.status,
        background: background.status,
        notifications: notificationGranted ? "granted" : notice.status,
        gpsEnabled,
        locationCanAskAgain: foreground.canAskAgain,
        notificationsCanAskAgain: notice.canAskAgain,
      });
    } catch {
      setError("No se han podido comprobar los permisos del sistema.");
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    let mounted = true;
    getTrafficLocationConsent()
      .then(value => { if (mounted) setEnabled(value); })
      .catch(() => { if (mounted) setError("Disponible solo para conductores vinculados a una empresa."); })
      .finally(() => { if (mounted) setLoading(false); });
    void checkPermissions();
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") void checkPermissions();
    });
    return () => { mounted = false; subscription.remove(); };
  }, [checkPermissions]);

  const askNotifications = async () => {
    if (saving) return;
    setSaving(true); setError("");
    try {
      const current = await Notifications.getPermissionsAsync();
      if (!current.granted) {
        if (current.canAskAgain) await Notifications.requestPermissionsAsync();
        else await openDeviceSettings();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo solicitar permiso de notificaciones.");
    } finally {
      await checkPermissions(); setSaving(false);
    }
  };

  const toggle = async (next: boolean) => {
    if (saving) return;
    setSaving(true); setError("");
    try {
      if (next) {
        if (Platform.OS === "web") throw new Error("Actívalo desde Tacoplan móvil.");
        const permission = await Location.getForegroundPermissionsAsync();
        const granted = permission.granted ? permission : permission.canAskAgain
          ? await Location.requestForegroundPermissionsAsync()
          : permission;
        if (!granted.granted) {
          if (!granted.canAskAgain) {
            Alert.alert("GPS no autorizado", "Activa «Permitir mientras se usa» en los ajustes del teléfono.", [
              { text: "Cancelar", style: "cancel" },
              { text: "Ajustes", onPress: () => { void openDeviceSettings(); } },
            ]);
          }
          throw new Error("Debes permitir la ubicación mientras se usa la aplicación.");
        }
      }
      const actual = await setTrafficLocationConsent(next);
      setEnabled(actual);
      Alert.alert("Localización para Tráfico", actual
        ? "Autorizada durante jornadas activas. Responderá automáticamente con Tacoplan abierta. En segundo plano no está garantizado."
        : "Permiso retirado. Tráfico no podrá solicitar nuevas ubicaciones.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el permiso.");
    } finally {
      await checkPermissions(); setSaving(false);
    }
  };

  return <View style={{ paddingVertical: 12, borderTopColor: "#26384F", borderTopWidth: 1 }}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={titleStyle}>Compartir ubicación puntual con Tráfico</Text>
        <Text style={captionStyle}>Solo en jornada activa y con tu autorización. Tráfico debe tenerte asignado. Sin seguimiento continuo; puedes desactivarlo aquí.</Text>
      </View>
      {loading || saving ? <ActivityIndicator color="#51A9FF" /> : <Switch accessibilityLabel="Permitir localización puntual a Tráfico" value={enabled} onValueChange={value => void toggle(value)} />}
    </View>
    <View style={{ marginTop: 12, gap: 6 }}>
      <Text style={titleStyle}>Permisos detectados en este dispositivo</Text>
      <Text style={captionStyle}>Ubicación mientras se usa: {permissions ? label(permissions.location) : "Comprobando…"}</Text>
      <Text style={captionStyle}>GPS del teléfono: {permissions ? permissions.gpsEnabled ? "Activado" : "Desactivado" : "Comprobando…"}</Text>
      <Text style={captionStyle}>Notificaciones: {permissions ? label(permissions.notifications) : "Comprobando…"}</Text>
      <Text style={captionStyle}>Ubicación en segundo plano: {permissions ? label(permissions.background) : "Comprobando…"}</Text>
      <Text style={captionStyle}>La ubicación «solo mientras se usa» permite consultar el GPS con Tacoplan abierta. Activar ejecución en segundo plano por sí solo no permite recibir esta solicitud ni obtener GPS con la app en segundo plano. Para ello haría falta un servicio autorizado adicional.</Text>
      {permissions?.notifications !== "granted" ? <Pressable accessibilityRole="button" disabled={saving || checking} onPress={() => { void askNotifications(); }} style={{ paddingVertical: 8 }}><Text style={{ color: "#67B9FF", fontWeight: "600" }}>Autorizar notificaciones</Text></Pressable> : null}
      {permissions?.location !== "granted" || permissions?.gpsEnabled === false ? <Pressable accessibilityRole="button" onPress={() => { void openDeviceSettings(); }} style={{ paddingVertical: 8 }}><Text style={{ color: "#67B9FF", fontWeight: "600" }}>Abrir ajustes de ubicación</Text></Pressable> : null}
      <Pressable accessibilityRole="button" disabled={checking} onPress={() => { void checkPermissions(); }} style={{ paddingVertical: 6 }}><Text style={{ color: "#67B9FF" }}>{checking ? "Comprobando permisos…" : "Volver a comprobar permisos"}</Text></Pressable>
    </View>
    {error ? <Text style={{ marginTop: 7, fontSize: 12, color: "#F6A99F" }}>{error}</Text> : null}
  </View>;
}
