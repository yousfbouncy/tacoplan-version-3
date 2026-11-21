import {loadDriverActivities} from "./driver-activities";
import {supabase} from "./supabase";
import {nightWorkForShift,type NightConfig,type NightDetail,type NightShift} from "./night-work";
import {estimateNightBonus,resolveNightConvention,type NightResolved} from "./night-estimator";

export type NightPeriodReport={
 monthly:number;total:number;amountKnown:boolean;minutes:number;estimatedMinutes:number;nightDays:number;
 months:string[];partial:boolean;byShift:Record<string,NightDetail>;
 rule:NightResolved["rule"];preference:NightResolved["preference"];
 conventionStatus:NightResolved["status"];province:string|null;mode:"automatic"|"manual";
 estimateLabel:string;ruleName:string;
};
type SavedRow={shift_id:string;night_work_minutes:number;night_window_minutes:number;is_estimated:boolean};

/** Existing shifts: prefer RLS-protected server calculations. New unsynced
 * shifts: derive from local segments and sync the evidence, not a salary payment.
 * Only active periods are loaded. No one else's shifts can be selected. */
export async function loadNightPeriodReport(
 userId:string,shifts:NightShift[],config:NightConfig,from:string,to:string,
):Promise<NightPeriodReport>{
 const relevant=shifts.filter(s=>s.fechaInicio>=from&&s.fechaInicio<=to&&s.endAt);
 const convention=await resolveNightConvention(userId);
 const saved=new Map<string,SavedRow>();
 const ids=relevant.map(s=>s.id);
 for(let i=0;i<ids.length;i+=100){
  const {data,error}=await supabase.from("user_night_work_shift_summaries")
   .select("shift_id,night_work_minutes,night_window_minutes,is_estimated")
   .eq("user_id",userId).in("shift_id",ids.slice(i,i+100));
  if(!error)for(const row of data||[])saved.set(String(row.shift_id),row as SavedRow);
 }
 const newRows:Array<Record<string,unknown>>=[];
 const byShift:Record<string,NightDetail>={};
 for(const shift of relevant){
  const old=saved.get(shift.id);
  if(old){
   const value=Math.max(0,Number(old.night_work_minutes)||0);
   byShift[shift.id]={
    minutes:old.is_estimated?0:value,
    potentialMinutes:old.is_estimated?value:Math.max(0,Number(old.night_window_minutes)||0),
    estimated:old.is_estimated,hasNightWork:value>0,
   };
   continue;
  }
  let detail:NightDetail;
  try {
   const log=await loadDriverActivities(userId,shift.id);
   detail=nightWorkForShift(shift,log.segments,convention.rule?.timezone||config.night_timezone||"Europe/Madrid");
  }catch{detail=nightWorkForShift(shift,[],convention.rule?.timezone||config.night_timezone||"Europe/Madrid");}
  byShift[shift.id]=detail;
  newRows.push({
   user_id:userId,shift_id:shift.id,shift_date:shift.fechaInicio,
   night_work_minutes:detail.estimated?detail.potentialMinutes:detail.minutes,
   night_window_minutes:detail.potentialMinutes,
   night_days:detail.hasNightWork?1:0,
   is_estimated:detail.estimated,
   calculation_source:detail.estimated?"shift_window":"activity_log",
   estimated_reason:detail.estimated?"Estimación por intervalo, pendiente de actividades":"Registros de actividades",
   updated_at:new Date().toISOString(),
  });
 }
 for(let i=0;i<newRows.length;i+=100){
  const {error}=await supabase.from("user_night_work_shift_summaries")
   .upsert(newRows.slice(i,i+100),{onConflict:"user_id,shift_id"});
  if(error)console.warn("[NIGHT] Pending historical sync",error);
 }
 let minutes=0,estimatedMinutes=0,nightDays=0;
 const months=new Set<string>();
 for(const shift of relevant){
  const detail=byShift[shift.id];if(!detail)continue;
  minutes+=detail.minutes;
  if(detail.estimated)estimatedMinutes+=detail.potentialMinutes;
  if(detail.hasNightWork){nightDays++;months.add(shift.fechaInicio.slice(0,7));}
 }
 const payroll={...convention.payroll,...config} as Record<string,unknown>;
 const e=estimateNightBonus({rule:convention.rule,preference:convention.preference,
  payroll,minutes:minutes+estimatedMinutes,nightDays,from,to});
 return {
  monthly:e.monthly||0,total:e.total||0,amountKnown:e.total!==null,
  minutes,estimatedMinutes,nightDays,months:Array.from(months).sort(),
  partial:from.slice(8)!=="01"||to.slice(8)!=="30"||from.slice(0,7)!==to.slice(0,7),
  byShift,rule:convention.rule,preference:convention.preference,
  conventionStatus:convention.status,province:convention.province,mode:e.mode,
  estimateLabel:e.label,ruleName:e.ruleName,
 };
}
