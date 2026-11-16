-- Admin-controlled survey preferences. Preserve existing response tables.
create table if not exists public.tacoplan_survey_settings (
  id text primary key default 'weekly_survey' check (id = 'weekly_survey'),
  enabled boolean not null default true,
  mandatory boolean not null default true,
  frequency text not null default 'weekly' check (frequency in ('once','every_2_days','weekly','biweekly','monthly')),
  audience text not null default 'all' check (audience in ('all','new_users','first_jornada','recurring')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
insert into public.tacoplan_survey_settings(id) values ('weekly_survey') on conflict (id) do nothing;
alter table public.tacoplan_survey_settings enable row level security;
drop policy if exists "survey_settings_read_authenticated" on public.tacoplan_survey_settings;
create policy "survey_settings_read_authenticated" on public.tacoplan_survey_settings for select to authenticated using (true);
drop policy if exists "survey_settings_admin_insert" on public.tacoplan_survey_settings;
create policy "survey_settings_admin_insert" on public.tacoplan_survey_settings for insert to authenticated with check (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()) and a.is_active = true));
drop policy if exists "survey_settings_admin_update" on public.tacoplan_survey_settings;
create policy "survey_settings_admin_update" on public.tacoplan_survey_settings for update to authenticated using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()) and a.is_active = true)) with check (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()) and a.is_active = true));
grant select on public.tacoplan_survey_settings to authenticated;
grant insert,update on public.tacoplan_survey_settings to authenticated;