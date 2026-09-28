-- Parche incremental para un esquema que YA tiene:
-- admin_users, notification_schedules, notification_automation_settings, admin_notification_logs
-- según el SQL base compartido por el usuario.

create extension if not exists pgcrypto;

-- ============================================================
-- ADMIN USERS
-- ============================================================
alter table public.admin_users
  add column if not exists email text,
  add column if not exists full_name text,
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.is_admin_user(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.admin_users au
    where au.user_id = coalesce(p_user_id, auth.uid())
      and au.is_active = true
  );
$$;

-- ============================================================
-- USER NOTIFICATIONS
-- ============================================================
alter table public.user_notifications
  add column if not exists button_text text,
  add column if not exists button_url text;

-- ============================================================
-- NOTIFICATION SCHEDULES
-- ============================================================
alter table public.notification_schedules
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists button_text text,
  add column if not exists button_url text;

do $$
declare
  rec record;
begin
  for rec in
    select conname
    from pg_constraint
    where conrelid = 'public.notification_schedules'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%target_type%'
  loop
    execute format('alter table public.notification_schedules drop constraint if exists %I', rec.conname);
  end loop;
end $$;

alter table public.notification_schedules
  add constraint notification_schedules_target_type_check
  check (target_type in (
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
  ));

create index if not exists idx_notification_schedules_target_user
  on public.notification_schedules(target_user_id);

-- ============================================================
-- AUTOMATION SETTINGS
-- ============================================================
alter table public.notification_automation_settings
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists button_text text,
  add column if not exists button_url text;

do $$
declare
  rec record;
begin
  for rec in
    select conname
    from pg_constraint
    where conrelid = 'public.notification_automation_settings'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%days_without_jornada%'
  loop
    execute format('alter table public.notification_automation_settings drop constraint if exists %I', rec.conname);
  end loop;
end $$;

alter table public.notification_automation_settings
  add constraint notification_automation_settings_days_check
  check (days_without_jornada is null or (days_without_jornada between 1 and 60));

update public.notification_automation_settings
set updated_at = now()
where updated_at is null;

insert into public.notification_automation_settings (
  id,
  enabled,
  hour_utc,
  days_without_jornada,
  send_push,
  create_internal_notification,
  title,
  body,
  data,
  updated_at
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
    '{"target":"jornada"}'::jsonb,
    now()
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
    '{}'::jsonb,
    now()
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
    '{}'::jsonb,
    now()
  )
on conflict (id) do update
set
  updated_at = now(),
  title = coalesce(public.notification_automation_settings.title, excluded.title),
  body = coalesce(public.notification_automation_settings.body, excluded.body),
  data = coalesce(public.notification_automation_settings.data, excluded.data);

-- ============================================================
-- ADMIN LOGS
-- ============================================================
alter table public.admin_notification_logs
  add column if not exists automation_id text,
  add column if not exists button_text text,
  add column if not exists button_url text,
  add column if not exists status text not null default 'success',
  add column if not exists error_message text;

do $$
declare
  rec record;
begin
  for rec in
    select conname
    from pg_constraint
    where conrelid = 'public.admin_notification_logs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%target_type%'
  loop
    execute format('alter table public.admin_notification_logs drop constraint if exists %I', rec.conname);
  end loop;
end $$;

alter table public.admin_notification_logs
  add constraint admin_notification_logs_target_type_check
  check (target_type in (
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
  ));

do $$
declare
  rec record;
begin
  for rec in
    select conname
    from pg_constraint
    where conrelid = 'public.admin_notification_logs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.admin_notification_logs drop constraint if exists %I', rec.conname);
  end loop;
end $$;

alter table public.admin_notification_logs
  add constraint admin_notification_logs_status_check
  check (status in ('success', 'partial', 'error'));

do $$
declare
  rec record;
begin
  for rec in
    select conname
    from pg_constraint
    where conrelid = 'public.admin_notification_logs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%source%'
  loop
    execute format('alter table public.admin_notification_logs drop constraint if exists %I', rec.conname);
  end loop;
end $$;

alter table public.admin_notification_logs
  add constraint admin_notification_logs_source_check
  check (source is null or source in ('manual', 'schedule', 'automation'));

create index if not exists idx_admin_notification_logs_source
  on public.admin_notification_logs(source, source_id, created_at desc);

-- ============================================================
-- APP UPDATE CONFIG
-- ============================================================
alter table public.app_update_config
  add column if not exists minimum_version text,
  add column if not exists app_store_url text,
  add column if not exists enabled boolean default true;

update public.app_update_config
set enabled = true
where enabled is null;

-- ============================================================
-- CRON (opcional, comentado)
-- ============================================================
-- Descomenta y reemplaza __PROJECT_URL__, __ANON_KEY__ y __CRON_SECRET__.
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
