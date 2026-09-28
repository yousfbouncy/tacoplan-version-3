-- =====================================================================
-- Migración: Añadir columna pluses_json a user_natural_day_diets
--
-- Propósito:
--   Almacenar array JSONB con los pluses manuales/automáticos asociados
--   a una dieta de día natural (fuera de base), siguiendo el mismo
--   patrón que jornadas.plus_items.
--
-- Formato:
--   [ { "id": string, "concepto": string, "amount": number }, ... ]
--
-- Safe / Idempotente:
--   Verifica que la TABLA exista, y luego que la COLUMNA no exista
--   antes de ALTER (doble guardia).
-- =====================================================================

DO $$
BEGIN
  -- Guardia 1: si la tabla aún no existe, no hacemos nada
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'user_natural_day_diets'
  ) THEN
    RAISE NOTICE 'Tabla user_natural_day_diets aún no existe; omitiendo columna pluses_json.';
    RETURN;
  END IF;

  -- Guardia 2: si la columna ya existe, no hacemos nada
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'user_natural_day_diets'
      AND column_name  = 'pluses_json'
  ) THEN
    ALTER TABLE public.user_natural_day_diets
      ADD COLUMN pluses_json jsonb NULL;
  END IF;
END $$;

-- Índice GIN para acelerar búsquedas (solo SI la tabla y columna ya existen)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'user_natural_day_diets'
      AND column_name  = 'pluses_json'
  ) THEN
    -- No hay CREATE INDEX IF NOT EXISTS para GIN implícito, así que lo construimos manual
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename  = 'user_natural_day_diets'
        AND indexname  = 'idx_user_natural_day_diets_pluses_json_gin'
    ) THEN
      CREATE INDEX idx_user_natural_day_diets_pluses_json_gin
        ON public.user_natural_day_diets
        USING GIN (pluses_json jsonb_ops);
    END IF;
  END IF;
END $$;
