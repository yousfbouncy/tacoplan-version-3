// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  normalizeNotificationActionFields,
  notificationActionValidationError,
  withNotificationActionData,
} from "../_shared/notification-action.ts";

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

async function sendExpo(messages: any[]): Promise<{ ok: number; failed: number; tickets: Array<{ ok: boolean; userId: string | null; message?: string | null }> }> {
  if (messages.length === 0) return { ok: 0, failed: 0, tickets: [] };
  let ok = 0;
  let failed = 0;
  const tickets: Array<{ ok: boolean; userId: string | null; message?: string | null }> = [];
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
      for (let index = 0; index < results.length; index += 1) {
        const r = results[index];
        const msg = batch[index];
        const userId = typeof msg?._userId === "string" ? msg._userId : null;
        if (r?.status === "ok") {
          ok += 1;
          tickets.push({ ok: true, userId, message: null });
        } else {
          failed += 1;
          tickets.push({ ok: false, userId, message: typeof r?.message === "string" ? r.message : null });
        }
      }
    } else if (resp.ok) {
      ok += batch.length;
      for (const msg of batch) {
        tickets.push({ ok: true, userId: typeof msg?._userId === "string" ? msg._userId : null, message: null });
      }
    } else {
      failed += batch.length;
      for (const msg of batch) {
        tickets.push({
          ok: false,
          userId: typeof msg?._userId === "string" ? msg._userId : null,
          message: "Expo push API error",
        });
      }
    }
  }
  return { ok, failed, tickets };
}

