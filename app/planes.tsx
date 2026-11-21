import React from 'react';
import {ActivityIndicator,Platform,Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {router} from 'expo-router';
import {useSubscriptionAccess} from '@/lib/subscription-access';

const euro=(c:number)=>(c/100).toLocaleString('es-ES',{style:'currency',currency:'EUR'});
const date=(s:string|null|undefined)=>s?new Date(s).toLocaleDateString('es-ES'):'—';
export default function PlanesScreen(){
 const {access,loading,error,refresh}=useSubscriptionAccess();
 const tier=access.effective_plan;
 const choose=(key:'plus'|'pro')=>{
  const slug=access.audience==='founder'?(key==='plus'?'plus_existing':'pro_founder')
   :access.audience==='existing'?key+'_existing':key;
  return access.plans.find(x=>x.slug===slug);
 };
 const options=([
  {tier:'free' as const,name:'Gratis',description:'Registro de jornadas, descansos y consulta básica.'},
  {tier:'plus' as const,name:'Plus',description:'Dietas, pluses, AutoStart y seguimiento avanzado.'},
  {tier:'pro' as const,name:'Pro',description:'Todo Plus, estimación de nómina e informes.'},
 ]);
 return <View style={styles.root}>
  <ScrollView contentContainerStyle={styles.content}>
   <View style={styles.header}><Pressable onPress={()=>router.back()} accessibilityRole="button"><Text style={styles.back}>‹ Volver</Text></Pressable><Text style={styles.title}>Planes y suscripción</Text></View>
   {loading?<ActivityIndicator color="#3B82F6"/>:null}
   {error?<Text style={styles.error}>{error}</Text>:null}
   <View style={styles.status}>
    <Text style={styles.small}>ESTADO DE TU CUENTA</Text>
    <Text style={styles.current}>{!access.restrictions_enabled?'Tacoplan gratuito · todas las funciones disponibles':'Plan '+(tier==='free'?'Gratis':tier==='plus'?'Plus':'Pro')}</Text>
    {access.restrictions_enabled&&access.complimentary_plan?<Text style={styles.note}>Acceso gratuito concedido por Administración: {access.complimentary_plan.toUpperCase()}</Text>:null}
    {access.subscription?.status?<Text style={styles.note}>Suscripción en Stripe: {access.subscription.status}{access.subscription.trial_ends_at?' · Prueba hasta '+date(access.subscription.trial_ends_at):''}</Text>:null}
    {access.trial_used?<Text style={styles.note}>La prueba gratuita ya se ha utilizado; no se reinicia aunque se desactiven los planes.</Text>:
      access.trial_available?<Text style={styles.note}>Tienes una prueba gratuita disponible para Plus o Pro.</Text>:null}
    {tier==='free'&&Object.entries(access.feature_status||{}).filter(([,v])=>v?.limited).map(([key,v])=><Text key={key} style={styles.note}>
      {({diets:'Dietas y pluses',auto:'AutoStart',manual:'Actividades',reports:'Informes',notify:'Avisos',widget:'Widgets',trip:'Jornadas'} as Record<string,string>)[key]||key}: {v?.expired?'plazo gratuito finalizado':(v?.days_left??0)+' días gratuitos restantes'}
    </Text>)}

    <Pressable accessibilityRole="button" onPress={()=>void refresh()}><Text style={styles.refresh}>Actualizar mi suscripción</Text></Pressable>
   </View>
   {!access.restrictions_enabled?<Text style={styles.intro}>La administración todavía no ha activado las restricciones. Ninguna función de Tacoplan se bloquea por el plan.</Text>
    :<Text style={styles.intro}>Las funciones se habilitan según tu suscripción o el acceso gratuito que te conceda el administrador.</Text>}
   {options.map(option=>{
    const p=option.tier==='free'?null:choose(option.tier);
    const active=tier===option.tier;
    return <View key={option.tier} style={[styles.card,active&&styles.selected]}>
     <View style={styles.line}><Text style={styles.plan}>{option.name}</Text>{active?<Text style={styles.tag}>Tu plan</Text>:null}</View>
     <Text style={styles.price}>{p?euro(p.monthly_cents)+'/mes':'0 €'}</Text>
     {p?.annual_cents!=null?<Text style={styles.subprice}>Anual: {euro(p.annual_cents)}</Text>:null}
     <Text style={styles.description}>{option.description}</Text>
     {p&&p.trial_days>0?<Text style={styles.trial}>{access.trial_available?p.trial_days+" días de prueba gratuita disponibles":"Prueba gratuita ya utilizada o no disponible"}</Text>:null}
    </View>;
   })}
   <View style={styles.footer}>
    <Text style={styles.footerTitle}>Contratación y cancelación</Text>
    <Text style={styles.note}>Los cobros no se realizan desde esta pantalla. Consulta y gestiona tus suscripciones desde MiTacoplan web. En iPhone y Android, los pagos dentro de la aplicación se habilitarán únicamente mediante el sistema permitido por cada tienda.</Text>
    <Text style={styles.note}>Tus jornadas y descansos nunca se borrarán al cambiar de plan.</Text>
   </View>
  </ScrollView>
 </View>;
}
const styles=StyleSheet.create({
 root:{flex:1,backgroundColor:'#071625'},
 content:{padding:18,paddingBottom:48,gap:14},
 header:{gap:10,marginTop:Platform.OS==='ios'?12:16,marginBottom:7},
 back:{color:'#93C5FD',fontSize:16},
 title:{color:'#FFFFFF',fontSize:27,fontWeight:'800'},
 status:{backgroundColor:'#123154',borderWidth:1,borderColor:'#245E95',padding:18,borderRadius:18,gap:8},
 small:{color:'#93C5FD',fontSize:11,fontWeight:'800',letterSpacing:1},
 current:{color:'white',fontWeight:'800',fontSize:18},
 note:{color:'#B6CDE4',fontSize:13,lineHeight:20},
 refresh:{color:'#60A5FA',fontWeight:'700',marginTop:7},
 intro:{fontSize:14,color:'#B7CCE2',lineHeight:21,marginVertical:4},
 card:{backgroundColor:'#10263E',borderColor:'#263E5C',borderWidth:1,borderRadius:17,padding:18,gap:8},
 selected:{borderColor:'#3B82F6',borderWidth:2},
 line:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},
 plan:{fontSize:21,fontWeight:'800',color:'#F8FAFC'},
 tag:{color:'#BAE6FD',backgroundColor:'#14538A',paddingHorizontal:10,paddingVertical:5,borderRadius:14,fontWeight:'700',fontSize:11},
 price:{color:'#FFFFFF',fontSize:26,fontWeight:'800'},
 subprice:{color:'#93C5FD',fontSize:13},
 description:{color:'#C8D9EC',fontSize:14,lineHeight:21},
 trial:{color:'#93C5FD',fontSize:12},
 footer:{padding:18,backgroundColor:'#10263E',borderRadius:17,gap:10,marginTop:6},
 footerTitle:{color:'white',fontSize:16,fontWeight:'800'},
 error:{color:'#FCA5A5',fontSize:13},
});
