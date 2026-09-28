-- =====================================================================
-- MÓDULO TACÓGRAFO - Smart Tachograph 2 + Supabase
-- Tablas: tachograph_devices / tachograph_sessions / tachograph_events / tachograph_daily_summary
-- Vinculadas a auth.uid() con RLS.
-- =====================================================================

-- ---------------------------------------------------------------------
-- tachograph_devices
-- Dispositivo BLE autorizado explícitamente por el usuario.
-- Solo un dispositivo "autorizado" (trusted=true) se reconecta automáticamente.
-- ---------------------------------------------------------------------
create table if not exists public.tachograph_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  identifier text not null,                       -- MAC / serial / id.manufacturer único
  name text,                                       -- nombre visible del tacógrafo (DTCO 4.1, SE5000...)
  model text,                                      -- DTCO_41 | SE5000_SMART2 | DESCONOCIDO
  manufacturer text,
  serial_number text,
  paired_at timestamptz not null default now(),
  last_seen_at timestamptz,
  trusted boolean not null default false,          -- autorizado explícitamente por el usuario
  auto_reconnect boolean not null default true,
  meta jsonb not null default '{}'::jsonb,         -- info GATT / services detectados
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, identifier)
);

create index if not exists idx_tachograph_devices_user_id on public.tachograph_devices(user_id);
create index if not exists idx_tachograph_devices_trusted on public.tachograph_devices(user_id, trusted);

alter table public.tachograph_devices enable row level security;

drop policy if exists tachograph_devices_select_policy on public.tachograph_devices;
create policy tachograph_devices_select_policy on public.tachograph_devices
  for select using (auth.uid() = user_id);

drop policy if exists tachograph_devices_insert_policy on public.tachograph_devices;
create policy tachograph_devices_insert_policy on public.tachograph_devices
  for insert with check (auth.uid() = user_id);

drop policy if exists tachograph_devices_update_policy on public.tachograph_devices;
create policy tachograph_devices_update_policy on public.tachograph_devices
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists tachograph_devices_delete_policy on public.tachograph_devices;
create policy tachograph_devices_delete_policy on public.tachograph_devices
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- tachograph_sessions
-- Cada sesión Bluetooth abierta contra un tacógrafo.
-- Idealmente una por jornada, pero puede haber varias (re-conexiones).
-- ---------------------------------------------------------------------
create table if not exists public.tachograph_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid references public.tachograph_devices(id) on delete set null,
  jornada_id uuid,                                 -- opcional, se rellena cuando hay jornada abierta
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  connection_state text not null default 'connecting', -- connecting | connected | disconnected | error
  disconnections_count int not null default 0,
  rssi_min int,
  rssi_max int,
  services_detected jsonb,                         -- UUIDs GATT detectados
  firmware_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tachograph_sessions_user_id on public.tachograph_sessions(user_id);
create index if not exists idx_tachograph_sessions_jornada_id on public.tachograph_sessions(user_id, jornada_id);
create index if not exists idx_tachograph_sessions_started on public.tachograph_sessions(user_id, started_at desc);

alter table public.tachograph_sessions enable row level security;

drop policy if exists tachograph_sessions_select_policy on public.tachograph_sessions;
create policy tachograph_sessions_select_policy on public.tachograph_sessions
  for select using (auth.uid() = user_id);

drop policy if exists tachograph_sessions_insert_policy on public.tachograph_sessions;
create policy tachograph_sessions_insert_policy on public.tachograph_sessions
  for insert with check (auth.uid() = user_id);

drop policy if exists tachograph_sessions_update_policy on public.tachograph_sessions;
create policy tachograph_sessions_update_policy on public.tachograph_sessions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists tachograph_sessions_delete_policy on public.tachograph_sessions;
create policy tachograph_sessions_delete_policy on public.tachograph_sessions
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- tachograph_events
-- Acontecimientos emitidos por el tacógrafo y normalizados por Tacoplan.
-- timestamp_source indica la fuente de la hora del evento:
--   device_clock | phone_clock | gnss | estimated
-- source indica el origen de datos:
--   tachograph_ble | tachograph_history | phone_gps | manual
-- ---------------------------------------------------------------------
create table if not exists public.tachograph_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  jornada_id uuid,
  session_id uuid references public.tachograph_sessions(id) on delete set null,
  event_uid text not null,                         -- clave estable: evita duplicados tras reconectar/sync
  timestamp timestamptz not null,
  timestamp_source text not null default 'device_clock',
  event_type text not null,                        -- activity_change | country_entry | country_exit | speed | odometer | driver_slot | connection | custom
  previous_activity text,                          -- DRIVING | WORK | AVAILABLE | REST | UNKNOWN
  new_activity text,                               -- DRIVING | WORK | AVAILABLE | REST | UNKNOWN
  previous_country text,                           -- ISO 3166-1 alpha-2 (ES, FR, DE...)
  new_country text,
  latitude double precision,
  longitude double precision,
  speed_kmh numeric(10,2),
  distance_m numeric(14,2),                        -- distancia incremental desde el evento anterior (o odómetro absoluto)
  odometer_km numeric(14,2),                       -- odómetro absoluto si viene del taco
  duration_min int,                                -- duración resultante (para blockes de actividad cerrados)
  source text not null default 'tachograph_ble',
  raw_data jsonb,                                  -- payload bruto SIN datos sensibles (truncar cuando haga falta)
  quality_score int,                               -- 0..100. Estimación de fiabilidad de la muestra
  deduplication_key text,                          -- clave extra para anti-duplicados
  created_at timestamptz not null default now(),
  unique(user_id, event_uid)
);

