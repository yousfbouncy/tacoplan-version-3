// check-supabase.mjs
// Prueba conectividad y devuelve estado actual del esquema público.
import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL || "https://dutgxjwfjtqxmqonnjlp.supabase.co/";
const key = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1dGd4andmanRxeG1xb25uamxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyMTczNDIsImV4cCI6MjA4Njc5MzM0Mn0.-ZMc99z9_OBsvDgszIZ8c_y4RfS8B79D7c7hpGio7HA";

const sb = createClient(url, key, { auth: { persistSession: false } });

// 1. Check via SQL endpoint si está habilitado
async function viaSqlEndpoint(sql) {
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/exec_sql`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ sql_text: sql }),
    });
    if (!r.ok) {
      const t = await r.text();
      return { ok: false, status: r.status, text: t };
    }
    return { ok: true, data: await r.json() };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

const checkSql = `
select 'tabla:'||table_name::text n from information_schema.tables where table_schema='public'
and table_name in ('tachograph_devices','tachograph_sessions','tachograph_events','tachograph_daily_summary')
union all
select 'col:'||table_name||'.'||column_name::text n from information_schema.columns where table_schema='public'
and table_name='jornadas' and column_name like 'tacho_%'
union all
select 'vista:'||table_name::text n from information_schema.views where table_schema='public'
and table_name='tachograph_jornada_sums'
order by 1;
`;

const res = await viaSqlEndpoint(checkSql);
console.log("RPC exec_sql:", res.ok ? "DISPONIBLE" : "NO DISPONIBLE", res.ok ? "" : `${res.status} ${res.text?.slice(0, 260) || res.error}`);
if (res.ok) {
  console.log("Estado actual del schema (elementos existentes):");
  console.log(res.data);
}
