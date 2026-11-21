import {supabase} from "./supabase";

/** Verified published provincial rules. No invented fallback wage percentage. */
export type NightRule={
 id:string;country_code:string;province:string;title:string;
 night_from:string;night_to:string;timezone:string;
 calculation_mode:"monthly_percent"|"hourly_percent"|"hourly_fixed"|"daily_fixed"|"monthly_fixed"|"monthly_percent_prorated";
 percent:number|null;fixed_amount:number|null;reference_monthly_hours:number|null;
 monthly_proration:"none"|"days_with_night"|"calendar_days";
 source_url:string;source_article:string|null;
};
export type NightPreference={
 estimation_mode:"automatic"|"manual";manual_unit:"hourly"|"monthly"|null;manual_amount:number|null;
 contract_province:string|null;enabled:boolean;
};
export type NightProfile={base_city?:string|null;base_country?:string|null;base_name?:string|null;base_address?:string|null;payroll_config?:Record<string,unknown>|null};
export type NightResolved={rule:NightRule|null;preference:NightPreference;province:string|null;status:"verified"|"pending"|"missing_location";payroll:Record<string,unknown>};
export type NightBonusEstimate={total:number|null;monthly:number|null;minutes:number;nightDays:number;mode:"automatic"|"manual";label:string;ruleName:string;requiresReview:boolean};

const norm=(s:unknown)=>String(s??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/gi," ").toLowerCase().trim();
const cash=(x:number)=>Math.round((x+Number.EPSILON)*100)/100;
const num=(x:unknown)=>{const n=Number(String(x??"").replace(",","."));return Number.isFinite(n)&&n>=0?n:0;};
export const userProvince=(s:string)=>norm(s);
export const monthlyBase=(payroll:Record<string,unknown>,override?:unknown)=>{
 const v=num(override);if(v>0)return v;
 const base=num(payroll.salario_base_bruto);
 return payroll.fixed_unit==="day"?base*30:base;
};
const normalCountry=(input:unknown)=>{const country=norm(input);return country==="espana"||country==="es"||country==="spain"||country.startsWith("espan")?"ES":country==="portugal"||country==="pt"?"PT":null;};

export function estimateNightBonus(params:{
 rule:NightRule|null;preference:NightPreference;payroll:Record<string,unknown>;
 minutes:number;nightDays:number;from:string;to:string;
}):NightBonusEstimate {
 const {rule,preference,payroll,from,to}=params;
 const minutes=Math.max(0,Math.round(params.minutes));
 const nightDays=Math.max(0,Math.floor(params.nightDays));
 const mode=preference.estimation_mode==="manual"?"manual":"automatic";
 const label=mode==="manual"?"Editado manualmente":"Automático";
 const ruleName=rule?.title||"Convenio pendiente de verificar";
 if(!minutes&&!nightDays)return {total:0,monthly:0,minutes,nightDays,mode,label,ruleName,requiresReview:false};
 // Every period is an inclusive range. A 21st-to-20th cycle is one payroll
 // period even though it touches two calendar months.
 const span=Math.max(1,Math.round((Date.parse(to+"T12:00:00Z")-Date.parse(from+"T12:00:00Z"))/86400000)+1);
 const payrollMonths=span<=31?1:span/30;
 if(mode==="manual"){
   const rate=num(preference.manual_amount);
   const monthly=preference.manual_unit==="monthly"?rate:null;
   const total=preference.manual_unit==="hourly"?cash(rate*minutes/60):cash(rate*payrollMonths);
   return {total,monthly,minutes,nightDays,mode,label,ruleName,requiresReview:false};
 }
 if(!rule)return {total:null,monthly:null,minutes,nightDays,mode,label,ruleName,requiresReview:true};
 const salary=monthlyBase(payroll,payroll.night_salary_base_monthly);
 const fraction=num(rule.percent)/100,flat=num(rule.fixed_amount);
 let total:number|null=null,monthly:number|null=null;
 switch(rule.calculation_mode){
   case "hourly_percent":
     total=salary>0&&num(rule.reference_monthly_hours)>0
       ?cash((salary/num(rule.reference_monthly_hours))*fraction*(minutes/60)):null;
     break;
   case "hourly_fixed":total=cash(flat*minutes/60);break;
   case "daily_fixed":total=cash(flat*nightDays);break;
   case "monthly_fixed":monthly=flat;total=cash(flat*payrollMonths);break;
   case "monthly_percent":monthly=salary>0?cash(salary*fraction):null;total=monthly===null?null:cash(monthly*payrollMonths);break;
   case "monthly_percent_prorated":{
     monthly=salary>0?cash(salary*fraction):null;
     if(monthly!==null){
       const divisor=rule.monthly_proration==="calendar_days"?span:Math.max(1,Math.min(30,span));
       total=cash(monthly*nightDays/divisor);
     }break;
   }
 }
 return {total,monthly,minutes,nightDays,mode,label,ruleName,requiresReview:total===null};
}

