import React from 'react';
import {ActivityIndicator,Pressable,StyleSheet,Text,View} from 'react-native';
import {router} from 'expo-router';
import {useSubscriptionAccess} from '@/lib/subscription-access';
export default function SubscriptionGate({tier,children}:{tier:'plus'|'pro';children:React.ReactNode}){
 const {access,loading,error,refresh}=useSubscriptionAccess();
 const allowed=!access.restrictions_enabled||(tier==='plus'?access.plus_access:access.pro_access);
 if(allowed)return <>{children}</>;
 return <View style={styles.wrap}>
  <Text style={styles.icon}>🔒</Text>
  <Text style={styles.title}>Función incluida en {tier==='plus'?'Plus o Pro':'Pro'}</Text>
  <Text style={styles.desc}>El administrador ha activado las restricciones de planes. Tu historial y tus jornadas se conservan.</Text>
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
