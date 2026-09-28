import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Apple,
  ArrowDownToLine,
  ArrowUpCircle,
  Bell,
  BellOff,
  Bot,
  CalendarClock,
  Check,
  ChevronLeft,
  CircleAlert,
  Clock3,
  Copy,
  LayoutDashboard,
  LoaderCircle,
  MessageSquareShare,
  Pause,
  PencilLine,
  RefreshCw,
  Search,
  SendHorizontal,
  Settings,
  Smartphone,
  Sparkles,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react-native";
import Colors from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import {
  ActionTile,
  AdminShell,
  Badge,
  EmptyCard,
  FilterPill,
  InlineButton,
  Label,
  MetricCard,
  SkeletonBlock,
  SurfaceCard,
  ToastBanner,
} from "@/components/admin/AdminUI";

export type AdminTab = "summary" | "users" | "notifications" | "scheduled" | "automations" | "updates" | "settings";

type AdminUserRow = {
  user_id: string;
  email: string;
  display_name?: string;
  platform?: string | null;
  app_version?: string | null;
  latest_version?: string | null;
  is_updated?: boolean | null;
  last_jornada_at?: string | null;
  days_since_last_jornada?: number | null;
  notifications_enabled?: boolean | null;
  has_push_token?: boolean | null;
  push_token_updated_at?: string | null;
  last_seen_at?: string | null;
  last_sync_at?: string | null;
};

type ScheduleTargetType =
  | "all"
  | "user"
  | "platform_ios"
  | "platform_android"
  | "outdated_version"
  | "updated_version"
  | "notifications_enabled"
  | "notifications_disabled"
  | "no_jornada_2_days"
  | "no_jornada_7_days";

type ScheduleFrequency = "once" | "daily" | "weekly" | "monthly";

type ScheduleRow = {
  id: string;
  title: string;
  body: string;
  type: string;
  button_text?: string | null;
  button_url?: string | null;
  target_type: ScheduleTargetType;
  target_user_id: string | null;
  send_push: boolean;
  create_internal_notification: boolean;
  frequency: ScheduleFrequency;
  week_days: number[] | null;
  day_of_month: number | null;
  time_utc: string | null;
  next_run_at: string;
  last_run_at: string | null;
  enabled: boolean;
  data?: any;
  created_at?: string;
  updated_at?: string;
};

type AutomationSetting = {
  id: string;
  enabled: boolean;
  hour_utc: number | null;
  days_without_jornada?: number | null;
  send_push: boolean;
  create_internal_notification: boolean;
  title?: string | null;
  body?: string | null;
  button_text?: string | null;
  button_url?: string | null;
  data?: any;
};

type AppUpdateConfigRow = {
  platform: "ios" | "android" | "web";
  channel: string | null;
  latest_version: string | null;
  min_required_version: string | null;
  minimum_version?: string | null;
  force_update: boolean;
  apk_url: string | null;
  app_store_url?: string | null;
  enabled?: boolean | null;
  message: string | null;
};

type SummaryState = {
  registeredUsers: number;
  activeUsers: number;
  notificationsToday: number;
  scheduledNotifications: number;
  automationsActive: number;
  lastActivityAt: string | null;
  updatedUsers: number;
  outdatedUsers: number;
  iosUsers: number;
  androidUsers: number;
};

type ToastState = {
  tone: "success" | "danger" | "info";
  message: string;
} | null;

type NotificationPreview = {
  targetUsers?: number;
  tokens?: number;
  internalNotificationsCreated?: number;
  push_tokens_by_platform?: { ios?: number; android?: number; other?: number };
};

const NOTIFICATION_TYPE_OPTIONS = [
  "admin_message",
  "update_optional",
  "update_required",
  "reminder",
  "warning",
  "payroll_estimate",
] as const;

type NotificationMessageType = (typeof NOTIFICATION_TYPE_OPTIONS)[number];

type NotificationComposeDraft = {
  title: string;
  body: string;
  type: NotificationMessageType;
  buttonText: string;
  buttonUrl: string;
  targetType: ScheduleTargetType;
  targetPlatform: "" | "ios" | "android";
  selectedUser: AdminUserRow | null;
  sendPush: boolean;
  createInternal: boolean;
};

let pendingNotificationComposeDraft: NotificationComposeDraft | null = null;

function saveNotificationComposeDraft(partial: Partial<NotificationComposeDraft>) {
  pendingNotificationComposeDraft = {
    title: "",
    body: "",
    type: "admin_message",
    buttonText: "",
    buttonUrl: "",
    targetType: "all",
    targetPlatform: "",
    selectedUser: null,
    sendPush: true,
    createInternal: true,
    ...(pendingNotificationComposeDraft ?? {}),
    ...partial,
  };
}

function consumeNotificationComposeDraft() {
  const draft = pendingNotificationComposeDraft;
  pendingNotificationComposeDraft = null;
  return draft;
}

const TYPE_LABELS: Record<string, string> = {
  admin_message: "Mensaje admin",
  update: "Actualización",
  update_optional: "Actualización opcional",
  update_required: "Actualización obligatoria",
  reminder: "Recordatorio",
  warning: "Aviso",
  payroll_estimate: "Estimación nómina",
};

const TARGET_OPTIONS: Array<{ key: ScheduleTargetType; label: string }> = [
  { key: "all", label: "Todos" },
  { key: "user", label: "Usuario" },
  { key: "platform_ios", label: "Solo iOS" },
  { key: "platform_android", label: "Solo Android" },
  { key: "outdated_version", label: "Versión antigua" },
  { key: "updated_version", label: "Versión nueva" },
  { key: "notifications_enabled", label: "Notif. activadas" },
  { key: "notifications_disabled", label: "Notif. desactivadas" },
  { key: "no_jornada_2_days", label: "Sin jornada 2 días" },
  { key: "no_jornada_7_days", label: "Sin jornada 7 días" },
];

const USER_FILTER_OPTIONS = [
  { key: "all", label: "Todos" },
  { key: "updated", label: "Versión actualizada" },
  { key: "outdated", label: "Versión antigua" },
  { key: "unknown_version", label: "Sin versión" },
  { key: "notifications_enabled", label: "Notificaciones activadas" },
  { key: "notifications_disabled", label: "Notificaciones desactivadas" },
  { key: "no_jornada_2_days", label: "Sin jornada 2 días" },
  { key: "no_jornada_7_days", label: "Sin jornada 7 días" },
  { key: "platform_android", label: "Android" },
  { key: "platform_ios", label: "iPhone" },
] as const;

const USER_SORT_OPTIONS = [
  { key: "last_jornada_desc", label: "Última jornada" },
  { key: "days_since_desc", label: "Más días sin jornada" },
  { key: "outdated_first", label: "Versión antigua primero" },
  { key: "notifications_disabled_first", label: "Notif. no primero" },
] as const;

const NAV_ITEMS = [
  { key: "summary", label: "Resumen", icon: LayoutDashboard },
  { key: "users", label: "Usuarios", icon: Users },
  { key: "notifications", label: "Notificaciones", icon: Bell },
  { key: "scheduled", label: "Programadas", icon: CalendarClock },
  { key: "automations", label: "Automáticas", icon: Bot },
  { key: "updates", label: "Actualizaciones", icon: ArrowUpCircle },
  { key: "settings", label: "Ajustes", icon: Settings },
] as const;

function adminPath(tab: AdminTab) {
  switch (tab) {
    case "summary": return "/admin/summary";
    case "users": return "/admin/users";
    case "notifications": return "/admin/notifications";
    case "scheduled": return "/admin/scheduled";
    case "automations": return "/admin/automations";
    case "updates": return "/admin/updates";
    case "settings": return "/admin/settings";
  }
}

function friendlyError(e: any, fallback: string) {
  const msg = String(e?.message || e || "").trim();
  const lower = msg.toLowerCase();
  if (!msg) return fallback;
  if (lower.includes("requested function was not found") || lower.includes("not found")) {
    return "La función del panel todavía no está desplegada en Supabase.";
  }
  if (lower.includes("failed to fetch")) {
    return "No se pudo conectar con Supabase. Revisa que la Edge Function exista y esté accesible.";
  }
  if (lower.includes("no autorizado")) {
    return "Tu sesión no tiene permisos para esta acción.";
  }
  if (lower.includes("missing supabase env vars")) {
    return "Faltan variables de entorno en la Edge Function.";
  }
  return msg || fallback;
}

function parseIntOrNull(v: string): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function pad2(v: number) {
  return String(v).padStart(2, "0");
}

function formatIsoToLocal(iso: string | null | undefined) {
  if (!iso) return "Sin dato";
  try {
    const d = new Date(iso);
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} · ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  } catch {
    return String(iso);
  }
}

function formatRelativeDays(days: number | null | undefined) {
  if (days == null) return "Sin jornadas";
  if (days <= 0) return "Hoy";
  if (days === 1) return "Hace 1 día";
  return `Hace ${days} días`;
}

