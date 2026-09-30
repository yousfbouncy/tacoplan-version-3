-- Conserva una copia exacta antes de neutralizar valores heredados que no se
-- pueden convertir en fecha/duración real sin inventar información.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.jornadas_invalid_legacy_archive
as
select j.*, now()::timestamptz as archived_at,
       ''::text as archive_reason
from public.jornadas j
with no data;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'private.jornadas_invalid_legacy_archive'::regclass
      and contype = 'p'
  ) then
    alter table private.jornadas_invalid_legacy_archive add primary key (id);
  end if;
end $$;

insert into private.jornadas_invalid_legacy_archive
select j.*, now(), 'invalid_timestamp_or_negative_minutes'
from public.jornadas j
where j.duracion_jornada_min < 0
   or j.descanso_anterior_min < 0
   or (j.start_at is not null and not pg_input_is_valid(j.start_at, 'timestamp with time zone'))
   or (j.end_at is not null and not pg_input_is_valid(j.end_at, 'timestamp with time zone'))
on conflict (id) do nothing;

update public.jornadas
set
  start_at = case
    when start_at is not null and not pg_input_is_valid(start_at, 'timestamp with time zone') then null
    else start_at
  end,
  end_at = case
    when end_at is not null and not pg_input_is_valid(end_at, 'timestamp with time zone') then null
    else end_at
  end,
  duracion_jornada_min = case
    when duracion_jornada_min < 0 then null
    else duracion_jornada_min
  end,
  descanso_anterior_min = case
    when descanso_anterior_min < 0 then null
    else descanso_anterior_min
  end,
  tipo_descanso_anterior = case
    when descanso_anterior_min < 0 then null
    else tipo_descanso_anterior
  end,
  counts_as_daily_reduced = case
    when descanso_anterior_min < 0 then false
    else counts_as_daily_reduced
  end,
  counts_as_reduced_rest = case
    when descanso_anterior_min < 0 then false
    else counts_as_reduced_rest
  end,
  legal_summary = null,
  updated_at = now()::text
where duracion_jornada_min < 0
   or descanso_anterior_min < 0
   or (start_at is not null and not pg_input_is_valid(start_at, 'timestamp with time zone'))
   or (end_at is not null and not pg_input_is_valid(end_at, 'timestamp with time zone'));

alter table public.jornadas validate constraint jornadas_nonnegative_minutes_chk;
alter table public.compensaciones validate constraint compensaciones_debt_range_chk;
alter table public.user_day_extra_entries validate constraint user_day_extra_amount_nonnegative_chk;
