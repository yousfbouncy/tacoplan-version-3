import { loadDriverActivities } from "./driver-activities";
import { supabase } from "./supabase";
import { nightWorkForShift, nightPayrollSummary, type NightConfig, type NightDetail, type NightShift } from "./night-work";

export type NightPeriodReport = ReturnType<typeof nightPayrollSummary> & {byShift:Record<string,NightDetail>};
export async function loadNightPeriodReport(
  userId:string,
  shifts:NightShift[],
  config:NightConfig,
  from:string,
  to:string,
):Promise<NightPeriodReport> {
  const relevant=shifts.filter(s=>s.fechaInicio>=from&&s.fechaInicio<=to&&s.endAt);
  const pairs=await Promise.all(relevant.map(async shift=>{
    try {
      const log=await loadDriverActivities(userId,shift.id);
      return [shift.id,nightWorkForShift(shift,log.segments,config.night_timezone||"Europe/Madrid")] as const;
    } catch {
      return [shift.id,nightWorkForShift(shift,[],config.night_timezone||"Europe/Madrid")] as const;
    }
  }));
  const byShift=Object.fromEntries(pairs) as Record<string,NightDetail>;
  // Cache only computed evidence. The monthly 7% premium is deliberately NOT
  // added to any diet or per-shift plus; payroll accounts for it once.
  if(userId && pairs.length){
    try {
      const {error}=await supabase.from("user_night_work_shift_summaries").upsert(relevant.map(shift=>({
        user_id:userId,shift_id:shift.id,shift_date:shift.fechaInicio,
        night_work_minutes:byShift[shift.id]?.minutes??0,
        night_window_minutes:byShift[shift.id]?.potentialMinutes??0,
        is_estimated:byShift[shift.id]?.estimated??true,
        calculation_source:byShift[shift.id]?.estimated?"shift_window":"activity_log",
        updated_at:new Date().toISOString(),
      })),{onConflict:"user_id,shift_id"});
      if(error)console.warn("[NIGHT-WORK] Sync of calculated evidence pending",error);
    }catch(error){console.warn("[NIGHT-WORK] Offline evidence remains local",error);}
  }
  return {...nightPayrollSummary(config,relevant,byShift,from,to),byShift};
}
