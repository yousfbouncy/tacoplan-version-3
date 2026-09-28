-- =========================================================================
-- Tacoplan - Doble conducción / conducción en equipo (multi-manning)
-- FASE 14 Base de Datos
-- =========================================================================
-- Retrocompatible: is_double_driving = false por defecto.
-- Las jornadas antiguas se comportan como conducción individual.
-- No hay migraciones destructivas ni modificaciones de datos existentes.
-- =========================================================================

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'jornadas'
      and column_name  = 'is_double_driving'
  ) then
    alter table public.jornadas
      add column is_double_driving boolean not null default false;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'jornadas'
      and column_name  = 'second_driver_name'
  ) then
    alter table public.jornadas
      add column second_driver_name text null;
  end if;
end $$;

comment on column public.jornadas.is_double_driving
  is 'true = conducción en equipo / doble conducción. Ventana legal 30h, umbrales 19h/21h. false = conductor individual, reglas 13h/15h normales.';

comment on column public.jornadas.second_driver_name
  is 'Nombre del compañero / segundo conductor en conducción en equipo. Solo es significativo cuando is_double_driving = true.';
