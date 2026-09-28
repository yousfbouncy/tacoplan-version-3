// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  normalizeNotificationActionFields,
  notificationActionValidationError,
  withNotificationActionData,
} from "../_shared/notification-action.ts";
import {
  getLocalHHmmInTimeZone,
  nextDailyLocal,
  nextMonthlyLocal,
  nextWeeklyLocal,
  normalizeTimeZone,
} from "../_shared/timezone.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
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

function parseTimeUtc(timeUtc: any): { hh: number; mm: number } | null {
  if (typeof timeUtc !== "string") return null;
  const m = timeUtc.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { hh, mm };
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
    const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
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

    const hasCronAccess = !!cronSecret && (req.headers.get("x-cron-secret") ?? "") === cronSecret;

    let callerId: string | null = null;
    if (!hasCronAccess) {
      const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
      if (!authHeader) return json({ message: "No autorizado" }, 401);
      const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData?.user?.id) return json({ message: "No autorizado" }, 401);
      callerId = String(userData.user.id);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    if (callerId) {
      const { data: adminRow, error: adminErr } = await admin
        .from("admin_users")
        .select("user_id,is_active")
        .eq("user_id", callerId)
        .maybeSingle();
      if (adminErr || !adminRow?.user_id || adminRow?.is_active === false) return json({ message: "No autorizado" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const scheduleId = typeof body?.schedule_id === "string" ? body.schedule_id.trim() : "";

    const now = new Date();
    let schedules: any[] = [];
    if (scheduleId) {
      const { data, error } = await admin
        .from("notification_schedules")
        .select("*")
        .eq("id", scheduleId)
        .maybeSingle();
      if (error) return json({ message: error.message }, 500);
      schedules = data ? [data] : [];
    } else {
      const { data, error } = await admin
        .from("notification_schedules")
        .select("*")
        .eq("enabled", true)
        .lte("next_run_at", now.toISOString())
        .order("next_run_at", { ascending: true })
        .limit(50);
      if (error) return json({ message: error.message }, 500);
      schedules = data || [];
    }

    if (schedules.length === 0) return json({ ok: true, processed: 0, sent: [] });

    const results: any[] = [];
    for (const sch of schedules) {
      const title = String(sch.title || "").trim();
      const text = String(sch.body || "").trim();
      const type = String(sch.type || "admin_message").trim();
      const rawTargetType = String(sch.target_type || "all").trim();
      const targetType = allowedTargets.has(rawTargetType) ? rawTargetType : "all";
      const targetUserId = sch.target_user_id ? String(sch.target_user_id) : "";
      const sendPush = sch.send_push === true;
      const createInternal = sch.create_internal_notification === true;
      const visibilityMode = sch.visibility_mode === "persistent" ? "persistent" : "snapshot";
      const data = sch.data && typeof sch.data === "object" ? sch.data : null;
      const scheduleTimeZone = normalizeTimeZone(typeof data?.timezone === "string" ? data.timezone : null);
      const scheduleUsesLocalTime = data?.time_mode === "local";
      const actionError = notificationActionValidationError({
        button_text: sch.button_text,
        button_url: sch.button_url,
      });
      const dataPlatform = typeof data?.platform === "string" ? String(data.platform).trim() : "";
      const platform =
        dataPlatform === "ios" || dataPlatform === "android"
          ? dataPlatform
          : targetType === "platform_ios"
            ? "ios"
            : targetType === "platform_android"
              ? "android"
              : "";

      const { buttonText, buttonUrl } = normalizeNotificationActionFields({
        button_text: sch.button_text,
        button_url: sch.button_url,
      });
      const payloadData = withNotificationActionData(
        {
          ...(data && typeof data === "object" ? data : {}),
          type,
          schedule_id: String(sch.id || ""),
        },
        { buttonText, buttonUrl },
      );

      if (actionError) {
        await admin.from("admin_notification_logs").insert({
          admin_user_id: callerId,
          source: "schedule",
          source_id: String(sch.id || ""),
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
          users_targeted: 0,
          tokens_found: 0,
          push_ok: 0,
          push_failed: 0,
          internal_created: 0,
          status: "error",
          error_message: actionError,
        }).catch(() => null);
        throw new Error(actionError);
      }

      let targetUserIds: string[] = [];
      if (targetType === "user" && targetUserId) {
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
        targetUserIds = (ids || []).map((row: any) => String(row.user_id || "")).filter(Boolean);
      }
      targetUserIds = targetUserIds.filter(Boolean);

      const dispatchCreatedAt = now.toISOString();
      const dispatchInsert = await admin
        .from("notification_dispatches")
        .insert({
          admin_user_id: callerId,
          source: "schedule",
          source_id: String(sch.id || ""),
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
      if (sendPush && targetUserIds.length > 0) {
        const messages: any[] = [];
        let tokens: any[] = [];
        if (targetType === "user") {
          let q = admin
            .from("push_tokens")
            .select("user_id,expo_push_token,platform,notifications_enabled")
            .eq("user_id", targetUserId)
            .eq("notifications_enabled", true)
            .limit(20000);
          if (platform) q = q.eq("platform", platform);
          const res = await q;
          if (res.error) throw res.error;
          tokens = res.data || [];
        } else if (targetType === "all") {
          for (const batch of chunk(targetUserIds, 1000)) {
            let q = admin
              .from("push_tokens")
              .select("user_id,expo_push_token,platform,notifications_enabled")
              .in("user_id", batch)
              .eq("notifications_enabled", true)
              .limit(20000);
            if (platform) q = q.eq("platform", platform);
            const res = await q;
            if (res.error) throw res.error;
            tokens.push(...(res.data || []));
          }
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
          messages.push({ to, sound: "default", title, body: text, data: payloadData, _userId: tokenUserId });
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
        delivered_at: createInternal || sendPush ? now.toISOString() : null,
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
        updated_at: now.toISOString(),
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
          updated_at: now.toISOString(),
        })
        .eq("id", dispatchId);

      const baseTime = parseTimeUtc(sch.time_utc) || (
        scheduleUsesLocalTime
          ? getLocalHHmmInTimeZone(new Date(String(sch.next_run_at || now.toISOString())), scheduleTimeZone)
          : {
              hh: new Date(String(sch.next_run_at || now.toISOString())).getUTCHours(),
              mm: new Date(String(sch.next_run_at || now.toISOString())).getUTCMinutes(),
            }
      );
      const frequency = String(sch.frequency || "once");
      let nextRunAt: string | null = null;
      let enabled = sch.enabled === true;
      const fromDate = new Date(String(sch.next_run_at || now.toISOString()));
      if (frequency === "once") {
        enabled = false;
        nextRunAt = String(sch.next_run_at || now.toISOString());
      } else if (frequency === "daily") {
        nextRunAt = (scheduleUsesLocalTime ? nextDailyLocal(fromDate, baseTime, scheduleTimeZone) : null)?.toISOString?.() || null;
      } else if (frequency === "weekly") {
        nextRunAt = (scheduleUsesLocalTime ? nextWeeklyLocal(fromDate, baseTime, sch.week_days || [], scheduleTimeZone) : null)?.toISOString?.() || null;
      } else if (frequency === "monthly") {
        nextRunAt = (scheduleUsesLocalTime ? nextMonthlyLocal(fromDate, baseTime, Number(sch.day_of_month || 1), scheduleTimeZone) : null)?.toISOString?.() || null;
      } else {
        enabled = false;
        nextRunAt = String(sch.next_run_at || now.toISOString());
      }

      if (!scheduleUsesLocalTime && frequency === "daily") {
        const next = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate(), baseTime.hh, baseTime.mm, 0, 0));
        next.setUTCDate(next.getUTCDate() + 1);
        nextRunAt = next.toISOString();
      } else if (!scheduleUsesLocalTime && frequency === "weekly") {
        const base = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate(), baseTime.hh, baseTime.mm, 0, 0));
        const cur = base.getUTCDay();
        const sorted = Array.from(new Set((sch.week_days || []).map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n >= 0 && n <= 6))).sort((a, b) => a - b);
        if (sorted.length === 0) {
          base.setUTCDate(base.getUTCDate() + 7);
        } else {
          for (let add = 1; add <= 7; add += 1) {
            const candDay = (cur + add) % 7;
            if (sorted.includes(candDay)) {
              base.setUTCDate(base.getUTCDate() + add);
              break;
            }
          }
        }
        nextRunAt = base.toISOString();
      } else if (!scheduleUsesLocalTime && frequency === "monthly") {
        const y = fromDate.getUTCFullYear();
        const m0 = fromDate.getUTCMonth();
        let nextMonth0 = m0 + 1;
        let nextYear = y;
        if (nextMonth0 > 11) {
          nextMonth0 = 0;
          nextYear += 1;
        }
        const dom = Number(sch.day_of_month || 1);
        const lastDay = new Date(Date.UTC(nextYear, nextMonth0 + 1, 0)).getUTCDate();
        const day = Math.min(Math.max(1, dom), lastDay);
        nextRunAt = new Date(Date.UTC(nextYear, nextMonth0, day, baseTime.hh, baseTime.mm, 0, 0)).toISOString();
      }

      await admin
        .from("notification_schedules")
        .update({
          last_run_at: now.toISOString(),
          next_run_at: nextRunAt,
          enabled,
          updated_at: now.toISOString(),
        } as any)
        .eq("id", sch.id);

      try {
        await admin.from("admin_notification_logs").insert({
          admin_user_id: callerId,
          source: "schedule",
          source_id: String(sch.id || ""),
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

      results.push({
        schedule_id: String(sch.id || ""),
        users_found: targetUserIds.length,
        tokens_found: tokensFound,
        push_ok: pushOk,
        push_failed: pushFailed,
        internal_created: internalCreated,
        next_run_at: nextRunAt,
        enabled,
      });
    }

    return json({ ok: true, processed: results.length, sent: results });
  } catch (e: any) {
    return json({ message: e?.message || String(e) }, 500);
  }
});
