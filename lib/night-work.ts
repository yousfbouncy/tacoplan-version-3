/**
 * Night work calculation for Tacoplan. León 2026–2028 art. 25:
 * 7% of monthly base salary, on 12 monthly payrolls when night work applies.
 * Night windows are 22:00–06:00; hours are evidence, not a per-hour tariff.
 * A closed shift without activity segments is only a possible/nighttime span.
 */
export type NightActivity = { type: "DRIVING"|"REST"|"AVAILABLE"|"WORK"; startedAt: string; endedAt: string|null };
export type NightShift = { id: string; startAt: string; endAt: string|null; fechaInicio: string };
export type NightDetail = { minutes: number; potentialMinutes: number; estimated: boolean; hasNightWork: boolean };
export type NightConfig = {
  night_enabled?: boolean;
  night_rate_pct?: string|number;
  night_salary_base_monthly?: string|number;
  night_timezone?: string;
  fixed_unit?: "day"|"month";
  salario_base_bruto?: string|number;
};

const round2=(v:number)=>Math.round(v*100)/100;
const parse=(v:unknown)=>{const n=Number(String(v??0).replace(",","."));return Number.isFinite(n)&&n>0?n:0;};
const safeEnd=(s:NightShift)=>s.endAt||null;
const MAX_SEGMENT_MIN=48*60;

/** Count minutes intersecting local nighttime by using the configured work timezone.
 * Iterating whole minutes accommodates DST transitions without a stale fixed UTC offset. */
export function nightWindowMinutes(startAt:string,endAt:string,timeZone="Europe/Madrid",nightFrom="22:00",nightTo="06:00"):number {
  const first=Date.parse(startAt),last=Date.parse(endAt);
  if(!Number.isFinite(first)||!Number.isFinite(last)||last<=first)return 0;
  const minutes=Math.min(MAX_SEGMENT_MIN,Math.ceil((last-first)/60000));
  const fmt=new Intl.DateTimeFormat("en-GB",{timeZone,hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
  const clock=(v:string,fallback:number)=>/^([01]\d|2[0-3]):[0-5]\d$/.test(v)?Number(v.slice(0,2))*60+Number(v.slice(3)):fallback;
  const from=clock(nightFrom,1320),until=clock(nightTo,360);
  let sum=0;
  for(let i=0;i<minutes;i++){
    const t=first+i*60000;
    if(t>=last)break;
    const label=fmt.format(new Date(t));
    const m=label.match(/(\d{1,2}):(\d{2})/);
    const minuteOfDay=m?Number(m[1])*60+Number(m[2]):-1;
    const inWindow=from<until?minuteOfDay>=from&&minuteOfDay<until:minuteOfDay>=from||minuteOfDay<until;
    if(minuteOfDay>=0&&inWindow)sum+=Math.min(60000,last-t)/60000;
  }
  return Math.round(sum);
}

/** Separates actual selected driving/availability/work from a bare open/closed span.
 * A mere shift span can include rest, so it is never reported as proven worked hours. */
export function nightWorkForShift(shift:NightShift,activities:NightActivity[],timeZone="Europe/Madrid",nightFrom="22:00",nightTo="06:00"):NightDetail {
  const potentialMinutes=shift.endAt?nightWindowMinutes(shift.startAt,shift.endAt,timeZone,nightFrom,nightTo):0;
  const valid=activities.filter(a=>a.endedAt&&Date.parse(a.endedAt)>Date.parse(a.startedAt));
  if(!valid.length)return {minutes:0,potentialMinutes,estimated:potentialMinutes>0,hasNightWork:potentialMinutes>0};
  const worked=valid.filter(a=>a.type!=="REST").map(a=>({
    start:Math.max(Date.parse(a.startedAt),Date.parse(shift.startAt)),
    end:Math.min(Date.parse(a.endedAt!),Date.parse(safeEnd(shift)||"")),
  })).filter(x=>Number.isFinite(x.start)&&Number.isFinite(x.end)&&x.end>x.start).sort((a,b)=>a.start-b.start);
  const merged:Array<{start:number;end:number}>=[];
  for(const seg of worked){
    const last=merged.at(-1);
    if(last&&seg.start<=last.end)last.end=Math.max(last.end,seg.end);
    else merged.push({...seg});
  }
  const minutes=merged.reduce((sum,seg)=>sum+nightWindowMinutes(new Date(seg.start).toISOString(),new Date(seg.end).toISOString(),timeZone,nightFrom,nightTo),0);
  return {minutes,potentialMinutes,estimated:false,hasNightWork:minutes>0};
}
export function monthlyNightAmount(config:NightConfig):number {
  if(config.night_enabled!==true)return 0;
  const override=parse(config.night_salary_base_monthly);
  const entered=parse(config.salario_base_bruto);
  const monthlyBase=override||(config.fixed_unit==="day"?entered*30:entered);
  return round2(monthlyBase*Math.min(100,parse(config.night_rate_pct??7))/100);
}
/** A monthly salary component is counted once for every eligible payroll month,
 * never once per night or work shift. A custom partial-month range is indicative. */
export function nightPayrollSummary(
  config:NightConfig,
  shifts:NightShift[],
  details:Record<string,NightDetail>,
  from:string,to:string,
):{monthly:number;total:number;minutes:number;estimatedMinutes:number;months:string[];partial:boolean} {
  const monthly=monthlyNightAmount(config);
  const months=new Set<string>();
  let minutes=0,estimatedMinutes=0;
  for(const shift of shifts){
    if(shift.fechaInicio<from||shift.fechaInicio>to)continue;
    const detail=details[shift.id];
    if(!detail)continue;
    minutes+=detail.minutes;
    if(detail.estimated)estimatedMinutes+=detail.potentialMinutes;
    if(detail.hasNightWork)months.add(shift.fechaInicio.slice(0,7));
  }
  const eligible=Array.from(months).sort();
  const startMonth=from.slice(0,7),endMonth=to.slice(0,7);
  const partial=from.slice(8)!=="01"||to.slice(8)!==String(new Date(Number(to.slice(0,4)),Number(to.slice(5,7)),0).getDate()).padStart(2,"0")||startMonth!==endMonth;
  // A 21st→20th company payroll period spans two calendar months but is
  // still ONE salary period. Never multiply the fixed plus by both months.
  const dateDays=Math.max(1,Math.round((Date.parse(to+"T12:00:00Z")-Date.parse(from+"T12:00:00Z"))/86400000)+1);
  const payPeriods=Math.min(eligible.length,Math.max(1,Math.round(dateDays/30)));
  // For partial payroll periods, entitlement/proration still needs confirmation.
  return {monthly,total:round2(monthly*payPeriods),minutes,estimatedMinutes,months:eligible,partial};
}
