import React, {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {ActivityIndicator,AppState,Pressable,Text,View} from "react-native";
import {
  type ActivityLog,type DriverActivity,changeDriverActivity,finishAutomaticRest,closeDriverActivities,
  getDriverActivityTotals,loadDriverActivities,loadLocalDriverActivities,saveDriverActivities,syncDriverActivities
} from "@/lib/driver-activities";

import {isDrivingAutoStartEnabled,setDrivingAutoStartEnabled,syncDrivingMonitoring,readPendingDrivingStop} from "@/lib/autostart/driving";
import {useSubscriptionAccess,readSubscriptionAccess} from "@/lib/subscription-access";

const activityTypes: Array<{type:DriverActivity,label:string,icon:string}> = [
  {type:"DRIVING",label:"Conducción",icon:"🚛"},
  {type:"REST",label:"Descanso",icon:"☕"},
  {type:"AVAILABLE",label:"Disponibilidad",icon:"🕒"},
  {type:"WORK",label:"Otros trabajos",icon:"🛠️"},
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
  const {access,loading:planLoading}=useSubscriptionAccess();
  const canManageActivities=!access.restrictions_enabled||access.plus_access;
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
  const currentSegment=log?.segments.findLast(s=>s.endedAt===null);
  const liveStoppedMs=currentSegment?.type==="DRIVING" && pendingStopSince!==null
    ?Math.max(0,now-Math.max(pendingStopSince,Date.parse(currentSegment.startedAt))):0;
  const baseTotals=useMemo(()=>getDriverActivityTotals(log??{shiftId,segments:[]},new Date(now)),[log,shiftId,now]);
  const totals={
    ...baseTotals,
    totals:{...baseTotals.totals,DRIVING:Math.max(0,baseTotals.totals.DRIVING-liveStoppedMs)},
    continuousDrivingMs:Math.max(0,baseTotals.continuousDrivingMs-liveStoppedMs),
  };
  const currentSegmentMs=currentSegment
    ?Math.max(0,now-Date.parse(currentSegment.startedAt)-liveStoppedMs):0;
  const choose=useCallback(async(type:DriverActivity)=>{
    if(!log||closed||lock.current||planLoading||!canManageActivities)return;
    lock.current=true;
    setSaving(true);
    try{
      const fresh=await readSubscriptionAccess();
      if(fresh.restrictions_enabled&&!fresh.plus_access)return;
      // Use the latest persisted log: the GPS task can write while this screen is open.
      const latest=await loadDriverActivities(userId,shiftId);
      const next=finishAutomaticRest(latest,type,new Date());
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
      if(!autoDriving){const fresh=await readSubscriptionAccess();if(fresh.restrictions_enabled&&!fresh.plus_access)return;}
      await setDrivingAutoStartEnabled(userId,!autoDriving);
      setAutoDriving(!autoDriving);
    }catch(e){console.warn("[DRIVING-AUTO] toggle failed",e)}
    finally{setAutoBusy(false)}
  },[userId,autoDriving,autoBusy,closed,planLoading,canManageActivities]);
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
      <Text style={{color:colors.text,fontWeight:"700",fontSize:17}}>Actividades de la jornada</Text>
      {saving?<ActivityIndicator size="small" color={colors.sub}/>:null}
    </View>
    {!canManageActivities?<Text style={{color:colors.sub}}>Plan Gratis: las actividades manuales y AutoStart requieren Plus o Pro. Tus registros se conservan.</Text>:null}
    <Pressable onPress={toggleAuto} disabled={autoBusy||closed||planLoading||(!canManageActivities&&!autoDriving)} accessibilityRole="switch"
      accessibilityState={{checked:autoDriving,disabled:autoBusy||closed}}
      style={{padding:12,borderRadius:10,backgroundColor:autoDriving?"#145B46":"#22435E"}}>
      <Text style={{color:"#FFFFFF",fontWeight:"700"}}>AutoStart de conducción: {autoDriving?"Activado":"Desactivado"}</Text>
      <Text style={{color:colors.sub,fontSize:12,marginTop:4}}>Independiente del inicio automático de jornada. Solo usa GPS con una jornada abierta.</Text>
    </Pressable>
    <Text style={{color:colors.sub,fontSize:12}}>Selecciona una actividad. Al cambiar, se detiene la anterior y se conserva su tiempo.</Text>
    <View style={{flexDirection:"row",flexWrap:"wrap",gap:9}}>
      {activityTypes.map(item=>{
        const selected=totals.current===item.type;
        return <Pressable key={item.type} onPress={()=>choose(item.type)} disabled={!log||saving||closed||planLoading||!canManageActivities}
          accessibilityRole="button" accessibilityState={{selected,disabled:!log||saving||closed||planLoading||!canManageActivities}}
          style={{width:"48%",backgroundColor:selected?colors.active:colors.card,
            borderRadius:13,borderWidth:selected?2:1,borderColor:selected?"#71B6FF":"#2D5171",padding:12,opacity:closed?0.6:1}}>
          <Text style={{color:colors.text,fontWeight:"700",fontSize:13}}>{item.icon} {item.label}</Text>
          <Text style={{color:selected?"#FFFFFF":colors.sub,marginTop:6,fontSize:16,fontWeight:"700",fontVariant:["tabular-nums"]}}>
            {format(item.type==="DRIVING"?totals.continuousDrivingMs:item.type==="REST"?totals.restButtonMs:totals.totals[item.type])}
          </Text>
        </Pressable>;
      })}
    </View>
    {totals.hasCompletedDrivingBreak ? (
      <View style={{backgroundColor:"#163C57",borderRadius:12,padding:12,borderWidth:1,borderColor:"#376B89",gap:5}}>
        <Text style={{color:colors.sub,fontSize:12,fontWeight:"600"}}>Conducción total acumulada de la jornada</Text>
        <Text style={{color:"#FFFFFF",fontSize:21,fontWeight:"700",fontVariant:["tabular-nums"]}}>{format(totals.totals.DRIVING)}</Text>
        <Text style={{color:colors.sub,fontSize:11}}>El contador de conducción se reinicia tras 45 min o 15 + 30 min; el total se conserva para el formulario de cierre.</Text>
      </View>
    ) : null}
    <View style={{borderRadius:12,padding:12,backgroundColor:"#0B2139",gap:5}}>
      <Text style={{color:colors.text,fontWeight:"700",fontSize:13}}>Resumen de actividades de esta jornada</Text>
      <Text style={{color:colors.sub,fontSize:12}}>
        Conducción actual {format(totals.continuousDrivingMs)} · Disponibilidad {format(totals.totals.AVAILABLE)}
      </Text>
      <Text style={{color:colors.sub,fontSize:12}}>
        Otros trabajos {format(totals.totals.WORK)} · Pausas totales {format(totals.totals.REST)}
      </Text>
      {currentSegment ? <Text style={{color:"#75C9FF",fontSize:12}}>
        En curso: {activityTypes.find(a=>a.type===currentSegment.type)?.label} · {format(currentSegmentMs)}
      </Text> : null}
    </View>
    <Text style={{color:colors.sub,fontSize:12}}>
      Conducción desde la última pausa reglamentaria: {format(totals.continuousDrivingMs)}
    </Text>
    <View style={{borderRadius:12,padding:12,borderWidth:1,borderColor:"#31587B",gap:5}}>
      <Text style={{color:colors.text,fontWeight:"700",fontSize:13}}>Pausa reglamentaria · 15 + 30 o 45 seguidos</Text>
      <Text style={{color:colors.sub,fontSize:12}}>
        Primer tramo: {format(totals.firstBreakProgressMs)} / 00:15:00 {totals.firstBreakReady ? "✓" : ""}
      </Text>
      <Text style={{color:colors.sub,fontSize:12}}>
        Segundo tramo: {format(totals.secondBreakProgressMs)} / 00:30:00
      </Text>
      <Text style={{color:colors.sub,fontSize:12}}>
        Alternativa sin interrupción: {format(totals.uninterruptedBreakProgressMs)} / 00:45:00
      </Text>
      <Text style={{color:"#8DC7FF",fontSize:11}}>
        El primer tramo se reconoce con 15 min como mínimo. El segundo necesita 30 min seguidos; si se interrumpe antes, vuelve a 0. En Historial nunca se pierden los minutos de pausa.
      </Text>
    </View>
    <Text style={{color:colors.sub,fontSize:12}}>
      {totals.current==="REST"
        ? totals.qualifiedBreak
          ? "Pausa de conducción completada (45 min o 15 + 30). El descanso diario se comprueba por separado."
          : "Descanso actual: "+format(totals.currentRestMs)+" · Para completar pausa de conducción faltan "+format(totals.breakRemainingMs)
        : totals.firstBreak15Completed
          ? "Primera pausa de 15 min registrada. Falta una segunda pausa de 30 min."
          : "Para reiniciar la conducción acumulada se necesitan 45 min de pausa, o 15 + 30 min."}
    </Text>
    <Text style={{color:colors.sub,fontSize:11}}>
      Pausas realmente registradas: {format(totals.totals.REST)} · Pausa actual sin interrupción: {format(totals.currentRestMs)}
    </Text>
    <Text style={{color:colors.sub,fontSize:11}}>Registro orientativo manual o automático · No sustituye al tacógrafo. El segundo plano requiere permiso adicional.</Text>
  </View>;
}
