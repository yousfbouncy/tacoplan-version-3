import { createClient, SupabaseClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";

let extra: Record<string, any> = (Constants.expoConfig?.extra as Record<string, any>) ?? {};
try {
  // Fallback for web/dev where Constants.expoConfig can be undefined
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const appJson = require("../app.json");
  if (appJson?.expo?.extra) {
    extra = { ...extra, ...appJson.expo.extra };
  }
} catch {}
const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  extra.EXPO_PUBLIC_SUPABASE_URL ??
  extra.supabaseUrl;
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_KEY ?? // alias compat
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_KEY ??
  extra.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  extra.EXPO_PUBLIC_SUPABASE_KEY ?? // alias compat
  extra.supabaseAnonKey;

if (!supabaseUrl) {
  throw new Error("supabaseUrl is required");
}
if (!supabaseAnonKey) {
  throw new Error("supabaseAnonKey is required");
}

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: Platform.OS === "web" ? "pkce" : "implicit",
    storage: AsyncStorage as any,
  },
});