async function listAllProfileIds(admin: any, limitMax = 20000): Promise<string[]> {
  const ids: string[] = [];
  const pageSize = 1000;
  for (let offset = 0; offset < limitMax; offset += pageSize) {
    const { data, error } = await admin
      .from("profiles")
      .select("id")
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = (data || []).map((r: any) => String(r.id || "")).filter(Boolean);
    if (page.length === 0) break;
    ids.push(...page);
    if (page.length < pageSize) break;
  }
  return Array.from(new Set(ids));
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
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const text = typeof body?.body === "string" ? body.body.trim() : "";
    const type = typeof body?.type === "string" ? body.type.trim() : "admin_message";
    const rawTarget = typeof body?.target_type === "string" ? body.target_type.trim() : "all";
    const rawPlatform = typeof body?.platform === "string" ? body.platform.trim() : "";
    const platform = rawPlatform === "ios" || rawPlatform === "android" ? rawPlatform : "";
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
    const targetUserId = typeof body?.target_user_id === "string" ? body.target_user_id.trim() : "";
    const sendPush = body?.send_push === true;
    const createInternal = body?.create_internal_notification === true;
    const visibilityMode = body?.visibility_mode === "persistent" ? "persistent" : "snapshot";
    const data = body?.data && typeof body.data === "object" ? body.data : null;
    const buttonTextRaw = typeof body?.button_text === "string" ? body.button_text : null;
    const buttonUrlRaw = typeof body?.button_url === "string" ? body.button_url : null;
    const actionError = notificationActionValidationError({
      button_text: buttonTextRaw,
      button_url: buttonUrlRaw,
    });

    if (!title) return json({ message: "title requerido" }, 400);
    if (!text) return json({ message: "body requerido" }, 400);
    if (targetType === "user" && !targetUserId) return json({ message: "target_user_id requerido" }, 400);
    if (!sendPush && !createInternal) return json({ message: "Nada que enviar: activa push o notificación interna" }, 400);
    if (actionError) return json({ message: actionError }, 400);

    let targetUserIds: string[] = [];
    if (targetType === "user") {
      targetUserIds = [targetUserId];
    } else if (targetType === "all") {
      targetUserIds = await listAllProfileIds(admin, 50000);
    } else {
      const platformParam =
        targetType === "platform_ios"
          ? "ios"
          : targetType === "platform_android"
            ? "android"
            : (targetType === "outdated_version" || targetType === "updated_version") && platform
              ? platform
              : null;
      const { data: ids, error: idsErr } = await admin.rpc("admin_target_user_ids_v2", {
        p_target_type: targetType,
        p_platform: platformParam,
      });
      if (idsErr) throw idsErr;
      targetUserIds = (ids || []).map((r: any) => String(r.user_id || "")).filter(Boolean);
    }
    targetUserIds = targetUserIds.filter(Boolean);
    if (targetUserIds.length === 0) {
      return json({
        ok: true,
        users_found: 0,
        tokens_found: 0,
        push_ok: 0,
        push_failed: 0,
        internal_created: 0,
        errors: [],
      });
    }

    const { buttonText, buttonUrl } = normalizeNotificationActionFields({
      button_text: buttonTextRaw,
      button_url: buttonUrlRaw,
    });
    const payloadData = withNotificationActionData(
      {
        ...(data && typeof data === "object" ? data : {}),
        type,
      },
      { buttonText, buttonUrl },
    );

    const dispatchCreatedAt = new Date().toISOString();
    const dispatchInsert = await admin
      .from("notification_dispatches")
      .insert({
        admin_user_id: callerId,
        source: "manual",
        title,
        body: text,
        type,
        target_type: targetType,
        target_user_id: targetType === "user" ? targetUserId : null,
        send_push: sendPush,
        create_internal_notification: createInternal,
        button_text: buttonText,
        button_url: buttonUrl,
        data: payloadData,
        visibility_mode: visibilityMode,
        users_targeted: targetUserIds.length,
        created_at: dispatchCreatedAt,
        updated_at: dispatchCreatedAt,
      })
      .select("id")
      .single();
    if (dispatchInsert.error) throw dispatchInsert.error;
    const dispatchId = String(dispatchInsert.data.id);

    let tokensFound = 0;
    let pushOk = 0;
    let pushFailed = 0;
    const userTokenCount = new Map<string, number>();
    const userPushErrors = new Map<string, string | null>();
    const userPushSucceeded = new Set<string>();
    if (sendPush) {
      const messages: any[] = [];
      let tokens: any[] = [];
      if (targetType === "user") {
        let q = admin
          .from("push_tokens")
          .select("user_id,expo_push_token,platform,device_id")
          .eq("user_id", targetUserId)
          .eq("notifications_enabled", true)
          .limit(20000);
        if (platform) q = q.eq("platform", platform);
        const res = await q;
        if (res.error) throw res.error;
        tokens = res.data || [];
      } else {
        const platformParam =
          targetType === "platform_ios"
            ? "ios"
            : targetType === "platform_android"
              ? "android"
              : (targetType === "outdated_version" || targetType === "updated_version") && platform
                ? platform
                : null;
        const { data: rows, error: tokErr } = await admin.rpc("admin_target_push_tokens_v1", {
          p_target_type: targetType,
          p_platform: platformParam,
        });
        if (tokErr) throw tokErr;
        tokens = rows || [];
      }

      for (const row of tokens || []) {
        const to = row.expo_push_token;
        if (!to || typeof to !== "string") continue;
        const tokenUserId = typeof row.user_id === "string" ? row.user_id : null;
        if (tokenUserId) {
          userTokenCount.set(tokenUserId, (userTokenCount.get(tokenUserId) || 0) + 1);
        }
        tokensFound += 1;
        messages.push({
          to,
          sound: "default",
          title,
          body: text,
          data: payloadData,
          _userId: tokenUserId,
        });
      }
      const pushRes = await sendExpo(messages);
      pushOk = pushRes.ok;
      pushFailed = pushRes.failed;
      for (const ticket of pushRes.tickets) {
        if (!ticket.userId) continue;
        if (ticket.ok) {
          userPushSucceeded.add(ticket.userId);
          userPushErrors.delete(ticket.userId);
        } else if (!userPushSucceeded.has(ticket.userId)) {
          userPushErrors.set(ticket.userId, ticket.message || "push_failed");
        }
      }
    }

    const deliveryRows = targetUserIds.map((uid) => ({
      user_id: uid,
      type,
      title,
      body: text,
      button_text: buttonText,
      button_url: buttonUrl,
      data: payloadData,
      notification_dispatch_id: dispatchId,
      delivered_at: createInternal || sendPush ? new Date().toISOString() : null,
      push_status: !sendPush
        ? "not_requested"
        : (userTokenCount.get(uid) || 0) === 0
          ? "no_token"
          : userPushSucceeded.has(uid)
            ? "sent"
            : "failed",
      delivery_error: !sendPush
        ? null
        : (userTokenCount.get(uid) || 0) === 0
          ? "No push token available"
          : userPushErrors.get(uid) || null,
      visibility_mode: visibilityMode,
      created_at: dispatchCreatedAt,
      updated_at: new Date().toISOString(),
    }));

    let internalCreated = 0;
    if (deliveryRows.length > 0) {
      for (const batch of chunk(deliveryRows, 500)) {
        const ins = await admin.from("user_notifications").insert(batch);
        if (ins.error) throw ins.error;
        internalCreated += batch.length;
      }
    }

    await admin
      .from("notification_dispatches")
      .update({
        tokens_found: tokensFound,
        push_ok: pushOk,
        push_failed: pushFailed,
        internal_created: internalCreated,
        updated_at: new Date().toISOString(),
      })
      .eq("id", dispatchId);

    try {
      await admin.from("admin_notification_logs").insert({
        admin_user_id: callerId,
        source: "manual",
        title,
        body: text,
        type,
        target_type: targetType,
        target_user_id: targetType === "user" ? targetUserId : null,
        send_push: sendPush,
        create_internal_notification: createInternal,
        button_text: buttonText,
        button_url: buttonUrl,
        data: payloadData,
        users_targeted: targetUserIds.length,
        tokens_found: tokensFound,
        push_ok: pushOk,
        push_failed: pushFailed,
        internal_created: internalCreated,
        status: pushFailed > 0 ? "partial" : "success",
      });
    } catch {}

    return json({
      ok: true,
      target_type: targetType,
      platform: platform || null,
      users_found: targetUserIds.length,
      tokens_found: tokensFound,
      push_ok: pushOk,
      push_failed: pushFailed,
      internal_created: internalCreated,
      targetUsers: targetUserIds.length,
      tokens: tokensFound,
      messagesOk: pushOk,
      messagesFailed: pushFailed,
      internalNotificationsCreated: internalCreated,
      errors: [],
    });
  } catch (e: any) {
    return json({ message: e?.message || String(e) }, 500);
  }
});
