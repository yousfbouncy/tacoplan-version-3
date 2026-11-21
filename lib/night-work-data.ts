import { loadDriverActivities } from "./driver-activities";
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
  return {...nightPayrollSummary(config,relevant,byShift,from,to),byShift};
}
