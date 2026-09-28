import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Colors from "@/constants/colors";
import { supabase } from "@/lib/supabase";

type Params = {
  code?: string | string[];
  error?: string | string[];
  error_code?: string | string[];
  error_description?: string | string[];
};

function first(v: string | string[] | undefined): string | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<Params>();
  const code = useMemo(() => first(params.code), [params.code]);
  const error = useMemo(() => first(params.error), [params.error]);
  const errorCode = useMemo(() => first(params.error_code), [params.error_code]);
  const errorDescription = useMemo(() => first(params.error_description), [params.error_description]);

  const [status, setStatus] = useState<"working" | "error">("working");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    const cleanUrl = () => {
      try {
        if (typeof window === "undefined") return;
        window.history.replaceState(null, "", "/auth/callback");
      } catch {}
    };

    const run = async () => {
      if (error || errorCode) {
        const msg = errorDescription || error || errorCode || "OAuth error";
        setStatus("error");
        setMessage(msg);
        cleanUrl();
        return;
      }

      if (!code) {
        setStatus("error");
        setMessage("OAuth callback missing code");
        cleanUrl();
        return;
      }

      const { data, error: exErr } = await supabase.auth.exchangeCodeForSession(code);
      if (exErr) {
        setStatus("error");
        setMessage(exErr.message);
        cleanUrl();
        return;
      }

      cleanUrl();
      router.replace("/(tabs)");
    };

    void run();
  }, [code, error, errorCode, errorDescription]);

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        {status === "working" ? (
          <>
            <ActivityIndicator size="large" color={Colors.light.tint} />
            <Text style={styles.title}>Conectando...</Text>
            <Text style={styles.sub}>Procesando inicio de sesión con Google</Text>
          </>
        ) : (
          <>
            <Text style={styles.title}>Error de inicio de sesión</Text>
            <Text style={styles.sub}>{message}</Text>
            <Pressable style={styles.btn} onPress={() => router.replace("/login")}>
              <Text style={styles.btnText}>Volver a Login</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: Colors.light.surface,
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
  },
  title: {
    marginTop: 14,
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
    textAlign: "center",
  },
  sub: {
    marginTop: 8,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    textAlign: "center",
  },
  btn: {
    marginTop: 16,
    backgroundColor: Colors.light.tint,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  btnText: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },
});
