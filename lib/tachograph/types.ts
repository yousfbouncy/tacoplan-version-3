export type TachographConnectionState =
  | "idle"
  | "scanning"
  | "connecting"
  | "discovering"
  | "bonding"
  | "bonded"
  | "connected"
  | "transport_init"
  | "transport_ready"
  | "disconnected"
  | "error"
  | "unsupported";

export type TachographBondState =
  | "NOT_BONDED"
  | "BONDING"
  | "BONDED"
  | "UNKNOWN";

export type TachographItsConsentState =
  | "NOT_REQUIRED"
  | "REQUIRED"
  | "GRANTED"
  | "DENIED"
  | "UNKNOWN";

export type TachographFifoState =
  | "NOT_AVAILABLE"
  | "PREPARING"
  | "READY"
  | "ERROR";

export type TachographCreditsState =
  | "NOT_AVAILABLE"
  | "PREPARING"
  | "READY"
  | "FLOW_CLOSED"
  | "ERROR";

export type TachographTransportState =
  | "NOT_STARTED"
  | "INITIALIZING"
  | "READY"
  | "ERROR";

export type TachographActivity =
  | "DRIVING"
  | "WORK"
  | "AVAILABLE"
  | "REST"
  | "UNKNOWN";

export type TachographTimestampSource =
  | "device_clock"
  | "phone_clock"
  | "gnss"
  | "estimated";

export type TachographDataSource =
  | "tachograph_ble"
  | "tachograph_history"
  | "phone_gps"
  | "manual";

export type TachographEventType =
  | "activity_change"
  | "country_entry"
  | "country_exit"
  | "speed"
  | "odometer"
  | "driver_slot"
  | "connection"
  | "custom";

export type TachographModel =
  | "DTCO_41"
  | "SE5000_SMART2"
  | "ACTIA_SMART2"
  | "EFKON_SMART2"
  | "UNKNOWN";

export interface TachographDevice {
  id: string;
  identifier: string;
  name?: string | null;
  model?: TachographModel | null;
  manufacturer?: string | null;
  serialNumber?: string | null;
  pairedAt: string;
  lastSeenAt?: string | null;
  trusted: boolean;
  autoReconnect: boolean;
  rssi?: number | null;
  meta?: Record<string, unknown> | null;
}

export interface TachographScanDevice {
  identifier: string;
  name?: string | null;
  localName?: string | null;
  rssi?: number | null;
  txPowerLevel?: number | null;
  serviceUuids?: string[];
  manufacturerData?: Uint8Array | null;
  manufacturerDataHex?: string | null;
  isSmartTacho2?: boolean | null;
  advertisesItsGatt?: boolean | null;
  mtu?: number | null;
  firstSeenAt?: string;
  lastSeenAt?: string;
}

export interface TachographDetectedServices {
  downloadService: boolean;
  diagnosticService: boolean;
  downloadFifo: boolean;
  downloadCredits: boolean;
  diagnosticFifo: boolean;
  diagnosticCredits: boolean;
  allServicesFound: boolean;
  rawServiceUuids: string[];
}

export interface TachographGattService {
  uuid: string;
  fifoUuid: string;
  creditsUuid: string;
}

export interface TachographLiveData {
  currentActivity: TachographActivity;
  currentActivityStartedAt?: string | null;
  continuousDrivingMin: number | null;
  drivingTodayMin: number | null;
  drivingThisWeekMin: number | null;
  drivingLastPlusThisWeekMin: number | null;
  remainingContinuousMin: number | null;
  accumulatedPauseMin: number | null;
  speedKmh?: number | null;
  distanceKm?: number | null;
  odometerKm?: number | null;
  country?: string | null;
  lastUpdatedAt?: string | null;
  dataSource: TachographDataSource;
  bondState?: TachographBondState;
  itsConsentState?: TachographItsConsentState;
  fifoState?: TachographFifoState;
  creditsState?: TachographCreditsState;
  transportState?: TachographTransportState;
  detectedServices?: TachographDetectedServices | null;
  connectedDeviceId?: string | null;
  mtuNegotiated?: number | null;
  creditsAvailable?: number | null;
  creditsConsumed?: number | null;
}

