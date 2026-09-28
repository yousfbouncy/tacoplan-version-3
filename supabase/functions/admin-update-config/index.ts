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

function cleanText(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function cleanBool(v: unknown): boolean | null {
  if (v === true) return true;
  if (v === false) return false;
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
    const platform = cleanText(body?.platform);
    const channel = cleanText(body?.channel);
    if (!platform || (platform !== "ios" && platform !== "android" && platform !== "web")) {
      return json({ message: "platform inválido (ios|android|web)" }, 400);
    }

    const payload: any = {
      platform,
      channel: channel || null,
      latest_version: cleanText(body?.latest_version),
      min_required_version: cleanText(body?.min_required_version) ?? cleanText(body?.minimum_version),
      minimum_version: cleanText(body?.minimum_version) ?? cleanText(body?.min_required_version),
      force_update: cleanBool(body?.force_update) ?? false,
      apk_url: cleanText(body?.apk_url),
      app_store_url: cleanText(body?.app_store_url),
      enabled: cleanBool(body?.enabled) ?? true,
      message: cleanText(body?.message),
      updated_at: new Date().toISOString(),
    };

    let saved: any = null;
    if (!payload.channel) {
      const { data: existing, error: existingErr } = await admin
        .from("app_update_config")
        .select("id")
        .eq("platform", platform)
        .is("channel", null)
        .maybeSingle();
      if (existingErr) throw existingErr;

      if (existing?.id) {
        const { data: upd, error: updErr } = await admin
          .from("app_update_config")
          .update(payload)
          .eq("id", existing.id)
          .select("*")
          .maybeSingle();
        if (updErr) throw updErr;
        saved = upd;
      } else {
        const { data: ins, error: insErr } = await admin
          .from("app_update_config")
          .insert(payload)
          .select("*")
          .maybeSingle();
        if (insErr) throw insErr;
        saved = ins;
      }
    } else {
      const { data: upserted, error: upsertErr } = await admin
        .from("app_update_config")
        .upsert(payload, { onConflict: "platform,channel" })
        .select("*")
        .maybeSingle();
      if (upsertErr) throw upsertErr;
      saved = upserted;
    }

    return json({ ok: true, config: saved });
  } catch (e: any) {
    return json({ message: e?.message || String(e) }, 500);
  }
});
