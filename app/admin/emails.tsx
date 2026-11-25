import {useAuth} from "@/lib/auth-context";
import {View,Text,Pressable,Linking,ScrollView,Alert,StyleSheet} from "react-native";
import {router} from "expo-router";
import {useSafeAreaInsets} from "react-native-safe-area-context";
export default function AdminEmails(){
 const {isAdmin,isAdminLoading}=useAuth(),insets=useSafeAreaInsets();
 const open=async()=>{try{await Linking.openURL("https://www.tacoplan.es/desarrollo?tab=emails");}catch{Alert.alert("Error","No se pudo abrir el panel web.");}};
 return <View style={[s.root,{paddingTop:insets.top+12}]}><Pressable onPress={()=>router.back()}><Text style={s.link}>‹ Volver</Text></Pressable>
 <ScrollView contentContainerStyle={{gap:14,paddingBottom:insets.bottom+24}}>
 <Text style={s.title}>Correos automáticos</Text>
 {isAdminLoading?<Text style={s.muted}>Comprobando permisos…</Text>:!isAdmin?<Text style={s.muted}>Acceso restringido.</Text>:<>
 <View style={s.card}><Text style={s.heading}>Automatizaciones de correo</Text><Text style={s.muted}>Gestiona la bienvenida, primera jornada, inactividad, fin de prueba, pagos, suscripciones pendientes y ofertas desde el panel privado de Tacoplan.</Text><Text style={s.muted}>La configuración y los resultados se guardan en el servidor. No es necesario dejar la aplicación abierta.</Text><Pressable onPress={()=>{void open();}} style={s.button}><Text style={s.buttonText}>Gestionar correos en Desarrollo</Text></Pressable></View>
 <View style={s.card}><Text style={s.heading}>Envíos responsables</Text><Text style={s.muted}>Máximo un correo por usuario cada 24 horas. Las comunicaciones comerciales requieren autorización y ofrecen una opción de baja. Los avisos de servicio se gestionan por separado.</Text></View>
 </>}
 </ScrollView></View>;
}
const s=StyleSheet.create({root:{flex:1,backgroundColor:"#0B1423",paddingHorizontal:16,gap:14},title:{fontSize:26,fontWeight:"700",color:"#F8FAFC"},heading:{fontSize:17,fontWeight:"700",color:"#F8FAFC"},muted:{fontSize:14,lineHeight:21,color:"#A9B8CD"},link:{fontSize:15,color:"#79B9FF"},card:{padding:16,backgroundColor:"#142238",borderRadius:14,gap:10},button:{padding:12,backgroundColor:"#2563EB",borderRadius:10},buttonText:{textAlign:"center",fontWeight:"600",color:"#FFFFFF"}});
