import React, { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { isTrafficTripNotice, tripNoticeEventId, type TrafficTripNotice } from "@/lib/browser-trip-notifications";

type BrowserPermission = NotificationPermission | "unsupported";
let soundContext: AudioContext | null = null;

function unlockTrafficTone() {
  if (typeof window === "undefined") return;
  try {
    const AudioConstructor = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioConstructor) return;
    if (!soundContext) soundContext = new AudioConstructor();
    void soundContext?.resume().catch(() => {});
  } catch {}
}

// The same four-note "tu-tu-tu-tut" melody as Tacoplan's bundled native WAV.
// Browser audio still respects Chrome's autoplay and the Mac's volume/mute settings.
function playTrafficTone() {
  if (!soundContext || soundContext.state !== "running") return;
  try {
    const begin = soundContext.currentTime + 0.02;
    const frequencies = [880, 880, 880, 1175];
    for (let i = 0; i < frequencies.length; i++) {
      const start = begin + i * 0.245;
      const duration = i === 3 ? 0.23 : 0.15;
      const oscillator = soundContext.createOscillator();
      const gain = soundContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequencies[i];
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.16, start + 0.012);
      gain.gain.setValueAtTime(0.16, start + duration - 0.025);
      gain.gain.linearRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(soundContext.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.005);
    }
  } catch {}
}

function showChromeNotification(title: string, body: string, tag: string) {
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  try {
    const notice = new Notification(title, { body, tag });
    notice.onclick = () => {
      window.focus();
      router.push("/(tabs)/viajes");
      notice.close();
    };
  } catch (error) {
    console.warn("[BROWSER-TRIP] Chrome could not display notification", error);
  }
}

function rememberTripAlert(userId: string, eventId: string): boolean {
  // One alert per assignment, even with multiple localhost Chrome tabs open.
  // A single bounded localStorage item avoids accumulating per-trip keys.
  try {
    const key = `tacoplan_browser_trip_seen_${userId}`;
    const now = Date.now();
    const existing = JSON.parse(window.localStorage.getItem(key) || "[]");
    const items: Array<{ id: string; time: number }> = Array.isArray(existing)
      ? existing.filter((item: any) => typeof item?.id === "string" && Number.isFinite(item.time) && now - item.time < 24 * 3600 * 1000)
      : [];
    if (items.some(item => item.id === eventId)) return false;
    items.push({ id: eventId, time: now });
    window.localStorage.setItem(key, JSON.stringify(items.slice(-100)));
  } catch {
    // Private mode may block storage; the tab still receives its notifications.
  }
  return true;
}

const cardStyle = {
  backgroundColor: "#0E2340",
  borderWidth: 1,
  borderColor: "#375B86",
  borderRadius: 16,
  padding: 14,
  marginTop: 8,
  boxShadow: "0 6px 28px rgba(0,0,0,.28)",
} as const;

