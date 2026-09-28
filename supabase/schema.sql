-- Tacoplan schema for Supabase
-- Run this in Supabase SQL editor (project -> SQL -> New query)
-- Assumes auth.uid() available (RLS)

-- Enable extensions commonly used (optional)
create extension if not exists "uuid-ossp";

-- PROFILES
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  language text default 'es',
  created_at timestamptz default now(),
  period_type text default 'AUTO_01_30',
  period_start_day int default 1,
  period_end_day int default 30,
  onboarding_completed boolean not null default false,
  driver_profile text,
  operation_zone text,
  trip_types jsonb,
  base_name text,
  base_city text,
  base_country text,
  base_address text,
  base_latitude numeric(10,6),
  base_longitude numeric(10,6),
  base_radius_km numeric(10,2) default 20,
  base_configured_at timestamptz,
  base_updated_at timestamptz,
  created_device_id text,
  last_login_device_id text,
  last_login_at timestamptz,
  updated_at timestamptz default now()
);
alter table public.profiles enable row level security;
drop policy if exists "profiles_owner" on public.profiles;
create policy "profiles_owner" on public.profiles
  for all using ( id = auth.uid() ) with check ( id = auth.uid() );

alter table public.profiles
  add column if not exists onboarding_completed boolean not null default false;

alter table public.profiles
  add column if not exists email text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists driver_profile text,
  add column if not exists operation_zone text,
  add column if not exists trip_types jsonb,
  add column if not exists base_name text,
  add column if not exists base_city text,
  add column if not exists base_country text,
  add column if not exists base_address text,
  add column if not exists base_latitude numeric(10,6),
  add column if not exists base_longitude numeric(10,6),
  add column if not exists base_radius_km numeric(10,2) default 20,
  add column if not exists base_configured_at timestamptz,
  add column if not exists base_updated_at timestamptz,
  add column if not exists created_device_id text,
  add column if not exists last_login_device_id text,
  add column if not exists last_login_at timestamptz,
  add column if not exists payment_mode text not null default 'dietas',
  add column if not exists price_per_km numeric(10,2) not null default 0,
  add column if not exists price_per_km_nacional numeric(10,2) not null default 0,
  add column if not exists price_per_km_internacional numeric(10,2) not null default 0,
  add column if not exists price_per_km_regional numeric(10,2) not null default 0,
  add column if not exists price_per_trip numeric(10,2) not null default 0,
  add column if not exists price_per_trip_nacional numeric(10,2) not null default 0,
  add column if not exists price_per_trip_internacional numeric(10,2) not null default 0,
  add column if not exists price_per_trip_regional numeric(10,2) not null default 0;

-- USER DIET RATES
create table if not exists public.user_diet_rates (
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_type text not null, -- 'NACIONAL' | 'INTERNACIONAL' | 'REGIONAL'
  percent int not null,    -- 100 | 60 | 30
  amount numeric(10,2) not null default 0,
  updated_at timestamptz default now(),
  primary key (user_id, trip_type, percent)
);
alter table public.user_diet_rates enable row level security;
drop policy if exists "diet_rates_owner" on public.user_diet_rates;
create policy "diet_rates_owner" on public.user_diet_rates
  for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

-- USER DAY EXTRAS
create table if not exists public.user_day_extras (
  user_id uuid primary key references auth.users(id) on delete cascade,
  extra_saturday numeric(10,2) not null default 0,
  extra_sunday numeric(10,2) not null default 0,
  extra_holiday numeric(10,2) not null default 0,
  offsite_weekly_reduced_nacional numeric(10,2) not null default 0,
  offsite_weekly_reduced_internacional numeric(10,2) not null default 0,
  offsite_weekly_complete_nacional numeric(10,2) not null default 0,
  offsite_weekly_complete_internacional numeric(10,2) not null default 0,
  updated_at timestamptz default now()
);
alter table public.user_day_extras add column if not exists offsite_weekly_reduced_nacional numeric(10,2) not null default 0;
alter table public.user_day_extras add column if not exists offsite_weekly_reduced_internacional numeric(10,2) not null default 0;
alter table public.user_day_extras add column if not exists offsite_weekly_complete_nacional numeric(10,2) not null default 0;
alter table public.user_day_extras add column if not exists offsite_weekly_complete_internacional numeric(10,2) not null default 0;
alter table public.user_day_extras enable row level security;
drop policy if exists "day_extras_owner" on public.user_day_extras;
create policy "day_extras_owner" on public.user_day_extras
  for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

