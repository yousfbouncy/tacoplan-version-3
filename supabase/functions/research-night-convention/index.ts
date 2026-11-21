import {createClient} from "https://esm.sh/@supabase/supabase-js@2.57.0";
const send=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"private,no-store"}});
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return send({error:"Method not allowed"},405);
 const jwt=req.headers.get("Authorization")?.replace(/^Bearer\s+/i,"");
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!jwt||!url||!anon||!service)return send({error:"Not available"},401);
 const client=createClient(url,anon,{global:{headers:{Authorization:"Bearer "+jwt}}});
 const auth=await client.auth.getUser(jwt);
 if(auth.error||!auth.data.user)return send({error:"Not authenticated"},401);
 const db=createClient(url,service);
 const userId=auth.data.user.id;
 const {data:profile}=await db.from("profiles").select("base_country,base_city").eq("id",userId).maybeSingle();
 const country=String(profile?.base_country||"").toLowerCase();
 const city=String(profile?.base_city||"").trim().slice(0,100);
 if(!/^(espa|spain|es$)/i.test(country)||!city)return send({status:"no_es_location"});
 const cityKey=city.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/gi," ").toLowerCase().trim();
 const {data:alias}=await db.from("night_convention_city_aliases").select("province").eq("city_key",cityKey).maybeSingle();
 const province=alias?.province||city;
 const {data:existing}=await db.from("night_convention_rules").select("id").eq("country_code","ES")
  .eq("province",province).eq("verification_status","verified").limit(1);
 if(existing?.length)return send({status:"verified",ruleId:existing[0].id});
 const {data:pending}=await db.from("night_convention_research_requests")
  .select("id,ai_checked_at,status").eq("user_id",userId).eq("city",cityKey).maybeSingle();
 const diff=Date.now()-new Date(pending?.ai_checked_at||0).getTime();
 if(pending&&diff<86400000)return send({status:pending.status});
 const {data:request,error:queueError}=await db.from("night_convention_research_requests")
  .upsert({user_id:userId,country_code:"ES",province,city:cityKey,status:"pending",
   updated_at:new Date().toISOString()},{onConflict:"user_id,city"}).select("id").single();
 if(queueError)return send({error:"Could not queue research"},503);
 const key=Deno.env.get("OPENAI_API_KEY");
 if(!key)return send({status:"pending",reason:"AI provider not configured"});
 // Search only provincial transport-of-goods collective agreements.
 // Never publish an AI result as verified legal authority without review.
 const response=await fetch("https://api.openai.com/v1/responses",{
  method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},
  body:JSON.stringify({model:"gpt-4.1",tools:[{type:"web_search"}],store:false,
   input:`Locate the current official provincial collective agreement governing road freight transport for ${province}, Spain, at 2026-11-21. Look for nocturnity article. Return only JSON object with keys: province, agreement_name, source_url, article, valid_from, valid_to, night_from, night_to, calculation_mode (monthly_percent, hourly_percent, monthly_percent_prorated, hourly_fixed, daily_fixed, monthly_fixed), percent (number or null), fixed_amount (number or null), monthly_proration (none, days_with_night, calendar_days), evidence_quote. If you cannot verify from a provincial official source, return source_url null and calculation_mode null. Do not invent. No personal information.`})
 });
 if(!response.ok){
  await db.from("night_convention_research_requests").update({research_error:"AI request error "+response.status,ai_checked_at:new Date().toISOString()}).eq("id",request.id);
  return send({status:"pending",reason:"AI request failed"});
 }
 const result=await response.json();
 const output=(result.output||[]).flatMap((x:any)=>x.type==="message"?(x.content||[]).filter((c:any)=>c.type==="output_text").map((c:any)=>c.text):[]).join("\n");
 let candidate:any=null;
 try{const match=output.match(/\{[\s\S]*\}/);candidate=match?JSON.parse(match[0]):null;}catch{}
 const valid=candidate&&typeof candidate.source_url==="string"&&/^https:\/\//.test(candidate.source_url)
  &&["monthly_percent","hourly_percent","monthly_percent_prorated","hourly_fixed","daily_fixed","monthly_fixed"].includes(candidate.calculation_mode)
  &&/^(\d{2}:\d{2})$/.test(candidate.night_from||"")
  &&/^(\d{2}:\d{2})$/.test(candidate.night_to||"")
  &&String(candidate.province||"").toLowerCase().includes(province.toLowerCase());
 await db.from("night_convention_research_requests").update({
  candidate:valid?candidate:null,source_url:valid?candidate.source_url:null,
  ai_checked_at:new Date().toISOString(),status:valid?"needs_review":"pending",
  research_error:valid?null:"AI result lacks verifiable provincial agreement",
  updated_at:new Date().toISOString(),
 }).eq("id",request.id);
 return send({status:valid?"needs_review":"pending",reason:"Candidate must be verified against the published agreement before activation"});
});
