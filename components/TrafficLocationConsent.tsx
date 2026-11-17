import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Platform, Switch, Text, View } from "react-native";
import * as Location from "expo-location";
import { getTrafficLocationConsent, setTrafficLocationConsent } from "@/lib/traffic-location";

export default function TrafficLocationConsent() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    getTrafficLocationConsent()
      .then(value => { if (mounted) setEnabled(value); })
      .catch(() => { if (mounted) setError("Disponible solo para conductores vinculados a una empresa."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);
  const toggle = async (next: boolean) => {
    if (saving) return;
    setSaving(true);setError("");
    try {
      if (next) {
        if (Platform.OS === "web") throw new Error("Actívalo desde Tacoplan móvil.");
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) throw new Error("Debes autorizar el GPS para compartir la ubicación.");
      }
      const actual = await setTrafficLocationConsent(next);
      setEnabled(actual);
      Alert.alert("Localización para Tráfico", actual
        ? "Autorizada durante jornadas activas. Tacoplan podrá responder a consultas cuando esté abierta y con GPS disponible."
        : "Permiso retirado. Tráfico no podrá solicitar nuevas ubicaciones.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el permiso.");
    } finally { setSaving(false); }
  };
  return <View style={{ paddingVertical: 12, borderTopColor: "#26384F", borderTopWidth: 1 }}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: "600", color: "#E7EEF8" }}>Compartir ubicación puntual con Tráfico</Text>
        <Text style={{ marginTop: 5, fontSize: 12, lineHeight: 18, color: "#9BAAC0" }}>
          Solo durante jornadas activas. Tráfico debe tenerte asignado. Sin seguimiento permanente; puedes desactivarlo aquí.
        </Text>
      </View>
      {loading || saving ? <ActivityIndicator color="#51A9FF" /> : <Switch accessibilityLabel="Permitir localización puntual a Tráfico" value={enabled} disabled={!!error && !enabled} onValueChange={value => void toggle(value)} />}
    </View>
    {error ? <Text style={{ marginTop: 7, fontSize: 12, color: "#F6A99F" }}>{error}</Text> : null}
  </View>;
}
