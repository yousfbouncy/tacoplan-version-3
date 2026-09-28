// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function findServiceRoleKey(maybe: unknown): string | null {
  if (!maybe || typeof maybe !== "object") return null;
  const stack: any[] = [maybe];
  const seen = new Set<any>();
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const [k, v] of Object.entries(cur)) {
      const key = String(k).toLowerCase();
      if (typeof v === "string" && key.includes("service") && key.includes("role")) return v;
      if (key === "service_role" && typeof v === "string") return v;
      if (key === "service_role_key" && typeof v === "string") return v;
      if (key === "service_role_key_v1" && typeof v === "string") return v;
      if (typeof v === "object" && v != null) stack.push(v);
    }
  }
  return null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function normalizeQ(q: unknown): string {
  if (typeof q !== "string") return "";
  return q.trim().toLowerCase();
}

function compareSemver(a: string | null | undefined, b: string | null | undefined): number | null {
  const left = String(a || "").trim();
  const right = String(b || "").trim();
  if (!left || !right) return null;
  const parse = (value: string) =>
    value
      .split("-")[0]
      .split(".")
      .map((part) => {
        const digits = part.replace(/\D/g, "");
        return Number(digits || "0");
      });
  const av = parse(left);
  const bv = parse(right);
  const len = Math.max(av.length, bv.length, 3);
  for (let i = 0; i < len; i += 1) {
    const diff = (av[i] ?? 0) - (bv[i] ?? 0);
    if (diff > 0) return 1;
    if (diff < 0) return -1;
  }
  return 0;
}

