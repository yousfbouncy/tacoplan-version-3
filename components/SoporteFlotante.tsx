import { useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

/** Acceso directo de soporte, sin sustituir ningún botón de jornada. */
export default function SoporteFlotante() {
  const [abierto, setAbierto] = useState(false);
  const abrir = async (url: string) => {
    try {
      await Linking.openURL(url);
      setAbierto(false);
    } catch {
      Alert.alert("No se pudo abrir", "Comprueba que tienes una aplicación compatible.");
    }
  };
  return (
    <View style={styles.contenedor} pointerEvents="box-none">
      {abierto && (
        <View style={styles.menu}>
          <Text style={styles.titulo}>¿Necesitas ayuda?</Text>
          <Pressable accessibilityRole="button" onPress={() => abrir("https://wa.me/34614314054?text=Hola%2C%20soy%20usuario%20de%20Tacoplan%20y%20necesito%20ayuda%20con%20la%20aplicaci%C3%B3n.")} style={styles.opcion}>
            <Ionicons name="logo-whatsapp" size={20} color="#215077" /><Text style={styles.etiqueta}>WhatsApp</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => abrir("mailto:?subject=Ayuda%20con%20Tacoplan")} style={styles.opcion}>
            <Ionicons name="mail-outline" size={20} color="#215077" /><Text style={styles.etiqueta}>Correo electrónico</Text>
          </Pressable>
        </View>
      )}
      <Pressable accessibilityRole="button" accessibilityLabel={abierto ? "Cerrar soporte" : "Abrir soporte Tacoplan"} onPress={() => setAbierto(!abierto)} style={styles.boton}>
        <Ionicons name={abierto ? "close" : "headset-outline"} size={25} color="#fff" />
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  contenedor: { position: "absolute", right: 0, bottom: 78, alignItems: "flex-end", paddingHorizontal: 20, paddingBottom: 10 },
  boton: { width: 52, height: 52, borderRadius: 26, backgroundColor: "#215077", alignItems: "center", justifyContent: "center", elevation: 4 },
  menu: { borderRadius: 16, padding: 14, marginBottom: 8, backgroundColor: "#fff", borderColor: "#dde6ef", borderWidth: 1, minWidth: 220 },
  titulo: { color: "#152f4b", fontWeight: "700", fontSize: 15, marginBottom: 6 },
  opcion: { flexDirection: "row", alignItems: "center", gap: 9, minHeight: 44 },
  etiqueta: { color: "#152f4b", fontSize: 14 },
});
