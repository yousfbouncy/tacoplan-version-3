import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth-context";
import {
  TachographService,
  type TachographCloseJornadaHint,
  type TachographServiceListeners,
} from "./tachographService";
import type {
  TachographBondState,
  TachographConnectionState,
  TachographCreditsState,
  TachographDetectedServices,
  TachographDevice,
  TachographEvent,
  TachographFifoState,
  TachographLiveData,
  TachographTransportState,
} from "./types";
import { emptyLiveData } from "./types";

interface TachographContextValue {
  service: TachographService | null;
  connectionState: TachographConnectionState;
  device: TachographDevice | null;
  live: TachographLiveData;
  eventsForJornada: TachographEvent[];
  bondState: TachographBondState;
  detectedServices: TachographDetectedServices | null;
  mtuNegotiated: number | null;
  transportState: TachographTransportState;
  fifoState: TachographFifoState;
  creditsState: TachographCreditsState;
  creditsAvailable: number | null;
  creditsConsumed: number;
  closeJornadaHint(jornada: any): Promise<TachographCloseJornadaHint>;
  bindActiveJornada(jornada: any | null): void;
  supported: boolean;
  demoMode: boolean;
  enableDemoMode(): Promise<void>;
  startAutoFetch(): void;
  stopAutoFetch(): void;
  isAutoFetchRunning(): boolean;
  fetchTachoFifoOnce(): Promise<{ fetchedCount: number; bytesTotal: number }>;
}

const TachographContext = createContext<TachographContextValue | null>(null);

export function TachographProvider(props: { children: React.ReactNode }) {
  const { user } = useAuth();
  const serviceRef = useRef<TachographService | null>(null);
  if (serviceRef.current == null) {
    try {
      serviceRef.current = new TachographService();
    } catch {
      serviceRef.current = null;
    }
  }
  const service = serviceRef.current;
  const supported = !!service;
  const [connectionState, setConnectionState] = useState<TachographConnectionState>(
    supported ? "idle" : "unsupported",
  );
  const [device, setDevice] = useState<TachographDevice | null>(null);
  const [live, setLive] = useState<TachographLiveData>(emptyLiveData());
  const [eventsForJornada, setEventsForJornada] = useState<TachographEvent[]>([]);
  const [demoMode, setDemoMode] = useState<boolean>(service?.isDemoMode?.() ?? false);
  const [bondState, setBondState] = useState<TachographBondState>("UNKNOWN");
  const [detectedServices, setDetectedServices] = useState<TachographDetectedServices | null>(null);
  const [mtuNegotiated, setMtuNegotiated] = useState<number | null>(null);
  const [transportState, setTransportState] = useState<TachographTransportState>("NOT_STARTED");
  const [fifoState, setFifoState] = useState<TachographFifoState>("NOT_AVAILABLE");
  const [creditsState, setCreditsState] = useState<TachographCreditsState>("NOT_AVAILABLE");
  const [creditsAvailable, setCreditsAvailable] = useState<number | null>(null);
  const [creditsConsumed, setCreditsConsumed] = useState<number>(0);

  useEffect(() => {
    if (!service) return;
    service.setUserId(user?.id || null);
    const listenerId = "ctx_main";
    const listener: TachographServiceListeners = {
      onConnectionChange: setConnectionState,
      onDeviceChange: setDevice,
      onLiveDataChange: (l) => setLive({ ...l }),
      onEventsChange: (evs) => setEventsForJornada([...evs]),
      onBondStateChange: (b) => setBondState(b),
      onDetectedServicesChange: (d) => setDetectedServices(d ? { ...d } : null),
      onMtuNegotiated: (m) => setMtuNegotiated(m),
      onTransportStateChange: (s) => setTransportState(s),
      onFifoStateChange: (_svc, st) => setFifoState(st),
      onCreditsStateChange: (_svc, st) => setCreditsState(st),
      onCreditsChanged: (_svc, avail, cons) => {
        setCreditsAvailable(avail);
        setCreditsConsumed(cons);
      },
    };
    service.addListener(listenerId, listener);
    const tryAuto = async () => {
      try {
        if (!service.getConnectionState().startsWith("idle")) return;
        await service.tryAutoReconnect();
      } catch {}
    };
    tryAuto();
    setDemoMode(!!service.isDemoMode?.());
    return () => {
      service.removeListener(listenerId);
    };
  }, [service, user?.id]);

  const value = useMemo<TachographContextValue>(() => {
    return {
      service,
      connectionState,
      device,
      live,
      eventsForJornada,
      bondState,
      detectedServices: detectedServices ? { ...detectedServices } : null,
      mtuNegotiated,
      transportState,
      fifoState,
      creditsState,
      creditsAvailable,
      creditsConsumed,
      async closeJornadaHint(j: any): Promise<TachographCloseJornadaHint> {
        if (!service) {
          return {
            dataSource: "manual",
          };
        }
        return service.closeJornadaHint(j);
      },
      bindActiveJornada(j: any | null) {
        if (!service) return;
        service.bindActiveJornada(j);
      },
      supported: !!service,
      demoMode,
      async enableDemoMode() {
        if (!service) return;
        await service.enableDemoMode();
        setDemoMode(true);
      },
      startAutoFetch() {
        service?.startAutoFetch?.();
      },
      stopAutoFetch() {
        service?.stopAutoFetch?.();
      },
      isAutoFetchRunning() {
        return !!service?.isAutoFetchRunning?.();
      },
      async fetchTachoFifoOnce() {
        if (!service) return { fetchedCount: 0, bytesTotal: 0 };
        return service.fetchTachoFifoOnce();
      },
    };
  }, [service, connectionState, device, live, eventsForJornada, demoMode, bondState, detectedServices, mtuNegotiated, transportState, fifoState, creditsState, creditsAvailable, creditsConsumed]);

  return (
    <TachographContext.Provider value={value}>{props.children}</TachographContext.Provider>
  );
}

export function useTachograph(): TachographContextValue {
  const ctx = useContext(TachographContext);
  if (!ctx) {
    return {
      service: null,
      connectionState: "unsupported",
      device: null,
      live: emptyLiveData(),
      eventsForJornada: [],
      bondState: "UNKNOWN",
      detectedServices: null,
      mtuNegotiated: null,
      transportState: "NOT_STARTED",
      fifoState: "NOT_AVAILABLE",
      creditsState: "NOT_AVAILABLE",
      creditsAvailable: null,
      creditsConsumed: 0,
      async closeJornadaHint() {
        return { dataSource: "manual" as const };
      },
      bindActiveJornada() {},
      supported: false,
      demoMode: false,
      async enableDemoMode() {},
      startAutoFetch() {},
      stopAutoFetch() {},
      isAutoFetchRunning() {
        return false;
      },
      async fetchTachoFifoOnce() {
        return { fetchedCount: 0, bytesTotal: 0 };
      },
    };
  }
  return ctx;
}
