-- Tacoplan: notification dispatches, base location and weekly rest traceability

alter table public.profiles
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists base_name text,
  add column if not exists base_city text,
  add column if not exists base_country text,
  add column if not exists base_address text,
  add column if not exists base_latitude numeric(10,6),
  add column if not exists base_longitude numeric(10,6),
  add column if not exists base_radius_km numeric(10,2) not null default 20,
  add column if not exists base_configured_at timestamptz,
  add column if not exists base_updated_at timestamptz;

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

alter table public.user_notifications
  add column if not exists notification_dispatch_id uuid references public.notification_dispatches(id) on delete set null,
  add column if not exists delivered_at timestamptz,
  add column if not exists push_status text not null default 'not_requested',
  add column if not exists delivery_error text,
  add column if not exists visibility_mode text not null default 'snapshot';

create index if not exists idx_user_notifications_dispatch on public.user_notifications(notification_dispatch_id);
create unique index if not exists idx_user_notifications_user_dispatch_unique
  on public.user_notifications(user_id, notification_dispatch_id);

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

alter table public.notification_schedules
  add column if not exists visibility_mode text not null default 'snapshot';

alter table public.notification_automation_settings
  add column if not exists visibility_mode text not null default 'snapshot';

alter table public.user_day_extra_entries
  add column if not exists location_start text,
  add column if not exists location_end text,
  add column if not exists in_base boolean,
  add column if not exists distance_to_base_km numeric(10,2);

alter table public.jornadas
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
  add column if not exists previous_rest_observations text;

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
