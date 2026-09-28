-- ============================================================
-- TACOPLAN · MIGRACIÓN UNIFICADA MÓDULO TACÓGRAFO Smart 2
-- Listo para pegar en Supabase → SQL Editor y pulsar RUN.
-- Proyecto: dutgxjwfjtqxmqonnjlp
-- 100% IDEMPOTENTE: si una tabla / policy / índice / columna
-- ya existe, no falla. Puedes ejecutarla varias veces.
-- ============================================================

set client_min_messages = warning;

-- ---------------------------------------------------------------------
-- 1) TABLAS DEL MÓDULO TACÓGRAFO
-- ---------------------------------------------------------------------

create table if not exists public.tachograph_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  identifier text not null,
  name text,
  model text,
  manufacturer text,
  serial_number text,
  paired_at timestamptz not null default now(),
  last_seen_at timestamptz,
  trusted boolean not null default false,
  auto_reconnect boolean not null default true,
  meta jsonb not null default '{}'::jsonb,
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
create table if not exists public.tachograph_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid references public.tachograph_devices(id) on delete set null,
  jornada_id uuid,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  connection_state text not null default 'connecting',
  disconnections_count int not null default 0,
  rssi_min int,
  rssi_max int,
  services_detected jsonb,
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
create table if not exists public.tachograph_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  jornada_id uuid,
  session_id uuid references public.tachograph_sessions(id) on delete set null,
  event_uid text not null,
  timestamp timestamptz not null,
  timestamp_source text not null default 'device_clock',
  event_type text not null,
  previous_activity text,
  new_activity text,
  previous_country text,
  new_country text,
  latitude double precision,
  longitude double precision,
  speed_kmh numeric(10,2),
  distance_m numeric(14,2),
  odometer_km numeric(14,2),
  duration_min int,
  source text not null default 'tachograph_ble',
  raw_data jsonb,
  quality_score int,
  deduplication_key text,
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
  data_quality_score int,
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

-- ---------------------------------------------------------------------
-- 2) VISTA AGREGADA por jornada
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 3) COLUMNAS tacho_* EN LA TABLA jornadas
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='jornadas' and column_name='tacho_daily_summary_id') then
    alter table public.jornadas add column tacho_daily_summary_id uuid null references public.tachograph_daily_summary(id) on delete set null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='jornadas' and column_name='tacho_driving_min') then
    alter table public.jornadas add column tacho_driving_min int null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='jornadas' and column_name='tacho_work_min') then
    alter table public.jornadas add column tacho_work_min int null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='jornadas' and column_name='tacho_available_min') then
    alter table public.jornadas add column tacho_available_min int null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='jornadas' and column_name='tacho_rest_min') then
    alter table public.jornadas add column tacho_rest_min int null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='jornadas' and column_name='tacho_countries') then
    alter table public.jornadas add column tacho_countries text[] not null default '{}';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='jornadas' and column_name='tacho_country_entries') then
    alter table public.jornadas add column tacho_country_entries int not null default 0;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='jornadas' and column_name='tacho_km_total') then
    alter table public.jornadas add column tacho_km_total numeric(12,3) null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='jornadas' and column_name='tacho_first_activity_at') then
    alter table public.jornadas add column tacho_first_activity_at timestamptz null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='jornadas' and column_name='tacho_last_activity_at') then
    alter table public.jornadas add column tacho_last_activity_at timestamptz null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='jornadas' and column_name='tacho_disconnections') then
    alter table public.jornadas add column tacho_disconnections int not null default 0;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='jornadas' and column_name='tacho_data_quality') then
    alter table public.jornadas add column tacho_data_quality text null check (tacho_data_quality in ('low','medium','high'));
  end if;
end $$;

create index if not exists jornadas_tacho_daily_summary_id_idx on public.jornadas(tacho_daily_summary_id);

