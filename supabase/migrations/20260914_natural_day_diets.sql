-- =====================================================================
-- Migración: Tabla user_natural_day_diets
--
-- Propósito:
--   Almacena las dietas de día natural (fuera de base) por usuario y fecha.
--   Un registro por usuario + fecha, con tipo (INTERNACIONAL/NACIONAL/REGIONAL),
--   porcentaje (100/60/30), importe, y relaciones con jornadas vecinas.
--
-- Safe / Idempotente:
--   Usa IF NOT EXISTS para tabla/índices, chequeo manual de policies
--   dentro de DO $$, y verifica roles en grants.
-- =====================================================================

-- 1) Tabla principal
CREATE TABLE IF NOT EXISTS public.user_natural_day_diets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  type text not null check (type in ('INTERNACIONAL','NACIONAL','REGIONAL')),
  percentage int not null check (percentage in (100,60,30)),
  amount numeric(10,2) not null default 0,
  location text,
  source text not null default 'NATURAL_DAY_OUT_OF_BASE' check (source='NATURAL_DAY_OUT_OF_BASE'),
  previous_journey_id uuid,
  next_journey_id uuid,
  confirmed_by_user boolean not null default false,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) Índices
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_natural_day_diets_user_date
  ON public.user_natural_day_diets(user_id, date);

CREATE INDEX IF NOT EXISTS idx_user_natural_day_diets_user_id
  ON public.user_natural_day_diets(user_id);

-- 3) Row Level Security
ALTER TABLE public.user_natural_day_diets ENABLE ROW LEVEL SECURITY;

-- 3.1) Policy (PostgreSQL NO soporta CREATE POLICY IF NOT EXISTS → chequeo manual)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'user_natural_day_diets'
      AND policyname = 'user_natural_day_diets_own_all'
  ) THEN
    CREATE POLICY user_natural_day_diets_own_all
      ON public.user_natural_day_diets
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- 4) Grants
do $$
begin
  -- authenticated: full CRUD
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update, delete on public.user_natural_day_diets to authenticated;
  end if;
  -- anon: solo lectura si es necesario (principalmente authenticated)
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant select on public.user_natural_day_diets to anon;
  end if;
end $$;
