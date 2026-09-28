// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  normalizeNotificationActionFields,
  notificationActionValidationError,
  withNotificationActionData,
} from "./notification-action.ts";
import {
  getLocalHourInTimeZone,
  normalizeTimeZone,
} from "./timezone.ts";

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

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function lastDayOfMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

function computePeriodRange(mode: string, manualFrom: number, manualTo: number, refDate: Date): { from: string; to: string } {
  const year = refDate.getFullYear();
  const month0 = refDate.getMonth();
  const day = refDate.getDate();

  let fromYear: number, fromMonth1: number, fromDay: number;
  let toYear: number, toMonth1: number, toDay: number;

  if (mode === "AUTO_MONTH") {
    fromYear = year;
    fromMonth1 = month0 + 1;
    fromDay = 1;
    toYear = year;
    toMonth1 = month0 + 1;
    toDay = lastDayOfMonth(year, month0 + 1);
  } else if (mode === "AUTO_01_30") {
    fromYear = year;
    fromMonth1 = month0 + 1;
    fromDay = 1;
    toYear = year;
    toMonth1 = month0 + 1;
    toDay = Math.min(30, lastDayOfMonth(year, month0 + 1));
  } else if (mode === "AUTO_20_20") {
    if (day > 20) {
      fromYear = year;
      fromMonth1 = month0 + 1;
      fromDay = 21;
      let nm = month0 + 2;
      let ny = year;
      if (nm > 12) { nm = 1; ny += 1; }
      toYear = ny;
      toMonth1 = nm;
      toDay = 20;
    } else {
      let pm = month0;
      let py = year;
      if (pm < 1) { pm = 12; py -= 1; }
      fromYear = py;
      fromMonth1 = pm;
      fromDay = 21;
      toYear = year;
      toMonth1 = month0 + 1;
      toDay = 20;
    }
  } else {
    const sd = Number.isFinite(manualFrom) ? manualFrom : 1;
    const ed = Number.isFinite(manualTo) ? manualTo : 30;
    if (ed >= sd) {
      fromYear = year;
      fromMonth1 = month0 + 1;
      fromDay = Math.min(sd, lastDayOfMonth(year, month0 + 1));
      toYear = year;
      toMonth1 = month0 + 1;
      toDay = Math.min(ed, lastDayOfMonth(year, month0 + 1));
      if (day < sd) {
        let pm = month0;
        let py = year;
        if (pm < 1) { pm = 12; py -= 1; }
        fromYear = py;
        fromMonth1 = pm;
        fromDay = Math.min(sd, lastDayOfMonth(py, pm));
        toYear = py;
        toMonth1 = pm;
        toDay = Math.min(ed, lastDayOfMonth(py, pm));
      } else if (day > ed) {
        let nm = month0 + 2;
        let ny = year;
        if (nm > 12) { nm = 1; ny += 1; }
        fromYear = ny;
        fromMonth1 = nm;
        fromDay = Math.min(sd, lastDayOfMonth(ny, nm));
        toYear = ny;
        toMonth1 = nm;
        toDay = Math.min(ed, lastDayOfMonth(ny, nm));
      }
    } else {
      if (day > ed) {
        fromYear = year;
        fromMonth1 = month0 + 1;
        fromDay = Math.min(sd, lastDayOfMonth(year, month0 + 1));
        let nm = month0 + 2;
        let ny = year;
        if (nm > 12) { nm = 1; ny += 1; }
        toYear = ny;
        toMonth1 = nm;
        toDay = Math.min(ed, lastDayOfMonth(ny, nm));
      } else {
        let pm = month0;
        let py = year;
        if (pm < 1) { pm = 12; py -= 1; }
        fromYear = py;
        fromMonth1 = pm;
        fromDay = Math.min(sd, lastDayOfMonth(py, pm));
        toYear = year;
        toMonth1 = month0 + 1;
        toDay = Math.min(ed, lastDayOfMonth(year, month0 + 1));
      }
    }
  }

  return {
    from: `${fromYear}-${pad2(fromMonth1)}-${pad2(fromDay)}`,
    to: `${toYear}-${pad2(toMonth1)}-${pad2(toDay)}`,
  };
}

