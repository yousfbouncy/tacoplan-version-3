-- =====================================================================
-- Migración defensiva post-migración tacógrafo.
--
-- Problema que arregla:
--   Supabase estaba lanzaba:
--   "null value in column 'tacho_countries' of relation 'jornadas'
--    violates not-null constraint"
--
-- Causa raíz:
--   sync-service.ts antes del fix enviaba `row.tacho_countries = j.tachoCountries ?? null
--   y Postgres NO usa el DEFAULT '{}' de la columna SOLAMENTE si la columna
--   NO APARECE en la lista INSERT / UPDATE SET. Al enviarse el literal NULL,
--   la columna NOT NULL rechaza el INSERT.
--
-- Mitigación EN CAPA 1 (código):
--   local-storage.ts defaults non-null ([]) (ver fix)
--   sync-service.ts coerce: Array.isArray() ? arr : [] (ya fix)
--
-- Mitigación CAPA 2 (base de datos, ESTA migración):
--   - Coercemos NULL → valor default usando coalesce para UPDATE-por-si-acaso.
--   - Eliminamos NOT NULL para esas 3 columnas para hacer a prueba de balas:
--     incluso si un insert viejo de una versión anterior envía NULL, no se rechaza.
--   - Mantenemos los DEFAULTS para nuevos inserts que no envíen el campo.
--
-- No se tocan RLS. No se eliminan columnas. No se destruye nada.
-- =====================================================================

do $$
begin
  -- 1) tacho_countries — default '{}' incluso si alguien pone NULL
  if exists (select 1 from information_schema.columns where table_name='jornadas' and column_name='tacho_countries') then
    -- Actualizar NULLs existentes por si acaso antes de relajar la constraint
    update public.jornadas set tacho_countries = '{}' where tacho_countries is null;
    execute 'alter table public.jornadas alter column tacho_countries drop not null';
    execute 'alter table public.jornadas alter column tacho_countries set default ''{}''';
  end if;

  -- 2) tacho_country_entries — default 0
  if exists (select 1 from information_schema.columns where table_name='jornadas' and column_name='tacho_country_entries') then
    update public.jornadas set tacho_country_entries = 0 where tacho_country_entries is null;
    execute 'alter table public.jornadas alter column tacho_country_entries drop not null';
    execute 'alter table public.jornadas alter column tacho_country_entries set default 0';
  end if;

  -- 3) tacho_disconnections — default 0
  if exists (select 1 from information_schema.columns where table_name='jornadas' and column_name='tacho_disconnections') then
    update public.jornadas set tacho_disconnections = 0 where tacho_disconnections is null;
    execute 'alter table public.jornadas alter column tacho_disconnections drop not null';
    execute 'alter table public.jornadas alter column tacho_disconnections set default 0';
  end if;
end $$;

comment on column public.jornadas.tacho_countries is '(post-relax-NOT-NULL) Países visitados según tacógrafo (text[]). Default {} sin datos. Antes NOT NULL DEFAULT ''{}''.';
comment on column public.jornadas.tacho_country_entries is '(post-relax-NOT-NULL) Número de entradas por frontera según tacógrafo. Default 0.';
comment on column public.jornadas.tacho_disconnections is '(post-relax-NOT-NULL) Número de desconexiones detectadas tarjeta / tacógrafo. Default 0.';