create table if not exists public.user_day_extra_entries (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  entry_type text not null default 'day_extra', -- 'day_extra' | 'offsite_weekly_rest'
  day_flag text, -- 'SABADO' | 'DOMINGO' | 'FESTIVO'
  offsite_rest_type text, -- 'WEEKLY_REDUCED' | 'WEEKLY_COMPLETE'
  offsite_base text, -- 'NACIONAL' | 'INTERNACIONAL'
  plus_sunday boolean not null default false,
  plus_holiday boolean not null default false,
  location_start text,
  location_end text,
  in_base boolean,
  distance_to_base_km numeric(10,2),
  amount numeric(10,2),
  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.user_day_extra_entries add column if not exists entry_type text not null default 'day_extra';
alter table public.user_day_extra_entries add column if not exists day_flag text;
alter table public.user_day_extra_entries add column if not exists offsite_rest_type text;
alter table public.user_day_extra_entries add column if not exists offsite_base text;
alter table public.user_day_extra_entries add column if not exists plus_sunday boolean not null default false;
alter table public.user_day_extra_entries add column if not exists plus_holiday boolean not null default false;
alter table public.user_day_extra_entries add column if not exists location_start text;
alter table public.user_day_extra_entries add column if not exists location_end text;
alter table public.user_day_extra_entries add column if not exists in_base boolean;
alter table public.user_day_extra_entries add column if not exists distance_to_base_km numeric(10,2);
alter table public.user_day_extra_entries add column if not exists amount numeric(10,2);
alter table public.user_day_extra_entries add column if not exists note text;
alter table public.user_day_extra_entries add column if not exists created_at timestamptz default now();
alter table public.user_day_extra_entries add column if not exists updated_at timestamptz default now();
create index if not exists idx_day_extra_entries_user_date on public.user_day_extra_entries(user_id, date);
alter table public.user_day_extra_entries enable row level security;
drop policy if exists "day_extra_entries_owner" on public.user_day_extra_entries;
create policy "day_extra_entries_owner" on public.user_day_extra_entries
  for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

-- USER HOLIDAYS
create table if not exists public.user_holidays (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  name text,
  unique (user_id, date)
);
alter table public.user_holidays enable row level security;
drop policy if exists "holidays_owner" on public.user_holidays;
create policy "holidays_owner" on public.user_holidays
  for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

-- DIETAS CONFIG (opcional)
create table if not exists public.dietas_config (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nac_100 numeric(10,2),
  nac_60 numeric(10,2),
  nac_30 numeric(10,2),
  intl_100 numeric(10,2),
  intl_60 numeric(10,2),
  intl_30 numeric(10,2),
  reg_100 numeric(10,2),
  reg_60 numeric(10,2),
  reg_30 numeric(10,2),
  updated_at timestamptz default now()
);
alter table public.dietas_config enable row level security;
drop policy if exists "dietas_config_owner" on public.dietas_config;
create policy "dietas_config_owner" on public.dietas_config
  for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

-- USER FERRY CONFIG
create table if not exists public.user_ferry_config (
  user_id uuid primary key references auth.users(id) on delete cascade,
  crosses_ferry boolean not null default false,
  route_mode text not null default 'spain',
  payment_mode text not null default 'spain_diet',
  trip_rate numeric(10,2) not null default 0,
  pernight_rate numeric(10,2) not null default 0,
  ferry_rest_enabled boolean not null default false,
  ferry_transit_rate numeric(10,2) not null default 54.30,
  ferry_cabin_rate numeric(10,2) not null default 54.30,
  updated_at timestamptz default now()
);
alter table public.user_ferry_config enable row level security;
drop policy if exists "ferry_config_owner" on public.user_ferry_config;
create policy "ferry_config_owner" on public.user_ferry_config
  for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

alter table public.user_ferry_config
  add column if not exists ferry_transit_rate numeric(10,2) not null default 54.30;
alter table public.user_ferry_config
  add column if not exists ferry_cabin_rate numeric(10,2) not null default 54.30;

-- FERRY RESTS
create table if not exists public.ferry_rests (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  fecha date not null,
  start_time timestamptz not null,
  end_time timestamptz,
  rest_type text not null, -- '9h' | '11h'
  interruptions jsonb not null default '[]'::jsonb,
  interruption_total_min int default 0,
  computed_end timestamptz,
  valid boolean default true,
  reason text,
  destination text,
  ferry_extras jsonb,
  is_complete boolean,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.ferry_rests enable row level security;
drop policy if exists "ferry_rests_owner" on public.ferry_rests;
create policy "ferry_rests_owner" on public.ferry_rests
  for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

-- MOROCCO TRIPS
create table if not exists public.morocco_trips (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  fecha date not null,
  origen text not null,
  destino text not null,
  estado text not null default 'completed',
  importe numeric(10,2) not null default 0,
  updated_at timestamptz default now()
);
alter table public.morocco_trips enable row level security;
drop policy if exists "morocco_trips_owner" on public.morocco_trips;
create policy "morocco_trips_owner" on public.morocco_trips
  for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

-- JORNADAS
create table if not exists public.jornadas (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  fecha_inicio date not null,
  hora_inicio text not null,
  lugar_inicio text,
  fecha_fin date,
  hora_fin text,
  lugar_fin text,
  start_at timestamptz not null,
  end_at timestamptz,
  conduccion_min int,
  conduccion_domingo_min int,
  conduccion_lunes_min int,
  tipo_ruta text,
  pernocta boolean,
  dieta_modo text,
  dieta_manual_tipo text,
  dieta_manual_pct text,
  dieta_importe_eur text,
  dietas_items jsonb,
  dieta_percent int,
  day_flag text,
  day_extra_eur text,
  diet_base_eur text,
  diet_rule text,
  diet_calculated_at timestamptz,
  descanso_anterior_min int,
  tipo_descanso_anterior text,
  duracion_jornada_min int,
  counts_as_daily_reduced boolean,
  planned_rest_min int,
  planned_rest_type text,
  plus_items jsonb,
  observaciones text,
  legal_summary jsonb,
  previous_rest_source text,
  previous_rest_id text,
  previous_rest_valid boolean,
  previous_rest_start_at timestamptz,
  previous_rest_end_at timestamptz,
  previous_rest_legal_type text,
  previous_rest_start_location text,
  previous_rest_end_location text,
  previous_rest_in_base text,
  previous_rest_distance_km numeric(10,2),
  previous_rest_performed_in_vehicle boolean,
  previous_rest_accommodation boolean,
  previous_rest_comp_generated_min int,
  previous_rest_comp_used_min int,
  previous_rest_observations text,
  morocco_payment_mode text,
  morocco_trip_rate numeric(10,2),
  morocco_pernight_rate numeric(10,2),
  ferry_pending boolean,
  ferry_rest_type text,
  ferry_destination text,
  ferry_extras jsonb,
  ferry_interruptions jsonb,
  ferry_rest_completed boolean,
  updated_at timestamptz default now()
);
create index if not exists idx_jornadas_user_start on public.jornadas(user_id, start_at desc);
alter table public.jornadas enable row level security;
drop policy if exists "jornadas_owner" on public.jornadas;
create policy "jornadas_owner" on public.jornadas
  for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

alter table public.jornadas
  add column if not exists split_rest_detected boolean not null default false,
  add column if not exists split_rest_first_part_min int,
  add column if not exists split_rest_second_part_min int,
  add column if not exists counts_as_reduced_rest boolean not null default true,
  add column if not exists previous_rest_start_at timestamptz,
  add column if not exists previous_rest_end_at timestamptz,
  add column if not exists previous_rest_legal_type text,
  add column if not exists previous_rest_start_location text,
  add column if not exists previous_rest_end_location text,
  add column if not exists previous_rest_in_base text,
  add column if not exists previous_rest_distance_km numeric(10,2),
  add column if not exists previous_rest_performed_in_vehicle boolean,
  add column if not exists previous_rest_accommodation boolean,
  add column if not exists previous_rest_comp_generated_min int,
  add column if not exists previous_rest_comp_used_min int,
  add column if not exists previous_rest_observations text,
  add column if not exists payment_mode text,
  add column if not exists km_inicio numeric,
  add column if not exists km_fin numeric,
  add column if not exists km_total numeric,
  add column if not exists price_per_km numeric(10,2),
  add column if not exists importe_km numeric(10,2),
  add column if not exists price_per_trip numeric(10,2),
  add column if not exists importe_viaje numeric(10,2),
  add column if not exists report_hide_amounts boolean not null default false,
  add column if not exists report_hide_pluses boolean not null default false;

-- COMPENSACIONES
create table if not exists public.compensaciones (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  jornada_id text,
  horas_deuda int not null,
  minutos_deuda int not null,
  fecha_limite date not null,
  compensada boolean not null default false,
  fecha_compensacion date,
  source_rest_start_at timestamptz,
  source_rest_end_at timestamptz,
  source_rest_duration_min int,
  source_rest_legal_type text,
  source_rest_location_start text,
  source_rest_location_end text,
  source_rest_in_base text,
  source_rest_distance_km numeric(10,2),
  source_rest_observations text,
  recovered_in_jornada_id text,
  recovery_rest_start_at timestamptz,
  recovery_rest_end_at timestamptz,
  recovery_rest_duration_min int,
  updated_at timestamptz default now()
);
create index if not exists idx_comp_user_limite on public.compensaciones(user_id, fecha_limite);
alter table public.compensaciones enable row level security;
drop policy if exists "compensaciones_owner" on public.compensaciones;
create policy "compensaciones_owner" on public.compensaciones
  for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );
alter table public.compensaciones
  add column if not exists source_rest_start_at timestamptz,
  add column if not exists source_rest_end_at timestamptz,
  add column if not exists source_rest_duration_min int,
  add column if not exists source_rest_legal_type text,
  add column if not exists source_rest_location_start text,
  add column if not exists source_rest_location_end text,
  add column if not exists source_rest_in_base text,
  add column if not exists source_rest_distance_km numeric(10,2),
  add column if not exists source_rest_observations text,
  add column if not exists recovered_in_jornada_id text,
  add column if not exists recovery_rest_start_at timestamptz,
  add column if not exists recovery_rest_end_at timestamptz,
  add column if not exists recovery_rest_duration_min int;

-- VIAJES
create table if not exists public.viajes (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  cliente text,
  notas text,
  modo_viaje text default 'COMPLETO',
  estado text default 'EN_CURSO',
  paradas jsonb not null default '[]'::jsonb,
  fin_lugar text,
  fin_hora text,
  fin_viaje_nota text,
  jornada_id text,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);
create index if not exists idx_viajes_user_updated on public.viajes(user_id, updated_at desc);
alter table public.viajes enable row level security;
drop policy if exists "viajes_owner" on public.viajes;
create policy "viajes_owner" on public.viajes
  for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

-- TACOGRAFO ACTIVIDADES
create table if not exists public.tacho_activities (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  fecha date not null,
  tipo text not null,
  inicio timestamptz not null,
  fin timestamptz not null,
  duracion_min int not null,
  origen text,
  destino text,
  source text default 'pdf',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_tacho_activities_user_inicio on public.tacho_activities(user_id, inicio desc);
alter table public.tacho_activities enable row level security;
drop policy if exists "tacho_activities_owner" on public.tacho_activities;
create policy "tacho_activities_owner" on public.tacho_activities
  for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

-- TODOS demo
create table if not exists public.todos (
  id bigserial primary key,
  name text not null,
  created_at timestamptz default now()
);
alter table public.todos enable row level security;
drop policy if exists "todos_read" on public.todos;
create policy "todos_read" on public.todos for select using ( true );

-- APP UPDATE CONFIG (remote version gating)
create table if not exists public.app_update_config (
  id bigserial primary key,
  platform text not null,
  channel text,
  latest_version text,
  min_required_version text,
  force_update boolean not null default false,
  apk_url text,
  message text,
  updated_at timestamptz not null default now(),
  unique (platform, channel)
);
alter table public.app_update_config enable row level security;
drop policy if exists "app_update_config_read" on public.app_update_config;
create policy "app_update_config_read" on public.app_update_config for select using ( true );