function formatFechaES(dateStr: string): string {
  const m = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(dateStr || "");
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function semverPart(v: string, index: number): number {
  const value = String(v || "").split("-")[0]?.split(".")?.[index - 1] ?? "0";
  const digits = value.replace(/\D/g, "");
  return Number(digits || "0");
}

function compareSemver(a: string, b: string): number {
  const partsA = [semverPart(a, 1), semverPart(a, 2), semverPart(a, 3)];
  const partsB = [semverPart(b, 1), semverPart(b, 2), semverPart(b, 3)];
  for (let i = 0; i < 3; i += 1) {
    if (partsA[i] > partsB[i]) return 1;
    if (partsA[i] < partsB[i]) return -1;
  }
  return 0;
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
        const row = results[index];
        const msg = batch[index];
        const userId = typeof msg?._userId === "string" ? msg._userId : null;
        if (row?.status === "ok") {
          ok += 1;
          tickets.push({ ok: true, userId, message: null });
        } else {
          failed += 1;
          tickets.push({ ok: false, userId, message: typeof row?.message === "string" ? row.message : null });
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

async function insertInternalNotifications(admin: any, rows: any[]): Promise<number> {
  if (rows.length === 0) return 0;
  let created = 0;
  for (const batch of chunk(rows, 500)) {
    const ins = await admin.from("user_notifications").insert(batch);
    if (ins.error) throw ins.error;
    created += batch.length;
  }
  return created;
}

async function createNotificationDispatch(admin: any, payload: Record<string, unknown>): Promise<string> {
  const nowIso = new Date().toISOString();
  const res = await admin
    .from("notification_dispatches")
    .insert({ ...payload, created_at: nowIso, updated_at: nowIso })
    .select("id")
    .single();
  if (res.error) throw res.error;
  return String(res.data.id);
}

async function writeAutomationLog(admin: any, payload: any) {
  try {
    await admin.from("admin_notification_logs").insert(payload);
  } catch {}
}

export async function handleRunNotificationAutomations(req: Request): Promise<Response> {
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
          serviceRoleKey = findServiceRoleKey(JSON.parse(raw || "{}"));
        } catch {
          serviceRoleKey = null;
        }
      }
    }
    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return json({ message: "Missing Supabase env vars" }, 500);
    }

    const hasCronAccess = !!cronSecret && (req.headers.get("x-cron-secret") ?? "") === cronSecret;
    let callerId: string | null = null;

    if (!hasCronAccess) {
      const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
      if (!authHeader) return json({ message: "No autorizado" }, 401);
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userErr } = await userClient.auth.getUser();
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
      if (adminErr || !adminRow?.user_id || adminRow?.is_active === false) {
        return json({ message: "No autorizado" }, 403);
      }
    }

    const body = await req.json().catch(() => ({}));
    const automationId = typeof body?.automation_id === "string" ? body.automation_id.trim() : "";
    const force = body?.force === true;
    const dryRun = body?.dry_run === true;

    const nowDate = new Date();
    const now = nowDate.getTime();
    const nowHourUtc = nowDate.getUTCHours();
    const cooldown24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const loadAutomation = async (id: string) => {
      const { data, error } = await admin
        .from("notification_automation_settings")
        .select("id,enabled,hour_utc,days_without_jornada,send_push,create_internal_notification,visibility_mode,title,body,button_text,button_url,data")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    };

    const shouldRun = (id: string) => !automationId || automationId === id;
    const isAutomationHourMatch = (config: any) => {
      if (typeof config?.hour_utc !== "number") return true;
      const mode = config?.data?.time_mode === "local" ? "local" : "utc";
      if (mode === "local") {
        const timeZone = normalizeTimeZone(typeof config?.data?.timezone === "string" ? config.data.timezone : null);
        return getLocalHourInTimeZone(nowDate, timeZone) === Number(config.hour_utc);
      }
      return nowHourUtc === Number(config.hour_utc);
    };

    const inactivityCfg = shouldRun("inactivity_reminder") ? await loadAutomation("inactivity_reminder") : null;
    const payrollCfg = shouldRun("payroll_estimate") ? await loadAutomation("payroll_estimate") : null;
    const updateCfg = shouldRun("app_update") ? await loadAutomation("app_update") : null;

    const inactivity = {
      enabled: inactivityCfg?.enabled !== false,
      skipped: !shouldRun("inactivity_reminder"),
      candidates: 0,
      sentUsers: 0,
      pushOk: 0,
      pushFailed: 0,
      internalCreated: 0,
      executed: false,
    };

    if (!inactivity.skipped) {
      const inactivityHourOk = isAutomationHourMatch(inactivityCfg);
      const inactivityDays = Number(inactivityCfg?.days_without_jornada || 2);
      const thresholdInactivity = new Date(now - Math.max(1, inactivityDays) * 24 * 60 * 60 * 1000).toISOString();
      const inactivitySendPush = inactivityCfg?.send_push === false ? false : true;
      const inactivityCreateInternal = inactivityCfg?.create_internal_notification === true;
      const inactivityVisibilityMode = inactivityCfg?.visibility_mode === "persistent" ? "persistent" : "snapshot";
      const inactivityTitle =
        typeof inactivityCfg?.title === "string" && inactivityCfg.title.trim()
          ? inactivityCfg.title.trim()
          : "Recuerda registrar tu jornada";
      const inactivityBody =
        typeof inactivityCfg?.body === "string" && inactivityCfg.body.trim()
          ? inactivityCfg.body.trim()
          : "Llevas varios días sin registrar jornadas. Tener tus registros al día puede ayudarte a controlar tus tiempos, dietas y reclamar cualquier incidencia a la empresa.";
      const inactivityData = inactivityCfg?.data && typeof inactivityCfg.data === "object"
        ? inactivityCfg.data
        : { target: "jornada" };
      const inactivityActionError = notificationActionValidationError({
        button_text: inactivityCfg?.button_text,
        button_url: inactivityCfg?.button_url,
      });
      const inactivityAction = normalizeNotificationActionFields({
        button_text: inactivityCfg?.button_text,
        button_url: inactivityCfg?.button_url,
      });
      const inactivityPayloadData = withNotificationActionData(
        { ...inactivityData, type: "inactivity_reminder" },
        inactivityAction,
      );

      if (inactivity.enabled && (force || inactivityHourOk)) {
        inactivity.executed = true;
        if (inactivityActionError) {
          await writeAutomationLog(admin, {
            admin_user_id: callerId,
            source: "automation",
            source_id: "inactivity_reminder",
            automation_id: "inactivity_reminder",
            title: inactivityTitle,
            body: inactivityBody,
            type: "reminder",
            target_type: inactivityDays >= 7 ? "no_jornada_7_days" : "no_jornada_2_days",
            send_push: inactivitySendPush,
            create_internal_notification: inactivityCreateInternal,
            button_text: inactivityAction.buttonText,
            button_url: inactivityAction.buttonUrl,
            data: { ...inactivityPayloadData, automation_id: "inactivity_reminder", dry_run: dryRun },
            users_targeted: 0,
            tokens_found: 0,
            push_ok: 0,
            push_failed: 0,
            internal_created: 0,
            status: "error",
            error_message: inactivityActionError,
          });
          throw new Error(inactivityActionError);
        }
        const { data: profiles, error: profilesErr } = await admin
          .from("profiles")
          .select("id,created_at,last_jornada_at,last_inactivity_notification_sent_at,notifications_enabled,push_reminders_enabled")
          .eq("push_reminders_enabled", true)
          .eq("notifications_enabled", true)
          .limit(5000);
        if (profilesErr) throw profilesErr;

        const candidates = (profiles || []).filter((p: any) => {
          const last = p.last_jornada_at || p.created_at;
          if (!last) return false;
          if (String(last) > thresholdInactivity) return false;
          const sent = p.last_inactivity_notification_sent_at;
          if (!force && sent && String(sent) > cooldown24h) return false;
          return true;
        });
        inactivity.candidates = candidates.length;

        const userIds = candidates.map((p: any) => String(p.id || "")).filter(Boolean);
        if (!dryRun && userIds.length > 0) {
          const dispatchId = await createNotificationDispatch(admin, {
            admin_user_id: callerId,
            source: "automation",
            automation_id: "inactivity_reminder",
            title: inactivityTitle,
            body: inactivityBody,
            type: "reminder",
            target_type: inactivityDays >= 7 ? "no_jornada_7_days" : "no_jornada_2_days",
            send_push: inactivitySendPush,
            create_internal_notification: inactivityCreateInternal,
            button_text: inactivityAction.buttonText,
            button_url: inactivityAction.buttonUrl,
            data: inactivityPayloadData,
            visibility_mode: inactivityVisibilityMode,
            users_targeted: userIds.length,
          });
          const sentUserIds = new Set<string>(userIds);
          const userTokenCount = new Map<string, number>();
          const userPushErrors = new Map<string, string | null>();
          const userPushSucceeded = new Set<string>();

          if (inactivitySendPush) {
            const { data: tokens, error: tokensErr } = await admin
              .from("push_tokens")
              .select("user_id,expo_push_token")
              .in("user_id", userIds)
              .eq("notifications_enabled", true)
              .limit(20000);
            if (tokensErr) throw tokensErr;

            const messages = [];
            for (const row of tokens || []) {
              const token = row.expo_push_token;
              if (!token || typeof token !== "string") continue;
              const tokenUserId = typeof row.user_id === "string" ? row.user_id : null;
              if (tokenUserId) {
                userTokenCount.set(tokenUserId, (userTokenCount.get(tokenUserId) || 0) + 1);
              }
              messages.push({
                to: token,
                sound: "default",
                title: inactivityTitle,
                body: inactivityBody,
                data: inactivityPayloadData,
                _userId: tokenUserId,
              });
            }
            const pushRes = await sendExpo(messages);
            inactivity.pushOk = pushRes.ok;
            inactivity.pushFailed = pushRes.failed;
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

          inactivity.internalCreated = await insertInternalNotifications(
            admin,
            userIds.map((uid) => ({
              user_id: uid,
              type: "inactivity_reminder",
              title: inactivityTitle,
              body: inactivityBody,
              button_text: inactivityAction.buttonText,
              button_url: inactivityAction.buttonUrl,
              data: inactivityPayloadData,
              notification_dispatch_id: dispatchId,
              delivered_at: new Date().toISOString(),
              push_status: !inactivitySendPush
                ? "not_requested"
                : (userTokenCount.get(uid) || 0) === 0
                  ? "no_token"
                  : userPushSucceeded.has(uid)
                    ? "sent"
                    : "failed",
              delivery_error: !inactivitySendPush
                ? null
                : (userTokenCount.get(uid) || 0) === 0
                  ? "No push token available"
                  : userPushErrors.get(uid) || null,
              visibility_mode: inactivityVisibilityMode,
            })),
          );

          const sentUsers = Array.from(sentUserIds);
          inactivity.sentUsers = sentUsers.length;
          if (sentUsers.length > 0) {
            const { error: updErr } = await admin
              .from("profiles")
              .update({ last_inactivity_notification_sent_at: new Date().toISOString() } as any)
              .in("id", sentUsers);
            if (updErr) throw updErr;
          }

          await admin
            .from("notification_dispatches")
            .update({
              tokens_found: inactivity.pushOk + inactivity.pushFailed,
              push_ok: inactivity.pushOk,
              push_failed: inactivity.pushFailed,
              internal_created: inactivity.internalCreated,
              updated_at: new Date().toISOString(),
            })
            .eq("id", dispatchId);
        }

        await writeAutomationLog(admin, {
          admin_user_id: callerId,
          source: "automation",
          source_id: "inactivity_reminder",
          automation_id: "inactivity_reminder",
          title: inactivityTitle,
          body: inactivityBody,
          type: "reminder",
          target_type: inactivityDays >= 7 ? "no_jornada_7_days" : "no_jornada_2_days",
          send_push: inactivitySendPush,
          create_internal_notification: inactivityCreateInternal,
          button_text: inactivityAction.buttonText,
          button_url: inactivityAction.buttonUrl,
          data: { ...inactivityPayloadData, automation_id: "inactivity_reminder", dry_run: dryRun },
          users_targeted: dryRun ? inactivity.candidates : inactivity.sentUsers,
          tokens_found: inactivity.pushOk + inactivity.pushFailed,
          push_ok: inactivity.pushOk,
          push_failed: inactivity.pushFailed,
          internal_created: inactivity.internalCreated,
          status: dryRun ? "partial" : "success",
        });
      }
    }

    const payroll = {
      enabled: payrollCfg?.enabled !== false,
      skipped: !shouldRun("payroll_estimate"),
      dueUsers: 0,
      notifiedUsers: 0,
      pushOk: 0,
      pushFailed: 0,
      internalCreated: 0,
      executed: false,
    };

    if (!payroll.skipped) {
      const payrollHourOk = isAutomationHourMatch(payrollCfg);
      const payrollSendPush = payrollCfg?.send_push === false ? false : true;
      const payrollCreateInternal = payrollCfg?.create_internal_notification === false ? false : true;
      const payrollVisibilityMode = payrollCfg?.visibility_mode === "persistent" ? "persistent" : "snapshot";
      const payrollActionError = notificationActionValidationError({
        button_text: payrollCfg?.button_text,
        button_url: payrollCfg?.button_url,
      });
      const payrollAction = normalizeNotificationActionFields({
        button_text: payrollCfg?.button_text,
        button_url: payrollCfg?.button_url,
      });
      if (payroll.enabled && (force || payrollHourOk)) {
        payroll.executed = true;
        if (payrollActionError) {
          await writeAutomationLog(admin, {
            admin_user_id: callerId,
            source: "automation",
            source_id: "payroll_estimate",
            automation_id: "payroll_estimate",
            title: typeof payrollCfg?.title === "string" && payrollCfg.title.trim() ? payrollCfg.title.trim() : "Estimación de nómina disponible",
            body: typeof payrollCfg?.body === "string" && payrollCfg.body.trim() ? payrollCfg.body.trim() : "Estimación de nómina disponible para el periodo actual.",
            type: "payroll_estimate",
            target_type: "all",
            send_push: payrollSendPush,
            create_internal_notification: payrollCreateInternal,
            button_text: payrollAction.buttonText,
            button_url: payrollAction.buttonUrl,
            data: { automation_id: "payroll_estimate", dry_run: dryRun },
            users_targeted: 0,
            tokens_found: 0,
            push_ok: 0,
            push_failed: 0,
            internal_created: 0,
            status: "error",
            error_message: payrollActionError,
          });
          throw new Error(payrollActionError);
        }
        let payrollProfiles: any[] = [];
        try {
          const r = await admin
            .from("profiles")
            .select("id,period_type,period_start_day,period_end_day,notifications_enabled,payroll_notifications_enabled")
            .eq("notifications_enabled", true)
            .limit(5000);
          if (r.error) {
            const fb = await admin
              .from("profiles")
              .select("id,period_type,period_start_day,period_end_day,notifications_enabled")
              .eq("notifications_enabled", true)
              .limit(5000);
            payrollProfiles = fb.error ? [] : (fb.data || []);
          } else {
            payrollProfiles = r.data || [];
          }
        } catch {
          payrollProfiles = [];
        }

        const todayStr = new Date().toISOString().slice(0, 10);
        const due = (payrollProfiles || []).filter((p: any) => {
          if (!p?.id) return false;
          if (p?.notifications_enabled === false) return false;
          if (p?.payroll_notifications_enabled === false) return false;
          const mode = String(p?.period_type || "AUTO_01_30");
          const sd = Number(p?.period_start_day || 1);
          const ed = Number(p?.period_end_day || 30);
          return computePeriodRange(mode, sd, ed, new Date()).to === todayStr;
        });

        payroll.dueUsers = due.length;
        if (!dryRun && due.length > 0) {
          const dispatchId = await createNotificationDispatch(admin, {
            admin_user_id: callerId,
            source: "automation",
            automation_id: "payroll_estimate",
            title: typeof payrollCfg?.title === "string" && payrollCfg.title.trim() ? payrollCfg.title.trim() : "Estimación de nómina disponible",
            body: typeof payrollCfg?.body === "string" && payrollCfg.body.trim() ? payrollCfg.body.trim() : "Estimación de nómina disponible para el periodo actual.",
            type: "payroll_estimate",
            target_type: "all",
            send_push: payrollSendPush,
            create_internal_notification: payrollCreateInternal,
            button_text: payrollAction.buttonText,
            button_url: payrollAction.buttonUrl,
            data: { automation_id: "payroll_estimate" },
            visibility_mode: payrollVisibilityMode,
            users_targeted: due.length,
          });
          const payrollUserIds = due.map((p: any) => String(p.id));
          const { data: payrollTokens, error: payrollTokensErr } = await admin
            .from("push_tokens")
            .select("user_id,expo_push_token,notifications_enabled")
            .in("user_id", payrollUserIds)
            .eq("notifications_enabled", true)
            .limit(20000);
          if (payrollTokensErr) throw payrollTokensErr;

          const tokenMap = new Map<string, string[]>();
          for (const row of payrollTokens || []) {
            const uid = String(row.user_id || "");
            const tok = row.expo_push_token;
            if (!uid || !tok) continue;
            if (!tokenMap.has(uid)) tokenMap.set(uid, []);
            tokenMap.get(uid)!.push(tok);
          }

          const notifRows: any[] = [];
          const pushMessages: any[] = [];
          const notified = new Set<string>();
          const userTokenCount = new Map<string, number>();
          const userPushErrors = new Map<string, string | null>();
          const userPushSucceeded = new Set<string>();

          for (const profile of due) {
            const uid = String(profile.id);
            const mode = String(profile?.period_type || "AUTO_01_30");
            const sd = Number(profile?.period_start_day || 1);
            const ed = Number(profile?.period_end_day || 30);
            const range = computePeriodRange(mode, sd, ed, new Date());
            const periodKey = `${range.from}_${range.to}`;

            const exists = await admin
              .from("user_notifications")
              .select("id")
              .eq("user_id", uid)
              .eq("type", "payroll_estimate_available")
              .eq("data->>period_key", periodKey)
              .limit(1)
              .maybeSingle();
            if (!force && !exists.error && exists.data?.id) continue;

            const title = typeof payrollCfg?.title === "string" && payrollCfg.title.trim()
              ? payrollCfg.title.trim()
              : "Estimación de nómina disponible";
            const bodyText = typeof payrollCfg?.body === "string" && payrollCfg.body.trim()
              ? payrollCfg.body.trim()
              : `Ya tienes disponible la estimación acumulada del periodo ${formatFechaES(range.from)} - ${formatFechaES(range.to)}.`;
            const payrollPayloadData = withNotificationActionData(
              { type: "payroll_estimate_available", period_key: periodKey, period_from: range.from, period_to: range.to },
              payrollAction,
            );

            if (payrollCreateInternal) {
              notifRows.push({
                user_id: uid,
                type: "payroll_estimate_available",
                title,
                body: bodyText,
                button_text: payrollAction.buttonText,
                button_url: payrollAction.buttonUrl,
                data: payrollPayloadData,
              });
            }

            if (payrollSendPush) {
              for (const tok of tokenMap.get(uid) || []) {
                userTokenCount.set(uid, (userTokenCount.get(uid) || 0) + 1);
                pushMessages.push({
                  to: tok,
                  sound: "default",
                  title,
                  body: bodyText,
                  data: payrollPayloadData,
                  _userId: uid,
                });
              }
            }

            notified.add(uid);
          }

          const pushRes = payrollSendPush ? await sendExpo(pushMessages) : { ok: 0, failed: 0, tickets: [] };
          payroll.pushOk = pushRes.ok;
          payroll.pushFailed = pushRes.failed;
          for (const ticket of pushRes.tickets) {
            if (!ticket.userId) continue;
            if (ticket.ok) {
              userPushSucceeded.add(ticket.userId);
              userPushErrors.delete(ticket.userId);
            } else if (!userPushSucceeded.has(ticket.userId)) {
              userPushErrors.set(ticket.userId, ticket.message || "push_failed");
            }
          }

          const deliveryRows = Array.from(notified).map((uid) => ({
            user_id: uid,
            type: "payroll_estimate_available",
            title: (notifRows.find((row) => row.user_id === uid)?.title) || "Estimación de nómina disponible",
            body: (notifRows.find((row) => row.user_id === uid)?.body) || "Estimación de nómina disponible para el periodo actual.",
            button_text: payrollAction.buttonText,
            button_url: payrollAction.buttonUrl,
            data: (notifRows.find((row) => row.user_id === uid)?.data) || { type: "payroll_estimate_available" },
            notification_dispatch_id: dispatchId,
            delivered_at: new Date().toISOString(),
            push_status: !payrollSendPush
              ? "not_requested"
              : (userTokenCount.get(uid) || 0) === 0
                ? "no_token"
                : userPushSucceeded.has(uid)
                  ? "sent"
                  : "failed",
            delivery_error: !payrollSendPush
              ? null
              : (userTokenCount.get(uid) || 0) === 0
                ? "No push token available"
                : userPushErrors.get(uid) || null,
            visibility_mode: payrollVisibilityMode,
          }));
          payroll.internalCreated = await insertInternalNotifications(admin, deliveryRows);
          payroll.notifiedUsers = notified.size;

          await admin
            .from("notification_dispatches")
            .update({
              tokens_found: payroll.pushOk + payroll.pushFailed,
              push_ok: payroll.pushOk,
              push_failed: payroll.pushFailed,
              internal_created: payroll.internalCreated,
              updated_at: new Date().toISOString(),
            })
            .eq("id", dispatchId);
        }

        await writeAutomationLog(admin, {
          admin_user_id: callerId,
          source: "automation",
          source_id: "payroll_estimate",
          automation_id: "payroll_estimate",
          title: typeof payrollCfg?.title === "string" && payrollCfg.title.trim() ? payrollCfg.title.trim() : "Estimación de nómina disponible",
          body: typeof payrollCfg?.body === "string" && payrollCfg.body.trim() ? payrollCfg.body.trim() : "Estimación de nómina disponible para el periodo actual.",
          type: "payroll_estimate",
          target_type: "all",
          send_push: payrollSendPush,
          create_internal_notification: payrollCreateInternal,
          button_text: payrollAction.buttonText,
          button_url: payrollAction.buttonUrl,
          data: { automation_id: "payroll_estimate", dry_run: dryRun },
          users_targeted: dryRun ? payroll.dueUsers : payroll.notifiedUsers,
          tokens_found: payroll.pushOk + payroll.pushFailed,
          push_ok: payroll.pushOk,
          push_failed: payroll.pushFailed,
          internal_created: payroll.internalCreated,
          status: dryRun ? "partial" : "success",
        });
      }
    }

    const appUpdate = {
      enabled: updateCfg?.enabled !== false,
      skipped: !shouldRun("app_update"),
      users: 0,
      pushOk: 0,
      pushFailed: 0,
      internalCreated: 0,
      executed: false,
    };

    if (!appUpdate.skipped) {
      const updateHourOk = isAutomationHourMatch(updateCfg);
      const updateSendPush = updateCfg?.send_push === false ? false : true;
      const updateCreateInternal = updateCfg?.create_internal_notification === false ? false : true;
      const updateTitle = typeof updateCfg?.title === "string" && updateCfg.title.trim()
        ? updateCfg.title.trim()
        : "Nueva versión disponible";
      const defaultUpdateBody = typeof updateCfg?.body === "string" && updateCfg.body.trim()
        ? updateCfg.body.trim()
        : "Actualiza Tacoplan para seguir usando las mejoras más recientes.";
      const updateActionError = notificationActionValidationError({
        button_text: updateCfg?.button_text,
        button_url: updateCfg?.button_url,
      });
      const updateAction = normalizeNotificationActionFields({
        button_text: updateCfg?.button_text,
        button_url: updateCfg?.button_url,
      });
      if (appUpdate.enabled && (force || updateHourOk)) {
        appUpdate.executed = true;
        if (updateActionError) {
          await writeAutomationLog(admin, {
            admin_user_id: callerId,
            source: "automation",
            source_id: "app_update",
            automation_id: "app_update",
            title: updateTitle,
            body: defaultUpdateBody,
            type: "update",
            target_type: "outdated_version",
            send_push: updateSendPush,
            create_internal_notification: updateCreateInternal,
            button_text: updateAction.buttonText,
            button_url: updateAction.buttonUrl,
            data: { automation_id: "app_update", dry_run: dryRun },
            users_targeted: 0,
            tokens_found: 0,
            push_ok: 0,
            push_failed: 0,
            internal_created: 0,
            status: "error",
            error_message: updateActionError,
          });
          throw new Error(updateActionError);
        }
        const { data: configs, error: cfgErr } = await admin
          .from("app_update_config")
          .select("platform,channel,latest_version,min_required_version,minimum_version,force_update,apk_url,app_store_url,message,updated_at,enabled")
          .eq("enabled", true)
          .limit(50);
        if (cfgErr) throw cfgErr;

        for (const config of configs || []) {
          const platform = String(config?.platform || "").toLowerCase();
          const latestVersion = String(config?.latest_version || "").trim();
          if (!platform || !latestVersion) continue;

          const { data: devices, error: devicesErr } = await admin
            .from("app_user_devices")
            .select("user_id,device_id,platform,app_version")
            .eq("platform", platform)
            .limit(20000);
          if (devicesErr) throw devicesErr;

          const outdatedUsers = new Set<string>();
          for (const device of devices || []) {
            const uid = String(device.user_id || "");
            const appVersion = String(device.app_version || "").trim();
            if (!uid || !appVersion) continue;
            if (platform && latestVersion && compareSemver(appVersion, latestVersion) < 0) {
              outdatedUsers.add(uid);
            }
          }

          const userIds = Array.from(outdatedUsers);
          if (userIds.length === 0) continue;
          appUpdate.users += userIds.length;

          if (dryRun) continue;

          const { data: tokenRows, error: tokErr } = await admin
            .from("push_tokens")
            .select("user_id,expo_push_token")
            .in("user_id", userIds)
            .eq("platform", platform)
            .eq("notifications_enabled", true)
            .limit(20000);
          if (tokErr) throw tokErr;

          const title = updateTitle;
          const bodyText = defaultUpdateBody !== "Actualiza Tacoplan para seguir usando las mejoras más recientes."
            ? defaultUpdateBody
            : (String(config?.message || "").trim() || `Actualiza Tacoplan a la versión ${latestVersion} para mejorar estabilidad y rendimiento.`);
          const payloadData = {
            type: "app_update_available",
            platform,
            latest_version: latestVersion,
            min_required_version: String(config?.min_required_version || config?.minimum_version || ""),
            minimum_version: String(config?.minimum_version || config?.min_required_version || ""),
            force_update: !!config?.force_update,
            apk_url: String(config?.apk_url || ""),
            app_store_url: String(config?.app_store_url || ""),
            channel: config?.channel ?? null,
            config_updated_at: config?.updated_at ?? null,
          };
          const updatePayloadData = withNotificationActionData(payloadData, updateAction);

          if (updateCreateInternal) {
            const existing = await admin
              .from("user_notifications")
              .select("user_id,data")
              .eq("type", "app_update_available")
              .in("user_id", userIds)
              .limit(20000);
            const already = new Set<string>();
            if (!force && !existing.error) {
              for (const row of existing.data || []) {
                const uid = String(row.user_id || "");
                const v = String((row as any)?.data?.latest_version || "");
                const p = String((row as any)?.data?.platform || "");
                if (uid && v === latestVersion && p === platform) already.add(uid);
              }
            }
            const toNotify = force ? userIds : userIds.filter((uid) => !already.has(uid));
            appUpdate.internalCreated += await insertInternalNotifications(
              admin,
              toNotify.map((uid) => ({
                user_id: uid,
                type: "app_update_available",
                title,
                body: bodyText,
                button_text: updateAction.buttonText,
                button_url: updateAction.buttonUrl,
                data: updatePayloadData,
              })),
            );
            const filteredTokens = (tokenRows || []).filter((row: any) => toNotify.includes(String(row.user_id || "")));
            if (updateSendPush) {
              const messages = [];
              for (const row of filteredTokens) {
                const token = row.expo_push_token;
                if (!token || typeof token !== "string") continue;
                messages.push({ to: token, sound: "default", title, body: bodyText, data: updatePayloadData });
              }
              const pushRes = await sendExpo(messages);
              appUpdate.pushOk += pushRes.ok;
              appUpdate.pushFailed += pushRes.failed;
            }
          } else if (updateSendPush) {
            const messages = [];
            for (const row of tokenRows || []) {
              const token = row.expo_push_token;
              if (!token || typeof token !== "string") continue;
              messages.push({ to: token, sound: "default", title, body: bodyText, data: updatePayloadData });
            }
            const pushRes = await sendExpo(messages);
            appUpdate.pushOk += pushRes.ok;
            appUpdate.pushFailed += pushRes.failed;
          }
        }

        await writeAutomationLog(admin, {
          admin_user_id: callerId,
          source: "automation",
          source_id: "app_update",
          automation_id: "app_update",
          title: updateTitle,
          body: defaultUpdateBody,
          type: "update",
          target_type: "outdated_version",
          send_push: updateSendPush,
          create_internal_notification: updateCreateInternal,
          button_text: updateAction.buttonText,
          button_url: updateAction.buttonUrl,
          data: { automation_id: "app_update", dry_run: dryRun },
          users_targeted: appUpdate.users,
          tokens_found: appUpdate.pushOk + appUpdate.pushFailed,
          push_ok: appUpdate.pushOk,
          push_failed: appUpdate.pushFailed,
          internal_created: appUpdate.internalCreated,
          status: dryRun ? "partial" : "success",
        });
      }
    }

    return json({
      ok: true,
      forced: force,
      dry_run: dryRun,
      inactivity,
      payroll,
      appUpdate,
    });
  } catch (e: any) {
    return json({ message: e?.message || String(e) }, 500);
  }
}
