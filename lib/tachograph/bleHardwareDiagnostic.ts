import { Platform } from "react-native";
import { BLE_AVAILABLE } from "./bluetoothTransport";

// =====================================================================
// bleHardwareDiagnostic — ARCHIVO SIN DEPENDENCIAS INTERNAS BLE
// =====================================================================
// Este archivo se separó de tachographBluetoothService.ts para eliminar
// un TDZ (Temporal Dead Zone) de inicialización circular:
//
//   Antes:
//     tachographBluetoothService.ts (L14) → importa BluetoothScanner.ts
//     BluetoothScanner.ts (L3-9)          → importa bleDiagnostic desde el servicio
//     tachographBluetoothService.ts (L87) → new BluetoothScanner() [TOP LEVEL]
//     tachographBluetoothService.ts (L78) → export const bleDiagnostic = {...}
//
//   Resultado: scanner se ejecuta ANTES que la evaluación de L78, por
//   tanto `bleDiagnostic` aún no está inicializada →
//   "Cannot access 'bleDiagnostic' before initialization".
//
//   Ahora:
//     Este archivo NO importa Scanner/ConnMgr/Transport → ciclo roto.
//     tachographBluetoothService.ts → re-exporta este módulo.
// =====================================================================

export interface BleHardwareDiagnostic {
  platform: string;
  bleAvailable: boolean;
  moduleImport: "ok" | "failed" | "pending";
  moduleImportReason?: string;
  singletonCtor: "ok" | "failed" | "pending";
  singletonCtorReason?: string;
  managerState?:
    | "Unknown"
    | "Resetting"
    | "Unsupported"
    | "Unauthorized"
    | "PoweredOff"
    | "PoweredOn";
  lastCheck?: string;
  requestPermissions?: { ok: boolean; reason?: string };
  lastScanError?: {
    rawMessage: string;
    reason?: any;
    errorCode?: any;
    attErrorCode?: any;
    iosErrorCode?: any;
    androidErrorCode?: any;
    stack?: string;
  };
  lastConnectError?: {
    rawMessage: string;
    reason?: any;
    errorCode?: any;
    attErrorCode?: any;
    iosErrorCode?: any;
    androidErrorCode?: any;
    stack?: string;
  };
  notes?: string[];
}

type BleManager = any;

let SINGLETON_BLE_MANAGER: BleManager | null = null;

export const bleDiagnostic: BleHardwareDiagnostic = {
  platform: typeof Platform !== "undefined" ? (Platform as any).OS : "unknown",
  bleAvailable: BLE_AVAILABLE,
  moduleImport: "pending",
  singletonCtor: "pending",
  notes: [],
};

export function pushDiagnosticNote(note: string): void {
  bleDiagnostic.notes = [...(bleDiagnostic.notes || []).slice(-15), note];
}

export function extractRawErrorFields(err: any) {
  const e: any = err && typeof err === "object" ? err : {};
  return {
    message:
      (err instanceof Error ? err.message : String(err)) ||
      String(e?.message ?? e?.errorMessage ?? ""),
    reason: e?.reason ?? e?.cause ?? null,
    errorCode: e?.errorCode ?? null,
    attErrorCode: e?.attErrorCode ?? null,
    iosErrorCode: e?.iosErrorCode ?? null,
    androidErrorCode: e?.androidErrorCode ?? null,
    stack: err instanceof Error ? err.stack : undefined,
  };
}

export async function loadBleManagerSingleton(): Promise<{
  manager: BleManager | null;
  unsupportedReason?: string;
}> {
  if (SINGLETON_BLE_MANAGER) return { manager: SINGLETON_BLE_MANAGER };
  if (!BLE_AVAILABLE) {
    bleDiagnostic.bleAvailable = false;
    bleDiagnostic.singletonCtor = "failed";
    bleDiagnostic.singletonCtorReason = "BLE_UNSUPPORTED_PLATFORM (web)";
    pushDiagnosticNote("Plataforma web / no soporta BLE nativo");
    return { manager: null, unsupportedReason: "BLE_UNSUPPORTED_PLATFORM" };
  }
  let BleManagerCtor: any = null;
  try {
    const plx = await import("react-native-ble-plx");
    BleManagerCtor = (plx as any).BleManager || (plx as any).default?.BleManager;
    bleDiagnostic.moduleImport = "ok";
    pushDiagnosticNote("Módulo react-native-ble-plx importado OK");
    console.log("[TACHO-BLE] BLE_MANAGER_READY module_import=ok");
  } catch (e) {
    bleDiagnostic.moduleImport = "failed";
    const raw = extractRawErrorFields(e);
    bleDiagnostic.moduleImportReason = `${raw.message} | reason=${String(
      raw.reason ?? "",
    )} errorCode=${String(raw.errorCode ?? "")}`;
    pushDiagnosticNote(
      "Fallo importar react-native-ble-plx: " + bleDiagnostic.moduleImportReason,
    );
    console.warn("[TACHO-BLE] loadBleManagerSingleton: import failed", raw);
    return { manager: null, unsupportedReason: "BLE_MODULE_IMPORT_FAILED" };
  }
  if (!BleManagerCtor) {
    bleDiagnostic.moduleImport = "failed";
    bleDiagnostic.moduleImportReason =
      "BleManager constructor not found in module export";
    pushDiagnosticNote(bleDiagnostic.moduleImportReason);
    return { manager: null, unsupportedReason: "BLE_MODULE_IMPORT_FAILED" };
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const m = new BleManagerCtor();
      SINGLETON_BLE_MANAGER = m;
      bleDiagnostic.singletonCtor = "ok";
      bleDiagnostic.lastCheck = new Date().toISOString();
      pushDiagnosticNote(`BleManager singleton creado OK (intento ${attempt})`);
      try {
        m.onStateChange((s: string) => {
          bleDiagnostic.managerState = s as any;
          console.log(`[TACHO-BLE] BLE_STATE state=${s}`);
        }, true);
      } catch {}
      try {
        bleDiagnostic.managerState = (await m.state()) as any;
        pushDiagnosticNote(`Manager state inicial: ${bleDiagnostic.managerState}`);
      } catch {}
      return { manager: m };
    } catch (e) {
      const raw = extractRawErrorFields(e);
      const msg = raw.message.toLowerCase();
      if (
        attempt === 1 &&
        (msg.includes("nativeemitter") ||
          msg.includes("null") ||
          msg.includes("destroyed"))
      ) {
        pushDiagnosticNote(
          `Ctor falló intento 1: ${raw.message} reason=${String(raw.reason ?? "")}`,
        );
        console.warn(
          `[TACHO-BLE] singleton ctor attempt #${attempt} failed (will retry)`,
          raw,
        );
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      bleDiagnostic.singletonCtor = "failed";
      bleDiagnostic.singletonCtorReason = `${raw.message} | reason=${String(
        raw.reason ?? "",
      )} errorCode=${String(raw.errorCode ?? "")} androidErr=${String(
        raw.androidErrorCode ?? "",
      )} iosErr=${String(raw.iosErrorCode ?? "")} att=${String(
        raw.attErrorCode ?? "",
      )}`;
      pushDiagnosticNote(
        `Fallo crear BleManager: ${bleDiagnostic.singletonCtorReason}`,
      );
      console.error(
        "[TACHO-BLE] loadBleManagerSingleton: singleton ctor FAILED",
        raw,
      );
      return {
        manager: null,
        unsupportedReason: raw.message || "BLE_CTOR_FAILED_UNKNOWN",
      };
    }
  }
  return { manager: null, unsupportedReason: "BLE_CTOR_FAILED_UNKNOWN" };
}