create index if not exists idx_tachograph_events_user_jornada on public.tachograph_events(user_id, jornada_id);
create index if not exists idx_tachograph_events_timestamp on public.tachograph_events(user_id, timestamp desc);
create index if not exists idx_tachograph_events_type on public.tachograph_events(user_id, event_type, timestamp desc);

alter table public.tachograph_events enable row level security;

drop policy if exists tachograph_events_select_policy on public.tachograph_events;
create policy tachograph_events_select_policy on public.tachograph_events
  for select using (auth.uid() = user_id);

drop policy if exists tachograph_events_insert_policy on public.tachograph_events;
create policy tachograph_events_insert_policy on public.tachograph_events
  for insert with check (auth.uid() = user_id);

drop policy if exists tachograph_events_update_policy on public.tachograph_events;
create policy tachograph_events_update_policy on public.tachograph_events
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists tachograph_events_delete_policy on public.tachograph_events;
create policy tachograph_events_delete_policy on public.tachograph_events
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- tachograph_daily_summary
-- Resumen diario sintetizado a partir de los eventos + jornada asociada.
-- Se usa para mostrar rápidamente totales sin recalcular cada vez.
-- ---------------------------------------------------------------------
create table if not exists public.tachograph_daily_summary (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  summary_date date not null,
  jornada_id uuid,
  first_activity_at timestamptz,
  last_activity_at timestamptz,
  driving_min int not null default 0,
  work_min int not null default 0,
  available_min int not null default 0,
  rest_min int not null default 0,
  pause_min int not null default 0,
  unknown_min int not null default 0,
  countries text[] not null default '{}',
  country_entries_count int not null default 0,
  distance_km numeric(14,2),
  disconnections_count int not null default 0,
  data_source text not null default 'tachograph_ble',
  data_quality_score int,                           -- 0..100
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, summary_date, jornada_id)
);

create index if not exists idx_tachograph_summary_user_date on public.tachograph_daily_summary(user_id, summary_date desc);
create index if not exists idx_tachograph_summary_jornada on public.tachograph_daily_summary(user_id, jornada_id);

alter table public.tachograph_daily_summary enable row level security;

drop policy if exists tachograph_daily_summary_select_policy on public.tachograph_daily_summary;
create policy tachograph_daily_summary_select_policy on public.tachograph_daily_summary
  for select using (auth.uid() = user_id);

drop policy if exists tachograph_daily_summary_insert_policy on public.tachograph_daily_summary;
create policy tachograph_daily_summary_insert_policy on public.tachograph_daily_summary
  for insert with check (auth.uid() = user_id);

drop policy if exists tachograph_daily_summary_update_policy on public.tachograph_daily_summary;
create policy tachograph_daily_summary_update_policy on public.tachograph_daily_summary
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists tachograph_daily_summary_delete_policy on public.tachograph_daily_summary;
create policy tachograph_daily_summary_delete_policy on public.tachograph_daily_summary
  for delete using (auth.uid() = user_id);

-- =====================================================================
-- VISTAS / FUNCIONES DE APOYO
-- =====================================================================

-- Vista útil para saber, para cada jornada, qué conducción aporta el tacógrafo.
create or replace view public.tachograph_jornada_sums as
  select
    e.user_id,
    e.jornada_id,
    sum(case when e.new_activity = 'DRIVING' and e.duration_min is not null then e.duration_min else 0 end)::int as driving_min,
    sum(case when e.new_activity = 'WORK'    and e.duration_min is not null then e.duration_min else 0 end)::int as work_min,
    sum(case when e.new_activity = 'AVAILABLE' and e.duration_min is not null then e.duration_min else 0 end)::int as available_min,
    sum(case when e.new_activity = 'REST'    and e.duration_min is not null then e.duration_min else 0 end)::int as rest_min,
    array_remove(array_agg(distinct e.new_country), null)::text[] as countries,
    count(*) filter (where e.event_type = 'country_entry') as country_entries_count,
    max(e.odometer_km) - min(e.odometer_km) as distance_km_delta,
    min(e.timestamp) as first_activity_at,
    max(e.timestamp) as last_activity_at
  from public.tachograph_events e
  where e.jornada_id is not null
    and e.event_type = 'activity_change'
  group by e.user_id, e.jornada_id;

grant select on public.tachograph_jornada_sums to authenticated, anon;

notify pgrst, 'reload schema';
