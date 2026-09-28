import { Platform } from "react-native";
import type {
  TachographCreditsState,
  TachographFifoState,
  TachographTransportState,
} from "./types";
import { TACHOGRAPH_UUIDS } from "./types";
import type { ConnectionHandle } from "./TachographConnectionManager";
import {
  loadBleManagerSingleton,
  pushDiagnosticNote as _pushDiag,
  friendlyBleError,
} from "./bleHardwareDiagnostic";

// =====================================================================
// TachographBleTransport (CAPA 3 FASE 15)
// Responsabilidad ÚNICA:
//   - FIFO (Download + Diagnostics)
//   - Credits flow control (Download + Diagnostics)
//   - INDICATIONS subscription
//   - MTU fragmentation/reassembly cuando proceda (FASE 14)
//
// =====================================================================
// MUY IMPORTANTE FASE 12 + 16 (NO INVENTAR PROTOCOLO):
//   * Esta capa NO genera comandos ITS binarios.
//   * NO implementa framing Download FIFO request.
//   * NO implementa DIDs (Driver Working State, Odometer, Speed, Country...)
//   * Solo habilita el transporte (fifo/credits) y hace FLOW CONTROL de créditos.
//   * Todo lo demás se marca como TODO ITS-SPEC y queda para cuando tengamos
//     la especificación binaria validada con hardware real.
// =====================================================================
// FLOW CONTROL CREDITS (FASE 12):
//   - creditsAvailable: créditos que nos ha concedido el tacógrafo (podemos escribir).
//   - creditsConsumed:  cuántos hemos gastado escribiendo FIFO.
//   - Si creditsAvailable <= 0 -> BLOQUEAR envíos.
//   - Si recibimos 0xFF (255) o -1 en Credits characteristic -> FLOW_CLOSED (FASE 12).
// =====================================================================

export interface TachographBleTransportCallbacks {
  onStateChange: (state: TachographTransportState) => void;
  onFifoStateChange: (svc: "download" | "diagnostic", state: TachographFifoState) => void;
  onCreditsStateChange: (svc: "download" | "diagnostic", state: TachographCreditsState) => void;
  onCreditsChanged: (svc: "download" | "diagnostic", available: number, consumed: number) => void;
  onFifoData: (service: "download" | "diagnostic", bytes: Uint8Array) => void;
  onError: (err: Error) => void;
}

const CREDITS_FLOW_CLOSED_BYTE_VALUES = new Set([0xff, 255, -1]);

export class TachographBleTransport {
  private handle: ConnectionHandle | null = null;
  private subscriptions: Array<{ remove: () => void }> = [];
  private callbacks: TachographBleTransportCallbacks | null = null;

  private credits: Record<"download" | "diagnostic", { available: number | null; consumed: number }> = {
    download: { available: null, consumed: 0 },
    diagnostic: { available: null, consumed: 0 },
  };

  getCreditsAvailable(svc: "download" | "diagnostic"): number | null {
    return this.credits[svc].available;
  }
  getCreditsConsumed(svc: "download" | "diagnostic"): number {
    return this.credits[svc].consumed;
  }

