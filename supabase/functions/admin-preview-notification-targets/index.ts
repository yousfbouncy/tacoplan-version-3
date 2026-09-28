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
    const rawTarget = typeof body?.target_type === "string" ? body.target_type.trim() : "all";
    const rawPlatform = typeof body?.platform === "string" ? body.platform.trim() : "";
    const platform = rawPlatform === "ios" || rawPlatform === "android" ? rawPlatform : "";
    const targetUserId = typeof body?.target_user_id === "string" ? body.target_user_id.trim() : "";
    const createInternal = body?.create_internal_notification === true;
    const sendPush = body?.send_push === true;

    const allowedTargets = new Set([
      "all",
      "user",
      "outdated_version",
      "updated_version",
      "notifications_enabled",
      "notifications_disabled",
      "no_jornada_2_days",
      "no_jornada_7_days",
      "platform_android",
      "platform_ios",
    ]);
    const targetType = allowedTargets.has(rawTarget) ? rawTarget : "all";

    if (targetType === "user" && !targetUserId) return json({ message: "target_user_id requerido" }, 400);

    const platformParam =
      targetType === "platform_ios"
        ? "ios"
        : targetType === "platform_android"
          ? "android"
          : (targetType === "outdated_version" || targetType === "updated_version") && platform
            ? platform
            : null;

    let targetUsers: string[] = [];
    if (targetType === "user") {
      targetUsers = [targetUserId];
    } else if (targetType === "all") {
      const { data: ids, error } = await admin.from("profiles").select("id").limit(50000);
      if (error) throw error;
      targetUsers = (ids || []).map((r: any) => String(r.id || "")).filter(Boolean);
    } else {
      const { data: ids, error } = await admin.rpc("admin_target_user_ids_v2", { p_target_type: targetType, p_platform: platformParam });
      if (error) throw error;
      targetUsers = (ids || []).map((r: any) => String(r.user_id || "")).filter(Boolean);
    }

    let tokens: any[] = [];
    if (sendPush) {
      if (targetType === "user") {
        let q = admin
          .from("push_tokens")
          .select("expo_push_token,platform,device_id")
          .eq("user_id", targetUserId)
          .eq("notifications_enabled", true)
          .limit(20000);
        if (platform) q = q.eq("platform", platform);
        const res = await q;
        if (res.error) throw res.error;
        tokens = res.data || [];
      } else {
        const { data: rows, error } = await admin.rpc("admin_target_push_tokens_v1", { p_target_type: targetType, p_platform: platformParam });
        if (error) throw error;
        tokens = rows || [];
      }
    }

    const byPlatform: any = { ios: 0, android: 0, other: 0 };
    for (const t of tokens || []) {
      const p = String(t.platform || "");
      if (p === "ios") byPlatform.ios += 1;
      else if (p === "android") byPlatform.android += 1;
      else byPlatform.other += 1;
    }

    return json({
      ok: true,
      target_type: targetType,
      platform: platform || null,
      target_users: targetUsers.length,
      push_tokens: tokens.length,
      push_tokens_by_platform: byPlatform,
      internal_would_create: createInternal ? targetUsers.length : 0,
      targetUsers: targetUsers.length,
      tokens: tokens.length,
      internalNotificationsCreated: createInternal ? targetUsers.length : 0,
    });
  } catch (e: any) {
    return json({ message: e?.message || String(e) }, 500);
  }
});
