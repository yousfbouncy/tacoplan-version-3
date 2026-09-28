import { Platform } from "react-native";
import type {
  TachographActivity,
  TachographBondState,
  TachographConnectionState,
  TachographCreditsState,
  TachographDetectedServices,
  TachographFifoState,
  TachographScanDevice,
  TachographTransportState,
} from "./types";
import { buildSyntheticActivityChange } from "./tachographParser";
import type { TachographEvent } from "./types";
import { BluetoothScanner, type BluetoothScannerCallbacks } from "./BluetoothScanner";
import {
  TachographConnectionManager,
  type ConnectionHandle,
} from "./TachographConnectionManager";
import {
  TachographBleTransport,
  type TachographBleTransportCallbacks,
} from "./TachographBleTransport";
import { BLE_AVAILABLE } from "./bluetoothTransport";
import {
  bleDiagnostic,
  pushDiagnosticNote,
  extractRawErrorFields,
  loadBleManagerSingleton,
  friendlyBleError,
} from "./bleHardwareDiagnostic";
import type { BleHardwareDiagnostic } from "./bleHardwareDiagnostic";

// =====================================================================
// BLE HARDWARE DIAGNOSTIC + SINGLETON — RE-EXPORTS
// =====================================================================
// Estos símbolos se extrajeron a un archivo separado para eliminar un
// TDZ (Temporal Dead Zone) de inicialización circular:
//
//   BluetoothScanner / TachographBleTransport / TachographConnectionManager
//   └──→ importan bleDiagnostic + helpers
//
//   tachographBluetoothService.ts (ESTE ARCHIVO)
//   └──→ new BluetoothScanner() [top-level, ANTES de evaluar exports]
//
// Al dejar los símbolos en este archivo, Scanner/ConnMgr/Transport
// accedían a `bleDiagnostic` antes de que su `const ... = { ... }`
// fuera evaluado → "Cannot access 'bleDiagnostic' before initialization".
//
// Solución canónica: extraerlos a un archivo SIN dependencias hacia
// Scanner / ConnMgr / Transport, y RE-EXPORTARLOS desde aquí por
// compatibilidad (orquestador / context / UI siguen importando de
// tachographBluetoothService).
// =====================================================================
export {
  bleDiagnostic,
  pushDiagnosticNote,
  extractRawErrorFields,
  loadBleManagerSingleton,
  friendlyBleError,
} from "./bleHardwareDiagnostic";
export type { BleHardwareDiagnostic } from "./bleHardwareDiagnostic";

// =====================================================================
// TachographBluetoothService - FACHADA (FASE 15)
// ==================================================
// Arquitectura de capas (desde la más baja a la más alta):
//
//   1. BleManager singleton          (react-native-ble-plx, 1 instancia)
//   2. BluetoothScanner              → scan REAL sin filtros, dedup+update, 60s
//   3. TachographConnectionManager   → connect/discover/bond/MTU, 2 retries GATT133
//   4. TachographBleTransport        → FIFO/Credits/INDICATIONS/flow control
//   5. [FALTA] ITSProtocol           → TODO ITS-SPEC: comandos binarios
//   6. [FALTA] Parser real           → TODO ITS-SPEC: interpretar FIFO frames
//   7. TachographService             → orquestador + integración jornada
//   8. tacografo.tsx UI              → presentar al usuario
//
// ESTE ARCHIVO DEJA DE HACER:
//   ❌ NO filtra más dispositivos por "parece Smart 2" (antes return si no)
//   ❌ NO tiene BleManager duplicado
//   ❌ NO tiene timeout 12s / 10s
//   ❌ NO inventar comandos ITS
//   ❌ NO data falsa
//
// ESTE ARCHIVO HACE AHORA:
//   ✅ Encapsula Scanner + ConnectionManager + Transport
//   ✅ Mantiene 1 BleManager singleton (loadBleManagerSingleton export arriba)
//   ✅ Re-exporta BleHardwareDiagnostic + extract/friendly errors
//   ✅ Expone startScan REAL (sin UUIDs ni nombre)
//   ✅ Expone connect() que pasa por ConnectionManager (orden correcto)
//   ✅ Expone transport init
//   ✅ TODO ITS-SPEC explícito en comentarios
// =====================================================================

// Capas internas de esta fachada:
const scanner = new BluetoothScanner();
const connectionManager = new TachographConnectionManager();
const transport = new TachographBleTransport();

