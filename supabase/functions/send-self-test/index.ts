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

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function sendExpo(messages: any[]): Promise<{ ok: number; failed: number }> {
  if (messages.length === 0) return { ok: 0, failed: 0 };
  let ok = 0;
  let failed = 0;
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
      for (const r of results) {
        if (r?.status === "ok") ok += 1;
        else failed += 1;
      }
    } else if (resp.ok) {
      ok += batch.length;
    } else {
      failed += batch.length;
    }
  }
  return { ok, failed };
}

serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json({ message: "Method not allowed" }, 405);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnonKey) return json({ message: "Missing SUPABASE_URL or SUPABASE_ANON_KEY" }, 500);

    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    if (!authHeader) return json({ message: "No autorizado" }, 401);

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) return json({ message: "No autorizado" }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const title = typeof body?.title === "string" ? body.title.trim() : "Tacoplan";
    const text = typeof body?.body === "string" ? body.body.trim() : "Notificación de prueba";
    const data = body?.data && typeof body.data === "object" ? body.data : { type: "test" };

    const { data: tokens, error: tokensErr } = await supabase
      .from("push_tokens")
      .select("expo_push_token")
      .eq("user_id", userId)
      .eq("notifications_enabled", true)
      .limit(50);
    if (tokensErr) return json({ message: tokensErr.message }, 500);

    const messages: any[] = [];
    for (const row of tokens || []) {
      const to = row.expo_push_token;
      if (!to || typeof to !== "string") continue;
      messages.push({ to, sound: "default", title, body: text, data });
    }

    const { ok: messagesOk, failed: messagesFailed } = await sendExpo(messages);
    return json({ ok: true, tokens: messages.length, messagesOk, messagesFailed });
  } catch (e: any) {
    return json({ message: e?.message || String(e) }, 500);
  }
});

