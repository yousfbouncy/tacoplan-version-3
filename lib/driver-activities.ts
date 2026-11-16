import AsyncStorage from "@react-native-async-storage/async-storage";

export type DriverActivity = "DRIVING" | "REST" | "AVAILABLE" | "WORK";
export type ActivitySegment = { type: DriverActivity; startedAt: string; endedAt: string | null };
export type ActivityLog = { shiftId: string; segments: ActivitySegment[] };

const key = (userId: string, shiftId: string) => "tacoplan_driver_activities_v1:" + userId + ":" + shiftId;
const kinds: DriverActivity[] = ["DRIVING", "REST", "AVAILABLE", "WORK"];

export function sanitizeLog(input: unknown, shiftId: string): ActivityLog {
  const raw = input && typeof input === "object" ? input as Partial<ActivityLog> : {};
  const segments: ActivitySegment[] = [];
  for (const s of Array.isArray(raw.segments) ? raw.segments : []) {
    if (!s || !kinds.includes(s.type) || !Number.isFinite(Date.parse(s.startedAt))) continue;
    if (s.endedAt !== null && (!s.endedAt || !Number.isFinite(Date.parse(s.endedAt)))) continue;
    if (s.endedAt && Date.parse(s.endedAt) < Date.parse(s.startedAt)) continue;
    segments.push({type:s.type, startedAt:s.startedAt, endedAt:s.endedAt});
  }
  return {shiftId, segments};
}

export async function loadDriverActivities(userId: string, shiftId: string): Promise<ActivityLog> {
  const value = await AsyncStorage.getItem(key(userId, shiftId));
  if (!value) return {shiftId, segments:[]};
  try { return sanitizeLog(JSON.parse(value), shiftId); }
  catch { return {shiftId, segments:[]}; }
}

export function changeDriverActivity(log: ActivityLog, next: DriverActivity, now = new Date()): ActivityLog {
  const when = now.toISOString();
  const segments = log.segments.map(s => ({...s}));
  const open = segments.findLastIndex(s => s.endedAt === null);
  if (open >= 0) {
    if (segments[open].type === next) return log; // pulsación repetida: no duplicar
    const start = Date.parse(segments[open].startedAt);
    if (now.getTime() < start) return log; // reloj atrasado: no generar duración negativa
    segments[open].endedAt = when;
  }
  segments.push({type:next,startedAt:when,endedAt:null});
  return {...log,segments};
}

export function closeDriverActivities(log: ActivityLog, now = new Date()): ActivityLog {
  const when = now.toISOString();
  return {...log,segments:log.segments.map(s => s.endedAt === null
    ? {...s,endedAt:Date.parse(s.startedAt) <= now.getTime() ? when : s.startedAt}
    : s)};
}

export async function saveDriverActivities(userId: string, log: ActivityLog): Promise<void> {
  await AsyncStorage.setItem(key(userId,log.shiftId), JSON.stringify(log));
}

export function getDriverActivityTotals(log: ActivityLog, now = new Date()) {
  const totals: Record<DriverActivity,number> = {DRIVING:0,REST:0,AVAILABLE:0,WORK:0};
  const current = log.segments.findLast(s => s.endedAt === null)?.type ?? null;
  let continuousDrivingMs = 0;
  let pauseMs = 0;
  for (const segment of log.segments) {
    const start = Date.parse(segment.startedAt);
    const end = segment.endedAt ? Date.parse(segment.endedAt) : now.getTime();
    const duration = Math.max(0,end-start);
    totals[segment.type] += duration;
    if (segment.type === "DRIVING") {
      // Una pausa de al menos 45 minutos completos reinicia el bloque continuo.
      if (pauseMs >= 45*60000) continuousDrivingMs=0;
      pauseMs=0;
      continuousDrivingMs+=duration;
    } else if (segment.type === "REST") {
      pauseMs += duration;
      if (pauseMs >= 45*60000) continuousDrivingMs=0;
    } else {
      pauseMs=0;
    }
  }
  return {totals,current,continuousDrivingMs};
}