  /**
   * Inicializar transporte: suscribirse a INDICATIONS de FIFO y Credits
   * de ambos servicios (Download + Diagnostics).
   * NO envía NINGÚN comando todavía. (FASE 13).
   */
  async init(
    handle: ConnectionHandle,
    callbacks: TachographBleTransportCallbacks,
  ): Promise<void> {
    this.handle = handle;
    this.callbacks = callbacks;
    this.subscriptions.forEach((s) => s.remove());
    this.subscriptions = [];
    this.credits = {
      download: { available: null, consumed: 0 },
      diagnostic: { available: null, consumed: 0 },
    };
    callbacks.onStateChange("INITIALIZING");
    callbacks.onFifoStateChange("download", "PREPARING");
    callbacks.onFifoStateChange("diagnostic", "PREPARING");
    callbacks.onCreditsStateChange("download", "PREPARING");
    callbacks.onCreditsStateChange("diagnostic", "PREPARING");
    _pushDiag("ITS_TRANSPORT_INIT start");

    const { manager } = await loadBleManagerSingleton();
    if (!manager) throw new Error("BLE_MANAGER_NOT_READY");
    const devId = handle.deviceId;

    const monitors: Array<{
      svcRole: "download" | "diagnostic";
      role: "fifo" | "credits";
      svcUuid: string;
      charUuid: string;
      charFound: boolean;
    }> = [];

    const downloadChar = handle.services[TACHOGRAPH_UUIDS.downloadService.toLowerCase()];
    const diagnosticChar = handle.services[TACHOGRAPH_UUIDS.diagnosticService.toLowerCase()];

    // DOWNLOAD FIFO + CREDITS
    monitors.push({
      svcRole: "download",
      role: "fifo",
      svcUuid: TACHOGRAPH_UUIDS.downloadService,
      charUuid: TACHOGRAPH_UUIDS.downloadFifo,
      charFound: !!downloadChar?.fifoCharacteristic,
    });
    monitors.push({
      svcRole: "download",
      role: "credits",
      svcUuid: TACHOGRAPH_UUIDS.downloadService,
      charUuid: TACHOGRAPH_UUIDS.downloadCredits,
      charFound: !!downloadChar?.creditsCharacteristic,
    });
    // DIAGNOSTIC FIFO + CREDITS
    monitors.push({
      svcRole: "diagnostic",
      role: "fifo",
      svcUuid: TACHOGRAPH_UUIDS.diagnosticService,
      charUuid: TACHOGRAPH_UUIDS.diagnosticFifo,
      charFound: !!diagnosticChar?.fifoCharacteristic,
    });
    monitors.push({
      svcRole: "diagnostic",
      role: "credits",
      svcUuid: TACHOGRAPH_UUIDS.diagnosticService,
      charUuid: TACHOGRAPH_UUIDS.diagnosticCredits,
      charFound: !!diagnosticChar?.creditsCharacteristic,
    });

    for (const m of monitors) {
      if (!m.charFound) {
        callbacks[
          m.role === "fifo" ? "onFifoStateChange" : "onCreditsStateChange"
        ](m.svcRole, "NOT_AVAILABLE");
        continue;
      }
      try {
        const sub = (handle.rawDevice as any).monitorCharacteristicForService(
          m.svcUuid,
          m.charUuid,
          (err: any, characteristic: any) => {
            if (err) {
              const friendly = friendlyBleError(err, m.role === "fifo" ? "FIFO INDICATION" : "CREDITS INDICATION");
              _pushDiag(`ITS_${m.role.toUpperCase()}_MONITOR_ERROR: ${friendly}`);
              callbacks[
                m.role === "fifo" ? "onFifoStateChange" : "onCreditsStateChange"
              ](m.svcRole, "ERROR");
              this.callbacks?.onError(new Error(friendly));
              return;
            }
            if (!characteristic?.value) return;
            const bytes = _base64ToUint8(String(characteristic.value));
            if (m.role === "fifo") {
              this._log(
                "ITS_FIFO_RX",
                `svc=${m.svcRole} bytes=${bytes.length}`,
              );
              callbacks.onFifoStateChange(m.svcRole, "READY");
              callbacks.onFifoData(m.svcRole, bytes);
            } else {
              this._processCreditIndication(m.svcRole, bytes, callbacks);
            }
          },
        );
        if (sub && typeof sub.remove === "function") {
          this.subscriptions.push(sub as any);
        }
        if (m.role === "fifo") {
          callbacks.onFifoStateChange(m.svcRole, "READY");
          this._log("ITS_FIFO_MONITOR_READY", `svc=${m.svcRole}`);
          _pushDiag(`ITS_FIFO_MONITOR_READY svc=${m.svcRole}`);
        } else {
          callbacks.onCreditsStateChange(m.svcRole, "READY");
          this._log("ITS_CREDITS_MONITOR_READY", `svc=${m.svcRole}`);
          _pushDiag(`ITS_CREDITS_MONITOR_READY svc=${m.svcRole}`);
        }
      } catch (e) {
        const friendly = friendlyBleError(e, `subscribe ${m.svcRole}/${m.role}`);
        this.callbacks?.onError(new Error(friendly));
      }
    }
    callbacks.onStateChange("READY");
    _pushDiag("ITS_TRANSPORT_INIT ready");
  }

  /**
   * Escribir créditos de vuelta al tacógrafo (FASE 12).
   * NO se inventa nada: el valor que escribamos debe venir de la capa
   * ITSProtocol superior. Aceptamos sólo 1 byte (0..254).
   * Si value = 0xFF, significa FLOW CLOSED según especificación (FASE 12).
   */
  async sendCreditValue(
    svc: "download" | "diagnostic",
    creditByteValue: number,
  ): Promise<void> {
    if (!this.handle || !this.callbacks) throw new Error("TRANSPORT_NOT_INITIALIZED");
    const svcUuid = svc === "download" ? TACHOGRAPH_UUIDS.downloadService : TACHOGRAPH_UUIDS.diagnosticService;
    const creditsUuid = svc === "download" ? TACHOGRAPH_UUIDS.downloadCredits : TACHOGRAPH_UUIDS.diagnosticCredits;
    const { manager } = await loadBleManagerSingleton();
    if (!manager) throw new Error("BLE_MANAGER_NOT_READY");
    if (typeof creditByteValue !== "number") throw new Error("INVALID_CREDIT_VALUE");
    const clamped = Math.max(0, Math.min(255, Math.floor(creditByteValue)));
    // TODO ITS-SPEC: la escritura de Credits debe ser con WRITE sin respuesta
    // o con WRITE con respuesta según GATT properties reales. Ahora escribimos
    // con WithResponse por seguridad y marcamos TODO para validar.
    const bytes = new Uint8Array([clamped]);
    const b64 = btoa(String.fromCharCode.apply(null, Array.from(bytes) as any));
    await (manager as any).writeCharacteristicWithResponseForDevice(
      this.handle.deviceId,
      svcUuid,
      creditsUuid,
      b64,
    );
    this.credits[svc].consumed += 1;
    this._log("ITS_CREDIT_TX", `svc=${svc} byte=${clamped} consumed=${this.credits[svc].consumed}`);
    this.callbacks.onCreditsChanged(svc, this.credits[svc].available ?? 0, this.credits[svc].consumed);
  }