export interface TachographEvent {
  id?: string | null;
  eventUid: string;
  jornadaId?: string | null;
  sessionId?: string | null;
  timestamp: string;
  timestampSource: TachographTimestampSource;
  eventType: TachographEventType;
  previousActivity?: TachographActivity | null;
  newActivity?: TachographActivity | null;
  previousCountry?: string | null;
  newCountry?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  speedKmh?: number | null;
  distanceM?: number | null;
  odometerKm?: number | null;
  durationMin?: number | null;
  source: TachographDataSource;
  rawData?: Record<string, unknown> | null;
  qualityScore?: number | null;
  deduplicationKey?: string | null;
  createdAt?: string | null;
}

export interface TachographSession {
  id: string;
  deviceId?: string | null;
  jornadaId?: string | null;
  startedAt: string;
  endedAt?: string | null;
  connectionState: TachographConnectionState;
  disconnectionsCount: number;
  rssiMin?: number | null;
  rssiMax?: number | null;
  servicesDetected?: Record<string, unknown> | null;
  firmwareVersion?: string | null;
}

export interface TachographDailySummary {
  id?: string | null;
  summaryDate: string;
  jornadaId?: string | null;
  firstActivityAt?: string | null;
  lastActivityAt?: string | null;
  drivingMin: number;
  workMin: number;
  availableMin: number;
  restMin: number;
  pauseMin: number;
  unknownMin: number;
  countries: string[];
  countryEntriesCount: number;
  distanceKm?: number | null;
  disconnectionsCount: number;
  dataSource: TachographDataSource;
  dataQualityScore?: number | null;
}

export interface TachographState {
  connectionState: TachographConnectionState;
  error?: string | null;
  device?: TachographDevice | null;
  session?: TachographSession | null;
  live: TachographLiveData;
}

export const TACHOGRAPH_UUIDS = {
  downloadService: "eef90782-55dd-4388-b80b-695aba7a69b5",
  downloadFifo: "29d3a479-1592-47df-80a4-afa742d369bb",
  downloadCredits: "db9c4128-bff3-41fe-a306-fb6f9a8aeb2d",
  diagnosticService: "fa213def-aef4-475c-bcea-0a8d69073efc",
  diagnosticFifo: "e413960c-75ba-4ca9-8a67-99bc052a1b13",
  diagnosticCredits: "e168d1a6-304f-42b4-ab96-4cd1d4efebd9",
} as const;

export function emptyLiveData(): TachographLiveData {
  return {
    currentActivity: "UNKNOWN",
    currentActivityStartedAt: null,
    continuousDrivingMin: null,
    drivingTodayMin: null,
    drivingThisWeekMin: null,
    drivingLastPlusThisWeekMin: null,
    remainingContinuousMin: null,
    accumulatedPauseMin: null,
    speedKmh: null,
    distanceKm: null,
    odometerKm: null,
    country: null,
    lastUpdatedAt: null,
    dataSource: "manual",
    bondState: "UNKNOWN",
    itsConsentState: "UNKNOWN",
    fifoState: "NOT_AVAILABLE",
    creditsState: "NOT_AVAILABLE",
    transportState: "NOT_STARTED",
    detectedServices: null,
    connectedDeviceId: null,
    mtuNegotiated: null,
    creditsAvailable: null,
    creditsConsumed: null,
  };
}

export function activityLabel(a: TachographActivity): string {
  switch (a) {
    case "DRIVING":
      return "Conducción";
    case "WORK":
      return "Otros trabajos";
    case "AVAILABLE":
      return "Disponibilidad";
    case "REST":
      return "Descanso/pausa";
    default:
      return "Desconocido";
  }
}
