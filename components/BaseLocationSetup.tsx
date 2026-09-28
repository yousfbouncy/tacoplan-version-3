import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Colors from "@/constants/colors";
import { saveUserConfig } from "@/lib/config-service";
import { userScopedKey } from "@/lib/user-scope";

type Props = {
  userId: string;
  onComplete: () => void;
  allowSkipOnce?: boolean;
  onSkip?: () => void;
};

const SETTINGS_KEY = "tacoplan_user_settings";

export default function BaseLocationSetup({ userId, onComplete, allowSkipOnce = false, onSkip }: Props) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [baseName, setBaseName] = useState("");
  const [baseCity, setBaseCity] = useState("");
  const [baseCountry, setBaseCountry] = useState("");
  const [baseAddress, setBaseAddress] = useState("");
  const [baseLatitude, setBaseLatitude] = useState("");
  const [baseLongitude, setBaseLongitude] = useState("");
  const [baseRadiusKm, setBaseRadiusKm] = useState("20");

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(await userScopedKey(SETTINGS_KEY, userId));
        const settings = raw ? JSON.parse(raw) : {};
        setBaseName(settings.base_name ?? "");
        setBaseCity(settings.base_city ?? "");
        setBaseCountry(settings.base_country ?? "");
        setBaseAddress(settings.base_address ?? "");
        setBaseLatitude(settings.base_latitude != null ? String(settings.base_latitude) : "");
        setBaseLongitude(settings.base_longitude != null ? String(settings.base_longitude) : "");
        setBaseRadiusKm(settings.base_radius_km != null ? String(settings.base_radius_km) : "20");
      } catch {}
      setLoading(false);
    })();
  }, [userId]);

  function validate(): string | null {
    if (!baseName.trim()) return "Indica el nombre de tu base.";
    if (!baseCity.trim()) return "Indica la ciudad de tu base.";
    if (!baseCountry.trim()) return "Indica el país de tu base.";
    const radius = parseFloat(baseRadiusKm.replace(",", "."));
    if (!Number.isFinite(radius) || radius <= 0) return "El radio de base debe ser mayor que 0.";
    return null;
  }

  async function handleSave() {
    const error = validate();
    if (error) {
      if (Platform.OS === "web") window.alert(error);
      else Alert.alert("Error", error);
      return;
    }
    setSaving(true);
    try {
      await saveUserConfig(userId, {
        settings: {
          base_name: baseName.trim(),
          base_city: baseCity.trim(),
          base_country: baseCountry.trim(),
          base_address: baseAddress.trim(),
          base_latitude: baseLatitude.trim(),
          base_longitude: baseLongitude.trim(),
          base_radius_km: baseRadiusKm.trim() || "20",
        },
      });
      onComplete();
    } catch (e: any) {
      const message = e?.message || String(e);
      if (Platform.OS === "web") window.alert(message);
      else Alert.alert("Error", message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={Colors.light.tint} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 32 : 0) }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Ionicons name="business-outline" size={34} color={Colors.light.tint} />
          <Text style={styles.title}>Lugar de base</Text>
          <Text style={styles.subtitle}>
            Indica tu lugar de base para mejorar el cálculo de descansos semanales, descansos fuera de base y compensaciones.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Nombre del lugar o base</Text>
          <TextInput
            style={styles.input}
            value={baseName}
            onChangeText={setBaseName}
            placeholder="Base Abrera"
            placeholderTextColor={Colors.light.textSecondary}
          />

          <Text style={styles.label}>Ciudad</Text>
          <TextInput
            style={styles.input}
            value={baseCity}
            onChangeText={setBaseCity}
            placeholder="Abrera"
            placeholderTextColor={Colors.light.textSecondary}
          />

          <Text style={styles.label}>País</Text>
          <TextInput
            style={styles.input}
            value={baseCountry}
            onChangeText={setBaseCountry}
            placeholder="España"
            placeholderTextColor={Colors.light.textSecondary}
          />

          <Text style={styles.label}>Dirección opcional</Text>
          <TextInput
            style={styles.input}
            value={baseAddress}
            onChangeText={setBaseAddress}
            placeholder="Dirección o centro operativo"
            placeholderTextColor={Colors.light.textSecondary}
          />

          <View style={styles.row}>
            <View style={styles.half}>
              <Text style={styles.label}>Latitud opcional</Text>
              <TextInput
                style={styles.input}
                value={baseLatitude}
                onChangeText={setBaseLatitude}
                keyboardType="decimal-pad"
                placeholder="41.5167"
                placeholderTextColor={Colors.light.textSecondary}
              />
            </View>
            <View style={styles.half}>
              <Text style={styles.label}>Longitud opcional</Text>
              <TextInput
                style={styles.input}
                value={baseLongitude}
                onChangeText={setBaseLongitude}
                keyboardType="decimal-pad"
                placeholder="1.9020"
                placeholderTextColor={Colors.light.textSecondary}
              />
            </View>
          </View>

          <Text style={styles.label}>Radio de base (km)</Text>
          <TextInput
            style={styles.input}
            value={baseRadiusKm}
            onChangeText={setBaseRadiusKm}
            keyboardType="decimal-pad"
            placeholder="20"
            placeholderTextColor={Colors.light.textSecondary}
          />
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        {allowSkipOnce && onSkip ? (
          <Pressable style={styles.skipButton} onPress={onSkip}>
            <Text style={styles.skipText}>Posponer una vez</Text>
          </Pressable>
        ) : null}
        <Pressable style={[styles.saveButton, saving && styles.disabled]} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveText}>Guardar lugar de base</Text>}
        </Pressable>
      </View>
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
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.light.background,
  },
  content: {
    padding: 20,
    paddingBottom: 120,
  },
  header: {
    alignItems: "center",
    gap: 8,
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  card: {
    backgroundColor: Colors.light.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  half: {
    flex: 1,
  },
  label: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
    marginTop: 10,
    marginBottom: 6,
  },
  input: {
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.light.text,
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: Colors.light.background,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
    gap: 10,
  },
  saveButton: {
    backgroundColor: Colors.light.tint,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
  },
  saveText: {
    color: "#fff",
    fontFamily: "Inter_700Bold",
    fontSize: 15,
  },
  skipButton: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  skipText: {
    color: Colors.light.textSecondary,
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  disabled: {
    opacity: 0.6,
  },
});
