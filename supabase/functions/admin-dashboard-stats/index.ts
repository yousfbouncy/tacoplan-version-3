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

    const { data: stats, error } = await admin.rpc("admin_dashboard_stats_v1");
    if (error) throw error;

    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const activeThreshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [logsRes, schedulesRes, autoRes, devicesRes] = await Promise.all([
      admin
        .from("admin_notification_logs")
        .select("id", { count: "exact", head: true })
        .gte("created_at", startOfDay.toISOString()),
      admin
        .from("notification_schedules")
        .select("id", { count: "exact", head: true })
        .eq("enabled", true),
      admin
        .from("notification_automation_settings")
        .select("id", { count: "exact", head: true })
        .eq("enabled", true),
      admin
        .from("app_user_devices")
        .select("user_id,last_seen_at")
        .gte("last_seen_at", activeThreshold)
        .order("last_seen_at", { ascending: false })
        .limit(20000),
    ]);

    const devices = devicesRes.error ? [] : (devicesRes.data || []);
    const activeUsers = new Set((devices || []).map((row: any) => String(row.user_id || "")).filter(Boolean)).size;
    const lastActivityAt = (devices || []).find((row: any) => row?.last_seen_at)?.last_seen_at ?? null;

    return json({
      ok: true,
      stats: {
        ...(stats || {}),
        active_users: activeUsers,
        notifications_sent_today: logsRes.count ?? 0,
        scheduled_count: schedulesRes.count ?? 0,
        automations_active: autoRes.count ?? 0,
        last_activity_at: lastActivityAt,
      },
    });
  } catch (e: any) {
    return json({ message: e?.message || String(e) }, 500);
  }
});
