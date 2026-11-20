import {supabase} from "@/lib/supabase";

// Check subscriptions in the background without importing React or expo-router.
// The API remains authoritative; a failed check never enables premium GPS automation.
const API="https://www.tacoplan.es/api/driver/subscription";
const CACHE_MS=60_000;
let cache:{userId:string;allowed:boolean;at:number}|null=null;

export async function canRunPaidAutomation(userId:string):Promise<boolean>{
  if(!userId)return false;
  if(cache?.userId===userId&&Date.now()-cache.at<CACHE_MS)return cache.allowed;
  try{
    const {data,error}=await supabase.auth.getSession();
    if(error||!data.session?.access_token||data.session.user.id!==userId)return false;
    const response=await fetch(API,{
      headers:{Authorization:"Bearer "+data.session.access_token,"Cache-Control":"no-cache"}
    });
    if(!response.ok)return false;
    const access=await response.json();
    const allowed=access.restrictions_enabled!==true ||
      (access.features && typeof access.features.auto==='boolean'
        ? access.features.auto===true && access.free_plan_expired!==true
        : access.plus_access===true);
    cache={userId,allowed,at:Date.now()};
    return allowed;
  }catch{return false;}
}
