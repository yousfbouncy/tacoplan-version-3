import React from 'react';
import {ActivityIndicator,Pressable,StyleSheet,Text,View} from 'react-native';
import {router} from 'expo-router';
import {useSubscriptionAccess,type FeatureKey} from '@/lib/subscription-access';
export default function SubscriptionGate({tier,feature,children}:{tier:'plus'|'pro';feature?:FeatureKey;children:React.ReactNode}){
 const {access,loading,error,refresh}=useSubscriptionAccess();
 const allowed=!access.restrictions_enabled||(feature?access.features[feature]===true:(tier==='plus'?access.plus_access:access.pro_access));
 const limit=feature?access.feature_status[feature]:null;
 if(allowed)return <>{children}</>;
 if(loading&&!error)return <View style={styles.wrap}><ActivityIndicator size="large" color="#60A5FA"/><Text style={styles.desc}>Comprobando acceso a esta función…</Text></View>;
 return <View style={styles.wrap}>
  <Text style={styles.icon}>🔒</Text>
  <Text style={styles.title}>{limit?.expired?'Periodo gratis finalizado':`Función incluida en ${tier==='plus'?'Plus o Pro':'Pro'}`}</Text>
  <Text style={styles.desc}>{limit?.expired?'Has disfrutado del plazo gratuito de esta función. Puedes continuar con un plan que la incluya.':'Esta función no está incluida actualmente en tu plan Gratis.'} Tu historial y tus jornadas se conservan.</Text>
  {access.trial_available?<Text style={styles.desc}>Todavía tienes disponible una prueba gratuita de un plan superior.</Text>:null}
  <Pressable style={styles.button} onPress={()=>router.push('/planes' as any)}>
   <Text style={styles.buttonText}>Ver mi plan</Text>
  </Pressable>
  <Pressable onPress={()=>void refresh()} style={styles.refresh}>
   <Text style={styles.refreshText}>{loading?'Comprobando…':'Actualizar permisos'}</Text>
  </Pressable>
  {error?<Text style={styles.warning}>{error}</Text>:null}
 </View>;
}
const styles=StyleSheet.create({
 wrap:{flex:1,justifyContent:'center',alignItems:'center',padding:24,backgroundColor:'#071625',gap:16},
 icon:{fontSize:40},
 title:{fontSize:22,fontWeight:'800',color:'#FFFFFF',textAlign:'center'},
 desc:{fontSize:14,lineHeight:21,color:'#B8CEE4',textAlign:'center'},
 button:{paddingHorizontal:24,paddingVertical:14,backgroundColor:'#1976D2',borderRadius:12},
 buttonText:{fontWeight:'700',color:'white'},
 refresh:{padding:12},refreshText:{color:'#8BC5FF',fontWeight:'600'},
 warning:{color:'#FCA5A5',fontSize:12,textAlign:'center'}
});
