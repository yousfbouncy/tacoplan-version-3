import {useEffect,useState} from "react";
import {View,Text,Switch,Alert} from "react-native";
import {supabase} from "@/lib/supabase";
import Colors from "@/constants/driver-theme";

export default function EmailMarketingPreference({userId}:{userId:string|null}){
 const [enabled,setEnabled]=useState(false),[loaded,setLoaded]=useState(false),[saving,setSaving]=useState(false);
 useEffect(()=>{
  let active=true;setLoaded(false);setEnabled(false);
  if(!userId)return;
  void supabase.from("tp_email_preferences").select("marketing_enabled").eq("user_id",userId).maybeSingle().then(({data,error})=>{
   if(active&&!error){setEnabled(data?.marketing_enabled===true);setLoaded(true);}
  });
  return()=>{active=false;};
 },[userId]);
 const update=async(value:boolean)=>{
  if(!userId||saving||!loaded)return;
  setSaving(true);
  try{
   const {error}=await supabase.rpc("tp_set_email_preference",{p_enabled:value});
   if(error)throw error;
   setEnabled(value);
  }catch{Alert.alert("No se pudo guardar","Inténtalo de nuevo cuando tengas conexión.");}
  finally{setSaving(false);}
 };
 return <View style={{borderWidth:1,borderColor:"#CBD5E1",borderRadius:12,padding:12,marginVertical:12,gap:6}}>
 <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8}}>
 <Text style={{flex:1,color:Colors.light.text,fontFamily:"Inter_600SemiBold",fontSize:14}}>Ofertas y novedades por correo</Text>
 <Switch accessibilityLabel="Autorizar correos comerciales de Tacoplan" value={enabled} disabled={!loaded||saving} onValueChange={v=>{void update(v);}}/>
 </View>
 <Text style={{color:Colors.light.textSecondary,fontSize:12}}>Acepto recibir recordatorios, novedades y ofertas de Tacoplan por correo electrónico. Es opcional y puedo darme de baja cuando quiera. Los avisos necesarios de mi cuenta son independientes.</Text>
 {!loaded&&<Text style={{color:Colors.light.textSecondary,fontSize:12}}>Preferencia no disponible hasta comprobar tu cuenta.</Text>}
 </View>;
}
