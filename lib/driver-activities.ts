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

// Traffic and the app share these server-side segments. The phone remains usable offline.
const cloudType: Record<DriverActivity,string> = {
  DRIVING:"CONDUCCION", REST:"DESCANSO", AVAILABLE:"DISPONIBILIDAD", WORK:"OTROS_TRABAJOS",
};
const fromCloudType: Record<string,DriverActivity> = Object.fromEntries(
  Object.entries(cloudType).map(([key,value])=>[value,key as DriverActivity])
) as Record<string,DriverActivity>;
const syncJobs = new Map<string,Promise<boolean>>();
const pendingPrefix = "tacoplan_driver_activity_pending_v1:";
const migrationPrefix = "tacoplan_driver_activity_migrated_v1:";
const queueLocks = new Map<string,Promise<void>>();

async function updatePending(userId:string, shiftId:string, add:boolean):Promise<void> {
  const queueKey=pendingPrefix+userId;
  const previous=queueLocks.get(queueKey) || Promise.resolve();
  const next=previous.catch(()=>{}).then(async()=>{
    const raw=await AsyncStorage.getItem(queueKey);
    let shifts:string[]=[];
    try { const parsed=JSON.parse(raw||"[]"); if(Array.isArray(parsed))shifts=parsed.filter(x=>typeof x==="string"); } catch {}
    const unique=new Set(shifts);
    if(add)unique.add(shiftId);
    else unique.delete(shiftId);
    await AsyncStorage.setItem(queueKey,JSON.stringify(Array.from(unique)));
  });
  queueLocks.set(queueKey,next);
  try { await next; } finally { if(queueLocks.get(queueKey)===next)queueLocks.delete(queueKey); }
}


function parseStoredLog(raw: string | null, shiftId: string): ActivityLog {
  if (!raw) return {shiftId,segments:[]};
  try {return sanitizeLog(JSON.parse(raw),shiftId);}
  catch {return {shiftId,segments:[]};}
}

export async function loadDriverActivities(userId: string, shiftId: string): Promise<ActivityLog> {
  const stored = parseStoredLog(await AsyncStorage.getItem(key(userId,shiftId)),shiftId);
  if (stored.segments.length) return stored;
  // Hydrate when opening the same shift from a different device or after a reinstall.
  // Do not overwrite locally pending activity changes.
  try {
    const {supabase}=await import("@/lib/supabase");
    const {data,error} = await supabase.from("tacho_activities")
      .select("tipo,inicio,fin,segment_index")
      .eq("user_id",userId).eq("shift_id",shiftId).eq("source","manual")
      .order("segment_index",{ascending:true});
    if (error || !data?.length) return stored;
    const log = sanitizeLog({segments:data.map(row=>({
      type:fromCloudType[String(row.tipo)],
      startedAt:String(row.inicio),
      endedAt:row.fin===null?null:String(row.fin),
    }))},shiftId);
    if (log.segments.length) await AsyncStorage.setItem(key(userId,shiftId),JSON.stringify(log));
    return log;
  } catch { return stored; }
}

export function buildActivitySyncRows(userId:string,log:ActivityLog,updatedAt=new Date()) {
  return log.segments.map((segment,index)=>{
    const start=Date.parse(segment.startedAt);
    const end=segment.endedAt?Date.parse(segment.endedAt):null;
    return {
      id:"manual:"+userId+":"+log.shiftId+":"+index,
      user_id:userId,shift_id:log.shiftId,segment_index:index,
      tipo:cloudType[segment.type],source:"manual",
      inicio:segment.startedAt,fin:segment.endedAt,
      fecha:segment.startedAt.slice(0,10),
      duracion_min:end===null?0:Math.max(0,Math.floor((end-start)/60000)),
      updated_at:updatedAt.toISOString(),
    };
  });
}

export function syncDriverActivities(userId: string, shiftId: string): Promise<boolean> {
  const storageKey=key(userId,shiftId);
  // Serialize writes per shift and always read the newest local state: late HTTP
  // responses must not reopen an already closed segment.
  const previous=syncJobs.get(storageKey) || Promise.resolve(true);
  const next=previous.catch(()=>false).then(async()=>{
    const snapshot=await AsyncStorage.getItem(storageKey);
    const log=parseStoredLog(snapshot,shiftId);
    if (!log.segments.length) { await updatePending(userId,shiftId,false); return true; }
    const rows=buildActivitySyncRows(userId,log);
    const {supabase}=await import("@/lib/supabase");
    const {error}=await supabase.from("tacho_activities").upsert(rows,{onConflict:"id"});
    if (error) throw error;
    // A newer local edit may have happened during this request. Do not mark
    // that new edit as synced; the next pass will upload it.
    if ((await AsyncStorage.getItem(storageKey))===snapshot) {
      await updatePending(userId,shiftId,false);
    }
    return true;
  }).catch(error=>{
    console.warn("[ACTIVITIES] Cloud sync pending; will retry",error);
    return false;
  }).finally(()=>{
    if(syncJobs.get(storageKey)===next)syncJobs.delete(storageKey);
  });
  syncJobs.set(storageKey,next);
  return next;
}

export async function flushPendingDriverActivities(userId:string):Promise<void> {
  if (!userId) return;
  try {
    const migrated=migrationPrefix+userId;
    if (!(await AsyncStorage.getItem(migrated))) {
      // Backfill activity logs saved by older releases before cloud sync existed.
      const keys=await AsyncStorage.getAllKeys();
      const prefix="tacoplan_driver_activities_v1:"+userId+":";
      for(const storageKey of keys.filter(k=>k.startsWith(prefix))) {
        await updatePending(userId,storageKey.slice(prefix.length),true);
      }
      await AsyncStorage.setItem(migrated,"true");
    }
    const raw=await AsyncStorage.getItem(pendingPrefix+userId);
    const shifts=JSON.parse(raw||"[]") as unknown;
    if(!Array.isArray(shifts)) return;
    // Limit concurrency to avoid overloading Supabase on reconnect.
    for(let index=0;index<shifts.length;index+=5) {
      await Promise.all(shifts.slice(index,index+5)
        .filter((shift):shift is string=>typeof shift==="string")
        .map(shift=>syncDriverActivities(userId,shift)));
    }
  }catch(error){console.warn("[ACTIVITIES] Pending activity replay failed",error);}
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
  await updatePending(userId,log.shiftId,true);
  // Save locally first; when offline the activity is never lost or blocked.
  void syncDriverActivities(userId,log.shiftId);
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
