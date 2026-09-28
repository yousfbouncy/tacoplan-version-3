import { Platform } from "react-native";
import type {
  TachographBondState,
  TachographDetectedServices,
} from "./types";
import { TACHOGRAPH_UUIDS } from "./types";
import {
  loadBleManagerSingleton,
  bleDiagnostic,
  pushDiagnosticNote as _pushDiag,
  extractRawErrorFields,
  friendlyBleError,
} from "./bleHardwareDiagnostic";

// =====================================================================
// TachographConnectionManager (CAPA 2 FASE 15)
// Responsabilidad ÚNICA:
//   - conectar
//   - desconectar
//   - discoverAllServicesAndCharacteristics() AWAITED
//   - bonding / createBond si la plataforma lo expone
//   - requestMTU
//   - reconnection controlada
//   - NO INVENTAR NADA
//   - 1 ÚNICO BleManager singleton (no creamos ningún manager nuevo)
//
// REGLAS EXPLÍCITAS:
//   1. Orden estricto FASE 17:
//      await connect → await discover → bonding → (transport por otra capa)
//   2. Antes de conectar: detener scan, no conexiones paralelas.
//   3. Cancelar conexión zombie del mismo deviceId antes 2º retry.
//   4. Retry máximo controlado: 2 (FASE 17).
//   5. El MISMO device.id para TODA la sesión (FASE 8).
//   6. NO hacer reconnect infinito.
//   7. Registrar bond states: NOT_BONDED / BONDING / BONDED (FASE 10).
//      Si react-native-ble-plx no expone createBond → dejar NOT_BONDED y
//      TODO ITS-SPEC: módulo nativo específico Android si fuera necesario.
//   8. Clasificación REAL post-discovery (FASE 9):
//      TACHOGRAPH_DOWNLOAD_SERVICE_FOUND / DIAGNOSTICS_SERVICE_FOUND
//      SÓLO si están en characteristicsForService().
// =====================================================================

export interface ConnectionHandle {
  deviceId: string;
  bondState: TachographBondState;
  detectedServices: TachographDetectedServices;
  mtuNegotiated: number | null;
  isSmartTacho2Real: boolean;
  rawDevice: any;
  services: Record<
    string,
    {
      fifoCharacteristic?: any;
      creditsCharacteristic?: any;
    }
  >;
}

export interface ConnectionManagerCallbacks {
  onStateChange: (
    state:
      | "connecting"
      | "discovering"
      | "bonding"
      | "bonded"
      | "connected"
      | "disconnected"
      | "error",
  ) => void;
  onBondStateChange: (bondState: TachographBondState) => void;
  onDetectedServices: (detected: TachographDetectedServices) => void;
  onMtuNegotiated: (mtu: number) => void;
  onError: (err: Error) => void;
}

export class TachographConnectionManager {
  private currentDeviceId: string | null = null;
  private connectedRaw: any = null;
  private disconnectSub: any = null;

  getActiveDeviceId(): string | null {
    return this.currentDeviceId;
  }

  isConnected(deviceId?: string): boolean {
    if (deviceId) return this.currentDeviceId === deviceId && !!this.connectedRaw;
    return !!this.connectedRaw;
  }

