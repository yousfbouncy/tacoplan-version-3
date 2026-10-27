import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const mocked = ["@react-native-async-storage/async-storage", "@/lib/supabase", "@/lib/user-scope"];
const bundle = build({entryPoints:["lib/local-storage.ts"],bundle:true,write:false,platform:"node",format:"cjs",
  plugins:[{name:"storage-adapters",setup(b){
    b.onResolve({filter:/.*/},args=>mocked.includes(args.path)?{path:args.path,namespace:"mock"}:undefined);
    b.onLoad({filter:/.*/,namespace:"mock"},args=>({contents:`module.exports = __mocks[${JSON.stringify(args.path)}];`}));
  }}]});
async function harness() {
  const storage = new Map<string,string>();
  let onRead: ((key:string)=>Promise<void>) | null = null;
  const mocks = {
    "@react-native-async-storage/async-storage": {
      async getItem(key:string) { const value=storage.get(key)??null; await onRead?.(key); return value; },
      async setItem(key:string,value:string) {storage.set(key,value);},
      async removeItem(key:string) {storage.delete(key);},
    },
    "@/lib/supabase": {supabase:{}},
    "@/lib/user-scope": {async userScopedKey(key:string){return key;}},
  };
  const module = {exports:{} as any};
  new Function("module","exports","__mocks",(await bundle).outputFiles[0].text)(module,module.exports,mocks);
  return {api:module.exports,storage,setRead:(fn:typeof onRead)=>{onRead=fn;}};
}
const start = {fechaInicio:"2026-10-27",horaInicio:"08:00",lugarInicio:"Abrera"};
test("real storage: a start during cloud merge survives and remains pending until confirmed", async()=>{
  const h=await harness();
  let release!:()=>void; let entered!:()=>void;
  const blocked=new Promise<void>(r=>{release=r;}); const reading=new Promise<void>(r=>{entered=r;});
  h.setRead(async key=>{if(key==="tacoplan_jornadas"){h.setRead(null);entered();await blocked;}});
  const merge=h.api.mergeFromCloud([],[],[]); await reading;
  const create=h.api.crearJornadaInicio(start); release();
  await merge; const created=await create;
  await h.api.markAllSynced([]);
  assert.equal((await h.api.getJornadaAbierta()).id,created.id);
  assert.equal((await h.api.getPendingSyncData()).jornadas.length,1);
  await h.api.markAllSynced([created]);
  assert.equal((await h.api.getPendingSyncData()).jornadas.length,0);
});
test("real storage: two concurrent starts cannot create two open shifts", async()=>{
  const h=await harness();
  const results=await Promise.allSettled([h.api.crearJornadaInicio(start),h.api.crearJornadaInicio(start)]);
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
  assert.equal((await h.api.listarJornadas()).length,1);
});
