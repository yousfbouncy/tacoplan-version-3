import { Platform } from "react-native";
import type {
  TachographConnectionState,
  TachographDevice,
  TachographGattService,
  TachographLiveData,
  TachographModel,
  TachographScanDevice,
} from "./types";
import { TACHOGRAPH_UUIDS, emptyLiveData } from "./types";

export interface GattCharacteristics {
  fifoCharacteristic: any;
  creditsCharacteristic: any;
}

export interface BleTransportHandles {
  manager?: any;
  deviceId?: string;
  services: Record<string, GattCharacteristics>;
}

let nativeBleVerified: boolean | null = null;

export async function verifyNativeBleOnce(): Promise<boolean> {
  if (nativeBleVerified != null) return nativeBleVerified;
  if (Platform.OS === "web") {
    nativeBleVerified = false;
    return false;
  }
  nativeBleVerified = true;
  return true;
}

export const BLE_AVAILABLE: boolean = Platform.OS !== "web";

function lowerUuid(u?: string | null): string | null {
  return u ? u.toLowerCase().replace(/-/g, "") : null;
}

const KNOWN_TACHO_NAME_KEYWORDS = [
  "smart tacho", "smarttacho", "tachograph", "tacografo", "tacógrafo",
  "dtco", "digital tachograph",
  "stoneridge", "se5000", "se-5000",
  "vdo", "continental", "dtc", "ontario",
  "actia", "iat-1", "iat1", "smarct",
  "efkon",
];

const KNOWN_TACHO_MANUFACTURER_PREFIXES = [
  // Stoneridge / VDO / Actia / Efkon / Continental a veces ponen el nombre en
  // manufacturerData. Esto es heurístico: si empieza por estos bytes/nombres,
  // lo aceptamos sin tener que descubrir servicios GATT primero.
];

/**
 * Detecta si un dispositivo anuncia algo que parece un tacógrafo Smart 2.
 * NO es exhaustivo (sin la conexión GATT no podemos 100% asegurar) pero es
 * suficientemente amplio para que los 4 fabricantes principales aparezcan
 * YA en el listado sin tener que escanear todos los UUIDs del mundo.
 */
export function looksLikeSmartTachograph2(
  uuids?: string[],
  name?: string | null,
  identifier?: string | null,
): boolean {
  const normalizedUuids = (uuids || []).map(lowerUuid).filter(Boolean) as string[];
  const want = [
    TACHOGRAPH_UUIDS.downloadService,
    TACHOGRAPH_UUIDS.diagnosticService,
  ].map(lowerUuid).filter(Boolean) as string[];
  if (want.some((w) => normalizedUuids.includes(w))) return true;

  const haystack = [
    (name || "").toLowerCase(),
    (identifier || "").toLowerCase(),
  ].join("|");
  if (KNOWN_TACHO_NAME_KEYWORDS.some((k) => haystack.includes(k))) return true;

  return false;
}

export function detectTachoModel(name?: string | null, uuids?: string[]): TachographModel {
  const n = (name || "").toLowerCase();
  if (n.includes("dtco") || n.includes("continental") || n.includes("vdo") || n.includes("dtc")) return "DTCO_41";
  if (n.includes("se5000") || n.includes("se-5000") || n.includes("stoneridge")) return "SE5000_SMART2";
  if (n.includes("actia") || n.includes("iat-1") || n.includes("iat1") || n.includes("smarct")) return "ACTIA_SMART2";
  if (n.includes("efkon")) return "EFKON_SMART2";
  if (looksLikeSmartTachograph2(uuids, name)) return "UNKNOWN";
  return "UNKNOWN";
}

export function emptyTransportHandles(): BleTransportHandles {
  return {
    manager: undefined,
    deviceId: undefined,
    services: {},
  };
}

export function computeDownloadService(): TachographGattService {
  return {
    uuid: TACHOGRAPH_UUIDS.downloadService,
    fifoUuid: TACHOGRAPH_UUIDS.downloadFifo,
    creditsUuid: TACHOGRAPH_UUIDS.downloadCredits,
  };
}

export function computeDiagnosticService(): TachographGattService {
  return {
    uuid: TACHOGRAPH_UUIDS.diagnosticService,
    fifoUuid: TACHOGRAPH_UUIDS.diagnosticFifo,
    creditsUuid: TACHOGRAPH_UUIDS.diagnosticCredits,
  };
}

export interface TachographBleScanCallbacks {
  onDeviceFound: (device: TachographScanDevice) => void;
  onScanError?: (error: Error) => void;
  onScanStopped?: () => void;
}

export interface TachographBleConnectionCallbacks {
  onStateChange?: (state: TachographConnectionState) => void;
  onFifoData?: (serviceUuid: string, bytes: Uint8Array) => void;
  onRssi?: (rssi: number) => void;
  onError?: (error: Error) => void;
}

export function deviceFromScan(scan: TachographScanDevice, trusted = false): TachographDevice {
  return {
    id: "",
    identifier: scan.identifier,
    name: scan.name || null,
    model: detectTachoModel(scan.name, scan.serviceUuids) || null,
    manufacturer: null,
    serialNumber: null,
    pairedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    trusted,
    autoReconnect: trusted,
    rssi: scan.rssi ?? null,
    meta: {
      serviceUuids: scan.serviceUuids || [],
      isSmartTacho2: scan.isSmartTacho2,
    },
  };
}

export function emptyLiveDataIfNeeded(live?: Partial<TachographLiveData> | null): TachographLiveData {
  const base = emptyLiveData();
  if (!live) return base;
  return { ...base, ...live } as TachographLiveData;
}

export function buildEventUid(prefix: string, timestampIso: string, extra: string): string {
  return `${prefix}:${timestampIso}:${extra}`;
}
