// apply-tachograph-migrations.mjs
// Aplica las migraciones del módulo Tacógrafo a Supabase directamente.
// Ejecución: node scripts/apply-tachograph-migrations.mjs
// Usa variables SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (prioridad)
// o SUPABASE_URL + SUPABASE_ANON_KEY.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const MIG_DIR = path.join(ROOT, "supabase", "migrations");

function read(name) {
  return fs.readFileSync(path.join(MIG_DIR, name), "utf8");
}

const url =
  process.env.SUPABASE_URL ||
  "https://dutgxjwfjtqxmqonnjlp.supabase.co/";

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!url || !serviceKey) {
  console.error("Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function runSql(sql, label) {
  console.log(`[MIGRAR] ${label}`);
  const { error, data } = await supabase.rpc("exec_sql", { sql_text: sql }).catch((e) => ({ error: e, data: null }));
  if (!error && data !== null && data !== undefined) {
    console.log(`[OK] ${label} via exec_sql RPC`);
    return data;
  }
  // Fallback: intentar con rest API sql-endpoint si existe
  console.warn(`[WARN] exec_sql no disponible (${error?.message || String(error)}). Se requiere ejecutar manualmente el SQL o disponer del service_role.`);
  return null;
}

const MIGS = [
  ["20260829_tachograph_module.sql", read("20260829_tachograph_module.sql")],
  ["20260829_tachograph_jornada_columns.sql", read("20260829_tachograph_jornada_columns.sql")],
];

async function verify() {
  const checks = {
    tables: ["tachograph_devices", "tachograph_sessions", "tachograph_events", "tachograph_daily_summary"],
    columns: [
      ["jornadas", "tacho_daily_summary_id"],
      ["jornadas", "tacho_driving_min"],
      ["jornadas", "tacho_work_min"],
      ["jornadas", "tacho_available_min"],
      ["jornadas", "tacho_rest_min"],
      ["jornadas", "tacho_countries"],
      ["jornadas", "tacho_country_entries"],
      ["jornadas", "tacho_km_total"],
      ["jornadas", "tacho_first_activity_at"],
      ["jornadas", "tacho_last_activity_at"],
      ["jornadas", "tacho_disconnections"],
      ["jornadas", "tacho_data_quality"],
    ],
    views: ["tachograph_jornada_sums"],
  };
  const sql = `
with t as (
  select table_name::text n from information_schema.tables where table_schema='public' and table_name = any(${JSON.stringify(checks.tables)}::text[])
),
c as (
  select table_name||'.'||column_name::text n from information_schema.columns where table_schema='public'
  and (table_name, column_name) = any(${JSON.stringify(checks.columns)}::text[])
),
v as (
  select table_name::text n from information_schema.views where table_schema='public' and table_name = any(${JSON.stringify(checks.views)}::text[])
)
select 'tabla:'||n n from t union all select 'col:'||n n from c union all select 'vista:'||n n from v;
  `;
  const { data, error } = await supabase.rpc("exec_sql", { sql_text: sql }).catch((e) => ({ error: e, data: null }));
  if (error) {
    console.warn("[WARN] No se pudo verificar automáticamente:", error.message || String(error));
    console.log("Verifica manualmente en Supabase SQL Editor ejecutando el CHECK:");
    console.log(sql);
    return;
  }
  console.log("[VERIFICAR] Elementos confirmados en el schema:", data || []);
}

async function main() {
  for (const [name, sql] of MIGS) {
    await runSql(sql, name);
  }
  await verify();
  console.log("\nListo. Si exec_sql no está habilitado, pega los 2 archivos SQL en Supabase > SQL Editor y ejecuta:");
  console.log("  supabase/migrations/20260829_tachograph_module.sql");
  console.log("  supabase/migrations/20260829_tachograph_jornada_columns.sql");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
