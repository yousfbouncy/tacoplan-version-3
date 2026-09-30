-- Tacoplan: integridad y sincronización multi-dispositivo.
--
-- La migración es idempotente y conserva una copia recuperable de cualquier
-- compensación duplicada antes de eliminar la copia secundaria.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.compensaciones_duplicates_archive
as
select c.*, now()::timestamptz as archived_at,
       ''::text as archive_reason
from public.compensaciones c
with no data;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'private.compensaciones_duplicates_archive'::regclass
      and contype = 'p'
  ) then
    alter table private.compensaciones_duplicates_archive
      add primary key (id);
  end if;
end $$;

with ranked as (
  select id,
         row_number() over (
           partition by user_id, jornada_id
           order by updated_at desc nulls last,
                    created_at desc nulls last,
                    id desc
         ) as rn
  from public.compensaciones
  where jornada_id is not null
), archived as (
  insert into private.compensaciones_duplicates_archive
  select c.*, now(), 'duplicate_user_jornada'
  from public.compensaciones c
  join ranked r using (id)
  where r.rn > 1
  on conflict (id) do nothing
  returning id
)
delete from public.compensaciones c
using ranked r
where c.id = r.id and r.rn > 1;

alter table public.compensaciones
  drop constraint if exists compensaciones_user_jornada_key;
alter table public.compensaciones
  add constraint compensaciones_user_jornada_key unique (user_id, jornada_id);

-- La app usa IDs de jornada de texto. Las referencias UUID hacían que el
-- fallback descartase previous/next_journey_id y dejase el registro pendiente.
alter table public.user_natural_day_diets alter column id drop default;
alter table public.user_natural_day_diets
  alter column id type text using id::text;
alter table public.user_natural_day_diets
  alter column id set default gen_random_uuid()::text;
alter table public.user_natural_day_diets
  alter column previous_journey_id type text using previous_journey_id::text;
alter table public.user_natural_day_diets
  alter column next_journey_id type text using next_journey_id::text;

delete from public.user_natural_day_diets d
using (
  select id
  from (
    select id,
           row_number() over (
             partition by user_id, date
             order by updated_at desc nulls last,
                      created_at desc nulls last,
                      id desc
           ) as rn
    from public.user_natural_day_diets
  ) ranked
  where rn > 1
) duplicate
where d.id = duplicate.id;

create unique index if not exists idx_user_natural_day_diets_user_date
  on public.user_natural_day_diets(user_id, date);

-- Metadatos que ya usa DayExtraEntry y que faltaban en producción.
alter table public.user_day_extra_entries
  add column if not exists location_start text,
  add column if not exists location_end text,
  add column if not exists in_base boolean,
  add column if not exists distance_to_base_km numeric;

delete from public.user_day_extra_entries d
using (
  select id
  from (
    select id,
           row_number() over (
             partition by user_id, date, day_flag
             order by updated_at desc nulls last,
                      created_at desc nulls last,
                      id desc
           ) as rn
    from public.user_day_extra_entries
    where entry_type = 'day_extra'
  ) ranked
  where rn > 1
) duplicate
where d.id = duplicate.id;

delete from public.user_day_extra_entries d
using (
  select id
  from (
    select id,
           row_number() over (
             partition by user_id, date
             order by updated_at desc nulls last,
                      created_at desc nulls last,
                      id desc
           ) as rn
    from public.user_day_extra_entries
    where entry_type = 'offsite_weekly_rest'
  ) ranked
  where rn > 1
) duplicate
where d.id = duplicate.id;

create unique index if not exists uq_day_extra_user_date_flag
  on public.user_day_extra_entries(user_id, date, day_flag)
  where entry_type = 'day_extra';
create unique index if not exists uq_offsite_weekly_user_date
  on public.user_day_extra_entries(user_id, date)
  where entry_type = 'offsite_weekly_rest';

-- Reglas NOT VALID: protegen escrituras nuevas sin alterar ni bloquear el
-- historial legado que necesita revisión humana.
alter table public.jornadas
  drop constraint if exists jornadas_nonnegative_minutes_chk;
alter table public.jornadas
  add constraint jornadas_nonnegative_minutes_chk check (
    (conduccion_min is null or conduccion_min >= 0) and
    (duracion_jornada_min is null or duracion_jornada_min >= 0) and
    (descanso_anterior_min is null or descanso_anterior_min >= 0)
  ) not valid;

alter table public.compensaciones
  drop constraint if exists compensaciones_debt_range_chk;
alter table public.compensaciones
  add constraint compensaciones_debt_range_chk check (
    (horas_deuda is null or horas_deuda >= 0) and
    (minutos_deuda is null or minutos_deuda between 0 and 59)
  ) not valid;

alter table public.user_day_extra_entries
  drop constraint if exists user_day_extra_amount_nonnegative_chk;
alter table public.user_day_extra_entries
  add constraint user_day_extra_amount_nonnegative_chk
  check (amount is null or amount >= 0) not valid;

-- Índices de relaciones y consultas de sincronización.
create index if not exists idx_compensaciones_jornada_id
  on public.compensaciones(jornada_id);
create index if not exists idx_user_holidays_user_id
  on public.user_holidays(user_id);
create index if not exists idx_tachograph_events_session_id
  on public.tachograph_events(session_id);
create index if not exists idx_tachograph_sessions_device_id
  on public.tachograph_sessions(device_id);

drop index if exists public.idx_day_extra_entries_user_date;
drop index if exists public.user_notifications_user_id_created_at_idx;
drop index if exists public.user_notifications_user_id_is_read_idx;

-- Sustituye las múltiples políticas equivalentes acumuladas por una única
-- política de propietario, limitada a usuarios autenticados y optimizada para
-- que auth.uid() se evalúe una sola vez por consulta.
do $$
declare
  table_name text;
  policy_name text;
  owner_column text;
begin
  foreach table_name in array array[
    'profiles', 'jornadas', 'compensaciones', 'dietas_config',
    'user_diet_rates', 'user_day_extras', 'user_day_extra_entries',
    'user_natural_day_diets', 'user_holidays', 'user_ferry_config',
    'ferry_rests', 'viajes', 'tachograph_devices', 'tachograph_sessions',
    'tachograph_events', 'tachograph_daily_summary'
  ] loop
    for policy_name in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = table_name
    loop
      execute format('drop policy %I on public.%I', policy_name, table_name);
    end loop;

    owner_column := case when table_name = 'profiles' then 'id' else 'user_id' end;
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select auth.uid()) = %I) with check ((select auth.uid()) = %I)',
      table_name || '_owner_authenticated', table_name, owner_column, owner_column
    );
  end loop;
end $$;
