import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const mocksList=[
  "@react-native-async-storage/async-storage","react-native","expo-location",
  "expo-task-manager","@/lib/local-storage","@/lib/driver-activities",
  "@/lib/paid-automation-access",
];
const bundle=build({entryPoints:["lib/autostart/driving.ts"],bundle:true,write:false,platform:"node",format:"cjs",
  plugins:[{name:"mock-native",setup(b){
    b.onResolve({filter:/.*/},args=>mocksList.includes(args.path)?{path:args.path,namespace:"mock"}:undefined);
    b.onLoad({filter:/.*/,namespace:"mock"},args=>({contents:`module.exports = __mocks[${JSON.stringify(args.path)}];`}));
  }}]});
const epoch=Date.parse("2026-11-19T12:00:00Z");
function location(s:number,kph:number,accuracy=5){
  return {timestamp:epoch+s*1000,coords:{speed:kph/3.6,accuracy}};
}
async function harness(){
  const values=new Map<string,string>();
  values.set("@tacoplan/driving-autostart/v1:u1","true");
  const log:any={shiftId:"shift1",segments:[]};
  let callback:(fix:any)=>void=()=>{};
  const mocks:Record<string,any>={
    "@react-native-async-storage/async-storage":{
      async getItem(k:string){return values.get(k)??null;},
      async setItem(k:string,v:string){values.set(k,v);},
      async removeItem(k:string){values.delete(k);},
    },
    "react-native":{Platform:{OS:"ios"},AppState:{currentState:"active"}},
    "expo-task-manager":{defineTask() {},async isAvailableAsync(){return true;}},
    "expo-location":{
      Accuracy:{High:6,Balanced:3},ActivityType:{AutomotiveNavigation:2},
      async getForegroundPermissionsAsync(){return {granted:true};},
      async getBackgroundPermissionsAsync(){return {granted:false};},
      async hasStartedLocationUpdatesAsync(){return false;},
      async watchPositionAsync(_options:any,fn:any){callback=fn;return {remove(){}};},
    },
    "@/lib/local-storage":{async getJornadaAbierta(){return {id:"shift1"};}},
    "@/lib/paid-automation-access":{async canRunPaidAutomation(){return true;}},
    "@/lib/driver-activities":{
      async loadDriverActivities(){return JSON.parse(JSON.stringify(log));},
      changeDriverActivity(old:any,type:string,now:Date){
        const segments=old.segments.map((s:any)=>({...s}));
        const active=segments.findLast((s:any)=>s.endedAt===null);
        if(active?.type===type)return old;
        if(active){if(now.getTime()<Date.parse(active.startedAt))return old;active.endedAt=now.toISOString();}
        segments.push({type,startedAt:now.toISOString(),endedAt:null});
        return {shiftId:old.shiftId,segments};
      },
      pauseDriverActivity(old:any,now:Date){
        const segments=old.segments.map((seg:any)=>({...seg}));
        const active=segments.findLast((seg:any)=>seg.endedAt===null);
        if(active?.type!=="DRIVING")return old;
        active.endedAt=new Date(Math.max(Date.parse(active.startedAt),now.getTime())).toISOString();
        return {shiftId:old.shiftId,segments};
      },
      async saveDriverActivities(_user:string,next:any){log.segments=next.segments;},
    },
  };
  const code=(await bundle).outputFiles[0].text;
  const module={exports:{} as any};
  new Function("__mocks","module","exports",code)(mocks,module,module.exports);
  await module.exports.syncDrivingMonitoring("u1");
  return {log,values,async deliver(fix:any){callback(fix);await new Promise(resolve=>setTimeout(resolve,5));}};
}

test("3.0.6: backs up start to first slow maneuver after 60-second confirmation at 6 km/h",async()=>{
 const h=await harness();
 await h.deliver(location(0,2));
 await h.deliver(location(15,4));
 await h.deliver(location(30,6.1));
 assert.equal(h.log.segments.length,0);
 await h.deliver(location(60,6.1));
 assert.equal(h.log.segments.length,1);
 assert.equal(h.log.segments[0].type,"DRIVING");
 assert.equal(h.log.segments[0].startedAt,new Date(epoch).toISOString());
});
test("3.0.6: 20-second traffic stop continues driving and excludes stationary seconds",async()=>{
 const h=await harness();
 await h.deliver(location(0,8));
 await h.deliver(location(60,8));
 assert.equal(h.log.segments.at(-1).type,"DRIVING");
 await h.deliver(location(61,0));
 await h.deliver(location(81,1.1));
 assert.deepEqual(h.log.segments.map((x:any)=>x.type),["DRIVING","DRIVING"]);
 assert.equal(h.log.segments[0].endedAt,new Date(epoch+61_000).toISOString());
 assert.equal(h.log.segments[1].startedAt,new Date(epoch+81_000).toISOString());
});
test("3.0.6: 60-second confirmed traffic stop backdates closure to first stopped fix",async()=>{
 const h=await harness();
 await h.deliver(location(0,8));
 await h.deliver(location(60,8));
 await h.deliver(location(61,0));
 assert.equal(h.log.segments.at(-1).endedAt,null);
 await h.deliver(location(121,0));
 assert.equal(h.log.segments[0].endedAt,new Date(epoch+61_000).toISOString());
 assert.equal(h.log.segments.filter((x:any)=>x.type==="REST").length,0);
});