  /**
   * Enviar un frame ya formado al FIFO (Download o Diagnostic).
   * FASE 12: Bloquea si creditsAvailable <= 0.
   * FASE 14: Usa handle.mtuNegotiated para fragmentar si fuera necesario.
   *
   * IMPORTANTE FASE 16: Esta función solo transmite bytes sin interpretar.
   * NO debes llamarla desde UI ni desde fuera de ITSProtocol sin tener el
   * frame binario validado con la especificación.
   */
  async sendFifoFrame(
    svc: "download" | "diagnostic",
    bytes: Uint8Array,
  ): Promise<void> {
    if (!this.handle || !this.callbacks) throw new Error("TRANSPORT_NOT_INITIALIZED");
    const creditsAvail = this.credits[svc].available;
    if (creditsAvail === null) {
      throw new Error("CREDITS_NOT_RECEIVED_YET");
    }
    if (CREDITS_FLOW_CLOSED_BYTE_VALUES.has(creditsAvail)) {
      throw new Error("CREDITS_FLOW_CLOSED");
    }
    if (creditsAvail <= 0) {
      throw new Error("NO_CREDITS_AVAILABLE");
    }
    const svcUuid = svc === "download" ? TACHOGRAPH_UUIDS.downloadService : TACHOGRAPH_UUIDS.diagnosticService;
    const fifoUuid = svc === "download" ? TACHOGRAPH_UUIDS.downloadFifo : TACHOGRAPH_UUIDS.diagnosticFifo;
    const { manager } = await loadBleManagerSingleton();
    if (!manager) throw new Error("BLE_MANAGER_NOT_READY");
    const chunks = _splitIntoMtuChunks(bytes, this.handle.mtuNegotiated ?? 23);
    let sentChunks = 0;
    for (const chunk of chunks) {
      const b64 = btoa(String.fromCharCode.apply(null, Array.from(chunk) as any));
      await (manager as any).writeCharacteristicWithResponseForDevice(
        this.handle.deviceId,
        svcUuid,
        fifoUuid,
        b64,
      );
      sentChunks += 1;
    }
    this.credits[svc].consumed += 1;
    this.credits[svc].available = creditsAvail - 1;
    this._log(
      "ITS_FIFO_TX",
      `svc=${svc} bytes=${bytes.length} chunks=${sentChunks} creditsAfter=${this.credits[svc].available}`,
    );
    this.callbacks.onCreditsChanged(svc, this.credits[svc].available, this.credits[svc].consumed);
  }

  stop(): void {
    this.subscriptions.forEach((s) => {
      try {
        s.remove();
      } catch {}
    });
    this.subscriptions = [];
    this.callbacks?.onStateChange("NOT_STARTED");
    this.handle = null;
    this.callbacks = null;
  }

  // =====================================================================
  // Internals
  // =====================================================================

  private _processCreditIndication(
    svc: "download" | "diagnostic",
    bytes: Uint8Array,
    callbacks: TachographBleTransportCallbacks,
  ) {
    if (!bytes || bytes.length === 0) return;
    const firstByte = bytes[0];
    this._log("ITS_CREDIT_RX", `svc=${svc} byte=${firstByte} len=${bytes.length}`);
    _pushDiag(`ITS_CREDIT_RX svc=${svc} byte=${firstByte}`);
    if (bytes.length >= 1 && CREDITS_FLOW_CLOSED_BYTE_VALUES.has(firstByte)) {
      this.credits[svc].available = firstByte;
      callbacks.onCreditsStateChange(svc, "FLOW_CLOSED");
    } else if (bytes.length >= 1) {
      this.credits[svc].available = firstByte;
      callbacks.onCreditsStateChange(svc, "READY");
    }
    callbacks.onCreditsChanged(svc, this.credits[svc].available ?? 0, this.credits[svc].consumed);
  }

  private _log(tag: string, message: string) {
    const line = `[TACHO-BLE-TRANSPORT] ${tag} ${message}`;
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

function _base64ToUint8(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(b64, "base64"));
  }
  const str = typeof atob === "function" ? atob(b64) : "";
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i);
  return out;
}

/**
 * Fragmenta bytes en chunks de tamaño <= (MTU - 3). ATT_MTU = 23 por defecto,
 * así que payload GATT máximo = 20. Si tenemos MTU negociado 247 → 244 bytes/chunk.
 * TODO ITS-SPEC: Smart Tacho 2 framing Download FIFO requiere reensamblaje
 * según la especificación oficial; por ahora solo troceamos sin interpretar.
 */
function _splitIntoMtuChunks(bytes: Uint8Array, mtuNegotiated: number): Uint8Array[] {
  const maxPerChunk = Math.max(20, (mtuNegotiated ?? 23) - 3);
  if (bytes.length <= maxPerChunk) return [bytes];
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += maxPerChunk) {
    chunks.push(bytes.slice(offset, offset + maxPerChunk));
  }
  return chunks;
}

// Silencia unused warnings en web.
void Platform;
