import React, {useEffect,useState} from "react";
import {View,Text,TextInput,Pressable,ActivityIndicator,StyleSheet,KeyboardAvoidingView,Platform} from "react-native";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import {supabase} from "@/lib/supabase";
import Colors from "@/constants/colors";

type Props={userId:string;children:React.ReactNode};
async function decide(userId:string,action:"check"|"claim"|"skip",code?:string){
 const {data:{session}}=await supabase.auth.getSession();
 if(!session||session.user.id!==userId)throw Error("Sesión no disponible");
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),8000);
 try{
  const response=await fetch("https://tacoplan.es/api/referrals/onboarding",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+session.access_token},body:JSON.stringify({action,code}),signal:controller.signal});
  const result=await response.json();
  if(!response.ok&&result.status!=="invalid_code")throw Error("Servicio no disponible");
  return result.status as string;
 }finally{clearTimeout(timeout);}
}
export default function ReferralOnboardingGate({userId,children}:Props){
 const [state,setState]=useState<"checking"|"prompt"|"done"|"unavailable">("checking");
 const [busy,setBusy]=useState(false);
 const [code,setCode]=useState("");
 const [error,setError]=useState("");
 const insets=useSafeAreaInsets();
 useEffect(()=>{
  let active=true;setState("checking");
  void decide(userId,"check").then(status=>{if(active)setState(status==="eligible"?"prompt":"done");}).catch(()=>{if(active)setState("unavailable");});
  return()=>{active=false;};
 },[userId]);
 const submit=async(action:"claim"|"skip")=>{
  if(busy)return;
  if(action==="claim"&&!/^[A-Z0-9]{12}$/.test(code)){setError("Introduce un código de 12 caracteres.");return;}
  setBusy(true);setError("");
  try{
   const result=await decide(userId,action,code);
   if(["settled","disabled","ineligible"].includes(result))setState("done");
   else setError("El código no es válido. Compruébalo o continúa sin código.");
  }catch{setError("No se pudo conectar. Inténtalo de nuevo.");}
  finally{setBusy(false);}
 };
 if(state==="done")return <>{children}</>;
 if(state==="checking")return <View style={s.center}><ActivityIndicator color={Colors.light.tint}/></View>;
 return <KeyboardAvoidingView behavior={Platform.OS==="ios"?"padding":undefined} style={[s.center,{paddingTop:insets.top+20,paddingBottom:insets.bottom+20}]}>
  <View style={s.card}>
   <Text style={s.title}>¿Te han recomendado Tacoplan?</Text>
   <Text style={s.body}>Si otro conductor te ha invitado, introduce su código antes de empezar la configuración. Es opcional y solo se puede registrar una vez.</Text>
   {state==="unavailable"?<><Text style={s.body}>No se ha podido comprobar el programa de recomendaciones.</Text><Pressable style={s.primary} onPress={()=>{setState("checking");void decide(userId,"check").then(x=>setState(x==="eligible"?"prompt":"done")).catch(()=>setState("unavailable"));}}><Text style={s.primaryText}>Reintentar</Text></Pressable><Pressable onPress={()=>setState("done")} style={s.secondary}><Text style={s.body}>Continuar con la configuración</Text></Pressable></>:<>
   <TextInput accessibilityLabel="Código de recomendación" value={code} onChangeText={v=>setCode(v.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,12))} placeholder="Código de invitación" placeholderTextColor="#94A3B8" autoCapitalize="characters" autoCorrect={false} maxLength={12} editable={!busy} style={s.input}/>
   {!!error&&<Text accessibilityRole="alert" style={s.error}>{error}</Text>}
   <Pressable disabled={busy||code.length!==12} onPress={()=>void submit("claim")} style={[s.primary,{opacity:busy||code.length!==12?0.5:1}]}><Text style={s.primaryText}>{busy?"Comprobando…":"Confirmar código"}</Text></Pressable>
   <Pressable disabled={busy} onPress={()=>void submit("skip")} style={s.secondary}><Text style={s.body}>No tengo código · continuar</Text></Pressable></>}
  </View>
 </KeyboardAvoidingView>;
}
const s=StyleSheet.create({center:{flex:1,backgroundColor:Colors.light.background,justifyContent:"center",padding:24},card:{padding:22,borderRadius:20,backgroundColor:Colors.light.surface,gap:14},title:{fontSize:23,fontWeight:"700",color:Colors.light.text},body:{fontSize:14,lineHeight:21,color:Colors.light.text},input:{borderWidth:1,borderColor:"#94A3B8",borderRadius:10,padding:12,fontSize:16,color:Colors.light.text},primary:{padding:14,borderRadius:10,backgroundColor:"#1D4ED8",alignItems:"center"},primaryText:{color:"#fff",fontWeight:"700"},secondary:{padding:12,alignItems:"center"},error:{color:"#DC2626",fontSize:13}});
