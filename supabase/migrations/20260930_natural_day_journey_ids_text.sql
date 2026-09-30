-- Tacoplan: alinear los identificadores de jornadas vinculadas con el modelo local.
--
-- Las jornadas locales usan IDs de texto (generateId), por lo que estas columnas
-- no deben ser UUID. No son claves foráneas y solo sirven como referencia lógica.
-- La migración es idempotente y conserva los valores existentes.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_natural_day_diets'
      AND column_name = 'previous_journey_id'
      AND data_type <> 'text'
  ) THEN
    ALTER TABLE public.user_natural_day_diets
      ALTER COLUMN previous_journey_id TYPE text
      USING previous_journey_id::text;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_natural_day_diets'
      AND column_name = 'next_journey_id'
      AND data_type <> 'text'
  ) THEN
    ALTER TABLE public.user_natural_day_diets
      ALTER COLUMN next_journey_id TYPE text
      USING next_journey_id::text;
  END IF;
END $$;