export default function WebBrowserTripAlerts() {
  const { user } = useAuth();
  const [permission, setPermission] = useState<BrowserPermission>(() =>
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  const [hidden, setHidden] = useState(false);
  const [alert, setAlert] = useState<TrafficTripNotice | null>(null);
  const [requesting, setRequesting] = useState(false);

  const refreshPermission = useCallback(() => {
    setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    window.addEventListener("focus", refreshPermission);
    // Browsers only allow the original alert tone after a user interaction.
    window.addEventListener("pointerdown", unlockTrafficTone, { once: true });
    window.addEventListener("keydown", unlockTrafficTone, { once: true });
    return () => {
      window.removeEventListener("focus", refreshPermission);
      window.removeEventListener("pointerdown", unlockTrafficTone);
      window.removeEventListener("keydown", unlockTrafficTone);
    };
  }, [refreshPermission]);

  useEffect(() => {
    if (Platform.OS !== "web" || !user?.id) return;
    const userId = user.id;
    const channel = supabase
      .channel(`chrome-trip-alerts-${userId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "user_notifications",
        filter: `user_id=eq.${userId}`,
      }, payload => {
        if (!isTrafficTripNotice(payload.new, userId)) return;
        const notice = payload.new;
        const eventId = tripNoticeEventId(notice);
        if (!rememberTripAlert(userId, eventId)) return;
        // Update the Home inbox on an event, never on a repeated timer.
        window.dispatchEvent(new Event("tacoplan:trip-notification"));
        setAlert(notice);
        playTrafficTone();
        showChromeNotification(notice.title, notice.body, `tacoplan-${eventId}`);
      })
      .subscribe(status => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("[BROWSER-TRIP] Realtime channel status:", status);
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const askPermission = async () => {
    // Direct click is required by Chrome; never request permission on page load.
    unlockTrafficTone();
    if (typeof Notification === "undefined") return;
    setRequesting(true);
    try {
      setPermission(await Notification.requestPermission());
    } catch (error) {
      console.warn("[BROWSER-TRIP] Notification permission request failed", error);
    } finally {
      setRequesting(false);
    }
  };

  const test = () => {
    unlockTrafficTone();
    playTrafficTone();
    showChromeNotification("Tacoplan · Prueba de aviso", "El navegador está preparado para avisar de nuevos viajes.", "tacoplan-test-chrome");
  };

  if (Platform.OS !== "web") return null;
  if (hidden && !alert) return null;

  return (
    <View pointerEvents="box-none" style={{
      position: "fixed" as any, right: 14, bottom: 14,
      width: 348, maxWidth: "calc(100vw - 28px)" as any,
      zIndex: 10000,
    }}>
      {alert ? (
        <View style={cardStyle}>
          <Text style={{ color: "#7CC7FF", fontWeight: "700", marginBottom: 5 }}>Nuevo viaje de Tráfico</Text>
          <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 16 }}>{alert.title}</Text>
          <Text style={{ color: "#CEDDF0", marginTop: 5 }}>{alert.body}</Text>
          <View style={{ flexDirection: "row", marginTop: 12, gap: 14 }}>
            <Pressable onPress={() => { setAlert(null); router.push("/(tabs)/viajes"); }}>
              <Text style={{ color: "#70C2FF", fontWeight: "700" }}>Ver viaje</Text>
            </Pressable>
            <Pressable onPress={() => setAlert(null)}>
              <Text style={{ color: "#C8D8EA" }}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {!hidden ? (
        <View style={cardStyle}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 14 }}>Avisos de Tacoplan en Chrome</Text>
            <Pressable accessibilityRole="button" onPress={() => setHidden(true)}>
              <Text style={{ color: "#B7CBE6", fontSize: 18 }}>×</Text>
            </Pressable>
          </View>
          <Text style={{ color: "#B7CBE6", fontSize: 12, marginTop: 6, lineHeight: 18 }}>
            {permission === "granted"
              ? "Notificaciones activadas. Recibirás avisos con Tacoplan abierto en Chrome."
              : permission === "denied"
              ? "Chrome tiene bloqueados los avisos. Permítelos desde el icono de ajustes del sitio y comprueba también Ajustes del Sistema de macOS."
              : permission === "unsupported"
              ? "El navegador no admite las notificaciones de escritorio."
              : "Autoriza las notificaciones para recibir avisos de viajes y sonido mientras Tacoplan esté abierto."}
          </Text>
          {permission === "granted" ? (
            <Pressable accessibilityRole="button" onPress={test} style={{ marginTop: 10 }}>
              <Text style={{ color: "#70C2FF", fontWeight: "700" }}>Probar notificación y sonido</Text>
            </Pressable>
          ) : permission === "default" ? (
            <Pressable accessibilityRole="button" disabled={requesting} onPress={() => void askPermission()}
              style={{ marginTop: 12, alignSelf: "flex-start", backgroundColor: "#2178E4", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 }}>
              <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>{requesting ? "Solicitando…" : "Activar avisos Chrome"}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
