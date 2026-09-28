import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { supabase } from "@/lib/supabase";

export type RemoteUpdateConfig = {
  latest_version: string | null;
  min_required_version: string | null;
  minimum_version?: string | null;
  force_update: boolean | null;
  apk_url: string | null;
  app_store_url?: string | null;
  enabled?: boolean | null;
  message: string | null;
};

export type UpdateDecision =
  | { kind: "required"; apkUrl: string | null; minRequiredVersion: string | null; message: string | null }
  | { kind: "ota"; message: string | null }
  | { kind: "optional"; apkUrl: string | null; latestVersion: string | null; message: string | null }
  | { kind: "none" };

function devLog(...args: any[]) {
  if (__DEV__) console.log(...args);
}

function parseVersion(v: string | null | undefined): number[] {
  if (!v) return [0, 0, 0];
  const clean = v.trim().split("-")[0];
  const parts = clean.split(".").slice(0, 3).map((x) => parseInt(x, 10));
  return [
    Number.isFinite(parts[0]) ? parts[0] : 0,
    Number.isFinite(parts[1]) ? parts[1] : 0,
    Number.isFinite(parts[2]) ? parts[2] : 0,
  ];
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

export function getInstalledAppVersion(): string {
  const v =
    (Constants.expoConfig as any)?.version ||
    (Constants as any)?.manifest?.version ||
    (Constants as any)?.manifest2?.extra?.expoClient?.version ||
    "0.0.0";
  return String(v);
}

export function getUpdateChannel(): string | null {
  try {
    const channel = (Updates as any).channel;
    if (typeof channel === "string" && channel.trim()) return channel;
  } catch {}
  return null;
}

export async function fetchRemoteUpdateConfig(): Promise<RemoteUpdateConfig | null> {
  const platform = Platform.OS;
  const channel = getUpdateChannel();
  try {
    const base = supabase.from("app_update_config").select("*").eq("platform", platform);

    let data: any = null;
    if (channel) {
      const first = await base.eq("channel", channel).maybeSingle();
      if (first.error) {
        devLog("[UPDATES] Remote config error:", first.error);
      } else {
        data = first.data ?? null;
      }
    }

    if (!data) {
      const fallback = await base.is("channel", null).maybeSingle();
      if (fallback.error) {
        devLog("[UPDATES] Remote config error:", fallback.error);
        return null;
      }
      data = fallback.data ?? null;
    }

    if (!data) {
      const anyRow = await supabase.from("app_update_config").select("*").eq("platform", platform).limit(1).maybeSingle();
      if (anyRow.error) {
        devLog("[UPDATES] Remote config error:", anyRow.error);
        return null;
      }
      data = anyRow.data ?? null;
    }

    if (!data) return null;
    return {
      latest_version: data.latest_version ?? null,
      min_required_version: data.min_required_version ?? null,
      minimum_version: (data as any).minimum_version ?? null,
      force_update: data.force_update ?? null,
      apk_url: data.apk_url ?? null,
      app_store_url: (data as any).app_store_url ?? null,
      enabled: (data as any).enabled ?? null,
      message: data.message ?? null,
    };
  } catch (e) {
    devLog("[UPDATES] Remote config exception:", e);
    return null;
  }
}

export async function checkOtaUpdateAvailable(): Promise<boolean> {
  if (!Updates.isEnabled) {
    return false;
  }
  try {
    const res = await Updates.checkForUpdateAsync();
    return !!res.isAvailable;
  } catch (e: any) {
    const message = String(e?.message ?? "");
    if (message.includes("not accessible in Expo Go")) return false;
    devLog("[UPDATES] OTA check failed:", e);
    return false;
  }
}

export async function decideUpdateAction(): Promise<{
  currentVersion: string;
  remote: RemoteUpdateConfig | null;
  otaAvailable: boolean;
  decision: UpdateDecision;
}> {
  const currentVersion = getInstalledAppVersion();
  const remote = await fetchRemoteUpdateConfig();

  devLog("[UPDATES] Installed version:", currentVersion);
  devLog("[UPDATES] Channel:", getUpdateChannel());
  devLog("[UPDATES] Remote config:", remote);

  const force = !!remote?.force_update;
  const minReq = remote?.min_required_version ?? remote?.minimum_version ?? null;
  const latest = remote?.latest_version ?? null;
  const url = remote?.apk_url ?? remote?.app_store_url ?? null;

  if (remote && remote.enabled === false) {
    return { currentVersion, remote, otaAvailable: false, decision: { kind: "none" } };
  }

  if (force && minReq && compareVersions(currentVersion, minReq) < 0) {
    devLog("[UPDATES] Force update required. Current < min_required_version", { currentVersion, minReq });
    return {
      currentVersion,
      remote,
      otaAvailable: false,
      decision: { kind: "required", apkUrl: url, minRequiredVersion: minReq, message: remote?.message ?? null },
    };
  }

  const otaAvailable = await checkOtaUpdateAvailable();
  devLog("[UPDATES] OTA available:", otaAvailable);
  if (otaAvailable) {
    return {
      currentVersion,
      remote,
      otaAvailable,
      decision: { kind: "ota", message: remote?.message ?? null },
    };
  }

  if (latest && compareVersions(currentVersion, latest) < 0) {
    devLog("[UPDATES] New version available (store/apk).", { currentVersion, latest, force });
    return {
      currentVersion,
      remote,
      otaAvailable: false,
      decision: { kind: "optional", apkUrl: url, latestVersion: latest, message: remote?.message ?? null },
    };
  }

  return { currentVersion, remote, otaAvailable: false, decision: { kind: "none" } };
}