let currentHandle: ConnectionHandle | null = null;

// =========================================================
// Interfaces capa BLE hacia tachographService orquestador
// =========================================================
export interface TachographBleScanCallbacks {
  onDeviceFound: (device: TachographScanDevice) => void;
  onDeviceUpdated?: (device: TachographScanDevice) => void;
  onScanError?: (error: Error) => void;
  onScanStopped?: (reason: "timeout" | "manual" | "error" | "bluetooth_off") => void;
}

export interface TachographBleConnectionCallbacks {
  onStateChange?: (state: TachographConnectionState) => void;
  onBondStateChange?: (bond: TachographBondState) => void;
  onDetectedServices?: (detected: TachographDetectedServices) => void;
  onMtuNegotiated?: (mtu: number) => void;
  onTransportStateChange?: (state: TachographTransportState) => void;
  onFifoStateChange?: (svc: "download" | "diagnostic", state: TachographFifoState) => void;
  onCreditsStateChange?: (svc: "download" | "diagnostic", state: TachographCreditsState) => void;
  onCreditsChanged?: (svc: "download" | "diagnostic", available: number, consumed: number) => void;
  onFifoData?: (service: "download" | "diagnostic", bytes: Uint8Array) => void;
  onError?: (error: Error) => void;
}

export class TachographBluetoothService {
  private lastActivity: TachographActivity = "UNKNOWN";
  private lastActivityStartedAt: string | null = null;
  private callbacks: TachographBleConnectionCallbacks | null = null;

  constructor() {}

  isSupported(): boolean {
    return BLE_AVAILABLE;
  }

  async ensureNativeBle(): Promise<boolean> {
    if (!BLE_AVAILABLE) return false;
    const { manager } = await loadBleManagerSingleton();
    return !!manager;
  }