-- ---------------------------------------------------------------------
-- 3bis) COLUMNAS base_* EN LA TABLA profiles (onboarding/base location)
--       Se añaden de forma idempotente para evitar 42703 column does not exist
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='base_name') then
    alter table public.profiles add column base_name text null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='base_city') then
    alter table public.profiles add column base_city text null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='base_country') then
    alter table public.profiles add column base_country text null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='base_address') then
    alter table public.profiles add column base_address text null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='base_latitude') then
    alter table public.profiles add column base_latitude double precision null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='base_longitude') then
    alter table public.profiles add column base_longitude double precision null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='base_radius_km') then
    alter table public.profiles add column base_radius_km numeric(8,3) null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='base_configured_at') then
    alter table public.profiles add column base_configured_at timestamptz null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='base_updated_at') then
    alter table public.profiles add column base_updated_at timestamptz null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='weeklies_daily_minutes') then
    alter table public.profiles add column weeklies_daily_minutes jsonb not null default '{}'::jsonb;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='weeklies_last_generated_at') then
    alter table public.profiles add column weeklies_last_generated_at timestamptz null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='rest_regularization') then
    alter table public.profiles add column rest_regularization jsonb not null default '{}'::jsonb;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='rest_regularization_updated_at') then
    alter table public.profiles add column rest_regularization_updated_at timestamptz null;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4) Refresco del schema cache para PostgREST
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- 5) VERIFICACIÓN (se ejecuta automáticamente y te muestra el resultado)
-- ---------------------------------------------------------------------
with
tablas_ok(tabla, ok) as (
  select 'tachograph_devices', exists(select 1 from information_schema.tables where table_schema='public' and table_name='tachograph_devices') union all
  select 'tachograph_sessions', exists(select 1 from information_schema.tables where table_schema='public' and table_name='tachograph_sessions') union all
  select 'tachograph_events', exists(select 1 from information_schema.tables where table_schema='public' and table_name='tachograph_events') union all
  select 'tachograph_daily_summary', exists(select 1 from information_schema.tables where table_schema='public' and table_name='tachograph_daily_summary')
),
cols_ok(columna, ok) as (
  select 'jornadas.tacho_daily_summary_id', exists(select 1 from information_schema.columns where table_schema='public' and table_name='jornadas' and column_name='tacho_daily_summary_id') union all
  select 'jornadas.tacho_driving_min',     exists(select 1 from information_schema.columns where table_schema='public' and table_name='jornadas' and column_name='tacho_driving_min') union all
  select 'jornadas.tacho_work_min',        exists(select 1 from information_schema.columns where table_schema='public' and table_name='jornadas' and column_name='tacho_work_min') union all
  select 'jornadas.tacho_available_min',   exists(select 1 from information_schema.columns where table_schema='public' and table_name='jornadas' and column_name='tacho_available_min') union all
  select 'jornadas.tacho_rest_min',        exists(select 1 from information_schema.columns where table_schema='public' and table_name='jornadas' and column_name='tacho_rest_min') union all
  select 'jornadas.tacho_countries',       exists(select 1 from information_schema.columns where table_schema='public' and table_name='jornadas' and column_name='tacho_countries') union all
  select 'jornadas.tacho_country_entries', exists(select 1 from information_schema.columns where table_schema='public' and table_name='jornadas' and column_name='tacho_country_entries') union all
  select 'jornadas.tacho_km_total',        exists(select 1 from information_schema.columns where table_schema='public' and table_name='jornadas' and column_name='tacho_km_total') union all
  select 'jornadas.tacho_first_activity_at', exists(select 1 from information_schema.columns where table_schema='public' and table_name='jornadas' and column_name='tacho_first_activity_at') union all
  select 'jornadas.tacho_last_activity_at',  exists(select 1 from information_schema.columns where table_schema='public' and table_name='jornadas' and column_name='tacho_last_activity_at') union all
  select 'jornadas.tacho_disconnections',   exists(select 1 from information_schema.columns where table_schema='public' and table_name='jornadas' and column_name='tacho_disconnections') union all
  select 'jornadas.tacho_data_quality',     exists(select 1 from information_schema.columns where table_schema='public' and table_name='jornadas' and column_name='tacho_data_quality')
),
cols_profiles_ok(columna, ok) as (
  select 'profiles.base_name',       exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='base_name') union all
  select 'profiles.base_city',       exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='base_city') union all
  select 'profiles.base_country',    exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='base_country') union all
  select 'profiles.base_address',    exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='base_address') union all
  select 'profiles.base_latitude',   exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='base_latitude') union all
  select 'profiles.base_longitude',  exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='base_longitude') union all
  select 'profiles.base_radius_km',  exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='base_radius_km') union all
  select 'profiles.base_configured_at', exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='base_configured_at') union all
  select 'profiles.base_updated_at', exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='base_updated_at')
),
vista_ok(vista, ok) as (
  select 'tachograph_jornada_sums', exists(select 1 from information_schema.views where table_schema='public' and table_name='tachograph_jornada_sums')
)
select 'TABLAS' as grupo, tabla as elemento, ok from tablas_ok
union all
select 'COLUMNAS', columna, ok from cols_ok
union all
select 'PROFILES', columna, ok from cols_profiles_ok
union all
select 'VISTAS', vista, ok from vista_ok
order by 1, 2;
