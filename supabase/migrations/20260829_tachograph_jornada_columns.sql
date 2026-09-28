-- ============================================================
-- Tacoplan: Integración Tacógrafo Smart 2 con tabla jornadas
-- Migración idempotente. Añade columnas de trazabilidad tacho
-- a jornadas para no perder la fuente de datos certificada.
-- ============================================================

do $$
begin
  if not exists (select 1 from information_schema.columns where table_name='jornadas' and column_name='tacho_daily_summary_id') then
    alter table public.jornadas add column tacho_daily_summary_id uuid null references public.tachograph_daily_summary(id) on delete set null;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='jornadas' and column_name='tacho_driving_min') then
    alter table public.jornadas add column tacho_driving_min int null;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='jornadas' and column_name='tacho_work_min') then
    alter table public.jornadas add column tacho_work_min int null;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='jornadas' and column_name='tacho_available_min') then
    alter table public.jornadas add column tacho_available_min int null;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='jornadas' and column_name='tacho_rest_min') then
    alter table public.jornadas add column tacho_rest_min int null;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='jornadas' and column_name='tacho_countries') then
    alter table public.jornadas add column tacho_countries text[] not null default '{}';
  end if;
  if not exists (select 1 from information_schema.columns where table_name='jornadas' and column_name='tacho_country_entries') then
    alter table public.jornadas add column tacho_country_entries int not null default 0;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='jornadas' and column_name='tacho_km_total') then
    alter table public.jornadas add column tacho_km_total numeric(12,3) null;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='jornadas' and column_name='tacho_first_activity_at') then
    alter table public.jornadas add column tacho_first_activity_at timestamptz null;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='jornadas' and column_name='tacho_last_activity_at') then
    alter table public.jornadas add column tacho_last_activity_at timestamptz null;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='jornadas' and column_name='tacho_disconnections') then
    alter table public.jornadas add column tacho_disconnections int not null default 0;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='jornadas' and column_name='tacho_data_quality') then
    alter table public.jornadas add column tacho_data_quality text null check (tacho_data_quality in ('low','medium','high'));
  end if;
end $$;

create index if not exists jornadas_tacho_daily_summary_id_idx on public.jornadas(tacho_daily_summary_id);