  /**
   * Conectar a deviceId REAL (sacado del callback startDeviceScan),
   * 2 reintentos para GATT 133 (FASE 8/17).
   */
  async connect(
    deviceId: string,
    callbacks: ConnectionManagerCallbacks,
  ): Promise<ConnectionHandle> {
    if (!deviceId) {
      throw new Error("DEVICE_ID_REQUIRED");
    }
    // FASE 17: evitar conexiones paralelas: si ya tenemos otra conexión,
    // desconectar primero limpiamente.
    if (this.currentDeviceId && this.currentDeviceId !== deviceId) {
      try {
        await this.disconnect();
      } catch {}
    }
    this.currentDeviceId = deviceId;
    const { manager, unsupportedReason } = await loadBleManagerSingleton();
    if (!manager) {
      callbacks.onStateChange("error");
      throw new Error(unsupportedReason || "BLE_UNSUPPORTED");
    }
    try {
      const state = await (manager as any).state();
      if (state !== "PoweredOn") {
        callbacks.onStateChange("error");
        throw new Error(`BLUETOOTH_NOT_POWERED_ON (state=${state})`);
      }
    } catch (e) {
      callbacks.onStateChange("error");
      throw e;
    }
    callbacks.onStateChange("connecting");
    this._log(
      "BLE_CONNECT_START",
      `deviceId=${deviceId}`,
    );
    _pushDiag(`BLE_CONNECT_START deviceId=${deviceId}`);

    const attempts: Array<{ autoConnect: boolean; requestConnectionPriority: string | null }> = [
      { autoConnect: false, requestConnectionPriority: "Balanced" },
      { autoConnect: false, requestConnectionPriority: "High" },
    ];
    let lastErr: any = null;
    let rawDevice: any = null;

    for (let attempt = 0; attempt < attempts.length; attempt++) {
      const a = attempts[attempt];
      try {
        if (attempt > 0) {
          // FASE 17: antes de 2º intento cancelar conexión zombie GATT.
          try {
            await (manager as any).cancelDeviceConnection(deviceId).catch(() => {});
          } catch {}
          await new Promise((r) => setTimeout(r, 700));
        }
        rawDevice = await (manager as any).connectToDevice(deviceId, {
          timeout: 18000,
          autoConnect: a.autoConnect,
        });
        if (!rawDevice) throw new Error("CONNECT_RETURNED_NULL_DEVICE");
        this._log("BLE_CONNECT_OK", `deviceId=${deviceId} attempt=${attempt + 1}/${attempts.length} autoConnect=${a.autoConnect}`);
        _pushDiag(`BLE_CONNECT_OK attempt ${attempt + 1}`);

        // FASE 9 + 17: PASO 2 - discoverAllServicesAndCharacteristics AWAIT.
        callbacks.onStateChange("discovering");
        this._log("BLE_DISCOVERY_START", `deviceId=${deviceId}`);
        try {
          await rawDevice.discoverAllServicesAndCharacteristics(12000);
        } catch {
          await rawDevice.discoverAllServicesAndCharacteristics();
        }
        this._log("BLE_DISCOVERY_OK", `deviceId=${deviceId}`);

        // PASO 3: MTU 247, guardar valor negociado (FASE 14).
        let mtuNegotiated: number | null = null;
        try {
          const mgr = (manager as any);
          if (typeof mgr.requestMTUForDevice === "function") {
            try {
              const resp = await mgr.requestMTUForDevice(deviceId, 247);
              if (resp && typeof resp.mtu === "number") mtuNegotiated = Number(resp.mtu);
            } catch (e) {
              this._log("MTU_REQUEST_FAILED", String(e).slice(0, 120));
            }
          } else if (typeof (rawDevice as any).requestMTU === "function") {
            try {
              const resp = await (rawDevice as any).requestMTU(247);
              if (resp && typeof resp.mtu === "number") mtuNegotiated = Number(resp.mtu);
            } catch (e) {
              this._log("MTU_REQUEST_FAILED", String(e).slice(0, 120));
            }
          }
        } catch {}
        if (mtuNegotiated != null) {
          this._log("MTU_NEGOTIATED", `mtu=${mtuNegotiated}`);
          callbacks.onMtuNegotiated(mtuNegotiated);
        } else {
          mtuNegotiated = 23; // default ATT_MTU
          callbacks.onMtuNegotiated(mtuNegotiated);
        }

        // PASO 4: connection priority a High para throughput FIFO.
        try {
          if (a.requestConnectionPriority && typeof (manager as any).requestConnectionPriorityForDevice === "function") {
            await (manager as any)
              .requestConnectionPriorityForDevice(deviceId, a.requestConnectionPriority)
              .catch(() => {});
          }
        } catch {}

        // PASO 5: Clasificación REAL post-discovery (FASE 9).
        const detected = await this._detectRealItsServices(rawDevice, deviceId);
        callbacks.onDetectedServices(detected);
        this._log("BLE_SERVICES_FOUND", `download=${detected.downloadService} diagnostic=${detected.diagnosticService} fifo=${detected.downloadFifo} credits=${detected.downloadCredits}`);
        if (detected.downloadService) _pushDiag("TACHOGRAPH_DOWNLOAD_SERVICE_FOUND");
        if (detected.diagnosticService) _pushDiag("TACHOGRAPH_DIAGNOSTICS_SERVICE_FOUND");

        // PASO 6: Bonding (FASE 10) - MEJOR ESFUERZO.
        let bondState: TachographBondState = "NOT_BONDED";
        try {
          bondState = await this._createBondBestEffort(rawDevice, deviceId, callbacks);
        } catch (e) {
          this._log("BOND_BEST_EFFORT_FAILED", String(e).slice(0, 120));
        }
        callbacks.onBondStateChange(bondState);
        this._log("BOND_STATE", `${bondState}`);
        _pushDiag(`BOND_STATE=${bondState}`);

        // Subscripción disconnect.
        try {
          this.disconnectSub = rawDevice.onDisconnected(() => {
            callbacks.onStateChange("disconnected");
            this._log("BLE_DISCONNECTED", `deviceId=${deviceId}`);
            _pushDiag(`BLE_DISCONNECTED deviceId=${deviceId}`);
            this.currentDeviceId = null;
            this.connectedRaw = null;
            this.disconnectSub = null;
          });
        } catch {}

        this.connectedRaw = rawDevice;
        callbacks.onStateChange("connected");

        // Construir handle de services listos para capa TRANSPORTE.
        const servicesHandle: ConnectionHandle["services"] = {};
        for (const svc of [
          { uuid: TACHOGRAPH_UUIDS.downloadService, fifo: TACHOGRAPH_UUIDS.downloadFifo, credits: TACHOGRAPH_UUIDS.downloadCredits },
          { uuid: TACHOGRAPH_UUIDS.diagnosticService, fifo: TACHOGRAPH_UUIDS.diagnosticFifo, credits: TACHOGRAPH_UUIDS.diagnosticCredits },
        ]) {
          const svcUuid = svc.uuid.toLowerCase();
          const entry: ConnectionHandle["services"][string] = {};
          try {
            const chars = (await rawDevice.characteristicsForService(svc.uuid)) as any[];
            for (const c of chars || []) {
              const cuuid = (c.uuid as string).toLowerCase();
              if (cuuid === svc.fifo.toLowerCase()) entry.fifoCharacteristic = c;
              if (cuuid === svc.credits.toLowerCase()) entry.creditsCharacteristic = c;
            }
          } catch {}
          servicesHandle[svcUuid] = entry;
        }

        return {
          deviceId,
          bondState,
          detectedServices: detected,
          mtuNegotiated,
          isSmartTacho2Real: detected.allServicesFound,
          rawDevice,
          services: servicesHandle,
        };
      } catch (e) {
        lastErr = e;
        const raw = extractRawErrorFields(e);
        const isGatt133 =
          raw.androidErrorCode === 133 ||
          String(raw.reason || "").toLowerCase().includes("status 133") ||
          String(raw.message || "").toLowerCase().includes("133");
        if (isGatt133) this._log("ANDROID_GATT_ERROR", `deviceId=${deviceId} status=133 attempt=${attempt + 1}`);
        _pushDiag(`BLE_CONNECT_ATTEMPT_${attempt + 1}_FAILED: ${raw.message} reason=${String(raw.reason ?? "")} ec=${String(raw.errorCode ?? "")} android=${String(raw.androidErrorCode ?? "")}${isGatt133 ? " → GATT 133" : ""}`);
        // eslint-disable-next-line no-console
        console.warn(`[TACHO-BLE] connect attempt ${attempt + 1} failed`, raw);
        if (attempt < attempts.length - 1 && isGatt133) continue;
        if (attempt < attempts.length - 1) continue;
      }
    }
    callbacks.onStateChange("error");
    const msg = friendlyBleError(lastErr, "conectar al tacógrafo");
    throw new Error(msg);
  }

