import React, {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {ActivityIndicator,AppState,Pressable,Text,View} from "react-native";
import {
  type ActivityLog,type DriverActivity,changeDriverActivity,closeDriverActivities,
  getDriverActivityTotals,loadDriverActivities,loadLocalDriverActivities,saveDriverActivities,syncDriverActivities
} from "@/lib/driver-activities";

import {isDrivingAutoStartEnabled,setDrivingAutoStartEnabled,syncDrivingMonitoring,readPendingDrivingStop} from "@/lib/autostart/driving";
import {useI18n} from "@/lib/i18n-context";
import {useSubscriptionAccess,readSubscriptionAccess} from "@/lib/subscription-access";

const activityTypes: Array<{type:DriverActivity,label:string,icon:string}> = [
  {type:"DRIVING",label:"activities.driving",icon:"🚛"},
  {type:"REST",label:"activities.rest",icon:"☕"},
  {type:"AVAILABLE",label:"activities.available",icon:"🕒"},
  {type:"WORK",label:"activities.work",icon:"🛠️"},
];
const format=(milliseconds:number)=> {
  const sec=Math.floor(Math.max(0,milliseconds)/1000);
  return String(Math.floor(sec/3600)).padStart(2,"0")+":"+
    String(Math.floor(sec%3600/60)).padStart(2,"0")+":"+
    String(sec%60).padStart(2,"0");
};
const colors={panel:"#102844",card:"#153655",active:"#1266CD",text:"#FFFFFF",sub:"#AFC7DF"};

export default function DriverActivityPanel({userId,shiftId,closed=false}:{
  userId:string;shiftId:string;closed?:boolean
}) {
  const {t}=useI18n();
  const {access,loading:planLoading}=useSubscriptionAccess();
  const canManageActivities=!access.restrictions_enabled || access.plus_access;
  const [log,setLog]=useState<ActivityLog|null>(null);
  const [now,setNow]=useState(Date.now());
  const [saving,setSaving]=useState(false);
  const [autoDriving,setAutoDriving]=useState(false);
  const [autoBusy,setAutoBusy]=useState(false);
  const [pendingStopSince,setPendingStopSince]=useState<number|null>(null);
  useEffect(()=>{
    let live=true;
    void isDrivingAutoStartEnabled(userId).then(v=>{if(live)setAutoDriving(v)}).catch(()=>{});
    return ()=>{live=false};
  },[userId]);
  useEffect(()=>{
    if(closed)return;
    void syncDrivingMonitoring(userId).catch(e=>console.warn("[DRIVING-AUTO] sync failed",e));
  },[userId,shiftId,closed]);
  const lock=useRef(false);
  useEffect(()=>{
    let valid=true;
    setLog(null);
    loadDriverActivities(userId,shiftId).then(v=>{if(valid)setLog(v)}).catch(()=>{if(valid)setLog({shiftId,segments:[]})});
    return ()=>{valid=false};
  },[userId,shiftId]);
  // GPS AutoStart writes activities independently of this React screen.
  // Refresh the displayed current activity so the driving/rest timers reflect
  // the saved change rather than staying on stale state until navigation.
  useEffect(()=>{
    if (!autoDriving || closed || !userId || !shiftId) return;
    let cancelled = false;
    let inFlight = false;
    const refresh = async () => {
      if (cancelled || inFlight || lock.current) return;
      inFlight = true;
      try {
        const latest = await loadLocalDriverActivities(userId, shiftId);
        if (!cancelled) setLog(previous =>
          previous && JSON.stringify(previous.segments) === JSON.stringify(latest.segments)
            ? previous : latest);
      } catch (error) {
        console.warn("[DRIVING-AUTO] Failed to refresh activity display", error);
      } finally { inFlight = false; }
    };
    void refresh();
    const timer = setInterval(()=>{void refresh()}, 2000);
    return ()=>{cancelled = true; clearInterval(timer);};
  },[autoDriving,closed,userId,shiftId]);

  useEffect(()=>{
    if (!log?.segments.length) return;
    // Retry queued local changes after returning online / reopening the app.
    void syncDriverActivities(userId,shiftId);
    const app=AppState.addEventListener("change",state=>{
      if(state==="active")void syncDriverActivities(userId,shiftId);
    });
    // Changes sync when saved; queued offline updates retry globally.
    // Never repeatedly upload unchanged rows every 30 seconds.
    return ()=>{app.remove();};
  },[userId,shiftId,Boolean(log?.segments.length)]);
  useEffect(()=>{
    if(!log||!closed||!log.segments.some(s=>s.endedAt===null))return;
    const next=closeDriverActivities(log);
    setLog(next);
    saveDriverActivities(userId,next).catch(e=>console.warn("[ACTIVITIES] Failed to close",e));
  },[closed,log,userId]);
  useEffect(()=>{
    if(!log||closed)return;
    const timer=setInterval(()=>setNow(Date.now()),1000);
    return ()=>clearInterval(timer);
  },[log?.shiftId,closed]);
  useEffect(()=>{
    if(closed){setPendingStopSince(null);return;}
    let live=true;
    const refresh=async()=>{
      const stop=await readPendingDrivingStop(userId,shiftId);
      if(live)setPendingStopSince(stop?.stoppedSince??null);
    };
    void refresh();
    const timer=setInterval(()=>void refresh(),1500);
    return ()=>{live=false;clearInterval(timer);setPendingStopSince(null)};
  },[userId,shiftId,closed]);
  const currentDrivingSegment=log?.segments.findLast(s=>s.endedAt===null);
  const liveStoppedMs=currentDrivingSegment?.type==="DRIVING" && pendingStopSince!==null
    ?Math.max(0,now-Math.max(pendingStopSince,Date.parse(currentDrivingSegment.startedAt))):0;
  const baseTotals=useMemo(()=>getDriverActivityTotals(log??{shiftId,segments:[]},new Date(now)),[log,shiftId,now]);
  const totals={
    ...baseTotals,
    totals:{...baseTotals.totals,DRIVING:Math.max(0,baseTotals.totals.DRIVING-liveStoppedMs)},
    continuousDrivingMs:Math.max(0,baseTotals.continuousDrivingMs-liveStoppedMs),
  };
  const choose=useCallback(async(type:DriverActivity)=>{
    if(!log||closed||lock.current||planLoading||!canManageActivities)return;
    lock.current=true;
    setSaving(true);
    try{
      const latestPlan=await readSubscriptionAccess();
      if(latestPlan.restrictions_enabled&&!latestPlan.plus_access)return;
      // Use the latest persisted log: the GPS task can write while this screen is open.
      const latest=await loadDriverActivities(userId,shiftId);
      const next=changeDriverActivity(latest,type);
      if(next===latest)return;
      await saveDriverActivities(userId,next);
      setNow(Date.now());
      setLog(next);
    }catch(e){console.warn("[ACTIVITIES] Failed to save",e)}
    finally{lock.current=false;setSaving(false)}
  },[userId,shiftId,log,closed,planLoading,canManageActivities]);
  const toggleAuto=useCallback(async()=>{
    if(autoBusy||closed||planLoading||(!canManageActivities&&!autoDriving))return;
    setAutoBusy(true);
    try{
      if(!autoDriving){const current=await readSubscriptionAccess();if(current.restrictions_enabled&&!current.plus_access)return;}
      await setDrivingAutoStartEnabled(userId,!autoDriving);
      setAutoDriving(!autoDriving);
    }catch(e){console.warn("[DRIVING-AUTO] toggle failed",e)}
    finally{setAutoBusy(false)}
  },[userId,autoDriving,autoBusy,closed,canManageActivities,planLoading]);
  useEffect(()=>{
    if(closed)return;
    const timer=setInterval(async()=>{
      if(lock.current)return;
      try{
        const latest=await loadLocalDriverActivities(userId,shiftId);
        setLog(previous=>JSON.stringify(previous?.segments)!==JSON.stringify(latest.segments)?latest:previous);
      }catch{}
    },10000);
    return ()=>clearInterval(timer);
  },[userId,shiftId,closed]);
  return <View style={{backgroundColor:colors.panel,borderRadius:18,padding:16,marginBottom:15,gap:12}}>
    <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center"}}>
      <Text style={{color:colors.text,fontWeight:"700",fontSize:17}}>{t("activities.title")}</Text>
      {saving?<ActivityIndicator size="small" color={colors.sub}/>:null}
    </View>
    {!canManageActivities?<Text style={{color:colors.sub}}>La selección de actividades y AutoStart requieren Plus o Pro. Tus registros anteriores se conservan.</Text>:null}
    <Pressable onPress={toggleAuto} disabled={autoBusy||closed||planLoading||(!canManageActivities&&!autoDriving)} accessibilityRole="switch"
      accessibilityState={{checked:autoDriving,disabled:autoBusy||closed}}
      style={{padding:12,borderRadius:10,backgroundColor:autoDriving?"#145B46":"#22435E"}}>
      <Text style={{color:"#FFFFFF",fontWeight:"700"}}>{t("activities.autoTitle")}: {autoDriving?t("activities.enabled"):t("activities.disabled")}</Text>
      <Text style={{color:colors.sub,fontSize:12,marginTop:4}}>{t("activities.autoExplanation")}</Text>
    </Pressable>
    <Text style={{color:colors.sub,fontSize:12}}>{t("activities.chooseExplanation")}</Text>
    <View style={{flexDirection:"row",flexWrap:"wrap",gap:9}}>
      {activityTypes.map(item=>{
        const selected=totals.current===item.type;
        return <Pressable key={item.type} onPress={()=>choose(item.type)} disabled={!log||saving||closed||planLoading||!canManageActivities}
          accessibilityRole="button" accessibilityState={{selected,disabled:!log||saving||closed||planLoading||!canManageActivities}}
          style={{width:"48%",backgroundColor:selected?colors.active:colors.card,
            borderRadius:13,borderWidth:selected?2:1,borderColor:selected?"#71B6FF":"#2D5171",padding:12,opacity:closed?0.6:1}}>
          <Text style={{color:colors.text,fontWeight:"700",fontSize:13}}>{item.icon} {t(item.label)}</Text>
          <Text style={{color:selected?"#FFFFFF":colors.sub,marginTop:6,fontSize:16,fontWeight:"700",fontVariant:["tabular-nums"]}}>
            {format(item.type==="REST"?totals.restButtonMs:totals.totals[item.type])}
          </Text>
        </Pressable>;
      })}
    </View>

  </View>;
}
