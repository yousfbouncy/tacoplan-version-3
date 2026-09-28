import { Platform } from "react-native";
import type { TachographScanDevice } from "./types";
import {
  loadBleManagerSingleton,
  bleDiagnostic,
  pushDiagnosticNote as _pushDiag,
  friendlyBleError,
} from "./bleHardwareDiagnostic";
import type { BleHardwareDiagnostic } from "./bleHardwareDiagnostic";
import { TACHOGRAPH_UUIDS } from "./types";

// =====================================================================
// BluetoothScanner (CAPA 1 FASE 15)
// Responsabilidad ÚNICA: escanear dispositivos BLE REALES.
// REGLAS EXPLÍCITAS (NO ROMPERLAS):
//   1. NO existe NINGÚN filtro en startDeviceScan (null, null).
//   2. allowDuplicates: true (los re-anuncios actualizan RSSI/name).
//   3. NO descartar device.name === null ni localName null.
//   4. NO introducir dispositivos demo/mock/hardcodeados.
//   5. Sólo añadir/actualizar dispositivos DENTRO del callback
//      real de BleManager.startDeviceScan(error, device).
//   6. Timeout seguridad máximo 60 segundos (FASE 4).
//   7. Deduplicar exclusivamente por device.id (FASE 5).
//      Cuando vuelve a aparecer: actualizar RSSI/name/localName/
//      serviceUuids/manufacturerData/txPowerLevel/first/lastSeenAt.
//   8. 1 único BleManager singleton compartido.
// =====================================================================

export interface BluetoothScannerCallbacks {
  onDeviceAdded: (device: TachographScanDevice) => void;
  onDeviceUpdated: (device: TachographScanDevice) => void;
  onError: (error: Error) => void;
  onStopped: (reason: "timeout" | "manual" | "error" | "bluetooth_off") => void;
}

export class BluetoothScanner {
  private scanning = false;
  private stopFn: (() => void) | null = null;
  private safetyTimer: ReturnType<typeof setTimeout> | null = null;
  private devicesByMac = new Map<string, TachographScanDevice>();
  private stateSub: any = null;
  private static SAFETY_TIMEOUT_MS = 60_000;

  isScanning(): boolean {
    return this.scanning;
  }

  getDevices(): TachographScanDevice[] {
    return Array.from(this.devicesByMac.values());
  }

