import React, {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {ActivityIndicator,Pressable,Text,View} from "react-native";
import {
  type ActivityLog,type DriverActivity,changeDriverActivity,closeDriverActivities,
  getDriverActivityTotals,loadDriverActivities,saveDriverActivities
} from "@/lib/driver-activities";

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
  const [log,setLog]=useState<ActivityLog|null>(null);
  const [now,setNow]=useState(Date.now());
  const [saving,setSaving]=useState(false);
  const lock=useRef(false);
  useEffect(()=>{
    let valid=true;
    setLog(null);
    loadDriverActivities(userId,shiftId).then(v=>{if(valid)setLog(v)}).catch(()=>{if(valid)setLog({shiftId,segments:[]})});
    return ()=>{valid=false};
  },[userId,shiftId]);
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
  const totals=useMemo(()=>getDriverActivityTotals(log??{shiftId,segments:[]},new Date(now)),[log,shiftId,now]);
  const choose=useCallback(async(type:DriverActivity)=>{
    if(!log||closed||lock.current)return;
    lock.current=true;
    setSaving(true);
    try{
      const next=changeDriverActivity(log,type);
      if(next===log)return;
      await saveDriverActivities(userId,next);
      setNow(Date.now());
      setLog(next);
    }catch(e){console.warn("[ACTIVITIES] Failed to save",e)}
    finally{lock.current=false;setSaving(false)}
  },[userId,log,closed]);
  return <View style={{backgroundColor:colors.panel,borderRadius:18,padding:16,marginBottom:15,gap:12}}>
    <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center"}}>
      <Text style={{color:colors.text,fontWeight:"700",fontSize:17}}>Actividades de la jornada</Text>
      {saving?<ActivityIndicator size="small" color={colors.sub}/>:null}
    </View>
    <Text style={{color:colors.sub,fontSize:12}}>Selecciona una actividad. Al cambiar, se detiene la anterior y se conserva su tiempo.</Text>
    <View style={{flexDirection:"row",flexWrap:"wrap",gap:9}}>
      {activityTypes.map(item=>{
        const selected=totals.current===item.type;
        return <Pressable key={item.type} onPress={()=>choose(item.type)} disabled={!log||saving||closed}
          accessibilityRole="button" accessibilityState={{selected,disabled:!log||saving||closed}}
          style={{width:"48%",backgroundColor:selected?colors.active:colors.card,
            borderRadius:13,borderWidth:selected?2:1,borderColor:selected?"#71B6FF":"#2D5171",padding:12,opacity:closed?0.6:1}}>
          <Text style={{color:colors.text,fontWeight:"700",fontSize:13}}>{item.icon} {item.label}</Text>
          <Text style={{color:selected?"#FFFFFF":colors.sub,marginTop:6,fontSize:16,fontWeight:"700",fontVariant:["tabular-nums"]}}>
            {format(totals.totals[item.type])}
          </Text>
        </Pressable>;
      })}
    </View>
    <Text style={{color:colors.sub,fontSize:12}}>
      Conducción desde la última pausa de 45 min: {format(totals.continuousDrivingMs)}
    </Text>
    <Text style={{color:colors.sub,fontSize:11}}>Registro manual orientativo · No sustituye al tacógrafo. AutoStart de actividades pendiente de integrar.</Text>
  </View>;
}
