import {useCallback,useState} from 'react';
import {useFocusEffect} from 'expo-router';
import {supabase} from '@/lib/supabase';

export type PlanTier='free'|'plus'|'pro';
export type FeatureKey='auto'|'diets'|'manual'|'notify'|'reports'|'trip'|'widget';
export type PlanFeatures=Record<FeatureKey,boolean>;
const FEATURE_KEYS:FeatureKey[]=['auto','diets','manual','notify','reports','trip','widget'];
const FREE_FEATURES:PlanFeatures={auto:false,diets:true,manual:false,notify:true,reports:false,trip:true,widget:true};
export type PlanAccess={
 restrictions_enabled:boolean;
 features:PlanFeatures;
 history_days:number|null;
 free_plan_expired:boolean;
 free_plan_expires_at:string|null;
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
 restrictions_enabled:true,all_features_unlocked:false,effective_plan:'free',
 features:FREE_FEATURES,history_days:14,free_plan_expired:false,free_plan_expires_at:null,
 plus_access:false,pro_access:false,complimentary_plan:null,billing_enabled:false,
 subscription:null,plans:[],audience:'standard'
};
const API='https://www.tacoplan.es/api/driver/subscription';

// The server is authoritative for permissions and applies the global admin switch.
// The unverified initial state exposes basic features only. Keep successful plan
// permissions in memory if a subsequent refresh fails; never delete driver records.
export async function readSubscriptionAccess():Promise<PlanAccess>{
 const {data,error}=await supabase.auth.getSession();
 if(error||!data.session?.access_token)return FREE_MODE;
 const resp=await fetch(API,{headers:{Authorization:'Bearer '+data.session.access_token,'Cache-Control':'no-cache'}});
 if(!resp.ok)throw new Error('No se pudo comprobar el estado de la suscripción');
 const p=await resp.json();
 const restrictions=p.restrictions_enabled===true;
 const effectivePlan:PlanTier=['plus','pro'].includes(p.effective_plan)?p.effective_plan:'free';
 const fallbackFeatures:PlanFeatures=restrictions&&effectivePlan==='free'?FREE_FEATURES:
  {auto:true,diets:true,manual:true,notify:true,reports:true,trip:true,widget:true};
 const policyFeatures=p.features&&typeof p.features==='object'&&
  FEATURE_KEYS.every(k=>typeof p.features[k]==='boolean')?p.features as PlanFeatures:null;
 const historyDays=p.policy?.history_days;
 return {
  features:restrictions&&policyFeatures?policyFeatures:fallbackFeatures,
  history_days:restrictions?(historyDays===null?null:(Number.isInteger(historyDays)&&historyDays>0?historyDays:(effectivePlan==='free'?14:effectivePlan==='plus'?90:null))):null,
  free_plan_expired:p.free_plan_expired===true,
  free_plan_expires_at:typeof p.free_plan_expires_at==='string'?p.free_plan_expires_at:null,
  restrictions_enabled:restrictions,
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
