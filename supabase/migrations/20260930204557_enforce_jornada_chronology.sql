-- Archiva cualquier fila incoherente que no estuviese ya incluida en la copia
-- de seguridad de la normalización anterior.
insert into private.jornadas_invalid_legacy_archive
select j.*, now(), 'inverted_chronology_or_driving_exceeds_duration'
from public.jornadas j
where (
    j.start_at is not null
    and j.end_at is not null
    and j.end_at::timestamptz < j.start_at::timestamptz
  )
  or (
    j.conduccion_min is not null
    and j.duracion_jornada_min is not null
    and j.conduccion_min > j.duracion_jornada_min
  )
on conflict (id) do nothing;

-- No se altera la conducción indicada por el usuario. Solo se neutraliza el
-- dato derivado que es físicamente imposible o una cronología invertida.
update public.jornadas
set
  end_at = case
    when start_at is not null and end_at is not null
      and end_at::timestamptz < start_at::timestamptz then null
    else end_at
  end,
  duracion_jornada_min = case
    when conduccion_min is not null and duracion_jornada_min is not null
      and conduccion_min > duracion_jornada_min then null
    else duracion_jornada_min
  end,
  legal_summary = null,
  updated_at = now()::text
where (
    start_at is not null
    and end_at is not null
    and end_at::timestamptz < start_at::timestamptz
  )
  or (
    conduccion_min is not null
    and duracion_jornada_min is not null
    and conduccion_min > duracion_jornada_min
  );

-- Los valores malformados ya fueron archivados y convertidos a NULL. El tipo
-- nativo evita que vuelvan a entrar cadenas como NaN o fechas incompletas.
alter table public.jornadas
  alter column start_at type timestamptz using start_at::timestamptz,
  alter column end_at type timestamptz using end_at::timestamptz;

alter table public.jornadas
  drop constraint if exists jornadas_chronology_chk;
alter table public.jornadas
  add constraint jornadas_chronology_chk check (
    start_at is null or end_at is null or end_at >= start_at
  );

alter table public.jornadas
  drop constraint if exists jornadas_driving_within_duration_chk;
alter table public.jornadas
  add constraint jornadas_driving_within_duration_chk check (
    conduccion_min is null
    or duracion_jornada_min is null
    or conduccion_min <= duracion_jornada_min
  );
