-- Tacoplan admin notifications runtime
-- Ejecuta este archivo en Supabase SQL Editor o inclúyelo en tu flujo de migraciones.

create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_admin_user(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = coalesce(p_user_id, auth.uid())
      and is_active = true
  );
$$;

alter table public.admin_users enable row level security;
drop policy if exists "admin_users_select" on public.admin_users;
create policy "admin_users_select" on public.admin_users
  for select
  using (auth.uid() = user_id or public.is_admin_user());
drop policy if exists "admin_users_insert" on public.admin_users;
create policy "admin_users_insert" on public.admin_users
  for insert
  with check (public.is_admin_user());
drop policy if exists "admin_users_update" on public.admin_users;
create policy "admin_users_update" on public.admin_users
  for update
  using (public.is_admin_user())
  with check (public.is_admin_user());
drop policy if exists "admin_users_delete" on public.admin_users;
create policy "admin_users_delete" on public.admin_users
  for delete
  using (public.is_admin_user());

create table if not exists public.notification_schedules (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  title text not null,
  body text not null,
  type text not null default 'admin_message',
  button_text text null,
  button_url text null,
  target_type text not null default 'all',
  target_user_id uuid references auth.users(id) on delete cascade,
  send_push boolean not null default true,
  create_internal_notification boolean not null default true,
  visibility_mode text not null default 'snapshot',
  frequency text not null default 'once',
  week_days int[] null,
  day_of_month int null,
  time_utc text null,
  next_run_at timestamptz not null,
  last_run_at timestamptz null,
  enabled boolean not null default true,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_schedules_frequency_check check (frequency in ('once', 'daily', 'weekly', 'monthly')),
  constraint notification_schedules_target_type_check check (target_type in (
    'all',
    'user',
    'platform_ios',
    'platform_android',
    'outdated_version',
    'updated_version',
    'notifications_enabled',
    'notifications_disabled',
    'no_jornada_2_days',
    'no_jornada_7_days'
  )),
  constraint notification_schedules_week_days_check check (
    week_days is null
    or array_length(week_days, 1) is null
    or not exists (
      select 1 from unnest(week_days) as d where d < 0 or d > 6
    )
  ),
  constraint notification_schedules_day_of_month_check check (
    day_of_month is null or (day_of_month between 1 and 31)
  )
);

create index if not exists idx_notification_schedules_next_run on public.notification_schedules(enabled, next_run_at);
create index if not exists idx_notification_schedules_target_user on public.notification_schedules(target_user_id);

alter table public.notification_schedules enable row level security;
drop policy if exists "notification_schedules_admin_all" on public.notification_schedules;
create policy "notification_schedules_admin_all" on public.notification_schedules
  for all
  using (public.is_admin_user())
  with check (public.is_admin_user());

create table if not exists public.notification_automation_settings (
  id text primary key,
  enabled boolean not null default true,
  hour_utc int null,
  days_without_jornada int null,
  send_push boolean not null default true,
  create_internal_notification boolean not null default false,
  visibility_mode text not null default 'snapshot',
  title text null,
  body text null,
  button_text text null,
  button_url text null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_automation_settings_id_check check (id in ('inactivity_reminder', 'payroll_estimate', 'app_update')),
  constraint notification_automation_settings_hour_check check (hour_utc is null or (hour_utc between 0 and 23)),
  constraint notification_automation_settings_days_check check (days_without_jornada is null or days_without_jornada >= 1)
);

alter table public.notification_automation_settings enable row level security;
drop policy if exists "notification_automation_settings_admin_all" on public.notification_automation_settings;
create policy "notification_automation_settings_admin_all" on public.notification_automation_settings
  for all
  using (public.is_admin_user())
  with check (public.is_admin_user());

update public.app_update_config
set enabled = true
where enabled is null;

insert into public.notification_automation_settings (
  id,
  enabled,
  hour_utc,
  days_without_jornada,
  send_push,
  create_internal_notification,
  title,
  body,
  data
)
values
  (
    'inactivity_reminder',
    true,
    9,
    2,
    true,
    false,
    'Recuerda registrar tu jornada',
    'Llevas varios días sin registrar jornadas.',
    '{"target":"jornada"}'::jsonb
  ),
  (
    'payroll_estimate',
    true,
    9,
    null,
    true,
    true,
    'Estimación de nómina disponible',
    'Ya tienes disponible tu estimación del periodo.',
    '{}'::jsonb
  ),
  (
    'app_update',
    true,
    9,
    null,
    true,
    true,
    'Nueva versión disponible',
    'Actualiza Tacoplan para seguir usando las mejoras más recientes.',
    '{}'::jsonb
  )
on conflict (id) do update
set
  updated_at = now(),
  title = coalesce(public.notification_automation_settings.title, excluded.title),
  body = coalesce(public.notification_automation_settings.body, excluded.body);

