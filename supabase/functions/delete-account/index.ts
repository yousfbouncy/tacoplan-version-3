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
      if (typeof v === "string" && key.includes("service") && key.includes("role")) {
        return v;
      }
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
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") {
      return json({ message: "Method not allowed" }, 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    let serviceRoleKey =
      Deno.env.get("SERVICE_ROLE_KEY") ??
      Deno.env.get("TACOPLAN_SERVICE_ROLE_KEY") ??
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      null;
    if (!serviceRoleKey) {
      const raw1 = Deno.env.get("SUPABASE_SECRET_KEYS") ?? "";
      const raw2 = Deno.env.get("SUPABASE_SECRET_KEY") ?? "";
      const raw = raw1 || raw2;
      if (raw) {
        try {
          const parsed = JSON.parse(raw || "{}");
          serviceRoleKey = findServiceRoleKey(parsed);
        } catch {
          serviceRoleKey = null;
        }
      }
    }
    if (!supabaseUrl || !serviceRoleKey) {
      return json(
        {
          message:
            "Missing SUPABASE_URL or service role key. Add SERVICE_ROLE_KEY (recommended) as a custom secret in Edge Functions > Secrets.",
        },
        500,
      );
    }

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ message: "No autorizado" }, 401);
    }

    const accessToken = authHeader.slice("Bearer ".length);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
    if (userError || !userData.user) {
      return json({ message: "Token invalido o expirado" }, 401);
    }

    const userId = userData.user.id;

    const safeDelete = async (table: string, column: "user_id" | "id") => {
      try {
        const res = await admin.from(table).delete().eq(column, userId);
        if (res.error) {
          const msg = String(res.error.message || "").toLowerCase();
          if (msg.includes("does not exist")) return;
        }
      } catch {}
    };

    await safeDelete("user_day_extra_entries", "user_id");
    await safeDelete("user_holidays", "user_id");
    await safeDelete("user_day_extras", "user_id");
    await safeDelete("user_diet_rates", "user_id");
    await safeDelete("dietas_config", "user_id");
    await safeDelete("user_ferry_config", "user_id");
    await safeDelete("ferry_rests", "user_id");
    await safeDelete("morocco_trips", "user_id");
    await safeDelete("viajes", "user_id");
    await safeDelete("tacho_activities", "user_id");
    await safeDelete("compensaciones", "user_id");
    await safeDelete("jornadas", "user_id");
    await safeDelete("profiles", "id");

    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      return json({ message: deleteError.message }, 500);
    }

    return json({ ok: true });
  } catch (e: any) {
    return json({ message: e?.message || String(e) }, 500);
  }
});
