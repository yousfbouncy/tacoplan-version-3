import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";

type ActivityUser={user_id:string;nombre:string;ultima_actividad:string|null;jornadas:number};
type Shift={id:string;user_id:string;nombre:string;inicio:string|null;fin:string|null;fecha_fin:string|null;abierta:boolean};
type DailyStats={date:string;updatedAt:string;activeUsers:number;startedUsers:number;closedShifts:number;openShifts:number;activityHistoryComplete:boolean;users:ActivityUser[];shifts:Shift[]};
function todayMadrid() {
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Madrid",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const get=(key:string)=>parts.find(p=>p.type===key)?.value??"";
  return get("year")+"-"+get("month")+"-"+get("day");
}
function addDay(date:string,step:number){const d=new Date(date+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+step);return d.toISOString().slice(0,10);}
function validDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value&&value<=todayMadrid();}
export default function AdminSummaryRoute(){
  const {isAdmin,isAdminLoading,user}=useAuth();
  const insets=useSafeAreaInsets();
  const [date,setDate]=useState(todayMadrid);
  const [draft,setDraft]=useState(date);
  const [dateError,setDateError]=useState("");
  const select=(next:string)=>{setDate(next);setDraft(next);setDateError("");};
  const query=useQuery<DailyStats>({queryKey:["admin-daily-activity",user?.id,date],enabled:isAdmin&&!isAdminLoading,
    queryFn:async()=>{const {data,error}=await supabase.functions.invoke("admin-daily-activity",{body:{date}});if(error||!data||!Array.isArray(data.users))throw Error(error?.message||data?.message||"No se pudieron cargar los datos");return data as DailyStats;},
    refetchInterval:30000,staleTime:10000});
  if(isAdminLoading)return <View style={styles.center}><ActivityIndicator color="#60A5FA"/></View>;
  if(!isAdmin)return <View style={styles.center}><Text style={styles.title}>Acceso restringido</Text><Pressable onPress={()=>router.back()}><Text style={styles.link}>Volver</Text></Pressable></View>;
  const data=query.data;
  const without=data?.users.filter(u=>u.jornadas===0)||[];
  const metrics=data?[["Usuarios activos",data.activeUsers,"#35D399"],["Han iniciado jornada",data.startedUsers,"#F1F5F9"],["Jornadas cerradas",data.closedShifts,"#F1F5F9"],["Jornadas abiertas",data.openShifts,"#F59E0B"]] as const:[];
  return <View style={[styles.root,{paddingTop:insets.top+8}]}><View style={styles.header}><Pressable onPress={()=>router.back()} accessibilityRole="button"><Text style={styles.link}>‹ Volver</Text></Pressable><Pressable onPress={()=>{void query.refetch();}} accessibilityRole="button"><Text style={styles.link}>Actualizar</Text></Pressable></View>
  <ScrollView contentContainerStyle={{padding:16,paddingBottom:insets.bottom+24,gap:14}} refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={()=>{void query.refetch();}} tintColor="#60A5FA"/>}>
    <Text style={styles.title}>Actividad diaria de Tacoplan</Text>
    <Text style={styles.muted}>Estadísticas privadas · hora de España peninsular</Text>
    <View style={styles.controls}>
      <Pressable style={styles.button} onPress={()=>select(addDay(date,-1))}><Text style={styles.link}>‹</Text></Pressable>
      <TextInput accessibilityLabel="Fecha AAAA-MM-DD" value={draft} onChangeText={setDraft} placeholder="AAAA-MM-DD" placeholderTextColor="#94A3B8" autoCapitalize="none" autoCorrect={false} maxLength={10} style={styles.input} onSubmitEditing={()=>validDate(draft)?select(draft):setDateError("Fecha no válida")}/>
      <Pressable style={styles.button} onPress={()=>validDate(draft)?select(draft):setDateError("Fecha no válida")}><Text style={styles.link}>Ir</Text></Pressable>
      <Pressable disabled={date>=todayMadrid()} style={[styles.button,date>=todayMadrid()&&{opacity:.4}]} onPress={()=>select(addDay(date,1))}><Text style={styles.link}>›</Text></Pressable>
      <Pressable style={styles.button} onPress={()=>select(todayMadrid())}><Text style={styles.link}>Hoy</Text></Pressable>
    </View>
    {!!dateError&&<Text style={styles.warning}>{dateError}</Text>}
    {query.isLoading&&<ActivityIndicator color="#60A5FA"/>}
    {query.isError&&<Text style={styles.warning}>No se pudieron cargar las estadísticas. Pulsa Actualizar.</Text>}
    {data&&<><View style={styles.grid}>{metrics.map(([label,value,color])=><View key={label} style={styles.metric}><Text style={styles.muted}>{label}</Text><Text style={[styles.value,{color}]}>{value}</Text></View>)}</View>
    {!data.activityHistoryComplete&&<Text style={styles.muted}>La actividad histórica sin jornada puede ser parcial antes del 26/11/2026.</Text>}
    <Text style={styles.section}>Usuarios que han registrado jornada</Text>
    <View style={styles.table}><View style={styles.row}><Text style={[styles.muted,styles.name]}>Usuario</Text><Text style={[styles.muted,styles.time]}>Inicio</Text><Text style={[styles.muted,styles.time]}>Fin</Text></View>
    {data.shifts.map(s=><View key={s.id} style={styles.row}><Text style={[styles.normal,styles.name]}>{s.nombre}</Text><Text style={[styles.normal,styles.time]}>{s.inicio||"—"}</Text><Text style={[s.abierta?styles.warning:styles.normal,styles.time]}>{s.abierta?"Abierta":(s.fin||"—")+(s.fecha_fin&&s.fecha_fin!==date?" · "+s.fecha_fin.slice(8)+"/"+s.fecha_fin.slice(5,7):"")}</Text></View>)}
    {!data.shifts.length&&<Text style={styles.empty}>Sin jornadas registradas.</Text>}</View>
    <Text style={styles.section}>Activos sin iniciar jornada ({without.length})</Text>
    <View style={styles.table}><View style={styles.row}><Text style={[styles.muted,styles.name]}>Usuario</Text><Text style={styles.muted}>Última actividad</Text></View>{without.map(u=><View key={u.user_id} style={styles.row}><Text style={[styles.normal,styles.name]}>{u.nombre}</Text><Text style={styles.normal}>{u.ultima_actividad||"—"}</Text></View>)}{!without.length&&<Text style={styles.empty}>Sin usuarios en este grupo.</Text>}</View>
    <Text style={styles.muted}>Activos: usuarios únicos con actividad, sincronización o jornadas iniciadas o cerradas en la fecha. Las tarjetas de jornadas corresponden a las iniciadas ese día; pueden cerrarse después. Actualizado: {new Date(data.updatedAt).toLocaleString("es-ES",{timeZone:"Europe/Madrid"})}.</Text></>}
  </ScrollView></View>
}
const styles=StyleSheet.create({
 root:{flex:1,backgroundColor:"#0B1423"},center:{flex:1,backgroundColor:"#0B1423",alignItems:"center",justifyContent:"center",gap:16},header:{flexDirection:"row",justifyContent:"space-between",paddingHorizontal:16,paddingVertical:10},
 title:{fontSize:24,fontWeight:"700",color:"#F8FAFC"},section:{fontSize:17,fontWeight:"700",color:"#F8FAFC",marginTop:6},muted:{fontSize:13,color:"#A9B8CD"},normal:{fontSize:14,color:"#F1F5F9"},warning:{fontSize:14,color:"#F59E0B"},link:{color:"#79B9FF",fontWeight:"600",fontSize:15},
 controls:{flexDirection:"row",alignItems:"center",gap:6},button:{paddingHorizontal:10,paddingVertical:10,borderRadius:8,backgroundColor:"#17283D"},input:{flex:1,color:"#F1F5F9",paddingHorizontal:8,paddingVertical:9,borderWidth:1,borderColor:"#33465F",borderRadius:8,minWidth:105},
 grid:{flexDirection:"row",flexWrap:"wrap",gap:10},metric:{width:"48%",flexGrow:1,minHeight:98,padding:14,borderRadius:14,backgroundColor:"#142238",borderWidth:1,borderColor:"#2A3C54",gap:7},value:{fontSize:34,fontWeight:"700",fontVariant:["tabular-nums"]},
 table:{backgroundColor:"#142238",borderRadius:14,paddingHorizontal:12,borderWidth:1,borderColor:"#2A3C54"},row:{flexDirection:"row",alignItems:"center",gap:8,paddingVertical:12,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:"#33465F"},name:{flex:1},time:{width:76,textAlign:"right"},empty:{fontSize:14,color:"#A9B8CD",paddingVertical:16}
});