export async function resolveNightConvention(userId:string,profile?:NightProfile):Promise<NightResolved>{
 const [p,s,aliases,rules]=await Promise.all([
   profile?Promise.resolve({data:profile,error:null}):supabase.from("profiles").select("base_city,base_country,base_name,base_address,payroll_config").eq("id",userId).maybeSingle(),
   supabase.from("user_night_work_settings").select("estimation_mode,manual_unit,manual_amount,contract_province,enabled").eq("user_id",userId).maybeSingle(),
   supabase.from("night_convention_city_aliases").select("city_key,province,country_code"),
   supabase.from("night_convention_rules").select("*").eq("verification_status","verified"),
 ]);
 const prof=(p.data||{}) as NightProfile;
 const payroll=(prof.payroll_config||{}) as Record<string,unknown>;
 const pref:NightPreference={
   estimation_mode:s.data?.estimation_mode==="manual"?"manual":"automatic",
   manual_unit:s.data?.manual_unit==="hourly"||s.data?.manual_unit==="monthly"?s.data.manual_unit:null,
   manual_amount:s.data?.manual_amount==null?null:num(s.data.manual_amount),
   contract_province:s.data?.contract_province||null,
   enabled:s.data?.enabled!==false,
 };
 const country=normalCountry(prof.base_country);
 const city=norm(prof.base_city);
 const name=norm(prof.base_name);
 const declared=norm(pref.contract_province||payroll.convenio_provincia||payroll.convenio_province||payroll.convenio);
 const lookup=[...(aliases.data||[])];
 // Explicit contract convenio overrides location; home address is never
 // used to silently replace a declared agreement.
 let province=lookup.find(x=>norm(x.province)===declared)?.province
   ||(declared==="leon"?"León":declared==="barcelona"?"Barcelona":null);
 if(!province)province=lookup.find(x=>norm(x.city_key)===city||norm(x.city_key)===name)?.province||null;
 if(!province&&city)province=lookup.find(x=>norm(x.province)===city)?.province||null;
 const now=new Date().toISOString().slice(0,10);
 const rule=country==="ES"&&province
  ?((rules.data||[]) as NightRule[]).filter(x=>norm(x.province)===norm(province)&&x.country_code==="ES"
      &&String((x as any).valid_from)<=now&&(!((x as any).valid_to)||String((x as any).valid_to)>=now))
     .sort((a,b)=>String((b as any).valid_from).localeCompare(String((a as any).valid_from)))[0]||null:null;
 const status=rule?"verified":country&&city?"pending":"missing_location";
 if(status==="pending"){
   // Never let an AI-generated legal guess become a verified wage rule.
   // A worker/process may research requests and publish sourced, reviewed rules.
   void supabase.from("night_convention_research_requests").upsert({
     user_id:userId,country_code:country||"OTHER",province,city:city||name,status:"pending"
   },{onConflict:"user_id,city",ignoreDuplicates:true});
   // Authenticated server function performs source research only when an AI
   // provider is configured. It never activates unverified legal parameters.
   if(country==="ES")void supabase.functions.invoke("research-night-convention",{body:{}})
    .catch(()=>{});
 }
 return {rule,preference:pref,province,status,payroll};
}
export async function saveNightPreference(userId:string,changes:Partial<NightPreference>){
 const update={user_id:userId,...changes,updated_at:new Date().toISOString()};
 const {error}=await supabase.from("user_night_work_settings").upsert(update,{onConflict:"user_id"});
 if(error)throw error;
}
