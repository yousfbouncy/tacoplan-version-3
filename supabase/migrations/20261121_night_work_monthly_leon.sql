-- Tacoplan nocturnity: salary configuration + per-shift evidence, not diets.
-- Art. 25, León 2026–2028: 7% monthly salary base, nighttime 22:00–06:00.
create table if not exists public.user_night_work_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  calculation_mode text not null default 'leon_monthly'
    check (calculation_mode in ('leon_monthly')),
  rate_percent numeric(6,3) not null default 7
    check(rate_percent between 0 and 100),
  base_salary_monthly numeric(12,2) null
    check(base_salary_monthly is null or base_salary_monthly >= 0),
  work_timezone text not null default 'Europe/Madrid',
  updated_at timestamptz not null default now()
);
alter table public.user_night_work_settings enable row level security;
drop policy if exists "owner_select_night_settings" on public.user_night_work_settings;
create policy "owner_select_night_settings" on public.user_night_work_settings for select to authenticated
using ((select auth.uid()) = user_id);
drop policy if exists "owner_insert_night_settings" on public.user_night_work_settings;
create policy "owner_insert_night_settings" on public.user_night_work_settings for insert to authenticated
with check ((select auth.uid()) = user_id);
drop policy if exists "owner_update_night_settings" on public.user_night_work_settings;
create policy "owner_update_night_settings" on public.user_night_work_settings for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table if not exists public.user_night_work_shift_summaries (
  user_id uuid not null references auth.users(id) on delete cascade,
  shift_id text not null,
  shift_date date not null,
  night_work_minutes integer not null default 0 check (night_work_minutes >= 0),
  night_window_minutes integer not null default 0 check (night_window_minutes >= 0),
  is_estimated boolean not null default true,
  calculation_source text not null default 'activity_log'
    check(calculation_source in ('activity_log','shift_window')),
  updated_at timestamptz not null default now(),
  primary key(user_id,shift_id)
);
create index if not exists idx_night_shift_user_date
on public.user_night_work_shift_summaries(user_id,shift_date);
alter table public.user_night_work_shift_summaries enable row level security;
drop policy if exists "owner_select_night_shift" on public.user_night_work_shift_summaries;
create policy "owner_select_night_shift" on public.user_night_work_shift_summaries for select to authenticated
using ((select auth.uid()) = user_id);
drop policy if exists "owner_insert_night_shift" on public.user_night_work_shift_summaries;
create policy "owner_insert_night_shift" on public.user_night_work_shift_summaries for insert to authenticated
with check ((select auth.uid()) = user_id);
drop policy if exists "owner_update_night_shift" on public.user_night_work_shift_summaries;
create policy "owner_update_night_shift" on public.user_night_work_shift_summaries for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