function getNowFormDate() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function getNowFormTime() {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const LOCAL_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Madrid";

function toLocalDateInput(iso?: string | null) {
  if (!iso) return getNowFormDate();
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function toLocalTimeInput(iso?: string | null) {
  if (!iso) return getNowFormTime();
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function localDateTimeToIso(dateStr: string, timeStr: string) {
  const d = new Date(`${dateStr}T${timeStr}:00`);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function toHourLabel(hour: number | null | undefined) {
  if (hour == null || !Number.isFinite(hour)) return "Sin hora";
  return `${pad2(Number(hour))}:00`;
}

function scheduleStatus(row: ScheduleRow) {
  if (!row.enabled) return { label: "Pausada", tone: "warning" as const };
  if (row.frequency === "once" && row.last_run_at) return { label: "Enviada", tone: "success" as const };
  return { label: "Programada", tone: "info" as const };
}

function updateBadge(user: AdminUserRow) {
  if (user.is_updated === true) return { label: "Actualizada", tone: "success" as const };
  if (user.is_updated === false) return { label: "Versión antigua", tone: "warning" as const };
  return { label: "Desconocido", tone: "default" as const };
}

function targetLabel(targetType: ScheduleTargetType) {
  return TARGET_OPTIONS.find((item) => item.key === targetType)?.label ?? targetType;
}

function notificationActionError(buttonText: string | null | undefined, buttonUrl: string | null | undefined) {
  const hasText = !!String(buttonText || "").trim();
  const hasUrl = !!String(buttonUrl || "").trim();
  if (hasText === hasUrl) return null;
  return "Completa el nombre del botón y el enlace (URL) para incluir la acción.";
}

function makeEmptySchedule() {
  return {
    id: null as string | null,
    title: "",
    body: "",
    type: "admin_message",
    button_text: "",
    button_url: "",
    target_type: "all" as ScheduleTargetType,
    target_user_id: "",
    platform: "" as "" | "ios" | "android",
    send_push: true,
    create_internal_notification: true,
    frequency: "once" as ScheduleFrequency,
    week_days: [1, 2, 3, 4, 5] as number[],
    day_of_month: "",
    date: getNowFormDate(),
    time: getNowFormTime(),
    timezone: LOCAL_TIMEZONE,
    enabled: true,
  };
}

function SearchField({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
}) {
  return (
    <View style={styles.searchField}>
      <Search size={16} color={Colors.light.textSecondary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#94A3B8"
        style={styles.searchInput}
      />
    </View>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Label>{label}</Label>
      {children}
    </View>
  );
}

function Input(props: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      placeholderTextColor="#94A3B8"
      {...props}
      style={[styles.input, props.multiline && styles.textarea, props.style]}
    />
  );
}

function ToggleRow({
  label,
  value,
  onPress,
  helper,
}: {
  label: string;
  value: boolean;
  onPress: () => void;
  helper?: string;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.toggleRow, pressed && { opacity: 0.9 }]}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.toggleTitle}>{label}</Text>
        {helper ? <Text style={styles.toggleHelper}>{helper}</Text> : null}
      </View>
      <View style={[styles.switchBase, value && styles.switchBaseOn]}>
        <View style={[styles.switchThumb, value && styles.switchThumbOn]} />
      </View>
    </Pressable>
  );
}

function WeekdaySelector({
  value,
  onToggle,
}: {
  value: number[];
  onToggle: (day: number) => void;
}) {
  const labels = ["D", "L", "M", "X", "J", "V", "S"];
  return (
    <View style={styles.weekDaysRow}>
      {labels.map((label, index) => (
        <Pressable
          key={label}
          onPress={() => onToggle(index)}
          style={({ pressed }) => [styles.dayChip, value.includes(index) && styles.dayChipActive, pressed && { opacity: 0.9 }]}
        >
          <Text style={[styles.dayChipText, value.includes(index) && styles.dayChipTextActive]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function AdminPanelScreen({ screen }: { screen: AdminTab }) {
  const { isAdmin, isAdminLoading, refreshAdminStatus, getAccessToken } = useAuth();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isWide = width >= 900;
  const isCompact = width < 680;
  const metricsPerRow = width >= 1400 ? 6 : width >= 1100 ? 3 : width >= 680 ? 2 : 1;
  const tab = screen;
  const [toast, setToast] = useState<ToastState>(null);
  const [detailUser, setDetailUser] = useState<AdminUserRow | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const contentFade = useRef(new Animated.Value(1)).current;

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<NotificationMessageType>("admin_message");
  const [buttonText, setButtonText] = useState("");
  const [buttonUrl, setButtonUrl] = useState("");
  const [targetType, setTargetType] = useState<ScheduleTargetType>("all");
  const [targetPlatform, setTargetPlatform] = useState<"" | "ios" | "android">("");
  const [selectedUser, setSelectedUser] = useState<AdminUserRow | null>(null);
  const [sendPush, setSendPush] = useState(true);
  const [createInternal, setCreateInternal] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<any | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewResult, setPreviewResult] = useState<NotificationPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [usersQ, setUsersQ] = useState("");
  const [usersFilter, setUsersFilter] = useState<(typeof USER_FILTER_OPTIONS)[number]["key"]>("all");
  const [pendingUsersFilter, setPendingUsersFilter] = useState<(typeof USER_FILTER_OPTIONS)[number]["key"]>("all");
  const [usersFilterSheetVisible, setUsersFilterSheetVisible] = useState(false);
  const [usersSort, setUsersSort] = useState<(typeof USER_SORT_OPTIONS)[number]["key"]>("last_jornada_desc");
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [usersOffset, setUsersOffset] = useState(0);
  const [usersTotalLoaded, setUsersTotalLoaded] = useState(0);

  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summary, setSummary] = useState<SummaryState | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(false);
  const [schedulesError, setSchedulesError] = useState<string | null>(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleRunningId, setScheduleRunningId] = useState<string | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState(makeEmptySchedule());

  const [autoLoading, setAutoLoading] = useState(false);
  const [auto, setAuto] = useState<Record<string, AutomationSetting>>({});
  const [autoError, setAutoError] = useState<string | null>(null);
  const [runningAutomationId, setRunningAutomationId] = useState<string | null>(null);

  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [updateLoading, setUpdateLoading] = useState(false);
  const [updateSaving, setUpdateSaving] = useState(false);
  const [updateConfig, setUpdateConfig] = useState<Record<"ios" | "android" | "web", AppUpdateConfigRow>>({
    ios: { platform: "ios", channel: null, latest_version: null, min_required_version: null, minimum_version: null, force_update: false, apk_url: null, app_store_url: null, enabled: true, message: null },
    android: { platform: "android", channel: null, latest_version: null, min_required_version: null, minimum_version: null, force_update: false, apk_url: null, app_store_url: null, enabled: true, message: null },
    web: { platform: "web", channel: null, latest_version: null, min_required_version: null, minimum_version: null, force_update: false, apk_url: null, app_store_url: null, enabled: true, message: null },
  });

  useEffect(() => {
    refreshAdminStatus().catch(() => {});
  }, [refreshAdminStatus]);

  const goToScreen = useCallback((next: AdminTab) => {
    router.push(adminPath(next) as any);
  }, []);

  useEffect(() => {
    Animated.timing(contentFade, {
      toValue: 0.98,
      duration: 1,
      useNativeDriver: true,
    }).start(() => {
      Animated.timing(contentFade, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
    });
  }, [contentFade, tab]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    setPendingUsersFilter(usersFilter);
  }, [usersFilter]);

  useEffect(() => {
    if (targetType === "outdated_version" || targetType === "updated_version") return;
    setTargetPlatform("");
  }, [targetType]);

  useEffect(() => {
    if (tab !== "notifications") return;
    const draft = consumeNotificationComposeDraft();
    if (!draft) return;
    setTitle(draft.title);
    setBody(draft.body);
    setType(draft.type);
    setButtonText(draft.buttonText);
    setButtonUrl(draft.buttonUrl);
    setTargetType(draft.targetType);
    setTargetPlatform(draft.targetPlatform);
    setSelectedUser(draft.selectedUser);
    setSendPush(draft.sendPush);
    setCreateInternal(draft.createInternal);
  }, [tab]);

  const functionsBaseUrl = useMemo(() => {
    const base = (supabase as any)?.supabaseUrl ? String((supabase as any).supabaseUrl) : "";
    return base ? `${base.replace(/\/$/, "")}/functions/v1` : "";
  }, []);

  const showToast = useCallback((tone: NonNullable<ToastState>["tone"], message: string) => {
    setToast({ tone, message });
  }, []);

  const openUserPicker = useCallback(() => {
    saveNotificationComposeDraft({
      title,
      body,
      type,
      buttonText,
      buttonUrl,
      targetType: "user",
      targetPlatform,
      selectedUser,
      sendPush,
      createInternal,
    });
    goToScreen("users");
  }, [body, buttonText, buttonUrl, createInternal, goToScreen, selectedUser, sendPush, targetPlatform, title, type]);

  const openNotificationsForUser = useCallback((user: AdminUserRow, overrides?: Partial<NotificationComposeDraft>) => {
    saveNotificationComposeDraft({
      title,
      body,
      type,
      buttonText,
      buttonUrl,
      targetType: "user",
      targetPlatform,
      selectedUser: user,
      sendPush,
      createInternal,
      ...overrides,
    });
    goToScreen("notifications");
  }, [body, buttonText, buttonUrl, createInternal, goToScreen, sendPush, targetPlatform, title, type]);

  const callEdge = useCallback(async (fnName: string, token: string, payload: any) => {
    const anonKey = String((supabase as any)?.supabaseKey || "");
    const base = String((supabase as any)?.supabaseUrl || "").replace(/\/$/, "");
    const url = `${base}/functions/v1/${fnName}`;
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload ?? {}),
      });
      const text = await resp.text().catch(() => "");
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      if (!resp.ok) {
        const err: any = new Error(typeof data?.message === "string" ? data.message : `HTTP ${resp.status}`);
        err.context = { fnName, status: resp.status, url };
        throw err;
      }
      return data;
    } catch (e: any) {
      if (Platform.OS === "web" && String(e?.message || "").toLowerCase().includes("failed to fetch")) {
        try {
          const probe = await fetch(url, { method: "GET" });
          const text = await probe.text().catch(() => "");
          let parsed: any = null;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            parsed = text;
          }
          const probeErr: any = new Error(parsed?.message || "Failed to fetch");
          probeErr.context = { fnName, status: probe.status, url };
          throw probeErr;
        } catch (probeError) {
          throw probeError;
        }
      }
      throw e;
    }
  }, []);

  const loadSummary = useCallback(async () => {
    if (summaryLoading) return;
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("No autenticado");

      const edgeRes: any = await callEdge("admin-dashboard-stats", token, {});
      const stats = edgeRes?.stats ?? edgeRes ?? {};

      const [historyRes, scheduleRes, autoRes] = await Promise.all([
        supabase.from("admin_notification_logs").select("id", { count: "exact", head: true }).gte("created_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
        supabase.from("notification_schedules").select("id", { count: "exact", head: true }).eq("enabled", true),
        supabase.from("notification_automation_settings").select("id", { count: "exact", head: true }).eq("enabled", true),
      ]);

      setSummary({
        registeredUsers: Number(stats.total_users ?? 0),
        activeUsers: Number(stats.active_users ?? stats.updated ?? 0),
        notificationsToday: Number(stats.notifications_sent_today ?? historyRes.count ?? 0),
        scheduledNotifications: Number(stats.scheduled_count ?? scheduleRes.count ?? 0),
        automationsActive: Number(stats.automations_active ?? autoRes.count ?? 0),
        lastActivityAt: stats.last_activity_at ?? null,
        updatedUsers: Number(stats.updated ?? 0),
        outdatedUsers: Number(stats.outdated ?? 0),
        iosUsers: Number(stats.ios ?? 0),
        androidUsers: Number(stats.android ?? 0),
      });
    } catch (e: any) {
      setSummary(null);
      setSummaryError(friendlyError(e, "No se pudo cargar el resumen."));
    } finally {
      setSummaryLoading(false);
    }
  }, [callEdge, getAccessToken, summaryLoading]);

  const loadUsers = useCallback(async ({ reset = false }: { reset?: boolean } = {}) => {
    if (usersLoading) return;
    setUsersLoading(true);
    setUsersError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("No autenticado");
      const nextOffset = reset ? 0 : usersOffset;
      const res: any = await callEdge("admin-list-users", token, {
        q: usersQ,
        filter: usersFilter,
        sort: usersSort,
        limit: 30,
        offset: nextOffset,
      });
      const list = ((res?.data?.users ?? res?.users) || []) as AdminUserRow[];
      setUsers((prev) => (reset ? list : [...prev, ...list]));
      setUsersOffset(nextOffset + list.length);
      setUsersTotalLoaded(nextOffset + list.length);
    } catch (e: any) {
      setUsersError(friendlyError(e, "No se pudieron cargar los usuarios."));
    } finally {
      setUsersLoading(false);
    }
  }, [callEdge, getAccessToken, usersFilter, usersLoading, usersOffset, usersQ, usersSort]);

  const loadSchedules = useCallback(async () => {
    if (schedulesLoading) return;
    setSchedulesLoading(true);
    setSchedulesError(null);
    try {
      const { data, error } = await supabase
        .from("notification_schedules")
        .select("*")
        .order("next_run_at", { ascending: true })
        .limit(200);
      if (error) throw error;
      setSchedules((data || []) as ScheduleRow[]);
    } catch (e: any) {
      setSchedules([]);
      setSchedulesError(friendlyError(e, "No se pudieron cargar las notificaciones programadas."));
    } finally {
      setSchedulesLoading(false);
    }
  }, [schedulesLoading]);

  const loadAutomation = useCallback(async () => {
    if (autoLoading) return;
    setAutoLoading(true);
    setAutoError(null);
    try {
      const { data, error } = await supabase
        .from("notification_automation_settings")
        .select("id,enabled,hour_utc,days_without_jornada,send_push,create_internal_notification,title,body,button_text,button_url,data")
        .in("id", ["inactivity_reminder", "payroll_estimate", "app_update"] as any)
        .limit(10);
      if (error) throw error;
      const map: Record<string, AutomationSetting> = {};
      for (const row of data || []) {
        map[row.id] = {
          id: row.id,
          enabled: row.enabled !== false,
          hour_utc: row.hour_utc ?? null,
          days_without_jornada: (row as any).days_without_jornada ?? null,
          send_push: row.send_push !== false,
          create_internal_notification: row.create_internal_notification !== false,
          title: (row as any).title ?? null,
          body: (row as any).body ?? null,
          button_text: (row as any).button_text ?? null,
          button_url: (row as any).button_url ?? null,
          data: {
            ...((((row as any).data) && typeof (row as any).data === "object") ? (row as any).data : {}),
            timezone: (((row as any).data?.timezone) || LOCAL_TIMEZONE),
          },
        };
      }
      setAuto(map);
    } catch (e: any) {
      setAuto({});
      setAutoError(friendlyError(e, "No se pudieron cargar las automatizaciones."));
    } finally {
      setAutoLoading(false);
    }
  }, [autoLoading]);

  const loadHistory = useCallback(async () => {
    if (historyLoading) return;
    setHistoryLoading(true);
    try {
      const { data, error } = await supabase
        .from("admin_notification_logs")
        .select("id,created_at,title,body,type,target_type,target_user_id,button_text,button_url,users_targeted,tokens_found,push_ok,push_failed,internal_created")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      setHistory(data || []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [historyLoading]);

  const loadUpdateConfig = useCallback(async () => {
    if (updateLoading) return;
    setUpdateLoading(true);
    try {
      const { data, error } = await supabase
        .from("app_update_config")
        .select("platform,channel,latest_version,min_required_version,minimum_version,force_update,apk_url,app_store_url,enabled,message")
        .in("platform", ["ios", "android", "web"] as any)
        .limit(20);
      if (error) throw error;
      const next = {
        ios: { ...updateConfig.ios },
        android: { ...updateConfig.android },
        web: { ...updateConfig.web },
      };
      for (const row of (data || []) as any[]) {
        const p = row.platform === "ios" || row.platform === "android" || row.platform === "web"
          ? (row.platform as "ios" | "android" | "web")
          : null;
        if (!p) continue;
        next[p] = {
          platform: p,
          channel: row.channel ?? null,
          latest_version: row.latest_version ?? null,
          min_required_version: row.min_required_version ?? null,
          minimum_version: row.minimum_version ?? null,
          force_update: row.force_update === true,
          apk_url: row.apk_url ?? null,
          app_store_url: row.app_store_url ?? null,
          enabled: row.enabled !== false,
          message: row.message ?? null,
        };
      }
      setUpdateConfig(next);
    } catch {
      setUpdateConfig((prev) => ({ ...prev }));
    } finally {
      setUpdateLoading(false);
    }
  }, [updateConfig, updateLoading]);

  const saveUpdateConfig = useCallback(async (platform: "ios" | "android" | "web") => {
    if (updateSaving) return;
    setUpdateSaving(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("No autenticado");
      const cur = updateConfig[platform];
      await callEdge("admin-update-config", token, {
        platform,
        channel: cur.channel,
        latest_version: cur.latest_version,
        min_required_version: cur.min_required_version || cur.minimum_version,
        minimum_version: cur.minimum_version,
        force_update: !!cur.force_update,
        apk_url: cur.apk_url,
        app_store_url: cur.app_store_url,
        enabled: cur.enabled !== false,
        message: cur.message,
      });
      showToast("success", `Configuración de ${platform} guardada.`);
      await loadUpdateConfig();
    } catch (e: any) {
      showToast("danger", friendlyError(e, "No se pudo guardar la actualización."));
    } finally {
      setUpdateSaving(false);
    }
  }, [callEdge, getAccessToken, loadUpdateConfig, showToast, updateConfig, updateSaving]);

  useEffect(() => {
    if (!isAdmin) return;
    if (tab === "summary") loadSummary();
    if (tab === "users" && users.length === 0) loadUsers({ reset: true });
    if (tab === "notifications") loadHistory();
    if (tab === "scheduled") loadSchedules();
    if (tab === "automations") loadAutomation();
    if (tab === "updates") loadUpdateConfig();
  }, [isAdmin, loadAutomation, loadHistory, loadSchedules, loadSummary, loadUpdateConfig, loadUsers, tab, users.length]);

  useEffect(() => {
    if (!isAdmin || tab !== "users") return;
    const timer = setTimeout(() => {
      setUsersOffset(0);
      loadUsers({ reset: true });
    }, 280);
    return () => clearTimeout(timer);
  }, [isAdmin, loadUsers, tab, usersFilter, usersQ, usersSort]);

  useEffect(() => {
    if (!detailVisible || !detailUser?.user_id || users.length === 0) return;
    const refreshed = users.find((user) => user.user_id === detailUser.user_id);
    if (refreshed) setDetailUser(refreshed);
  }, [detailUser?.user_id, detailVisible, users]);

  const onPreviewTargets = useCallback(async () => {
    if (previewLoading) return;
    const actionError = notificationActionError(buttonText, buttonUrl);
    if (actionError) {
      setPreviewError(actionError);
      return;
    }
    if (targetType === "user" && !selectedUser?.user_id) {
      setPreviewError("Selecciona un usuario antes de previsualizar.");
      openUserPicker();
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewResult(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("No autenticado");
      const res: any = await callEdge("admin-preview-notification-targets", token, {
        target_type: targetType,
        target_user_id: targetType === "user" ? selectedUser?.user_id : undefined,
        platform: targetPlatform || undefined,
        send_push: sendPush,
        create_internal_notification: createInternal,
      });
      setPreviewResult(res || null);
    } catch (e: any) {
      setPreviewError(friendlyError(e, "No se pudo calcular la vista previa."));
    } finally {
      setPreviewLoading(false);
    }
  }, [buttonText, buttonUrl, callEdge, createInternal, getAccessToken, openUserPicker, previewLoading, selectedUser?.user_id, sendPush, targetPlatform, targetType]);

  const onSend = useCallback(async () => {
    if (sending) return;
    setSendError(null);
    setSendResult(null);
    if (!title.trim()) {
      setSendError("Escribe un título para la notificación.");
      return;
    }
    if (!body.trim()) {
      setSendError("Escribe un mensaje para la notificación.");
      return;
    }
    const actionError = notificationActionError(buttonText, buttonUrl);
    if (actionError) {
      setSendError(actionError);
      return;
    }
    if (!sendPush && !createInternal) {
      setSendError("Activa push o notificación interna para poder enviar.");
      return;
    }
    if (targetType === "user" && !selectedUser?.user_id) {
      setSendError("Selecciona un usuario concreto antes de enviar.");
      openUserPicker();
      return;
    }

    setSending(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("No autenticado");
      const isUpdateOptional = type === "update_optional";
      const isUpdateRequired = type === "update_required";
      const effectiveType = isUpdateOptional || isUpdateRequired ? "update" : type;
      const extraData =
        isUpdateOptional ? { update_mode: "optional", force_update: false } :
        isUpdateRequired ? { update_mode: "required", force_update: true } :
        {};

      const res: any = await callEdge("send-admin-notification", token, {
        title: title.trim(),
        body: body.trim(),
        type: effectiveType,
        button_text: buttonText.trim() || undefined,
        button_url: buttonUrl.trim() || undefined,
        target_type: targetType,
        target_user_id: targetType === "user" ? selectedUser?.user_id : undefined,
        platform: targetPlatform || undefined,
        send_push: sendPush,
        create_internal_notification: createInternal,
        data: extraData,
      });

      setSendResult(res || null);
      showToast("success", "Notificación enviada.");
      loadHistory();
      if (tab !== "notifications") goToScreen("notifications");
    } catch (e: any) {
      const msg = friendlyError(e, "No se pudo enviar la notificación.");
      setSendError(msg);
      showToast("danger", msg);
    } finally {
      setSending(false);
    }
  }, [body, buttonText, buttonUrl, callEdge, createInternal, getAccessToken, goToScreen, loadHistory, openUserPicker, selectedUser?.user_id, sendPush, sending, showToast, tab, targetPlatform, targetType, title, type]);

  const saveAutomationSetting = useCallback(async (next: AutomationSetting) => {
    try {
      const payload: any = {
        id: next.id,
        enabled: next.enabled,
        hour_utc: next.hour_utc,
        days_without_jornada: next.days_without_jornada ?? null,
        send_push: next.send_push,
        create_internal_notification: next.create_internal_notification,
        title: next.title ?? null,
        body: next.body ?? null,
        button_text: next.button_text?.trim() || null,
        button_url: next.button_url?.trim() || null,
        data: {
          ...((next.data && typeof next.data === "object") ? next.data : {}),
          timezone: LOCAL_TIMEZONE,
          time_mode: "local",
        },
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("notification_automation_settings").upsert(payload as any, { onConflict: "id" } as any);
      if (error) throw error;
      setAuto((prev) => ({ ...prev, [next.id]: next }));
      showToast("success", "Automatización guardada.");
    } catch (e: any) {
      showToast("danger", friendlyError(e, "No se pudo guardar la automatización."));
    }
  }, [showToast]);

  const fillFromAutomation = useCallback((id: string) => {
    const cur = auto[id];
    const actionError = notificationActionError(cur?.button_text, cur?.button_url);
    if (actionError) {
      showToast("danger", actionError);
      return;
    }
    setButtonText(cur?.button_text || "");
    setButtonUrl(cur?.button_url || "");
    if (id === "inactivity_reminder") {
      setType("reminder");
      setTargetType(cur?.days_without_jornada && cur.days_without_jornada >= 7 ? "no_jornada_7_days" : "no_jornada_2_days");
      setTitle(cur?.title || "Recuerda registrar tu jornada");
      setBody(cur?.body || "Llevas varios días sin registrar jornadas.");
    } else if (id === "app_update") {
      setType("update_optional");
      setTargetType("outdated_version");
      setTitle(cur?.title || "Nueva versión disponible");
      setBody(cur?.body || "Actualiza Tacoplan para seguir usando las mejoras más recientes.");
    } else {
      setType("payroll_estimate");
      setTargetType("all");
      setTitle(cur?.title || "Estimación de nómina disponible");
      setBody(cur?.body || "Ya tienes disponible tu estimación del periodo.");
    }
    goToScreen("notifications");
    showToast("info", "Automatización copiada al envío manual para probarla.");
  }, [auto, goToScreen, showToast]);

  const runAutomationNow = useCallback((id: string) => {
    const cur = auto[id];
    const actionError = notificationActionError(cur?.button_text, cur?.button_url);
    if (actionError) {
      showToast("danger", actionError);
      return;
    }
    const labels: Record<string, string> = {
      inactivity_reminder: "Recordatorio sin jornadas",
      payroll_estimate: "Estimación de nómina",
      app_update: "Aviso de actualización",
    };
    Alert.alert(
      "Ejecutar automatización",
      `Se ejecutará ahora "${labels[id] || id}" con la configuración guardada.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Ejecutar",
          onPress: async () => {
            if (runningAutomationId) return;
            setRunningAutomationId(id);
            try {
              const token = await getAccessToken();
              if (!token) throw new Error("No autenticado");
              const res: any = await callEdge("run-notification-automations", token, {
                automation_id: id,
                force: true,
              });
              setSendResult(res || null);
              await Promise.all([loadHistory(), loadAutomation()]);
              showToast("success", "Automatización ejecutada.");
            } catch (e: any) {
              showToast("danger", friendlyError(e, "No se pudo ejecutar la automatización."));
            } finally {
              setRunningAutomationId(null);
            }
          },
        },
      ],
    );
  }, [auto, callEdge, getAccessToken, loadAutomation, loadHistory, runningAutomationId, showToast]);

  const saveSchedule = useCallback(async () => {
    if (scheduleSaving) return;
    if (!scheduleDraft.title.trim()) return showToast("danger", "Escribe un título para la programación.");
    if (!scheduleDraft.body.trim()) return showToast("danger", "Escribe un mensaje para la programación.");
    if (scheduleDraft.target_type === "user" && !scheduleDraft.target_user_id.trim()) {
      return showToast("danger", "Elige un usuario para la programación individual.");
    }
    const actionError = notificationActionError(scheduleDraft.button_text, scheduleDraft.button_url);
    if (actionError) return showToast("danger", actionError);
    if (!scheduleDraft.date || !scheduleDraft.time) return showToast("danger", "Selecciona fecha y hora.");

    const nextRunAt = localDateTimeToIso(scheduleDraft.date, scheduleDraft.time);
    if (!nextRunAt) return showToast("danger", "La fecha u hora de la programación no es válida.");

    setScheduleSaving(true);
    try {
      const payload: any = {
        title: scheduleDraft.title.trim(),
        body: scheduleDraft.body.trim(),
        type: scheduleDraft.type,
        button_text: scheduleDraft.button_text.trim() || null,
        button_url: scheduleDraft.button_url.trim() || null,
        target_type: scheduleDraft.target_type,
        target_user_id: scheduleDraft.target_type === "user" ? scheduleDraft.target_user_id.trim() : null,
        send_push: !!scheduleDraft.send_push,
        create_internal_notification: !!scheduleDraft.create_internal_notification,
        frequency: scheduleDraft.frequency,
        week_days: scheduleDraft.frequency === "weekly" ? scheduleDraft.week_days : null,
        day_of_month: scheduleDraft.frequency === "monthly" ? parseIntOrNull(scheduleDraft.day_of_month) : null,
        time_utc: scheduleDraft.frequency === "once" ? null : scheduleDraft.time,
        next_run_at: nextRunAt,
        enabled: scheduleDraft.enabled,
        data: {
          platform: scheduleDraft.platform || null,
          timezone: scheduleDraft.timezone,
          time_mode: "local",
        },
        updated_at: new Date().toISOString(),
      };

      if (scheduleDraft.id) {
        const { error } = await supabase.from("notification_schedules").update(payload as any).eq("id", scheduleDraft.id);
        if (error) throw error;
        showToast("success", "Programación actualizada.");
      } else {
        const { error } = await supabase.from("notification_schedules").insert(payload as any);
        if (error) throw error;
        showToast("success", "Programación creada.");
      }

      setScheduleDraft(makeEmptySchedule());
      loadSchedules();
    } catch (e: any) {
      showToast("danger", friendlyError(e, "No se pudo guardar la programación."));
    } finally {
      setScheduleSaving(false);
    }
  }, [loadSchedules, scheduleDraft, scheduleSaving, showToast]);

  const editSchedule = useCallback((row: ScheduleRow) => {
    setScheduleDraft({
      id: row.id,
      title: row.title,
      body: row.body,
      type: row.type,
      button_text: row.button_text || "",
      button_url: row.button_url || "",
      target_type: row.target_type,
      target_user_id: row.target_user_id || "",
      platform: row?.data?.platform === "ios" || row?.data?.platform === "android" ? row.data.platform : "",
      send_push: row.send_push,
      create_internal_notification: row.create_internal_notification,
      frequency: row.frequency,
      week_days: row.week_days || [1, 2, 3, 4, 5],
      day_of_month: row.day_of_month ? String(row.day_of_month) : "",
      date: toLocalDateInput(row.next_run_at),
      time: toLocalTimeInput(row.next_run_at),
      timezone: row?.data?.timezone || LOCAL_TIMEZONE,
      enabled: row.enabled,
    });
  }, []);

  const duplicateSchedule = useCallback((row: ScheduleRow) => {
    editSchedule(row);
    setScheduleDraft((prev) => ({ ...prev, id: null, title: `${row.title} · copia` }));
    showToast("info", "Copia cargada en el editor.");
  }, [editSchedule, showToast]);

  const toggleScheduleEnabled = useCallback(async (row: ScheduleRow) => {
    try {
      const { error } = await supabase
        .from("notification_schedules")
        .update({ enabled: !row.enabled, updated_at: new Date().toISOString() } as any)
        .eq("id", row.id);
      if (error) throw error;
      setSchedules((prev) => prev.map((item) => (item.id === row.id ? { ...item, enabled: !item.enabled } : item)));
      showToast("success", row.enabled ? "Programación pausada." : "Programación reactivada.");
    } catch (e: any) {
      showToast("danger", friendlyError(e, "No se pudo cambiar el estado."));
    }
  }, [showToast]);

  const deleteSchedule = useCallback((row: ScheduleRow) => {
    Alert.alert(
      "Eliminar programación",
      "Esta acción eliminará la programación de forma permanente.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            try {
              const { error } = await supabase.from("notification_schedules").delete().eq("id", row.id);
              if (error) throw error;
              setSchedules((prev) => prev.filter((item) => item.id !== row.id));
              showToast("success", "Programación eliminada.");
            } catch (e: any) {
              showToast("danger", friendlyError(e, "No se pudo eliminar la programación."));
            }
          },
        },
      ],
    );
  }, [showToast]);

  const runScheduleNow = useCallback(async (row: ScheduleRow) => {
    if (scheduleRunningId) return;
    setScheduleRunningId(row.id);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("No autenticado");
      const res: any = await callEdge("run-notification-schedules", token, { schedule_id: row.id });
      setSendResult(res || null);
      showToast("success", "Programación ejecutada.");
      loadHistory();
      loadSchedules();
      goToScreen("notifications");
    } catch (e: any) {
      showToast("danger", friendlyError(e, "No se pudo ejecutar la programación."));
    } finally {
      setScheduleRunningId(null);
    }
  }, [callEdge, getAccessToken, loadHistory, loadSchedules, scheduleRunningId, showToast]);

  const automationCards = useMemo(() => ([
    {
      id: "inactivity_reminder",
      title: "Recordatorio sin jornadas",
      description: "Envía recordatorios cuando un usuario lleva varios días sin registrar jornada.",
      summary: (cur: AutomationSetting | undefined) => `${cur?.days_without_jornada ?? 2} días · ${toHourLabel(cur?.hour_utc ?? 9)} local`,
    },
    {
      id: "payroll_estimate",
      title: "Estimación de nómina",
      description: "Avisa cuando la estimación del periodo ya está disponible para el usuario.",
      summary: (cur: AutomationSetting | undefined) => `${toHourLabel(cur?.hour_utc ?? 9)} local · notificación interna ${cur?.create_internal_notification === false ? "no" : "sí"}`,
    },
    {
      id: "app_update",
      title: "Aviso de actualización",
      description: "Notifica a quienes tengan una versión antigua de la app.",
      summary: (cur: AutomationSetting | undefined) => `${toHourLabel(cur?.hour_utc ?? 9)} local · push ${cur?.send_push === false ? "no" : "sí"}`,
    },
  ]), []);

  const summaryContent = (
    <>
      <View style={styles.metricGrid}>
        {summaryLoading
          ? Array.from({ length: metricsPerRow }).map((_, index) => <SkeletonBlock key={index} height={132} style={{ flex: 1, minWidth: 180 }} />)
          : summary
            ? (
              <>
                <MetricCard icon={Users} label="Usuarios registrados" value={summary.registeredUsers} hint={`${summary.updatedUsers} actualizados`} style={isCompact && styles.fullWidthMetric} />
                <MetricCard icon={Sparkles} label="Usuarios activos" value={summary.activeUsers} hint={`${summary.outdatedUsers} con versión antigua`} style={isCompact && styles.fullWidthMetric} />
                <MetricCard icon={Bell} label="Notificaciones enviadas hoy" value={summary.notificationsToday} hint="Incluye push e internas" style={isCompact && styles.fullWidthMetric} />
                <MetricCard icon={CalendarClock} label="Programadas" value={summary.scheduledNotifications} hint="Pendientes de ejecución" style={isCompact && styles.fullWidthMetric} />
                <MetricCard icon={Bot} label="Automáticas activas" value={summary.automationsActive} hint="Reglas encendidas" style={isCompact && styles.fullWidthMetric} />
                <MetricCard icon={Clock3} label="Última actividad" value={summary.lastActivityAt ? formatIsoToLocal(summary.lastActivityAt) : "Sin dato"} hint={`${summary.iosUsers} iOS · ${summary.androidUsers} Android`} style={isCompact && styles.fullWidthMetric} />
              </>
            )
            : null}
      </View>

      {summaryError ? (
        <SurfaceCard style={styles.compactWarningCard}>
          <View style={styles.compactWarningHeader}>
            <CircleAlert size={18} color="#B45309" />
            <Text style={styles.compactWarningTitle}>No se pudo cargar el resumen.</Text>
          </View>
          <InlineButton label="Reintentar" onPress={loadSummary} icon={RefreshCw} tone="secondary" />
        </SurfaceCard>
      ) : null}

      {!isCompact ? (
        <SurfaceCard title="Acciones rápidas">
          <View style={styles.quickActionsGrid}>
            <ActionTile
              label="Enviar notificación"
              description="Lanza un envío manual con vista previa."
              onPress={() => goToScreen("notifications")}
              icon={SendHorizontal}
              style={styles.quickActionItem}
            />
            <ActionTile
              label="Ver usuarios"
              description="Busca, filtra y actúa por usuario."
              onPress={() => goToScreen("users")}
              icon={Users}
              style={styles.quickActionItem}
            />
            <ActionTile
              label="Programar envío"
              description="Crea una notificación con fecha y hora."
              onPress={() => goToScreen("scheduled")}
              icon={CalendarClock}
              style={styles.quickActionItem}
            />
            <ActionTile
              label="Crear automatización"
              description="Ajusta reglas automáticas y pruébalas."
              onPress={() => goToScreen("automations")}
              icon={Bot}
              style={styles.quickActionItem}
            />
          </View>
        </SurfaceCard>
      ) : null}
    </>
  );

  const usersContent = (
    <>
      {isCompact ? (
        <View style={styles.mobileUsersHeader}>
          <SearchField value={usersQ} onChangeText={setUsersQ} placeholder="Buscar por email, nombre o user_id" />
          <View style={styles.mobileUsersActions}>
            <InlineButton label="Filtrar" onPress={() => setUsersFilterSheetVisible(true)} icon={Settings} tone="secondary" />
            <Pressable
              onPress={() => loadUsers({ reset: true })}
              disabled={usersLoading && users.length === 0}
              style={({ pressed }) => [
                styles.compactIconButton,
                (usersLoading && users.length === 0) && styles.compactIconButtonDisabled,
                pressed && { opacity: 0.9 },
              ]}
            >
              <RefreshCw size={18} color="#2563EB" />
            </Pressable>
          </View>
          {usersFilter !== "all" ? (
            <Text style={styles.mobileFilterSummary}>
              Filtro: {USER_FILTER_OPTIONS.find((item) => item.key === usersFilter)?.label ?? "Todos"}
            </Text>
          ) : null}
        </View>
      ) : (
        <SurfaceCard
          title="Usuarios"
          description={isCompact ? undefined : "Busca, filtra y actúa sobre usuarios concretos sin salir del panel."}
          right={<InlineButton label="Recargar" onPress={() => loadUsers({ reset: true })} icon={RefreshCw} tone="secondary" loading={usersLoading && users.length === 0} />}
        >
          <View style={{ gap: 16 }}>
            <SearchField value={usersQ} onChangeText={setUsersQ} placeholder="Buscar por email, nombre o user_id" />

            <View style={styles.inlineGroup}>
              {USER_FILTER_OPTIONS.map((item) => (
                <FilterPill key={item.key} label={item.label} active={usersFilter === item.key} onPress={() => setUsersFilter(item.key)} />
              ))}
            </View>

            <View style={styles.inlineGroup}>
              {USER_SORT_OPTIONS.map((item) => (
                <FilterPill key={item.key} label={item.label} active={usersSort === item.key} onPress={() => setUsersSort(item.key)} />
              ))}
            </View>

            <Text style={styles.helperText}>Cargados: {usersTotalLoaded}</Text>
          </View>
        </SurfaceCard>
      )}

      {usersError ? <EmptyCard title="No se pudieron cargar los usuarios" body={usersError} action={<InlineButton label="Reintentar" onPress={() => loadUsers({ reset: true })} icon={RefreshCw} tone="secondary" />} /> : null}

      {!usersLoading && users.length === 0 && !usersError ? (
        <EmptyCard title="No hay usuarios" body={isCompact ? "Prueba otro filtro." : "Prueba con otro filtro, cambia el texto de búsqueda o recarga la lista."} />
      ) : null}

      <View style={styles.listGrid}>
        {usersLoading && users.length === 0
          ? Array.from({ length: isWide ? 4 : 3 }).map((_, index) => <SkeletonBlock key={index} height={160} style={{ flex: 1, minWidth: isWide ? 320 : 220 }} />)
          : users.map((user) => {
            const updateState = updateBadge(user);
            return (
              <SurfaceCard key={user.user_id} style={[styles.userCard, isCompact && styles.fullWidthItem]}>
                <View style={styles.userCardHeader}>
                  <View style={{ flex: 1, gap: 6 }}>
                    <Text style={styles.userName}>{user.display_name || user.email || "Usuario sin nombre"}</Text>
                    <Text style={styles.userMeta}>{user.email || user.user_id}</Text>
                  </View>
                  <Badge label={updateState.label} tone={updateState.tone} />
                </View>

                <View style={styles.userFactGrid}>
                  <InfoLine label="Plataforma" value={user.platform || "Sin dato"} icon={user.platform === "ios" ? Apple : Smartphone} />
                  <InfoLine label="Versión" value={user.app_version || "Sin dato"} icon={ArrowDownToLine} />
                  <InfoLine label="Última conexión" value={user.last_seen_at ? formatIsoToLocal(user.last_seen_at) : "Sin dato"} icon={Clock3} />
                  <InfoLine label="Jornada" value={formatRelativeDays(user.days_since_last_jornada)} icon={CalendarClock} />
                </View>

                <View style={styles.badgesRow}>
                  <Badge label={user.notifications_enabled === false ? "Notificaciones desactivadas" : "Notificaciones activadas"} tone={user.notifications_enabled === false ? "warning" : "success"} />
                  <Badge label={user.has_push_token ? "Con push token" : "Sin push token"} tone={user.has_push_token ? "info" : "default"} />
                </View>

                <View style={styles.rowButtons}>
                  <InlineButton
                    label="Enviar notificación"
                    onPress={() => {
                      openNotificationsForUser(user);
                    }}
                    icon={MessageSquareShare}
                    tone="primary"
                    style={{ flex: 1 }}
                  />
                  <InlineButton
                    label="Ver detalle"
                    onPress={() => {
                      setDetailUser(user);
                      setDetailVisible(true);
                    }}
                    icon={UserRound}
                    tone="secondary"
                    style={{ flex: 1 }}
                  />
                </View>
              </SurfaceCard>
            );
          })}
      </View>

      {users.length > 0 ? <InlineButton label={usersLoading ? "Cargando..." : "Cargar más"} onPress={() => loadUsers()} icon={RefreshCw} tone="secondary" loading={usersLoading && users.length > 0} /> : null}
    </>
  );

  const notificationsContent = (
    <>
      <View style={[styles.twoCol, { alignItems: "flex-start" }]}>
        <SurfaceCard
          title="Notificaciones manuales"
          description={isCompact ? undefined : "Diseñado para enviar mensajes rápidos con filtros reales en backend."}
          style={{ flex: 1, minWidth: isWide ? 460 : 0 }}
        >
          <View style={{ gap: 16 }}>
            <Field label="Título">
              <Input value={title} onChangeText={setTitle} placeholder="Ej. Actualización disponible" />
            </Field>

            <Field label={`Mensaje · ${body.length} caracteres`}>
              <Input value={body} onChangeText={setBody} placeholder="Escribe el mensaje que verá el usuario." multiline />
            </Field>

            <View style={styles.inlineInputs}>
              <View style={{ flex: 1 }}>
                <Field label="Nombre del botón">
                  <Input value={buttonText} onChangeText={setButtonText} placeholder="Ej. Abrir ahora" />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Enlace (URL)">
                  <Input value={buttonUrl} onChangeText={setButtonUrl} placeholder="https://..." autoCapitalize="none" />
                </Field>
              </View>
            </View>

            {notificationActionError(buttonText, buttonUrl) ? (
              <View style={styles.inlineError}>
                <CircleAlert size={16} color="#B91C1C" />
                <Text style={styles.inlineErrorText}>{notificationActionError(buttonText, buttonUrl)}</Text>
              </View>
            ) : null}

            <Field label="Tipo">
              <View style={styles.inlineGroup}>
                {NOTIFICATION_TYPE_OPTIONS.map((opt) => (
                  <FilterPill key={opt} label={TYPE_LABELS[opt] ?? opt} active={type === opt} onPress={() => setType(opt)} />
                ))}
              </View>
            </Field>

            <Field label="Destinatarios">
              <View style={styles.inlineGroup}>
                {TARGET_OPTIONS.map((opt) => (
                  <FilterPill key={opt.key} label={opt.label} active={targetType === opt.key} onPress={() => setTargetType(opt.key)} />
                ))}
              </View>
            </Field>

            {(targetType === "outdated_version" || targetType === "updated_version") ? (
              <Field label="Plataforma">
                <View style={styles.inlineGroup}>
                  <FilterPill label="Todas" active={targetPlatform === ""} onPress={() => setTargetPlatform("")} />
                  <FilterPill label="iOS" active={targetPlatform === "ios"} onPress={() => setTargetPlatform("ios")} />
                  <FilterPill label="Android" active={targetPlatform === "android"} onPress={() => setTargetPlatform("android")} />
                </View>
              </Field>
            ) : null}

            {targetType === "user" ? (
              <SurfaceCard style={styles.softCard}>
                <Text style={styles.selectionTitle}>Usuario seleccionado</Text>
                <Text style={styles.selectionValue}>{selectedUser?.email || selectedUser?.display_name || "Todavía no has elegido un usuario."}</Text>
                <InlineButton label={selectedUser ? "Cambiar usuario" : "Elegir usuario"} onPress={openUserPicker} icon={Users} tone="secondary" />
              </SurfaceCard>
            ) : null}

            <ToggleRow label="Enviar push" value={sendPush} onPress={() => setSendPush((v) => !v)} helper="Usa Expo Push API para los tokens disponibles." />
            <ToggleRow label="Crear notificación interna" value={createInternal} onPress={() => setCreateInternal((v) => !v)} helper="La notificación queda dentro de Tacoplan aunque no haya push." />

            {sendError ? (
              <View style={styles.inlineError}>
                <CircleAlert size={16} color="#B91C1C" />
                <Text style={styles.inlineErrorText}>{sendError}</Text>
              </View>
            ) : null}

            <View style={styles.rowButtons}>
              <InlineButton label="Previsualizar destinatarios" onPress={onPreviewTargets} icon={Search} tone="secondary" loading={previewLoading} style={{ flex: 1 }} />
              <InlineButton label="Enviar notificación" onPress={onSend} icon={SendHorizontal} tone="primary" loading={sending} style={{ flex: 1 }} />
            </View>
          </View>
        </SurfaceCard>

        <View style={{ flex: 1, minWidth: isWide ? 360 : 0, gap: 16 }}>
          <SurfaceCard title="Vista previa" description={isCompact ? undefined : "El panel calcula objetivos y tokens antes de enviar."}>
            {previewError ? (
              <Text style={styles.helperError}>{previewError}</Text>
            ) : previewResult ? (
              <View style={{ gap: 12 }}>
                <PreviewLine label="Destinatario seleccionado" value={targetLabel(targetType)} />
                <PreviewLine label="Usuarios estimados" value={String(previewResult.targetUsers ?? 0)} />
                <PreviewLine label="Tokens push estimados" value={String(previewResult.tokens ?? 0)} />
                <PreviewLine label="Internas estimadas" value={String(previewResult.internalNotificationsCreated ?? 0)} />
                <PreviewLine label="Botón" value={buttonUrl.trim() ? (buttonText.trim() || "Configurado") : "Sin botón"} />
                <View style={styles.badgesRow}>
                  <Badge label={`iOS ${previewResult.push_tokens_by_platform?.ios ?? 0}`} tone="info" />
                  <Badge label={`Android ${previewResult.push_tokens_by_platform?.android ?? 0}`} tone="info" />
                </View>
              </View>
            ) : (
              <Text style={styles.helperText}>{isCompact ? "Pulsa previsualizar para calcular los destinatarios." : "Pulsa “Previsualizar destinatarios” para ver cuántos usuarios y tokens recibirán el mensaje."}</Text>
            )}
          </SurfaceCard>

          <SurfaceCard title="Último envío" description={isCompact ? undefined : "Confirmación visual sin exponer JSON técnico."}>
            {sendResult ? (
              <View style={{ gap: 12 }}>
                <PreviewLine label="Usuarios objetivo" value={String(sendResult.users_found ?? sendResult.targetUsers ?? 0)} />
                <PreviewLine label="Tokens encontrados" value={String(sendResult.tokens_found ?? sendResult.tokens ?? 0)} />
                <PreviewLine label="Push enviados" value={String(sendResult.push_ok ?? sendResult.messagesOk ?? 0)} />
                <PreviewLine label="Push fallidos" value={String(sendResult.push_failed ?? sendResult.messagesFailed ?? 0)} />
                <PreviewLine label="Internas creadas" value={String(sendResult.internal_created ?? sendResult.internalNotificationsCreated ?? 0)} />
                <PreviewLine label="Botón" value={buttonUrl.trim() ? (buttonText.trim() || "Configurado") : "Sin botón"} />
              </View>
            ) : (
              <Text style={styles.helperText}>{isCompact ? "Aquí verás el último resultado." : "Cuando envíes una notificación, aquí verás el resultado resumido."}</Text>
            )}
          </SurfaceCard>
        </View>
      </View>

      <SurfaceCard
        title="Historial reciente"
        description={isCompact ? undefined : "Últimos envíos manuales o programados."}
        right={<InlineButton label="Actualizar" onPress={loadHistory} icon={RefreshCw} tone="secondary" loading={historyLoading} />}
      >
        {historyLoading && history.length === 0 ? (
          <View style={{ gap: 12 }}>
            <SkeletonBlock height={74} />
            <SkeletonBlock height={74} />
            <SkeletonBlock height={74} />
          </View>
        ) : history.length === 0 ? (
          <Text style={styles.helperText}>{isCompact ? "Sin envíos todavía." : "Todavía no hay envíos registrados."}</Text>
        ) : (
          <View style={{ gap: 12 }}>
            {history.map((item) => (
              <View key={item.id} style={styles.historyRow}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.historyTitle}>{item.title || "Notificación sin título"}</Text>
                  <Text style={styles.historyBody} numberOfLines={2}>{item.body || "Sin mensaje"}</Text>
                  <Text style={styles.helperText}>{formatIsoToLocal(item.created_at)} · {targetLabel(item.target_type)} · {TYPE_LABELS[item.type] ?? item.type}</Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 6 }}>
                  {item.button_url ? <Badge label={item.button_text || "Con botón"} tone="info" /> : null}
                  <Badge label={`OK ${item.push_ok ?? 0}`} tone="success" />
                  <Badge label={`Fail ${item.push_failed ?? 0}`} tone="danger" />
                </View>
              </View>
            ))}
          </View>
        )}
      </SurfaceCard>
    </>
  );

  const scheduledContent = (
    <>
      <View style={styles.twoCol}>
        <SurfaceCard
          title={scheduleDraft.id ? "Editar programación" : "Crear programación"}
          description={isCompact ? undefined : "Con fecha, hora y destinatario real aplicado en backend."}
          style={{ flex: 1, minWidth: isWide ? 420 : 0 }}
        >
          <View style={{ gap: 16 }}>
            <Field label="Título">
              <Input value={scheduleDraft.title} onChangeText={(value) => setScheduleDraft((prev) => ({ ...prev, title: value }))} placeholder="Ej. Recordatorio de jornada" />
            </Field>

            <Field label="Mensaje">
              <Input value={scheduleDraft.body} onChangeText={(value) => setScheduleDraft((prev) => ({ ...prev, body: value }))} placeholder="Mensaje para el envío programado." multiline />
            </Field>

            <View style={styles.inlineInputs}>
              <View style={{ flex: 1 }}>
                <Field label="Nombre del botón">
                  <Input value={scheduleDraft.button_text} onChangeText={(value) => setScheduleDraft((prev) => ({ ...prev, button_text: value }))} placeholder="Ej. Abrir ahora" />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Enlace (URL)">
                  <Input value={scheduleDraft.button_url} onChangeText={(value) => setScheduleDraft((prev) => ({ ...prev, button_url: value }))} placeholder="https://..." autoCapitalize="none" />
                </Field>
              </View>
            </View>

            {notificationActionError(scheduleDraft.button_text, scheduleDraft.button_url) ? (
              <View style={styles.inlineError}>
                <CircleAlert size={16} color="#B91C1C" />
                <Text style={styles.inlineErrorText}>{notificationActionError(scheduleDraft.button_text, scheduleDraft.button_url)}</Text>
              </View>
            ) : null}

            <Field label="Tipo">
              <View style={styles.inlineGroup}>
                {NOTIFICATION_TYPE_OPTIONS.map((opt) => (
                  <FilterPill key={opt} label={TYPE_LABELS[opt] ?? opt} active={scheduleDraft.type === opt} onPress={() => setScheduleDraft((prev) => ({ ...prev, type: opt }))} />
                ))}
              </View>
            </Field>

            <Field label="Destinatarios">
              <View style={styles.inlineGroup}>
                {TARGET_OPTIONS.map((opt) => (
                  <FilterPill key={opt.key} label={opt.label} active={scheduleDraft.target_type === opt.key} onPress={() => setScheduleDraft((prev) => ({ ...prev, target_type: opt.key }))} />
                ))}
              </View>
            </Field>

            {scheduleDraft.target_type === "user" ? (
              <Field label="user_id">
                <Input value={scheduleDraft.target_user_id} onChangeText={(value) => setScheduleDraft((prev) => ({ ...prev, target_user_id: value }))} placeholder="UUID del usuario" autoCapitalize="none" />
              </Field>
            ) : null}

            {(scheduleDraft.target_type === "outdated_version" || scheduleDraft.target_type === "updated_version") ? (
              <Field label="Plataforma">
                <View style={styles.inlineGroup}>
                  <FilterPill label="Todas" active={scheduleDraft.platform === ""} onPress={() => setScheduleDraft((prev) => ({ ...prev, platform: "" }))} />
                  <FilterPill label="iOS" active={scheduleDraft.platform === "ios"} onPress={() => setScheduleDraft((prev) => ({ ...prev, platform: "ios" }))} />
                  <FilterPill label="Android" active={scheduleDraft.platform === "android"} onPress={() => setScheduleDraft((prev) => ({ ...prev, platform: "android" }))} />
                </View>
              </Field>
            ) : null}

            <Field label="Frecuencia">
              <View style={styles.inlineGroup}>
                {(["once", "daily", "weekly", "monthly"] as const).map((item) => (
                  <FilterPill key={item} label={item === "once" ? "Una vez" : item === "daily" ? "Diaria" : item === "weekly" ? "Semanal" : "Mensual"} active={scheduleDraft.frequency === item} onPress={() => setScheduleDraft((prev) => ({ ...prev, frequency: item }))} />
                ))}
              </View>
            </Field>

            <View style={styles.inlineInputs}>
              <View style={{ flex: 1 }}>
                <Field label="Fecha">
                  <Input value={scheduleDraft.date} onChangeText={(value) => setScheduleDraft((prev) => ({ ...prev, date: value }))} placeholder="2026-05-25" autoCapitalize="none" />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Hora">
                  <Input value={scheduleDraft.time} onChangeText={(value) => setScheduleDraft((prev) => ({ ...prev, time: value }))} placeholder="09:00" autoCapitalize="none" />
                </Field>
              </View>
            </View>

            <Field label="Zona horaria local">
              <View style={styles.readonlyField}>
                <Text style={styles.readonlyValue}>{scheduleDraft.timezone || LOCAL_TIMEZONE}</Text>
              </View>
            </Field>

            {scheduleDraft.frequency === "weekly" ? (
              <Field label="Días de la semana">
                <WeekdaySelector
                  value={scheduleDraft.week_days}
                  onToggle={(day) => setScheduleDraft((prev) => ({
                    ...prev,
                    week_days: prev.week_days.includes(day) ? prev.week_days.filter((item) => item !== day) : [...prev.week_days, day].sort((a, b) => a - b),
                  }))}
                />
              </Field>
            ) : null}

            {scheduleDraft.frequency === "monthly" ? (
              <Field label="Día del mes">
                <Input value={scheduleDraft.day_of_month} onChangeText={(value) => setScheduleDraft((prev) => ({ ...prev, day_of_month: value }))} placeholder="1-31" keyboardType="numeric" />
              </Field>
            ) : null}

            <ToggleRow label="Enviar push" value={scheduleDraft.send_push} onPress={() => setScheduleDraft((prev) => ({ ...prev, send_push: !prev.send_push }))} />
            <ToggleRow label="Crear notificación interna" value={scheduleDraft.create_internal_notification} onPress={() => setScheduleDraft((prev) => ({ ...prev, create_internal_notification: !prev.create_internal_notification }))} />
            <ToggleRow label="Activa" value={scheduleDraft.enabled} onPress={() => setScheduleDraft((prev) => ({ ...prev, enabled: !prev.enabled }))} />

            <View style={styles.rowButtons}>
              <InlineButton label={scheduleDraft.id ? "Guardar cambios" : "Crear programación"} onPress={saveSchedule} icon={CalendarClock} tone="primary" loading={scheduleSaving} style={{ flex: 1 }} />
              <InlineButton label="Limpiar" onPress={() => setScheduleDraft(makeEmptySchedule())} icon={X} tone="secondary" style={{ flex: 1 }} />
            </View>
          </View>
        </SurfaceCard>

        <SurfaceCard
          title="Resumen de la programación"
          description={isCompact ? undefined : "Vista rápida para revisar el envío antes de guardarlo."}
          style={{ flex: 1, minWidth: isWide ? 340 : 0 }}
        >
          <View style={{ gap: 12 }}>
            <PreviewLine label="Estado" value={scheduleDraft.enabled ? "Activa" : "Pausada"} />
            <PreviewLine label="Frecuencia" value={scheduleDraft.frequency} />
            <PreviewLine label="Próxima ejecución" value={localDateTimeToIso(scheduleDraft.date, scheduleDraft.time) ? formatIsoToLocal(localDateTimeToIso(scheduleDraft.date, scheduleDraft.time)) : "Sin definir"} />
            <PreviewLine label="Destinatario" value={targetLabel(scheduleDraft.target_type)} />
            <PreviewLine label="Zona horaria local" value={scheduleDraft.timezone} />
            <PreviewLine label="Botón" value={scheduleDraft.button_url.trim() ? (scheduleDraft.button_text.trim() || "Configurado") : "Sin botón"} />
            <View style={styles.badgesRow}>
              <Badge label={scheduleDraft.send_push ? "Push sí" : "Push no"} tone={scheduleDraft.send_push ? "success" : "warning"} />
              <Badge label={scheduleDraft.create_internal_notification ? "Interna sí" : "Interna no"} tone={scheduleDraft.create_internal_notification ? "info" : "default"} />
            </View>
          </View>
        </SurfaceCard>
      </View>

      <SurfaceCard
        title="Programadas"
        description={isCompact ? undefined : "Editar, duplicar, pausar o ejecutar una programación existente."}
        right={<InlineButton label="Actualizar" onPress={loadSchedules} icon={RefreshCw} tone="secondary" loading={schedulesLoading} />}
      >
        {schedulesError ? (
          <Text style={styles.helperError}>{schedulesError}</Text>
        ) : schedulesLoading && schedules.length === 0 ? (
          <View style={{ gap: 12 }}>
            <SkeletonBlock height={84} />
            <SkeletonBlock height={84} />
          </View>
        ) : schedules.length === 0 ? (
          <Text style={styles.helperText}>{isCompact ? "Sin programaciones." : "Todavía no hay notificaciones programadas."}</Text>
        ) : (
          <View style={{ gap: 14 }}>
            {schedules.map((row) => {
              const status = scheduleStatus(row);
              return (
                <View key={row.id} style={styles.scheduleRow}>
                  <View style={{ flex: 1, gap: 6 }}>
                    <View style={styles.userCardHeader}>
                      <Text style={styles.historyTitle}>{row.title}</Text>
                      <Badge label={status.label} tone={status.tone} />
                    </View>
                    <Text style={styles.historyBody} numberOfLines={2}>{row.body}</Text>
                    <Text style={styles.helperText}>Próxima ejecución: {formatIsoToLocal(row.next_run_at)}</Text>
                    <View style={styles.badgesRow}>
                      <Badge label={targetLabel(row.target_type)} tone="info" />
                      <Badge label={row.frequency === "once" ? "Una vez" : row.frequency} tone="default" />
                      {row.button_url ? <Badge label={row.button_text || "Con botón"} tone="info" /> : null}
                    </View>
                  </View>
                  <View style={styles.actionWrap}>
                    <InlineButton label="Editar" onPress={() => editSchedule(row)} icon={PencilLine} tone="secondary" />
                    <InlineButton label="Duplicar" onPress={() => duplicateSchedule(row)} icon={Copy} tone="secondary" />
                    <InlineButton label={row.enabled ? "Pausar" : "Activar"} onPress={() => toggleScheduleEnabled(row)} icon={row.enabled ? Pause : Check} tone="ghost" />
                    <InlineButton label="Ejecutar" onPress={() => runScheduleNow(row)} icon={SendHorizontal} tone="primary" loading={scheduleRunningId === row.id} />
                    <InlineButton label="Eliminar" onPress={() => deleteSchedule(row)} icon={Trash2} tone="danger" />
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </SurfaceCard>
    </>
  );

  const automationsContent = (
    <>
      {autoError ? <EmptyCard title="No se pudieron cargar las automatizaciones" body={autoError} action={<InlineButton label="Reintentar" onPress={loadAutomation} icon={RefreshCw} tone="secondary" />} /> : null}
      <View style={styles.listGrid}>
        {autoLoading && Object.keys(auto).length === 0
          ? Array.from({ length: 3 }).map((_, index) => <SkeletonBlock key={index} height={260} style={{ flex: 1, minWidth: 300 }} />)
          : automationCards.map((card) => {
            const cur = auto[card.id] || {
              id: card.id,
              enabled: true,
              hour_utc: 9,
              days_without_jornada: card.id === "inactivity_reminder" ? 2 : null,
              send_push: true,
              create_internal_notification: card.id !== "inactivity_reminder",
              title: "",
              body: "",
              button_text: "",
              button_url: "",
              data: null,
            };
            return (
              <SurfaceCard key={card.id} title={card.title} description={isCompact ? undefined : card.description} style={[styles.flexCard, isCompact && styles.fullWidthItem]}>
                <View style={{ gap: 14 }}>
                  <View style={styles.userCardHeader}>
                    <Badge label={cur.enabled ? "Activa" : "Inactiva"} tone={cur.enabled ? "success" : "warning"} />
                    <Text style={styles.helperText}>{card.summary(cur)}</Text>
                  </View>

                  <ToggleRow label="Automatización activa" value={cur.enabled} onPress={() => saveAutomationSetting({ ...cur, enabled: !cur.enabled })} />

                  <View style={styles.inlineInputs}>
                    <View style={{ flex: 1 }}>
                      <Field label="Hora local">
                        <Input
                          value={cur.hour_utc == null ? "" : String(cur.hour_utc)}
                          onChangeText={(value) => saveAutomationSetting({ ...cur, hour_utc: parseIntOrNull(value) })}
                          keyboardType="numeric"
                          placeholder="9"
                        />
                      </Field>
                    </View>
                    {card.id === "inactivity_reminder" ? (
                      <View style={{ flex: 1 }}>
                        <Field label="Días sin jornada">
                          <Input
                            value={cur.days_without_jornada == null ? "" : String(cur.days_without_jornada)}
                            onChangeText={(value) => saveAutomationSetting({ ...cur, days_without_jornada: parseIntOrNull(value) ?? 2 })}
                            keyboardType="numeric"
                            placeholder="2"
                          />
                        </Field>
                      </View>
                    ) : null}
                  </View>

                  <ToggleRow label="Enviar push" value={cur.send_push} onPress={() => saveAutomationSetting({ ...cur, send_push: !cur.send_push })} />
                  <ToggleRow label="Crear notificación interna" value={cur.create_internal_notification} onPress={() => saveAutomationSetting({ ...cur, create_internal_notification: !cur.create_internal_notification })} />
                  <Text style={styles.helperText}>Zona horaria local: {LOCAL_TIMEZONE}</Text>

                  <Field label="Título">
                    <Input value={cur.title || ""} onChangeText={(value) => saveAutomationSetting({ ...cur, title: value })} placeholder="Usar el título por defecto" />
                  </Field>

                  <Field label="Mensaje">
                    <Input value={cur.body || ""} onChangeText={(value) => saveAutomationSetting({ ...cur, body: value })} placeholder="Usar el mensaje por defecto" multiline />
                  </Field>

                  <View style={styles.inlineInputs}>
                    <View style={{ flex: 1 }}>
                      <Field label="Nombre del botón">
                        <Input value={cur.button_text || ""} onChangeText={(value) => saveAutomationSetting({ ...cur, button_text: value })} placeholder="Ej. Abrir ahora" />
                      </Field>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field label="Enlace (URL)">
                        <Input value={cur.button_url || ""} onChangeText={(value) => saveAutomationSetting({ ...cur, button_url: value })} placeholder="https://..." autoCapitalize="none" />
                      </Field>
                    </View>
                  </View>

                  {notificationActionError(cur.button_text, cur.button_url) ? (
                    <View style={styles.inlineError}>
                      <CircleAlert size={16} color="#B91C1C" />
                      <Text style={styles.inlineErrorText}>{notificationActionError(cur.button_text, cur.button_url)}</Text>
                    </View>
                  ) : null}

                  <View style={styles.rowButtons}>
                    <InlineButton label={cur.enabled ? "Desactivar" : "Activar"} onPress={() => saveAutomationSetting({ ...cur, enabled: !cur.enabled })} icon={cur.enabled ? BellOff : Bell} tone="ghost" style={{ flex: 1 }} />
                    <InlineButton label="Editar" onPress={() => fillFromAutomation(card.id)} icon={Search} tone="secondary" style={{ flex: 1 }} />
                  </View>

                  <View style={styles.rowButtons}>
                    <InlineButton
                      label="Ejecutar ahora"
                      onPress={() => runAutomationNow(card.id)}
                      icon={SendHorizontal}
                      tone="primary"
                      loading={runningAutomationId === card.id}
                      style={{ flex: 1 }}
                    />
                  </View>
                </View>
              </SurfaceCard>
            );
          })}
      </View>
    </>
  );

  const updatesContent = (
    <>
      <SurfaceCard
        title="Actualizaciones"
        description={isCompact ? undefined : "Publica avisos por plataforma y reutiliza el mensaje desde el panel."}
        right={<InlineButton label="Recargar" onPress={loadUpdateConfig} icon={RefreshCw} tone="secondary" loading={updateLoading} />}
      >
        {!isCompact ? <Text style={styles.helperText}>La app solo lee configuración pública. La edición se hace desde la Edge Function con sesión de admin.</Text> : null}
      </SurfaceCard>

      <View style={styles.listGrid}>
        {(["ios", "android", "web"] as const).map((platform) => {
          const cur = updateConfig[platform];
          return (
            <SurfaceCard key={platform} title={platform === "ios" ? "iOS" : platform === "android" ? "Android" : "Web"} description={isCompact ? undefined : "Configuración de versión, obligatoriedad y enlace de actualización."} style={[styles.flexCard, isCompact && styles.fullWidthItem]}>
              <View style={{ gap: 14 }}>
                <ToggleRow label="Aviso activo" value={cur.enabled !== false} onPress={() => setUpdateConfig((prev) => ({ ...prev, [platform]: { ...prev[platform], enabled: prev[platform].enabled === false } }))} />

                <Field label="Versión objetivo">
                  <Input value={cur.latest_version || ""} onChangeText={(value) => setUpdateConfig((prev) => ({ ...prev, [platform]: { ...prev[platform], latest_version: value } }))} placeholder="2.2.5" autoCapitalize="none" />
                </Field>

                <Field label="Versión mínima">
                  <Input value={cur.min_required_version || cur.minimum_version || ""} onChangeText={(value) => setUpdateConfig((prev) => ({ ...prev, [platform]: { ...prev[platform], min_required_version: value, minimum_version: value } }))} placeholder="2.2.4" autoCapitalize="none" />
                </Field>

                <ToggleRow label="Actualización obligatoria" value={!!cur.force_update} onPress={() => setUpdateConfig((prev) => ({ ...prev, [platform]: { ...prev[platform], force_update: !prev[platform].force_update } }))} helper="Si está activa, el modal no ofrece cancelar." />

                <Field label="Enlace de actualización">
                  <Input
                    value={(platform === "android" ? cur.apk_url : cur.app_store_url) || ""}
                    onChangeText={(value) => setUpdateConfig((prev) => ({ ...prev, [platform]: { ...prev[platform], ...(platform === "android" ? { apk_url: value } : { app_store_url: value }) } }))}
                    placeholder="https://..."
                    autoCapitalize="none"
                  />
                </Field>

                <Field label="Notas de cambios">
                  <Input value={cur.message || ""} onChangeText={(value) => setUpdateConfig((prev) => ({ ...prev, [platform]: { ...prev[platform], message: value } }))} placeholder="Resumen visible para el usuario." multiline />
                </Field>

                <View style={styles.rowButtons}>
                  <InlineButton label="Publicar actualización" onPress={() => saveUpdateConfig(platform)} icon={ArrowUpCircle} tone="primary" loading={updateSaving} style={{ flex: 1 }} />
                  <InlineButton
                    label="Avisar a versión antigua"
                    onPress={() => {
                      setType(cur.force_update ? "update_required" : "update_optional");
                      setButtonText("Actualizar");
                      setButtonUrl((platform === "android" ? cur.apk_url : cur.app_store_url) || "");
                      setTargetType("outdated_version");
                      setTargetPlatform(platform === "web" ? "" : platform);
                      setTitle("Actualización disponible");
                      setBody(cur.message || "Hay una nueva versión disponible. Actualiza Tacoplan para seguir al día.");
                      goToScreen("notifications");
                    }}
                    icon={MessageSquareShare}
                    tone="secondary"
                    style={{ flex: 1 }}
                  />
                </View>
              </View>
            </SurfaceCard>
          );
        })}
      </View>
    </>
  );

  const settingsContent = (
    <View style={styles.twoCol}>
      <SurfaceCard title="Estado del panel" description={isCompact ? undefined : "Indicadores rápidos de acceso y conectividad."}>
        <View style={{ gap: 12 }}>
          <PreviewLine label="Permisos admin" value={isAdmin ? "Correctos" : "Sin permisos"} />
          <PreviewLine label="Base Edge Functions" value={functionsBaseUrl || "Sin configurar"} />
          <PreviewLine label="Resumen" value={summaryError ? "Con incidencia" : "Disponible"} />
          <PreviewLine label="Programadas" value={schedulesError ? "Con incidencia" : "Disponible"} />
          <PreviewLine label="Automáticas" value={autoError ? "Con incidencia" : "Disponible"} />
        </View>
      </SurfaceCard>

      <SurfaceCard title="Mantenimiento" description={isCompact ? undefined : "Accesos directos para revisar el panel completo sin abrir estados técnicos."}>
        <View style={{ gap: 12 }}>
          <InlineButton label="Actualizar permisos admin" onPress={() => refreshAdminStatus().then(() => showToast("success", "Permisos actualizados.")).catch(() => showToast("danger", "No se pudieron actualizar los permisos."))} icon={RefreshCw} tone="secondary" />
          <InlineButton label="Recargar resumen" onPress={loadSummary} icon={LayoutDashboard} tone="secondary" />
          <InlineButton label="Recargar usuarios" onPress={() => loadUsers({ reset: true })} icon={Users} tone="secondary" />
          <InlineButton label="Ir a actualizaciones" onPress={() => goToScreen("updates")} icon={ArrowUpCircle} tone="ghost" />
        </View>
      </SurfaceCard>
    </View>
  );

  const tabCopy: Record<AdminTab, { title: string; subtitle: string }> = {
    summary: { title: "Resumen", subtitle: "Un dashboard limpio, rápido y útil tanto en escritorio como en móvil." },
    users: { title: "Usuarios", subtitle: "Búsqueda, filtros y acciones rápidas por usuario." },
    notifications: { title: "Notificaciones", subtitle: "Envía mensajes manuales con vista previa y confirmación clara." },
    scheduled: { title: "Programadas", subtitle: "Crea, edita y ejecuta envíos programados con mejor control." },
    automations: { title: "Automáticas", subtitle: "Gestiona las reglas existentes y pruébalas desde el flujo manual." },
    updates: { title: "Actualizaciones", subtitle: "Publica avisos de versión con modo opcional u obligatorio." },
    settings: { title: "Ajustes", subtitle: "Estado general del panel y accesos de mantenimiento." },
  };

  if (isAdminLoading) {
    return (
      <View style={styles.center}>
        <LoaderCircle size={26} color={Colors.light.tint} />
      </View>
    );
  }

  if (!isAdmin) {
    return (
      <View style={styles.center}>
        <SurfaceCard title="Acceso restringido" description="Este panel solo se muestra a usuarios presentes en public.admin_users." style={{ width: "100%", maxWidth: 520 }}>
          <View style={{ gap: 14 }}>
            <Text style={styles.helperText}>La navegación admin está protegida y las acciones reales se validan también en Edge Functions.</Text>
            <InlineButton label="Volver" onPress={() => router.back()} icon={ChevronLeft} tone="primary" />
          </View>
        </SurfaceCard>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <AdminShell
        title={tabCopy[tab].title}
        subtitle={isCompact ? undefined : tabCopy[tab].subtitle}
        navItems={NAV_ITEMS as any}
        activeKey={tab}
        onSelect={(key) => goToScreen(key as AdminTab)}
        headerActions={(
          <>
            {isCompact ? (
              <Pressable style={({ pressed }) => [styles.compactIconButton, pressed && { opacity: 0.9 }]} onPress={() => router.push("/admin")}>
                <ChevronLeft size={18} color="#2563EB" />
              </Pressable>
            ) : (
              <InlineButton label="Volver" onPress={() => router.push("/admin")} icon={ChevronLeft} tone="secondary" />
            )}
            {!isCompact && tab !== "notifications" ? <InlineButton label="Enviar notificación" onPress={() => goToScreen("notifications")} icon={SendHorizontal} tone="primary" /> : null}
          </>
        )}
      >
        <Animated.View style={{ opacity: contentFade }}>
          {tab === "summary" ? summaryContent : null}
          {tab === "users" ? usersContent : null}
          {tab === "notifications" ? notificationsContent : null}
          {tab === "scheduled" ? scheduledContent : null}
          {tab === "automations" ? automationsContent : null}
          {tab === "updates" ? updatesContent : null}
          {tab === "settings" ? settingsContent : null}
        </Animated.View>
      </AdminShell>

      {toast ? (
        <View pointerEvents="none" style={styles.toastWrap}>
          <ToastBanner tone={toast.tone} message={toast.message} />
        </View>
      ) : null}

      {isCompact && tab !== "notifications" ? (
        <Pressable style={[styles.fab, { bottom: Math.max(insets.bottom + 12, 26) }]} onPress={() => goToScreen("notifications")}>
          <SendHorizontal size={22} color="#FFFFFF" />
        </Pressable>
      ) : null}

      <Modal visible={detailVisible} transparent animationType="fade" onRequestClose={() => setDetailVisible(false)}>
        <View style={styles.modalOverlay}>
          <SurfaceCard title="Detalle de usuario" description="Ficha rápida para actuar sin perder el contexto." style={styles.detailCard}>
            <View style={{ gap: 14 }}>
              <View style={styles.userCardHeader}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.userName}>{detailUser?.display_name || detailUser?.email || "Usuario"}</Text>
                  <Text style={styles.userMeta}>{detailUser?.email || "Sin email"}</Text>
                </View>
                {detailUser ? <Badge label={updateBadge(detailUser).label} tone={updateBadge(detailUser).tone} /> : null}
              </View>

              <View style={styles.detailGrid}>
                <InfoLine label="user_id" value={detailUser?.user_id || "Sin dato"} icon={UserRound} />
                <InfoLine label="Plataforma" value={detailUser?.platform || "Sin dato"} icon={detailUser?.platform === "ios" ? Apple : Smartphone} />
                <InfoLine label="Versión instalada" value={detailUser?.app_version || "Sin dato"} icon={ArrowDownToLine} />
                <InfoLine label="Última versión" value={detailUser?.latest_version || "Sin dato"} icon={ArrowUpCircle} />
                <InfoLine label="Última jornada" value={detailUser?.last_jornada_at ? formatIsoToLocal(detailUser.last_jornada_at) : "Sin dato"} icon={CalendarClock} />
                <InfoLine label="Última actividad" value={detailUser?.last_seen_at ? formatIsoToLocal(detailUser.last_seen_at) : "Sin dato"} icon={Clock3} />
              </View>

              <View style={styles.badgesRow}>
                <Badge label={detailUser?.notifications_enabled === false ? "Notificaciones no" : "Notificaciones sí"} tone={detailUser?.notifications_enabled === false ? "warning" : "success"} />
                <Badge label={detailUser?.has_push_token ? "Push token sí" : "Push token no"} tone={detailUser?.has_push_token ? "info" : "default"} />
              </View>

              <View style={styles.rowButtons}>
                <InlineButton
                  label="Copiar user_id"
                  onPress={() => {
                    const uid = detailUser?.user_id;
                    if (!uid) return;
                    if (Platform.OS === "web" && typeof navigator !== "undefined" && (navigator as any)?.clipboard?.writeText) {
                      (navigator as any).clipboard.writeText(uid).then(() => showToast("success", "user_id copiado.")).catch(() => showToast("danger", "No se pudo copiar el user_id."));
                    } else {
                      showToast("info", uid);
                    }
                  }}
                  icon={Copy}
                  tone="secondary"
                  style={{ flex: 1 }}
                />
                <InlineButton
                  label="Enviar notificación"
                  onPress={() => {
                    if (!detailUser?.user_id) return;
                    openNotificationsForUser(detailUser);
                    setDetailVisible(false);
                  }}
                  icon={MessageSquareShare}
                  tone="primary"
                  style={{ flex: 1 }}
                />
              </View>

              <View style={styles.rowButtons}>
                <InlineButton
                  label="Recordatorio jornada"
                  onPress={() => {
                    if (!detailUser?.user_id) return;
                    openNotificationsForUser(detailUser, {
                      type: "reminder",
                      title: "Recuerda registrar tu jornada",
                      body: "Acuérdate de registrar la jornada de hoy.",
                    });
                    setDetailVisible(false);
                  }}
                  icon={CalendarClock}
                  tone="secondary"
                  style={{ flex: 1 }}
                />
                <InlineButton
                  label="Aviso de actualización"
                  onPress={() => {
                    if (!detailUser?.user_id) return;
                    openNotificationsForUser(detailUser, {
                      type: "update_optional",
                      title: "Actualización disponible",
                      body: "Hay una nueva versión de Tacoplan disponible.",
                    });
                    setDetailVisible(false);
                  }}
                  icon={ArrowUpCircle}
                  tone="secondary"
                  style={{ flex: 1 }}
                />
              </View>

              <InlineButton label="Cerrar" onPress={() => setDetailVisible(false)} icon={X} tone="danger" />
            </View>
          </SurfaceCard>
        </View>
      </Modal>

      <Modal visible={usersFilterSheetVisible} transparent animationType="fade" onRequestClose={() => setUsersFilterSheetVisible(false)}>
        <View style={styles.sheetOverlay}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setUsersFilterSheetVisible(false)} />
          <View style={[styles.sheetCard, { paddingBottom: Math.max(insets.bottom + 18, 28) }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Filtrar</Text>
            <View style={{ gap: 2 }}>
              {USER_FILTER_OPTIONS.map((item) => (
                <Pressable
                  key={item.key}
                  onPress={() => setPendingUsersFilter(item.key)}
                  style={({ pressed }) => [styles.sheetOption, pressed && { opacity: 0.92 }]}
                >
                  <Text style={styles.sheetOptionLabel}>{item.label}</Text>
                  {pendingUsersFilter === item.key ? <Check size={18} color="#2563EB" /> : null}
                </Pressable>
              ))}
            </View>
            <View style={styles.sheetButtons}>
              <InlineButton label="Cancelar" onPress={() => setUsersFilterSheetVisible(false)} tone="secondary" style={{ flex: 1 }} />
              <InlineButton
                label="Aplicar"
                onPress={() => {
                  setUsersFilter(pendingUsersFilter);
                  setUsersFilterSheetVisible(false);
                }}
                tone="primary"
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function InfoLine({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: any;
}) {
  return (
    <View style={styles.infoLine}>
      <View style={styles.infoLineIcon}>
        <Icon size={14} color="#2563EB" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLineLabel}>{label}</Text>
        <Text style={styles.infoLineValue} numberOfLines={2}>{value}</Text>
      </View>
    </View>
  );
}

function PreviewLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.previewLine}>
      <Text style={styles.previewLabel}>{label}</Text>
      <Text style={styles.previewValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F6F8FC",
    padding: 20,
  },
  toastWrap: {
    position: "absolute",
    top: Platform.OS === "web" ? 24 : 56,
    right: 18,
    left: 18,
    alignItems: "center",
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
  },
  quickActionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  quickActionItem: {
    flex: 1,
    minWidth: 220,
  },
  flexCard: {
    flex: 1,
    minWidth: 320,
  },
  fullWidthItem: {
    width: "100%",
    minWidth: 0,
    flexBasis: "100%",
  },
  fullWidthMetric: {
    minWidth: 0,
    width: "100%",
    flexBasis: "100%",
  },
  compactWarningCard: {
    borderColor: "#FCD34D",
    backgroundColor: "#FFFBEB",
  },
  compactWarningHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  compactWarningTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 15,
    color: "#92400E",
  },
  helperText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 20,
    color: "#64748B",
  },
  helperError: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    lineHeight: 20,
    color: "#B91C1C",
  },
  inlineGroup: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  listGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
  },
  twoCol: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
  },
  input: {
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D7E2F2",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: "#0F172A",
  },
  readonlyField: {
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D7E2F2",
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 14,
    justifyContent: "center",
  },
  readonlyValue: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: "#0F172A",
  },
  textarea: {
    minHeight: 110,
    textAlignVertical: "top",
  },
  searchField: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D7E2F2",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: "#0F172A",
  },
  mobileUsersHeader: {
    gap: 12,
  },
  mobileUsersActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  compactIconButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D7E2F2",
  },
  compactIconButtonDisabled: {
    opacity: 0.55,
  },
  mobileFilterSummary: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: "#64748B",
  },
  userCard: {
    flex: 1,
    minWidth: 320,
  },
  userCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
  },
  userName: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    color: "#0F172A",
  },
  userMeta: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#64748B",
  },
  userFactGrid: {
    marginTop: 14,
    gap: 10,
  },
  badgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14,
  },
  rowButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 14,
  },
  inlineInputs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  selectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: "#475569",
  },
  selectionValue: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    lineHeight: 20,
    color: "#0F172A",
    marginVertical: 8,
  },
  softCard: {
    borderRadius: 18,
    backgroundColor: "#F8FBFF",
  },
  inlineError: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 14,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inlineErrorText: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: "#B91C1C",
  },
  historyRow: {
    borderWidth: 1,
    borderColor: "#E5EAF4",
    borderRadius: 18,
    padding: 14,
    backgroundColor: "#FBFDFF",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  historyTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
    color: "#0F172A",
  },
  historyBody: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 20,
    color: "#64748B",
  },
  toggleRow: {
    borderWidth: 1,
    borderColor: "#E5EAF4",
    borderRadius: 16,
    padding: 14,
    backgroundColor: "#FBFDFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
  },
  toggleTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: "#0F172A",
  },
  toggleHelper: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#64748B",
  },
  switchBase: {
    width: 48,
    height: 28,
    borderRadius: 16,
    backgroundColor: "#CBD5E1",
    paddingHorizontal: 3,
    justifyContent: "center",
  },
  switchBaseOn: {
    backgroundColor: "#2563EB",
  },
  switchThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#FFFFFF",
  },
  switchThumbOn: {
    alignSelf: "flex-end",
  },
  previewLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
  },
  previewLabel: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: "#64748B",
  },
  previewValue: {
    flex: 1,
    textAlign: "right",
    fontFamily: "Inter_700Bold",
    fontSize: 13,
    color: "#0F172A",
  },
  weekDaysRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  dayChip: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D7E2F2",
  },
  dayChipActive: {
    backgroundColor: "#2563EB",
    borderColor: "#2563EB",
  },
  dayChipText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: "#475569",
  },
  dayChipTextActive: {
    color: "#FFFFFF",
  },
  scheduleRow: {
    borderWidth: 1,
    borderColor: "#E5EAF4",
    borderRadius: 18,
    padding: 16,
    backgroundColor: "#FBFDFF",
    gap: 16,
  },
  actionWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  fab: {
    position: "absolute",
    right: 18,
    bottom: 26,
    width: 58,
    height: 58,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2563EB",
    shadowColor: "#0F172A",
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.28)",
    justifyContent: "center",
    padding: 18,
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(15,23,42,0.28)",
  },
  sheetBackdrop: {
    flex: 1,
  },
  sheetCard: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 28,
    gap: 14,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 46,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#D7E2F2",
  },
  sheetTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
    color: "#0F172A",
  },
  sheetOption: {
    minHeight: 54,
    borderBottomWidth: 1,
    borderBottomColor: "#EEF2F7",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetOptionLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 16,
    color: "#0F172A",
  },
  sheetButtons: {
    flexDirection: "row",
    gap: 10,
    marginTop: 6,
  },
  detailCard: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 760,
  },
  detailGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  infoLine: {
    flex: 1,
    minWidth: 220,
    flexDirection: "row",
    gap: 10,
    borderWidth: 1,
    borderColor: "#E5EAF4",
    borderRadius: 16,
    padding: 12,
    backgroundColor: "#FBFDFF",
  },
  infoLineIcon: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#DBEAFE",
  },
  infoLineLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: "#64748B",
  },
  infoLineValue: {
    marginTop: 4,
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: "#0F172A",
  },
});
