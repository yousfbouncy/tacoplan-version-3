import {supabase} from "@/lib/supabase";
export async function readEmailChoice(userId:string):Promise<boolean|null>{
 const {data,error}=await supabase.from("tp_email_preferences").select("marketing_enabled").eq("user_id",userId).maybeSingle();
 if(error)throw error;
 return data ? data.marketing_enabled===true : null;
}
// Insert only: never replace a choice saved on another device or in settings.
export async function recordInitialEmailChoice(userId:string,enabled:boolean){
 const {error}=await supabase.from("tp_email_preferences").upsert({user_id:userId,marketing_enabled:enabled},{onConflict:"user_id",ignoreDuplicates:true});
 if(error)throw error;
}
