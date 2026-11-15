import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";
import { userScopedKey } from "@/lib/user-scope";

const SETTINGS_KEY="tacoplan_user_settings";
const PERIOD_KEY="tacoplan_period_config";
const FERRY_KEY="tacoplan_ferry_config";
const ONBOARDING_KEY="tacoplan_onboarding_completed";

// Mobile settings are stored locally as well as in Supabase. Enterprise
// configuration is authoritative and must override stale device defaults.
export async function hydrateCompanyDriver(userId:string):Promise<boolean>{
 const session=await supabase.auth.getSession();
 const bearer=session.data.session?.access_token;
 if(!bearer)return false;
 const ctrl=new AbortController();
 const timeout=setTimeout(()=>ctrl.abort(),6500);
 let managed=false;
 try {
  const response=await fetch("https://tacoplan.es/api/empresas/native-activate",{
   method:"POST",headers:{Authorization:"Bearer "+bearer,"Content-Type":"application/json"},
   body:"{}",signal:ctrl.signal,
  });
  if(!response.ok){
   const data=await response.json().catch(()=>({}));
   console.warn("[ENTERPRISE] Company onboarding pending:",data.error||response.status);
   return false;
  }
  managed=(await response.json()).managed===true;
 }catch(e){console.warn("[ENTERPRISE] Company activation offline",e);return false;}
 finally{clearTimeout(timeout);}
 if(!managed)return false;
 const [p,r,x,f]=await Promise.all([
  supabase.from("profiles").select("display_name,driver_profile,operation_zone,trip_types,payment_mode,price_per_km,price_per_km_nacional,price_per_km_internacional,price_per_km_regional,price_per_trip,price_per_trip_nacional,price_per_trip_internacional,price_per_trip_regional,period_type,period_start_day,period_end_day,base_name,base_city,base_country,base_address,base_latitude,base_longitude,base_radius_km,onboarding_completed").eq("id",userId).maybeSingle(),
  supabase.from("user_diet_rates").select("trip_type,percent,amount").eq("user_id",userId),
  supabase.from("user_day_extras").select("extra_saturday,extra_sunday,extra_holiday,offsite_weekly_reduced_nacional,offsite_weekly_reduced_internacional,offsite_weekly_complete_nacional,offsite_weekly_complete_internacional").eq("user_id",userId).maybeSingle(),
  supabase.from("user_ferry_config").select("crosses_ferry,route_mode,payment_mode,trip_rate,pernight_rate,ferry_rest_enabled").eq("user_id",userId).maybeSingle(),
 ]);
 if(p.error||r.error||x.error||f.error||!p.data||p.data.onboarding_completed!==true){
  console.warn("[ENTERPRISE] Native config incomplete; keep normal onboarding flow",p.error||r.error||x.error||f.error);
  return false;
 }
 if(!p.data.base_name||!p.data.base_city||!p.data.base_country)return false;
 const settingsKey=await userScopedKey(SETTINGS_KEY,userId);
 const original=await AsyncStorage.getItem(settingsKey);
 let settings:Record<string,any>={};
 try{settings=original?JSON.parse(original):{};}catch{}
 const profile=p.data as Record<string,any>;
 for(const [key,val] of Object.entries(profile)){
  if(key==="onboarding_completed")continue;
  if(val!==undefined&&val!==null){
   const outKey=key==="display_name"?"driver_name":key;
   settings[outKey]=typeof val==="number"?String(val):val;
  }
 }
 for(const item of r.data||[]){
  const prefix=item.trip_type==="NACIONAL"?"nac":item.trip_type==="REGIONAL"?"reg":"intl";
  settings[prefix+"_"+item.percent]=String(item.amount??0);
 }
 const extras=x.data as Record<string,any>|null;
 if(extras)for(const [key,val] of Object.entries(extras))settings[key]=String(val??0);
 await AsyncStorage.setItem(settingsKey,JSON.stringify({...settings,_enterprise_managed:true,_enterprise_synced_at:new Date().toISOString()}));
 const mode=profile.period_type;
 if(mode){
  await AsyncStorage.setItem(await userScopedKey(PERIOD_KEY,userId),JSON.stringify({
   mode,manualFrom:profile.period_start_day??1,manualTo:profile.period_end_day??30
  }));
 }
 if(f.data){
  const ferry=f.data as Record<string,any>;
  await AsyncStorage.setItem(await userScopedKey(FERRY_KEY,userId),JSON.stringify({
   crossesFerry:!!ferry.crosses_ferry,routeMode:ferry.route_mode,paymentMode:ferry.payment_mode,
   tripRate:Number(ferry.trip_rate)||0,pernightRate:Number(ferry.pernight_rate)||0,ferryRestEnabled:!!ferry.ferry_rest_enabled
  }));
 }
 await AsyncStorage.setItem(await userScopedKey(ONBOARDING_KEY,userId),JSON.stringify({
  completed:true,source:"company",completedAt:new Date().toISOString()
 }));
 return true;
}
