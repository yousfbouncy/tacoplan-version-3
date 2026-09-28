import { Platform } from "react-native";
import type { Jornada } from "../local-storage";
import {
  TachographBluetoothService,
  type TachographBleScanCallbacks,
} from "./tachographBluetoothService";
import type {
  TachographActivity,
  TachographBondState,
  TachographConnectionState,
  TachographCreditsState,
  TachographDailySummary,
  TachographDataSource,
  TachographDetectedServices,
  TachographDevice,
  TachographEvent,
  TachographFifoState,
  TachographLiveData,
  TachographScanDevice,
  TachographSession,
  TachographTransportState,
} from "./types";
import { emptyLiveData } from "./types";
import {
  buildDailySummary,
  getActiveSession,
  getLastActivity,
  listAuthorizedDevices,
  listEventsForDate,
  listEventsForJornada,
  pushEvents,
  removeAuthorizedDevice,
  setActiveSession,
  setLastActivity,
  type LastActivitySnapshot,
  upsertAuthorizedDevice,
  upsertDailySummary,
} from "./tachographStore";
import { deviceFromScan } from "./bluetoothTransport";

type BleLike = InstanceType<typeof TachographBluetoothService>;

function uid(prefix = "tg"): string {
  return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
}

function mondayOfWeek(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const day = (d.getUTCDay() + 6) % 7; // 0=Mon
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export interface TachographServiceListeners {
  onConnectionChange?: (state: TachographConnectionState) => void;
  onDeviceChange?: (device: TachographDevice | null) => void;
  onLiveDataChange?: (live: TachographLiveData) => void;
  onEventsChange?: (events: TachographEvent[]) => void;
  onBondStateChange?: (bond: TachographBondState) => void;
  onDetectedServicesChange?: (detected: TachographDetectedServices | null) => void;
  onMtuNegotiated?: (mtu: number | null) => void;
  onTransportStateChange?: (state: TachographTransportState) => void;
  onFifoStateChange?: (svc: "download" | "diagnostic", state: TachographFifoState) => void;
  onCreditsStateChange?: (svc: "download" | "diagnostic", state: TachographCreditsState) => void;
  onCreditsChanged?: (svc: "download" | "diagnostic", available: number | null, consumed: number) => void;
  onError?: (error: Error) => void;
}

export interface TachographCloseJornadaHint {
  drivingMin?: number;
  workMin?: number;
  availableMin?: number;
  restMin?: number;
  countries?: string[];
  countryEntriesCount?: number;
  kmTotal?: number;
  firstActivityAt?: string;
  lastActivityAt?: string;
  dataSource: TachographDataSource;
  dataQualityScore?: number;
  dailySummaryId?: string;
  disconnectionsCount?: number;
  dataQuality?: "low" | "medium" | "high";
}

export class TachographService {
  private ble: BleLike = new TachographBluetoothService();
  private listeners = new Set<TachographServiceListeners>();
  private connectionState: TachographConnectionState = this.ble.isSupported() ? "idle" : "unsupported";
  private device: TachographDevice | null = null;
  private session: TachographSession | null = null;
  private live: TachographLiveData = emptyLiveData();
  private scanAbort: AbortController | null = null;
  private userId: string | null = null;
  private autoReconnectTimer: any = null;
  private autoFetchTimer: any = null;
  private lastCountries: Record<string, string | null> = {}; // jornadaId -> country
  private listenersById: Record<string, TachographServiceListeners> = {};
  private bondedSessionDeviceId: string | null = null;
  private detectedServicesSnapshot: TachographDetectedServices | null = null;

  constructor() {}

  isDemoMode(): boolean {
    return false;
  }

  async enableDemoMode(): Promise<void> {
    // Demo mode desactivado por petición del usuario. Sin funcionalidad.
  }

  setUserId(userId: string | null): void {
    this.userId = userId ?? null;
  }

  addListener(id: string, l: TachographServiceListeners): void {
    this.listenersById[id] = l;
    this.listeners.add(l);
  }

  removeListener(id: string): void {
    const l = this.listenersById[id];
    if (l) this.listeners.delete(l);
    delete this.listenersById[id];
  }

  // =====================================================================
  // Estado básico
  // =====================================================================
  getConnectionState(): TachographConnectionState {
    return this.connectionState;
  }

  getDevice(): TachographDevice | null {
    return this.device;
  }

  getSession(): TachographSession | null {
    return this.session;
  }

  getLiveData(): TachographLiveData {
    return { ...this.live };
  }

  async listAuthorized(): Promise<TachographDevice[]> {
    return listAuthorizedDevices();
  }

  async removeAuthorized(identifier: string): Promise<void> {
    await removeAuthorizedDevice(identifier, this.userId);
  }

  getDetectedServices(): TachographDetectedServices | null {
    return this.detectedServicesSnapshot ? { ...this.detectedServicesSnapshot } : null;
  }

  // =====================================================================
  // Permisos y scan
  // =====================================================================
  async ensurePermissions(): Promise<{ ok: boolean; reason?: string }> {
    return this.ble.requestPermissions();
  }

  async startScan(
    onDeviceOrObj:
      | ((d: TachographScanDevice) => void)
      | {
          onDeviceFound: (d: TachographScanDevice) => void;
          onDeviceUpdated?: (d: TachographScanDevice) => void;
          onScanError?: (e: Error) => void;
          onScanStopped?: () => void;
        },
    onErrorArg?: (e: Error) => void,
  ): Promise<void> {
    let onDevice: (d: TachographScanDevice) => void;
    let onDeviceUpdated: ((d: TachographScanDevice) => void) | undefined;
    let onError: ((e: Error) => void) | undefined;
    let onStopped: (() => void) | undefined;
    if (typeof onDeviceOrObj === "function") {
      onDevice = onDeviceOrObj;
      onError = onErrorArg;
    } else {
      onDevice = onDeviceOrObj.onDeviceFound;
      onDeviceUpdated = onDeviceOrObj.onDeviceUpdated;
      onError = onDeviceOrObj.onScanError;
      onStopped = onDeviceOrObj.onScanStopped;
    }
    const perm = await this.ble.requestPermissions();
    if (!perm.ok) {
      if (perm.reason === "EXPO_GO_AND_WEB_UNSUPPORTED") {
        this.setConnectionState("unsupported");
        onError?.(new Error("BLE_UNSUPPORTED_IN_EXPO_GO"));
      } else {
        this.setConnectionState("error");
        const err = new Error(perm.reason || "BLE_PERMISSION_ERROR");
        onError?.(err);
        this.emitError(err);
      }
      return;
    }
    this.scanAbort?.abort();
    this.scanAbort = new AbortController();
    this.setConnectionState("scanning");

    const scanCallbacks: TachographBleScanCallbacks = {
      onDeviceFound: onDevice,
      onDeviceUpdated: (d) => onDeviceUpdated?.(d),
      onScanError: (e) => {
        const msg = e?.message || "";
        const isUnsupported =
          msg.includes("BLE_UNSUPPORTED") ||
          msg.includes("EXPO_GO") ||
          msg.includes("NativeEventEmitter") ||
          msg.includes("requires anon-null") ||
          msg.includes("requires non-null");
        if (isUnsupported) {
          this.setConnectionState("unsupported");
          onError?.(e);
          onStopped?.();
          return;
        }
        this.setConnectionState("error");
        onError?.(e);
        this.emitError(e);
        onStopped?.();
      },
      onScanStopped: () => {
        if (this.connectionState === "scanning") this.setConnectionState("idle");
        onStopped?.();
      },
    };

    const signal = this.scanAbort.signal;
    signal.addEventListener("abort", () => {
      try { this.ble.stopScan(); } catch {}
    });
    await this.ble.startScan(scanCallbacks);
  }

  stopScan(): void {
    this.scanAbort?.abort();
    this.scanAbort = null;
    this.ble.stopScan();
  }

  // =====================================================================
  // Autorización + conexión
  // =====================================================================
  async authorizeAndConnect(scan: TachographScanDevice): Promise<TachographDevice> {
    const dev = deviceFromScan(scan, true);
    const trusted = await upsertAuthorizedDevice(dev, this.userId);
    this.device = trusted;
    this.emitDevice();
    await this.connectToDevice(trusted);
    return trusted;
  }

  async tryAutoReconnect(): Promise<boolean> {
    if (!this.ble.isSupported()) return false;
    const list = await listAuthorizedDevices();
    const pick = list.find((d) => d.trusted && d.autoReconnect) || list[0];
    if (!pick) return false;
    this.device = pick;
    this.emitDevice();
    await this.connectToDevice(pick, true);
    return true;
  }

  async disconnect(): Promise<void> {
    this.stopAutoFetch();
    clearTimeout(this.autoReconnectTimer);
    this.autoReconnectTimer = null;
    await this.ble.disconnect();
    if (this.session) {
      this.session = {
        ...this.session,
        endedAt: new Date().toISOString(),
        connectionState: "disconnected",
      };
      await setActiveSession(this.session, this.userId);
    }
    this.bondedSessionDeviceId = null;
    this.setConnectionState("disconnected");
  }

  // =====================================================================
  // Envío de actividad normalizada desde UI / integración externa.
  // Usar solo cuando la fuente sea 100% fiable y NO cuando no se disponga
  // de datos del parser (no falsear eventos).
  // =====================================================================
  submitManualActivityChange(params: {
    next: TachographActivity;
    jornadaId?: string | null;
    durationMin?: number;
    source: TachographDataSource;
    timestamp?: string;
  }): void {
    const ev = this.ble.submitActivityChange({
      nextActivity: params.next,
      source: params.source === "manual" ? "manual" : "tachograph_ble",
      durationMin: params.durationMin,
      jornadaId: params.jornadaId ?? this.session?.jornadaId ?? undefined,
      sessionId: this.session?.id,
      timestamp: params.timestamp,
    });
    if (ev) this.pushEvents([ev]);
    this.reevaluateLiveFromSubmitted();
  }

  /**
   * Intenta aplicar un evento binario ya parseado y normalizado
   * (sólo lo acepta si el parser realmente lo pudo interpretar).
   */
  async submitNormalizedEvent(ev: TachographEvent): Promise<void> {
    await this.pushEvents([ev]);
    this.reevaluateLiveFromSubmitted();
  }

  // =====================================================================
  // Integración con jornada activa
  // =====================================================================
  bindActiveJornada(jornada: Pick<Jornada, "id" | "startAt" | "endAt" | "fechaInicio" | "fechaFin"> | null): void {
    if (!jornada || !jornada.id || jornada.endAt) {
      return;
    }
    if (this.session && this.session.jornadaId !== jornada.id) {
      this.session = { ...this.session, jornadaId: jornada.id };
      void setActiveSession(this.session, this.userId);
    }
    if (!this.lastCountries[jornada.id]) {
      this.lastCountries[jornada.id] = null;
    }
    this.updateLiveForJornada(jornada as Jornada).catch(() => {});
  }

  async closeJornadaHint(jornada: Pick<Jornada, "id" | "startAt" | "endAt" | "fechaInicio" | "fechaFin">): Promise<TachographCloseJornadaHint> {
    const evs = (await listEventsForJornada(jornada.id)).filter((e) => e.eventType === "activity_change" || e.eventType === "country_entry");
    const countryEntries = evs.filter((e) => e.eventType === "country_entry").length;
    const summary = buildDailySummary({ events: evs, jornadaId: jornada.id, source: "tachograph_ble", disconnectionsCount: this.session?.disconnectionsCount ?? 0 });
    const savedSummary = await upsertDailySummary(summary, this.userId);
    let kmTotal: number | undefined;
    if (summary.distanceKm != null) kmTotal = Math.round(Number(summary.distanceKm) * 100) / 100;
    const quality: "low" | "medium" | "high" =
      (summary.dataQualityScore ?? 0) >= 0.85 ? "high" : (summary.dataQualityScore ?? 0) >= 0.5 ? "medium" : "low";
    return {
      drivingMin: summary.drivingMin,
      workMin: summary.workMin,
      availableMin: summary.availableMin,
      restMin: summary.restMin,
      countries: summary.countries,
      countryEntriesCount: countryEntries,
      kmTotal,
      firstActivityAt: summary.firstActivityAt ?? undefined,
      lastActivityAt: summary.lastActivityAt ?? undefined,
      dataSource: summary.dataSource,
      dataQualityScore: summary.dataQualityScore ?? undefined,
      dailySummaryId: (savedSummary?.id ?? summary.id) ?? undefined,
      disconnectionsCount: this.session?.disconnectionsCount ?? 0,
      dataQuality: quality,
    };
  }

  // =====================================================================
  // Consultas
  // =====================================================================
  async eventsForToday(): Promise<TachographEvent[]> {
    const today = new Date().toISOString().slice(0, 10);
    return listEventsForDate(today);
  }

  async eventsForDay(dateIso: string): Promise<TachographEvent[]> {
    return listEventsForDate(dateIso);
  }

  async eventsForJornada(jornadaId: string): Promise<TachographEvent[]> {
    return listEventsForJornada(jornadaId);
  }

  async dailySummaryForDay(dateIso: string, jornadaId?: string | null): Promise<TachographDailySummary> {
    const events = jornadaId ? await listEventsForJornada(jornadaId) : await listEventsForDate(dateIso);
    return buildDailySummary({
      events,
      jornadaId: jornadaId ?? null,
      source: "tachograph_ble",
      disconnectionsCount: this.session?.disconnectionsCount ?? 0,
    });
  }

  destroy(): void {
    this.stopAutoFetch();
    clearTimeout(this.autoReconnectTimer);
    this.autoReconnectTimer = null;
    this.stopScan();
    void this.disconnect();
    this.listeners.clear();
    this.listenersById = {};
  }

  // =====================================================================
  // Internals
  // =====================================================================
  private async connectToDevice(dev: TachographDevice, auto = false): Promise<void> {
    this.setConnectionState("connecting");
    const state = (await getActiveSession());
    if (!state || state.connectionState === "disconnected" || state.endedAt) {
      this.session = {
        id: uid("ses"),
        deviceId: dev.id || null,
        jornadaId: this.session?.jornadaId || null,
        startedAt: new Date().toISOString(),
        connectionState: "connecting",
        disconnectionsCount: state?.disconnectionsCount || 0,
      };
    } else {
      this.session = { ...state, connectionState: "connecting" };
    }
    await setActiveSession(this.session, this.userId);
    this.bondedSessionDeviceId = dev.identifier;
    // Reseteamos live.snapshot para esta sesión: mantenemos nulls en NO confirmados.
    this.live = {
      ...emptyLiveData(),
      dataSource: "tachograph_ble",
      connectedDeviceId: dev.identifier,
      lastUpdatedAt: new Date().toISOString(),
    };
    this.detectedServicesSnapshot = null;
    this.emitLive();
    this.emitDetectedServices();
    this.emitBondState(this.live.bondState || "UNKNOWN");
    this.emitMtu(null);
    this.emitTransportState(this.live.transportState || "NOT_STARTED");

    try {
      await this.ble.connect(dev.identifier, {
        onStateChange: (s) => {
          if (s === "disconnected") {
            this.stopAutoFetch();
            if (this.session) {
              this.session = {
                ...this.session,
                connectionState: "disconnected",
                disconnectionsCount: (this.session.disconnectionsCount || 0) + 1,
              };
              void setActiveSession(this.session, this.userId);
            }
            this.setConnectionState("disconnected");
            if (auto && dev.autoReconnect) {
              this.scheduleAutoReconnect(dev);
            }
            return;
          }
          if (s === "connected") {
            const startedAt = this.session?.startedAt || new Date().toISOString();
            this.session = {
              ...(this.session || { id: uid("ses"), startedAt, disconnectionsCount: 0 }),
              deviceId: dev.id || null,
              connectionState: "connected",
            };
            void setActiveSession(this.session, this.userId);
            this.setConnectionState("connected");
            const now = new Date().toISOString();
            this.live = { ...this.live, dataSource: "tachograph_ble", lastUpdatedAt: now, connectedDeviceId: dev.identifier };
            this.emitLive();
            this.startAutoFetch();
            return;
          }
          // scanning / connecting / discovering / bonding / bonded / transport_init / transport_ready / error
          this.setConnectionState(s);
          if (s === "transport_ready") {
            const now = new Date().toISOString();
            this.live = { ...this.live, lastUpdatedAt: now, dataSource: "tachograph_ble" };
            this.emitLive();
          }
        },
        onBondStateChange: (bond) => {
          this.live = { ...this.live, bondState: bond };
          this.emitLive();
          this.emitBondState(bond);
        },
        onDetectedServices: (detected) => {
          this.detectedServicesSnapshot = detected;
          this.live = {
            ...this.live,
            detectedServices: { ...detected },
          };
          this.emitLive();
          this.emitDetectedServices();
        },
        onMtuNegotiated: (mtu) => {
          this.live = { ...this.live, mtuNegotiated: mtu };
          this.emitLive();
          this.emitMtu(mtu);
        },
        onTransportStateChange: (trState) => {
          this.live = { ...this.live, transportState: trState };
          this.emitLive();
          this.emitTransportState(trState);
        },
        onFifoStateChange: (svc, fState) => {
          this.live = { ...this.live, fifoState: fState };
          this.emitLive();
          for (const l of this.listeners) l.onFifoStateChange?.(svc, fState);
        },
        onCreditsStateChange: (svc, cState) => {
          this.live = { ...this.live, creditsState: cState };
          this.emitLive();
          for (const l of this.listeners) l.onCreditsStateChange?.(svc, cState);
        },
        onCreditsChanged: (svc, avail, cons) => {
          this.live = { ...this.live, creditsAvailable: avail, creditsConsumed: cons };
          this.emitLive();
          for (const l of this.listeners) l.onCreditsChanged?.(svc, avail, cons);
        },
        onFifoData: (_svc, _bytes) => {
          // Parser binario ITS todavía pending_spec (TODO ITS-SPEC).
          // Actualizamos lastUpdatedAt para reflejar actividad BLE real.
          const now = new Date().toISOString();
          this.live = { ...this.live, lastUpdatedAt: now, dataSource: "tachograph_ble" };
          this.emitLive();
        },
        onError: (e) => this.emitError(e),
      });
    } catch (e) {
      this.stopAutoFetch();
      const err = e instanceof Error ? e : new Error(String(e));
      this.setConnectionState("error");
      this.emitError(err);
    }
  }

  // =====================================================================
  // Autoreco / descarga manual datos FIFO
  // =====================================================================
  startAutoFetch(): void {
    this.stopAutoFetch();
    const tick = async () => {
      try {
        await this.fetchTachoFifoOnce();
      } catch {}
    };
    void tick();
    this.autoFetchTimer = setInterval(() => {
      void tick();
    }, 5000);
  }

  stopAutoFetch(): void {
    if (this.autoFetchTimer != null) {
      clearInterval(this.autoFetchTimer);
      this.autoFetchTimer = null;
    }
  }

  isAutoFetchRunning(): boolean {
    return this.autoFetchTimer != null;
  }

  /**
   * Intenta leer el FIFO del tacógrafo una vez.
   * Como el parser binario Smart Tacho 2 todavía está pending_spec,
   * lo único que hacemos aquí es:
   *   - actualizar lastUpdatedAt / dataSource = tachograph_ble
   *   - mantener timestamp de conexión viva.
   * Las INDICATIONS del transporte ya alimentan onFifoData.
   */
  async fetchTachoFifoOnce(): Promise<{ fetchedCount: number; bytesTotal: number }> {
    if (this.connectionState !== "connected" && this.connectionState !== "transport_ready") {
      return { fetchedCount: 0, bytesTotal: 0 };
    }
    const now = new Date().toISOString();
    this.live = { ...this.live, lastUpdatedAt: now, dataSource: "tachograph_ble" };
    this.emitLive();
    return { fetchedCount: 0, bytesTotal: 0 };
  }

  private scheduleAutoReconnect(dev: TachographDevice): void {
    clearTimeout(this.autoReconnectTimer);
    this.autoReconnectTimer = setTimeout(() => {
      void (async () => {
        try {
          if (dev.autoReconnect) {
            await this.connectToDevice(dev, true);
          }
        } catch {}
      })();
    }, 8000);
  }

  private async pushEvents(events: TachographEvent[]): Promise<void> {
    const withSession = events.map((e) => {
      if (e.sessionId || !this.session) return e;
      return { ...e, sessionId: this.session!.id };
    });
    const withJornada = withSession.map((e) => {
      if (e.jornadaId || !this.session?.jornadaId) return e;
      return { ...e, jornadaId: this.session!.jornadaId };
    });
    await pushEvents(withJornada, this.userId);

    const lastAct = withJornada.filter((e) => e.eventType === "activity_change").slice(-1)[0];
    if (lastAct && lastAct.newActivity) {
      const snap: LastActivitySnapshot = {
        activity: lastAct.newActivity,
        startedAt: lastAct.timestamp,
        source: lastAct.source,
      };
      await setLastActivity(snap);
    }
    for (const ev of withJornada) {
      if (ev.eventType === "country_entry" && ev.jornadaId && ev.newCountry) {
        this.lastCountries[ev.jornadaId] = ev.newCountry;
      }
    }
    const lastJornadaId = this.session?.jornadaId || "";
    const eventsForJornada = lastJornadaId ? await listEventsForJornada(lastJornadaId) : [];
    this.emitEvents(eventsForJornada);
  }

  private async updateLiveForJornada(j: Jornada): Promise<void> {
    const events = await listEventsForJornada(j.id);
    this.recomputeLiveFrom(events, j.fechaInicio || j.startAt.slice(0, 10));
    const last = this.ble.getLastActivity();
    const stored = await getLastActivity();
    if (!this.live.currentActivityStartedAt) {
      this.live.currentActivityStartedAt = last.startedAt || stored?.startedAt || null;
    }
    if (this.live.currentActivity === "UNKNOWN" && (stored?.activity || last.activity)) {
      this.live.currentActivity = stored?.activity || last.activity;
    }
    this.emitLive();
  }

  private reevaluateLiveFromSubmitted(): void {
    const last = this.ble.getLastActivity();
    if (last.activity && last.activity !== "UNKNOWN") {
      this.live = {
        ...this.live,
        currentActivity: last.activity,
        currentActivityStartedAt: last.startedAt,
        lastUpdatedAt: new Date().toISOString(),
        dataSource: "tachograph_ble",
      };
      this.emitLive();
    }
  }

  private recomputeLiveFrom(events: TachographEvent[], dateKey: string): void {
    const start = new Date(`${dateKey}T00:00:00`).getTime();
    const end = start + 24 * 3600 * 1000;
    const today = events.filter((e) => {
      const t = new Date(e.timestamp).getTime();
      return t >= start && t < end;
    });
    const thisWeekMon = new Date(`${mondayOfWeek(dateKey)}T00:00:00`).getTime();
    const nextWeekMon = thisWeekMon + 7 * 24 * 3600 * 1000;
    const prevWeekMon = thisWeekMon - 7 * 24 * 3600 * 1000;
    const thisWeek = events.filter((e) => {
      const t = new Date(e.timestamp).getTime();
      return t >= thisWeekMon && t < nextWeekMon;
    });
    const lastPlusThis = events.filter((e) => {
      const t = new Date(e.timestamp).getTime();
      return t >= prevWeekMon && t < nextWeekMon;
    });

    let continuous: number | null = this.live.continuousDrivingMin;
    let accumulatedPause: number | null = this.live.accumulatedPauseMin;
    let drivingToday: number | null = this.live.drivingTodayMin;
    let drivingThisWeek: number | null = this.live.drivingThisWeekMin;
    let drivingLastPlusThis: number | null = this.live.drivingLastPlusThisWeekMin;
    let remainingContinuous: number | null = this.live.remainingContinuousMin;
    let current: TachographActivity = this.live.currentActivity;
    let currentStartedAt: string | null = this.live.currentActivityStartedAt ?? null;
    let lastCountry: string | null = this.live.country ?? null;
    const nowTime = Date.now();
    let maxOdo: number | null = this.live.odometerKm ?? null;

    if (events.length > 0) {
      continuous = continuous ?? 0;
      accumulatedPause = accumulatedPause ?? 0;
      drivingToday = drivingToday ?? 0;
      drivingThisWeek = drivingThisWeek ?? 0;
      drivingLastPlusThis = drivingLastPlusThis ?? 0;
      remainingContinuous = remainingContinuous ?? 0;
    }

    for (const ev of events) {
      if (ev.eventType === "country_entry" && ev.newCountry) {
        lastCountry = ev.newCountry;
      }
      if (ev.odometerKm != null) {
        maxOdo = maxOdo == null ? ev.odometerKm : Math.max(maxOdo, ev.odometerKm);
      }
      if (ev.eventType !== "activity_change" || !ev.newActivity) continue;
      const ts = new Date(ev.timestamp).getTime();
      const dur = Number(ev.durationMin) || 0;
      switch (ev.newActivity) {
        case "DRIVING":
          if (today.includes(ev)) drivingToday = (drivingToday ?? 0) + dur;
          if (thisWeek.includes(ev)) drivingThisWeek = (drivingThisWeek ?? 0) + dur;
          if (lastPlusThis.includes(ev)) drivingLastPlusThis = (drivingLastPlusThis ?? 0) + dur;
          break;
        case "REST":
          if (today.includes(ev)) accumulatedPause = (accumulatedPause ?? 0) + dur;
          break;
      }
      if (ev.newActivity !== "UNKNOWN") {
        current = ev.newActivity;
        currentStartedAt = ev.timestamp;
      }
    }

    if (current === "DRIVING" && currentStartedAt && continuous != null) {
      const started = new Date(currentStartedAt).getTime();
      const elapsed = Math.max(0, Math.round((nowTime - started) / 60000));
      continuous = Math.min(4 * 60 + 30, elapsed);
      remainingContinuous = Math.max(0, 4 * 60 + 30 - continuous);
    }

    this.live = {
      ...this.live,
      currentActivity: current,
      currentActivityStartedAt: currentStartedAt,
      continuousDrivingMin: continuous,
      drivingTodayMin: drivingToday,
      drivingThisWeekMin: drivingThisWeek,
      drivingLastPlusThisWeekMin: drivingLastPlusThis,
      remainingContinuousMin: remainingContinuous,
      accumulatedPauseMin: accumulatedPause,
      odometerKm: maxOdo,
      country: lastCountry,
      // NO inventamos speed/distance si el parser no los confirmó.
      // Mantener los valores que live ya traía (null si no hay dato real).
      lastUpdatedAt: new Date().toISOString(),
      dataSource: events.length ? "tachograph_ble" : this.live.dataSource,
    };
    this.emitLive();
  }

  private setConnectionState(s: TachographConnectionState): void {
    this.connectionState = s;
    for (const l of this.listeners) l.onConnectionChange?.(s);
  }

  private emitDevice(): void {
    for (const l of this.listeners) l.onDeviceChange?.(this.device);
  }

  private emitLive(): void {
    const snapshot = { ...this.live };
    for (const l of this.listeners) l.onLiveDataChange?.(snapshot);
  }

  private emitEvents(evs: TachographEvent[]): void {
    for (const l of this.listeners) l.onEventsChange?.(evs);
  }

  private emitError(e: Error): void {
    for (const l of this.listeners) l.onError?.(e);
  }

  private emitBondState(b: TachographBondState): void {
    for (const l of this.listeners) l.onBondStateChange?.(b);
  }

  private emitDetectedServices(): void {
    const snap = this.detectedServicesSnapshot ? { ...this.detectedServicesSnapshot } : null;
    for (const l of this.listeners) l.onDetectedServicesChange?.(snap);
  }

  private emitMtu(mtu: number | null): void {
    for (const l of this.listeners) l.onMtuNegotiated?.(mtu);
  }

  private emitTransportState(s: TachographTransportState): void {
    for (const l of this.listeners) l.onTransportStateChange?.(s);
  }
}

// Silencia unused en web.
void Platform;