create table if not exists public.admin_notification_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid null references auth.users(id) on delete set null,
  source text not null default 'manual',
  source_id text null,
  automation_id text null,
  title text not null,
  body text not null,
  type text not null default 'admin_message',
  target_type text null,
  target_user_id uuid null references auth.users(id) on delete set null,
  send_push boolean not null default true,
  create_internal_notification boolean not null default true,
  button_text text null,
  button_url text null,
  data jsonb not null default '{}'::jsonb,
  users_targeted int not null default 0,
  tokens_found int not null default 0,
  push_ok int not null default 0,
  push_failed int not null default 0,
  internal_created int not null default 0,
  status text not null default 'success',
  error_message text null,
  created_at timestamptz not null default now(),
  constraint admin_notification_logs_source_check check (source in ('manual', 'schedule', 'automation')),
  constraint admin_notification_logs_status_check check (status in ('success', 'partial', 'error'))
);

create index if not exists idx_admin_notification_logs_created_at on public.admin_notification_logs(created_at desc);
create index if not exists idx_admin_notification_logs_source on public.admin_notification_logs(source, source_id, created_at desc);

alter table public.admin_notification_logs enable row level security;
drop policy if exists "admin_notification_logs_admin_select" on public.admin_notification_logs;
create policy "admin_notification_logs_admin_select" on public.admin_notification_logs
  for select
  using (public.is_admin_user());
drop policy if exists "admin_notification_logs_admin_insert" on public.admin_notification_logs;
create policy "admin_notification_logs_admin_insert" on public.admin_notification_logs
  for insert
  with check (public.is_admin_user());

alter table public.user_notifications
  add column if not exists button_text text,
  add column if not exists button_url text,
  add column if not exists notification_dispatch_id uuid,
  add column if not exists delivered_at timestamptz,
  add column if not exists push_status text not null default 'not_requested',
  add column if not exists delivery_error text,
  add column if not exists visibility_mode text not null default 'snapshot';
create unique index if not exists idx_user_notifications_user_dispatch_unique
  on public.user_notifications(user_id, notification_dispatch_id);

create table if not exists public.notification_dispatches (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid null references auth.users(id) on delete set null,
  source text not null default 'manual',
  source_id text null,
  automation_id text null,
  title text not null,
  body text not null,
  type text not null default 'admin_message',
  target_type text not null default 'all',
  target_user_id uuid null references auth.users(id) on delete set null,
  send_push boolean not null default true,
  create_internal_notification boolean not null default true,
  button_text text null,
  button_url text null,
  data jsonb not null default '{}'::jsonb,
  visibility_mode text not null default 'snapshot',
  users_targeted int not null default 0,
  tokens_found int not null default 0,
  push_ok int not null default 0,
  push_failed int not null default 0,
  internal_created int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_dispatches_source_check check (source in ('manual', 'schedule', 'automation')),
  constraint notification_dispatches_visibility_check check (visibility_mode in ('snapshot', 'persistent'))
);

create index if not exists idx_notification_dispatches_created_at on public.notification_dispatches(created_at desc);
create index if not exists idx_notification_dispatches_visibility on public.notification_dispatches(visibility_mode, created_at desc);

alter table public.notification_dispatches enable row level security;
drop policy if exists "notification_dispatches_admin_select" on public.notification_dispatches;
create policy "notification_dispatches_admin_select" on public.notification_dispatches
  for select using (public.is_admin_user());
drop policy if exists "notification_dispatches_admin_insert" on public.notification_dispatches;
create policy "notification_dispatches_admin_insert" on public.notification_dispatches
  for insert with check (public.is_admin_user() or auth.role() = 'service_role');
drop policy if exists "notification_dispatches_admin_update" on public.notification_dispatches;
create policy "notification_dispatches_admin_update" on public.notification_dispatches
  for update using (public.is_admin_user() or auth.role() = 'service_role')
  with check (public.is_admin_user() or auth.role() = 'service_role');
drop policy if exists "notification_dispatches_user_select_persistent" on public.notification_dispatches;
create policy "notification_dispatches_user_select_persistent" on public.notification_dispatches
  for select
  using (
    visibility_mode = 'persistent'
    and (
      target_type = 'all'
      or (target_type = 'user' and target_user_id = auth.uid())
    )
  );

-- Opcional: programa la ejecución automática desde pg_cron.
-- Reemplaza __PROJECT_URL__, __ANON_KEY__ y __CRON_SECRET__ y descomenta.
--
-- create extension if not exists pg_net;
-- create extension if not exists pg_cron;
--
-- select cron.schedule(
--   'tacoplan-run-notification-schedules',
--   '* * * * *',
--   $sql$
--   select net.http_post(
--     url := '__PROJECT_URL__/functions/v1/run-notification-schedules',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'apikey', '__ANON_KEY__',
--       'x-cron-secret', '__CRON_SECRET__'
--     ),
--     body := '{}'::jsonb
--   );
--   $sql$
-- );
--
-- select cron.schedule(
--   'tacoplan-run-notification-automations',
--   '*/5 * * * *',
--   $sql$
--   select net.http_post(
--     url := '__PROJECT_URL__/functions/v1/run-notification-automations',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'apikey', '__ANON_KEY__',
--       'x-cron-secret', '__CRON_SECRET__'
--     ),
--     body := '{}'::jsonb
--   );
--   $sql$
-- );
