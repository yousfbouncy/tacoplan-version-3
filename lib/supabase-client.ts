import { createClient, SupabaseClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiUrl } from "@/lib/query-client";

const CONFIG_CACHE_KEY = "tacoplan_supabase_config";

let _client: SupabaseClient | null = null;
let _configPromise: Promise<{ supabaseUrl: string; supabaseAnonKey: string }> | null = null;

async function fetchConfig(): Promise<{ supabaseUrl: string; supabaseAnonKey: string }> {
  try {
    const cached = await AsyncStorage.getItem(CONFIG_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.supabaseUrl && parsed.supabaseAnonKey) return parsed;
    }
  } catch {}

  const base = getApiUrl();
  const url = new URL("/api/auth/config", base).toString();
  const res = await fetch(url);
  const data = await res.json();

  if (data.supabaseUrl && data.supabaseAnonKey) {
    await AsyncStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(data));
  }

  return data;
}

export async function getSupabaseClient(): Promise<SupabaseClient> {
  if (_client) return _client;

  if (!_configPromise) {
    _configPromise = fetchConfig();
  }

  const config = await _configPromise;
  _client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      storage: AsyncStorage as any,
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  return _client;
}