  async disconnect(): Promise<void> {
    const deviceId = this.currentDeviceId;
    try {
      this.disconnectSub?.remove?.();
    } catch {}
    this.disconnectSub = null;
    this.connectedRaw = null;
    this.currentDeviceId = null;
    if (!deviceId) return;
    try {
      const { manager } = await loadBleManagerSingleton();
      if (manager) {
        await (manager as any).cancelDeviceConnection(deviceId).catch(() => {});
      }
    } catch {}
  }

  // =====================================================================
  // Internals
  // =====================================================================

  private async _detectRealItsServices(
    rawDevice: any,
    deviceId: string,
  ): Promise<TachographDetectedServices> {
    let downloadService = false;
    let diagnosticService = false;
    let downloadFifo = false;
    let downloadCredits = false;
    let diagnosticFifo = false;
    let diagnosticCredits = false;
    const rawUuids: string[] = [];
    try {
      const servicesList = (await rawDevice.services()) as any[];
      for (const s of servicesList || []) {
        const sUuid = String(s.uuid || "").toLowerCase().replace(/-/g, "");
        rawUuids.push(s.uuid || "");
        try {
          const chars = (await rawDevice.characteristicsForService(s.uuid)) as any[];
          for (const c of chars || []) {
            const cUuid = String(c.uuid || "").toLowerCase().replace(/-/g, "");
            if (sUuid === TACHOGRAPH_UUIDS.downloadService.toLowerCase().replace(/-/g, "")) {
              downloadService = true;
              if (cUuid === TACHOGRAPH_UUIDS.downloadFifo.toLowerCase().replace(/-/g, "")) downloadFifo = true;
              if (cUuid === TACHOGRAPH_UUIDS.downloadCredits.toLowerCase().replace(/-/g, "")) downloadCredits = true;
            }
            if (sUuid === TACHOGRAPH_UUIDS.diagnosticService.toLowerCase().replace(/-/g, "")) {
              diagnosticService = true;
              if (cUuid === TACHOGRAPH_UUIDS.diagnosticFifo.toLowerCase().replace(/-/g, "")) diagnosticFifo = true;
              if (cUuid === TACHOGRAPH_UUIDS.diagnosticCredits.toLowerCase().replace(/-/g, "")) diagnosticCredits = true;
            }
          }
        } catch {}
      }
    } catch {}
    const allServicesFound =
      downloadService && diagnosticService && downloadFifo && downloadCredits && diagnosticFifo && diagnosticCredits;
    const _ = deviceId;
    return {
      downloadService,
      diagnosticService,
      downloadFifo,
      downloadCredits,
      diagnosticFifo,
      diagnosticCredits,
      allServicesFound,
      rawServiceUuids: rawUuids,
    };
  }

