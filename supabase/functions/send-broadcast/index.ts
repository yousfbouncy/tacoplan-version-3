// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
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

async function sendExpo(messages: any[]): Promise<{
  ok: number;
  failed: number;
  tickets: Array<{ to: string; status: "ok" | "error"; id?: string; message?: string; details?: any }>;
  invalidTokens: string[];
  errorTypes: Record<string, number>;
}> {
  if (messages.length === 0) return { ok: 0, failed: 0, tickets: [], invalidTokens: [], errorTypes: {} };
  let ok = 0;
  let failed = 0;
  const tickets: Array<{ to: string; status: "ok" | "error"; id?: string; message?: string; details?: any }> = [];
  const invalidTokens: string[] = [];
  const errorTypes: Record<string, number> = {};
  for (const batch of chunk(messages, 100)) {
    const resp = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(batch),
    });
    const body = await resp.json().catch(() => null);
    const results = body?.data;
    if (Array.isArray(results)) {
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const to = typeof batch?.[i]?.to === "string" ? batch[i].to : "";
        if (r?.status === "ok") {
          ok += 1;
          tickets.push({ to, status: "ok", id: r?.id });
        } else {
          failed += 1;
          const details = r?.details;
          const errType = String(details?.error || r?.message || "unknown_error");
          errorTypes[errType] = (errorTypes[errType] || 0) + 1;
          tickets.push({ to, status: "error", message: r?.message, details });
          if (details?.error === "DeviceNotRegistered" && to) invalidTokens.push(to);
        }
      }
    } else if (resp.ok) {
      ok += batch.length;
      for (const msg of batch) {
        const to = typeof msg?.to === "string" ? msg.to : "";
        tickets.push({ to, status: "ok" });
      }
    } else {
      failed += batch.length;
      errorTypes["http_error"] = (errorTypes["http_error"] || 0) + batch.length;
      for (const msg of batch) {
        const to = typeof msg?.to === "string" ? msg.to : "";
        tickets.push({ to, status: "error", message: "Expo push API error", details: body });
      }
    }
  }
  return { ok, failed, tickets, invalidTokens, errorTypes };
}

serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json({ message: "Method not allowed" }, 405);

    const adminKey = Deno.env.get("ADMIN_API_KEY") ?? "";
    const gotKey = req.headers.get("x-admin-key") ?? "";
    if (!adminKey || gotKey !== adminKey) return json({ message: "No autorizado" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
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
    if (!supabaseUrl || !serviceRoleKey) return json({ message: "Missing SUPABASE_URL or service role key" }, 500);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const body = await req.json().catch(() => ({}));
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const text = typeof body?.body === "string" ? body.body.trim() : "";
    const data = body?.data && typeof body.data === "object" ? body.data : {};
    const platform = typeof body?.platform === "string" ? body.platform : null;

    if (!title || !text) return json({ message: "title y body requeridos" }, 400);

    let q = admin
      .from("push_tokens")
      .select("expo_push_token")
      .eq("notifications_enabled", true);
    if (platform) q = q.eq("platform", platform);
    const { data: tokens, error: tokensErr } = await q.limit(50000);
    if (tokensErr) return json({ message: tokensErr.message }, 500);

    const messages: any[] = [];
    for (const row of tokens || []) {
      const to = row.expo_push_token;
      if (!to || typeof to !== "string") continue;
      messages.push({ to, sound: "default", title, body: text, data });
    }

    const { ok: messagesOk, failed: messagesFailed, tickets, invalidTokens, errorTypes } = await sendExpo(messages);
    const errorsPreview = tickets
      .filter((t) => t.status === "error")
      .slice(0, 25)
      .map((t) => ({ to: t.to, message: t.message, details: t.details }));

    return json({
      ok: true,
      tokens: messages.length,
      messagesOk,
      messagesFailed,
      invalidTokens: invalidTokens.slice(0, 100),
      errorTypes,
      errorsPreview,
    });
  } catch (e: any) {
    return json({ message: e?.message || String(e) }, 500);
  }
});
