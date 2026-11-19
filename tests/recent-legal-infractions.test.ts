import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const bundlePromise = build({
  entryPoints: ["lib/recent-legal-infractions.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  plugins: [{ name: "mock-supabase", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/supabase$/ }, args => ({ path: args.path, namespace: "mock" }));
    builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: "module.exports={supabase:{}};" }));
  } }],
});
const apiPromise = bundlePromise.then(bundle => {
  const module = { exports: {} as any };
  new Function("exports", "module", bundle.outputFiles[0].text)(module.exports, module);
  return module.exports;
});
const now = new Date("2026-11-19T12:00:00Z");
const entry=(date:string,index=1)=>({jornada_id:"shift",occurred_on:date,code:"JORNADA_EXCESIVA",severity:"grave",description:"Límite excedido",incident_index:index});

test("infracción de hoy y de 56 días atrás visible; 57 días oculta",async()=>{
  const {isRecentLegalInfraction}=await apiPromise;
  assert.equal(isRecentLegalInfraction(entry("2026-11-19"),now),true);
  assert.equal(isRecentLegalInfraction(entry("2026-09-24"),now),true);
  assert.equal(isRecentLegalInfraction(entry("2026-09-23"),now),false);
});
test("cambios de mes y año no alteran el plazo de 56 días",async()=>{
  const {isRecentLegalInfraction}=await apiPromise;
  const ref=new Date("2027-01-02T18:00:00Z");
  assert.equal(isRecentLegalInfraction(entry("2026-11-07"),ref),true);
  assert.equal(isRecentLegalInfraction(entry("2026-11-06"),ref),false);
});
test("no se muestran incidencias del futuro, inválidas ni duplicadas",async()=>{
  const {filterRecentLegalInfractions}=await apiPromise;
  assert.deepEqual(filterRecentLegalInfractions([
    entry("2026-11-19"),entry("2026-11-19"),entry("2026-11-20"),entry("not-a-date"),
    entry("2026-11-19",2),entry("2026-09-01")
  ],now).map((v:any)=>v.incident_index),[1,2]);
});