  /**
   * FASE 10: createBond() si react-native-ble-plx / Android lo expone
   * por reflection en BleManager o raw device. Si no: devuelve NOT_BONDED
   * y dejamos que el sistema operativo lo gestione por sí solo (al acceder
   * a characteristics protegidas saltará diálogo del SO) y devolvemos
   * TODO explícito.
   */
  private async _createBondBestEffort(
    _rawDevice: any,
    deviceId: string,
    callbacks: ConnectionManagerCallbacks,
  ): Promise<TachographBondState> {
    this._log("BOND_START", `deviceId=${deviceId}`);
    callbacks.onStateChange("bonding");
    callbacks.onBondStateChange("BONDING");
    const { manager } = await loadBleManagerSingleton();
    const candidates: Array<() => Promise<any>> = [];
    if (manager && typeof (manager as any).createBond === "function") {
      candidates.push(async () => await (manager as any).createBond(deviceId));
    }
    if (manager && typeof (manager as any).bondDevice === "function") {
      candidates.push(async () => await (manager as any).bondDevice(deviceId));
    }
    if (_rawDevice && typeof (_rawDevice as any).createBond === "function") {
      candidates.push(async () => await (_rawDevice as any).createBond());
    }
    let bondOk = false;
    let lastAttempt: any = null;
    for (const fn of candidates) {
      try {
        lastAttempt = await fn();
        bondOk = true;
        break;
      } catch (e) {
        lastAttempt = e;
      }
    }
    // TODO ITS-SPEC: createBond no está expuesto por react-native-ble-plx en
    // versiones anteriores. Si el usuario experimenta que al intentar acceder
    // a FIFO salta "insufficient authentication" SIN haber emparejado antes,
    // se necesita un módulo nativo Android específico que lance:
    //   val bm = getSystemService(BLUETOOTH_SERVICE) as BluetoothManager
    //   val dev = adapter.getRemoteDevice(deviceId)
    //   dev.createBond()
    // y un BroadcastReceiver para ACTION_BOND_STATE_CHANGED -> BOND_BONDED.
    // Hasta que no se valide con tacógrafo real, NO implementamos módulo
    // nativo para no inventar APIs. Si bondOk es false, Android gestionará
    // automáticamente el bonding al leer características protegidas.
    void lastAttempt;
    if (bondOk) {
      callbacks.onBondStateChange("BONDED");
      return "BONDED";
    }
    // Fallback: "desconocido", el SO lo resolverá.
    callbacks.onBondStateChange("UNKNOWN");
    return "UNKNOWN";
  }

  private _log(tag: string, message: string) {
    const line = `[TACHO-BLE-CONN] ${tag} ${message}`;
    // eslint-disable-next-line no-console
    console.log(line);
    void line;
  }
}

// Silencia unused warnings en web.
void Platform;
void bleDiagnostic;
