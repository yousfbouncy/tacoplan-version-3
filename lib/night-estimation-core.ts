import type {NightRule,NightPreference,NightBonusEstimate} from "./night-estimator";
const cash=(x:number)=>Math.round((x+Number.EPSILON)*100)/100;
const num=(x:unknown)=>{const n=Number(String(x??"").replace(",","."));return Number.isFinite(n)&&n>=0?n:0;};
const monthlyBase=(payroll:Record<string,unknown>,override?:unknown)=>{
 const v=num(override);if(v>0)return v;
 const base=num(payroll.salario_base_bruto);return payroll.fixed_unit==="day"?base*30:base;
};
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

