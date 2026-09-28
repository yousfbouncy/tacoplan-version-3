-- =====================================================================
-- Migración: Columnas is_domingo e is_festivo en user_natural_day_diets
--
-- Propósito:
--   Almacenar flags booleanos de Domingo y Festivo asociados a cada
--   dieta natural fuera de base. Permiten generar automáticamente
--   los pluses "Plus Domingo" / "Plus Festivo" según la configuración
--   de tarifas Settings (extra_sunday / extra_holiday).
--
-- Safe / Idempotente:
--   Verifica doblemente existencia de tabla y columna antes de ALTER.
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'user_natural_day_diets'
  ) THEN
    RAISE NOTICE 'Tabla user_natural_day_diets aún no existe; omitiendo is_domingo e is_festivo.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'user_natural_day_diets'
      AND column_name  = 'is_domingo'
  ) THEN
    ALTER TABLE public.user_natural_day_diets
      ADD COLUMN is_domingo boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'user_natural_day_diets'
      AND column_name  = 'is_festivo'
  ) THEN
    ALTER TABLE public.user_natural_day_diets
      ADD COLUMN is_festivo boolean NOT NULL DEFAULT false;
  END IF;
END $$;
