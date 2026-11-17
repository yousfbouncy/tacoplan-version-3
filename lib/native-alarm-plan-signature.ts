/** Deterministic signature for alarm plans. Equality means that the system
 * alarms can remain registered; do not cancel/recreate them on each UI refresh.
 */
export type NativeAlarmPlanEntry = {
  id:string; fecha:string; limite:number; mensaje:string;
};
export function nativeAlarmPlanSignature(alerts: NativeAlarmPlanEntry[]):string {
  return JSON.stringify(alerts.map(alert=>({
    id:alert.id, fecha:alert.fecha, limite:alert.limite, mensaje:alert.mensaje,
  })));
}