  async requestPermissions(): Promise<{ ok: boolean; reason?: string }> {
    if (!BLE_AVAILABLE) return { ok: false, reason: "EXPO_GO_AND_WEB_UNSUPPORTED" };
    const { manager, unsupportedReason } = await loadBleManagerSingleton();
    if (!manager) {
      if (unsupportedReason === "BLE_MODULE_IMPORT_FAILED" || unsupportedReason === "BLE_UNSUPPORTED_PLATFORM") {
        return { ok: false, reason: "EXPO_GO_AND_WEB_UNSUPPORTED" };
      }
      return { ok: false, reason: unsupportedReason };
    }
    try {
      const state = await (manager as any).state();
      if (state === "Unauthorized") return { ok: false, reason: "PERMISSION_DENIED" };
      if (state === "PoweredOff") return { ok: false, reason: "BLUETOOTH_OFF" };
      if (state === "Unsupported") return { ok: false, reason: "BLE_UNSUPPORTED" };
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: friendlyBleError(e, "comprobar Bluetooth") };
    }
  }

  // ====================================================
  // SCAN REAL (FASE 3) - SIN FILTROS. 60s timeout seguridad.
  // ====================================================
  async startScan(callbacks: TachographBleScanCallbacks): Promise<void> {
    if (!BLE_AVAILABLE) {
      callbacks.onScanError?.(new Error("BLE_UNSUPPORTED"));
      callbacks.onScanStopped?.("error");
      return;
    }
    const scanCb: BluetoothScannerCallbacks = {
      onDeviceAdded: callbacks.onDeviceFound,
      onDeviceUpdated: (d) => callbacks.onDeviceUpdated?.(d),
      onError: (e) => {
        const friendly = new Error(friendlyBleError(e, "escanear BLE"));
        callbacks.onScanError?.(friendly);
      },
      onStopped: (reason) => callbacks.onScanStopped?.(reason),
    };
    await scanner.start(scanCb);
  }

  stopScan(): void {
    scanner.stop();
  }

  isScanning(): boolean {
    return scanner.isScanning();
  }

  // ====================================================
  // CONNECT → DISCOVER → BOND → TRANSPORT (FASE 17)
  // ====================================================
  async connect(identifier: string, callbacks: TachographBleConnectionCallbacks): Promise<void> {
    this.callbacks = callbacks;
    if (!BLE_AVAILABLE) {
      callbacks.onStateChange?.("unsupported");
      callbacks.onError?.(new Error("BLE_UNSUPPORTED"));
      return;
    }
    // FASE 17: Antes de conectar, detener scan.
    this.stopScan();
    callbacks.onStateChange?.("connecting");
    try {
      const handle = await connectionManager.connect(identifier, {
        onStateChange: (s) => {
          // Mapear estados ConnectionManager → connectionState global.
          if (s === "connecting" || s === "discovering" || s === "error" || s === "disconnected" || s === "connected") {
            callbacks.onStateChange?.(s);
          } else if (s === "bonding") {
            callbacks.onStateChange?.("bonding");
          } else if (s === "bonded") {
            callbacks.onStateChange?.("bonded");
          }
        },
        onBondStateChange: (bond) => {
          callbacks.onBondStateChange?.(bond);
        },
        onDetectedServices: (detected) => {
          callbacks.onDetectedServices?.(detected);
        },
        onMtuNegotiated: (mtu) => {
          callbacks.onMtuNegotiated?.(mtu);
        },
        onError: (e) => callbacks.onError?.(e),
      });
      currentHandle = handle;

      // Transport init (FIFO + Credits INDICATIONS, flow control).
      callbacks.onStateChange?.("transport_init");
      const transportCb: TachographBleTransportCallbacks = {
        onStateChange: (st) => callbacks.onTransportStateChange?.(st),
        onFifoStateChange: (svc, fs) => callbacks.onFifoStateChange?.(svc, fs),
        onCreditsStateChange: (svc, cs) => callbacks.onCreditsStateChange?.(svc, cs),
        onCreditsChanged: (svc, avail, cons) => callbacks.onCreditsChanged?.(svc, avail, cons),
        onFifoData: (svc, bytes) => callbacks.onFifoData?.(svc, bytes),
        onError: (e) => callbacks.onError?.(e),
      };
      await transport.init(handle, transportCb);
      callbacks.onStateChange?.("transport_ready");
      callbacks.onStateChange?.("connected");
    } catch (e) {
      currentHandle = null;
      const msg = e instanceof Error ? e.message : String(e);
      callbacks.onStateChange?.("error");
      callbacks.onError?.(new Error(friendlyBleError(msg, "conectar al tacógrafo")));
    }
  }

  async disconnect(): Promise<void> {
    transport.stop();
    await connectionManager.disconnect();
    currentHandle = null;
    this.callbacks?.onStateChange?.("disconnected");
  }

  /**
   * Devuelve el estado interno del scanner / connection manager / transport.
   * Solo para diagnóstico.
   */
  getInternalSnapshot() {
    return {
      scanning: scanner.isScanning(),
      foundDevices: scanner.getDevices().length,
      activeDeviceId: connectionManager.getActiveDeviceId(),
      creditsDownload: {
        available: transport.getCreditsAvailable("download"),
        consumed: transport.getCreditsConsumed("download"),
      },
      creditsDiagnostic: {
        available: transport.getCreditsAvailable("diagnostic"),
        consumed: transport.getCreditsConsumed("diagnostic"),
      },
    };
  }

  // =====================================================================
  // Submit activity change (no usado hasta que el parser esté listo).
  // =====================================================================
  submitActivityChange(params: {
    nextActivity: TachographActivity;
    source?: "tachograph_ble" | "manual";
    durationMin?: number;
    sessionId?: string;
    jornadaId?: string;
    timestamp?: string;
  }): TachographEvent | null {
    if (params.nextActivity === this.lastActivity) return null;
    const ts = params.timestamp || new Date().toISOString();
    const ev = buildSyntheticActivityChange({
      previous: this.lastActivity === "UNKNOWN" ? null : this.lastActivity,
      next: params.nextActivity,
      timestamp: ts,
      timestampSource: "phone_clock",
      source: params.source || "tachograph_ble",
      durationMin: params.durationMin,
      sessionId: params.sessionId,
      jornadaId: params.jornadaId,
      qualityScore: params.source === "manual" ? 50 : 80,
    });
    if (ev) {
      this.lastActivity = params.nextActivity;
      this.lastActivityStartedAt = ts;
    }
    return ev;
  }

  getLastActivity(): { activity: TachographActivity; startedAt: string | null } {
    return { activity: this.lastActivity, startedAt: this.lastActivityStartedAt };
  }

  resetActivityTracking(): void {
    this.lastActivity = "UNKNOWN";
    this.lastActivityStartedAt = null;
  }
}

// Silencia unused warnings en web si Platform no está.
void Platform;