  /**
   * Inicia escaneo BLE REAL (sin UUIDs, sin filtros).
   * El timeout máximo de seguridad son 60 segundos (FASE 4).
   */
  async start(callbacks: BluetoothScannerCallbacks): Promise<void> {
    // FASE 6: Precheck PoweredOn y singleton.
    const { manager, unsupportedReason } = await loadBleManagerSingleton();
    if (!manager) {
      callbacks.onError(new Error(unsupportedReason || "BLE_UNSUPPORTED"));
      return;
    }
    let state: string = "Unknown";
    try {
      state = (await (manager as any).state()) as string;
    } catch {}
    if (state === "PoweredOff") {
      callbacks.onError(new Error("BLUETOOTH_OFF"));
      this._log("BLE_STATE", `state=${state}`);
      callbacks.onStopped("bluetooth_off");
      return;
    }
    if (state === "Unauthorized") {
      callbacks.onError(new Error("BLE_UNAUTHORIZED"));
      callbacks.onStopped("error");
      return;
    }
    if (state === "Unsupported") {
      callbacks.onError(new Error("BLE_UNSUPPORTED"));
      callbacks.onStopped("error");
      return;
    }

    // FASE 2: Limpiar lista de scan PREVIO (NO introducir nada antes).
    this.devicesByMac.clear();
    this.stop();
    this.scanning = true;
    this._log("BLE_SCAN_START", `state=${state}`);
    bleDiagnostic.lastCheck = new Date().toISOString();
    _pushDiag(`BLE_SCAN_START state=${state}`);

    let scanSub: any = null;
    let didStopOuter = false;
    const wantedLow = new Set(
      Object.values(TACHOGRAPH_UUIDS).map((u) => String(u).toLowerCase().replace(/-/g, "")),
    );

    const handleScanned = (scannedDevice: any) => {
      if (!scannedDevice) return;
      const macRaw = String(
        (scannedDevice.id || scannedDevice.localId || scannedDevice.identifier || "") as string,
      ).trim();
      if (!macRaw) return;
      const id = macRaw;
      const serviceUUIDs = (scannedDevice.serviceUUIDs || scannedDevice.serviceUuids || []) as string[];
      const nameRaw = (scannedDevice.name || null) as string | null;
      const localNameRaw = (scannedDevice.localName || null) as string | null;
      const rssiRaw = scannedDevice.rssi;
      const txPowerRaw = scannedDevice.txPowerLevel ?? scannedDevice.txPower ?? null;
      const mfgData = (scannedDevice.manufacturerData as Uint8Array | undefined) || null;
      const mfgHex = mfgData && mfgData.length > 0
        ? Array.from(mfgData).map((b) => b.toString(16).padStart(2, "0")).join("")
        : null;
      const advertisesIts = serviceUUIDs.some((u) =>
        wantedLow.has(String(u).toLowerCase().replace(/-/g, "")),
      );
      this._log("BLE_SCAN_DEVICE_RAW", [
        `deviceId=${id}`,
        `name=${JSON.stringify(nameRaw)}`,
        `localName=${JSON.stringify(localNameRaw)}`,
        `rssi=${String(rssiRaw ?? "")}`,
        `txPower=${String(txPowerRaw ?? "")}`,
        `uuids=${serviceUUIDs.length}`,
        advertisesIts ? `advertisesIts=1` : "",
      ].filter(Boolean).join(" "));

      const now = new Date().toISOString();
      const prev = this.devicesByMac.get(id);
      const merged: TachographScanDevice = {
        identifier: id,
        name: nameRaw ?? prev?.name ?? null,
        localName: localNameRaw ?? prev?.localName ?? null,
        rssi: Number.isFinite(rssiRaw) ? (rssiRaw as number) : (prev?.rssi ?? null),
        txPowerLevel: Number.isFinite(txPowerRaw) ? (txPowerRaw as number) : (prev?.txPowerLevel ?? null),
        serviceUuids: Array.from(new Set([...(prev?.serviceUuids || []), ...serviceUUIDs])),
        manufacturerData: mfgData || prev?.manufacturerData || null,
        manufacturerDataHex: mfgHex || prev?.manufacturerDataHex || null,
        isSmartTacho2: advertisesIts || (prev?.isSmartTacho2 ?? null),
        advertisesItsGatt: advertisesIts || (prev?.advertisesItsGatt ?? null),
        firstSeenAt: prev?.firstSeenAt || now,
        lastSeenAt: now,
      };
      this.devicesByMac.set(id, merged);
      if (!prev) {
        this._log("BLE_SCAN_DEVICE_ADDED", `deviceId=${id} name=${JSON.stringify(merged.name || merged.localName || null)}`);
        callbacks.onDeviceAdded(merged);
      } else {
        this._log("BLE_SCAN_DEVICE_UPDATED", `deviceId=${id} rssi=${merged.rssi ?? ""}`);
        callbacks.onDeviceUpdated(merged);
      }
    };

    const start = () => {
      if (didStopOuter) return;
      try {
        scanSub = (manager as any).startDeviceScan(
          // FASE 3: SIN FILTROS DE UUID, SIN FILTROS DE NADA.
          null,
          {
            // FASE 5: allowDuplicates: true (Android RSSI actualiza en cada ADV)
            allowDuplicates: true,
            legacyScan: true,
          },
          (error: any, scannedDevice: any) => {
            if (error) {
              const friendly = friendlyBleError(error, "escanear BLE");
              this._log("BLE_SCAN_ERROR", friendly);
              _pushDiag(`BLE_SCAN_ERROR: ${friendly}`);
              callbacks.onError(new Error(friendly));
              this.stopInternal("error", callbacks);
              return;
            }
            handleScanned(scannedDevice);
          },
        );
      } catch (e) {
        const friendly = friendlyBleError(e, "escanear BLE");
        _pushDiag(`BLE_SCAN_START_FAILED: ${friendly}`);
        callbacks.onError(new Error(friendly));
        this.stopInternal("error", callbacks);
      }
    };

    // Suscripción state changes: si Bluetooth se apaga en mitad del scan → stop.
    try {
      this.stateSub = (manager as any).onStateChange((s: string) => {
        bleDiagnostic.managerState = s as any;
        if (s === "PoweredOff" && this.scanning) {
          this.stopInternal("bluetooth_off", callbacks);
        }
        if (s === "PoweredOn" && this.scanning && !scanSub) {
          start();
        }
      }, true);
    } catch {}

    start();

    // FASE 4: timeout seguridad 60s (configurable por SAFETY_TIMEOUT_MS).
    this.safetyTimer = setTimeout(() => {
      if (!this.scanning) return;
      _pushDiag("BLE_SCAN_STOP reason=timeout 60s");
      this._log("BLE_SCAN_STOP", "timeout_60s");
      this.stopInternal("timeout", callbacks);
    }, BluetoothScanner.SAFETY_TIMEOUT_MS);

    this.stopFn = () => {
      didStopOuter = true;
      try {
        scanSub?.remove?.();
      } catch {}
      scanSub = null;
      try {
        this.stateSub?.remove?.();
      } catch {}
      this.stateSub = null;
      try {
        (manager as any).stopDeviceScan?.();
      } catch {}
    };
  }

  stop(): void {
    if (!this.scanning) return;
    this.stopInternalFnOnly();
  }

  private stopInternalFnOnly(): void {
    if (this.safetyTimer) {
      clearTimeout(this.safetyTimer);
      this.safetyTimer = null;
    }
    try {
      this.stopFn?.();
    } catch {}
    this.stopFn = null;
    this.scanning = false;
  }

  private stopInternal(
    reason: "timeout" | "manual" | "error" | "bluetooth_off",
    callbacks: BluetoothScannerCallbacks,
  ): void {
    this.stopInternalFnOnly();
    this._log("BLE_SCAN_STOP", reason);
    _pushDiag(`BLE_SCAN_STOP reason=${reason} devices=${this.devicesByMac.size}`);
    try {
      callbacks.onStopped(reason);
    } catch {}
  }

  // =====================================================================
  // Diagnóstico / logs estructurados FASE 19
  // =====================================================================
  private _log(tag: string, message: string) {
    const line = `[TACHO-BLE-SCANNER] ${tag} ${message}`;
    // eslint-disable-next-line no-console
    console.log(line);
    void line;
  }
}

// Silencia unused warnings en web.
void Platform;
void bleDiagnostic;
