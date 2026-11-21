import React,{useEffect,useState} from "react";
import {Alert,Modal,Pressable,Text,TextInput,View} from "react-native";
import {saveNightPreference} from "@/lib/night-estimator";
import type {NightPeriodReport} from "@/lib/night-work-data";
const eur=(n:number)=>n.toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2})+" €";
export default function NightBonusCard({report,userId,onUpdated,compact=false,inline=false}:{
 report:NightPeriodReport|null|undefined;userId:string|undefined;onUpdated?:()=>void;compact?:boolean;inline?:boolean;
}){
 const [opened,setOpened]=useState(false);
 const [unit,setUnit]=useState<"hourly"|"monthly">("hourly");
 const [value,setValue]=useState("");
 const [contractProvince,setContractProvince]=useState("");
 const [busy,setBusy]=useState(false);
 const needsSetup=!!report && (!report.amountKnown || (report.conventionStatus!=="verified" && report.mode!=="manual"));
 useEffect(()=>{
  setContractProvince(report?.preference.contract_province||"");
  if(report?.preference.estimation_mode==="manual"){
   setUnit(report.preference.manual_unit||"hourly");
   setValue(String(report.preference.manual_amount??""));
  }
 },[report?.preference.estimation_mode,report?.preference.manual_amount,report?.preference.manual_unit,report?.preference.contract_province]);
 const save=async(reset:boolean)=>{
  if(!userId||busy)return;
  const n=Number(value.replace(",","."));
  if(!reset&&(!value.trim()||!Number.isFinite(n)||n<0||n>100000)){
   Alert.alert("Importe no válido","Introduce un importe mayor o igual a cero.");return;
  }
  setBusy(true);
  try{
   await saveNightPreference(userId,reset?
    {estimation_mode:"automatic",manual_unit:null,manual_amount:null,contract_province:contractProvince.trim()||null}:
    {estimation_mode:"manual",manual_unit:unit,manual_amount:n,contract_province:contractProvince.trim()||null});
   setOpened(false);onUpdated?.();
  }catch(e){Alert.alert("No se pudo guardar",e instanceof Error?e.message:"Inténtalo de nuevo");}
  finally{setBusy(false);}
 };
 return <>
  {inline ? (
  <View style={{paddingVertical:10,borderTopWidth:1,borderTopColor:"#2A435E",gap:6}}>
    <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8}}>
      <View style={{flex:1}}>
        <Text style={{color:"#EAF3FF",fontSize:14,fontWeight:"600"}}>🌙 Nocturnidad</Text>
        <Text style={{color:"#AFC3D8",fontSize:11,marginTop:3}}>
          {report ? `${Math.floor((report.minutes+report.estimatedMinutes)/60)}h ${String((report.minutes+report.estimatedMinutes)%60).padStart(2,"0")}min · ${report.nightDays} jornadas` : "Calculando horas…"}
        </Text>
      </View>
      <Text style={{color:"#FFBC48",fontSize:16,fontWeight:"700"}}>
        {report ? (report.amountKnown ? eur(report.total) : "Sin referencia") : "—"}
      </Text>
    </View>
    {!!report?.estimatedMinutes && <Text style={{color:"#F3C88C",fontSize:11}}>
      Incluye {Math.floor(report.estimatedMinutes/60)}h {String(report.estimatedMinutes%60).padStart(2,"0")}min estimados
    </Text>}
    <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center",gap:8}}>
      <Text style={{color:"#AFC3D8",fontSize:11,flex:1}}>
        {report?.mode==="manual"?"Importe configurado manualmente":(report?.ruleName||"Referencia pendiente")}
      </Text>
      <Pressable onPress={()=>setOpened(true)} disabled={!userId}
        style={{borderWidth:1,borderColor:"#5E9CF1",borderRadius:8,paddingVertical:6,paddingHorizontal:10}}>
        <Text style={{color:"#DCEAFF",fontSize:12,fontWeight:"700"}}>{needsSetup?"Configurar plus":"Editar plus"}</Text>
      </Pressable>
    </View>
  </View>
  ) : (
  <View style={{borderRadius:14,borderWidth:1,borderColor:"#2C5184",backgroundColor:"#112D4C",
  padding:compact?10:14,marginVertical:5}}>
   <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8}}>
    <Text style={{fontSize:compact?13:16,fontWeight:"700",color:"#F2F7FF"}}>🌙 Nocturnidad estimada</Text>
    <Text style={{fontSize:11,fontWeight:"700",color:"#9BC7FF"}}>
     {report?.estimateLabel||"Calculando…"}
    </Text>
   </View>
   <Text style={{fontSize:12,color:"#D0E1F5",marginTop:5}}>
    {report?.mode==="manual" ? `Precio manual · ${report?.ruleName||"Convenio por verificar"}` : (report?.ruleName||"Consultando convenio…")}
   </Text>
   <View style={{flexDirection:"row",flexWrap:"wrap",gap:12,marginTop:8}}>
    <Text style={{fontSize:12,color:"#E8F1FE"}}>
     {report? `${Math.floor((report.minutes+report.estimatedMinutes)/60)}h ${String((report.minutes+report.estimatedMinutes)%60).padStart(2,"0")}min`:"—"} nocturnas
    </Text>
    <Text style={{fontSize:12,color:"#E8F1FE"}}>{report?.nightDays??"—"} jornadas</Text>
    <Text style={{fontSize:compact?15:19,fontWeight:"800",color:"#FFFFFF"}}>
     {report?report.amountKnown?eur(report.total):"Sin importe verificable":"—"}
    </Text>
   </View>
   {!!report?.estimatedMinutes&&<Text style={{fontSize:11,color:"#FFDBAA",marginTop:5}}>
     Incluye {Math.floor(report.estimatedMinutes/60)}h {String(report.estimatedMinutes%60).padStart(2,"0")}min aproximados sin actividades completas.
   </Text>}
   {needsSetup&&<Text style={{fontSize:11,color:"#FFDBAA",marginTop:5}}>
     No hay una referencia económica aplicable: configura €/hora o €/mes para estimar el plus.
   </Text>}
   <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginTop:9,gap:8}}>
    <Text style={{fontSize:10,color:"#A6BBD5",flex:1}}>
     Estimación informativa: prevalecen el convenio aplicable y la nómina oficial.
    </Text>
    <Pressable onPress={()=>setOpened(true)} disabled={!userId}
     style={{borderWidth:1,borderColor:"#5E9CF1",borderRadius:9,paddingVertical:7,paddingHorizontal:11}}>
     <Text style={{color:"#DCEAFF",fontSize:12,fontWeight:"700"}}>{needsSetup?"Configurar plus":"Editar plus"}</Text>
    </Pressable>
   </View>
  </View>
  )}
   <Modal visible={opened} transparent animationType="fade" onRequestClose={()=>setOpened(false)}>
    <View style={{flex:1,justifyContent:"center",padding:20,backgroundColor:"#0009"}}>
     <View style={{backgroundColor:"#102641",borderRadius:18,padding:20,borderColor:"#44638B",borderWidth:1,gap:12}}>
      <Text style={{color:"#FFFFFF",fontSize:18,fontWeight:"700"}}>Editar plus de nocturnidad</Text>
      <Text style={{color:"#C5D7EF",fontSize:12}}>
       Tu ajuste modifica solo la estimación. No cambia los registros ni la nómina oficial.
      </Text>
      <View style={{flexDirection:"row",gap:8}}>
       {(["hourly","monthly"] as const).map(u=><Pressable key={u} onPress={()=>setUnit(u)}
         style={{padding:10,borderRadius:9,backgroundColor:unit===u?"#2463A6":"#213955",flex:1}}>
        <Text style={{color:"#FFFFFF",fontSize:13,textAlign:"center"}}>{u==="hourly"?"€/hora":"€/mes"}</Text>
       </Pressable>)}
      </View>
      <Text style={{color:"#C5D7EF",fontSize:12}}>Provincia del convenio (si es distinta de la base)</Text>
      <Text style={{color:"#A9BBD3",fontSize:11}}>Introduce una única provincia (no varias separadas por comas). El importe manual tiene prioridad sobre la referencia automática.</Text>
      <TextInput accessibilityLabel="Provincia del convenio" value={contractProvince} onChangeText={setContractProvince}
       placeholder="Una provincia: León" placeholderTextColor="#849CB5"
       style={{borderWidth:1,borderColor:"#49698F",borderRadius:9,padding:12,color:"white",fontSize:14}}/>
      <TextInput accessibilityLabel="Importe de nocturnidad"
       placeholder={unit==="hourly"?"Precio por hora nocturna":"Importe mensual"} placeholderTextColor="#849CB5"
       keyboardType="decimal-pad" value={value} onChangeText={setValue}
       style={{borderWidth:1,borderColor:"#49698F",borderRadius:9,padding:12,color:"white",fontSize:16}}/>
      <Pressable disabled={busy} onPress={()=>void save(false)} style={{backgroundColor:"#0D79CE",borderRadius:10,padding:12}}>
       <Text style={{color:"white",textAlign:"center",fontWeight:"700"}}>{busy?"Guardando…":"Guardar importe manual"}</Text>
      </Pressable>
      <Pressable disabled={busy} onPress={()=>void save(true)} style={{padding:10}}>
       <Text style={{color:"#C5E3FF",textAlign:"center"}}>Restablecer automático</Text>
      </Pressable>
      <Pressable onPress={()=>setOpened(false)} style={{padding:8}}>
       <Text style={{color:"#AABCD0",textAlign:"center"}}>Cancelar</Text>
      </Pressable>
     </View>
    </View>
   </Modal>
  </>; 
}