export function friendlyBleError(err: any, action = "operación BLE"): string {
  const raw = extractRawErrorFields(err);
  const msg = raw.message.toLowerCase();
  const structured = { action, ...raw };
  console.warn(`[TACHO-BLE] friendlyBleError (${action})`, structured);
  if (action.includes("escanear")) {
    bleDiagnostic.lastScanError = {
      rawMessage: raw.message,
      reason: raw.reason,
      errorCode: raw.errorCode,
      attErrorCode: raw.attErrorCode,
      iosErrorCode: raw.iosErrorCode,
      androidErrorCode: raw.androidErrorCode,
      stack: raw.stack,
    };
  } else if (action.includes("conectar")) {
    bleDiagnostic.lastConnectError = {
      rawMessage: raw.message,
      reason: raw.reason,
      errorCode: raw.errorCode,
      attErrorCode: raw.attErrorCode,
      iosErrorCode: raw.iosErrorCode,
      androidErrorCode: raw.androidErrorCode,
      stack: raw.stack,
    };
  }
  bleDiagnostic.lastCheck = new Date().toISOString();
  pushDiagnosticNote(
    `Error (${action}): ${raw.message} reason=${String(raw.reason ?? "")} ec=${String(
      raw.errorCode ?? "",
    )}`,
  );
  if (
    msg.includes("bluetoothle is disabled") ||
    msg.includes("bluetooth disabled") ||
    msg.includes("poweredoff") ||
    String(raw.reason ?? "").toLowerCase().includes("poweredoff") ||
    action.includes("BLUETOOTH_OFF")
  ) {
    return "Bluetooth apagado. Activa Bluetooth en los ajustes del móvil y vuelve a intentarlo.";
  }
  if (
    msg.includes("bluetooth unauthorized") ||
    msg.includes("permission") ||
    msg.includes("android.permission.bluetooth_scan") ||
    msg.includes("android.permission.bluetooth_connect") ||
    msg.includes("android.permission.access_fine_location") ||
    String(raw.reason ?? "").toLowerCase().includes("unauthorized") ||
    String(raw.errorCode ?? "") === "602" ||
    String(raw.androidErrorCode ?? "") === "602" ||
    action.includes("BLE_UNAUTHORIZED")
  ) {
    return "Permisos Bluetooth / Ubicación no concedidos. Entra en Ajustes → Apps → Tacoplan → Permisos y activa Bluetooth y Ubicación (cerca). Android 12+ requiere ambos para escanear BLE sin UUIDs predefinidos.";
  }
  if (msg.includes("blemanager was destroyed")) {
    return "Reinicia la app (kill proceso) y vuelve a entrar en Tacógrafo.";
  }
  if (msg.includes("disconnected") || msg.includes("133")) {
    return `No se pudo completar ${action}. Asegúrate de que el tacógrafo tiene Bluetooth activado, no está conectado a otro móvil, y está a menos de 2 metros.`;
  }
  if (
    msg.includes("unknown error occurred") ||
    msg.includes("check reason property")
  ) {
    if (raw.reason)
      return `Fallo en ${action} (reason: ${String(raw.reason)}). Revisa Bluetooth y permisos. Pulsa “Copiar diagnóstico” para ver el reason completo.`;
    return `Fallo en ${action}. Activa Bluetooth, revisa permisos, y si persiste pulsa “Copiar diagnóstico” y pégalo al desarrollador.`;
  }
  if (String(raw.reason ?? "").trim()) {
    return `Fallo en ${action} (reason: ${String(raw.reason)})  Código error=${String(raw.errorCode ?? "")} android=${String(raw.androidErrorCode ?? "")} ios=${String(raw.iosErrorCode ?? "")}.`;
  }
  return `Fallo en ${action}: ${raw.message}`;
}
