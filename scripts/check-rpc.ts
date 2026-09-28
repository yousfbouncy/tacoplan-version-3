import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || "https://dutgxjwfjtqxmqonnjlp.supabase.co/";
const key =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1dGd4andmanRxeG1xb25uamxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyMTczNDIsImV4cCI6MjA4Njc5MzM0Mn0.-ZMc99z9_OBsvDgszIZ8c_y4RfS8B79D7c7hpGio7HA";

const sb = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  try {
    const payload = {
      sql_text: `select count(*)::int c from information_schema.tables where table_schema='public' and table_name='jornadas'`,
    };
    const { data, error } = await sb.rpc("exec_sql", payload as any);
    console.log("RPC exec_sql DISPONIBLE:", !error, "data=", data, "error=", error?.message || null);
    process.exit(0);
  } catch (e: any) {
    console.log("error:", e?.message || String(e));
    process.exit(1);
  }
}
main();