function isoToMs(value: string | null | undefined): number {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json({ message: "Method not allowed" }, 405);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    let serviceRoleKey =
      Deno.env.get("SERVICE_ROLE_KEY") ??
      Deno.env.get("TACOPLAN_SERVICE_ROLE_KEY") ??
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      null;
    if (!serviceRoleKey) {
      const raw = (Deno.env.get("SUPABASE_SECRET_KEYS") ?? "") || (Deno.env.get("SUPABASE_SECRET_KEY") ?? "");
      if (raw) {
        try {
          const parsed = JSON.parse(raw || "{}");
          serviceRoleKey = findServiceRoleKey(parsed);
        } catch {
          serviceRoleKey = null;
        }
      }
    }
    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) return json({ message: "Missing Supabase env vars" }, 500);

    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    if (!authHeader) return json({ message: "No autorizado" }, 401);

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user?.id) return json({ message: "No autorizado" }, 401);
    const callerId = String(userData.user.id);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: adminRow, error: adminErr } = await admin
      .from("admin_users")
      .select("user_id,is_active")
      .eq("user_id", callerId)
      .maybeSingle();
    if (adminErr || !adminRow?.user_id || adminRow?.is_active === false) return json({ message: "No autorizado" }, 403);

    const body = await req.json().catch(() => ({}));
    const q = normalizeQ(body?.q);
    const filter = typeof body?.filter === "string" ? body.filter.trim() : "all";
    const sort = typeof body?.sort === "string" ? body.sort.trim() : "last_jornada_desc";
    const limit = Math.max(1, Math.min(200, Number(body?.limit || 50)));
    const offset = Math.max(0, Number(body?.offset || 0));

    const { data, error } = await admin.rpc("admin_list_users_v1", {
      p_q: q || null,
      p_filter: filter || "all",
      p_sort: sort || "last_jornada_desc",
      p_limit: limit,
      p_offset: offset,
    });
    if (error) throw error;
    const users = Array.isArray(data) ? [...data] : [];
    const userIds = users
      .map((row: any) => String(row?.user_id || ""))
      .filter(Boolean);

    if (userIds.length > 0) {
      const [profilesRes, devicesRes, jornadasRes, pushTokensRes, updatesRes] = await Promise.all([
        admin
          .from("profiles")
          .select("id,email,display_name,notifications_enabled,last_jornada_at")
          .in("id", userIds),
        admin
          .from("app_user_devices")
          .select("user_id,platform,app_version,last_seen_at,last_sync_at,updated_at")
          .in("user_id", userIds)
          .order("last_seen_at", { ascending: false })
          .order("updated_at", { ascending: false }),
        admin
          .from("jornadas")
          .select("user_id,start_at,created_at")
          .in("user_id", userIds)
          .order("start_at", { ascending: false }),
        admin
          .from("push_tokens")
          .select("user_id,last_token_update,updated_at")
          .in("user_id", userIds),
        admin
          .from("app_update_config")
          .select("platform,channel,latest_version")
          .in("platform", ["ios", "android", "web"]),
      ]);

      const profilesMap = new Map<string, any>();
      for (const row of profilesRes.data || []) profilesMap.set(String(row.id), row);

      const latestDeviceMap = new Map<string, any>();
      for (const row of devicesRes.data || []) {
        const uid = String((row as any)?.user_id || "");
        if (!uid || latestDeviceMap.has(uid)) continue;
        latestDeviceMap.set(uid, row);
      }

      const latestJornadaMap = new Map<string, string>();
      for (const row of jornadasRes.data || []) {
        const uid = String((row as any)?.user_id || "");
        if (!uid || latestJornadaMap.has(uid)) continue;
        latestJornadaMap.set(uid, String((row as any)?.start_at || (row as any)?.created_at || ""));
      }

      const pushTokenMap = new Map<string, { hasPushToken: boolean; pushTokenUpdatedAt: string | null }>();
      for (const row of pushTokensRes.data || []) {
        const uid = String((row as any)?.user_id || "");
        if (!uid) continue;
        const current = pushTokenMap.get(uid);
        const candidateIso = String((row as any)?.last_token_update || (row as any)?.updated_at || "") || null;
        if (!current) {
          pushTokenMap.set(uid, {
            hasPushToken: true,
            pushTokenUpdatedAt: candidateIso,
          });
          continue;
        }
        if (isoToMs(candidateIso) > isoToMs(current.pushTokenUpdatedAt)) {
          current.pushTokenUpdatedAt = candidateIso;
        }
      }

      const latestVersionByPlatform = new Map<string, string | null>();
      for (const row of updatesRes.data || []) {
        const platform = String((row as any)?.platform || "").trim();
        const channel = (row as any)?.channel;
        if (!platform || channel) continue;
        latestVersionByPlatform.set(platform, (row as any)?.latest_version ?? null);
      }

      const nowMs = Date.now();
      for (const row of users) {
        const uid = String((row as any)?.user_id || "");
        if (!uid) continue;
        const profile = profilesMap.get(uid);
        const device = latestDeviceMap.get(uid);
        const push = pushTokenMap.get(uid);
        const latestJornadaAt =
          String((row as any)?.last_jornada_at || "") ||
          String(profile?.last_jornada_at || "") ||
          String(latestJornadaMap.get(uid) || "");
        const platform = String((row as any)?.platform || "") || String(device?.platform || "");
        const appVersion = String((row as any)?.app_version || "") || String(device?.app_version || "");
        const latestVersion =
          String((row as any)?.latest_version || "") ||
          String(latestVersionByPlatform.get(platform) || "");
        const versionCmp = compareSemver(appVersion, latestVersion);
        const daysSinceLastJornada =
          latestJornadaAt
            ? Math.max(0, Math.floor((nowMs - isoToMs(latestJornadaAt)) / 86400000))
            : null;

        row.email = (row as any)?.email || profile?.email || null;
        row.display_name = (row as any)?.display_name || profile?.display_name || null;
        row.notifications_enabled =
          (row as any)?.notifications_enabled ?? profile?.notifications_enabled ?? true;
        row.platform = platform || null;
        row.app_version = appVersion || null;
        row.latest_version = latestVersion || null;
        row.is_updated =
          (row as any)?.is_updated != null
            ? (row as any).is_updated
            : versionCmp == null
              ? null
              : versionCmp >= 0;
        row.last_seen_at = (row as any)?.last_seen_at || device?.last_seen_at || null;
        row.last_sync_at = (row as any)?.last_sync_at || device?.last_sync_at || null;
        row.last_jornada_at = latestJornadaAt || null;
        row.days_since_last_jornada =
          (row as any)?.days_since_last_jornada != null
            ? (row as any).days_since_last_jornada
            : daysSinceLastJornada;
        row.has_push_token =
          (row as any)?.has_push_token != null
            ? (row as any).has_push_token
            : !!push?.hasPushToken;
        row.push_token_updated_at =
          (row as any)?.push_token_updated_at || push?.pushTokenUpdatedAt || null;
      }
    }

    return json({ ok: true, q, filter, sort, limit, offset, users });
  } catch (e: any) {
    return json({ message: e?.message || String(e) }, 500);
  }
});
