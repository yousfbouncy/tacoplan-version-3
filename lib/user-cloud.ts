import {
  selectMissingPersistentDispatchIds,
  type NotificationVisibilityMode,
} from "@/lib/notification-visibility";
import { supabase } from "@/lib/supabase";

export type UserDietRateRow = {
  trip_type: "NACIONAL" | "INTERNACIONAL" | "REGIONAL";
  percent: 100 | 60 | 30;
  amount: number;
};

export type UserDayExtrasRow = {
  extra_saturday: number;
  extra_sunday: number;
  extra_holiday: number;
  offsite_weekly_reduced_nacional: number;
  offsite_weekly_reduced_internacional: number;
  offsite_weekly_complete_nacional: number;
  offsite_weekly_complete_internacional: number;
};

export type UserHolidayRow = {
  id: number;
  date: string;
  description?: string | null;
};

export type UserNotificationRow = {
  id: string;
  user_id: string;
  type: "system" | "reminder" | "update" | "warning" | "admin_message";
  title: string;
  body: string;
  button_text?: string | null;
  button_url?: string | null;
  data?: any;
  is_read: boolean;
  read_at?: string | null;
  notification_dispatch_id?: string | null;
  delivered_at?: string | null;
  push_status?: string | null;
  delivery_error?: string | null;
  visibility_mode?: NotificationVisibilityMode;
  created_at: string;
  updated_at?: string | null;
};

type PersistentDispatchRow = {
  id: string;
  title: string;
  body: string;
  type: UserNotificationRow["type"];
  target_type?: string | null;
  target_user_id?: string | null;
  button_text?: string | null;
  button_url?: string | null;
  data?: any;
  visibility_mode?: string | null;
  created_at: string;
};

