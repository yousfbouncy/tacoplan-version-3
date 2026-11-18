import {useCallback,useState} from 'react';
import {useFocusEffect} from 'expo-router';
import {supabase} from '@/lib/supabase';

export type PlanTier='free'|'plus'|'pro';
export type PlanAccess={
 restrictions_enabled:boolean;
 all_features_unlocked:boolean;
 effective_plan:PlanTier;
 plus_access:boolean;
 pro_access:boolean;
 complimentary_plan:PlanTier|null;
 billing_enabled:boolean;
 subscription:{status:string;trial_ends_at?:string|null;current_period_end?:string|null}|null;
 plans:Array<{slug:string;monthly_cents:number;annual_cents:number|null;trial_days:number}>;
 audience:string;
};
const FREE_MODE:PlanAccess={
 restrictions_enabled:false,all_features_unlocked:true,effective_plan:'free',
 plus_access:true,pro_access:true,complimentary_plan:null,billing_enabled:false,
 subscription:null,plans:[],audience:'standard'
};
const API='https://www.tacoplan.es/api/driver/subscription';

// The server is authoritative for permissions and applies the global admin switch.
// Fail-safe for unavailable API: never lock drivers out of their existing data while
// plans are not confirmed enabled. Cloud features must still authorize on the server.
export async function readSubscriptionAccess():Promise<PlanAccess>{
 const {data,error}=await supabase.auth.getSession();
 if(error||!data.session?.access_token)return FREE_MODE;
 const resp=await fetch(API,{headers:{Authorization:'Bearer '+data.session.access_token,'Cache-Control':'no-cache'}});
 if(!resp.ok)throw new Error('No se pudo comprobar el estado de la suscripción');
 const p=await resp.json();
 return {
  restrictions_enabled:p.restrictions_enabled===true,
  all_features_unlocked:p.restrictions_enabled!==true,
  effective_plan:['plus','pro'].includes(p.effective_plan)?p.effective_plan:'free',
  plus_access:p.restrictions_enabled!==true||p.plus_access===true,
  pro_access:p.restrictions_enabled!==true||p.pro_access===true,
  complimentary_plan:p.complimentary_plan==='pro'||p.complimentary_plan==='plus'?p.complimentary_plan:null,
  billing_enabled:p.billing_enabled===true,
  subscription:p.subscription||null,
  plans:Array.isArray(p.plans)?p.plans:[],
  audience:p.audience||'standard',
 };
}

export function useSubscriptionAccess(){
 const [access,setAccess]=useState<PlanAccess>(FREE_MODE);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const refresh=useCallback(async()=>{
  setLoading(true);
  try{setAccess(await readSubscriptionAccess());setError('');}
  catch{setError('No se ha podido actualizar el estado del plan. Comprueba tu conexión.');}
  finally{setLoading(false);}
 },[]);
 useFocusEffect(useCallback(()=>{void refresh();},[refresh]));
 return {access,loading,error,refresh};
}
