import AsyncStorage from "@react-native-async-storage/async-storage";

export type DriverActivity = "DRIVING" | "REST" | "AVAILABLE" | "WORK";
export type ActivitySegment = { type: DriverActivity; startedAt: string; endedAt: string | null; automaticRest?: boolean };
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
    segments.push({type:s.type, startedAt:s.startedAt, endedAt:s.endedAt, ...(s.automaticRest === true && s.type === "REST" ? {automaticRest:true} : {})});
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

/** Return the timeline cached on this device, never a network request. */
export async function loadLocalDriverActivities(userId: string, shiftId: string): Promise<ActivityLog> {
  return parseStoredLog(await AsyncStorage.getItem(key(userId,shiftId)),shiftId);
}
export async function loadDriverActivities(userId: string, shiftId: string): Promise<ActivityLog> {
  const stored = await loadLocalDriverActivities(userId,shiftId);
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

/** End an automatically detected drive without assigning rest/work to the driver. */
export function pauseDriverActivity(log: ActivityLog, now = new Date()): ActivityLog {
  const open = log.segments.findLastIndex(s => s.endedAt === null);
  if (open < 0 || log.segments[open].type !== "DRIVING") return log;
  const started = Date.parse(log.segments[open].startedAt);
  if (now.getTime() < started) return log;
  return {...log,segments:log.segments.map((s,index)=>index===open?{...s,endedAt:now.toISOString()}:s)};
}

/** GPS-confirmed stationary period: mark REST from the FIRST reliable stop
 * fix, while keeping the same one-minute detection and subtraction rules.
 * Distinguish it from user-selected REST: only GPS REST may be reclassified
 * when a short stop ends. Never manufacture daily/weekly rest certification. */
export function startAutomaticRest(log: ActivityLog, at: Date): ActivityLog {
  const open = log.segments.findLast(s=>s.endedAt===null);
  if (open?.type!=="DRIVING") return log;
  const next = changeDriverActivity(log,"REST",at);
  if (next===log) return log;
  return {...next,segments:next.segments.map((segment,index)=>
    index===next.segments.length-1?{...segment,automaticRest:true}:segment)};
}

/** On a return to driving or on a manual activity change, short GPS pauses
 * that cannot qualify as a 15-minute first or 30-minute second stage are
 * categorized as WORK. The historical total of DRIVING is never changed. */
export function finishAutomaticRest(log: ActivityLog,nextType:DriverActivity,at:Date): ActivityLog {
  const last=log.segments.findLast(s=>s.endedAt===null);
  if(last?.type!=="REST"||last.automaticRest!==true||nextType==="REST")
    return changeDriverActivity(log,nextType,at);
  const start=Date.parse(last.startedAt);
  const duration=at.getTime()-start;
  if(duration<0) return log;
  const earlier={...log,segments:log.segments.slice(0,-1)};
  const alreadyHad15=getDriverActivityTotals(earlier,new Date(start)).firstBreak15Completed;
  const requiredMs=(alreadyHad15?30:15)*60_000;
  if(duration>=requiredMs)return changeDriverActivity(log,nextType,at);
  const segments=log.segments.map((segment,index)=>index===log.segments.length-1
    ?{...segment,type:"WORK" as const,automaticRest:undefined}:segment);
  return changeDriverActivity({...log,segments},nextType,at);
}

export async function saveDriverActivities(userId: string, log: ActivityLog): Promise<void> {
  await AsyncStorage.setItem(key(userId,log.shiftId), JSON.stringify(log));
  await updatePending(userId,log.shiftId,true);
  // Save locally first; when offline the activity is never lost or blocked.
  void syncDriverActivities(userId,log.shiftId);
}

/**
 * Advisory driving-break calculation from the driver's activity timeline.
 * Only REST segments count as a break; availability/work never counts.
 * EU driving break: 45 continuous minutes, or 15 followed by 30 minutes.
 * This is NOT a certified tachograph reading or a daily/weekly rest validator.
 */
export function getDriverActivityTotals(log: ActivityLog, now = new Date()) {
  const totals: Record<DriverActivity,number> = {DRIVING:0,REST:0,AVAILABLE:0,WORK:0};
  const current = log.segments.findLast(s => s.endedAt === null)?.type ?? null;
  let continuousDrivingMs = 0;
  let firstBreak15Completed = false;
  let restSinceDrivingMs = 0;
  let currentRestMs = 0;
  let currentRestQualified = false;
  let currentRestQualifiedBySplit = false;
  let drivingStarted = false;
  let hasCompletedDrivingBreak = false;
  let lastActivity:DriverActivity|null=null;
  const min = 60000;
  // Use chronologically ordered, non-overlapping activity segments. The end
  // of an ongoing segment is the snapshot time, not unlimited future time.
  const segments = [...log.segments].sort((a,b)=>Date.parse(a.startedAt)-Date.parse(b.startedAt));
  for (const segment of segments) {
    const start=Date.parse(segment.startedAt);
    const end=Math.min(segment.endedAt?Date.parse(segment.endedAt):now.getTime(),now.getTime());
    if (!Number.isFinite(start)||!Number.isFinite(end)||end<start) continue;
    const duration = end-start;
    totals[segment.type] += duration;
    if (segment.type === "REST") {
      restSinceDrivingMs = lastActivity==="REST" ? restSinceDrivingMs+duration : duration;
      currentRestMs=restSinceDrivingMs;
      if (restSinceDrivingMs >= 45*min || (firstBreak15Completed && restSinceDrivingMs>=30*min)) {
        currentRestQualifiedBySplit = firstBreak15Completed && restSinceDrivingMs>=30*min;
        currentRestQualified=true;
        if (drivingStarted || continuousDrivingMs>0) hasCompletedDrivingBreak=true;
        continuousDrivingMs=0;
        firstBreak15Completed=false;
        drivingStarted=false;
      }
    } else {
      if (lastActivity==="REST") {
        // This rest may already have completed a 45-minute or 15+30-minute
        // break while it was active. Never reinterpret its final 30-minute
        // segment as a new first 15-minute stage when driving resumes.
        if (currentRestQualified || restSinceDrivingMs>=45*min ||
            (firstBreak15Completed && restSinceDrivingMs>=30*min)) {
          continuousDrivingMs=0;
          firstBreak15Completed=false;
          drivingStarted=false;
        } else if (restSinceDrivingMs>=15*min && !firstBreak15Completed) {
          // First stage qualifies; a later 30-minute REST completes the split.
          firstBreak15Completed=true;
        }
      }
      restSinceDrivingMs=0;
      currentRestMs=0;
      currentRestQualified=false;
      currentRestQualifiedBySplit=false;
      if (segment.type==="DRIVING") {
        continuousDrivingMs+=duration;
        drivingStarted=true;
      } else {
        // Work and availability are not breaks, but preserve a completed 15-minute first stage.
      }
    }
    lastActivity=segment.type;
  }
  const qualifiedBreak = current==="REST" && currentRestQualified;
  const requiredCurrentRestMs = firstBreak15Completed ? 30*min : 45*min;
  const breakRemainingMs=qualifiedBreak ? 0 : Math.max(0,requiredCurrentRestMs-(current==="REST"?currentRestMs:0));
  // Legal credit is separate from the complete historical REST duration:
  // A 20-minute first pause earns only 15 minutes toward 15+30.
  // A subsequent second pause needs 30 uninterrupted minutes.
  const firstBreakProgressMs = firstBreak15Completed || (qualifiedBreak && currentRestQualifiedBySplit) ? 15*min :
    current==="REST" ? Math.min(currentRestMs,15*min) : 0;
  const firstBreakReady = firstBreak15Completed || (qualifiedBreak && currentRestQualifiedBySplit) ||
    (current==="REST" && currentRestMs>=15*min);
  const secondBreakProgressMs = qualifiedBreak && currentRestQualifiedBySplit ? 30*min :
    firstBreak15Completed && current==="REST" ? Math.min(currentRestMs,30*min) : 0;
  const uninterruptedBreakProgressMs = current==="REST"
    ? Math.min(currentRestMs,45*min) : 0;
  // The REST activity button displays the *current* break, not the sum of
  // every rest in the shift. After leaving rest, only a completed first
  // 15-minute stage is retained; an invalid (<15 min) stage returns to zero.
  // The full REST total remains untouched for the journey history.
  const restButtonMs = current==="REST" ? currentRestMs : firstBreak15Completed ? 15*min : 0;
  return {totals,current,continuousDrivingMs,hasCompletedDrivingBreak,currentRestMs,restButtonMs,firstBreak15Completed,
    qualifiedBreak,breakRemainingMs,drivingStarted,firstBreakProgressMs,firstBreakReady,
    secondBreakProgressMs,uninterruptedBreakProgressMs,currentRestQualifiedBySplit};
}

/** Return the actual driving minutes logged up to the selected closing time.
 * The optional day boundary is used for Sunday-to-Monday journeys.
 * Never rounds up incomplete driving minutes, and never invents unlogged time.
 */
export function getDrivingTotalsForClose(log: ActivityLog, closingAt: Date, splitBoundaryMs?: number) {
  const closed=closeDriverActivities(log,closingAt);
  const closeMs=closingAt.getTime();
  let drivingMs=0;
  let firstPartMs=0;
  for (const segment of closed.segments) {
    if (segment.type!=="DRIVING") continue;
    const start=Date.parse(segment.startedAt);
    const end=Date.parse(segment.endedAt || "");
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(closeMs)) continue;
    const boundedEnd=Math.min(end,closeMs);
    if (boundedEnd<=start) continue;
    drivingMs+=boundedEnd-start;
    if (splitBoundaryMs!=null && Number.isFinite(splitBoundaryMs)) {
      firstPartMs+=Math.max(0,Math.min(boundedEnd,splitBoundaryMs)-start);
    }
  }
  const totalMin=Math.floor(drivingMs/60000);
  const firstPartMin=Math.min(totalMin,Math.floor(firstPartMs/60000));
  return {totalMin,firstPartMin,secondPartMin:Math.max(0,totalMin-firstPartMin),closed};
}