async function syncPersistentNotificationsForUser(userId: string): Promise<void> {
  try {
    const [existingRes, dispatchesRes] = await Promise.all([
      supabase
        .from("user_notifications")
        .select("notification_dispatch_id")
        .eq("user_id", userId)
        .not("notification_dispatch_id", "is", null)
        .limit(2000),
      supabase
        .from("notification_dispatches")
        .select("id,title,body,type,target_type,target_user_id,button_text,button_url,data,visibility_mode,created_at")
        .eq("visibility_mode", "persistent")
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

    if (existingRes.error || dispatchesRes.error) return;
    const dispatches = (dispatchesRes.data || []) as PersistentDispatchRow[];
    const missingDispatchIds = selectMissingPersistentDispatchIds(
      dispatches,
      (existingRes.data || []).map((row: any) => row.notification_dispatch_id),
      userId,
    );
    if (missingDispatchIds.length === 0) return;

    const now = new Date().toISOString();
    const dispatchMap = new Map(dispatches.map((dispatch) => [dispatch.id, dispatch]));
    const rows = missingDispatchIds
      .map((dispatchId) => {
        const dispatch = dispatchMap.get(dispatchId);
        if (!dispatch) return null;
        return {
          user_id: userId,
          type: dispatch.type,
          title: dispatch.title,
          body: dispatch.body,
          button_text: dispatch.button_text ?? null,
          button_url: dispatch.button_url ?? null,
          data: dispatch.data ?? {},
          notification_dispatch_id: dispatch.id,
          delivered_at: now,
          push_status: "persistent_replay",
          delivery_error: null,
          visibility_mode: "persistent",
          created_at: dispatch.created_at,
          updated_at: now,
        };
      })
      .filter(Boolean);

    if (rows.length === 0) return;

    const upsertRes = await supabase.from("user_notifications").upsert(rows as any, {
      onConflict: "user_id,notification_dispatch_id",
    });
    if (!upsertRes.error) return;

    await supabase.from("user_notifications").insert(rows as any);
  } catch {}
}

export async function fetchDietRates(userId: string): Promise<UserDietRateRow[]> {
  const { data, error } = await supabase.from("user_diet_rates").select("trip_type,percent,amount").eq("user_id", userId);
  if (error) throw error;
  return (data || []) as any;
}

export async function fetchDayExtras(userId: string): Promise<UserDayExtrasRow> {
  const { data, error } = await supabase
    .from("user_day_extras")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    return {
      extra_saturday: 0,
      extra_sunday: 0,
      extra_holiday: 0,
      offsite_weekly_reduced_nacional: 0,
      offsite_weekly_reduced_internacional: 0,
      offsite_weekly_complete_nacional: 0,
      offsite_weekly_complete_internacional: 0,
    };
  }
  const safe = (v: any, fb: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  };
  return {
    extra_saturday: safe((data as any).extra_saturday, 0),
    extra_sunday: safe((data as any).extra_sunday, 0),
    extra_holiday: safe((data as any).extra_holiday, 0),
    offsite_weekly_reduced_nacional: safe((data as any).offsite_weekly_reduced_nacional, 0),
    offsite_weekly_reduced_internacional: safe((data as any).offsite_weekly_reduced_internacional, 0),
    offsite_weekly_complete_nacional: safe((data as any).offsite_weekly_complete_nacional, 0),
    offsite_weekly_complete_internacional: safe((data as any).offsite_weekly_complete_internacional, 0),
  };
}

export async function upsertDayExtras(userId: string, extras: Partial<UserDayExtrasRow>): Promise<void> {
  const row: Record<string, any> = {
    user_id: userId,
    extra_saturday: extras.extra_saturday ?? 0,
    extra_sunday: extras.extra_sunday ?? 0,
    extra_holiday: extras.extra_holiday ?? 0,
    offsite_weekly_reduced_nacional: extras.offsite_weekly_reduced_nacional ?? 0,
    offsite_weekly_reduced_internacional: extras.offsite_weekly_reduced_internacional ?? 0,
    offsite_weekly_complete_nacional: extras.offsite_weekly_complete_nacional ?? 0,
    offsite_weekly_complete_internacional: extras.offsite_weekly_complete_internacional ?? 0,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("user_day_extras").upsert(row, { onConflict: "user_id" });
  if (!error) return;
  const fallbackRow = {
    user_id: userId,
    extra_saturday: extras.extra_saturday ?? 0,
    extra_sunday: extras.extra_sunday ?? 0,
    extra_holiday: extras.extra_holiday ?? 0,
    updated_at: new Date().toISOString(),
  };
  const retry = await supabase.from("user_day_extras").upsert(fallbackRow, { onConflict: "user_id" });
  if (retry.error) throw retry.error;
}

export async function upsertDietRates(userId: string, rates: UserDietRateRow[]): Promise<void> {
  const rows = rates.map((r) => ({
    user_id: userId,
    trip_type: r.trip_type,
    percent: r.percent,
    amount: r.amount,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase.from("user_diet_rates").upsert(rows, { onConflict: "user_id,trip_type,percent" });
  if (error) throw error;
}

export async function fetchHolidays(userId: string): Promise<UserHolidayRow[]> {
  const { data, error } = await supabase.from("user_holidays").select("id,date,name").eq("user_id", userId).order("date");
  if (error) throw error;
  return (data || []).map((h: any) => ({ id: Number(h.id), date: String(h.date), description: h.name ?? null })) as any;
}

export async function createHoliday(userId: string, date: string, description?: string | null): Promise<UserHolidayRow> {
  const { data, error } = await supabase
    .from("user_holidays")
    .insert({ user_id: userId, date, name: description ?? null })
    .select("id,date,name")
    .single();
  if (error) throw error;
  return { id: Number((data as any).id), date: String((data as any).date), description: (data as any).name ?? null };
}

export async function deleteHoliday(userId: string, holidayId: number): Promise<void> {
  const { error } = await supabase.from("user_holidays").delete().eq("user_id", userId).eq("id", holidayId);
  if (error) throw error;
}

export async function updateProfileDisplayName(userId: string, displayName: string): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .upsert({ id: userId, display_name: displayName, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw error;
}

export async function fetchUserNotifications(userId: string, limit: number = 50): Promise<UserNotificationRow[]> {
  await syncPersistentNotificationsForUser(userId);
  const { data, error } = await supabase
    .from("user_notifications")
    .select("id,user_id,type,title,body,button_text,button_url,data,is_read,read_at,notification_dispatch_id,delivered_at,push_status,delivery_error,visibility_mode,created_at,updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as any;
}

export async function markUserNotificationRead(userId: string, id: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("user_notifications")
    .update({ is_read: true, read_at: now, updated_at: now } as any)
    .eq("user_id", userId)
    .eq("id", id);
  if (error) throw error;
}

export async function markAllUserNotificationsRead(userId: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("user_notifications")
    .update({ is_read: true, read_at: now, updated_at: now } as any)
    .eq("user_id", userId)
    .eq("is_read", false);
  if (error) throw error;
}

export async function deleteUserNotification(userId: string, id: string): Promise<void> {
  const { error } = await supabase.from("user_notifications").delete().eq("user_id", userId).eq("id", id);
  if (error) throw error;
}

export async function deleteReadUserNotifications(userId: string): Promise<void> {
  const { error } = await supabase.from("user_notifications").delete().eq("user_id", userId).eq("is_read", true);
  if (error) throw error;
}
