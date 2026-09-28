import { QueryClient } from "@tanstack/react-query";
import { Platform } from "react-native";
import Constants from "expo-constants";

export function getApiUrl(): string {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  const domain = process.env.EXPO_PUBLIC_DOMAIN;

  if (Platform.OS !== "web") {
    if (apiUrl) {
      const clean = apiUrl.includes("://") ? apiUrl : `https://${apiUrl}`;
      return clean.replace(/\/$/, "");
    }
    if (domain) {
      const stripped = domain.replace(/:\d+$/, "");
      const clean = stripped.includes("://") ? stripped : `https://${stripped}`;
      return clean.replace(/\/$/, "");
    }
    const extra: any = (Constants.expoConfig as any)?.extra ?? {};
    const extraApiUrl = extra.EXPO_PUBLIC_API_URL ?? extra.apiUrl ?? null;
    if (extraApiUrl) {
      const clean = String(extraApiUrl).includes("://") ? String(extraApiUrl) : `https://${extraApiUrl}`;
      return clean.replace(/\/$/, "");
    }

    const hostUri =
      (Constants.expoConfig as any)?.hostUri ||
      (Constants as any)?.manifest?.debuggerHost ||
      (Constants as any)?.manifest2?.extra?.expoClient?.hostUri ||
      null;
    if (hostUri && typeof hostUri === "string") {
      const hostPart = hostUri.includes("://") ? hostUri.split("://")[1] : hostUri;
      const hostname = hostPart.split("/")[0].split(":")[0];
      if (hostname) return `http://${hostname}:5000`;
    }

    return "http://localhost:5000";
  }

  if (typeof window !== "undefined" && window.location) {
    const { protocol, hostname, host } = window.location;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return `${protocol}//${hostname}:5000`;
    }
    return `${protocol}//${host}`;
  }

  if (domain) {
    return `https://${domain}`;
  }
  return "http://localhost:5000";
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 0,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
